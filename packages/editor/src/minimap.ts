import type { MarkdownNode, ParsedDocument } from "@axiom/markdown";
import type { MinimapPreferences } from "@axiom/shared/minimap";
import type { ReadingBlockRect } from "./reading-marks";
import type { SourceSelection } from "./transactions";

export type NavigationBlock = ReadingBlockRect & { folded?: boolean };
/** Viewport geometry supplied by the owning editor, without moving selection. */
export type NavigationPosition = {
  top: number;
  bottom: number;
  estimated?: boolean;
};
export type NavigationMarker = {
  id: string;
  kind: "bookmark" | "annotation" | "search" | "peer" | "cursor" | "selection";
  from: number;
  to: number;
  label: string;
  color?: string;
};
export type EditorNavigationState = {
  revision: number;
  source: string;
  selection: SourceSelection;
  composing: boolean;
  markers: NavigationMarker[];
};
export type MinimapBlock = NavigationBlock & {
  text: string;
  level: number;
  label: string;
};
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));

/** Scroll position and track position deliberately have different denominators. */
export function minimapLayout(
  extent: number,
  viewport: number,
  track: number,
  width: number,
  documentWidth: number,
  sizing: MinimapPreferences["size"],
  scroll: number,
) {
  const height = Math.max(1, extent),
    available = Math.max(1, track),
    visible = Math.max(1, viewport);
  const naturalScale = clamp(width / Math.max(1, documentWidth), 0.015, 0.3);
  const scale =
    sizing === "fill"
      ? available / height
      : sizing === "fit"
        ? Math.min(naturalScale, available / height)
        : naturalScale;
  const content = height * scale;
  const fraction = clamp(scroll / Math.max(1, height - visible), 0, 1);
  const offset = Math.max(0, content - available) * fraction;
  const thumbHeight = Math.min(
    available,
    Math.max(18, Math.min(height, visible) * scale),
  );
  // The minimum hit target must not push the slider past the document's end.
  const thumbTop = clamp(
    scroll * scale - offset,
    0,
    Math.min(available, content) - thumbHeight,
  );
  return {
    scale,
    content,
    offset,
    thumbTop,
    thumbHeight,
    fraction,
    maxScroll: Math.max(0, height - visible),
    track: available,
  };
}

export function minimapWidth(
  paneWidth: number,
  preferred: number,
  minimumDocumentWidth = 520,
) {
  return paneWidth < minimumDocumentWidth + 80
    ? 14
    : clamp(Math.min(preferred, paneWidth - minimumDocumentWidth), 80, 200);
}

/** Canvas, marker lane, headings and selection all share this transform. */
export function minimapY(y: number, layout: { scale: number; offset: number }) {
  return y * layout.scale - layout.offset;
}

export function inlineSummary(node: MarkdownNode, max = 360): string {
  let result = "";
  const nodes = [node];
  while (nodes.length && result.length < max) {
    const n = nodes.pop()!;
    if (n.children)
      for (let i = n.children.length - 1; i >= 0; i--)
        nodes.push(n.children[i]);
    else if (n.text !== undefined) result += n.text;
    else if (n.type === "softbreak" || n.type === "hardbreak") result += "\n";
    else if (n.type === "image") result += n.title || "Image";
  }
  return result.slice(0, max);
}

/** Source ordering differs from visual ordering for footnote definitions. */
export class NavigationIndex {
  readonly source: NavigationBlock[];
  readonly visual: NavigationBlock[];
  constructor(blocks: readonly NavigationBlock[]) {
    this.source = [...blocks].sort((a, b) => a.from - b.from || b.to - a.to);
    this.visual = [...blocks].sort(
      (a, b) => a.top - b.top || b.bottom - a.bottom,
    );
  }
  atSource(at: number) {
    let lo = 0,
      hi = this.source.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.source[mid].from <= at) lo = mid + 1;
      else hi = mid;
    }
    const nearest = this.source[Math.max(0, lo - 1)];
    // Bounded ancestor walk; source lines/ordinary sibling blocks are O(log n).
    for (let i = lo - 1; i >= Math.max(0, lo - 65); i--)
      if (at <= this.source[i].to) return this.source[i];
    return nearest;
  }
  atHeight(y: number) {
    let lo = 0,
      hi = this.visual.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.visual[mid].top <= y) lo = mid + 1;
      else hi = mid;
    }
    return this.visual[Math.max(0, lo - 1)];
  }
  yAt(at: number) {
    const b = this.atSource(at);
    return b
      ? b.top +
          (b.folded
            ? 0
            : clamp((at - b.from) / Math.max(1, b.to - b.from), 0, 1) *
              (b.bottom - b.top))
      : 0;
  }
  sourceAt(y: number) {
    const b = this.atHeight(y);
    return b
      ? Math.round(
          b.from +
            (b.folded
              ? 0
              : clamp((y - b.top) / Math.max(1, b.bottom - b.top), 0, 1) *
                (b.to - b.from)),
        )
      : 0;
  }
}

/** Bounded text payloads. No rendered HTML, image downloads or second parser. */
export function minimapBlocks(
  source: string,
  parsed: ParsedDocument,
  geometry: readonly NavigationBlock[],
  mode: string,
): MinimapBlock[] {
  if (mode === "source")
    return geometry
      .filter((b) => b.type === "sourceLine")
      .map((b) => ({
        ...b,
        level: 0,
        text: source.slice(b.from, Math.min(b.to, b.from + 600)),
        label: "Markdown source",
      }));
  const byRange = new Map<string, MarkdownNode>();
  const stack = [parsed.ast, ...(parsed.definitions ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    byRange.set(`${node.type}:${node.from}`, node);
    if (node.children) for (const child of node.children) stack.push(child);
  }
  return geometry.map((block) => {
    const node = byRange.get(`${block.type}:${block.from}`);
    const text = node
      ? inlineSummary(node)
      : source.slice(block.from, Math.min(block.to, block.from + 360));
    return {
      ...block,
      text,
      level: node?.level ?? 0,
      label: block.folded
        ? `Collapsed ${block.type}: ${text.slice(0, 90)}`
        : node?.type === "heading"
          ? text
          : `${block.type === "sourceLine" ? "Line" : block.type}: ${text.slice(0, 90)}`,
    };
  });
}

export function clusteredMarkers<T>(
  items: readonly T[],
  y: (item: T) => number,
  height: number,
  step = 8,
) {
  const bins = new Map<number, { entries: T[]; total: number }>();
  for (const item of items) {
    const center = y(item);
    // Proportional mode clips the miniature. Do not misrepresent offscreen
    // results by pinning them to the first/last visible line.
    if (!Number.isFinite(center) || center < 0 || center > height) continue;
    const key = Math.floor(center / step);
    const bin = bins.get(key);
    if (bin) {
      bin.entries.push(item);
      bin.total += center;
    } else bins.set(key, { entries: [item], total: center });
  }
  return [...bins]
    .sort(([a], [b]) => a - b)
    .map(([key, { entries, total }]) => ({
      key,
      // Cluster nearby marks, but never quantize a lone marker's position.
      // `top` is the top of the six-pixel button, not its center.
      top: clamp(total / entries.length - 3, 0, Math.max(0, height - 6)),
      entries,
    }));
}
