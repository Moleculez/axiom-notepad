/// <reference lib="webworker" />
import { MarkdownEngine } from "@axiom/markdown";
const engine = new MarkdownEngine();
self.onmessage = (event: MessageEvent<{ source: string; version: number }>) => {
  try {
    self.postMessage({
      version: event.data.version,
      parsed: engine.parse(event.data.source),
    });
  } catch (error) {
    self.postMessage({
      version: event.data.version,
      error:
        error instanceof Error
          ? error.message
          : "Could not render this passage.",
    });
  }
};
