import { versionDiff } from "./version-diff";
export type RevisionLine = { number: number; from: number; text: string };
export type RevisionRow = {
  before?: RevisionLine;
  after?: RevisionLine;
  changed: boolean;
  omitted?: number;
};
/** Linear line-number assignment: never rescan the whole prefix per word span. */
export function versionDiffRows(before: string, after: string): RevisionRow[] {
  const result: RevisionRow[] = [];
  let oldLine = 1,
    newLine = 1,
    removed: RevisionLine[] = [],
    added: RevisionLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++)
      result.push({ before: removed[i], after: added[i], changed: true });
    removed = [];
    added = [];
  };
  for (const span of versionDiff(before, after, false).spans) {
    const lines = span.text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    let oldAt = span.oldFrom,
      newAt = span.newFrom;
    if (span.kind === "equal") flush();
    for (const text of lines) {
      const a = { number: oldLine, from: oldAt, text },
        b = { number: newLine, from: newAt, text };
      if (span.kind === "remove") {
        removed.push(a);
        oldLine++;
        oldAt += text.length;
      } else if (span.kind === "add") {
        added.push(b);
        newLine++;
        newAt += text.length;
      } else {
        result.push({ before: a, after: b, changed: false });
        oldLine++;
        newLine++;
        oldAt += text.length;
        newAt += text.length;
      }
    }
  }
  flush();
  return result;
}
export function collapseRevisionRows(
  rows: RevisionRow[],
  context = 3,
): RevisionRow[] {
  const result: RevisionRow[] = [];
  for (let i = 0; i < rows.length;) {
    if (rows[i].changed) {
      result.push(rows[i++]);
      continue;
    }
    let end = i;
    while (end < rows.length && !rows[end].changed) end++;
    if (end - i <= context * 2 + 2) result.push(...rows.slice(i, end));
    else
      result.push(
        ...rows.slice(i, i + context),
        { changed: false, omitted: end - i - context * 2 },
        ...rows.slice(end - context, end),
      );
    i = end;
  }
  return result;
}
