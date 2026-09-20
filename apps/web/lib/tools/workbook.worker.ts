import { readWorkbook } from "./workbook-parse";
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage(await readWorkbook(event.data));
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "Unable to preview workbook.",
    });
  }
};
