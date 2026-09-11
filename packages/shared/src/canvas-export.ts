import {
  canvasBounds,
  canvasColors,
  canvasTitle,
  type CanvasData,
} from "./canvas";
import { canvasEdgeGeometry, type CanvasRect } from "./canvas-geometry";

export const canvasExportLimits = {
  cards: 120,
  pixels: 32_000_000,
  cardPixels: 64_000_000,
  pdfPages: 100,
};
export function canvasExportBounds(
  data: CanvasData,
  padding: number,
  viewport?: CanvasRect,
): CanvasRect {
  let b = viewport ?? canvasBounds(data.nodes);
  if (!viewport) {
    const nodes = new Map(data.nodes.map((n) => [n.id, n]));
    for (const edge of data.edges) {
      const from = nodes.get(edge.fromNode),
        to = nodes.get(edge.toNode);
      if (!from || !to) continue;
      const numbers =
        canvasEdgeGeometry(from, to, edge.fromSide, edge.toSide)
          .d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)
          ?.map(Number) ?? [];
      const xs = numbers.filter((_, i) => i % 2 === 0),
        ys = numbers.filter((_, i) => i % 2 === 1);
      const left = Math.min(b.x, ...xs),
        top = Math.min(b.y, ...ys);
      b = {
        x: left,
        y: top,
        width: Math.max(b.x + b.width, ...xs) - left,
        height: Math.max(b.y + b.height, ...ys) - top,
      };
    }
  }
  return {
    x: b.x - padding,
    y: b.y - padding,
    width: Math.max(1, b.width + padding * 2),
    height: Math.max(1, b.height + padding * 2),
  };
}
export function validateCanvasImageSize(bounds: CanvasRect, scale: number) {
  if (!Number.isFinite(scale) || scale < 1 || scale > 4)
    throw new Error("Choose a resolution from 1× to 4×.");
  if (
    bounds.width * bounds.height * scale * scale > canvasExportLimits.pixels ||
    bounds.width * scale > 32767 ||
    bounds.height * scale > 32767
  )
    throw new Error(
      "This image exceeds 32 megapixels. Choose a smaller selection, lower resolution, or tiled PDF.",
    );
}
const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function canvasSnapshotSvg(
  data: CanvasData,
  bounds: CanvasRect,
  images: Map<string, string>,
  colors: {
    background?: string;
    surface: string;
    border: string;
    text: string;
    muted: string;
  },
  grid = false,
): string {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">`,
    `<title>Research canvas</title><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${xml(colors.muted)}" opacity=".25"/></pattern></defs>`,
  ];
  if (colors.background)
    parts.push(
      `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${xml(colors.background)}"/>`,
    );
  if (grid)
    parts.push(
      `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="url(#grid)"/>`,
    );
  const groups = data.nodes.filter((n) => n.type === "group"),
    cards = data.nodes.filter((n) => n.type !== "group");
  for (const n of groups)
    parts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8" fill="${xml(canvasColors[n.color ?? ""] ?? n.color ?? colors.surface)}" fill-opacity=".06" stroke="${xml(canvasColors[n.color ?? ""] ?? n.color ?? colors.border)}" stroke-dasharray="6 4"/><text x="${n.x + 12}" y="${n.y + 22}" font-size="12" font-family="sans-serif" fill="${xml(colors.text)}">${xml(canvasTitle(n))}</text>`,
    );
  data.edges.forEach((e, i) => {
    const from = byId.get(e.fromNode),
      to = byId.get(e.toNode);
    if (!from || !to) return;
    const g = canvasEdgeGeometry(from, to, e.fromSide, e.toSide),
      color = xml(canvasColors[e.color ?? ""] ?? e.color ?? colors.muted);
    parts.push(
      `<defs><marker id="arrow${i}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8" fill="${color}"/></marker></defs><path d="${g.d}" stroke="${color}" stroke-width="2" fill="none"${e.toEnd !== "none" ? ` marker-end="url(#arrow${i})"` : ""}${e.fromEnd === "arrow" ? ` marker-start="url(#arrow${i})"` : ""}/>`,
    );
    if (e.label)
      parts.push(
        `<text x="${g.label.x}" y="${g.label.y - 10}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="${color}">${xml(e.label)}</text>`,
      );
  });
  for (const n of cards) {
    parts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8" fill="${xml(colors.surface)}" stroke="${xml(canvasColors[n.color ?? ""] ?? n.color ?? colors.border)}"/>`,
    );
    const image = images.get(n.id);
    if (image)
      parts.push(
        `<image x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" href="${xml(image)}"/>`,
      );
    else
      parts.push(
        `<text x="${n.x + 16}" y="${n.y + 28}" font-size="14" font-family="sans-serif" fill="${xml(colors.text)}">${xml(canvasTitle(n))}</text><text x="${n.x + 16}" y="${n.y + 54}" font-size="11" font-family="sans-serif" fill="${xml(colors.muted)}">Preview omitted; source retained in JSON Canvas.</text>`,
      );
  }
  return parts.join("") + "</svg>";
}
export function canvasMarkdown(data: CanvasData): string {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  return (
    "# Research canvas\n\n" +
    data.nodes
      .map(
        (n) =>
          `## ${canvasTitle(n).replace(/[\r\n]/g, " ")}\n\n${n.tags?.length ? `Tags: ${n.tags.join(", ")}\n\n` : ""}${n.type === "text" ? n.text : n.type === "link" ? `<${n.url}>` : n.type === "file" ? `Linked file: ${n.file}${n.resourceId ? ` (resource ${n.resourceId}${n.versionId ? `, version ${n.versionId}` : ", latest"})` : ""}` : "Card group"}\n`,
      )
      .join("\n") +
    (data.edges.length
      ? "\n## Connections\n\n" +
        data.edges
          .map(
            (e) =>
              `- ${byId.has(e.fromNode) ? canvasTitle(byId.get(e.fromNode)!) : e.fromNode} → ${byId.has(e.toNode) ? canvasTitle(byId.get(e.toNode)!) : e.toNode}${e.label ? `: ${e.label}` : ""}`,
          )
          .join("\n") +
        "\n"
      : "")
  );
}
