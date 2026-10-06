/** Lossless BibTeX scanning. This is a data reader, never a TeX evaluator. */
export type BibValue = {
  value: string;
  from: number;
  to: number;
  macros: string[];
};
export type BibRecord = {
  type: string;
  key: string;
  from: number;
  to: number;
  keyFrom: number;
  keyTo: number;
  raw: string;
  fields: Record<string, BibValue>;
};
export type BibDocument = {
  records: BibRecord[];
  strings: Record<string, string>;
  warnings: string[];
};

export function scanBibtex(source: string): BibDocument {
  const records: BibRecord[] = [],
    warnings: string[] = [],
    expressions = new Map<string, BibValue>();
  let pos = 0;
  const skip = () => {
    while (pos < source.length) {
      if (/\s/.test(source[pos]) || source[pos] === ",") pos++;
      else if (source[pos] === "%") {
        const end = source.indexOf("\n", pos);
        pos = end < 0 ? source.length : end + 1;
      } else break;
    }
  };
  const value = (close: string): BibValue => {
    const from = pos,
      pieces: string[] = [],
      macros: string[] = [];
    for (;;) {
      skip();
      const opening = source[pos];
      if (opening === "{" || opening === '"') {
        const start = ++pos;
        let depth = opening === "{" ? 1 : 0,
          closed = false;
        while (pos < source.length) {
          const ch = source[pos];
          if (ch === "\\") {
            pos += 2;
            continue;
          }
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (opening === "{" && depth === 0) {
              closed = true;
              break;
            }
          } else if (ch === '"' && opening === '"' && depth === 0) {
            closed = true;
            break;
          }
          pos++;
        }
        if (!closed) throw new Error("Unclosed BibTeX value.");
        pieces.push(source.slice(start, pos));
        pos++;
      } else {
        const start = pos;
        while (
          pos < source.length &&
          !/\s/.test(source[pos]) &&
          ![",", "#", close].includes(source[pos])
        )
          pos++;
        if (start === pos) throw new Error("Missing BibTeX value.");
        const token = source.slice(start, pos);
        if (/^\d+$/.test(token)) pieces.push(token);
        else {
          macros.push(token.toLowerCase());
          pieces.push(`\u0000${token.toLowerCase()}\u0000`);
        }
      }
      const end = pos;
      while (pos < source.length && /\s/.test(source[pos])) pos++;
      if (source[pos] !== "#")
        return { value: pieces.join(""), from, to: end, macros };
      pos++;
    }
  };
  while (pos < source.length) {
    if (source[pos] === "%") {
      skip();
      continue;
    }
    if (source[pos] !== "@") {
      pos++;
      continue;
    }
    const from = pos,
      match = /^@([\w-]+)\s*([({])/.exec(source.slice(pos));
    if (!match) {
      pos++;
      continue;
    }
    pos += match[0].length;
    const type = match[1].toLowerCase(),
      close = match[2] === "{" ? "}" : ")";
    skip();
    const keyFrom = pos;
    if (type === "comment") {
      let depth = 1;
      while (pos < source.length && depth) {
        if (source[pos] === "\\") {
          pos += 2;
          continue;
        }
        if (source[pos] === match[2]) depth++;
        if (source[pos] === close) depth--;
        pos++;
      }
      if (depth) throw new Error("Unclosed BibTeX comment.");
      records.push({
        type,
        key: "",
        from,
        to: pos,
        keyFrom,
        keyTo: keyFrom,
        raw: source.slice(from, pos),
        fields: {},
      });
      continue;
    }
    const fields: Record<string, BibValue> = {};
    let key = "",
      keyTo = keyFrom;
    if (!["string", "preamble"].includes(type)) {
      while (pos < source.length && ![",", close].includes(source[pos])) pos++;
      key = source.slice(keyFrom, pos).trim();
      keyTo = keyFrom + source.slice(keyFrom, pos).trimEnd().length;
      if (!key || source[pos] !== ",")
        throw new Error("Missing BibTeX entry key or fields.");
      pos++;
    }
    if (type === "preamble") {
      fields.preamble = value(close);
      warnings.push(
        "BibTeX @preamble is retained as source only; it is not activated in exports.",
      );
      skip();
    } else
      while (pos < source.length) {
        skip();
        if (source[pos] === close) break;
        const field = /^([\w-]+)\s*=\s*/.exec(source.slice(pos));
        if (!field) throw new Error("Invalid BibTeX field.");
        pos += field[0].length;
        const name = field[1].toLowerCase();
        if (Object.hasOwn(fields, name))
          warnings.push(
            `Duplicate field ${name} in ${key || "@string"}; last value wins.`,
          );
        fields[name] = value(close);
        if (type === "string") expressions.set(name, fields[name]);
      }
    if (source[pos] !== close) throw new Error("Unclosed BibTeX entry.");
    pos++;
    records.push({
      type,
      key,
      from,
      to: pos,
      keyFrom,
      keyTo,
      raw: source.slice(from, pos),
      fields,
    });
  }
  const strings: Record<string, string> = {
    jan: "January",
    feb: "February",
    mar: "March",
    apr: "April",
    may: "May",
    jun: "June",
    jul: "July",
    aug: "August",
    sep: "September",
    oct: "October",
    nov: "November",
    dec: "December",
  };
  const cache = new Map<string, string>();
  const resolve = (input: string, seen: Set<string>, depth = 0): string => {
    const result = input.replace(
      /\u0000([^\u0000]+)\u0000/g,
      (_, name: string) => {
        if (depth > 30 || seen.has(name)) {
          warnings.push(`Cyclic bibliography string: ${name}.`);
          return name;
        }
        const expression = expressions.get(name);
        if (!expression && !Object.hasOwn(strings, name)) {
          warnings.push(`Unresolved bibliography string: ${name}.`);
          return name;
        }
        if (cache.has(name)) return cache.get(name)!;
        const value = expression
          ? resolve(expression.value, new Set([...seen, name]), depth + 1)
          : strings[name];
        cache.set(name, value);
        return value;
      },
    );
    if (result.length > 200_000) {
      warnings.push(
        "Bibliography string expansion exceeds the 200,000-character limit; source is retained.",
      );
      return result.slice(0, 200_000);
    }
    return result;
  };
  for (const [name, expression] of expressions)
    strings[name] = resolve(expression.value, new Set([name]));
  for (const record of records)
    for (const field of Object.values(record.fields))
      field.value = resolve(field.value, new Set());
  return { records, strings, warnings: [...new Set(warnings)] };
}

/** Include only this entry's transitive strings, not unrelated private records. */
export function bibtexRecordSource(document: BibDocument, record: BibRecord) {
  const needed = new Set(Object.values(record.fields).flatMap((f) => f.macros));
  const strings = document.records.filter((r) => r.type === "string");
  for (let pass = 0; pass <= strings.length; pass++) {
    const before = needed.size;
    for (const r of strings)
      if (Object.keys(r.fields).some((name) => needed.has(name)))
        Object.values(r.fields)
          .flatMap((f) => f.macros)
          .forEach((name) => needed.add(name));
    if (needed.size === before) break;
  }
  return [
    ...strings
      .filter((r) => Object.keys(r.fields).some((name) => needed.has(name)))
      .map((r) => r.raw),
    record.raw,
  ].join("\n");
}
export function renameBibtexRecord(source: string, key: string) {
  const entry = scanBibtex(source).records.find((r) => r.key);
  return entry
    ? source.slice(0, entry.keyFrom) + key + source.slice(entry.keyTo)
    : source;
}
export function editBibtexRecord(
  original: string,
  key: string,
  fields: Record<string, string>,
) {
  const entry = scanBibtex(original).records.find((r) => r.key);
  const source = entry ? original : `@article{${key},\n}`,
    record = entry ?? scanBibtex(source).records[0];
  const wrap = (value: string) =>
    "{" + value.replace(/(?<!\\)[{}]/g, (c) => "\\" + c) + "}";
  const edits = Object.entries(fields)
    .flatMap(([name, text]) => {
      const found = record.fields[name.toLowerCase()];
      return found
        ? [{ from: found.from, to: found.to, value: wrap(text) }]
        : [];
    })
    .sort((a, b) => b.from - a.from);
  let result = source;
  for (const edit of edits)
    result = result.slice(0, edit.from) + edit.value + result.slice(edit.to);
  const missing = Object.entries(fields).filter(
    ([name, text]) => !Object.hasOwn(record.fields, name.toLowerCase()) && text,
  );
  if (missing.length) {
    const end =
        record.to -
        1 +
        edits.reduce((n, e) => n + e.value.length - (e.to - e.from), 0),
      before = result.slice(0, end).trimEnd();
    result =
      before +
      (before.endsWith(",") ? "" : ",") +
      "\n" +
      missing.map(([name, text]) => `  ${name} = ${wrap(text)}`).join(",\n") +
      "\n" +
      result.slice(end);
  }
  return result;
}
