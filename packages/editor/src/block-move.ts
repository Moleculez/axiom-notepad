import type { SourceEdit } from "@axiom/markdown";
/** Move exact source, adding only the separators needed at the destination.
 * Offsets are the current revision; callers validate their relative bookmarks. */
export function blockMove(
  source: string,
  from: number,
  to: number,
  target: number,
): SourceEdit | null {
  if (
    ![from, to, target].every(Number.isInteger) ||
    from < 0 ||
    to <= from ||
    to > source.length ||
    target < 0 ||
    target > source.length ||
    (target >= from && target <= to)
  )
    return null;
  const value = source.slice(from, to);
  const eol = /\r\n/.test(value) || /\r\n/.test(source) ? "\r\n" : "\n";
  const prefix = target && source[target - 1] !== "\n" ? eol + eol : "";
  const suffix =
    target < source.length && !/(?:\r?\n){2}$/.test(value)
      ? value.endsWith("\n")
        ? eol
        : eol + eol
      : "";
  const insert = prefix + value + suffix;
  return {
    changes: [
      { from, to, insert: "" },
      { from: target, to: target, insert },
    ].sort((a, b) => a.from - b.from),
    selection: {
      anchor: (target > to ? target - (to - from) : target) + prefix.length,
    },
  };
}
