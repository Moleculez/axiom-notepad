import { layoutResearchGraph } from "@axiom/shared/research-graph";
self.onmessage = (e: MessageEvent<Parameters<typeof layoutResearchGraph>>) =>
  self.postMessage(layoutResearchGraph(...e.data));
