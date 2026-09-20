import { versionDiff, type VersionDiff } from "./version-diff";
export type PdfComparison = {
  left: number | null;
  right: number | null;
  status: "same" | "changed" | "added" | "removed" | "unavailable";
  diff?: VersionDiff;
};
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
/** Bounded monotone exact-page alignment. Ambiguous/reflowed pages remain manual pairs. */
export function comparePdfText(
  left: string[],
  right: string[],
): PdfComparison[] {
  if (left.length > 2000 || right.length > 2000)
    throw new Error("Compare up to 2,000 pages per PDF.");
  if ([...left, ...right].some((t) => t.length > 100000))
    throw new Error("A page exceeds the 100,000-character comparison limit.");
  const a = left.map(normalize),
    b = right.map(normalize),
    out: PdfComparison[] = [];
  const push = (i: number | null, j: number | null) => {
    const old = i === null ? "" : a[i],
      next = j === null ? "" : b[j];
    const status =
      i === null
        ? "added"
        : j === null
          ? "removed"
          : !old || !next
            ? "unavailable"
            : old === next
              ? "same"
              : "changed";
    out.push({
      left: i === null ? null : i + 1,
      right: j === null ? null : j + 1,
      status,
      ...(status === "changed" ? { diff: versionDiff(old, next) } : {}),
    });
  };
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i === a.length) {
      push(null, j++);
      continue;
    }
    if (j === b.length) {
      push(i++, null);
      continue;
    }
    if (a[i] && a[i] === b[j]) {
      push(i++, j++);
      continue;
    }
    const nextRight = a[i] ? b.slice(j + 1, j + 41).indexOf(a[i]) : -1;
    const nextLeft = b[j] ? a.slice(i + 1, i + 41).indexOf(b[j]) : -1;
    if (nextRight >= 0 && (nextLeft < 0 || nextRight <= nextLeft)) {
      for (let n = 0; n <= nextRight; n++) push(null, j++);
    } else if (nextLeft >= 0) {
      for (let n = 0; n <= nextLeft; n++) push(i++, null);
    } else push(i++, j++);
  }
  return out;
}
