import { useEffect, useRef, useState } from "react";
import { Download, Package, Copy } from "lucide-react";
import {
  exportJsonCanvas,
  parseCanvas,
  type CanvasData,
} from "@axiom/shared/canvas";
import {
  canvasExportBounds,
  canvasMarkdown,
  validateCanvasImageSize,
} from "@axiom/shared/canvas-export";
import type { CanvasRect } from "@axiom/shared/canvas-geometry";
import { intersectsCanvas } from "@axiom/shared/canvas-geometry";
import { selectedCanvas } from "../../web/lib/tools/canvas-clipboard";
import { captureCanvasSvg, canvasPdf } from "../../web/lib/tools/canvas-export";
import {
  CanvasReadScene,
  type CanvasPreviewSnapshot,
} from "../../web/components/tools/CanvasPreviews";
import {
  downloadBlob,
  downloadText,
  rasterizeSvg,
} from "../../web/lib/tools/download";
import Dialog, { DialogFooter } from "../../web/components/Dialog";
import { store, useDemo } from "./context";
import { portableBundle, portableCanvas } from "./exports";
import { safeName } from "./store";

export default function CanvasExport({
  source,
  selection,
  viewport,
  name,
  onClose,
}: {
  source: CanvasData;
  selection: string[];
  viewport: CanvasRect;
  name: string;
  onClose: () => void;
}) {
  const [snapshot] = useState(() => structuredClone(source)),
    [ids] = useState(selection),
    [area] = useState(viewport);
  const [scope, setScope] = useState(selection.length ? "selection" : "all"),
    [format, setFormat] = useState("canvas"),
    [scale, setScale] = useState(2),
    [background, setBackground] = useState("theme"),
    [grid, setGrid] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [warnings, setWarnings] = useState<string[]>([]),
    [scene, setScene] = useState<{
      data: CanvasData;
      previews: CanvasPreviewSnapshot;
    } | null>(null);
  const stage = useRef<HTMLDivElement>(null),
    controller = useRef<AbortController | null>(null),
    { notify } = useDemo();
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
  const visual = ["svg", "png", "jpeg", "pdf"].includes(format),
    busy = !!progress;
  const run = async (copy = false) => {
    if (busy) return;
    setError("");
    setWarnings([]);
    const abort = new AbortController();
    controller.current = abort;
    const base = safeName(name.replace(/\.canvas$/i, ""));
    try {
      if (format === "canvas") {
        downloadText(
          exportJsonCanvas(portableCanvas(data)),
          `${base}.canvas`,
          "application/json",
        );
        return;
      }
      if (format === "markdown") {
        downloadText(
          canvasMarkdown(portableCanvas(data)),
          `${base}.md`,
          "text/markdown",
        );
        return;
      }
      if (format === "zip") {
        setProgress("Packing local notes and uploads…");
        downloadBlob(
          await portableBundle(data, `${base}.canvas`),
          `${base}.zip`,
        );
        notify("Portable Canvas bundle downloaded.");
        return;
      }
      const bounds = canvasExportBounds(
        data,
        32,
        scope === "viewport" ? area : undefined,
      );
      validateCanvasImageSize(bounds, scale);
      setProgress("Preparing linked previews…");
      const previews: CanvasPreviewSnapshot = new Map(),
        queue = data.nodes
          .filter((n) => n.type === "file")
          .map((n) => ({ n, depth: 0 })),
        omissions: string[] = [];
      for (let index = 0; index < Math.min(120, queue.length); index++) {
        const { n, depth } = queue[index];
        if (!n.resourceId) {
          omissions.push(`${n.file}: import this file to include its preview.`);
          continue;
        }
        const key = `${n.resourceId}:${n.versionId ?? "latest"}`;
        if (previews.has(key)) continue;
        try {
          const preview = await store.preview(n.resourceId);
          previews.set(key, preview);
          if (
            preview.kind === "document" &&
            preview.format === "canvas" &&
            depth < 2
          )
            queue.push(
              ...parseCanvas(preview.source)
                .nodes.filter((child) => child.type === "file")
                .map((child) => ({ n: child, depth: depth + 1 })),
            );
        } catch {
          omissions.push(`${n.file}: local file missing.`);
        }
        abort.signal.throwIfAborted();
      }
      setScene({ data, previews });
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
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
              : color("--paper", "#ffffff"),
        surface: color("--surface", "#ffffff"),
        border: color("--line", "#dddddd"),
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
      setWarnings([...omissions, ...rendered.omissions]);
      if (copy) {
        const blob = await rasterizeSvg(rendered.svg, scale, colors.background);
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        notify("Canvas image copied.");
      } else {
        const blob =
          format === "svg"
            ? new Blob([rendered.svg], { type: "image/svg+xml" })
            : format === "pdf"
              ? await canvasPdf(
                  rendered.svg,
                  bounds,
                  scale,
                  false,
                  abort.signal,
                  setProgress,
                )
              : await rasterizeSvg(
                  rendered.svg,
                  scale,
                  colors.background,
                  format === "jpeg" ? "image/jpeg" : "image/png",
                );
        downloadBlob(blob, `${base}.${format === "jpeg" ? "jpg" : format}`);
        notify("Canvas export downloaded.");
      }
    } catch (error) {
      if (!abort.signal.aborted) setError((error as Error).message);
    } finally {
      setProgress("");
      setScene(null);
      window.dispatchEvent(new Event("afterprint"));
    }
  };
  return (
    <Dialog
      title="Export this canvas"
      subtitle="Editable source, a portable bundle, or an image of your ideas."
      onClose={() => {
        controller.current?.abort();
        onClose();
      }}
    >
      <div className="canvas-export-fields">
        <label>
          Format
          <select
            aria-label="Canvas export format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="canvas">JSON Canvas · editable</option>
            <option value="markdown">Markdown · card contents</option>
            <option value="zip">Portable ZIP · Canvas, notes & uploads</option>
            <option value="svg">
              SVG · scalable connections, rendered cards
            </option>
            <option value="png">PNG image</option>
            <option value="jpeg">JPEG image</option>
            <option value="pdf">PDF document</option>
          </select>
        </label>
        <label>
          Include
          <select
            aria-label="Canvas export scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="all">Entire canvas</option>
            <option value="selection" disabled={!ids.length}>
              Selected cards
            </option>
            <option value="viewport">Current view</option>
          </select>
        </label>
        {visual && (
          <>
            <label>
              Resolution
              <select
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
              Background
              <select
                value={background}
                onChange={(e) => setBackground(e.target.value)}
              >
                <option value="theme">Current theme</option>
                <option value="white">White paper</option>
                <option value="transparent">Transparent</option>
              </select>
            </label>
            <label className="demo-toggle">
              <input
                type="checkbox"
                checked={grid}
                onChange={(e) => setGrid(e.target.checked)}
              />
              Include dot grid
            </label>
          </>
        )}
      </div>
      {format === "zip" && (
        <p className="demo-fineprint">
          <Package size={15} />
          Bundles include all local notes and uploads so links stay portable.
          Keep the folder structure together.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="canvas-export-warnings">
          {warnings.map((message, i) => (
            <li key={i}>{message}</li>
          ))}
        </ul>
      )}
      {scene && (
        <div className="canvas-export-stage" ref={stage} aria-hidden="true">
          <CanvasReadScene data={scene.data} snapshot={scene.previews} />
        </div>
      )}
      <DialogFooter>
        <span role="status">
          {progress || "Exports do not change your working canvas."}
        </span>
        {format === "png" && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void run(true)}
          >
            <Copy size={15} />
            Copy
          </button>
        )}
        <button className="button" disabled={busy} onClick={() => void run()}>
          <Download size={15} />
          {busy ? "Preparing…" : "Export"}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
