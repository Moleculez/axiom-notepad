import type { TextChange } from "../../markdown/src/types";

export type MindmapKind = "root" | "heading" | "item" | "content" | "container";
export type MindmapNode = {
  id: string;
  parentId: string | null;
  children: string[];
  kind: MindmapKind;
  blockType: string;
  from: number;
  to: number;
  branchTo: number;
  labelFrom: number;
  labelTo: number;
  label: string;
  labelSource: string;
  /** Full semantic content for validating source moves; labels are only previews. */
  fingerprint: string;
  level?: number;
  checked?: boolean;
  /** Structural moves cannot cross a quote/container boundary. */
  scope: string;
  /** Derived definition navigator; never acquires structural edit authority. */
  presentationOnly?: boolean;
  item?: {
    prefix: string;
    marker: string;
    task: string;
    ordered: boolean;
    width: number;
  };
};
export type MindmapProjection = {
  rootId: string;
  nodes: MindmapNode[];
  supporting: { type: string; from: number; to: number }[];
};
export type MindmapSettings = {
  layout: "right" | "left" | "balanced";
  spacing: "comfortable" | "compact";
  colors: "accent" | "spectrum";
  nodeWidth: number;
  initialDepth: number;
};
export const defaultMindmapSettings: MindmapSettings = {
  layout: "right",
  spacing: "comfortable",
  colors: "accent",
  nodeWidth: 280,
  initialDepth: 3,
};
export const mindmapLimits = {
  nodes: 5000,
  depth: 64,
  source: 1_000_000,
} as const;
export const mindmapZoomLimits = { min: 0.00001, max: 3 } as const;
export type MindmapRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type MindmapPlacement = MindmapRect & {
  id: string;
  side: -1 | 1;
  depth: number;
  branch: number;
};
export type MindmapLayout = { nodes: MindmapPlacement[]; bounds: MindmapRect };
export type MindmapEdit = {
  changes: TextChange[];
  selection?: { anchor: number; head: number };
};
