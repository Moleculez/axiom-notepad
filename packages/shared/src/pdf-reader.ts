import { z } from "zod";
export const pdfReaderPreferencesSchema = z
  .object({
    layout: z.enum(["continuous", "single", "facing"]).default("continuous"),
    theme: z
      .enum(["original", "warm", "graphite", "contrast"])
      .default("original"),
    navigator: z.boolean().default(true),
    navigatorWidth: z.number().int().min(200).max(440).default(260),
  })
  .strict();
/** Reader geometry uses the unrotated PDF view box, not CSS pixels. */
export type PdfRect = [number, number, number, number];
export type PdfView = "continuous" | "single" | "facing";
export type PdfTheme = "original" | "warm" | "graphite" | "contrast";
export const PDF_EDIT_MAX_BYTES = 100 * 1024 * 1024;
export const PDF_EDIT_MAX_PAGES = 2000;
export type PdfPageChoice = { source: number; page: number; rotation: number };
export function pdfPageRange(value: string, count: number): number[] {
  const pages = new Set<number>();
  for (const part of value.trim().split(",")) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
    if (!match)
      throw new Error("Use page numbers or ranges, for example 1, 3-5.");
    const first = Number(match[1]),
      last = Number(match[2] ?? match[1]);
    if (first < 1 || last < first || last > count)
      throw new Error(
        `Choose pages between 1 and ${count}, in ascending ranges.`,
      );
    if (last - first > PDF_EDIT_MAX_PAGES)
      throw new Error("Select at most 2,000 pages.");
    for (let page = first; page <= last; page++) pages.add(page);
    if (pages.size > PDF_EDIT_MAX_PAGES)
      throw new Error("Select at most 2,000 pages.");
  }
  return [...pages];
}
export type PdfMatch = {
  page: number;
  start: number;
  end: number;
  text: string;
};
export function pdfTextMatches(
  text: string,
  query: string,
  page: number,
  matchCase = false,
  wholeWord = false,
): PdfMatch[] {
  if (!query.trim()) return [];
  const source = matchCase ? text : text.toLowerCase();
  const term = matchCase ? query.trim() : query.trim().toLowerCase();
  const matches: PdfMatch[] = [];
  const word = (s: string) => /[\p{L}\p{N}_]/u.test(s);
  let offset = 0;
  while (offset <= source.length && matches.length < 1000) {
    const start = source.indexOf(term, offset);
    if (start < 0) break;
    const end = start + term.length;
    if (
      !wholeWord ||
      ((!start || !word(source[start - 1])) &&
        (end === source.length || !word(source[end])))
    )
      matches.push({
        page,
        start,
        end,
        text: text.slice(
          Math.max(0, start - 60),
          Math.min(text.length, end + 100),
        ),
      });
    offset = end;
  }
  return matches;
}
export function pdfSafeLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function pdfCopyText(value: string) {
  return value
    .replace(/(\p{L})-\r?\n(?=\p{Ll})/gu, "$1")
    .replace(/([^\n])\r?\n(?!\r?\n)/g, "$1 ")
    .trim();
}
/** Only markers in submitted evidence may become navigable assistant citations. */
export function pdfEvidencePages(source: string): number[] {
  return [
    ...new Set(
      [...source.matchAll(/^\[p\. (\d+)\]$/gm)].map((m) => Number(m[1])),
    ),
  ];
}
export function pdfAnswerCitations(
  answer: string,
  source: string,
): { page: number; supported: boolean }[] {
  const allowed = new Set(pdfEvidencePages(source));
  return [
    ...new Set([...answer.matchAll(/\[p\. (\d+)\]/g)].map((m) => Number(m[1]))),
  ].map((page) => ({ page, supported: allowed.has(page) }));
}
