import {
  PDFDocument,
  PDFName,
  PDFHexString,
  PDFString,
  PDFArray,
  PDFDict,
  PDFRef,
} from "pdf-lib";
import { annotationDataSchema, type Annotation } from "@axiom/shared/research";
import { annotationSegments } from "@axiom/shared/pdf-annotations";
import { PDF_EDIT_MAX_BYTES } from "@axiom/shared/pdf-reader";

/** Append portable annotations to a copy. Existing source annotations are retained. */
export async function exportAnnotatedPdf(
  source: Uint8Array,
  annotations: Annotation[],
) {
  if (source.byteLength > PDF_EDIT_MAX_BYTES || annotations.length > 2000)
    throw new Error(
      "Annotated exports support PDFs up to 100 MiB and 2,000 annotations.",
    );
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(source)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  if (annotations.some((a) => a.data.sha256 !== hash))
    throw new Error("These annotations belong to a different PDF version.");
  if (
    annotations.reduce(
      (count, a) =>
        count +
        annotationSegments(a.data).reduce(
          (n, s) => n + Math.max(1, s.rects.length),
          0,
        ),
      0,
    ) > 10000
  )
    throw new Error(
      "This export exceeds 10,000 markup rectangles. Filter the annotations first.",
    );
  const doc = await PDFDocument.load(source, { updateMetadata: false });
  if (doc.getForm().getFields().length)
    throw new Error(
      "Form and signature PDFs are not modified. Download the original and export annotations separately.",
    );
  const colors = {
    yellow: [1, 0.855, 0.208],
    green: [0.392, 0.851, 0.6],
    blue: [0.463, 0.722, 1],
    pink: [0.933, 0.573, 0.757],
  };
  const exportIds = new Set(annotations.map((a) => a.id));
  const importedIds = new Set(
    annotations.map((a) => a.data.imported?.sourceId),
  );
  // One pass over source marks, rather than scanning every page for every mark.
  // Only explicitly selected imported comments are replaced in this copy.
  for (const [pageIndex, page] of doc.getPages().entries()) {
    const list = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!list) continue;
    for (let i = list.size() - 1; i >= 0; i--) {
      const ref = list.get(i),
        mark = list.lookup(i);
      if (!(mark instanceof PDFDict)) continue;
      const name = mark.lookup(PDFName.of("NM"));
      const stableId =
        name instanceof PDFHexString || name instanceof PDFString
          ? name.decodeText()
          : "";
      const nativeId =
        ref instanceof PDFRef
          ? `${pageIndex + 1}:${ref.objectNumber}R${ref.generationNumber || ""}`
          : "";
      if (
        (stableId.startsWith("axiom:") &&
          exportIds.has(stableId.split(":")[1])) ||
        (nativeId && importedIds.has(nativeId))
      )
        list.remove(i);
    }
  }
  for (const annotation of annotations) {
    const data = annotationDataSchema.parse(annotation.data);
    for (const segment of annotationSegments(data)) {
      if (segment.page > doc.getPageCount())
        throw new Error("An annotation references a missing page.");
      const page = doc.getPage(segment.page - 1),
        crop = page.getCropBox();
      const marks = segment.rects.length
        ? segment.rects
        : [[0.04, 0.9, 0.04, 0.03]];
      for (const [index, r] of marks.entries()) {
        const x = crop.x + r[0] * crop.width,
          y = crop.y + r[1] * crop.height,
          w = r[2] * crop.width,
          h = r[3] * crop.height;
        const subtype = {
          highlight: "Highlight",
          underline: "Underline",
          strikeout: "StrikeOut",
          area: "Square",
          note: "Text",
          ink: "Ink",
          arrow: "Line",
          textbox: "FreeText",
        }[data.kind];
        const value = doc.context.obj({
          Type: "Annot",
          Subtype: subtype,
          Rect: [x, y, x + w, y + h],
          P: page.ref,
          C: colors[data.color],
          F: 4,
          NM: PDFHexString.fromText(
            `axiom:${annotation.id}:${segment.page}:${index}`,
          ),
          T: PDFHexString.fromText(
            annotation.author_name ?? "Axiom researcher",
          ),
          Contents: PDFHexString.fromText(
            [
              data.quote,
              data.body,
              data.tags?.length ? `Tags: ${data.tags.join(", ")}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          ),
          ...(["ink", "arrow"].includes(data.kind)
            ? (() => {
                const paths = data.paths!.map((path) =>
                  path.flatMap(([px, py]) => [
                    crop.x + px * crop.width,
                    crop.y + py * crop.height,
                  ]),
                );
                return data.kind === "ink"
                  ? { InkList: paths, BS: { W: data.strokeWidth ?? 2 } }
                  : {
                      L: paths[0],
                      LE: ["None", "OpenArrow"],
                      BS: { W: data.strokeWidth ?? 2 },
                    };
              })()
            : data.kind === "textbox"
              ? { DA: PDFHexString.fromText("/Helv 12 Tf 0 g"), Q: 0 }
              : data.kind === "area"
                ? { BS: { W: 1 } }
                : data.kind === "note"
                  ? { Name: "Comment" }
                  : {
                      QuadPoints: [x, y + h, x + w, y + h, x, y, x + w, y],
                      CA: data.kind === "highlight" ? 0.35 : 1,
                    }),
        });
        const list =
          page.node.lookupMaybe(PDFName.of("Annots"), PDFArray) ??
          doc.context.obj([]);
        list.push(doc.context.register(value));
        page.node.set(PDFName.of("Annots"), list);
      }
    }
  }
  const result = await doc.save();
  if (result.byteLength > 200 * 1024 * 1024)
    throw new Error("Annotated PDF exceeds the output limit.");
  return result;
}
