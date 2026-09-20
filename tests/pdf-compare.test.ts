import { it, expect } from "vitest";
import { comparePdfText } from "../packages/shared/src/pdf-compare";
import { mapPdfAnnotation } from "../packages/shared/src/pdf-annotations";
import { annotationDataSchema } from "../packages/shared/src/research";
it("aligns inserted/deleted pages and distinguishes missing text", () => {
  expect(
    comparePdfText(["A", "B", "C"], ["A", "inserted", "B", "C"]).map(
      (p) => p.status,
    ),
  ).toEqual(["same", "added", "same", "same"]);
  expect(comparePdfText(["A", "B"], ["B"]).map((p) => p.status)).toEqual([
    "removed",
    "same",
  ]);
  expect(comparePdfText([""], [""])[0].status).toBe("unavailable");
  expect(
    comparePdfText(["alpha beta"], ["alpha gamma"])[0].diff?.spans.some(
      (s) => s.kind === "add" && s.text.includes("gamma"),
    ),
  ).toBe(true);
});
it("remaps annotations without rotating normalized coordinates", () => {
  const data = annotationDataSchema.parse({
    kind: "area",
    page: 1,
    sha256: "a".repeat(64),
    rects: [[0.1, 0.2, 0.3, 0.4]],
  });
  const result = mapPdfAnnotation(
    data,
    [
      { source: 0, page: 2, rotation: 0 },
      { source: 0, page: 1, rotation: 90 },
      { source: 0, page: 1, rotation: 180 },
    ],
    "b".repeat(64),
  );
  expect(result.data[0].segments?.map((s) => s.page)).toEqual([2, 3]);
  expect(result.data[0].rects).toEqual(data.rects);
  expect(
    mapPdfAnnotation(
      data,
      [{ source: 0, page: 2, rotation: 0 }],
      "b".repeat(64),
    ),
  ).toEqual({ data: [], omitted: 1 });
});
