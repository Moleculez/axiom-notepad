import { parsedForCommands } from "./engine";
import type { MarkdownNode, ParsedDocument } from "./types";
import type { SourceEdit } from "./editing";

/** Source-only container context. No display state or normalized Markdown is stored. */
export function sourceLine(source: string, at: number) {
  const from = at ? source.lastIndexOf("\n", at - 1) + 1 : 0;
  const newline = source.indexOf("\n", at);
  const to =
    newline < 0
      ? source.length
      : newline - (source[newline - 1] === "\r" ? 1 : 0);
  const nearest = newline >= 0 ? newline : source.lastIndexOf("\n", at - 1);
  return {
    from,
    to,
    text: source.slice(from, to),
    ending: source[nearest - 1] === "\r" ? "\r\n" : "\n",
  };
}
const prefixOf = (line: string) =>
  /^[ \t]*(?:(?:>[ \t]*)|(?:(?:[-+*]|\d+[.)])[ \t]+))*/.exec(line)![0];
const continuation = (prefix: string) =>
  prefix.replace(/(?:[-+*]|\d+[.)])[ \t]+/g, (marker) =>
    " ".repeat(marker.length),
  );

function structuralPrefix(
  source: string,
  line: ReturnType<typeof sourceLine>,
  containers: MarkdownNode[],
) {
  let at = 0;
  for (const node of containers) {
    const remaining = line.text.slice(at);
    if (node.type !== "item") {
      at += /^ {0,3}>[ \t]?/.exec(remaining)?.[0].length ?? 0;
      continue;
    }
    const marker = /^( {0,3})([-+*]|\d+[.)])([ \t]+|$)/.exec(
      source.slice(node.from, sourceLine(source, node.from).to),
    );
    if (!marker) continue;
    if (sourceLine(source, node.from).from === line.from) {
      at +=
        /^( {0,3})([-+*]|\d+[.)])([ \t]+|$)/.exec(remaining)?.[0].length ?? 0;
    } else {
      const markerWidth = marker[1].length + marker[2].length;
      let column = markerWidth;
      for (const c of marker[3]) column += c === "\t" ? 4 - (column % 4) : 1;
      const padding = column - markerWidth;
      const width = markerWidth + (padding > 4 ? 1 : padding || 1);
      column = 0;
      while (
        at < line.text.length &&
        column < width &&
        /[ \t]/.test(line.text[at])
      ) {
        column += line.text[at++] === "\t" ? 4 - (column % 4) : 1;
      }
    }
  }
  return at;
}

export function quoteContext(
  source: string,
  at: number,
  parsed: ParsedDocument = parsedForCommands(source),
) {
  const line = sourceLine(source, at);
  const containers: MarkdownNode[] = [];
  // Lists omit trailing blank lines from their range, although the last item
  // still owns them. Respect that item's insertion point when finding a path.
  const end = (node: MarkdownNode): number =>
    Math.max(
      node.to,
      node.children?.length ? end(node.children.at(-1)!) : node.to,
    );
  const visit = (nodes: MarkdownNode[]) => {
    const node =
      nodes.find((n) => n.from <= at && at < end(n)) ??
      [...nodes].reverse().find((n) => n.from <= at && at === end(n));
    if (!node) return;
    if (["blockquote", "callout", "item"].includes(node.type))
      containers.push(node);
    if (node.children) visit(node.children);
  };
  visit(parsed.ast.children ?? []);
  const quote = containers.find((n) =>
    ["blockquote", "callout"].includes(n.type),
  );
  if (!quote || line.from >= quote.to) return null;
  const authored = prefixOf(line.text);
  // Lazy prose can omit its quote prefix. New equation lines must be explicit.
  const depth = containers.filter((n) =>
    ["blockquote", "callout"].includes(n.type),
  ).length;
  const prefix = continuation(
    (authored.match(/>/g)?.length ?? 0) >= depth
      ? authored
      : prefixOf(sourceLine(source, containers.at(-1)!.from).text),
  );
  return {
    ...line,
    prefix,
    authored,
    key: containers.map((n) => n.type + ":" + n.from).join("/"),
    contentFrom: line.from + authored.length,
    structuralFrom: line.from + structuralPrefix(source, line, containers),
  };
}

/** Map snippet/CM text into a container, including positions within inserted text. */
export function containerText(value: string, prefix = "", ending = "\n") {
  let text = "";
  const offsets = [0];
  for (let at = 0; at < value.length; at++) {
    if (value[at] === "\r" && value[at + 1] === "\n")
      offsets[++at] = text.length;
    text += value[at] === "\n" ? ending + prefix : value[at];
    offsets[at + 1] = text.length;
  }
  return { text, offsets };
}

/** null is an unsafe cross-container selection; undefined means ordinary prose. */
export function quotedEquationEdit(
  source: string,
  from: number,
  to: number,
): SourceEdit | null | undefined {
  const parsed = parsedForCommands(source);
  const context = quoteContext(source, from, parsed);
  const last = quoteContext(source, to > from ? to - 1 : to, parsed);
  if (context?.key !== last?.key) return null;
  // Inspect intervening containers too, not only the endpoints around a nested quote.
  for (
    let at = source.indexOf("\n", from);
    at >= 0 && at + 1 < to;
    at = source.indexOf("\n", at + 1)
  )
    if (quoteContext(source, at + 1, parsed)?.key !== context?.key) return null;
  if (!context) return undefined;
  from = Math.max(from, context.contentFrom);
  to = Math.max(from, to);
  let lineFrom = from;
  const selected = source
    .slice(from, to)
    .split(/\r?\n/)
    .map((line, index) => {
      if (index) lineFrom = source.indexOf("\n", lineFrom) + 1;
      const prefix =
        index && line
          ? quoteContext(source, lineFrom, parsed)!.structuralFrom - lineFrom
          : 0;
      return line.slice(prefix);
    })
    .join("\n");
  const body = containerText(selected, context.prefix, context.ending).text;
  const lead =
    from > context.contentFrom ? context.ending + context.prefix : "";
  const open = lead + "$$" + context.ending + context.prefix;
  const tail =
    context.ending +
    context.prefix +
    (to < source.length && sourceLine(source, to).from === to
      ? context.ending
      : "");
  const insert = open + body + context.ending + context.prefix + "$$" + tail;
  return {
    changes: [{ from, to, insert }],
    selection: {
      anchor: from + open.length,
      head: from + open.length + body.length,
    },
  };
}

/** Insert an editable paragraph beside a quoted equation without leaving its container. */
export function quotedEquationParagraph(
  source: string,
  block: MarkdownNode,
  before: boolean,
): SourceEdit | undefined {
  const context = quoteContext(source, block.from);
  if (!context) return undefined;
  if (before) {
    // Move a first-line list marker onto the new paragraph, not a second item.
    const opening = source.slice(context.from, block.from);
    const insert = opening + context.ending + context.prefix;
    return {
      changes: [{ from: context.from, to: block.from, insert }],
      selection: { anchor: context.from + opening.length },
    };
  }
  const at = block.to;
  const next = quoteContext(source, at);
  if (
    next?.key === context.key &&
    !next.text.slice(next.authored.length).trim()
  )
    return { changes: [], selection: { anchor: next.contentFrom } };
  const lead = at > 0 && source[at - 1] === "\n" ? "" : context.ending;
  const insert =
    lead + context.prefix + (at < source.length ? context.ending : "");
  return {
    changes: [{ from: at, to: at, insert }],
    selection: { anchor: at + lead.length + context.prefix.length },
  };
}
