import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  Decoration,
  DecorationSet,
  type DecorationAttrs,
} from "@milkdown/kit/prose/view";

/** Compatibility adapter for the pinned ProseMirror view foundation. Its stock
 * builder validates/scans every node decoration against every sibling, and
 * forChild scans all local node decorations even when there are no inline ones.
 * Isolate the typed tree/constructor boundary here and compare it with the stock
 * implementation on dependency upgrades. This is ephemeral presentation only. */
type TreeSet = DecorationSet & {
  readonly local: readonly Decoration[];
  readonly children: readonly (number | DecorationSet)[];
};
type RuntimeDecoration = Decoration & {
  readonly inline: boolean;
  copy(from: number, to: number): Decoration;
};
// The foundation marks these runtime members @internal and strips their types.
// Keep the narrow bridge here, never in app/source/transaction code. Fail early
// on an incompatible upgrade, and run stock-equivalence + browser gates.
const TreeConstructor = DecorationSet as unknown as new (
  local: readonly Decoration[],
  children: readonly (number | DecorationSet)[],
) => TreeSet;
function tree(set: DecorationSet): TreeSet {
  const value = set as TreeSet;
  if (!Array.isArray(value.local) || !Array.isArray(value.children))
    throw new Error(
      "Unsupported decoration tree; check the pinned editor foundation compatibility.",
    );
  return value;
}
function runtimeDecoration(value: Decoration): RuntimeDecoration {
  const decoration = value as RuntimeDecoration;
  if (
    typeof decoration.inline !== "boolean" ||
    typeof decoration.copy !== "function"
  )
    throw new Error(
      "Unsupported decoration value; check the pinned editor foundation compatibility.",
    );
  return decoration;
}
class IndexedDecorationSet extends TreeConstructor {
  private childIndex: Map<number, DecorationSet>;
  private inlineIndex: readonly Decoration[];
  constructor(
    local: readonly Decoration[],
    children: readonly (number | DecorationSet)[],
  ) {
    super(local, children);
    this.childIndex = new Map();
    for (let i = 0; i < children.length; i += 3)
      this.childIndex.set(
        children[i] as number,
        children[i + 2] as DecorationSet,
      );
    this.inlineIndex = local.filter(
      (decoration) => runtimeDecoration(decoration).inline,
    );
  }
  override forChild(offset: number, node: ProseNode): DecorationSet {
    if (node.isLeaf) return DecorationSet.empty;
    const child = this.childIndex.get(offset);
    const start = offset + 1,
      end = start + node.content.size;
    const clipped: Decoration[] = [];
    for (const decoration of this.inlineIndex) {
      const from = Math.max(start, decoration.from) - start;
      const to = Math.min(end, decoration.to) - start;
      if (from < to) clipped.push(runtimeDecoration(decoration).copy(from, to));
    }
    if (!clipped.length) return child ?? DecorationSet.empty;
    // Keep all overlapping inline spans: DecorationSet.locals owns splitting.
    return new IndexedDecorationSet(
      [...(child ? tree(child).local : []), ...clipped].sort(byPosition),
      child ? tree(child).children : [],
    );
  }
}
const byPosition = (a: Decoration, b: Decoration) =>
  a.from - b.from || a.to - b.to;
export type AlignedNodeDecoration = {
  from: number;
  to: number;
  attrs: DecorationAttrs;
};

/** Linear tree assembly from boundaries already obtained by walking this doc.
 * Reject invalid ranges rather than accepting arbitrary unvalidated node spans. */
export function alignedNodeDecorations(
  doc: ProseNode,
  ranges: readonly AlignedNodeDecoration[],
): DecorationSet {
  if (!ranges.length) return DecorationSet.empty;
  const pending = new Map<number, AlignedNodeDecoration[]>();
  for (const range of ranges) {
    const values = pending.get(range.from) ?? [];
    values.push(range);
    pending.set(range.from, values);
  }
  const build = (node: ProseNode, base: number): DecorationSet => {
    const local: Decoration[] = [],
      children: (number | DecorationSet)[] = [];
    node.forEach((child, offset) => {
      const position = base + offset;
      for (const range of pending.get(position) ?? []) {
        if (child.isText || range.to !== position + child.nodeSize)
          throw new RangeError(
            "Guide must align with exactly one projected block.",
          );
        local.push(
          Decoration.node(offset, offset + child.nodeSize, range.attrs),
        );
      }
      pending.delete(position);
      if (!child.isLeaf) {
        const inner = build(child, position + 1);
        if (inner !== DecorationSet.empty)
          children.push(offset, offset + child.nodeSize, inner);
      }
    });
    return local.length || children.length
      ? new IndexedDecorationSet(local.sort(byPosition), children)
      : DecorationSet.empty;
  };
  const result = build(doc, 0);
  if (pending.size)
    throw new RangeError("Guide must align with a projected block.");
  return result;
}

/** Add bounded search/presence/widgets with normal validity and mapping semantics,
 * then index the resulting tree. No upstream source or stored schema is changed. */
export function addIndexedDecorations(
  doc: ProseNode,
  base: DecorationSet,
  additions: Decoration[],
): DecorationSet {
  if (!additions.length) return base;
  const wrap = (set: DecorationSet): DecorationSet => {
    if (set === DecorationSet.empty || set instanceof IndexedDecorationSet)
      return set;
    const indexed = tree(set);
    const children = [...indexed.children];
    for (let i = 0; i < children.length; i += 3)
      children[i + 2] = wrap(children[i + 2] as DecorationSet);
    return new IndexedDecorationSet(indexed.local, children);
  };
  return wrap(base.add(doc, additions));
}
