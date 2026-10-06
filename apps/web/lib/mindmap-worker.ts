import {
  createMindmapComputer,
  type MindmapRequest,
} from "@axiom/mindmap/worker";
const compute = createMindmapComputer();
self.onmessage = (event: MessageEvent<MindmapRequest>) =>
  self.postMessage(compute(event.data));
