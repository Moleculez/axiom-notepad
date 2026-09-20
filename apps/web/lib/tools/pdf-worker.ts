import { organizePdf } from "./pdf-organize";
import type { PdfPageChoice } from "@axiom/shared/pdf-reader";
import type { Annotation } from "@axiom/shared/research";
import { exportAnnotatedPdf } from "./pdf-annotation-export";
self.onmessage = async (
  event: MessageEvent<{
    sources: Uint8Array[];
    pages: PdfPageChoice[];
    annotations?: Annotation[];
  }>,
) => {
  try {
    const bytes = event.data.annotations
      ? await exportAnnotatedPdf(event.data.sources[0], event.data.annotations)
      : await organizePdf(event.data.sources, event.data.pages);
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "PDF generation failed.",
    });
  }
};
