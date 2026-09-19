import { PDFDocument, degrees } from "pdf-lib";
import {
  PDF_EDIT_MAX_BYTES,
  PDF_EDIT_MAX_PAGES,
  type PdfPageChoice,
} from "@axiom/shared/pdf-reader";
export async function organizePdf(
  sources: Uint8Array[],
  pages: PdfPageChoice[],
): Promise<Uint8Array> {
  if (
    !sources.length ||
    sources.reduce((n, bytes) => n + bytes.byteLength, 0) > PDF_EDIT_MAX_BYTES
  )
    throw new Error("Page operations support at most 100 MiB of source PDFs.");
  if (!pages.length || pages.length > PDF_EDIT_MAX_PAGES)
    throw new Error("Choose between 1 and 2,000 output pages.");
  const documents = await Promise.all(
    sources.map((bytes) => PDFDocument.load(bytes, { updateMetadata: false })),
  );
  for (const document of documents) {
    // Copying arbitrary form/signature trees is not safe. Refuse rather than
    // silently publish a PDF with missing widgets or invalid certification.
    if (document.getForm().getFields().length)
      throw new Error(
        "This PDF contains form or signature fields. Page editing is disabled to preserve them; download the original instead.",
      );
  }
  const output = await PDFDocument.create();
  for (const choice of pages) {
    const source = documents[choice.source];
    if (
      !source ||
      !Number.isInteger(choice.page) ||
      choice.page < 1 ||
      choice.page > source.getPageCount() ||
      ![0, 90, 180, 270].includes(choice.rotation)
    )
      throw new Error(
        "The page arrangement contains an invalid source, page, or rotation.",
      );
    const [page] = await output.copyPages(source, [choice.page - 1]);
    page.setRotation(
      degrees((page.getRotation().angle + choice.rotation) % 360),
    );
    output.addPage(page);
  }
  output.setProducer("Axiom PDF workbench");
  const bytes = await output.save();
  if (bytes.length > 200 * 1024 * 1024)
    throw new Error("The generated PDF exceeds the 200 MiB output limit.");
  return bytes;
}
