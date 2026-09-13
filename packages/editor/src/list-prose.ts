import {
  nodeAt,
  sourceLine,
  type MarkdownNode,
  type SourceEdit,
} from "@axiom/markdown";
import { lineAt, type SourceSelection } from "./transactions";

export type ListProse = {
  itemFrom: number;
  lines: { from: number; bodyFrom: number; to: number }[];
};
export function listMarker(source: string, item: MarkdownNode) {
  const line = lineAt(source, item.from);
  const match = /^([ \t]*)((?:[-+*]|\d+[.)])[ \t]+)(\[[ xX]\][ \t]+)?/.exec(
    source.slice(item.from, line.to),
  );
  if (!match) return;
  const from = item.from + match[1].length;
  return {
    from,
    line,
    prefix: source.slice(line.from, from),
    marker: match[2],
    task: match[3] ?? "",
    bodyFrom: item.from + match[0].length,
  };
}

/** Hide structural markers, not authored content. All coordinates remain in
 * Markdown; nested lists and quoted lists keep their own independent bodies. */
export function listProse(
  source: string,
  from: number,
  to: number,
  item: MarkdownNode,
): ListProse | undefined {
  const marker = listMarker(source, item);
  if (!marker) return;
  const first = marker.line,
    prefix = marker.prefix,
    width = marker.marker.length;
  const continuation = prefix + " ".repeat(width);
  const lines: ListProse["lines"] = [];
  for (let at = from; at <= to;) {
    const line = lineAt(source, at);
    const end = Math.min(to, line.to - (source[line.to - 1] === "\r" ? 1 : 0));
    let bodyFrom = at;
    if (line.from === first.from) bodyFrom = Math.min(end, marker.bodyFrom);
    else if (line.text.startsWith(continuation))
      bodyFrom = Math.min(end, line.from + continuation.length);
    else if (prefix.includes(">") && line.text.startsWith(prefix))
      bodyFrom = Math.min(end, line.from + prefix.length);
    lines.push({ from: at, bodyFrom, to: end });
    if (line.to >= to) break;
    at = line.to + 1;
  }
  return { itemFrom: item.from, lines };
}

/** Multiline paste retains this item's container without displaying or
 * duplicating its marker. Also used on the scoped body of a footnote. */
export function listBodyEdit(
  source: string,
  selection: SourceSelection,
  value: string,
): SourceEdit | undefined {
  if (!/[\r\n]/.test(value)) return;
  const from = Math.min(selection.anchor, selection.head),
    to = Math.max(selection.anchor, selection.head);
  const item = nodeAt(source, from, ["item"]);
  if (!item || to > item.to) return;
  const line = sourceLine(source, item.from);
  const marker = listMarker(source, item);
  if (!marker) return;
  const prefix = marker.prefix + " ".repeat(marker.marker.length);
  const insert = value.replace(/\r\n|\r|\n/g, line.ending + prefix);
  return {
    changes: [{ from, to, insert }],
    selection: { anchor: from + insert.length },
  };
}

/** Joining visual lines removes the hidden continuation prefix as a unit. */
export function listBodyDelete(
  at: number,
  backward: boolean,
  body: ListProse,
): SourceEdit | undefined {
  const index = body.lines.findIndex(
    (line) => at === (backward ? line.bodyFrom : line.to),
  );
  if (index < 0) return;
  const previous = body.lines[backward ? index - 1 : index];
  const next = body.lines[backward ? index : index + 1];
  if (!previous || !next) return;
  return {
    changes: [{ from: previous.to, to: next.bodyFrom, insert: "" }],
    selection: { anchor: previous.to },
  };
}
