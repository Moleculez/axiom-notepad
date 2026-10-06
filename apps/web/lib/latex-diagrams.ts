import type { LatexPreview } from "@axiom/shared/latex-export";
import { abortable } from "./document-export";
/** Explicit export preparation only. No hidden editor or hosted renderer. */
export async function prepareLatexDiagrams(
  preview: LatexPreview,
  signal: AbortSignal,
) {
  const { renderDiagram } = await import("./editor-vnext/diagrams");
  const diagrams: { from: number; sha256: string; png: string }[] = [],
    warnings: string[] = [];
  let total = 0;
  for (const request of preview.diagrams) {
    signal.throwIfAborted();
    try {
      const result = await abortable(
        renderDiagram(request.source, [
          "#ffffff",
          "#242827",
          "#335a70",
          "#cccec7",
          "sans-serif",
        ]),
        signal,
      );
      const doc = new DOMParser().parseFromString(result.svg, "image/svg+xml"),
        svg = doc.documentElement;
      if (
        svg.localName !== "svg" ||
        svg.querySelector(
          "parsererror,foreignObject,script,image,iframe,object,embed",
        )
      )
        throw new Error("Unsupported diagram output");
      for (const node of [svg, ...svg.querySelectorAll("*")])
        for (const attribute of [...node.attributes]) {
          if (
            /^on/i.test(attribute.name) ||
            (/(?:^|:)href$/i.test(attribute.name) &&
              !attribute.value.startsWith("#"))
          )
            node.removeAttribute(attribute.name);
        }
      for (const style of svg.querySelectorAll("style"))
        if (/@import|url\(\s*["']?(?!#)/i.test(style.textContent ?? ""))
          throw new Error("External diagram styles are not portable");
      const bounds = (svg.getAttribute("viewBox") ?? "")
        .split(/[ ,]+/)
        .map(Number);
      const width = bounds[2] || parseFloat(svg.getAttribute("width") || "800"),
        height = bounds[3] || parseFloat(svg.getAttribute("height") || "600");
      if (![width, height].every((n) => Number.isFinite(n) && n > 0))
        throw new Error("Invalid diagram dimensions");
      const scale = Math.min(2, Math.sqrt(16_000_000 / (width * height)));
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], {
          type: "image/svg+xml",
        }),
      );
      try {
        const image = new Image();
        image.src = url;
        await abortable(image.decode(), signal);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(width * scale));
        canvas.height = Math.max(1, Math.floor(height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const png = canvas.toDataURL("image/png").split(",")[1];
        total += Math.floor((png.length * 3) / 4);
        if (total > 20 * 1024 * 1024)
          throw new Error("The diagram raster budget is full");
        diagrams.push({ from: request.from, sha256: request.sha256!, png });
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      if (signal.aborted) throw error;
      warnings.push(
        `Diagram near character ${request.from + 1}: ${error instanceof Error ? error.message : "could not render"}. Its source is retained.`,
      );
    }
  }
  return { diagrams, warnings };
}
