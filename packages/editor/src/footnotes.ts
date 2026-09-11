import {
  footnoteAt,
  footnoteCommand,
  quoteContext,
  containerText,
  nodeAt,
  type MarkdownNode,
  type SourceEdit,
} from "@axiom/markdown";
import type { SourceSelection } from "./transactions";
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
    return {
      changes: [{ from: line.from, to: line.to, insert: "\n" }],
      selection: { anchor: line.from + 1 },
    };
  }
  return (
    footnoteCommand(source, selection, (body, at) => {
      const edit = command(body, at);
      const exit = edit.changes[0];
      // Leaving a populated quote/list needs a blank body separator. Otherwise
      // the next letter is parsed as lazy continuation of the previous child.
      const populated = (node: MarkdownNode): boolean =>
        !!node.text?.trim() || !!node.children?.some(populated);
      const container = nodeAt(body, at.head, ["blockquote", "list"]);
      if (
        !soft &&
        exit?.insert === "" &&
        exit.to > exit.from &&
        container &&
        populated(container)
      ) {
        exit.insert = "\n";
        edit.selection.anchor++;
        if (edit.selection.head !== undefined) edit.selection.head++;
      }
      return edit;
    }) ?? undefined
  );
}

/** Ordinary rich input/paste/composition carries body text, not hidden prefixes. */
export function footnoteInput(
  source: string,
  selection: SourceSelection,
  value: string,
) {
  return footnoteCommand(source, selection, (body, at) => {
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
