export type SearchMatch = { from: number; to: number };

/** Literal, UTF-16 source search. Never interpret a user's query as a regexp. */
export function findMatches(
  source: string,
  query: string,
  caseSensitive = false,
  wholeWord = false,
): SearchMatch[] {
  if (!query) return [];
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(pattern, caseSensitive ? "gu" : "giu");
  const matches: SearchMatch[] = [];
  for (const match of source.matchAll(expression)) {
    const from = match.index,
      to = from + match[0].length;
    if (
      wholeWord &&
      (/[\p{L}\p{N}\p{M}_]$/u.test(source.slice(Math.max(0, from - 2), from)) ||
        /^[\p{L}\p{N}\p{M}_]/u.test(source.slice(to, to + 2)))
    )
      continue;
    matches.push({ from, to });
  }
  return matches;
}
