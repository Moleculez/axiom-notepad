import type { MindmapProjection, MindmapLayout, MindmapRect } from "./types";

export type MindmapCamera = { x: number; y: number; scale: number };
/** Aggregates once per projection, never once per rendered node or pan frame. */
export function mindmapIndex(projection: MindmapProjection) {
  const byId = new Map(projection.nodes.map((n) => [n.id, n]));
  const descendants = new Map<string, number>(),
    tasks = new Map<string, { total: number; complete: number }>();
  const order: string[] = [],
    pending = [projection.rootId];
  while (pending.length) {
    const id = pending.pop()!;
    order.push(id);
    pending.push(...(byId.get(id)?.children ?? []));
  }
  for (const id of order.reverse()) {
    const node = byId.get(id)!;
    let count = 0,
      total = node.checked === undefined ? 0 : 1,
      complete = node.checked ? 1 : 0;
    for (const child of node.children) {
      count += 1 + (descendants.get(child) ?? 0);
      total += tasks.get(child)?.total ?? 0;
      complete += tasks.get(child)?.complete ?? 0;
    }
    descendants.set(id, count);
    tasks.set(id, { total, complete });
  }
  return { byId, descendants, tasks };
}

/** Minimal camera movement; focus never resets the user's zoom. */
export function ensureMindmapVisible(
  camera: MindmapCamera,
  box: MindmapRect,
  width: number,
  height: number,
  margin = 48,
) {
  const left = box.x * camera.scale + camera.x,
    right = (box.x + box.width) * camera.scale + camera.x;
  const top = box.y * camera.scale + camera.y,
    bottom = (box.y + box.height) * camera.scale + camera.y;
  const x =
    right - left > width - margin * 2
      ? margin - left
      : left < margin
        ? margin - left
        : right > width - margin
          ? width - margin - right
          : 0;
  const y =
    bottom - top > height - margin * 2
      ? margin - top
      : top < margin
        ? margin - top
        : bottom > height - margin
          ? height - margin - bottom
          : 0;
  return x || y ? { ...camera, x: camera.x + x, y: camera.y + y } : camera;
}

export function visibleMindmapOrder(
  projection: MindmapProjection,
  layout: MindmapLayout,
  collapsed?: Iterable<string>,
  rootId = layout.nodes[0]?.id ?? projection.rootId,
) {
  const visible = new Set(layout.nodes.map((n) => n.id)),
    byId = new Map(projection.nodes.map((n) => [n.id, n])),
    folded = collapsed === undefined ? null : new Set(collapsed);
  const order: string[] = [],
    pending = [rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (!byId.has(id) || (!folded && !visible.has(id))) continue;
    order.push(id);
    // Keyboard intent is synchronous; layout may still describe the prior fold.
    if (folded?.has(id)) continue;
    pending.push(...[...(byId.get(id)?.children ?? [])].reverse());
  }
  return order;
}

export function selectedMindmapRoots(
  projection: MindmapProjection,
  ids: Iterable<string>,
) {
  const chosen = new Set(ids),
    byId = new Map(projection.nodes.map((n) => [n.id, n]));
  return projection.nodes
    .filter((node) => {
      if (!chosen.has(node.id)) return false;
      let parent = node.parentId;
      while (parent) {
        if (chosen.has(parent)) return false;
        parent = byId.get(parent)?.parentId ?? null;
      }
      return true;
    })
    .sort((a, b) => a.from - b.from);
}
