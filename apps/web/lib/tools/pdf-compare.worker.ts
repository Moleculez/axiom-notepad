import { comparePdfText } from "@axiom/shared/pdf-compare";
self.onmessage = (event: MessageEvent<{ left: string[]; right: string[] }>) => {
  try {
    self.postMessage({
      result: comparePdfText(event.data.left, event.data.right),
    });
  } catch (e) {
    self.postMessage({ error: (e as Error).message });
  }
};
