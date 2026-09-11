"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, Download, Package } from "lucide-react";
import { exportJsonCanvas, type CanvasData } from "@axiom/shared/canvas";
import {
  canvasExportBounds,
  canvasExportLimits,
  canvasMarkdown,
  validateCanvasImageSize,
} from "@axiom/shared/canvas-export";
import {
  intersectsCanvas,
  type CanvasRect,
} from "@axiom/shared/canvas-geometry";
import { selectedCanvas } from "../../lib/tools/canvas-clipboard";
import {
  captureCanvasSvg,
  canvasPdf,
  resolveCanvasExport,
} from "../../lib/tools/canvas-export";
import {
  downloadBlob,
  downloadText,
  rasterizeSvg,
} from "../../lib/tools/download";
import { post } from "../../lib/client";
import Dialog from "../Dialog";
import { ErrorNotice, useData } from "../workspace/ui";
import { CanvasReadScene, type CanvasPreviewSnapshot } from "./CanvasPreviews";

export default function CanvasExportDialog({
  source,
  selection,
  viewport,
  resourceId,
  spaceId,
  name,
  onClose,
}: {
  source: CanvasData;
  selection: string[];
  viewport: CanvasRect;
  resourceId: string;
  spaceId: string;
  name: string;
  onClose: () => void;
}) {
  const [snapshot] = useState(() => structuredClone(source)),
    [ids] = useState(selection),
    [area] = useState(viewport);
  const [scope, setScope] = useState(ids.length ? "selection" : "all"),
    [format, setFormat] = useState("png"),
    [scale, setScale] = useState(2),
    [padding, setPadding] = useState(32),
    [background, setBackground] = useState("theme"),
    [grid, setGrid] = useState(false),
    [tiled, setTiled] = useState(false);
  const [error, setError] = useState(""),
    [progress, setProgress] = useState(""),
    [warnings, setWarnings] = useState<string[]>([]),
    [stageData, setStageData] = useState<{
      data: CanvasData;
      previews: CanvasPreviewSnapshot;
    } | null>(null),
    [job, setJob] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null),
    stage = useRef<HTMLDivElement>(null);
  const jobs = useData<{ id: string; status: string; error?: string }[]>(
      job ? "exports" : null,
    ),
    currentJob = jobs.data?.find((j) => j.id === job);
  useEffect(() => {
    if (!job || ["ready", "failed"].includes(currentJob?.status ?? "")) return;
    const timer = setInterval(jobs.reload, 1800);
    return () => clearInterval(timer);
  }, [job, currentJob?.status, jobs.reload]);
  useEffect(() => () => controller.current?.abort(), []);
  const data =
    scope === "all"
      ? snapshot
      : selectedCanvas(
          snapshot,
          scope === "selection"
            ? ids
            : snapshot.nodes
                .filter((n) => intersectsCanvas(n, area))
                .map((n) => n.id),
        );
  const bounds = canvasExportBounds(
      data,
      padding,
      scope === "viewport" ? area : undefined,
    ),
    visual = ["svg", "png", "jpeg", "pdf"].includes(format),
    busy = !!progress;
  const run = async (copy = false) => {
    if (busy) return;
    setError("");
    setWarnings([]);
    setJob(null);
    const abort = new AbortController();
    controller.current = abort;
    const base = name.replace(/\.canvas$/i, "");
    try {
      if (format === "canvas") {
        downloadText(
          exportJsonCanvas(data),
          `${base}.canvas`,
          "application/json",
        );
        return;
      }
      if (format === "markdown") {
        downloadText(canvasMarkdown(data), `${base}.md`);
        return;
      }
      if (format === "zip") {
        setProgress("Queueing portable bundle…");
        const job = await post("exports", {
          mutationId: crypto.randomUUID(),
          spaceId,
          resourceIds: [resourceId],
          canvasSnapshot: data,
        });
        setJob(job.id);
        return;
      }
      if (data.nodes.length > canvasExportLimits.cards)
        throw new Error(
          "Select at most 120 cards for a visual export. Portable bundles can include the full canvas.",
        );
      if (format !== "pdf" || !tiled) validateCanvasImageSize(bounds, scale);
      setProgress("Checking linked-resource access…");
      // Start clipboard.write during the click for Safari's user-activation rules.
      let resolveCopy: ((value: Blob) => void) | undefined,
        rejectCopy: ((reason: unknown) => void) | undefined;
      const clipboard = copy
        ? (() => {
            if (!navigator.clipboard?.write || !globalThis.ClipboardItem)
              throw new Error(
                "Image copy is unavailable here. Download PNG instead.",
              );
            const promised = new Promise<Blob>((resolve, reject) => {
              resolveCopy = resolve;
              rejectCopy = reject;
            });
            const result = navigator.clipboard.write([
              new ClipboardItem({ "image/png": promised }),
            ]);
            void result.catch(() => {});
            return result;
          })()
        : null;
      try {
        const prepared = await resolveCanvasExport(
          data,
          resourceId,
          abort.signal,
          setProgress,
        );
        abort.signal.throwIfAborted();
        setStageData({ data, previews: prepared.previews });
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        abort.signal.throwIfAborted();
        if (!stage.current) throw new Error("Export preview could not mount.");
        const computed = getComputedStyle(stage.current),
          color = (key: string, fallback: string) =>
            computed.getPropertyValue(key).trim() || fallback;
        const colors = {
          background:
            background === "transparent"
              ? undefined
              : background === "white"
                ? "#ffffff"
                : color("--bg", "#ffffff"),
          surface: color("--surface", "#ffffff"),
          border: color("--border", "#dddddd"),
          text: color("--text", "#222222"),
          muted: color("--muted", "#777777"),
        };
        const rendered = await captureCanvasSvg(
          stage.current,
          data,
          bounds,
          colors,
          scale,
          grid,
          abort.signal,
          setProgress,
        );
        setWarnings([...prepared.omissions, ...rendered.omissions]);
        if (copy) {
          const blob = await rasterizeSvg(
            rendered.svg,
            scale,
            colors.background,
          );
          abort.signal.throwIfAborted();
          resolveCopy!(blob);
          await clipboard;
          setWarnings((w) => [...w, "PNG copied to clipboard."]);
        } else {
          const blob =
            format === "svg"
              ? new Blob([rendered.svg], { type: "image/svg+xml" })
              : format === "pdf"
                ? await canvasPdf(
                    rendered.svg,
                    bounds,
                    scale,
                    tiled,
                    abort.signal,
                    setProgress,
                  )
                : await rasterizeSvg(
                    rendered.svg,
                    scale,
                    format === "jpeg"
                      ? (colors.background ?? "#ffffff")
                      : colors.background,
                    format === "jpeg" ? "image/jpeg" : "image/png",
                  );
          abort.signal.throwIfAborted();
          downloadBlob(blob, `${base}.${format === "jpeg" ? "jpg" : format}`);
        }
      } catch (error) {
        rejectCopy?.(error);
        throw error;
      }
    } catch (error) {
      if (!abort.signal.aborted)
        setError((error as Error).message || "Export failed.");
    } finally {
      setProgress("");
      setStageData(null);
      controller.current = null;
    }
  };
  return (
    <Dialog
      title="Export canvas"
      subtitle="An immutable snapshot—collaborators can keep working."
      onClose={() => {
        controller.current?.abort();
        onClose();
      }}
    >
      <fieldset className="canvas-export-fields" disabled={busy}>
        <label>
          Format
          <select
            aria-label="Export format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="png">PNG image</option>
            <option value="jpeg">JPG image</option>
            <option value="svg">SVG · vector connections, raster cards</option>
            <option value="pdf">PDF</option>
            <option value="canvas">JSON Canvas</option>
            <option value="markdown">Markdown outline</option>
            <option value="zip">Portable ZIP bundle</option>
          </select>
        </label>
        <label>
          Area
          <select
            aria-label="Export area"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="all">Whole canvas</option>
            <option value="selection" disabled={!ids.length}>
              Selected cards
            </option>
            <option value="viewport">Current viewport</option>
          </select>
        </label>
        {visual && (
          <>
            <div className="canvas-property-pair">
              <label>
                Resolution
                <select
                  aria-label="Export resolution"
                  value={scale}
                  onChange={(e) => setScale(Number(e.target.value))}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}×
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Padding
                <input
                  aria-label="Export padding"
                  type="number"
                  min={0}
                  max={200}
                  value={padding}
                  onChange={(e) =>
                    setPadding(
                      Math.min(200, Math.max(0, Number(e.target.value))),
                    )
                  }
                />
              </label>
            </div>
            <label>
              Background
              <select
                aria-label="Export background"
                value={background}
                onChange={(e) => setBackground(e.target.value)}
              >
                <option value="theme">Current theme</option>
                <option value="white">White</option>
                <option
                  value="transparent"
                  disabled={format === "jpeg" || format === "pdf"}
                >
                  Transparent
                </option>
              </select>
            </label>
            <label className="canvas-property-toggle">
              <input
                type="checkbox"
                checked={grid}
                onChange={(e) => setGrid(e.target.checked)}
              />
              Include grid
            </label>
            {format === "pdf" && (
              <label className="canvas-property-toggle">
                <input
                  type="checkbox"
                  checked={tiled}
                  onChange={(e) => setTiled(e.target.checked)}
                />
                Tile across landscape A4 pages
              </label>
            )}
          </>
        )}
      </fieldset>
      <p className="ws-note">
        {data.nodes.length} cards ·{" "}
        {visual
          ? `${Math.round(bounds.width * scale)} × ${Math.round(bounds.height * scale)} px. Webpages and media export as static cards. SVG keeps connection geometry, not editable rich text.`
          : format === "zip"
            ? "Includes a lossless canvas snapshot, portable .canvas, readable sources, accessible linked assets, and a checksummed manifest. Latest dependencies are captured when the job runs."
            : "Source-only export. Linked assets are not embedded; choose ZIP to include them."}
      </p>
      <ErrorNotice message={error || jobs.error || currentJob?.error} />
      {warnings.length > 0 && (
        <details className="canvas-export-warnings" open>
          <summary>Export notes ({warnings.length})</summary>
          <ul>
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      {job && (
        <p role="status">
          {currentJob?.status === "ready" ? (
            <a
              className="button secondary"
              href={`/api/v1/exports/${job}/download`}
            >
              <Package size={15} />
              Download portable bundle
            </a>
          ) : currentJob?.status === "failed" ? (
            "Bundle failed. Correct the problem and try again."
          ) : (
            "Preparing your bundle in the background. It is also available in Downloads / exports."
          )}
        </p>
      )}
      <div className="dialog-actions">
        {busy ? (
          <>
            <span role="status">{progress}</span>
            <button
              className="button secondary"
              onClick={() => controller.current?.abort()}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {visual && (
              <button
                className="button secondary"
                onClick={() => void run(true)}
              >
                <Copy size={15} />
                Copy PNG
              </button>
            )}
            <button className="button primary" onClick={() => void run()}>
              <Download size={15} />
              {format === "zip" ? "Prepare bundle" : "Export"}
            </button>
          </>
        )}
      </div>
      {stageData && (
        <div
          className="canvas-export-stage"
          ref={stage}
          aria-hidden="true"
          inert
        >
          <CanvasReadScene
            data={stageData.data}
            ancestors={[resourceId]}
            snapshot={stageData.previews}
          />
        </div>
      )}
    </Dialog>
  );
}
