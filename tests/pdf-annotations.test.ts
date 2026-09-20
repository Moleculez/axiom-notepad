import { describe, it, expect } from "vitest";
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFHexString } from "pdf-lib";
import { createHash } from "node:crypto";
import {
  annotationDataSchema,
  readingDataSchema,
  type Annotation,
} from "@axiom/shared/research";
import {
  importPdfAnnotation,
  annotationSegments,
} from "@axiom/shared/pdf-annotations";
import { exportAnnotatedPdf } from "../apps/web/lib/tools/pdf-annotation-export";
const hash = "a".repeat(64);
const data = annotationDataSchema.parse({
  kind: "underline",
  page: 1,
  sha256: hash,
  rects: [[0.1, 0.2, 0.3, 0.04]],
  tags: ["method"],
});
describe("portable PDF annotations", () => {
  it("preserves old annotation data and validates multi-page bounds", () => {
    expect(
      annotationDataSchema.parse({ ...data, tags: undefined }).tags,
    ).toBeUndefined();
    expect(annotationSegments(data)).toEqual([{ page: 1, rects: data.rects }]);
    expect(
      annotationDataSchema.safeParse({
        ...data,
        segments: [{ page: 2, rects: data.rects }],
      }).success,
    ).toBe(false);
    expect(
      annotationDataSchema.safeParse({
        ...data,
        segments: [
          { page: 1, rects: data.rects },
          { page: 1, rects: data.rects },
        ],
      }).success,
    ).toBe(false);
    expect(
      annotationDataSchema.parse({
        ...data,
        segments: [
          { page: 1, rects: data.rects },
          { page: 2, rects: data.rects },
        ],
      }).segments,
    ).toHaveLength(2);
  });
  it("normalizes cropped native quads and keeps imported authors as metadata", () => {
    const imported = importPdfAnnotation(
      {
        subtype: "Underline",
        id: "9R",
        quadPoints: new Float32Array([60, 150, 160, 150, 60, 130, 160, 130]),
        titleObj: { str: "External reader" },
        contentsObj: { str: "Check uncertainty" },
        color: [118, 184, 255],
      },
      2,
      [10, 30, 510, 730],
      hash,
    )!;
    expect(imported.kind).toBe("underline");
    expect(imported.rects[0][0]).toBeCloseTo(0.1);
    expect(imported.rects[0][1]).toBeCloseTo(100 / 700);
    expect(imported.imported).toEqual({
      sourceId: "2:9R",
      author: "External reader",
    });
    expect(imported.color).toBe("blue");
    expect(
      importPdfAnnotation(
        { subtype: "Link", url: "javascript:alert(1)" },
        1,
        [0, 0, 500, 700],
        hash,
      ),
    ).toBeNull();
    expect(
      importPdfAnnotation(
        { subtype: "Highlight", rect: [NaN, 1, 2, 3] },
        1,
        [0, 0, 500, 700],
        hash,
      ),
    ).toBeNull();
  });
  it("validates reader resume values without rejecting legacy progress", () => {
    expect(
      readingDataSchema.parse({ page: 2, fraction: 0.1 }).pdfView,
    ).toBeUndefined();
    const pdfView = {
      offset: 0.42,
      scale: "fit",
      rotation: 90,
      layout: "continuous",
    };
    expect(readingDataSchema.parse({ page: 2, pdfView }).pdfView).toEqual(
      pdfView,
    );
    expect(
      readingDataSchema.safeParse({ pdfView: { ...pdfView, offset: 1.2 } })
        .success,
    ).toBe(false);
  });
  it("exports standard Unicode annotation dictionaries without changing the source", async () => {
    const original = await PDFDocument.create();
    original.addPage([500, 700]);
    original.addPage([500, 700]);
    const bytes = await original.save(),
      before = bytes.slice(),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    const annotation = {
      id: "example",
      author_name: "研究者",
      data: {
        ...data,
        sha256,
        body: "Hypothesis α",
        segments: [
          { page: 1, rects: data.rects },
          { page: 2, rects: data.rects },
        ],
      },
    } as Annotation;
    const exported = await PDFDocument.load(
      await exportAnnotatedPdf(bytes, [annotation]),
    );
    const annots = exported
      .getPage(0)
      .node.lookup(PDFName.of("Annots"), PDFArray);
    const item = annots.lookup(0, PDFDict);
    expect(item.lookup(PDFName.of("Subtype"), PDFName).toString()).toBe(
      "/Underline",
    );
    expect(
      item.lookup(PDFName.of("Contents"), PDFHexString).decodeText(),
    ).toContain("Hypothesis α");
    expect(
      exported.getPage(1).node.lookup(PDFName.of("Annots"), PDFArray).size(),
    ).toBe(1);
    expect(bytes).toEqual(before);
    await expect(
      exportAnnotatedPdf(bytes, [{ ...annotation, data }]),
    ).rejects.toThrow("different PDF version");
  });
  it("replaces explicitly imported native marks and preserves unrelated comments", async () => {
    const doc = await PDFDocument.create(),
      page = doc.addPage([500, 700]);
    const ref = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Square",
        Rect: [50, 100, 100, 150],
      }),
    );
    const other = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Text",
        Rect: [10, 10, 30, 30],
      }),
    );
    page.node.set(PDFName.of("Annots"), doc.context.obj([ref, other]));
    const bytes = await doc.save(),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    const annotation = {
      id: "portable",
      data: {
        ...data,
        sha256,
        imported: {
          sourceId: `1:${ref.objectNumber}R`,
          author: "Original author",
        },
      },
    } as Annotation;
    const first = await exportAnnotatedPdf(bytes, [annotation]);
    const updated = {
      ...annotation,
      data: {
        ...annotation.data,
        sha256: createHash("sha256").update(first).digest("hex"),
      },
    };
    const second = await PDFDocument.load(
      await exportAnnotatedPdf(first, [updated]),
    );
    expect(
      second.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size(),
    ).toBe(2);
  });
  it("validates and exports bounded drawing types", async () => {
    const source = await PDFDocument.create();
    source.addPage([500, 700]);
    const bytes = await source.save(),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    const drawings = ["ink", "arrow", "textbox"].map((kind) => ({
      id: kind,
      data: annotationDataSchema.parse({
        ...data,
        kind,
        sha256,
        body: "研究 α",
        paths:
          kind === "textbox"
            ? undefined
            : [
                [
                  [0.1, 0.2],
                  [0.4, 0.24],
                ],
              ],
        strokeWidth: 2,
      }),
    })) as Annotation[];
    const doc = await PDFDocument.load(
      await exportAnnotatedPdf(bytes, drawings),
    );
    const marks = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    expect(
      [0, 1, 2].map((i) =>
        marks
          .lookup(i, PDFDict)
          .lookup(PDFName.of("Subtype"), PDFName)
          .toString(),
      ),
    ).toEqual(["/Ink", "/Line", "/FreeText"]);
    expect(
      annotationDataSchema.safeParse({
        ...drawings[0].data,
        paths: [
          [
            [0, 0],
            [Infinity, 1],
          ],
        ],
      }).success,
    ).toBe(false);
    expect(
      annotationDataSchema.safeParse({
        ...drawings[1].data,
        paths: [
          [
            [0, 0],
            [0.5, 0.5],
            [1, 1],
          ],
        ],
      }).success,
    ).toBe(false);
    const imported = importPdfAnnotation(
      {
        subtype: "Ink",
        rect: [50, 140, 200, 168],
        inkLists: [new Float32Array([50, 140, 200, 168])],
      },
      1,
      [0, 0, 500, 700],
      sha256,
    );
    expect(imported?.paths).toEqual([
      [
        [0.1, 0.2],
        [0.4, 0.24],
      ],
    ]);
  });
});
