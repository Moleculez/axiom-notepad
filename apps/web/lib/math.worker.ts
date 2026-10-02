import { renderMath } from "../../../packages/markdown/src/mathjax";
import type { MathRequest, MathResult } from "@axiom/markdown";

export type MathWorkerMessage =
  { ready: true } | { id: number; result: MathResult };
self.onmessage = (
  event: MessageEvent<{ id: number; request: MathRequest }>,
) => {
  self.postMessage({
    id: event.data.id,
    result: renderMath(event.data.request),
  });
};
// Downloading/evaluating the bundled fonts is not equation execution time.
self.postMessage({ ready: true } satisfies MathWorkerMessage);
