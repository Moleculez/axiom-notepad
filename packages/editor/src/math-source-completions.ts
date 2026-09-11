import { mathSymbols, mathSymbolFields } from "./math-symbols";

export type MathSourceSuggestion = {
  label: string;
  title: string;
  symbol?: string;
  value: string;
  fields: [number, number][];
};
/** LaTeX is the whole document here, not a Markdown math node. */
export function mathSourceSuggestions(
  source: string,
  position: number,
  explicit = false,
  macros = "",
) {
  if (position < 0 || position > source.length) return null;
  const lineStart = position ? source.lastIndexOf("\n", position - 1) + 1 : 0;
  const before = source.slice(lineStart, position);
  const escaped = (at: number) => {
    let slashes = 0;
    while (at > 0 && before[--at] === "\\") slashes++;
    return slashes % 2 === 1;
  };
  // A literal \% does not start a comment; an even number of slashes does.
  for (let at = 0; at < before.length; at++)
    if (before[at] === "%" && !escaped(at)) return null;
  const environment = /\\begin\{([A-Za-z*]*)$/.exec(before);
  const command = /\\([A-Za-z]*)$/.exec(before);
  const match = environment ?? command;
  if (match && escaped(match.index)) return null;
  if (!match && (!explicit || /[A-Za-z\\]$/.test(before))) return null;
  const query = match?.[1] ?? "";
  const from = match ? position - match[0].length : position;
  let to =
    position +
    (match ? /^[A-Za-z*]*/.exec(source.slice(position))![0].length : 0);
  if (environment && source[to] === "}") to++;
  const options: MathSourceSuggestion[] = [];
  for (const symbol of mathSymbols) {
    const name = environment
      ? /^\\begin\{([^}]+)\}/.exec(symbol.insert)?.[1]
      : symbol.id;
    if (!name || !name.startsWith(query)) continue;
    options.push({
      label: environment ? `\\begin{${name}}` : `\\${name}`,
      title: symbol.title,
      symbol: symbol.id,
      value: symbol.insert,
      fields: mathSymbolFields(symbol),
    });
  }
  if (!environment) {
    const known = new Set(options.map((item) => item.label));
    for (const definition of macros.matchAll(
      /\\(?:newcommand|renewcommand|providecommand)\*?\s*(?:\{\s*)?\\([A-Za-z]+)|\\def\s*\\([A-Za-z]+)/g,
    )) {
      const name = definition[1] ?? definition[2],
        label = `\\${name}`;
      if (!name.startsWith(query) || known.has(label)) continue;
      known.add(label);
      options.push({ label, title: "Project macro", value: label, fields: [] });
    }
  }
  return options.length ? { from, to, options } : null;
}

/** Exact source ranges: TeX is never passed through another snippet grammar. */
export function mathSourceInsertion(
  value: string,
  fields: readonly [number, number][],
  from: number,
  to = from,
) {
  const ranges = fields.map(([start, end]) => {
    if (start < 0 || end < start || end > value.length)
      throw new RangeError("Invalid math placeholder");
    return { from: from + start, to: from + end };
  });
  const end = from + value.length;
  ranges.push({ from: end, to: end });
  return {
    changes: { from, to, insert: value },
    selection: { anchor: ranges[0].from, head: ranges[0].to },
    ranges,
  };
}
