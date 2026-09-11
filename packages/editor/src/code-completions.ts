import { codeLanguageSyntax } from "./code-languages";

type Kind = "keyword" | "function" | "variable" | "snippet";
type Candidate = { label: string; value: string; kind: Kind; detail: string };
export type CodeCompletion = Candidate & {
  from: number;
  to: number;
  query: string;
  select?: [number, number];
  fields?: [number, number][];
};
type Profile = {
  keywords: string;
  functions?: string;
  snippets?: [string, string, string][];
};
// Small, local authoring aids, not a type checker or a claim about installed APIs.
// Snippet fields are first-party source ranges; no code is evaluated or uploaded.
const profiles: Record<string, Profile> = {
  python: {
    keywords:
      "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield",
    functions:
      "abs all any bool dict enumerate filter float int isinstance len list map max min open print range reversed round set sorted str sum super tuple type zip",
    snippets: [
      [
        "def",
        "Function definition",
        "def ${1:function_name}(${2:parameters}):\n\t${3:pass}${0}",
      ],
      ["for", "For loop", "for ${1:item} in ${2:items}:\n\t${3:pass}${0}"],
      ["if", "Conditional", "if ${1:condition}:\n\t${2:pass}${0}"],
      [
        "with",
        "Context manager",
        "with ${1:expression} as ${2:value}:\n\t${3:pass}${0}",
      ],
    ],
  },
  julia: {
    keywords:
      "baremodule begin break catch const continue do else elseif end export false finally for function global if import in isa let local macro module mutable quote return struct true try using where while",
    functions:
      "collect display eachindex enumerate filter first include last length map maximum mean minimum ones println range reshape size sort sum zeros",
    snippets: [
      [
        "function",
        "Function definition",
        "function ${1:name}(${2:arguments})\n\t${3:nothing}\nend${0}",
      ],
      [
        "for",
        "For loop",
        "for ${1:item} in ${2:items}\n\t${3:nothing}\nend${0}",
      ],
      ["if", "Conditional", "if ${1:condition}\n\t${2:nothing}\nend${0}"],
    ],
  },
  r: {
    keywords:
      "break else FALSE for function if in Inf NA NaN next NULL repeat return TRUE while",
    functions:
      "c data.frame dim head length library list lapply lm matrix mean names plot print read.csv seq str subset sum summary tail vector which",
    snippets: [
      [
        "function",
        "Function definition",
        "function(${1:arguments}) {\n\t${2:NULL}\n}${0}",
      ],
      [
        "for",
        "For loop",
        "for (${1:item} in ${2:items}) {\n\t${3:NULL}\n}${0}",
      ],
    ],
  },
  octave: {
    keywords:
      "break case catch classdef continue else elseif end for function global if otherwise parfor persistent return switch try while",
    functions:
      "abs disp eye figure length linspace load max mean min numel ones plot reshape save size sqrt sum zeros",
    snippets: [
      [
        "function",
        "Function definition",
        "function ${1:result} = ${2:name}(${3:arguments})\n\t${4:% implementation}\nend${0}",
      ],
      [
        "for",
        "For loop",
        "for ${1:i} = ${2:1:10}\n\t${3:% implementation}\nend${0}",
      ],
    ],
  },
  cpp: {
    keywords:
      "alignas auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false float for if inline int long namespace new nullptr private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while",
    functions: "abs begin end max min move printf sizeof sqrt swap",
    snippets: [
      [
        "for",
        "Range-based loop",
        "for (const auto& ${1:item} : ${2:items}) {\n\t${3:// implementation}\n}${0}",
      ],
      [
        "if",
        "Conditional",
        "if (${1:condition}) {\n\t${2:// implementation}\n}${0}",
      ],
    ],
  },
  c: {
    keywords:
      "auto break case char const continue default do double else enum extern float for if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while",
    functions:
      "calloc free malloc memcpy memset printf realloc scanf sizeof sqrt strlen",
    snippets: [
      [
        "if",
        "Conditional",
        "if (${1:condition}) {\n\t${2:/* implementation */}\n}${0}",
      ],
    ],
  },
  javascript: {
    keywords:
      "async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield",
    functions:
      "Array Boolean Date Error JSON Map Math Number Object Promise Set String console parseFloat parseInt setTimeout",
    snippets: [
      [
        "function",
        "Function declaration",
        "function ${1:name}(${2:arguments}) {\n\t${3:// implementation}\n}${0}",
      ],
      [
        "for",
        "For-of loop",
        "for (const ${1:item} of ${2:items}) {\n\t${3:// implementation}\n}${0}",
      ],
      [
        "if",
        "Conditional",
        "if (${1:condition}) {\n\t${2:// implementation}\n}${0}",
      ],
    ],
  },
  typescript: {
    keywords:
      "abstract any as asserts async await boolean break case catch class const continue declare default else enum export extends false finally for from function if implements import in infer instanceof interface is keyof let namespace never new null number of private protected public readonly return static string super switch this throw true try type typeof undefined unknown var void while yield",
    functions:
      "Array Boolean Date Error JSON Map Math Number Object Promise Set String console parseFloat parseInt",
    snippets: [
      [
        "interface",
        "Interface declaration",
        "interface ${1:Name} {\n\t${2:property}: ${3:unknown};\n}${0}",
      ],
      [
        "function",
        "Function declaration",
        "function ${1:name}(${2:arguments}) {\n\t${3:// implementation}\n}${0}",
      ],
    ],
  },
  sql: {
    keywords:
      "ALL ALTER AND AS ASC BETWEEN BY CASE CREATE CROSS DELETE DESC DISTINCT DROP ELSE END EXISTS FROM FULL GROUP HAVING IN INNER INSERT INTO IS JOIN LEFT LIKE LIMIT NOT NULL OFFSET ON OR ORDER OUTER PRIMARY RIGHT SELECT SET TABLE THEN UNION UNIQUE UPDATE VALUES WHEN WHERE WITH",
    functions: "AVG COALESCE COUNT MAX MIN SUM",
    snippets: [
      [
        "SELECT",
        "Select rows",
        "SELECT ${1:columns}\nFROM ${2:table_name}\nWHERE ${3:condition};${0}",
      ],
    ],
  },
  rust: {
    keywords:
      "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
    functions: "Some None Ok Err println vec format",
    snippets: [
      [
        "fn",
        "Function definition",
        "fn ${1:name}(${2:arguments}) {\n\t${3:// implementation}\n}${0}",
      ],
    ],
  },
  shell: {
    keywords:
      "case do done elif else esac export fi for function if in local then until while",
    functions: "cd echo printf pwd read test",
    snippets: [
      [
        "for",
        "For loop",
        'for ${1:item} in ${2:items}; do\n\t${3:echo "$item"}\ndone${0}',
      ],
    ],
  },
  latex: {
    keywords:
      "\\begin \\end \\section \\subsection \\label \\ref \\cite \\textbf \\emph \\usepackage \\documentclass",
    snippets: [
      ["\\frac", "Fraction", "\\frac{${1:numerator}}{${2:denominator}}${0}"],
      ["\\sqrt", "Square root", "\\sqrt{${1:expression}}${0}"],
    ],
  },
};

/** Conservative lexical scan: omit literals/comments and cap work per block.
 * The loaded syntax tree may add further exclusions in the view. */
function identifiers(text: string, at: number, language: string) {
  const words: { value: string; from: number; to: number }[] = [];
  const word = /[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*/uy;
  const hash = ["python", "julia", "r", "shell", "yaml"].includes(language);
  const percent = ["octave", "latex"].includes(language);
  let blocked = false;
  for (let i = 0; i < text.length;) {
    const start = i;
    const comment =
      (hash && text[i] === "#") ||
      (percent && text[i] === "%") ||
      (!hash && !percent && text.startsWith("//", i)) ||
      (language === "sql" && text.startsWith("--", i));
    if (language === "julia" && text.startsWith("#=", i)) {
      let depth = 1;
      i += 2;
      while (i < text.length && depth) {
        if (text.startsWith("#=", i)) {
          depth++;
          i += 2;
        } else if (text.startsWith("=#", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (at > start && (at < i || (depth > 0 && at === i))) blocked = true;
    } else if (comment) {
      i = text.indexOf("\n", i);
      if (i < 0) i = text.length;
      if (at > start && at <= i) blocked = true;
    } else if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      i = close < 0 ? text.length : close + 2;
      if (at > start && (at < i || (close < 0 && at === i))) blocked = true;
    } else if (
      ["javascript", "typescript"].includes(language) &&
      text[i] === "/" &&
      /(?:^|[=(:,\[!&|?;{}\n]|\breturn|\byield)\s*$/.test(
        text.slice(Math.max(0, i - 30), i),
      )
    ) {
      let bracket = false,
        closed = false;
      i++;
      while (i < text.length && text[i] !== "\n") {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === "[") bracket = true;
        if (text[i] === "]") bracket = false;
        if (text[i++] === "/" && !bracket) {
          closed = true;
          break;
        }
      }
      i = Math.min(i, text.length);
      if (at > start && (at < i || (!closed && at === i))) blocked = true;
    } else if (
      language !== "latex" &&
      /["'`]/.test(text[i]) &&
      !(
        text[i] === "'" &&
        ["octave", "julia"].includes(language) &&
        /[\w)\]}]/.test(text[i - 1] ?? "")
      ) &&
      !(
        text[i] === "'" &&
        language === "rust" &&
        /^[A-Za-z_]\w*/.test(text.slice(i + 1)) &&
        text[i + 2] !== "'"
      )
    ) {
      const delimiter =
        language === "python" && text.slice(i, i + 3) === text[i].repeat(3)
          ? text[i].repeat(3)
          : text[i];
      i += delimiter.length;
      let closed = false;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text.startsWith(delimiter, i)) {
          i += delimiter.length;
          closed = true;
          break;
        }
        i++;
      }
      i = Math.min(i, text.length);
      if (at > start && (at < i || (!closed && at === i))) blocked = true;
    } else {
      word.lastIndex = i;
      const match = word.exec(text);
      if (match) {
        i += match[0].length;
        words.push({ value: match[0], from: start, to: i });
      } else i++;
    }
  }
  return { words, blocked };
}

function expand(template: string, indent: string, base: string) {
  template = template.replace(/\t/g, indent).replace(/\n/g, "\n" + base);
  let value = "",
    end = 0;
  const fields: { order: number; range: [number, number] }[] = [];
  for (const match of template.matchAll(/\$\{(\d+)(?::([^}]*))?\}/g)) {
    value += template.slice(end, match.index);
    const from = value.length;
    value += match[2] ?? "";
    fields.push({ order: Number(match[1]), range: [from, value.length] });
    end = match.index + match[0].length;
  }
  value += template.slice(end);
  fields.sort((a, b) => (a.order || Infinity) - (b.order || Infinity));
  return {
    value,
    fields: fields.map((field) => field.range),
    select: fields[0]?.range,
  };
}

export function codeCompletions(
  text: string,
  at: number,
  language = "",
  options: { explicit?: boolean; indent?: number } = {},
): CodeCompletion[] {
  if (text.length > 100_000 || at < 0 || at > text.length) return [];
  const name = codeLanguageSyntax(language),
    scan = identifiers(text, at, name);
  if (scan.blocked) return [];
  const token = scan.words.find((w) => w.from <= at && w.to >= at);
  let from = token?.from ?? at;
  if (name === "latex" && text[from - 1] === "\\") from--;
  const query = text.slice(from, at),
    to = token?.to ?? at;
  if (
    (!options.explicit && query.replace(/^\\/, "").length < 2) ||
    query.length > 80
  )
    return [];
  const line = text.slice(text.lastIndexOf("\n", from - 1) + 1, from),
    member = /\.$/.test(line);
  const profile = profiles[name];
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  // Nearest source names first; never search other blocks, notes or accounts.
  for (const w of scan.words.sort(
    (a, b) => Math.abs(a.from - at) - Math.abs(b.from - at),
  )) {
    if (w.from === token?.from || seen.has(w.value) || w.value.length < 2)
      continue;
    if (member && text[w.from - 1] !== ".") continue;
    seen.add(w.value);
    candidates.push({
      label: w.value,
      value: w.value,
      kind: "variable",
      detail: "Name used in this block",
    });
  }
  if (profile && !member) {
    for (const [list, kind] of [
      [profile.keywords, "keyword"],
      [profile.functions, "function"],
    ] as const) {
      for (const value of list?.split(" ") ?? []) {
        const found = candidates.find((c) => c.value === value);
        if (found) {
          found.kind = kind;
          found.detail =
            kind === "keyword" ? "Language keyword" : "Common function or name";
        } else
          candidates.push({
            label: value,
            value,
            kind,
            detail:
              kind === "keyword"
                ? "Language keyword"
                : "Common function or name",
          });
      }
    }
    if (/^[ \t]*$/.test(line))
      for (const [label, detail, value] of profile.snippets ?? [])
        candidates.push({
          label: label + " …",
          value,
          kind: "snippet",
          detail,
        });
  }
  return candidates
    .filter(
      (c) =>
        c.label.toLowerCase().startsWith(query.toLowerCase()) &&
        (c.value !== text.slice(from, to) || c.kind === "snippet"),
    )
    .sort(
      (a, b) =>
        Number(b.kind === "variable") - Number(a.kind === "variable") ||
        Number(a.kind === "snippet") - Number(b.kind === "snippet"),
    )
    .slice(0, 12)
    .map((c) => ({
      ...c,
      from,
      to,
      query,
      ...(c.kind === "snippet"
        ? expand(
            c.value,
            " ".repeat(options.indent ?? 4),
            /^[ \t]*/.exec(line)![0],
          )
        : {}),
    }));
}
