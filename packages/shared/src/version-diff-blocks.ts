import type { MarkdownNode, ParsedDocument } from "@axiom/markdown";
import { versionDiff, type DiffKind } from "./version-diff";
export type RevisionBlockGroup = { kind: DiffKind; nodes: MarkdownNode[] };
/** Compare atomic top-level blocks in source order. The rich view never places
 * a table row, list child, or code fence outside its original container. */
export function versionDiffBlocks(
  before: string,
  old: ParsedDocument,
  after: string,
  next: ParsedDocument,
): RevisionBlockGroup[] {
  const identities = new Map<string, number>();
  const nodes = (doc: ParsedDocument) => doc.ast.children ?? [];
  const encode = (source: string, doc: ParsedDocument) =>
    nodes(doc)
      .map((n) => {
        const key = n.type + ":" + source.slice(n.from, n.to);
        if (!identities.has(key)) identities.set(key, identities.size);
        return identities.get(key) + "\n";
      })
      .join("");
  const diff = versionDiff(encode(before, old), encode(after, next), false);
  let i = 0,
    j = 0;
  const groups: RevisionBlockGroup[] = [];
  for (const span of diff.spans) {
    const count = span.text.split("\n").length - 1;
    if (span.kind === "remove") {
      groups.push({ kind: span.kind, nodes: nodes(old).slice(i, i + count) });
      i += count;
    } else {
      groups.push({ kind: span.kind, nodes: nodes(next).slice(j, j + count) });
      j += count;
      if (span.kind === "equal") i += count;
    }
  }
  return groups;
}
