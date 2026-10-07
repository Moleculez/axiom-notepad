import type { VisualPlacement } from "@axiom/shared/visual-annotations";

type Identity = { id?: string; from?: number };
/** Match the first item satisfying id OR source position, just like Array.find.
 * Indexes live for one reconciliation/action, never across document revisions. */
export function visualLookup<T>(
  items: Iterable<T>,
  identity: (item: T) => Identity,
) {
  const ids = new Map<string, { item: T; order: number }>();
  const positions = new Map<number, { item: T; order: number }>();
  let order = 0;
  for (const item of items) {
    const key = identity(item),
      value = { item, order: order++ };
    if (key.id !== undefined && !ids.has(key.id)) ids.set(key.id, value);
    if (
      key.from !== undefined &&
      Number.isFinite(key.from) &&
      !positions.has(key.from)
    )
      positions.set(key.from, value);
  }
  return (key: Identity): T | undefined => {
    const id = key.id !== undefined ? ids.get(key.id) : undefined;
    const at = key.from !== undefined ? positions.get(key.from) : undefined;
    return id && at
      ? id.order <= at.order
        ? id.item
        : at.item
      : (id ?? at)?.item;
  };
}

/** Mirrors samePlacement, including anchored-vs-static and version/path scopes. */
export function visualPlacementKey(placement: VisualPlacement) {
  return JSON.stringify([
    placement.resourceId,
    placement.path,
    placement.versionId,
    placement.revision,
    placement.anchor
      ? [
          "anchor",
          placement.anchor.generation,
          placement.anchor.start,
          placement.anchor.end,
        ]
      : ["range", placement.from, placement.to],
  ]);
}
