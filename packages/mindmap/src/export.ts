import { mindmapConnector, wrapMindmapLabel } from "./layout";
import { mindmapHtmlScript } from "./html-runtime";
import type { MindmapLayout, MindmapProjection } from "./types";

export const mindmapExportLimits = {
  richNodes: 120,
  pixels: 32_000_000,
} as const;
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
export function mindmapBranch(
  projection: MindmapProjection,
  id?: string,
): MindmapProjection {
  if (!id || id === projection.rootId) return projection;
  const nodes = new Map(projection.nodes.map((n) => [n.id, n])),
    root = nodes.get(id);
  if (!root) throw new Error("Select a current branch before exporting.");
  const included = new Set<string>(),
    queue = [id];
  for (let i = 0; i < queue.length; i++) {
    included.add(queue[i]);
    queue.push(...(nodes.get(queue[i])?.children ?? []));
  }
  return {
    rootId: id,
    nodes: projection.nodes
      .filter((n) => included.has(n.id))
      .map((n) => (n.id === id ? { ...n, parentId: null } : n)),
    supporting: projection.supporting,
  };
}
export function mindmapMarkdown(
  source: string,
  projection: MindmapProjection,
  id?: string,
) {
  if (!id || id === projection.rootId) return source;
  const node = projection.nodes.find((n) => n.id === id);
  if (!node) throw new Error("This branch is no longer available.");
  const ending = source.includes("\r\n") ? "\r\n" : "\n";
  const outside = projection.supporting.filter(
    (n) =>
      (n.to <= node.from || n.from >= node.branchTo) &&
      ["frontmatter", "referenceDefinition", "footnoteDefinition"].includes(
        n.type,
      ),
  );
  const front = outside
    .filter((n) => n.type === "frontmatter")
    .map((n) => source.slice(n.from, n.to))
    .join(ending);
  const definitions = outside
    .filter((n) => n.type !== "frontmatter")
    .map((n) => source.slice(n.from, n.to))
    .join(ending);
  return (
    (front ? front + ending : "") +
    source.slice(node.from, node.branchTo) +
    (definitions ? ending + ending + definitions : "")
  );
}
export type MindmapExportStyle = {
  background: string;
  /** Resolved paper surface/rules; never serialize unresolved theme variables. */
  surface?: string;
  border?: string;
  rootBorder?: string;
  radius?: number;
  textWeight?: number;
  headingWeight?: number;
  branchColors?: readonly string[];
  text: string;
  accent: string;
  font: string;
  fontSize: number;
};
/** Vector connections and selectable text by default. Rich captures are explicit PNGs. */
export function mindmapSvg(
  projection: MindmapProjection,
  layout: MindmapLayout,
  style: MindmapExportStyle,
  images: ReadonlyMap<string, string> = new Map(),
) {
  const bounds = layout.bounds,
    placements = new Map(layout.nodes.map((n) => [n.id, n]));
  const branchColor = (branch: number) =>
    style.branchColors?.length
      ? style.branchColors[branch % style.branchColors.length]
      : style.accent;
  const headingWeight = Number.isFinite(style.headingWeight)
    ? Math.max(100, Math.min(900, style.headingWeight!))
    : 600;
  const textWeight = Number.isFinite(style.textWeight)
    ? Math.max(100, Math.min(900, style.textWeight!))
    : 400;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><title>Markdown mind map</title><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${xml(style.background)}" pointer-events="none"/>`,
  ];
  for (const node of projection.nodes) {
    const position = placements.get(node.id),
      parent = placements.get(node.parentId ?? "");
    if (!position) continue;
    if (parent)
      parts.push(
        `<path data-edge="${xml(node.id)}" data-parent="${xml(node.parentId!)}" d="${mindmapConnector(parent, position)}" fill="none" stroke="${xml(branchColor(position.branch))}" stroke-width="1.4" stroke-opacity="0.55"/>`,
      );
  }
  for (const node of projection.nodes) {
    const position = placements.get(node.id);
    if (!position) continue;
    const image = images.get(node.id),
      radius = Number.isFinite(style.radius)
        ? Math.max(
            0,
            Math.min(style.radius!, position.width / 2, position.height / 2),
          )
        : 6,
      border =
        node.kind === "root"
          ? (style.rootBorder ?? style.border ?? style.accent)
          : (style.border ?? style.accent),
      branch = branchColor(position.branch);
    parts.push(
      `<g data-node="${xml(node.id)}" data-parent="${xml(node.parentId ?? "")}" tabindex="0" role="button" aria-label="${xml(node.label)}"><title>${xml(node.label)}</title><rect data-frame="true" x="${position.x + 0.5}" y="${position.y + 0.5}" width="${position.width - 1}" height="${position.height - 1}" rx="${radius}" fill="${xml(style.surface ?? style.background)}" stroke="${xml(border)}" stroke-width="1" pointer-events="all"/><path d="M ${position.x + 0.5} ${position.y + 10} V ${position.y + position.height - 10}" stroke="${xml(branch)}" stroke-width="2" stroke-opacity="0.45" pointer-events="none"/>`,
    );
    if (image && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image))
      parts.push(
        `<image x="${position.x}" y="${position.y}" width="${position.width}" height="${position.height}" href="${image}"/>`,
      );
    else {
      const lines = wrapMindmapLabel(
        node.label,
        position.width,
        style.fontSize,
      );
      parts.push(
        `<text x="${position.x + 13}" y="${position.y + 11 + style.fontSize}" font-family="${xml(style.font)}" font-size="${style.fontSize}" font-weight="${node.kind === "root" || node.kind === "heading" ? headingWeight : textWeight}" fill="${xml(style.text)}">${lines
          .map(
            (line, i) =>
              `<tspan x="${position.x + 13}" dy="${i ? style.fontSize * 1.45 : 0}">${xml(line)}</tspan>`,
          )
          .join("")}</text>`,
      );
    }
    if (node.children.length)
      parts.push(
        `<circle cx="${position.side === 1 ? position.x + position.width + 9 : position.x - 9}" cy="${position.y + position.height / 2}" r="4" fill="${xml(branch)}"/>`,
      );
    parts.push("</g>");
  }
  return parts.join("") + "</svg>";
}
/** Only fixed first-party interaction code executes. Labels are escaped by SVG. */
export function mindmapHtml(svg: string, title: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xml(title)}</title><style>html,body{margin:0;height:100%;font:14px system-ui}body{display:flex;flex-direction:column;background:Canvas;color:CanvasText}header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:12px 20px;border-bottom:1px solid #8885}button{font:inherit;padding:6px 12px}main{flex:1;overflow:hidden;touch-action:none}svg{width:100%;height:100%;user-select:none}svg text{user-select:text}g[role=button]{cursor:pointer}g:focus{outline:2px solid Highlight}span{margin-left:auto}</style><header><strong>${xml(title)}</strong><button id="fit">Fit</button><button id="out" aria-label="Zoom out">−</button><button id="in" aria-label="Zoom in">+</button><button id="expand">Expand all</button><span>Drag blank space to pan · Scroll to zoom · Click a node to fold · Select text to copy</span></header><main>${svg}</main><script>${mindmapHtmlScript}</script></html>`;
}
