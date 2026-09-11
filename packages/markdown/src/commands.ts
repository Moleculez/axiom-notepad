import type { TextChange } from "./types";
export type FormatCommand =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "math"
  | "heading"
  | "quote"
  | "task"
  | "bullet"
  | "link";
export function createEdit(
  command: FormatCommand,
  source: string,
  from: number,
  to: number,
): TextChange {
  const wrappers: Partial<Record<FormatCommand, string>> = {
    bold: "**",
    italic: "*",
    strike: "~~",
    code: "`",
    math: "$",
  };
  const value = source.slice(from, to),
    wrap = wrappers[command];
  if (wrap) {
    if (
      source.slice(from - wrap.length, from) === wrap &&
      source.slice(to, to + wrap.length) === wrap
    )
      return { from: from - wrap.length, to: to + wrap.length, insert: value };
    return {
      from,
      to,
      insert:
        wrap + (value || (command === "math" ? "E = mc^2" : "text")) + wrap,
    };
  }
  if (command === "link")
    return { from, to, insert: `[${value || "link text"}](https://)` };
  const start = source.lastIndexOf("\n", from - 1) + 1,
    end = source.indexOf("\n", to);
  const prefix = (
    { heading: "## ", quote: "> ", task: "- [ ] ", bullet: "- " } as Partial<
      Record<FormatCommand, string>
    >
  )[command]!;
  return {
    from: start,
    to: end < 0 ? source.length : end,
    insert: source
      .slice(start, end < 0 ? source.length : end)
      .split("\n")
      .map((line) =>
        line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line,
      )
      .join("\n"),
  };
}
