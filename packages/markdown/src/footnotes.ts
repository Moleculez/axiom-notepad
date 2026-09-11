import { parsedForCommands } from "./engine";
import { containerText, sourceLine } from "./containers";
import type { MarkdownNode, ParsedDocument } from "./types";
import type { SourceEdit } from "./editing";

type Selection = { anchor: number; head: number };
export type FootnoteLine = {
  from: number;
  to: number;
  bodyFrom: number;
  prefix: string;
};
export type FootnoteBody = {
  definition: MarkdownNode;
  header: ReturnType<typeof sourceLine>;
  lines: FootnoteLine[];
  text: string;
  offsets: number[];
  sourceAt: (at: number) => number;
  bodyAt: (at: number) => number;
};
const bodies = new WeakMap<
  MarkdownNode,
  { source: string; body: FootnoteBody }
>();

export function footnoteDefinitionAt(
  source: string,
  at: number,
  parsed: ParsedDocument = parsedForCommands(source),
) {
  return parsed.definitions?.find(
    (node) =>
      node.type === "footnoteDefinition" &&
      node.from <= at &&
      (at < node.to || (at === source.length && at === node.to)),
  );
}

/** A view/command slice, not a second stored document. Every UTF-16 boundary
 * maps to authored source; header and four-column prefixes are never body text. */
export function footnoteBody(
  source: string,
  definition: MarkdownNode,
): FootnoteBody {
  const cached = bodies.get(definition);
  if (cached?.source === source) return cached.body;
  const header = sourceLine(source, definition.from);
  const marker = /^ {0,3}\[\^[^\]]+\]:[ \t]*/.exec(header.text);
  const lines: FootnoteLine[] = [];
  for (let pos = header.from; pos < definition.to || pos === header.from;) {
    const line = sourceLine(source, pos);
    let width = 0,
      count = 0;
    while (
      count < line.text.length &&
      width < 4 &&
      /[ \t]/.test(line.text[count])
    ) {
      width += line.text[count++] === "\t" ? 4 - (width % 4) : 1;
    }
    const prefix = width === 4 ? line.text.slice(0, count) : "";
    lines.push({
      from: line.from,
      to: line.to,
      bodyFrom:
        line.from +
        (pos === header.from ? (marker?.[0].length ?? 0) : prefix.length),
      prefix,
    });
    if (line.to >= source.length) break;
    pos = source.indexOf("\n", line.to) + 1;
    if (!pos) break;
  }
  while (lines.length > 1) {
    const last = lines.at(-1)!;
    if (last.prefix || source.slice(last.from, last.to).trim()) break;
    lines.pop();
  }
  // The marker-only header is chrome, not an extra blank paragraph. Preserve
  // an explicitly authored empty body line, including the new Enter position.
  while (
    lines.length > 1 &&
    lines[0].bodyFrom === lines[0].to &&
    !lines[0].prefix
  )
    lines.shift();
  let text = "";
  const offsets: number[] = [];
  lines.forEach((line, index) => {
    for (let at = line.bodyFrom; at < line.to; at++) {
      text += source[at];
      offsets.push(at);
    }
    offsets.push(line.to);
    if (index < lines.length - 1) text += "\n";
  });
  const sourceAt = (at: number) =>
    offsets[Math.max(0, Math.min(offsets.length - 1, at))];
  const bodyAt = (at: number) => {
    let lo = 0,
      hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid] < at) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const body = { definition, header, lines, text, offsets, sourceAt, bodyAt };
  bodies.set(definition, { source, body });
  return body;
}

export function footnoteAt(source: string, at: number) {
  const definition = footnoteDefinitionAt(source, at);
  if (!definition) return;
  const body = footnoteBody(source, definition);
  const line = body.lines.find((line) => at >= line.bodyFrom && at <= line.to);
  if (!line) return;
  return { ...body, line, prefix: line.prefix || "    " };
}

/** Undefined is outside a body; null refuses a cross-container command.
 * Only the command's individual edits are mapped back, never its serialization. */
export function footnoteCommand(
  source: string,
  selection: Selection,
  command: (body: string, at: Selection) => SourceEdit | null,
): SourceEdit | null | undefined {
  const from = Math.min(selection.anchor, selection.head),
    to = Math.max(selection.anchor, selection.head);
  const context = footnoteAt(source, from),
    end = from === to ? context : footnoteAt(source, to);
  if (!context) return undefined;
  if (end?.definition !== context.definition) return null;
  const anchor = context.bodyAt(selection.anchor),
    head = context.bodyAt(selection.head);
  const edit = command(context.text, { anchor, head });
  if (!edit) return null;
  if (
    edit.changes.some(
      (change, i) =>
        change.from < 0 ||
        change.to < change.from ||
        change.to > context.text.length ||
        (i > 0 && change.from < edit.changes[i - 1].to),
    )
  )
    return null;
  const converted = edit.changes.map((change) => ({
    change,
    insert: containerText(
      change.insert,
      context.prefix,
      sourceLine(source, context.line.from).ending,
    ),
  }));
  const changes = converted.map(({ change, insert }) => ({
    from: context.sourceAt(change.from),
    to: context.sourceAt(change.to),
    insert: insert.text,
  }));
  const position = (at: number) => {
    let bodyDelta = 0,
      sourceDelta = 0;
    for (let i = 0; i < converted.length; i++) {
      const { change, insert } = converted[i];
      const start = change.from + bodyDelta;
      if (at < start) break;
      if (at <= start + change.insert.length)
        return changes[i].from + sourceDelta + insert.offsets[at - start];
      bodyDelta += change.insert.length - (change.to - change.from);
      sourceDelta += insert.text.length - (changes[i].to - changes[i].from);
    }
    return context.sourceAt(at - bodyDelta) + sourceDelta;
  };
  return {
    changes,
    selection: {
      anchor: position(edit.selection.anchor),
      ...(edit.selection.head === undefined
        ? {}
        : { head: position(edit.selection.head) }),
    },
  };
}
