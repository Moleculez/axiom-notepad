import { languages } from "@codemirror/language-data";
import { footnoteAt, nodeAt, sourceLine } from "@axiom/markdown";

export type CodeLanguage = {
  label: string;
  value: string;
  aliases: readonly string[];
  syntax?: string;
};

// Research-oriented ordering; the rest of the installed language catalog follows.
const research: CodeLanguage[] = [
  { label: "Python", value: "python", aliases: ["py"] },
  { label: "Julia", value: "julia", aliases: ["jl"] },
  { label: "R", value: "r", aliases: ["rscript"] },
  { label: "MATLAB", value: "matlab", aliases: [], syntax: "Octave" },
  { label: "LaTeX", value: "latex", aliases: ["tex"] },
  { label: "C++", value: "cpp", aliases: ["c++"] },
  { label: "C", value: "c", aliases: [] },
  { label: "Mathematica", value: "mathematica", aliases: ["wolfram", "wl"] },
  { label: "Fortran", value: "fortran", aliases: ["f90", "f95"] },
  {
    label: "Shell / Bash",
    value: "bash",
    aliases: ["sh", "shell", "zsh"],
    syntax: "Shell",
  },
  { label: "SQL", value: "sql", aliases: [] },
  {
    label: "JavaScript",
    value: "javascript",
    aliases: ["js", "node", "ecmascript"],
  },
  { label: "TypeScript", value: "typescript", aliases: ["ts"] },
  { label: "JSON", value: "json", aliases: ["json5"] },
  { label: "YAML", value: "yaml", aliases: ["yml"] },
  { label: "Markdown", value: "markdown", aliases: ["md"] },
  {
    label: "Mermaid diagram",
    value: "mermaid",
    aliases: ["diagram", "flowchart"],
  },
  { label: "Plain text", value: "text", aliases: ["plaintext", "txt", "none"] },
];
const valid = (value: string) => /^[\w+#.-]{1,40}$/.test(value);
export const codeLanguages: readonly CodeLanguage[] = [
  ...research,
  ...languages.flatMap((language) => {
    const value = [language.name.toLowerCase(), ...language.alias].find(valid);
    if (
      !value ||
      research.some(
        (r) =>
          r.value === value ||
          r.aliases.includes(value) ||
          r.label === language.name ||
          r.syntax === language.name,
      )
    )
      return [];
    return [
      {
        label: language.name,
        value,
        aliases: language.alias,
        syntax: language.name,
      },
    ];
  }),
];

export function codeLanguageSuggestions(
  query: string,
  preferred = "",
  limit = 12,
) {
  query = query.trim().toLowerCase();
  preferred = preferred.toLowerCase();
  return codeLanguages
    .map((language, index) => {
      const terms = [
        language.value,
        language.label.toLowerCase(),
        ...language.aliases,
      ];
      const rank = !query
        ? terms.includes(preferred)
          ? -1
          : 0
        : terms.includes(query)
          ? 0
          : terms.some((t) => t.startsWith(query))
            ? 1
            : terms.some((t) => t.includes(query))
              ? 2
              : -1;
      return { language, index, rank };
    })
    .filter((item) => !query || item.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.language);
}

/** Resolve aliases without ever rewriting stored info strings. Syntax loading
 * stays lazy, using the grammars already installed in the editor. */
export function codeLanguageSyntax(value = "") {
  const name = value.toLowerCase();
  const language = codeLanguages.find(
    (l) => l.value === name || l.aliases.includes(name),
  );
  return (language?.syntax ?? language?.value ?? name).toLowerCase();
}

/** Only opening fence info strings, never closing fences, inline code, body
 * text, math, metadata or selections inside the delimiter itself. */
export function codeFenceQuery(
  source: string,
  at: number,
): { from: number; to: number; query: string; header: number } | null {
  const footnote = footnoteAt(source, at);
  if (footnote) {
    const query = codeFenceQuery(footnote.text, footnote.bodyAt(at));
    return (
      query && {
        ...query,
        from: footnote.sourceAt(query.from),
        to: footnote.sourceAt(query.to),
        header: sourceLine(source, footnote.sourceAt(query.header)).from,
      }
    );
  }
  const line = sourceLine(source, at);
  const match =
    /^([ \t]*(?:(?:>[ \t]*)|(?:(?:[-+*]|\d+[.)])[ \t]+))*)(`{3,}|~{3,})([ \t]*)([\w+#.-]{0,40})$/.exec(
      line.text,
    );
  if (!match) return null;
  const marker = line.from + match[1].length;
  const from = marker + match[2].length + match[3].length;
  if (at < from || at > line.to) return null;
  const enclosing = nodeAt(source, marker + 1, [
    "codeBlock",
    "mathBlock",
    "frontmatter",
    "code",
  ]);
  if (
    enclosing &&
    (enclosing.type !== "codeBlock" ||
      enclosing.contentFrom === undefined ||
      sourceLine(source, enclosing.from).from !== line.from)
  )
    return null;
  return {
    from,
    to: line.to,
    query: source.slice(from, at),
    header: line.from,
  };
}
