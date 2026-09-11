import { renderMath } from "../../../packages/markdown/src/mathjax";
import type { MathRequest } from "@axiom/markdown";
self.onmessage = (
  event: MessageEvent<{ id: number; request: MathRequest }>,
) => {
  self.postMessage({
    id: event.data.id,
    result: renderMath(event.data.request),
  });
};
