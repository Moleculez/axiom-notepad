import type { ParsedDocument } from "./types";

/** Real heading ancestry, matching the outline. Skipped levels never invent
 * zero-valued parents; notes starting at H2 (or later) still begin at 1. */
export function sectionNumbers(headings: ParsedDocument["outline"]) {
  const numbers = new Map<string, string>();
  const stack: { level: number; number: string; children: number }[] = [];
  let roots = 0;
  for (const heading of headings) {
    while (stack.length && stack.at(-1)!.level >= heading.level) stack.pop();
    const parent = stack.at(-1);
    const number = parent
      ? `${parent.number}.${++parent.children}`
      : String(++roots);
    numbers.set(heading.id, number);
    stack.push({ level: heading.level, number, children: 0 });
  }
  return numbers;
}

/** View metadata only: no generated text enters selection, copy, or Markdown. */
export function sectionNumberAttributes(
  number: string | undefined,
): Record<string, string> {
  return number
    ? {
        "data-section-number": number,
        style: `--section-number-chars:${number.length}`,
      }
    : {};
}
