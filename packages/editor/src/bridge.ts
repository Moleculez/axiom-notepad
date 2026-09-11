import { type Node as ProseNode } from "@milkdown/kit/prose/model";
import { type Transaction } from "@milkdown/kit/prose/state";
import { ReplaceStep } from "@milkdown/kit/prose/transform";
import type { TextChange } from "@axiom/markdown";
import type { Projection } from "./projection";
import { applyChanges, type SourceSelection } from "./transactions";
import { quoteBodyEdit } from "./quote-prose";
import { footnoteInput } from "./footnotes";

export class UnmappableEdit extends Error {
  constructor(
    message = "This structural edit needs the source-command adapter.",
  ) {
    super(message);
  }
}
export type BridgedEdit = { changes: TextChange[]; selection: SourceSelection };
function replacement(
  projection: Projection,
  from: number,
  to: number,
  value: string,
): BridgedEdit {
  const quote = projection.activeProse.find(
    (p) => from >= p.from && to <= p.to,
  )?.quote;
  const edit =
    footnoteInput(projection.source, { anchor: from, head: to }, value) ??
    quoteBodyEdit(projection.source, { anchor: from, head: to }, value, quote);
  return {
    changes: edit.changes,
    selection: {
      anchor: edit.selection.anchor,
      head: edit.selection.head ?? edit.selection.anchor,
    },
  };
}

function textSlice(doc: ProseNode, from: number, to: number) {
  const slice = doc.slice(from, to);
  let text = "";
  slice.content.forEach((node) => {
    if (!node.isText) throw new UnmappableEdit();
    text += node.text;
  });
  return text;
}

/** Translate an authored inline replacement; never serialize the PM document.
 * Complex structural operations are deliberately routed through source commands. */
export function bridgeTransaction(
  projection: Projection,
  transaction: Transaction,
): BridgedEdit {
  const map = projection.map;
  if (!transaction.docChanged)
    return {
      changes: [],
      selection: {
        anchor: map.sourceAt(transaction.selection.anchor),
        head: map.sourceAt(transaction.selection.head),
      },
    };
  if (
    transaction.steps.length !== 1 ||
    !(transaction.steps[0] instanceof ReplaceStep)
  )
    throw new UnmappableEdit();
  const step = transaction.steps[0];
  if (!map.editable(step.from) || !map.editable(step.to))
    throw new UnmappableEdit();
  let insert = "";
  step.slice.content.forEach((node) => {
    if (!node.isText) throw new UnmappableEdit();
    insert += node.text;
  });
  const from = map.sourceAt(step.from, 1);
  const to = step.from === step.to ? from : map.sourceAt(step.to, -1);
  if (to < from) throw new UnmappableEdit();
  const selection = {
    anchor: from + insert.length,
    head: from + insert.length,
  };
  if (projection.source.slice(from, to) === insert)
    return { changes: [], selection };
  return replacement(projection, from, to, insert);
}

/** The composing PM state is allowed to evolve without changing its DOM/schema.
 * On compositionend reduce the entire composition to one exact source patch. */
export function bridgeComposition(
  projection: Projection,
  draft: ProseNode,
): BridgedEdit | null {
  const from = projection.doc.content.findDiffStart(draft.content);
  if (from === null) return null;
  const end = projection.doc.content.findDiffEnd(draft.content);
  if (!end) return null;
  // Repeated text can make the two diff scans overlap. Keep the common prefix.
  const overlap = Math.max(0, from - Math.min(end.a, end.b));
  const oldTo = end.a + overlap,
    newTo = end.b + overlap;
  if (!projection.map.editable(from) || !projection.map.editable(oldTo))
    throw new UnmappableEdit();
  const insert = textSlice(draft, from, newTo);
  const a = projection.map.sourceAt(from, 1);
  const b = from === oldTo ? a : projection.map.sourceAt(oldTo, -1);
  if (b < a) throw new UnmappableEdit();
  return replacement(projection, a, b, insert);
}

export function draftSource(projection: Projection, edit: BridgedEdit) {
  return applyChanges(projection.source, edit.changes);
}
