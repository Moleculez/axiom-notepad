import { parsedForCommands } from "./engine";
import { sourceLine } from "./containers";
import type { MarkdownNode } from "./types";
import type { SourceEdit } from "./editing";

/** Commands use the parsed ownership chain, not a guessed indentation size. */
export function blockPath(
  source: string,
  target: MarkdownNode,
): MarkdownNode[] {
  const visit = (
    nodes: MarkdownNode[],
    parents: MarkdownNode[],
  ): MarkdownNode[] | undefined => {
    for (const node of nodes) {
      const path = [...parents, node];
      if (node === target) return path;
      const found = visit(node.children ?? [], path);
      if (found) return found;
    }
  };
  const parsed = parsedForCommands(source);
  return (
    visit(
      [...(parsed.ast.children ?? []), ...(parsed.definitions ?? [])],
      [],
    ) ?? []
  );
}

/** Prefix for a new paragraph in this block's parent (not a new list item). */
export function parentBlockPrefix(source: string, block: MarkdownNode) {
  const line = sourceLine(source, block.from);
  return source
    .slice(line.from, block.from)
    .replace(/(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/g, (marker) =>
      " ".repeat(marker.replace(/\[[ xX]\][ \t]+$/, "").length),
    );
}

/** Exit a marker-only line. An explicit parent-level blank prevents lazy
 * continuation when the next character arrives. Never duplicate that blank. */
export function exitEmptyBlockLine(
  source: string,
  from: number,
  to: number,
  prefix: string,
  sibling = false,
): SourceEdit {
  const line = sourceLine(source, from);
  const previous = from > 0 ? sourceLine(source, from - 1) : undefined;
  const separator =
    !sibling &&
    previous &&
    previous.text.trimEnd() &&
    previous.text.trimEnd() !== prefix.trimEnd()
      ? prefix.trimEnd() + line.ending
      : "";
  const insert = separator + prefix;
  return {
    changes: [{ from, to, insert }],
    selection: { anchor: from + insert.length },
  };
}

/** Insert/reuse a real paragraph beside a block, preserving its parent scope.
 * Only blank lines are reused: neighbouring authored content is never moved. */
export function paragraphBesideBlock(
  source: string,
  block: MarkdownNode,
  before = false,
): SourceEdit {
  const first = sourceLine(source, block.from);
  const prefix = parentBlockPrefix(source, block);
  const blank = prefix.trimEnd();
  const ending = first.ending;
  const explicitQuotedBoundary =
    prefix.includes(">") &&
    ["codeBlock", "mathBlock", "table", "hr", "toc", "frontmatter"].includes(
      block.type,
    );
  if (before) {
    const opening = source.slice(first.from, block.from);
    // A first-line parent marker belongs to the new paragraph; the old block
    // becomes a continuation of the same item rather than a second item.
    const insert =
      opening +
      ending +
      (explicitQuotedBoundary ? "" : blank + ending) +
      prefix;
    return {
      changes: [{ from: first.from, to: block.from, insert }],
      selection: { anchor: first.from + opening.length },
    };
  }
  let end = block.to;
  while (end > block.from && /[\r\n]/.test(source[end - 1])) end--;
  const last = sourceLine(source, end);
  // Reuse two already-authored parent-level blank lines (separator + caret).
  const nextFrom = source.indexOf("\n", last.to);
  if (nextFrom >= 0) {
    const next = sourceLine(source, nextFrom + 1);
    if (next.text.trimEnd() === blank) {
      if (explicitQuotedBoundary)
        return {
          changes:
            next.text === prefix
              ? []
              : [{ from: next.from, to: next.to, insert: prefix }],
          selection: { anchor: next.from + prefix.length },
        };
      const afterFrom = source.indexOf("\n", next.to);
      if (afterFrom >= 0) {
        const after = sourceLine(source, afterFrom + 1);
        if (after.text.trimEnd() === blank)
          return {
            changes:
              after.text === prefix
                ? []
                : [{ from: after.from, to: after.to, insert: prefix }],
            selection: { anchor: after.from + prefix.length },
          };
      }
      const insert = ending + prefix;
      return {
        changes: [{ from: next.to, to: next.to, insert }],
        selection: { anchor: next.to + insert.length },
      };
    }
  }
  const insert =
    ending + (explicitQuotedBoundary ? "" : blank + ending) + prefix;
  return {
    changes: [{ from: last.to, to: last.to, insert }],
    selection: { anchor: last.to + insert.length },
  };
}
