import { describe, expect, it } from "vitest";
import {
  annotationDataSchema,
  annotationMarkdown,
  normalizeIdentifier,
  readingInputSchema,
  unitFraction,
  scrollFraction,
  normalizeReadingData,
} from "../packages/shared/src/research";
import {
  updateBibtexEntry,
  parseBibtex,
} from "../packages/shared/src/bibliography";
import {
  crossrefDetails,
  arxivDetails,
} from "../packages/shared/src/reference-lookup";
describe("paper research contracts", () => {
  it("bounds derived progress after overscroll and document reflow without weakening validation", () => {
    expect(scrollFraction(null)).toBe(0);
    for (const scrollTop of [-100, 0, 50, 900, NaN, Infinity]) {
      const fraction = scrollFraction({
        scrollTop,
        scrollHeight: 200,
        clientHeight: 100,
      });
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
      expect(Number.isFinite(fraction)).toBe(true);
    }
    expect(
      scrollFraction({ scrollTop: 100, scrollHeight: 100, clientHeight: 150 }),
    ).toBe(0);
    expect(unitFraction(1.23)).toBe(1);
    expect(
      normalizeReadingData({ fraction: 3, label: "Keep my bookmark" }),
    ).toEqual({ fraction: 1, label: "Keep my bookmark" });
  });
  it("accepts only DOI and arXiv identifiers, never arbitrary fetch URLs", () => {
    expect(normalizeIdentifier("https://doi.org/10.1000/ABC")).toEqual({
      provider: "crossref",
      identifier: "10.1000/abc",
    });
    expect(
      normalizeIdentifier("https://arxiv.org/pdf/1706.03762v2.pdf"),
    ).toEqual({ provider: "arxiv", identifier: "1706.03762v2" });
    expect(normalizeIdentifier("hep-th/9901001").provider).toBe("arxiv");
    for (const value of [
      "http://127.0.0.1/secret",
      "file:///etc/passwd",
      "https://arxiv.org.evil.test/abs/1706.03762",
      "10.1000/abc?leak=1",
    ])
      expect(() => normalizeIdentifier(value)).toThrow();
  });
  it("anchors highlights to immutable files and bounded page coordinates", () => {
    const data = {
      kind: "highlight",
      page: 1,
      sha256: "a".repeat(64),
      rects: [[0.1, 0.2, 0.4, 0.03]],
      quote: "energy",
      body: "",
      color: "yellow",
    };
    expect(annotationDataSchema.parse(data)).toEqual(data);
    expect(() =>
      annotationDataSchema.parse({ ...data, rects: [[0.9, 0.2, 0.5, 0.1]] }),
    ).toThrow();
    expect(() =>
      annotationDataSchema.parse({ ...data, sha256: "wrong" }),
    ).toThrow();
    expect(() => annotationDataSchema.parse({ ...data, rects: [] })).toThrow();
    expect(() =>
      annotationDataSchema.parse({
        ...data,
        kind: "note",
        body: "",
        rects: [],
      }),
    ).toThrow();
  });
  it("keeps citation keys, entry types, and untouched BibTeX fields", () => {
    const original =
      "@inproceedings{stable2026,\n title={A {Quantum} Result},\n author={A. Author},\n year={2025},\n booktitle={STEM Conference},\n custom={keep {nested} values}\n}";
    const updated = updateBibtexEntry(original, "stable2026", {
      year: "2026",
      doi: "10.1000/example",
    });
    expect(updated).toContain("@inproceedings{stable2026");
    expect(updated).toContain("title={A {Quantum} Result}");
    expect(updated).toContain("custom={keep {nested} values}");
    expect(parseBibtex(updated)[0]).toMatchObject({
      citeKey: "stable2026",
      year: "2026",
      doi: "10.1000/example",
      venue: "STEM Conference",
    });
  });
  it("safely handles braces, escaped quotes and new bibliographic fields", () => {
    const source = updateBibtexEntry(
      '@article{key, title="Quoted \\"result\\"", pages={1--9}}',
      "key",
      { title: "A {literal} title", year: "2026" },
    );
    expect(source).toContain("pages={1--9}");
    expect(source).toContain("title={A \\{literal\\} title}");
    expect(parseBibtex(source)).toHaveLength(1);
  });
  it("sanitizes provider metadata and rejects XML entity definitions", () => {
    expect(
      crossrefDetails({
        message: {
          title: ["<i>Quantum</i> &amp; AI"],
          author: [{ given: "Ada", family: "Lovelace" }],
          DOI: "10.1000/AI",
          published: { "date-parts": [[2026]] },
        },
      }),
    ).toMatchObject({
      title: "Quantum & AI",
      authors: "Ada Lovelace",
      year: "2026",
      doi: "10.1000/ai",
    });
    expect(
      arxivDetails(
        "<feed><entry><id>https://arxiv.org/abs/1706.03762</id><title>Attention</title><author><name>A. Author</name></author><published>2017-06-12</published></entry></feed>",
        "1706.03762",
      ).title,
    ).toBe("Attention");
    expect(() =>
      arxivDetails('<!DOCTYPE feed [<!ENTITY x "boom">]><feed/>', "1706.03762"),
    ).toThrow();
  });
  it("does not allow a reading item to smuggle a different target kind", () => {
    const input = {
      id: crypto.randomUUID(),
      group_id: crypto.randomUUID(),
      kind: "filter",
      target_type: "note",
      target_id: crypto.randomUUID(),
      data: { label: "private" },
      version: 0,
      mutation_id: crypto.randomUUID(),
    };
    expect(() => readingInputSchema.parse(input)).toThrow();
  });
  it("produces portable page citations with escaped quotation syntax", () => {
    const md = annotationMarkdown(
      {
        id: crypto.randomUUID(),
        attachment_id: crypto.randomUUID(),
        author_id: "me",
        shared: false,
        version: 1,
        mutation_id: crypto.randomUUID(),
        deleted: false,
        updated_at: "",
        data: {
          kind: "highlight",
          page: 3,
          sha256: "a".repeat(64),
          rects: [[0, 0, 0.1, 0.1]],
          quote: "[danger](javascript:alert(1))",
          body: "My observation",
          color: "yellow",
        },
      },
      "paper.pdf",
      "key2026",
    );
    expect(md).toContain("[@key2026]");
    expect(md).toContain("#page=3&annotation=");
    expect(md).toContain("> \\[danger\\]");
  });
});
