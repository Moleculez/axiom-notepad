"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { useEffect, useRef, useState } from "react";
import { parseMarkdown, type RenderContext } from "@axiom/markdown";
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
import { waitForMindmapPreviews } from "../../lib/tools/mindmap-export";
import {
  estimateMindmapLabel,
  mindmapBranchColor,
} from "@axiom/mindmap/layout";
import { renderMindmapPreview } from "./MindmapPreview";

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
  research = true,
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
  research?: boolean;
}) {
  useInterfaceLocale();
  const [format, setFormat] = useState("svg"),
    [scope, setScope] = useState("whole"),
    [rich, setRich] = useState(research),
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
      const color = (expression: string) => {
        const sample = document.createElement("span");
        sample.style.color = expression;
        root.append(sample);
        const resolved = getComputedStyle(sample).color;
        sample.remove();
        return resolved;
      };
      const text = color("var(--text, #202124)"),
        accent = color("var(--accent, #476b83)"),
        surface = color("var(--paper, #ffffff)"),
        background = color(
          "color-mix(in srgb, var(--paper, #ffffff) 97%, var(--bg, #ffffff))",
        ),
        border = color("var(--line, #888888)"),
        rootBorder = color(
          "color-mix(in srgb, var(--accent, #476b83) 40%, var(--line, #888888))",
        ),
        branchColors = Array.from({ length: 5 }, (_, index) =>
          color(mindmapBranchColor(index, settings.colors)),
        );
      // Measure derived geometry instead of parsing calc()/custom-property text.
      const specimen = document.createElement("div");
      specimen.className = "mindmap-label";
      root.append(specimen);
      const nodeStyles = getComputedStyle(specimen),
        radius = parseFloat(nodeStyles.borderTopLeftRadius) || 0,
        textWeight = parseFloat(nodeStyles.fontWeight) || 400,
        headingWeight =
          parseFloat(styles.getPropertyValue("--weight-heading")) || 600;
      specimen.remove();
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
        // All label fragments resolve against this frozen complete document,
        // including definitions outside a selected branch.
        const snapshotContext = { ...context, document: parseMarkdown(source) };
        let capturedPixels = 0,
          fontCss: string | undefined;
        for (let i = 0; i < tree.nodes.length; i++) {
          controller.signal.throwIfAborted();
          const node = tree.nodes[i],
            element = document.createElement("div");
          element.className = "mindmap-export-label mindmap-label";
          element.dataset.kind = node.kind;
          element.style.setProperty("--branch-color", branchColors[0]);
          element.style.width = settings.nodeWidth + "px";
          const { preview, html } = renderMindmapPreview(
            source,
            node,
            snapshotContext,
            research,
            { images: false },
          );
          element.classList.add(`mindmap-preview-${preview.kind}`);
          if (preview.caption) {
            const caption = document.createElement("div");
            caption.className = "mindmap-block-caption";
            caption.textContent = preview.caption;
            element.append(caption);
          }
          const body = document.createElement("div");
          if (html) body.innerHTML = html;
          else body.textContent = node.label;
          element.append(body);
          // Private application URLs never leave the workbench. Captures are inert pixels.
          element.querySelectorAll("a").forEach((a) => {
            a.removeAttribute("href");
          });
          root.append(element);
          await document.fonts.ready;
          setProgress(`Rendering rich label ${i + 1} of ${tree.nodes.length}`);
          await waitForMindmapPreviews(element, controller.signal);
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
              // Frames remain vectors. Rounded label corners must not acquire a
              // square paper-filled PNG backdrop at radius > 0.
              backgroundColor: "transparent",
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
          {
            background,
            surface,
            border,
            rootBorder,
            radius,
            textWeight,
            headingWeight,
            branchColors,
            text,
            accent,
            font,
            fontSize,
          },
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
      title={uiText("Export mind map")}
      subtitle={uiText(
        "Includes document content only, never presence, private comments, or reading records.",
      )}
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
    >
      <div className="mindmap-options">
        <Field label={uiText("Format")}>
          <NativeSelect
            value={format}
            disabled={busy}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="markdown">
              <I18nText id="Markdown source" />
            </option>
            <option value="svg">
              <I18nText id="SVG image" />
            </option>
            <option value="png">
              <I18nText id="PNG image" />
            </option>
            <option value="pdf">
              <I18nText id="PDF" />
            </option>
            <option value="html">
              <I18nText id="Interactive offline HTML" />
            </option>
          </NativeSelect>
        </Field>
        <Field label={uiText("Scope")}>
          <NativeSelect
            value={scope}
            disabled={busy}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="whole">
              <I18nText id="Entire map · all branches" />
            </option>
            <option
              value="selected"
              disabled={!selected || selected === projection.rootId}
            >
              <I18nText id="Selected branch" />
            </option>
          </NativeSelect>
        </Field>
        {format !== "markdown" && (
          <>
            <Field label={uiText("Resolution")}>
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
              <span>
                <I18nText id="Preserve rich labels and equations" />
              </span>
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
            <span>
              <I18nText id="Tile across pages at readable size" />
            </span>
          </label>
        )}
      </div>
      <HelpText>
        <I18nText id="Rich exports embed rendered labels as images. Block summaries are exported; images and attachments are not fetched. Use the existing portable collection export to include source and permission-checked files. Plain vector labels use the viewer's fonts." />
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
          {busy ? uiText("Cancel export") : uiText("Close")}
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void exportFile()}
        >
          {busy ? uiText("Exporting…") : uiText("Download")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
