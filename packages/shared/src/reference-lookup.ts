import { XMLParser } from "fast-xml-parser";
import { decodeHTML } from "entities";
import { HttpError } from "./access";
import {
  normalizeIdentifier,
  referenceDetailsSchema,
  type ReferenceDetails,
} from "./research";
const clean = (v: unknown, max = 200) =>
  decodeHTML(String(v ?? "").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const list = (v: any) => (Array.isArray(v) ? v : v ? [v] : []);
export function crossrefDetails(payload: any): ReferenceDetails {
  const m = payload.message;
  if (!m || !m.title?.[0])
    throw new HttpError(404, "No metadata was found for this DOI.");
  return referenceDetailsSchema.parse({
    title: clean(m.title[0]),
    authors: list(m.author)
      .map((a: any) =>
        clean(a.name || [a.given, a.family].filter(Boolean).join(" ")),
      )
      .join(" and ")
      .slice(0, 2000),
    year: clean((m.published ?? m.issued)?.["date-parts"]?.[0]?.[0], 20),
    doi: clean(m.DOI, 300).toLowerCase(),
    arxiv: "",
    venue: clean(m["container-title"]?.[0], 500),
    url: "https://doi.org/" + encodeURI(clean(m.DOI, 300)),
  });
}
export function arxivDetails(
  xml: string,
  identifier: string,
): ReferenceDetails {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new HttpError(502, "The metadata provider returned unsupported XML.");
  const feed = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    parseTagValue: false,
  }).parse(xml)?.feed;
  const entry = list(feed?.entry).find((e: any) =>
    String(e.id).includes("/abs/"),
  );
  if (!entry)
    throw new HttpError(
      404,
      "No metadata was found for this arXiv identifier.",
    );
  return referenceDetailsSchema.parse({
    title: clean(entry.title),
    authors: list(entry.author)
      .map((a: any) => clean(a.name))
      .join(" and ")
      .slice(0, 2000),
    year: clean(entry.published, 4),
    doi: clean(entry["arxiv:doi"], 300),
    arxiv: identifier,
    venue: clean(entry["arxiv:journal_ref"], 500),
    url: "https://arxiv.org/abs/" + identifier,
  });
}
export async function lookupReference(value: string) {
  const { provider, identifier } = normalizeIdentifier(value);
  const endpoint =
    provider === "crossref"
      ? "https://api.crossref.org/works/" + encodeURIComponent(identifier)
      : "https://export.arxiv.org/api/query?id_list=" +
        encodeURIComponent(identifier) +
        "&max_results=1";
  const response = await fetch(endpoint, {
    headers: {
      accept:
        provider === "crossref" ? "application/json" : "application/atom+xml",
      "user-agent": "AxiomResearchNotebook/0.2 (explicit identifier lookup)",
    },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  }).catch(() => {
    throw new HttpError(
      502,
      "Metadata lookup is unavailable. Retry later or enter the reference manually.",
    );
  });
  if (response.status === 429 || response.status === 503)
    throw new HttpError(
      429,
      `The metadata service is busy. Retry ${response.headers.get("retry-after")?.match(/^\d+$/) ? "in " + Math.min(Number(response.headers.get("retry-after")), 3600) + " seconds" : "later"}.`,
    );
  if (response.status === 404)
    throw new HttpError(
      404,
      "This identifier was not found. You can still add it manually.",
    );
  if (!response.ok || !response.body)
    throw new HttpError(502, "The metadata provider returned an error.");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000)
        throw new HttpError(502, "The metadata response is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return {
    provider,
    identifier,
    details:
      provider === "crossref"
        ? crossrefDetails(JSON.parse(body))
        : arxivDetails(body, identifier),
  };
}
