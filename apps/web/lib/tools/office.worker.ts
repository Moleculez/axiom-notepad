import { readOffice } from "./office-parse";
self.onmessage = async (
  event: MessageEvent<{ data: ArrayBuffer; format: "docx" | "pptx" }>,
) => {
  try {
    self.postMessage(await readOffice(event.data.data, event.data.format));
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "This Office document cannot be previewed safely.",
    });
  }
};
