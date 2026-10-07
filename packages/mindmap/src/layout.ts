import {
  defaultMindmapSettings,
  mindmapZoomLimits,
  type MindmapLayout,
  type MindmapPlacement,
  type MindmapProjection,
  type MindmapRect,
  type MindmapSettings,
} from "./types";

/** Semantic branch roles are shared by the live view and resolved offline exports. */
export function mindmapBranchColor(
  index: number,
  mode: MindmapSettings["colors"],
) {
  if (mode === "accent") return "var(--accent)";
  const colors = [
    "var(--accent)",
    "var(--green, var(--accent))",
    "var(--danger, var(--accent))",
    "color-mix(in srgb, var(--accent) 65%, var(--text))",
    "color-mix(in srgb, var(--green, var(--accent)) 65%, var(--text))",
  ];
  const branch = Number.isFinite(index) ? Math.trunc(index) : 0;
  return colors[((branch % colors.length) + colors.length) % colors.length];
}

/** Shared, bounded fallback for both layout and selectable-text exports. */
export function wrapMindmapLabel(label: string, width: number, fontSize = 16) {
  const capacity = Math.max(8, Math.floor((width - 26) / (fontSize * 0.55)));
  const lines: string[] = [];
  let current = "";
  for (const word of label.split(/\s+/)) {
    if (current && current.length + word.length + 1 > capacity) {
      lines.push(current);
      current = "";
    }
    for (let offset = 0; offset < word.length; offset += capacity) {
      const part = word.slice(offset, offset + capacity);
      if (offset + capacity < word.length) lines.push(part);
      else current += (current ? " " : "") + part;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}
export function estimateMindmapLabel(
  label: string,
  width: number,
  fontSize = 16,
) {
  return {
    width,
    height: Math.max(
      48,
      wrapMindmapLabel(label, width, fontSize).length * fontSize * 1.45 + 22,
    ),
  };
}

/** Deterministic variable-size tree layout. No DOM, network, or layout dependency. */
export function layoutMindmap(
  projection: MindmapProjection,
  options: Partial<MindmapSettings> = {},
  collapsed: Iterable<string> = [],
  sizes: Record<string, { width: number; height: number }> = {},
): MindmapLayout {
  const settings = { ...defaultMindmapSettings, ...options },
    hidden = new Set(collapsed);
  const gapX = settings.spacing === "compact" ? 48 : 64,
    gapY = settings.spacing === "compact" ? 8 : 16;
  const byId = new Map(projection.nodes.map((n) => [n.id, n]));
  const box = (id: string) => {
    const value = sizes[id];
    return value &&
      Number.isFinite(value.width) &&
      Number.isFinite(value.height)
      ? {
          width: Math.max(40, Math.min(value.width, 1200)),
          height: Math.max(28, Math.min(value.height, 1200)),
        }
      : estimateMindmapLabel(
          byId.get(id)?.label ?? "",
          Math.min(
            settings.nodeWidth,
            Math.max(100, (byId.get(id)?.label.length ?? 10) * 9 + 36),
          ),
        );
  };
  const subtree = new Map<string, number>();
  const measure = (id: string): number => {
    const children = hidden.has(id) ? [] : (byId.get(id)?.children ?? []);
    const height = Math.max(
      box(id).height,
      children.reduce((sum, child) => sum + measure(child), 0) +
        Math.max(0, children.length - 1) * gapY,
    );
    subtree.set(id, height);
    return height;
  };
  measure(projection.rootId);
  const placements: MindmapPlacement[] = [];
  const place = (
    id: string,
    x: number,
    top: number,
    side: -1 | 1,
    depth: number,
    branch: number,
  ) => {
    const size = box(id),
      full = subtree.get(id)!;
    const position = {
      id,
      x: side === -1 ? x - size.width : x,
      y: top + (full - size.height) / 2,
      ...size,
      side,
      depth,
      branch,
    };
    placements.push(position);
    const children = hidden.has(id) ? [] : (byId.get(id)?.children ?? []);
    let y =
      top +
      (full -
        children.reduce((sum, child) => sum + subtree.get(child)!, 0) -
        Math.max(0, children.length - 1) * gapY) /
        2;
    children.forEach((child, index) => {
      place(
        child,
        side === 1 ? position.x + size.width + gapX : position.x - gapX,
        y,
        side,
        depth + 1,
        depth === 0 ? index : branch,
      );
      y += subtree.get(child)! + gapY;
    });
  };
  if (settings.layout === "balanced") {
    const root = byId.get(projection.rootId)!,
      size = box(root.id),
      children = hidden.has(root.id) ? [] : root.children;
    const sides: [string[], string[]] = [[], []],
      totals = [0, 0];
    const branchIndices = new Map(children.map((id, index) => [id, index]));
    children.forEach((id) => {
      const side = totals[0] <= totals[1] ? 0 : 1;
      sides[side].push(id);
      totals[side] += subtree.get(id)! + gapY;
    });
    const height = Math.max(
      size.height,
      ...totals.map((v) => Math.max(0, v - gapY)),
    );
    placements.push({
      id: root.id,
      x: 0,
      y: (height - size.height) / 2,
      ...size,
      depth: 0,
      branch: 0,
      side: 1,
    });
    sides.forEach((group, i) => {
      let y = (height - Math.max(0, totals[i] - gapY)) / 2;
      group.forEach((id) => {
        place(
          id,
          i === 0 ? size.width + gapX : -gapX,
          y,
          i === 0 ? 1 : -1,
          1,
          branchIndices.get(id)!,
        );
        y += subtree.get(id)! + gapY;
      });
    });
  } else
    place(projection.rootId, 0, 0, settings.layout === "left" ? -1 : 1, 0, 0);
  const left = Math.min(...placements.map((n) => n.x)),
    top = Math.min(...placements.map((n) => n.y));
  const right = Math.max(...placements.map((n) => n.x + n.width)),
    bottom = Math.max(...placements.map((n) => n.y + n.height));
  return {
    nodes: placements,
    bounds: {
      x: left - 32,
      y: top - 32,
      width: right - left + 64,
      height: bottom - top + 64,
    },
  };
}
export function mindmapConnector(
  parent: MindmapPlacement,
  child: MindmapPlacement,
) {
  const x1 = child.side === 1 ? parent.x + parent.width : parent.x,
    x2 = child.side === 1 ? child.x : child.x + child.width;
  const y1 = parent.y + parent.height / 2,
    y2 = child.y + child.height / 2,
    middle = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`;
}
export function fitMindmap(bounds: MindmapRect, width: number, height: number) {
  const scale = Math.max(
    mindmapZoomLimits.min,
    Math.min(1.5, (width - 64) / bounds.width, (height - 64) / bounds.height),
  );
  return {
    scale,
    x: (width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}
