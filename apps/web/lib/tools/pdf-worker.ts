import { organizePdf } from "./pdf-organize";
import type { PdfPageChoice } from "@axiom/shared/pdf-reader";
self.onmessage = async (
  event: MessageEvent<{ sources: Uint8Array[]; pages: PdfPageChoice[] }>,
) => {
  try {
    const bytes = await organizePdf(event.data.sources, event.data.pages);
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "PDF generation failed.",
    });
  }
};
