import {
  scanBibtex,
  editBibtexRecord,
  bibtexRecordSource,
} from "./bibtex-model";
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
  const document = scanBibtex(source);
  return document.records
    .filter((r) => r.key)
    .map((r) => {
      const field = (name: string) => r.fields[name]?.value ?? "";
      return {
        citeKey: r.key,
        title: (field("title") || r.key).replace(/[{}]/g, ""),
        authors: field("author").replace(/[{}]/g, ""),
        year: field("year"),
        url:
          field("url") ||
          (field("doi") ? "https://doi.org/" + field("doi") : ""),
        bibtex: bibtexRecordSource(document, r),
        doi: field("doi"),
        arxiv: field("eprint"),
        venue: field("journal") || field("booktitle"),
      };
    });
}
export function formatBibtex(r: {
  cite_key: string;
  title: string;
  authors: string;
  year: string;
  url: string;
  bibtex?: string;
}) {
  return (
    r.bibtex ||
    editBibtexRecord("", r.cite_key, {
      title: r.title,
      author: r.authors,
      year: r.year,
      url: r.url,
    })
  );
}
/** Replace only selected value spans; preserve key, delimiters and unknown fields. */
export const updateBibtexEntry = editBibtexRecord;
