import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import {
  pdfCopyText,
  pdfPageRange,
  pdfSafeLink,
  pdfTextMatches,
  pdfAnswerCitations,
} from "../packages/shared/src/pdf-reader";
import { organizePdf } from "../apps/web/lib/tools/pdf-organize";
import {
  defaults,
  preferencesSchema,
  appearanceForClient,
  APPEARANCE_SCHEMA_HEADER,
} from "../packages/shared/src/appearance";
describe("PDF research reader", () => {
  it("migrates v8 appearance without restyling and strips reader preferences for v8 clients", () => {
    const { pdfReader: _reader, ...existing } = defaults;
    const old = { ...existing, schemaVersion: 8, proseSize: 23 };
    const upgraded = preferencesSchema.parse(old);
    expect(upgraded.proseSize).toBe(23);
    expect(upgraded.pdfReader).toEqual(defaults.pdfReader);
    const projected = appearanceForClient(
      new Request("http://localhost/preferences", {
        headers: { [APPEARANCE_SCHEMA_HEADER]: "8" },
      }),
      { version: 1, preferences: upgraded },
    );
    expect(projected?.preferences).toEqual(old);
    expect(() =>
      preferencesSchema.parse({
        ...upgraded,
        pdfReader: { ...upgraded.pdfReader, navigatorWidth: 9999 },
      }),
    ).toThrow();
  });
  it("only makes assistant page references navigable when present in submitted evidence", () => {
    expect(
      pdfAnswerCitations(
        "Evidence [p. 2], invented [p. 7], repeated [p. 2]",
        "[p. 2]\nSample\n[p. 3]\nOther",
      ),
    ).toEqual([
      { page: 2, supported: true },
      { page: 7, supported: false },
    ]);
    expect(
      pdfAnswerCitations("[p. 9]", "Inline [p. 9] is not an evidence boundary"),
    ).toEqual([{ page: 9, supported: false }]);
  });
  it("parses and deduplicates explicit page selections without expanding unbounded ranges", () => {
    expect(pdfPageRange("1, 3-5, 3", 9)).toEqual([1, 3, 4, 5]);
    for (const value of ["", "0", "5-2", "1-999999", "2,", "1.2", "-1", "NaN"])
      expect(() => pdfPageRange(value, 10000)).toThrow();
  });
  it("finds individual occurrences and respects whole-word/case options", () => {
    expect(
      pdfTextMatches("Energy energy energetic energy", "energy", 2).map(
        (m) => m.start,
      ),
    ).toEqual([0, 7, 24]);
    expect(
      pdfTextMatches("a cat catalog CAT", "cat", 1, false, true).map(
        (m) => m.start,
      ),
    ).toEqual([2, 14]);
    expect(
      pdfTextMatches("CAT cat", "cat", 1, true).map((m) => m.start),
    ).toEqual([4]);
    expect(pdfTextMatches("能量 能量", "能量", 1)).toHaveLength(2);
    expect(pdfTextMatches("a", " ", 1)).toEqual([]);
  });
  it("rejects executable and local link targets", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,a",
      "file:///a",
      "/relative",
      "blob:https://example.com/a",
    ])
      expect(pdfSafeLink(url)).toBeNull();
    expect(pdfSafeLink("https://doi.org/10.1/test")).toBe(
      "https://doi.org/10.1/test",
    );
    expect(pdfCopyText("quan-\ntum\nmechanics\n\nEvidence.")).toBe(
      "quantum mechanics\n\nEvidence.",
    );
  });
  it("creates reordered, duplicated, rotated copies while retaining untouched source bytes", async () => {
    const source = await PDFDocument.create();
    source.addPage([400, 500]);
    source.addPage([300, 600]).setRotation(degrees(90));
    const bytes = await source.save(),
      before = bytes.slice();
    const result = await organizePdf(
      [bytes],
      [
        { source: 0, page: 2, rotation: 90 },
        { source: 0, page: 1, rotation: 0 },
        { source: 0, page: 1, rotation: 270 },
      ],
    );
    const copy = await PDFDocument.load(result);
    expect(copy.getPageCount()).toBe(3);
    expect(copy.getPage(0).getWidth()).toBe(300);
    expect(copy.getPage(0).getRotation().angle).toBe(180);
    expect(copy.getPage(2).getRotation().angle).toBe(270);
    expect(bytes).toEqual(before);
    await expect(organizePdf([bytes], [])).rejects.toThrow();
    await expect(
      organizePdf([bytes], [{ source: 2, page: 1, rotation: 0 }]),
    ).rejects.toThrow();
    await expect(
      organizePdf([bytes], [{ source: 0, page: 1, rotation: 45 }]),
    ).rejects.toThrow();
  });
  it("refuses to silently strip form fields", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    doc.getForm().createTextField("author").addToPage(page);
    await expect(
      organizePdf([await doc.save()], [{ source: 0, page: 1, rotation: 0 }]),
    ).rejects.toThrow("form or signature");
  });
});
