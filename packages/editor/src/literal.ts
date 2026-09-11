import type { MarkdownNode, TextChange } from "@axiom/markdown";
import { footnoteDefinitionAt, footnoteBody } from "@axiom/markdown";

/** Literal code/TeX never decodes escapes or entities. Container prefixes are
 * hidden, but every visible character keeps its original source position. */
export function literalBody(source: string, node: MarkdownNode) {
  const from = node.contentFrom ?? node.from;
  let text = node.text ?? source.slice(from, node.contentTo ?? node.to);
  if (node.type === "codeBlock") text = text.replace(/\n$/, "");
  const offsets: number[] = [];
  let start = from;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const newline = source.indexOf("\n", start);
    const end = Math.min(
      node.contentTo ?? node.to,
      newline < 0
        ? source.length
        : newline - (source[newline - 1] === "\r" ? 1 : 0),
    );
    const raw = source.slice(start, end);
    const at = raw.endsWith(line)
      ? end - line.length
      : start + Math.max(0, raw.indexOf(line));
    for (let i = 0; i < line.length; i++) offsets.push(Math.min(end, at + i));
    if (index < lines.length - 1) offsets.push(end);
    else offsets.push(Math.min(end, at + line.length));
    start = newline < 0 ? source.length : newline + 1;
  });
  return { text, offsets };
}

/** True only for a deletion of the entire visible body, not whitespace trimming,
 * fence edits, an already empty block, or opening a newly inserted block. */
export function emptiesLiteralBody(
  source: string,
  node: MarkdownNode,
  changes: readonly TextChange[],
) {
  if (!["codeBlock", "mathBlock"].includes(node.type)) return false;
  const body = literalBody(source, node),
    from = body.offsets[0],
    to = body.offsets.at(-1)!;
  if (!body.text.length || !changes.length) return false;
  let boundary = from;
  for (const change of [...changes].sort((a, b) => a.from - b.from)) {
    if (
      change.insert ||
      change.from !== boundary ||
      change.to < boundary ||
      change.to > to
    )
      return false;
    boundary = change.to;
  }
  return boundary === to;
}

export function literalPrefix(source: string, node: MarkdownNode) {
  const start = source.lastIndexOf("\n", node.from - 1) + 1;
  const definition = footnoteDefinitionAt(source, node.from);
  if (definition) {
    const body = footnoteBody(source, definition),
      line = body.lines.find((line) => line.from === start);
    if (line)
      return (
        (line.prefix || "    ") +
        source
          .slice(line.bodyFrom, node.from)
          .replace(/(?:[-+*]|\d+[.)])[ \t]+/g, (marker) =>
            " ".repeat(marker.length),
          )
      );
  }
  return source
    .slice(start, node.from)
    .replace(/(?:[-+*]|\d+[.)])\s+/g, (marker) => " ".repeat(marker.length));
}
