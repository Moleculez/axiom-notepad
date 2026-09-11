export interface ReferenceInput {
  citeKey: string;
  title: string;
  authors: string;
  year: string;
  url: string;
  bibtex: string;
  doi?: string;
  arxiv?: string;
  venue?: string;
}
export function parseBibtex(source: string): ReferenceInput[] {
  const refs: ReferenceInput[] = [];
  let i = 0;
  while (i < source.length) {
    const start = source.indexOf("@", i);
    if (start < 0) break;
    const header = /^@(\w+)\s*\{\s*([^,\s]+)\s*,/.exec(source.slice(start));
    if (!header) {
      i = start + 1;
      continue;
    }
    let j = start + header[0].length,
      depth = 1,
      quoted = false;
    for (; j < source.length && depth; j++) {
      if (source[j] === "\\") {
        j++;
        continue;
      }
      if (source[j] === '"' && depth === 1) quoted = !quoted;
      if (!quoted) {
        if (source[j] === "{") depth++;
        if (source[j] === "}") depth--;
      }
    }
    if (depth) throw new Error("Unclosed BibTeX entry.");
    const body = source.slice(start + header[0].length, j - 1);
    const fields: Record<string, string> = {};
    let k = 0;
    while (k < body.length) {
      const field = /([\w-]+)\s*=\s*/g;
      field.lastIndex = k;
      const match = field.exec(body);
      if (!match) break;
      k = field.lastIndex;
      const first = body[k];
      let end = k;
      if (first === "{") {
        let d = 1;
        end++;
        while (end < body.length && d) {
          if (body[end] === "\\") end++;
          else if (body[end] === "{") d++;
          else if (body[end] === "}") d--;
          end++;
        }
        fields[match[1].toLowerCase()] = body.slice(k + 1, end - 1);
      } else if (first === '"') {
        end++;
        while (end < body.length && body[end] !== '"') {
          if (body[end] === "\\") end++;
          end++;
        }
        fields[match[1].toLowerCase()] = body.slice(k + 1, end);
        end++;
      } else {
        end = body.indexOf(",", k);
        if (end < 0) end = body.length;
        fields[match[1].toLowerCase()] = body.slice(k, end).trim();
      }
      k = end + 1;
    }
    if (!["comment", "preamble", "string"].includes(header[1].toLowerCase()))
      refs.push({
        citeKey: header[2],
        title: (fields.title ?? header[2]).replace(/[{}]/g, ""),
        authors: (fields.author ?? "").replace(/[{}]/g, ""),
        year: fields.year ?? "",
        url: fields.url ?? (fields.doi ? "https://doi.org/" + fields.doi : ""),
        bibtex: source.slice(start, j),
        doi: fields.doi ?? "",
        arxiv: fields.eprint ?? "",
        venue: fields.journal ?? fields.booktitle ?? "",
      });
    i = j;
  }
  return refs;
}
export function formatBibtex(r: {
  cite_key: string;
  title: string;
  authors: string;
  year: string;
  url: string;
  bibtex?: string;
}) {
  if (r.bibtex) return r.bibtex;
  const clean = (s: string) =>
    s.replace(/[{}]/g, "").replace(/\\/g, "\\textbackslash{}");
  return `@article{${r.cite_key},\n  title = {${clean(r.title)}},\n  author = {${clean(r.authors)}},\n  year = {${clean(r.year)}},\n  url = {${clean(r.url)}}\n}`;
}

/** Replace only edited fields; retain entry type, citation key and unknown fields. */
export function updateBibtexEntry(
  original: string,
  citeKey: string,
  fields: Record<string, string>,
) {
  const header = /^\s*@\w+\s*\{\s*[^,\s]+\s*,/.exec(original);
  const source = header ? original : `@article{${citeKey},\n}`;
  const start = /^\s*@\w+\s*\{\s*[^,\s]+\s*,/.exec(source)![0].length;
  const edits: { from: number; to: number; value: string }[] = [],
    seen = new Set<string>();
  const wrap = (value: string) =>
    "{" + value.replace(/(?<!\\)[{}]/g, (c) => "\\" + c) + "}";
  const field = /([\w-]+)\s*=\s*/g;
  let cursor = start;
  while (cursor < source.length - 1) {
    field.lastIndex = cursor;
    const match = field.exec(source);
    if (!match) break;
    const from = field.lastIndex;
    let end = from;
    if (source[from] === "{") {
      let depth = 1;
      end++;
      while (end < source.length && depth) {
        if (source[end] === "\\") end++;
        else if (source[end] === "{") depth++;
        else if (source[end] === "}") depth--;
        end++;
      }
    } else if (source[from] === '"') {
      end++;
      while (end < source.length && source[end] !== '"') {
        if (source[end] === "\\") end++;
        end++;
      }
      end++;
    } else {
      while (end < source.length && !",}".includes(source[end])) end++;
    }
    const key = match[1].toLowerCase();
    if (Object.hasOwn(fields, key)) {
      seen.add(key);
      edits.push({ from, to: end, value: wrap(fields[key]) });
    }
    cursor = end + (source[end] === "," ? 1 : 0);
  }
  let result = source;
  for (const edit of edits.reverse())
    result = result.slice(0, edit.from) + edit.value + result.slice(edit.to);
  const missing = Object.entries(fields).filter(
    ([key, value]) => !seen.has(key) && value,
  );
  if (missing.length) {
    const end = result.lastIndexOf("}");
    const before = result.slice(0, end).trimEnd();
    result =
      before +
      (before.endsWith(",") ? "" : ",") +
      "\n" +
      missing.map(([key, value]) => `  ${key} = ${wrap(value)}`).join(",\n") +
      "\n}";
  }
  return result;
}
