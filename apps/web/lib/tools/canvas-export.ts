import { toPng, getFontEmbedCSS } from "html-to-image";
import { PDFDocument } from "pdf-lib";
import { parseCanvas, type CanvasData } from "@axiom/shared/canvas";
import {
  canvasExportLimits,
  canvasSnapshotSvg,
  validateCanvasImageSize,
} from "@axiom/shared/canvas-export";
import type { CanvasRect } from "@axiom/shared/canvas-geometry";
import type { ResourceCardPreview } from "@axiom/shared/canvas-preview";
import { api } from "../client";
import { rasterizeSvg } from "./download";

export type CanvasExportStyle = {
  background?: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
};
export async function resolveCanvasExport(
  data: CanvasData,
  resourceId: string,
  signal: AbortSignal,
  progress: (message: string) => void,
) {
  // Recheck the board itself even when every card is text and needs no requests.
  await api(`resources/${resourceId}/card-preview`, { signal });
  const previews = new Map<string, ResourceCardPreview>(),
    omissions: string[] = [],
    seen = new Set<string>();
  const queue = data.nodes
    .filter((n) => n.type === "file")
    .map((node) => ({ node, depth: 0, ancestors: [resourceId] }));
  for (let index = 0; index < queue.length; index += 4) {
    signal.throwIfAborted();
    if (index >= 120) {
      omissions.push("Nested preview limit reached (120 linked resources).");
      break;
    }
    const batch = queue.slice(index, index + 4);
    await Promise.all(
      batch.map(async ({ node, depth, ancestors }) => {
        if (!node.resourceId || ancestors.includes(node.resourceId)) return;
        const key = `${node.resourceId}:${node.versionId ?? "latest"}`;
        if (seen.has(key)) return;
        seen.add(key);
        try {
          const value = await api<ResourceCardPreview>(
            `resources/${node.resourceId}/card-preview${node.versionId ? `?version=${node.versionId}` : ""}`,
            { signal },
          );
          previews.set(key, value);
          if (
            value.kind === "document" &&
            value.format === "canvas" &&
            depth < 2
          )
            queue.push(
              ...parseCanvas(value.source)
                .nodes.filter((n) => n.type === "file")
                .map((child) => ({
                  node: child,
                  depth: depth + 1,
                  ancestors: [...ancestors, node.resourceId!],
                })),
            );
        } catch (error) {
          signal.throwIfAborted();
          omissions.push(`${node.file}: ${(error as Error).message}`);
        }
      }),
    );
    progress(
      `Preparing linked previews · ${Math.min(index + 4, queue.length)} of ${queue.length}`,
    );
  }
  return { previews, omissions };
}
export async function captureCanvasSvg(
  stage: HTMLElement,
  data: CanvasData,
  bounds: CanvasRect,
  colors: CanvasExportStyle,
  scale: number,
  grid: boolean,
  signal: AbortSignal,
  progress: (message: string) => void,
) {
  if (data.nodes.length > canvasExportLimits.cards)
    throw new Error(
      "Visual exports support 120 cards. Choose a selection or use a portable bundle for the entire board.",
    );
  const pixels = data.nodes
    .filter((n) => n.type !== "group")
    .reduce((sum, n) => sum + n.width * n.height * scale * scale, 0);
  if (pixels > canvasExportLimits.cardPixels)
    throw new Error(
      "The card previews exceed the 64 megapixel capture budget. Reduce the selection or resolution.",
    );
  await document.fonts.ready;
  // Render offscreen math without introducing a second TeX renderer.
  window.dispatchEvent(new Event("axiom:prepare-print"));
  const started = Date.now();
  while (Date.now() - started < 18000) {
    signal.throwIfAborted();
    const pending = stage.querySelector(
      '[data-math-request]:not([data-math-state="ready"]):not([data-math-state="error"])',
    );
    const loading = [...stage.querySelectorAll("img")].some(
      (img) => !img.complete,
    );
    if (!pending && !loading && Date.now() - started > 700) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const images = new Map<string, string>(),
    omissions: string[] = [];
  let fontEmbedCSS = "";
  try {
    fontEmbedCSS = await getFontEmbedCSS(stage);
  } catch {
    omissions.push(
      "Some font faces could not be embedded; platform fallbacks were used.",
    );
  }
  const cards = [
    ...stage.querySelectorAll<HTMLElement>(":scope > [data-export-node]"),
  ];
  for (const card of cards) {
    signal.throwIfAborted();
    if (card.classList.contains("canvas-group")) continue;
    const id = card.dataset.exportNode!;
    progress(`Rendering card ${images.size + 1} of ${cards.length}`);
    try {
      images.set(
        id,
        await toPng(card, {
          pixelRatio: scale,
          fontEmbedCSS,
          cacheBust: false,
          // Browsers serialize logical as well as physical insets. Reset both:
          // otherwise cards away from (0,0) can render outside their capture.
          style: {
            position: "relative",
            inset: "auto",
            insetInline: "auto",
            insetBlock: "auto",
            transform: "none",
            margin: "0",
            boxShadow: "none",
          },
          filter: (node) =>
            !(
              node instanceof Element &&
              (node.hasAttribute("data-export-exclude") ||
                node.tagName === "IFRAME")
            ),
        }),
      );
    } catch {
      omissions.push(
        `Card ${id}: preview could not be captured; a labeled placeholder was exported.`,
      );
    }
  }
  signal.throwIfAborted();
  if (stage.querySelector('[data-math-request]:not([data-math-state="ready"])'))
    omissions.push(
      "One or more equations were not fully rendered; source remains in JSON Canvas / Markdown exports.",
    );
  return {
    svg: canvasSnapshotSvg(data, bounds, images, colors, grid),
    omissions,
  };
}
export async function canvasPdf(
  svg: string,
  bounds: CanvasRect,
  scale: number,
  tiled: boolean,
  signal: AbortSignal,
  progress: (message: string) => void,
) {
  const pdf = await PDFDocument.create(),
    pageWidth = 842,
    pageHeight = 595,
    margin = 24;
  if (!tiled) {
    validateCanvasImageSize(bounds, scale);
    const blob = await rasterizeSvg(svg, scale, "#ffffff");
    signal.throwIfAborted();
    const image = await pdf.embedPng(await blob.arrayBuffer()),
      page = pdf.addPage([pageWidth, pageHeight]);
    const ratio = Math.min(
      (pageWidth - margin * 2) / bounds.width,
      (pageHeight - margin * 2) / bounds.height,
    );
    const width = bounds.width * ratio,
      height = bounds.height * ratio;
    page.drawImage(image, {
      x: (pageWidth - width) / 2,
      y: (pageHeight - height) / 2,
      width,
      height,
    });
  } else {
    const w = pageWidth - margin * 2,
      h = pageHeight - margin * 2,
      cols = Math.ceil(bounds.width / w),
      rows = Math.ceil(bounds.height / h);
    if (cols * rows > canvasExportLimits.pdfPages)
      throw new Error(
        "This board needs more than 100 PDF tiles. Export a smaller selection.",
      );
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        signal.throwIfAborted();
        progress(`Preparing PDF tile ${y * cols + x + 1} of ${cols * rows}`);
        const tile = svg.replace(
          /<svg[^>]*>/,
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${bounds.x + x * w} ${bounds.y + y * h} ${w} ${h}">`,
        );
        const blob = await rasterizeSvg(tile, scale, "#ffffff"),
          image = await pdf.embedPng(await blob.arrayBuffer());
        const page = pdf.addPage([pageWidth, pageHeight]);
        page.drawImage(image, { x: margin, y: margin, width: w, height: h });
        page.drawText(`${x + 1}, ${y + 1} / ${cols} × ${rows}`, {
          x: margin,
          y: 10,
          size: 8,
        });
      }
  }
  signal.throwIfAborted();
  return new Blob([new Uint8Array(await pdf.save())], {
    type: "application/pdf",
  });
}
