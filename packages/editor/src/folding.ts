import {
  plainText,
  type MarkdownNode,
  type ParsedDocument,
  type TextChange,
} from "@axiom/markdown";
import { mapPosition, type SourceSelection } from "./transactions";

export type FoldRange = { from: number; to: number; type: string };
const kinds: Record<string, string> = {
  list: "List",
  blockquote: "Quote",
  callout: "Callout",
  theorem: "Theorem",
  proof: "Proof",
  codeBlock: "Code",
  mathBlock: "Equation",
  table: "Table",
  frontmatter: "Metadata",
  footnoteDefinition: "Footnote",
};
export function canFold(source: string, node: MarkdownNode) {
  return (
    Object.hasOwn(kinds, node.type) &&
    /\r?\n/.test(source.slice(node.from, node.to).trimEnd())
  );
}
export function foldDescription(source: string, node: MarkdownNode) {
  const label =
    node.type === "codeBlock" && node.lang
      ? `${node.lang} code`
      : node.type === "footnoteDefinition"
        ? `Footnote ${node.key}`
        : (kinds[node.type] ?? "Block");
  let first = node;
  while (
    first.children?.length &&
    [
      "list",
      "item",
      "blockquote",
      "callout",
      "theorem",
      "proof",
      "footnoteDefinition",
    ].includes(first.type)
  )
    first = first.children[0];
  const summary = plainText(first)
    .split(/\r?\n/)[0]
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  const lines = source
    .slice(node.from, node.to)
    .trimEnd()
    .split(/\r?\n/).length;
  return { label, summary, detail: `${lines} lines` };
}

/** Per-view folds. Never stored in Y.Text, undo, account preferences or presence.
 * Real edit deltas rebase scopes; replacement of the opening character retires
 * its identity, even when a peer inserts exactly the same Markdown. */
export class BlockFolds {
  ranges: FoldRange[] = [];
  has(node: FoldRange) {
    return this.ranges.some(
      (r) => r.from === node.from && r.to === node.to && r.type === node.type,
    );
  }
  toggle(node: FoldRange) {
    if (this.has(node))
      this.ranges = this.ranges.filter(
        (r) => r.from !== node.from || r.type !== node.type,
      );
    else if (this.ranges.length < 1000)
      this.ranges.push({ from: node.from, to: node.to, type: node.type });
  }
  reveal(selection: SourceSelection) {
    const from = Math.min(selection.anchor, selection.head),
      to = Math.max(selection.anchor, selection.head);
    this.ranges = this.ranges.filter((r) =>
      from === to
        ? from < r.from || from >= r.to
        : to <= r.from || from >= r.to,
    );
  }
  changed(changes: TextChange[]) {
    const joined: TextChange[] = [];
    for (const change of changes) {
      const previous = joined.at(-1);
      if (previous && previous.to === change.from) {
        previous.to = change.to;
        previous.insert += change.insert;
      } else joined.push({ ...change });
    }
    this.ranges = this.ranges
      .filter((r) => !changes.some((c) => c.from <= r.from && c.to > r.from))
      .map((r) => ({
        ...r,
        from: mapPosition(r.from, joined, 1),
        to: mapPosition(r.to, joined, -1),
      }))
      .filter((r) => r.to > r.from);
  }
  reconcile(source: string, parsed: ParsedDocument) {
    const valid = new Set<string>();
    const visit = (node: MarkdownNode) => {
      if (canFold(source, node))
        valid.add(`${node.type}:${node.from}:${node.to}`);
      node.children?.forEach(visit);
    };
    visit(parsed.ast);
    parsed.definitions?.forEach(visit);
    this.ranges = this.ranges.filter((r) =>
      valid.has(`${r.type}:${r.from}:${r.to}`),
    );
  }
}
