import {
  canvasCurve,
  canvasPort,
  type CanvasNode,
  type CanvasSide,
  type CanvasCommand,
} from "./canvas";

export type CanvasPoint = { x: number; y: number };
export type CanvasRect = CanvasPoint & { width: number; height: number };
export const canvasSides: CanvasSide[] = ["top", "right", "bottom", "left"];
export const sideVector = (side: CanvasSide): CanvasPoint => ({
  x: side === "left" ? -1 : side === "right" ? 1 : 0,
  y: side === "top" ? -1 : side === "bottom" ? 1 : 0,
});
const inside = (p: CanvasPoint, r: CanvasRect) =>
  p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;
export const intersectsCanvas = (a: CanvasRect, b: CanvasRect) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

/** Screen-sized magnet radius, reverse paint-order hit testing, no DOM dependence. */
export function canvasConnectionTarget(
  nodes: CanvasNode[],
  at: CanvasPoint,
  zoom: number,
  exclude: string,
) {
  const radius = 18 / Math.max(0.08, zoom);
  const candidates = nodes.filter((n) => n.id !== exclude);
  let closest:
    { node: CanvasNode; side: CanvasSide; distance: number } | undefined;
  for (const node of [...candidates].reverse())
    for (const side of canvasSides) {
      const p = canvasPort(node, side),
        distance = Math.hypot(p.x - at.x, p.y - at.y);
      if (distance <= radius && (!closest || distance < closest.distance))
        closest = { node, side, distance };
    }
  if (closest) return closest;
  const node = [...candidates].reverse().find((n) => inside(at, n));
  if (!node) return null;
  const side = canvasSides.reduce((best, side) => {
    const a = canvasPort(node, best),
      b = canvasPort(node, side);
    return Math.hypot(at.x - a.x, at.y - a.y) <=
      Math.hypot(at.x - b.x, at.y - b.y)
      ? best
      : side;
  });
  return { node, side, distance: 0 };
}

const bezier = (
  a: CanvasPoint,
  c: CanvasPoint,
  e: CanvasPoint,
  b: CanvasPoint,
  t: number,
) => ({
  x:
    (1 - t) ** 3 * a.x +
    3 * (1 - t) ** 2 * t * c.x +
    3 * (1 - t) * t * t * e.x +
    t ** 3 * b.x,
  y:
    (1 - t) ** 3 * a.y +
    3 * (1 - t) ** 2 * t * c.y +
    3 * (1 - t) * t * t * e.y +
    t ** 3 * b.y,
});
const shift = (p: CanvasPoint, side: CanvasSide, d: number) => ({
  x: p.x + sideVector(side).x * d,
  y: p.y + sideVector(side).y * d,
});
/** Convex-hull subdivision catches brief corner intersections that uniform
 * point sampling misses. Conservative at subpixel tangencies, never tunnels. */
function curveCrosses(
  a: CanvasPoint,
  c: CanvasPoint,
  e: CanvasPoint,
  b: CanvasPoint,
  rect: CanvasRect,
  depth = 0,
): boolean {
  const xs = [a.x, c.x, e.x, b.x],
    ys = [a.y, c.y, e.y, b.y];
  if (
    Math.max(...xs) <= rect.x ||
    Math.min(...xs) >= rect.x + rect.width ||
    Math.max(...ys) <= rect.y ||
    Math.min(...ys) >= rect.y + rect.height
  )
    return false;
  if (inside(a, rect) || inside(b, rect) || depth >= 12) return true;
  const mid = (p: CanvasPoint, q: CanvasPoint) => ({
    x: (p.x + q.x) / 2,
    y: (p.y + q.y) / 2,
  });
  const ac = mid(a, c),
    ce = mid(c, e),
    eb = mid(e, b),
    left = mid(ac, ce),
    right = mid(ce, eb),
    center = mid(left, right);
  return (
    curveCrosses(a, ac, left, center, rect, depth + 1) ||
    curveCrosses(center, right, eb, b, rect, depth + 1)
  );
}
function clearSegment(a: CanvasPoint, b: CanvasPoint, obstacles: CanvasRect[]) {
  return !obstacles.some((r) =>
    a.x === b.x
      ? a.x > r.x &&
        a.x < r.x + r.width &&
        Math.max(a.y, b.y) > r.y &&
        Math.min(a.y, b.y) < r.y + r.height
      : a.y > r.y &&
        a.y < r.y + r.height &&
        Math.max(a.x, b.x) > r.x &&
        Math.min(a.x, b.x) < r.x + r.width,
  );
}
function orthogonalRoute(
  a: CanvasPoint,
  b: CanvasPoint,
  obstacles: CanvasRect[],
) {
  const xs = [
    ...new Set([
      a.x,
      b.x,
      ...obstacles.flatMap((r) => [r.x - 20, r.x + r.width + 20]),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      a.y,
      b.y,
      ...obstacles.flatMap((r) => [r.y - 20, r.y + r.height + 20]),
    ]),
  ].sort((a, b) => a - b);
  const points = xs
    .flatMap((x) => ys.map((y) => ({ x, y })))
    .filter((p) => !obstacles.some((r) => inside(p, r)));
  const start = points.findIndex((p) => p.x === a.x && p.y === a.y),
    end = points.findIndex((p) => p.x === b.x && p.y === b.y);
  if (start < 0 || end < 0) return null;
  const distances = points.map(() => Infinity),
    previous = points.map(() => -1),
    visited = new Set<number>();
  distances[start] = 0;
  while (visited.size < points.length) {
    let next = -1;
    for (let i = 0; i < points.length; i++)
      if (!visited.has(i) && (next < 0 || distances[i] < distances[next]))
        next = i;
    if (next < 0 || distances[next] === Infinity) break;
    if (next === end) {
      const path: CanvasPoint[] = [];
      for (let i = end; i >= 0; i = previous[i]) path.unshift(points[i]);
      return path;
    }
    visited.add(next);
    for (let i = 0; i < points.length; i++) {
      const p = points[next],
        q = points[i];
      if (
        visited.has(i) ||
        (p.x !== q.x && p.y !== q.y) ||
        !clearSegment(p, q, obstacles)
      )
        continue;
      const distance =
        distances[next] + Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + 0.01;
      if (distance < distances[i]) {
        distances[i] = distance;
        previous[i] = next;
      }
    }
  }
  return null;
}
function roundedPath(points: CanvasPoint[]) {
  const p = points.filter(
    (v, i) => !i || v.x !== points[i - 1].x || v.y !== points[i - 1].y,
  );
  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1],
      b = p[i],
      c = p[i + 1],
      before = Math.hypot(b.x - a.x, b.y - a.y),
      after = Math.hypot(c.x - b.x, c.y - b.y);
    const radius = Math.min(12, before / 2, after / 2);
    d += ` L ${b.x + ((a.x - b.x) * radius) / before} ${b.y + ((a.y - b.y) * radius) / before} Q ${b.x} ${b.y} ${b.x + ((c.x - b.x) * radius) / after} ${b.y + ((c.y - b.y) * radius) / after}`;
  }
  return d + ` L ${p.at(-1)!.x} ${p.at(-1)!.y}`;
}
/** Outward tangents for all 16 side pairs; detour if a curve crosses either card. */
export function canvasEdgeGeometry(
  from: CanvasNode,
  to: CanvasNode,
  fromSide: CanvasSide = "right",
  toSide: CanvasSide = "left",
) {
  const a = canvasPort(from, fromSide),
    b = canvasPort(to, toSide),
    distance = Math.max(40, Math.hypot(a.x - b.x, a.y - b.y) / 2);
  const c = shift(a, fromSide, distance),
    e = shift(b, toSide, distance);
  const crosses =
    curveCrosses(a, c, e, b, from) || curveCrosses(a, c, e, b, to);
  if (!crosses)
    return {
      d: canvasCurve(a, b, fromSide, toSide),
      label: bezier(a, c, e, b, 0.5),
    };
  const route = orthogonalRoute(shift(a, fromSide, 32), shift(b, toSide, 32), [
    from,
    to,
  ]);
  if (!route)
    return {
      d: canvasCurve(a, b, fromSide, toSide),
      label: bezier(a, c, e, b, 0.5),
    };
  const points = [a, ...route, b],
    lengths = points
      .slice(1)
      .map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let half = lengths.reduce((a, b) => a + b, 0) / 2,
    label = a;
  for (let i = 0; i < lengths.length; i++) {
    if (half <= lengths[i]) {
      const t = lengths[i] ? half / lengths[i] : 0;
      label = {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
      break;
    }
    half -= lengths[i];
  }
  return { d: roundedPath(points), label };
}

export type CanvasArrangement =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "horizontal"
  | "vertical";
export function arrangeCanvas(
  nodes: CanvasNode[],
  mode: CanvasArrangement,
): CanvasCommand[] {
  const items = nodes.filter((n) => !n.locked);
  if (items.length < 2) return [];
  const x = Math.min(...items.map((n) => n.x)),
    y = Math.min(...items.map((n) => n.y)),
    right = Math.max(...items.map((n) => n.x + n.width)),
    bottom = Math.max(...items.map((n) => n.y + n.height));
  const sorted = [...items].sort((a, b) =>
    mode === "horizontal" ? a.x - b.x : a.y - b.y,
  );
  let cursor = mode === "horizontal" ? x : y;
  const gap =
    ((mode === "horizontal" ? right - x : bottom - y) -
      items.reduce(
        (a, n) => a + (mode === "horizontal" ? n.width : n.height),
        0,
      )) /
    (items.length - 1);
  return (mode === "horizontal" || mode === "vertical" ? sorted : items).map(
    (n) => {
      const changes: Partial<CanvasNode> =
        mode === "left"
          ? { x }
          : mode === "right"
            ? { x: right - n.width }
            : mode === "center"
              ? { x: (x + right - n.width) / 2 }
              : mode === "top"
                ? { y }
                : mode === "bottom"
                  ? { y: bottom - n.height }
                  : mode === "middle"
                    ? { y: (y + bottom - n.height) / 2 }
                    : mode === "horizontal"
                      ? { x: cursor }
                      : { y: cursor };
      cursor += (mode === "horizontal" ? n.width : n.height) + gap;
      return {
        type: "update-node",
        id: n.id,
        changes: Object.fromEntries(
          Object.entries(changes).map(([k, v]) => [k, Math.round(Number(v))]),
        ),
      };
    },
  );
}
