import type { GraphNode, GraphEdge } from "./research-library";
export type GraphPoint = { x: number; y: number };
/** Deterministic, bounded layout. A spatial grid limits repulsion to nearby nodes. */
export function layoutResearchGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  previous: Record<string, GraphPoint> = {},
) {
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id)),
    points: Record<string, GraphPoint> = {};
  sorted.forEach((n, i) => {
    const angle = i * 2.399963229728653,
      radius = Math.sqrt(i) * 75;
    points[n.id] = previous[n.id] ?? {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
  const pairs = edges.filter((e) => points[e.source] && points[e.target]);
  if (sorted.every((n) => previous[n.id])) return points;
  for (let tick = 0; tick < 100; tick++) {
    const grid = new Map<string, string[]>(),
      force: Record<string, GraphPoint> = {};
    for (const n of sorted) {
      const p = points[n.id],
        key = `${Math.floor(p.x / 180)},${Math.floor(p.y / 180)}`;
      (grid.get(key) ?? (grid.set(key, []), grid.get(key)!)).push(n.id);
      force[n.id] = { x: -p.x * 0.001, y: -p.y * 0.001 };
    }
    for (const n of sorted) {
      const p = points[n.id],
        gx = Math.floor(p.x / 180),
        gy = Math.floor(p.y / 180),
        f = force[n.id];
      for (let x = gx - 1; x <= gx + 1; x++)
        for (let y = gy - 1; y <= gy + 1; y++)
          for (const other of grid.get(`${x},${y}`) ?? []) {
            if (other === n.id) continue;
            const q = points[other],
              dx = p.x - q.x,
              dy = p.y - q.y,
              d = Math.max(1, Math.hypot(dx, dy));
            if (d < 180) {
              const power = (180 - d) * 0.07;
              f.x += ((dx || 1) / d) * power;
              f.y += (dy / d) * power;
            }
          }
    }
    for (const e of pairs) {
      const a = points[e.source],
        b = points[e.target],
        dx = b.x - a.x,
        dy = b.y - a.y,
        d = Math.max(1, Math.hypot(dx, dy)),
        power = (d - 150) * 0.014;
      force[e.source].x += (dx / d) * power;
      force[e.source].y += (dy / d) * power;
      force[e.target].x -= (dx / d) * power;
      force[e.target].y -= (dy / d) * power;
    }
    const cooling = 1 - tick / 120;
    for (const n of sorted) {
      if (previous[n.id]) continue;
      const p = points[n.id],
        f = force[n.id];
      p.x += Math.max(-15, Math.min(15, f.x)) * cooling;
      p.y += Math.max(-15, Math.min(15, f.y)) * cooling;
    }
  }
  return points;
}
export function graphNeighborhood(
  edges: GraphEdge[],
  focus: string,
  hops: number,
) {
  const ids = new Set([focus]);
  for (let i = 0; i < Math.max(0, Math.min(2, hops)); i++) {
    const next = new Set(ids);
    for (const e of edges) {
      if (ids.has(e.source)) next.add(e.target);
      if (ids.has(e.target)) next.add(e.source);
    }
    for (const id of next) ids.add(id);
  }
  return ids;
}
