import { describe, it, expect } from "vitest";
import {
  pdfOcrSettingsSchema,
  pdfOcrMarkdown,
  type PdfOcrPage,
} from "../packages/shared/src/pdf-ocr";
describe("private batch OCR contract", () => {
  it("rejects duplicate/out-of-range pages and unprovisioned languages", () => {
    for (const settings of [
      { pages: [1, 1], language: "eng" },
      { pages: [0], language: "eng" },
      { pages: [2001], language: "eng" },
      { pages: [1], language: "../../etc/passwd" },
    ])
      expect(pdfOcrSettingsSchema.safeParse(settings).success).toBe(false);
    expect(
      pdfOcrSettingsSchema.parse({ pages: [1, 2], language: "eng" }),
    ).toEqual({
      pages: [1, 2],
      language: "eng",
      research: false,
      searchable: true,
    });
  });
  it("exports only reviewed research text with immutable citations", () => {
    const base: PdfOcrPage = {
      page: 1,
      text: "Unreviewed guess",
      reviewed_text: null,
      reviewed: false,
      native: false,
      version: 1,
    };
    const text = pdfOcrMarkdown(
      [
        base,
        {
          ...base,
          page: 2,
          reviewed: true,
          reviewed_text: "Corrected equation $x^2$",
        },
      ],
      "version-id",
    );
    expect(text).not.toContain("Unreviewed guess");
    expect(text).toContain("Corrected equation");
    expect(text).toContain("/api/v1/attachments/version-id#page=2");
  });
});
