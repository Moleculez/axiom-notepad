"use client";
import {
  Component,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  Globe,
  Play,
  RefreshCw,
  FileQuestion,
  Network,
  X,
} from "lucide-react";
import { parseMarkdown } from "@axiom/markdown";
import {
  canvasBounds,
  canvasColors,
  canvasTitle,
  parseCanvas,
  type CanvasNode,
  type CanvasData,
} from "@axiom/shared/canvas";
import {
  canvasEdgeGeometry,
  intersectsCanvas,
} from "@axiom/shared/canvas-geometry";
import {
  embeddableCanvasUrl,
  type ResourceCardPreview,
} from "@axiom/shared/canvas-preview";
import { useCanvasPreview } from "../../lib/tools/canvas-preview";
import { useWorkspace, ResourceIcon } from "../workspace/ui";
import ReadingView from "../ReadingView";

const FilePreviewSurface = dynamic(() => import("./FilePreviewSurface"), {
  ssr: false,
  loading: () => <PreviewNotice>Preparing viewer…</PreviewNotice>,
});
const PdfPreview = dynamic(() => import("../workspace/PdfQuickPreview"), {
  ssr: false,
});
export type CanvasPreviewSnapshot = Map<string, ResourceCardPreview>;
export const canvasPreviewKey = (node: Extract<CanvasNode, { type: "file" }>) =>
  `${node.resourceId}:${node.versionId ?? "latest"}`;

export function PreviewNotice({
  children,
  retry,
}: {
  children: ReactNode;
  retry?: () => void;
}) {
  return (
    <div className="canvas-preview-notice">
      <FileQuestion size={23} />
      <span>{children}</span>
      {retry && (
        <button
          className="icon-button"
          title="Retry preview"
          aria-label="Retry preview"
          onClick={retry}
        >
          <RefreshCw size={15} />
        </button>
      )}
    </div>
  );
}
export class CanvasPreviewBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error)
      this.setState({ error: false });
  }
  render() {
    return this.state.error ? (
      <PreviewNotice retry={() => this.setState({ error: false })}>
        This preview could not render. The original card is unchanged.
      </PreviewNotice>
    ) : (
      this.props.children
    );
  }
}

export function CanvasMarkdownPreview({ source }: { source: string }) {
  const { appearance, open } = useWorkspace();
  const parsed = useMemo(() => parseMarkdown(source), [source]);
  const context = useMemo(
    () => ({ theme: appearance.dark ? ("dark" as const) : ("light" as const) }),
    [appearance.dark],
  );
  return (
    <ReadingView
      parsed={parsed}
      context={context}
      onLink={(target) => {
        if (/^[\da-f-]{36}$/i.test(target)) open({ id: target, kind: "note" });
      }}
    />
  );
}
export function CanvasMathPreview({
  source,
  settings = {},
}: {
  source: string;
  settings?: Record<string, unknown>;
}) {
  const request = JSON.stringify({
    tex: source,
    display: true,
    physics: true,
    macros:
      typeof settings.macros === "string"
        ? settings.macros.split("\n").filter(Boolean)
        : [],
  });
  return (
    <div className="canvas-equation-preview">
      <div
        className="math-render"
        key={request}
        data-math-request={request}
        aria-busy="true"
      />
      <span className="sr-only">{source}</span>
    </div>
  );
}

export function CanvasLinkPreview({
  node,
  active,
  onActivate,
  onDone,
}: {
  node: Extract<CanvasNode, { type: "link" }>;
  active: boolean;
  onActivate: () => void;
  onDone: () => void;
}) {
  const allowed =
    typeof location !== "undefined"
      ? embeddableCanvasUrl(node.url, location.origin)
      : null;
  return (
    <div
      className={`canvas-web-preview ${active ? "is-interactive" : ""}`}
      onPointerDown={(e) => {
        if (active) e.stopPropagation();
      }}
    >
      {active && allowed ? (
        <>
          <div className="canvas-embed-actions" data-export-exclude>
            <button className="button ghost" onClick={onDone}>
              <X size={14} />
              Done
            </button>
            <a
              className="icon-button"
              title="Open webpage externally"
              aria-label="Open webpage externally"
              href={node.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ArrowUpRight size={15} />
            </a>
          </div>
          <iframe
            title={canvasTitle(node)}
            src={allowed}
            sandbox="allow-scripts allow-forms"
            referrerPolicy="no-referrer"
            allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'"
          />
          <small className="canvas-embed-note">
            If this site blocks embedding, open it externally.
          </small>
        </>
      ) : (
        <div className="canvas-link-summary">
          <Globe size={32} strokeWidth={1.3} />
          <strong>{new URL(node.url).hostname}</strong>
          <span>{node.url}</span>
          <div data-export-exclude>
            {allowed && (
              <button className="button secondary" onClick={onActivate}>
                <Play size={14} />
                Load webpage
              </button>
            )}
            <a
              className="button ghost"
              href={node.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open externally <ArrowUpRight size={14} />
            </a>
          </div>
          <small>No external request until you load or open this page.</small>
        </div>
      )}
    </div>
  );
}

export function CanvasResourcePreview({
  node,
  active = false,
  onActivate = () => {},
  onDone = () => {},
  ancestors = [],
  enabled = true,
  resolved,
  onResolved,
  snapshot,
}: {
  node: Extract<CanvasNode, { type: "file" }>;
  active?: boolean;
  onActivate?: () => void;
  onDone?: () => void;
  ancestors?: string[];
  enabled?: boolean;
  resolved?: ResourceCardPreview;
  onResolved?: (value: ResourceCardPreview | null) => void;
  snapshot?: CanvasPreviewSnapshot;
}) {
  const { open } = useWorkspace();
  const cycle = !!node.resourceId && ancestors.includes(node.resourceId);
  const state = useCanvasPreview(
    node.resourceId,
    node.versionId,
    enabled && !cycle && !resolved && !snapshot,
  );
  const data = snapshot?.get(canvasPreviewKey(node)) ?? resolved ?? state.data;
  useEffect(() => {
    onResolved?.(data ?? null);
  }, [data, onResolved]);
  if (!node.resourceId)
    return (
      <PreviewNotice>
        Unlinked file: {node.file}. Use Properties to link a workspace file.
      </PreviewNotice>
    );
  if (cycle)
    return (
      <PreviewNotice>
        Canvas reference cycle.{" "}
        <button
          className="button ghost"
          data-export-exclude
          onClick={() =>
            open({
              id: node.resourceId!,
              kind: "note",
              document_type: "canvas",
            })
          }
        >
          Open original <ArrowUpRight size={14} />
        </button>
      </PreviewNotice>
    );
  if (state.error && !resolved)
    return <PreviewNotice retry={state.reload}>{state.error}</PreviewNotice>;
  if (!data)
    return (
      <PreviewNotice>
        {snapshot
          ? "Preview omitted · unavailable at export time."
          : enabled
            ? "Loading preview…"
            : "Preview loads when the card is in view."}
      </PreviewNotice>
    );
  const openOriginal = () =>
    open({
      ...data.resource,
      document_type:
        data.kind === "document"
          ? data.format === "latex"
            ? "math"
            : data.format === "markdown"
              ? undefined
              : data.format
          : undefined,
      ...(node.versionId ? { versionId: node.versionId } : {}),
    });
  return (
    <div
      className={`canvas-resource-preview ${active ? "is-interactive" : "is-static"}`}
      onPointerDown={(e) => {
        if (active) e.stopPropagation();
      }}
    >
      <div
        className="canvas-preview-content"
        data-canvas-measure
        inert={!active}
      >
        <CanvasResourceContent
          node={node}
          data={data}
          active={active}
          ancestors={ancestors}
          reload={state.reload}
          snapshot={snapshot}
        />
      </div>
      <div className="canvas-resource-caption">
        <span title={data.resource.name}>{data.resource.name}</span>
        <small>{node.versionId ? "Pinned version" : "Live reference"}</small>
      </div>
      <div className="canvas-preview-actions" data-export-exclude>
        <button
          className="icon-button"
          title={active ? "Finish interacting" : "Interact with preview"}
          aria-label={active ? "Finish interacting" : "Interact with preview"}
          onClick={active ? onDone : onActivate}
        >
          {active ? <X size={15} /> : <Play size={15} />}
        </button>
        <button
          className="icon-button"
          title="Open original"
          aria-label="Open original"
          onClick={openOriginal}
        >
          <ArrowUpRight size={15} />
        </button>
        <button
          className="icon-button"
          title="Refresh preview"
          aria-label="Refresh preview"
          onClick={state.reload}
        >
          <RefreshCw size={14} />
        </button>
      </div>
    </div>
  );
}
function CanvasResourceContent({
  node,
  data,
  active,
  ancestors,
  reload,
  snapshot,
}: {
  node: Extract<CanvasNode, { type: "file" }>;
  data: ResourceCardPreview;
  active: boolean;
  ancestors: string[];
  reload: () => void;
  snapshot?: CanvasPreviewSnapshot;
}) {
  if (data.kind === "document") {
    if (data.format === "canvas")
      return ancestors.length >= 3 ? (
        <PreviewNotice>
          Nested canvas · open the original to go deeper.
        </PreviewNotice>
      ) : (
        <CanvasNestedPreview
          source={data.source}
          active={active}
          ancestors={[...ancestors, node.resourceId!]}
          snapshot={snapshot}
        />
      );
    if (data.format === "latex")
      return (
        <CanvasMathPreview source={data.source} settings={data.settings} />
      );
    if (data.format === "markdown")
      return <CanvasMarkdownPreview source={data.source} />;
    return (
      <pre className="canvas-source-preview">
        {data.source.slice(0, 20000)}
        {data.source.length > 20000
          ? "\n… Open original for the complete document."
          : ""}
      </pre>
    );
  }
  const file = data.file;
  if (file.kind === "image")
    return <CanvasImage source={file.source} name={file.name} fit={node.fit} />;
  if (file.kind === "pdf" && !active)
    return (
      <div className="canvas-pdf-poster">
        <PdfPreview
          source={file.source}
          interactive={false}
          initialPage={node.previewPage ?? 1}
        />
      </div>
    );
  if ((file.kind === "video" || file.kind === "audio") && !active)
    return (
      <div className="canvas-media-poster">
        {file.kind === "video" ? (
          <video src={file.source} preload="metadata" muted playsInline />
        ) : (
          <ResourceIcon resource={data.resource} size={35} />
        )}
        <span>
          <Play size={18} /> Activate to play {file.kind}
        </span>
      </div>
    );
  if (file.kind === "text" && /\.tex$/i.test(file.name))
    return <EquationFile source={file.source} bytes={file.bytes} />;
  return (
    <FilePreviewSurface
      resourceId={node.resourceId!}
      versionId={node.versionId}
      compact
      initialManifest={file}
      onReload={reload}
    />
  );
}
function CanvasImage({
  source,
  name,
  fit = "contain",
}: {
  source: string;
  name: string;
  fit?: "cover" | "contain";
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return failed ? (
    <PreviewNotice>
      This image cannot be decoded. Open the original to download it.
    </PreviewNotice>
  ) : (
    <img
      className={`canvas-image fit-${fit}`}
      src={source}
      alt={name}
      draggable={false}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
function EquationFile({ source, bytes }: { source: string; bytes: number }) {
  const [text, setText] = useState<string | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setText(null);
    setError("");
    if (bytes > 30000) {
      setError(
        "This TeX document is too large for an equation card. Open the source instead.",
      );
      return;
    }
    void fetch(source, { signal: c.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("Equation source unavailable.");
        const value = await r.text();
        if (value.length > 30000)
          throw new Error("Equation source is too large.");
        if (!c.signal.aborted) setText(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [source, bytes]);
  return error ? (
    <PreviewNotice>{error}</PreviewNotice>
  ) : text === null ? (
    <PreviewNotice>Loading equation…</PreviewNotice>
  ) : (
    <CanvasMathPreview source={text} />
  );
}

export function CanvasNestedPreview({
  source,
  active,
  ancestors,
  snapshot,
}: {
  source: string;
  active: boolean;
  ancestors: string[];
  snapshot?: CanvasPreviewSnapshot;
}) {
  const data = useMemo(() => parseCanvas(source), [source]);
  const bounds = canvasBounds(data.nodes),
    host = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: 320, height: 280 }),
    [offset, setOffset] = useState({ x: 0, y: 0, scale: 1 });
  useEffect(() => {
    if (!host.current) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ width: e.contentRect.width, height: e.contentRect.height }),
    );
    ro.observe(host.current);
    return () => ro.disconnect();
  }, []);
  const scale =
    Math.min(
      (size.width - 24) / Math.max(1, bounds.width),
      (size.height - 24) / Math.max(1, bounds.height),
    ) * offset.scale;
  const x =
      (size.width - bounds.width * scale) / 2 - bounds.x * scale + offset.x,
    y = (size.height - bounds.height * scale) / 2 - bounds.y * scale + offset.y;
  const viewport = {
    x: -x / scale,
    y: -y / scale,
    width: size.width / scale,
    height: size.height / scale,
  };
  return (
    <div
      className="canvas-nested-stage"
      ref={host}
      onWheel={(e) => {
        if (!active) return;
        e.stopPropagation();
        setOffset((v) => ({
          ...v,
          scale: Math.max(
            0.2,
            Math.min(8, v.scale * Math.exp(-e.deltaY * 0.002)),
          ),
        }));
      }}
      onPointerDown={(e) => {
        if (!active || e.button !== 0) return;
        e.stopPropagation();
        drag.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const p = drag.current;
        setOffset((v) => ({
          ...v,
          x: v.x + e.clientX - p.x,
          y: v.y + e.clientY - p.y,
        }));
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <div
        className="canvas-nested-world"
        style={{ transform: `translate(${x}px,${y}px) scale(${scale})` }}
      >
        <CanvasReadScene
          data={data}
          ancestors={ancestors}
          viewport={viewport}
          snapshot={snapshot}
        />
      </div>
      {!data.nodes.length && <PreviewNotice>Empty canvas</PreviewNotice>}
      <span className="canvas-nested-label">
        <Network size={12} />
        {data.nodes.length} cards
        {active ? " · drag to pan, scroll to zoom" : ""}
      </span>
    </div>
  );
}

/** Pure board scene shared by nested previews and export staging. No editors or writes. */
export function CanvasReadScene({
  data,
  ancestors = [],
  viewport,
  snapshot,
}: {
  data: CanvasData;
  ancestors?: string[];
  viewport?: { x: number; y: number; width: number; height: number };
  snapshot?: CanvasPreviewSnapshot;
}) {
  const marker = `canvas-preview-${useId().replaceAll(":", "")}`;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const visible = viewport
    ? data.nodes.filter((n) => intersectsCanvas(n, viewport)).slice(0, 80)
    : data.nodes;
  const nodes = [
    ...visible.filter((n) => n.type === "group"),
    ...visible.filter((n) => n.type !== "group"),
  ];
  return (
    <>
      <svg className="canvas-edges" width="1" height="1">
        <defs>
          <marker
            id={marker}
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L8 4 L0 8" fill="context-stroke" />
          </marker>
        </defs>
        {data.edges.map((edge) => {
          const from = byId.get(edge.fromNode),
            to = byId.get(edge.toNode);
          if (!from || !to) return null;
          const g = canvasEdgeGeometry(from, to, edge.fromSide, edge.toSide);
          return (
            <g
              key={edge.id}
              style={{ color: canvasColors[edge.color ?? ""] ?? edge.color }}
            >
              <path
                className="canvas-edge-line"
                d={g.d}
                markerEnd={
                  edge.toEnd !== "none" ? `url(#${marker})` : undefined
                }
                markerStart={
                  edge.fromEnd === "arrow" ? `url(#${marker})` : undefined
                }
              />
              <text x={g.label.x} y={g.label.y - 10}>
                {edge.label}
              </text>
            </g>
          );
        })}
      </svg>
      {nodes.map((node) => (
        <article
          key={node.id}
          data-export-node={node.id}
          className={`canvas-card canvas-read-card canvas-${node.type}`}
          style={{
            left: node.x,
            top: node.y,
            width: node.width,
            height: node.height,
            borderColor: canvasColors[node.color ?? ""] ?? node.color,
          }}
        >
          <header className="canvas-card-title">{canvasTitle(node)}</header>
          {node.type !== "group" && (
            <div className="canvas-read-body">
              {node.type === "text" ? (
                <CanvasMarkdownPreview source={node.text} />
              ) : node.type === "file" ? (
                <CanvasResourcePreview
                  node={node}
                  ancestors={ancestors}
                  snapshot={snapshot}
                />
              ) : (
                <div className="canvas-link-summary">
                  <Globe size={24} />
                  <span>{node.url}</span>
                </div>
              )}
            </div>
          )}
        </article>
      ))}
    </>
  );
}
