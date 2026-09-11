import {
  parseCanvas,
  type CanvasData,
  type CanvasNode,
} from "@axiom/shared/canvas";

const format = "axiom-canvas-selection";
export function selectedCanvas(data: CanvasData, ids: string[]): CanvasData {
  const wanted = new Set(ids),
    nodes = data.nodes.filter((n) => wanted.has(n.id));
  return {
    schemaVersion: 1,
    nodes,
    edges: data.edges.filter(
      (e) => wanted.has(e.fromNode) && wanted.has(e.toNode),
    ),
  };
}
export function encodeCanvasClipboard(data: CanvasData) {
  return JSON.stringify({ format, version: 1, canvas: data });
}
export function decodeCanvasClipboard(source: string): CanvasData | null {
  if (source.length > 5_000_000)
    throw new Error("Clipboard selection exceeds the Canvas size limit.");
  try {
    const value = JSON.parse(source);
    if (value.format !== format) return null;
    if (value.version !== 1)
      throw new Error("Unsupported Canvas clipboard version.");
    return parseCanvas(JSON.stringify(value.canvas));
  } catch (e) {
    if (source.includes(format)) throw e;
    return null;
  }
}
export function cloneCanvasSelection(
  data: CanvasData,
  at?: { x: number; y: number },
): CanvasData {
  const ids = new Map(data.nodes.map((n) => [n.id, crypto.randomUUID()]));
  const dx = at ? at.x - Math.min(...data.nodes.map((n) => n.x)) : 30,
    dy = at ? at.y - Math.min(...data.nodes.map((n) => n.y)) : 30;
  return {
    schemaVersion: 1,
    nodes: data.nodes.map(
      (n) =>
        ({
          ...n,
          id: ids.get(n.id)!,
          x: Math.round(n.x + dx),
          y: Math.round(n.y + dy),
        }) as CanvasNode,
    ),
    edges: data.edges.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      fromNode: ids.get(e.fromNode)!,
      toNode: ids.get(e.toNode)!,
    })),
  };
}
