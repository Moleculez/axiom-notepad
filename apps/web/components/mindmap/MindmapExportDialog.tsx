"use client";
import { useEffect, useRef, useState } from "react";
import {
  parseMarkdown,
  renderDocument,
  type RenderContext,
} from "@axiom/markdown";
import {
  layoutMindmap,
  type MindmapProjection,
  type MindmapSettings,
} from "@axiom/mindmap";
import {
  mindmapBranch,
  mindmapMarkdown,
  mindmapSvg,
  mindmapHtml,
  mindmapExportLimits,
} from "@axiom/mindmap/export";
import type { NativeBinding } from "@axiom/editor/binding";
import Dialog, { DialogFooter } from "../Dialog";
import {
  Button,
  Checkbox,
  Field,
  NativeSelect,
  HelpText,
  Notice,
} from "../ui/controls";
import {
  downloadBlob,
  downloadText,
  rasterizeSvg,
} from "../../lib/tools/download";
import { waitForMindmapMath } from "../../lib/tools/mindmap-export";
import { estimateMindmapLabel } from "@axiom/mindmap/layout";
import { mindmapRichLabel } from "@axiom/mindmap/label";

export default function MindmapExportDialog({
  binding,
  source,
  title,
  projection,
  settings,
  selected,
  context,
  beforeExport,
  onClose,
}: {
  binding: NativeBinding;
  source: string;
  title: string;
  projection: MindmapProjection;
  settings: MindmapSettings;
  selected?: string;
  context: RenderContext;
  beforeExport?: () => Promise<void>;
  onClose: () => void;
}) {
  const [format, setFormat] = useState("svg"),
    [scope, setScope] = useState("whole"),
    [rich, setRich] = useState(true),
    [scale, setScale] = useState(1),
    [tiled, setTiled] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null),
    stage = useRef<HTMLDivElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const exportFile = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setProgress("Preparing a private-free snapshot…");
    try {
      await beforeExport?.();
      controller.signal.throwIfAborted();
      if (binding.source !== source)
        throw new Error(
          "The document changed after opening Export. Close and reopen to capture the latest version.",
        );
      const id = scope === "selected" ? selected : undefined,
        tree = mindmapBranch(projection, id),
        name =
          title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_") +
          (id && id !== projection.rootId ? "-branch" : "");
      if (format === "markdown") {
        downloadText(
          mindmapMarkdown(source, projection, id),
          name + ".md",
          "text/markdown;charset=utf-8",
        );
        return;
      }
      const root = stage.current!;
      root.replaceChildren();
      const styles = getComputedStyle(root),
        font = styles.fontFamily,
        fontSize = parseFloat(styles.fontSize) || 16;
      // Resolve CSS variables/color-mix before serializing an offline SVG.
      const color = (property: string, fallback: string) => {
        const sample = document.createElement("span");
        sample.style.color = `var(${property}, ${fallback})`;
        root.append(sample);
        const resolved = getComputedStyle(sample).color;
        sample.remove();
        return resolved;
      };
      const text = color("--text", "#202124"),
        accent = color("--accent", "#476b83"),
        background = color("--paper", "#ffffff");
      const sizes: Record<string, { width: number; height: number }> = {},
        images = new Map<string, string>();
      if (!rich)
        for (const node of tree.nodes)
          sizes[node.id] = estimateMindmapLabel(
            node.label,
            settings.nodeWidth,
            fontSize,
          );
      if (rich) {
        if (tree.nodes.length > mindmapExportLimits.richNodes)
          throw new Error(
            "Rich visual capture supports 120 nodes. Export a selected branch or disable rich labels for a vector overview; Markdown always includes the complete source.",
          );
        const { toPng, getFontEmbedCSS } = await import("html-to-image");
        let capturedPixels = 0,
          fontCss: string | undefined;
        for (let i = 0; i < tree.nodes.length; i++) {
          controller.signal.throwIfAborted();
          const node = tree.nodes[i],
            element = document.createElement("div");
          element.className = "mindmap-export-label mindmap-label";
          element.style.width = settings.nodeWidth + "px";
          const value = mindmapRichLabel(source, node);
          if (value)
            element.innerHTML = renderDocument(parseMarkdown(value), {
              ...context,
              fragment: true,
              disableImages: true,
              visuals: false,
              blockMarks: false,
            });
          else element.textContent = node.label;
          // Private application URLs never leave the workbench. Captures are inert pixels.
          element.querySelectorAll("a").forEach((a) => {
            a.removeAttribute("href");
          });
          root.append(element);
          await document.fonts.ready;
          setProgress(
            `Rendering equation / rich label ${i + 1} of ${tree.nodes.length}`,
          );
          await waitForMindmapMath(element, controller.signal);
          const box = element.getBoundingClientRect();
          capturedPixels += box.width * box.height * scale * scale;
          if (capturedPixels > 64_000_000)
            throw new Error(
              "Rich labels exceed the safe 64-megapixel capture budget. Choose a branch or lower the resolution.",
            );
          sizes[node.id] = {
            width: Math.ceil(box.width),
            height: Math.ceil(box.height),
          };
          fontCss ??= await getFontEmbedCSS(element);
          images.set(
            node.id,
            await toPng(element, {
              pixelRatio: scale,
              fontEmbedCSS: fontCss,
              backgroundColor: background,
              cacheBust: false,
            }),
          );
          element.remove();
          setProgress(`Capturing rich label ${i + 1} of ${tree.nodes.length}`);
        }
      }
      const layout = layoutMindmap(tree, settings, [], sizes),
        svg = mindmapSvg(
          tree,
          layout,
          { background, text, accent, font, fontSize },
          images,
        );
      controller.signal.throwIfAborted();
      // Reauthorize after long captures too; exports never imply permission.
      await beforeExport?.();
      controller.signal.throwIfAborted();
      if (format === "svg") downloadText(svg, name + ".svg", "image/svg+xml");
      if (format === "html")
        downloadText(
          mindmapHtml(svg, title),
          name + ".html",
          "text/html;charset=utf-8",
        );
      if (format === "png") {
        const blob = await rasterizeSvg(svg, scale, background);
        controller.signal.throwIfAborted();
        await beforeExport?.();
        controller.signal.throwIfAborted();
        downloadBlob(blob, name + ".png");
      }
      if (format === "pdf") {
        const { canvasPdf } = await import("../../lib/tools/canvas-export");
        const blob = await canvasPdf(
          svg,
          layout.bounds,
          scale,
          tiled,
          controller.signal,
          setProgress,
        );
        controller.signal.throwIfAborted();
        await beforeExport?.();
        controller.signal.throwIfAborted();
        downloadBlob(blob, name + ".pdf");
      }
      setProgress(
        "Export downloaded. Rich labels are embedded images; connections remain vector paths.",
      );
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      stage.current?.replaceChildren();
      if (abort.current === controller) {
        setBusy(false);
        abort.current = null;
      }
    }
  };
  return (
    <Dialog
      title="Export mind map"
      subtitle="Includes document content only, never presence, private comments, or reading records."
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
    >
      <div className="mindmap-options">
        <Field label="Format">
          <NativeSelect
            value={format}
            disabled={busy}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="markdown">Markdown source</option>
            <option value="svg">SVG image</option>
            <option value="png">PNG image</option>
            <option value="pdf">PDF</option>
            <option value="html">Interactive offline HTML</option>
          </NativeSelect>
        </Field>
        <Field label="Scope">
          <NativeSelect
            value={scope}
            disabled={busy}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="whole">Entire map · all branches</option>
            <option
              value="selected"
              disabled={!selected || selected === projection.rootId}
            >
              Selected branch
            </option>
          </NativeSelect>
        </Field>
        {format !== "markdown" && (
          <>
            <Field label="Resolution">
              <NativeSelect
                value={scale}
                disabled={busy}
                onChange={(e) => setScale(Number(e.target.value))}
              >
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={3}>3×</option>
              </NativeSelect>
            </Field>
            <label className="ui-choice">
              <Checkbox
                checked={rich}
                disabled={busy}
                onChange={(e) => setRich(e.target.checked)}
              />
              <span>Preserve rich labels and equations</span>
            </label>
          </>
        )}
        {format === "pdf" && (
          <label className="ui-choice">
            <Checkbox
              checked={tiled}
              disabled={busy}
              onChange={(e) => setTiled(e.target.checked)}
            />
            <span>Tile across pages at readable size</span>
          </label>
        )}
      </div>
      <HelpText>
        Rich exports embed rendered labels as images. Block summaries are
        exported; images and attachments are not fetched. Use the existing
        portable collection export to include source and permission-checked
        files. Plain vector labels use the viewer's fonts.
      </HelpText>
      {progress && (
        <p role="status" className="muted">
          {progress}
        </p>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <div ref={stage} className="mindmap-export-stage" aria-hidden="true" />
      <DialogFooter>
        <Button
          onClick={() => {
            abort.current?.abort();
            onClose();
          }}
        >
          {busy ? "Cancel export" : "Close"}
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void exportFile()}
        >
          {busy ? "Exporting…" : "Download"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
