import type { MindmapNode } from "./types";

/** Compact labels are bounded. Full content remains in Source and block details. */
export function mindmapRichLabel(source: string, node: MindmapNode) {
  if (
    node.kind === "heading" ||
    node.kind === "item" ||
    (node.kind === "root" && node.level)
  )
    return node.labelSource.length <= 2000 ? node.labelSource : "";
  if (node.blockType === "mathBlock")
    return node.to - node.from <= 16000 ? source.slice(node.from, node.to) : "";
  if (node.blockType === "paragraph" && node.labelSource.length <= 500)
    return node.labelSource;
  return "";
}
