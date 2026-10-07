"use client";
import { Button, Checkbox, IconButton, NativeSelect } from "../ui/controls";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  FileText,
  Network,
  Plus,
  Minus,
  Maximize,
  Focus,
  RotateCcw,
  SlidersHorizontal,
  List,
  X,
  Download,
  ExternalLink,
} from "lucide-react";
import type {
  GraphNode,
  ReferenceCollection,
  ResearchGraph as GraphData,
} from "@axiom/shared/research-library";
import {
  graphNeighborhood,
  layoutResearchGraph,
  type GraphPoint,
} from "@axiom/shared/research-graph";
import { ErrorNotice, Loading, useData, useWorkspace } from "./ui";
import ResearchSearch, { ResearchFilterInput } from "./ResearchSearch";
import ResizablePanel from "../ResizablePanel";
import type { ResearchPanelProps } from "./ResearchWorkspace";
export default function ResearchGraph({
  space,
  params,
  onRoute,
  active,
}: ResearchPanelProps) {
  const { session, revision, navigate, notify } = useWorkspace();
  const scope = new URLSearchParams({ spaceId: space.id });
  for (const k of ["tag", "collection", "types"])
    if (params.get(k)) scope.set(k, params.get(k)!);
  const visibleRevision = useRef(revision);
  if (active) visibleRevision.current = revision;
  const collections = useData<ReferenceCollection[]>(
    "research/library/collections?spaceId=" + space.id,
    visibleRevision.current,
  );
  const data = useData<GraphData>(
      "research/graph?" + scope,
      visibleRevision.current,
    ),
    nodes = data.data?.nodes ?? [],
    edges = data.data?.edges ?? [];
  const [points, setPoints] = useState<Record<string, GraphPoint>>({}),
    [layoutBusy, setLayoutBusy] = useState(false),
    [layoutEpoch, setLayoutEpoch] = useState(0),
    [list, setList] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [view, setView] = useState({ x: 450, y: 280, zoom: 1 });
  const host = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null),
    board = useRef<HTMLDivElement>(null),
    positions = useRef(points),
    lastScope = useRef(""),
    fitPending = useRef(true);
  positions.current = points;
  const [size, setSize] = useState({ width: 900, height: 600 });
  const drag = useRef<{
      pointer: number;
      target: SVGElement;
      x: number;
      y: number;
      view: typeof view;
      node?: string;
      point?: GraphPoint;
      moved: boolean;
    } | null>(null),
    suppressClick = useRef(false);
  const cancelDrag = (pointer: number) => {
    const d = drag.current;
    if (!d || d.pointer !== pointer) return;
    drag.current = null;
    suppressClick.current = true;
    if (d.target.hasPointerCapture(pointer))
      d.target.releasePointerCapture(pointer);
  };
  const focus = params.get("focus") ?? "",
    search = params.get("q") ?? "",
    hops = Math.max(0, Math.min(2, Number(params.get("hops")) || 0)),
    labels = params.get("labels") !== "off",
    orphan = params.get("orphans") === "only";
  const selected = nodes.find((n) => n.id === focus);
  const linked = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) {
      m.set(e.source, (m.get(e.source) ?? 0) + 1);
      m.set(e.target, (m.get(e.target) ?? 0) + 1);
    }
    return m;
  }, [edges]);
  const neighborhood = useMemo(
    () => (selected && hops ? graphNeighborhood(edges, focus, hops) : null),
    [edges, focus, hops, selected],
  );
  const visible = nodes.filter(
    (n) =>
      (!orphan || !linked.has(n.id)) &&
      (!neighborhood || neighborhood.has(n.id)),
  );
  const ids = new Set(visible.map((n) => n.id)),
    visibleEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const matches = (n: GraphNode) =>
    !search ||
    [n.title, n.detail, ...n.tags]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase());
  const fit = () => {
    const p = visible.map((n) => points[n.id]).filter(Boolean);
    if (!p.length) return;
    const left = Math.min(...p.map((n) => n.x)) - 100,
      top = Math.min(...p.map((n) => n.y)) - 70,
      width = Math.max(...p.map((n) => n.x)) - left + 100,
      height = Math.max(...p.map((n) => n.y)) - top + 70,
      zoom = Math.max(
        0.08,
        Math.min(
          1.3,
          (size.width - 48) / Math.max(width, 1),
          (size.height - 48) / Math.max(height, 1),
        ),
      );
    setView({
      x: size.width / 2 - (left + width / 2) * zoom,
      y: size.height / 2 - (top + height / 2) * zoom,
      zoom,
    });
  };
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth && el.clientHeight)
        setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!active || !data.data) return;
    let cancelled = false;
    setLayoutBusy(true);
    const same = lastScope.current === scope.toString();
    lastScope.current = scope.toString();
    if (!same) {
      positions.current = {};
      fitPending.current = true;
    }
    let worker: Worker | undefined;
    try {
      worker = new Worker(
        new URL("../../lib/research-graph.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (e) => {
        if (!cancelled) {
          setPoints(e.data);
          setLayoutBusy(false);
        }
      };
      worker.onerror = () => {
        if (!cancelled) {
          setPoints(layoutResearchGraph(nodes, edges, positions.current));
          setLayoutBusy(false);
        }
      };
      worker.postMessage([nodes, edges, positions.current]);
    } catch {
      setPoints(layoutResearchGraph(nodes, edges, positions.current));
      setLayoutBusy(false);
    }
    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [data.data, active, layoutEpoch]);
  useEffect(() => {
    if (fitPending.current && Object.keys(points).length && active) {
      fitPending.current = false;
      fit();
    }
  }, [points, size, active]);
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === host.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const zoom = (factor: number, x = size.width / 2, y = size.height / 2) =>
    setView((v) => {
      const next = Math.max(0.08, Math.min(4, v.zoom * factor));
      return {
        x: x - ((x - v.x) * next) / v.zoom,
        y: y - ((y - v.y) * next) / v.zoom,
        zoom: next,
      };
    });
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = element.getBoundingClientRect();
        zoom(
          Math.exp(-e.deltaY * 0.004),
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [list]);
  const download = async (format: "svg" | "png" | "json") => {
    try {
      let blob: Blob;
      if (format === "json")
        blob = new Blob(
          [JSON.stringify({ nodes: visible, edges: visibleEdges }, null, 2)],
          { type: "application/json" },
        );
      else {
        const current = svg.current;
        if (!current) return;
        const clone = current.cloneNode(true) as SVGSVGElement;
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", String(size.width));
        clone.setAttribute("height", String(size.height));
        const originals = [current, ...current.querySelectorAll("*")],
          copies = [clone, ...clone.querySelectorAll("*")];
        originals.forEach((el, i) => {
          const s = getComputedStyle(el);
          for (const k of [
            "fill",
            "stroke",
            "stroke-width",
            "stroke-dasharray",
            "paint-order",
            "opacity",
            "font-family",
            "font-size",
            "font-weight",
          ]) {
            (copies[i] as SVGElement).style.setProperty(
              k,
              s.getPropertyValue(k),
            );
          }
        });
        blob = new Blob([new XMLSerializer().serializeToString(clone)], {
          type: "image/svg+xml",
        });
        if (format === "png") {
          const image = new Image(),
            url = URL.createObjectURL(blob);
          try {
            await new Promise<void>((resolve, reject) => {
              image.onload = () => resolve();
              image.onerror = () =>
                reject(new Error("Image export unavailable."));
              image.src = url;
            });
            const canvas = document.createElement("canvas");
            canvas.width = size.width * 2;
            canvas.height = size.height * 2;
            canvas
              .getContext("2d")!
              .drawImage(image, 0, 0, canvas.width, canvas.height);
            blob = await new Promise<Blob>((resolve, reject) =>
              canvas.toBlob(
                (b) =>
                  b
                    ? resolve(b)
                    : reject(new Error("Image export unavailable.")),
                "image/png",
              ),
            );
          } finally {
            URL.revokeObjectURL(url);
          }
        }
      }
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `research-graph.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <div
      className={`research-graph${fullscreen ? " is-fullscreen" : ""}`}
      ref={host}
    >
      <div className="research-panel-toolbar">
        <ResearchSearch
          value={search}
          onChange={(q) => onRoute({ q })}
          label="Search graph"
          placeholder="Find a note, paper, citation or tag…"
        />
        <Button
          className="button ghost research-filter-toggle"
          aria-expanded={filtersOpen}
          aria-controls="graph-filter-fields"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal size={15} /> Filters
          {(params.get("tag") ||
            params.get("collection") ||
            params.get("types") ||
            orphan ||
            !labels) && (
            <span
              className="research-filter-dot"
              aria-label="Active graph filters"
            />
          )}
        </Button>
        <span className="tool-spacer" />
        <small className="research-source-count">
          {visible.length} sources · {visibleEdges.length} connections
          {layoutBusy ? " · Arranging…" : ""}
        </small>
        <IconButton
          className="icon-button"
          title={list ? "Graph view" : "Accessible list view"}
          aria-label={list ? "Graph view" : "Accessible list view"}
          onClick={() => setList(!list)}
        >
          {list ? <Network size={17} /> : <List size={17} />}
        </IconButton>
      </div>
      <div
        className="research-graph-filters"
        id="graph-filter-fields"
        hidden={!filtersOpen}
      >
        <NativeSelect
          aria-label="Graph node types"
          value={params.get("types") ?? "note,reference,pdf"}
          onChange={(e) => onRoute({ types: e.target.value })}
        >
          <option value="note,reference,pdf">All source types</option>
          <option value="note">Notes</option>
          <option value="reference">References</option>
          <option value="pdf">PDFs</option>
        </NativeSelect>
        <label className="research-inline-check">
          <Checkbox
            checked={labels}
            onChange={(e) => onRoute({ labels: e.target.checked ? "" : "off" })}
          />
          Labels
        </label>
        <label className="research-inline-check">
          <Checkbox
            checked={orphan}
            onChange={(e) =>
              onRoute({ orphans: e.target.checked ? "only" : "" })
            }
          />
          Unconnected
        </label>
        <label>
          Tag{" "}
          <ResearchFilterInput
            label="Filter graph by tag"
            maxLength={80}
            value={params.get("tag") ?? ""}
            onChange={(tag) => onRoute({ tag })}
            placeholder="All tags"
          />
        </label>
        <NativeSelect
          aria-label="Graph collection"
          value={params.get("collection") ?? ""}
          onChange={(e) => onRoute({ collection: e.target.value })}
        >
          <option value="">All collections</option>
          {collections.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <Button
          className="button ghost"
          onClick={() =>
            onRoute({
              types: "",
              tag: "",
              collection: "",
              orphans: "",
              labels: "",
            })
          }
        >
          Reset filters
        </Button>
      </div>
      <ErrorNotice message={data.error} retry={data.reload} />
      {data.loading && !data.data && <Loading label="Loading connections…" />}
      {(data.data?.truncated || data.data?.indexing) && (
        <p className="research-notice" role="status">
          {data.data.truncated
            ? "Showing a bounded graph (up to 1,000 sources / 5,000 connections). Narrow workspace, type, tag or collection to explore more."
            : ""}
          {data.data.indexing
            ? " Existing citations are being indexed; connections will update automatically."
            : ""}
        </p>
      )}
      <div className="research-graph-body">
        <div ref={board} className="research-graph-board">
          {list ? (
            <div className="research-graph-list" aria-label="Graph sources">
              {visible.filter(matches).map((n) => (
                <button
                  key={n.id}
                  aria-pressed={focus === n.id}
                  onClick={() => onRoute({ focus: n.id })}
                >
                  <NodeIcon kind={n.kind} />
                  <span>
                    {n.title}
                    <small>
                      {n.detail || n.kind} · {linked.get(n.id) ?? 0} connections
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            // Use CSS-pixel SVG coordinates: a size-dependent viewBox briefly
            // shifts click targets when the inspector opens before measurement.
            <svg
              ref={svg}
              width="100%"
              height="100%"
              role="img"
              aria-label="Research knowledge graph"
              onPointerDown={(e) => {
                if (e.button !== 0 || !e.isPrimary || drag.current) return;
                e.preventDefault();
                const nodeElement = (e.target as Element).closest<SVGGElement>(
                    "[data-node]",
                  ),
                  node = nodeElement?.getAttribute("data-node") ?? undefined,
                  target = nodeElement ?? e.currentTarget;
                suppressClick.current = false;
                drag.current = {
                  pointer: e.pointerId,
                  target,
                  x: e.clientX,
                  y: e.clientY,
                  view,
                  node,
                  point: node ? points[node] : undefined,
                  moved: false,
                };
                // Capturing every pointer on the SVG retargets node clicks to
                // the canvas. Keep capture on the node; drag events still bubble.
                target.setPointerCapture(e.pointerId);
                nodeElement?.focus({ preventScroll: true });
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.pointer !== e.pointerId) return;
                const dx = e.clientX - d.x,
                  dy = e.clientY - d.y;
                if (!d.moved && Math.hypot(dx, dy) <= 4) return;
                d.moved = true;
                if (d.node && d.point)
                  setPoints((p) => ({
                    ...p,
                    [d.node!]: {
                      x: d.point!.x + dx / d.view.zoom,
                      y: d.point!.y + dy / d.view.zoom,
                    },
                  }));
                else setView({ ...d.view, x: d.view.x + dx, y: d.view.y + dy });
              }}
              onPointerUp={(e) => {
                const d = drag.current;
                if (!d || d.pointer !== e.pointerId) return;
                drag.current = null;
                suppressClick.current = d.moved;
                if (d.target.hasPointerCapture(e.pointerId))
                  d.target.releasePointerCapture(e.pointerId);
                if (!d.node && !d.moved) onRoute({ focus: "", hops: "" });
              }}
              onPointerCancel={(e) => cancelDrag(e.pointerId)}
              onLostPointerCapture={(e) => cancelDrag(e.pointerId)}
            >
              <rect
                width={size.width}
                height={size.height}
                className="research-graph-background"
              />
              <g
                transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}
              >
                {visibleEdges.map((e) => {
                  const a = points[e.source],
                    b = points[e.target];
                  return a && b ? (
                    <line
                      key={e.id}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className={`research-edge edge-${e.kind}${focus && e.source !== focus && e.target !== focus ? " dim" : ""}`}
                    >
                      <title>{e.kind}</title>
                    </line>
                  ) : null;
                })}
                {visible.map((n) => {
                  const p = points[n.id];
                  if (!p) return null;
                  const current = n.id === focus;
                  return (
                    <g
                      key={n.id}
                      data-node={n.id}
                      transform={`translate(${p.x} ${p.y})`}
                      className={`research-node kind-${n.kind}${current ? " selected" : ""}${!matches(n) ? " dim" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Inspect ${n.title}`}
                      aria-pressed={current}
                      onClick={() => {
                        if (!suppressClick.current) onRoute({ focus: n.id });
                      }}
                      onDoubleClick={() => {
                        if (!suppressClick.current) navigate(n.route);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRoute({ focus: n.id });
                        }
                        if (e.key === "Escape")
                          onRoute({ focus: "", hops: "" });
                      }}
                    >
                      <circle r={17} className="research-node-halo" />
                      {n.kind === "note" ? (
                        <circle r={7} />
                      ) : n.kind === "reference" ? (
                        <rect x={-7} y={-7} width={14} height={14} rx={3} />
                      ) : (
                        <path d="M0-9 9 7H-9Z" />
                      )}
                      {((labels && visible.length <= 180) ||
                        current ||
                        (search && matches(n))) && (
                        <text textAnchor="middle" y={31}>
                          {n.title.length > 32
                            ? n.title.slice(0, 31) + "…"
                            : n.title}
                        </text>
                      )}
                      <title>{n.title}</title>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
          {!data.loading && !visible.length && (
            <div className="research-graph-empty">
              <Network size={30} />
              <h3>No connections to show yet</h3>
              <p>
                Add references, link PDFs, or cite a source in a Markdown note.
              </p>
              <Button
                className="button secondary"
                onClick={() =>
                  navigate(`/workspaces/${space.id}/research?view=library`)
                }
              >
                Open library
              </Button>
            </div>
          )}
          <div className="research-graph-controls">
            <IconButton
              className="icon-button"
              aria-label="Zoom out"
              title="Zoom out"
              onClick={() => zoom(1 / 1.2)}
            >
              <Minus size={16} />
            </IconButton>
            <span>{Math.round(view.zoom * 100)}%</span>
            <IconButton
              className="icon-button"
              aria-label="Zoom in"
              title="Zoom in"
              onClick={() => zoom(1.2)}
            >
              <Plus size={16} />
            </IconButton>
            <IconButton
              className="icon-button"
              aria-label="Fit graph"
              title="Fit graph"
              onClick={fit}
            >
              <Focus size={16} />
            </IconButton>
            <IconButton
              className="icon-button"
              aria-label="Reset graph layout"
              title="Reset layout"
              onClick={() => {
                positions.current = {};
                fitPending.current = true;
                setLayoutEpoch((n) => n + 1);
              }}
            >
              <RotateCcw size={16} />
            </IconButton>
            <IconButton
              className="icon-button"
              aria-label="Fullscreen graph"
              title="Fullscreen"
              onClick={() => {
                const operation = document.fullscreenElement
                  ? document.exitFullscreen?.()
                  : host.current?.requestFullscreen?.();
                if (!operation)
                  notify("Fullscreen is unavailable in this browser.");
                void operation?.catch(() =>
                  notify("Fullscreen is unavailable in this browser."),
                );
              }}
            >
              <Maximize size={16} />
            </IconButton>
          </div>
        </div>
        {selected && (
          <ResizablePanel
            account={session.user.id}
            name="research-details"
            edge="left"
            className="research-inspector"
            label="Graph details"
          >
            <header>
              <span className="docs-eyebrow">{selected.kind}</span>
              <IconButton
                className="icon-button"
                aria-label="Close graph details"
                onClick={() => onRoute({ focus: "", hops: "" })}
              >
                <X size={16} />
              </IconButton>
            </header>
            <h2>{selected.title}</h2>
            <p>{selected.detail}</p>
            <div className="research-tags">
              {selected.tags.map((t) => (
                <button key={t} onClick={() => onRoute({ tag: t })}>
                  {t}
                </button>
              ))}
            </div>
            <Button
              className="button primary"
              onClick={() => navigate(selected.route)}
            >
              <ExternalLink size={15} />
              Open source
            </Button>
            <label>
              Neighborhood
              <NativeSelect
                aria-label="Graph neighborhood"
                value={hops}
                onChange={(e) => onRoute({ hops: e.target.value })}
              >
                <option value="0">Entire graph</option>
                <option value="1">One connection away</option>
                <option value="2">Two connections away</option>
              </NativeSelect>
            </label>
            <h3>Connections</h3>
            <div className="research-connections">
              {edges
                .filter((e) => e.source === focus || e.target === focus)
                .map((e) => {
                  const n = nodes.find(
                    (n) => n.id === (e.source === focus ? e.target : e.source),
                  );
                  return n ? (
                    <button key={e.id} onClick={() => onRoute({ focus: n.id })}>
                      <NodeIcon kind={n.kind} />
                      <span>
                        {n.title}
                        <small>
                          {e.source === focus ? "Outgoing" : "Incoming"} ·{" "}
                          {e.kind}
                        </small>
                      </span>
                    </button>
                  ) : null;
                })}
              {!linked.get(focus) && (
                <p className="muted">No connections in this view.</p>
              )}
            </div>
          </ResizablePanel>
        )}
      </div>
      <footer className="research-graph-footer">
        <span>
          <i className="graph-key note" />
          Notes
        </span>
        <span>
          <i className="graph-key reference" />
          References
        </span>
        <span>
          <i className="graph-key pdf" />
          PDFs
        </span>
        <span className="tool-spacer" />
        <span className="muted">Drag to pan · ⌘/Ctrl + scroll to zoom</span>
        <details className="research-export-menu">
          <summary className="button ghost">
            <Download size={14} />
            Export
          </summary>
          <div>
            {(["svg", "png", "json"] as const).map((f) => (
              <Button
                key={f}
                className="button ghost"
                onClick={() => void download(f)}
              >
                {f.toUpperCase()}
              </Button>
            ))}
          </div>
        </details>
      </footer>
    </div>
  );
}
function NodeIcon({ kind }: { kind: GraphNode["kind"] }) {
  return kind === "reference" ? (
    <BookOpen size={16} />
  ) : kind === "pdf" ? (
    <FileText size={16} />
  ) : (
    <Network size={16} />
  );
}
