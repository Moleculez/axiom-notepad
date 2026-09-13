import type { MarkdownNode, SourceEdit } from "@axiom/markdown";
import { containerText, quoteContext, sourceLine } from "@axiom/markdown";
import { lineAt, mapPosition, type SourceSelection } from "./transactions";
import type { ListProse } from "./list-prose";

export type QuoteProse = {
  depth: number;
  lines: {
    from: number;
    bodyFrom: number;
    to: number;
    markers: { from: number; to: number }[];
  }[];
};
export type EditingProseNode = MarkdownNode & {
  quoteBody?: QuoteProse;
  listBody?: ListProse;
  /** Parsed images remain atoms even in an otherwise literal authoring unit. */
  images?: MarkdownNode[];
};

/** Only explicit, whitespace-completed markers are hidden during authoring.
 * Parser grammar is unchanged, and lazy continuation lines retain their text. */
export function quoteProse(
  source: string,
  from: number,
  to: number,
  depth: number,
): QuoteProse | undefined {
  if (!depth) return;
  const lines: QuoteProse["lines"] = [];
  for (let at = from; at <= to;) {
    const line = lineAt(source, at);
    const end = Math.min(to, line.to - (source[line.to - 1] === "\r" ? 1 : 0));
    const markers: QuoteProse["lines"][number]["markers"] = [];
    let cursor = at,
      bodyFrom = at;
    while (cursor < end && markers.length < depth) {
      const remaining = source.slice(cursor, end);
      const quote = /^[ \t]*>([ \t]?)/.exec(remaining);
      if (quote) {
        if (!quote[1]) break; // A bare continuation marker stays editable too.
        const markerFrom = cursor + quote[0].indexOf(">");
        cursor += quote[0].length;
        markers.push({ from: markerFrom, to: cursor });
        bodyFrom = cursor;
      } else {
        const item = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.exec(remaining);
        if (!item) break;
        cursor += item[0].length;
      }
    }
    lines.push({ from: at, bodyFrom, to: end, markers });
    if (line.to >= to) break;
    at = line.to + 1;
  }
  return lines.some((line) => line.markers.length)
    ? { depth, lines }
    : undefined;
}

/** Authored multiline body input gains explicit continuation prefixes once. */
export function quoteBodyEdit(
  source: string,
  selection: SourceSelection,
  value: string,
  quote?: QuoteProse,
): SourceEdit {
  const from = Math.min(selection.anchor, selection.head),
    to = Math.max(selection.anchor, selection.head);
  const line = quote?.lines.find(
    (line) => from >= line.bodyFrom && from <= line.to,
  );
  let insert = value;
  if (line && /[\r\n]/.test(value)) {
    const prefix =
      quoteContext(source, from)?.prefix ??
      source
        .slice(line.from, line.bodyFrom)
        .replace(/(?:[-+*]|\d+[.)])[ \t]+/g, (marker) =>
          " ".repeat(marker.length),
        );
    const ending = sourceLine(source, from).ending;
    insert = containerText(value, prefix, ending).text;
  }
  return {
    changes: [{ from, to, insert }],
    selection: { anchor: from + insert.length },
  };
}

/** The first body boundary unwraps one level of this paragraph only. A later
 * visual line boundary joins its predecessor without leaving a hidden marker. */
export function quoteBodyDelete(
  source: string,
  at: number,
  backward: boolean,
  quote: QuoteProse,
): SourceEdit | undefined {
  const index = quote.lines.findIndex(
    (line) => at === (backward ? line.bodyFrom : line.to),
  );
  if (index < 0) return;
  if (backward && index === 0) {
    const changes = quote.lines.flatMap((line) => {
      // Lazy inner prose can omit an inner prefix: never remove its ancestor.
      const marker = line.markers[quote.depth - 1];
      return marker ? [{ ...marker, insert: "" }] : [];
    });
    return { changes, selection: { anchor: mapPosition(at, changes) } };
  }
  const previous = quote.lines[backward ? index - 1 : index];
  const next = quote.lines[backward ? index : index + 1];
  if (!previous || !next) return;
  return {
    changes: [{ from: previous.to, to: next.bodyFrom, insert: "" }],
    selection: { anchor: previous.to },
  };
}
