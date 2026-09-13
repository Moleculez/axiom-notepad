import {
  footnoteAt,
  footnoteCommand,
  quoteContext,
  containerText,
  exitEmptyBlockLine,
  type MarkdownNode,
  type SourceEdit,
} from "@axiom/markdown";
import type { SourceSelection } from "./transactions";
import { listBodyEdit } from "./list-prose";
export { footnoteAt } from "@axiom/markdown";

export function footnoteEnter(
  source: string,
  selection: SourceSelection,
  soft: boolean,
  command: (body: string, selection: SourceSelection) => SourceEdit,
): SourceEdit | undefined {
  const from = Math.min(selection.anchor, selection.head),
    to = Math.max(selection.anchor, selection.head);
  const context = footnoteAt(source, from);
  if (!context || footnoteAt(source, to)?.definition !== context.definition)
    return;
  const { line, lines } = context;
  const literal = (nodes: MarkdownNode[]): boolean =>
    nodes.some(
      (node) =>
        node.from <= from &&
        from <= node.to &&
        (["codeBlock", "mathBlock"].includes(node.type) ||
          literal(node.children ?? [])),
    );
  if (
    !soft &&
    from === to &&
    line.from !== context.header.from &&
    line === lines.at(-1) &&
    line.bodyFrom === line.to &&
    !literal(context.definition.children ?? [])
  ) {
    return exitEmptyBlockLine(source, line.from, line.to, "");
  }
  return footnoteCommand(source, selection, command) ?? undefined;
}

/** Ordinary rich input/paste/composition carries body text, not hidden prefixes. */
export function footnoteInput(
  source: string,
  selection: SourceSelection,
  value: string,
) {
  return footnoteCommand(source, selection, (body, at) => {
    const listed = listBodyEdit(body, at, value);
    if (listed) return listed;
    const from = Math.min(at.anchor, at.head),
      to = Math.max(at.anchor, at.head);
    const prefix = quoteContext(body, from)?.prefix ?? "";
    const insert = containerText(value, prefix).text;
    return {
      changes: [{ from, to, insert }],
      selection: { anchor: from + insert.length },
    };
  });
}
