import { nodeAt, tableModel, type MarkdownNode } from "@axiom/markdown";
import type { NativeBinding } from "./binding";
import { compareRelativePositions } from "yjs";

type Bookmark = ReturnType<NativeBinding["relative"]>;
/** Row boundary identities survive cell typing, but not row replacement/movement.
 * Nothing here is persisted in the Markdown or projected node attributes. */
export type TableTarget = {
  table: Bookmark;
  boundaries: Bookmark[];
  columns: number;
  row?: number;
  column?: number;
};

export function bookmarkTable(
  binding: NativeBinding,
  source: string,
  node: MarkdownNode,
  cell?: { row: number; column: number },
): TableTarget | null {
  const model = tableModel(source, node);
  if (!model) return null;
  return {
    table: binding.relative({ anchor: node.from, head: node.to }),
    columns: model.columns,
    boundaries: [...model.rows, model.separator].map((row) =>
      binding.relative({ anchor: row.from, head: row.to - 1 }),
    ),
    ...cell,
  };
}

export function resolveTable(
  binding: NativeBinding,
  source: string,
  target: TableTarget,
) {
  const at = binding.absolute(target.table);
  if (!at) return null;
  const node = nodeAt(source, at.anchor, ["table"]);
  const model = node && tableModel(source, node);
  if (
    !node ||
    !model ||
    node.from !== at.anchor ||
    model.columns !== target.columns ||
    model.rows.length + 1 !== target.boundaries.length
  )
    return null;
  const rows = [...model.rows, model.separator];
  if (
    rows.some((row, i) => {
      const range = binding.absolute(target.boundaries[i]);
      const live = binding.relative({ anchor: row.from, head: row.to - 1 });
      return (
        !range ||
        range.anchor !== row.from ||
        range.head !== row.to - 1 ||
        !compareRelativePositions(live.anchor, target.boundaries[i].anchor) ||
        !compareRelativePositions(live.head, target.boundaries[i].head)
      );
    })
  )
    return null;
  return { node, model, row: target.row ?? 0, column: target.column ?? 0 };
}
