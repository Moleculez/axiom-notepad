import { z } from "zod";
import { referenceDetailsSchema, type ReferenceDetails } from "./research";
import { parseBibtex, updateBibtexEntry } from "./bibliography";
export const libraryScopeSchema = z.object({ spaceId: z.uuid() }).strict();
export type LibraryScope = z.infer<typeof libraryScopeSchema>;
export const referenceTagsSchema = z
  .array(z.string().trim().min(1).max(80))
  .max(40, "Use up to 40 tags.")
  .transform((v) => [...new Set(v)]);
export const libraryDraftSchema = referenceDetailsSchema.extend({
  citeKey: z
    .string()
    .regex(
      /^[\w:./-]+$/,
      "Use letters, numbers, underscores, :, ., / or - in the citation key.",
    )
    .max(100),
  tags: referenceTagsSchema.default([]),
});
export type LibraryReference = ReferenceDetails & {
  id: string;
  space_id: string;
  cite_key: string;
  group_id: string | null;
  owner_user_id: string | null;
  canonical_id?: string;
  merged_into: string | null;
  version: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  bibtex: string;
  collections: string[];
  status: "want" | "reading" | "read" | "archived";
  pdf_count: number;
  note_count: number;
  import_source?: Record<string, unknown>;
};
export type ReferenceCollection = {
  id: string;
  name: string;
  parent_id: string | null;
  version: number;
  count: number;
};
export type LibraryPage = {
  items: LibraryReference[];
  total: number;
  nextCursor: string | null;
  collections: ReferenceCollection[];
  tags: string[];
  canEdit: boolean;
};
export type ReferenceImportItem = z.infer<typeof libraryDraftSchema> & {
  bibtex: string;
  raw: string;
  warning?: string;
};
export type LibraryPreview = {
  hash: string;
  items: ReferenceImportItem[];
  warnings: string[];
  duplicates: { key: string; id: string; title: string }[];
  count: number;
  privateCopy: boolean;
};
export type GraphNode = {
  id: string;
  kind: "note" | "reference" | "pdf";
  title: string;
  tags: string[];
  route: string;
  detail: string;
  collections: string[];
};
export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: "link" | "citation" | "association" | "pdf";
};
export type ResearchGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  indexing: boolean;
};
export function referenceIdentity(
  r: Pick<ReferenceDetails, "doi" | "arxiv" | "title" | "authors" | "year">,
) {
  const doi = r.doi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .toLowerCase();
  const arxiv = r.arxiv
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/abs\//i, "")
    .replace(/v\d+$/, "")
    .toLowerCase();
  // Deliberately conservative: punctuation and author order are meaningful.
  const normalize = (s: string) => s.trim().toLowerCase();
  return {
    doi,
    arxiv,
    title: normalize(r.title),
    authors: normalize(r.authors),
    year: normalize(r.year),
  };
}
export function duplicateReference(a: ReferenceDetails, b: ReferenceDetails) {
  const x = referenceIdentity(a),
    y = referenceIdentity(b);
  return !!(
    (x.doi && x.doi === y.doi) ||
    (x.arxiv && x.arxiv === y.arxiv) ||
    (x.title.length > 12 &&
      x.title === y.title &&
      x.authors &&
      x.authors === y.authors &&
      x.year &&
      x.year === y.year)
  );
}
export function referenceIdentityKeys(r: ReferenceDetails) {
  const { doi, arxiv, title, authors, year } = referenceIdentity(r);
  return [
    doi && `doi:${doi}`,
    arxiv && `arxiv:${arxiv}`,
    title.length > 12 && authors && year && `title:${title}:${authors}:${year}`,
  ].filter(Boolean) as string[];
}
export function parseReferenceImport(
  source: string,
  format: "bib" | "ris",
): { items: ReferenceImportItem[]; warnings: string[] } {
  if (source.length > 2_000_000)
    throw new Error("Choose a bibliography up to 2 MB.");
  const warnings: string[] = [],
    items: ReferenceImportItem[] = [];
  if (format === "bib") {
    for (const r of parseBibtex(source)) {
      const { bibtex: _bibtex, ...details } = r;
      const parsed = libraryDraftSchema.safeParse({
        ...details,
        tags: [],
        citeKey: r.citeKey,
      });
      if (!parsed.success) {
        warnings.push(`Skipped invalid entry ${r.citeKey}.`);
        continue;
      }
      items.push({ ...parsed.data, bibtex: r.bibtex, raw: r.bibtex });
    }
  } else {
    let fields: Record<string, string[]> = {},
      raw: string[] = [],
      last = "";
    const finish = () => {
      if (!raw.length) return;
      const get = (...names: string[]) =>
        names.map((n) => fields[n]?.join(" ")).find(Boolean) ?? "";
      const title = get("TI", "T1", "CT"),
        year = get("PY", "Y1").slice(0, 4);
      const key =
        (
          get("ID") ||
          `${(fields.AU?.[0] ?? fields.A1?.[0] ?? "paper").split(",")[0]}${year}`
        )
          .replace(/[^\w:./-]/g, "")
          .slice(0, 95) || "paper";
      const parsed = libraryDraftSchema.safeParse({
        citeKey: key,
        title,
        authors: (fields.AU ?? fields.A1 ?? []).join(" and "),
        year,
        venue: get("JO", "JF", "T2"),
        url: get("UR"),
        doi: get("DO"),
        arxiv: (fields.AN?.find((v) => /^arxiv:/i.test(v)) ?? "").replace(
          /^arxiv:\s*/i,
          "",
        ),
        tags: fields.KW ?? [],
      });
      if (parsed.success)
        items.push({
          ...parsed.data,
          raw: raw.join("\n"),
          bibtex: updateBibtexEntry("", key, {
            title,
            author: parsed.data.authors,
            year,
            journal: parsed.data.venue,
            url: parsed.data.url,
            doi: parsed.data.doi,
          }),
        });
      else
        warnings.push(
          `Skipped invalid RIS record ${items.length + warnings.length + 1}.`,
        );
      fields = {};
      raw = [];
      last = "";
    };
    for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
      const m = /^([A-Z0-9]{2})  - ?(.*)$/.exec(line);
      if (m?.[1] === "TY" && raw.length) {
        warnings.push("A record was missing ER; review imported fields.");
        finish();
      }
      if (m) {
        raw.push(line);
        last = m[1];
        (fields[last] ??= []).push(m[2]);
        if (last === "ER") finish();
      } else if (line.trim() && last) {
        raw.push(line);
        fields[last][fields[last].length - 1] += " " + line.trim();
      }
    }
    if (raw.length) {
      warnings.push("The final record was missing ER.");
      finish();
    }
  }
  if (items.length > 1000)
    throw new Error("Import up to 1,000 references at a time.");
  if (!items.length) throw new Error("No valid references found.");
  const used = new Set<string>();
  for (const item of items) {
    const original = item.citeKey;
    let suffix = 2;
    while (used.has(item.citeKey))
      item.citeKey = `${original.slice(0, 90)}-${suffix++}`;
    used.add(item.citeKey);
    if (item.citeKey !== original) {
      item.warning = `Repeated key ${original} renamed to ${item.citeKey}.`;
      warnings.push(item.warning);
      item.bibtex = item.bibtex.replace(
        /^(@\w+\s*\{\s*)[^,]+/,
        `$1${item.citeKey}`,
      );
    }
  }
  return { items, warnings };
}
export function formatRis(
  r: Pick<
    LibraryReference,
    | "cite_key"
    | "title"
    | "authors"
    | "year"
    | "venue"
    | "doi"
    | "url"
    | "tags"
    | "arxiv"
  > &
    Pick<LibraryReference, "import_source">,
) {
  const field = (k: string, v: string) =>
    v ? `${k}  - ${v.replace(/[\r\n]+/g, " ")}\n` : "";
  // Preserve unmapped RIS fields (abstract, pages, publisher, etc.) while replacing
  // editable fields with their current values. Never reinstate stale metadata.
  const raw =
    r.import_source?.format === "ris" ? String(r.import_source.raw ?? "") : "";
  const records = raw.split(/\r?\n(?=[A-Z0-9]{2}  -)/);
  const known = new Set([
    "TY",
    "ID",
    "TI",
    "T1",
    "CT",
    "AU",
    "A1",
    "PY",
    "Y1",
    "JO",
    "JF",
    "T2",
    "DO",
    "UR",
    "KW",
    "ER",
  ]);
  const retained = records
    .filter(
      (line) =>
        /^[A-Z0-9]{2}  -/.test(line) &&
        !known.has(line.slice(0, 2)) &&
        !/^AN  - arxiv:/i.test(line),
    )
    .join("\n");
  const type = /^TY  - (\w+)/m.exec(raw)?.[1] ?? "JOUR";
  return (
    field("TY", type) +
    field("ID", r.cite_key) +
    field("TI", r.title) +
    r.authors
      .split(/\s+and\s+/)
      .map((a) => field("AU", a))
      .join("") +
    field("PY", r.year) +
    field("JO", r.venue) +
    field("DO", r.doi) +
    field("UR", r.url) +
    field("AN", r.arxiv ? "arXiv:" + r.arxiv : "") +
    r.tags.map((t) => field("KW", t)).join("") +
    (retained ? retained + "\n" : "") +
    "ER  -"
  );
}
