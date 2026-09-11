import { z } from "zod";
import * as Y from "yjs";

/** JSON Canvas 1.0 at the interchange boundary; stable IDs inside Axiom. */
const id = z.string().min(1).max(200);
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const color = z.string().regex(/^(?:[1-6]|#[\da-f]{6})$/i);
const side = z.enum(["top", "right", "bottom", "left"]);
const common = {
  id,
  title: z.string().max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  locked: z.boolean().optional(),
  heightMode: z.enum(["auto", "manual"]).optional(),
  fit: z.enum(["contain", "cover"]).optional(),
  previewPage: z.number().int().min(1).max(100000).optional(),
  x: coordinate,
  y: coordinate,
  width: z.number().positive().max(20000),
  height: z.number().positive().max(20000),
  color: color.optional(),
};
export const canvasNodeSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...common,
      type: z.literal("text"),
      text: z.string().max(100000),
    })
    .passthrough(),
  z
    .object({
      ...common,
      type: z.literal("file"),
      file: z.string().max(2000),
      subpath: z.string().max(500).optional(),
      resourceId: z.uuid().optional(),
      versionId: z.uuid().optional(),
    })
    .passthrough(),
  z
    .object({
      ...common,
      type: z.literal("link"),
      url: z
        .url()
        .max(4000)
        .refine((v) => /^https?:\/\//i.test(v), "Use an HTTP or HTTPS URL."),
    })
    .passthrough(),
  z
    .object({
      ...common,
      type: z.literal("group"),
      label: z.string().max(200).optional(),
      background: z.string().max(2000).optional(),
      backgroundStyle: z.enum(["cover", "ratio", "repeat"]).optional(),
    })
    .passthrough(),
]);
export const canvasEdgeSchema = z
  .object({
    id,
    fromNode: id,
    toNode: id,
    fromSide: side.optional(),
    toSide: side.optional(),
    fromEnd: z.enum(["none", "arrow"]).optional(),
    toEnd: z.enum(["none", "arrow"]).optional(),
    label: z.string().max(1000).optional(),
    color: color.optional(),
  })
  .passthrough();
export const canvasSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    nodes: z.array(canvasNodeSchema).max(2000).default([]),
    edges: z.array(canvasEdgeSchema).max(8000).default([]),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    const ids = new Set(value.nodes.map((n) => n.id));
    if (
      ids.size !== value.nodes.length ||
      new Set(value.edges.map((e) => e.id)).size !== value.edges.length
    )
      ctx.addIssue({ code: "custom", message: "Canvas IDs must be unique." });
    if (JSON.stringify(value).length > 5_000_000)
      ctx.addIssue({
        code: "custom",
        message: "Canvas exceeds the five-million-character limit.",
      });
  });
export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;
// Optional at the interchange boundary; every newly initialized room records it.
export type CanvasData = {
  schemaVersion?: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [key: string]: unknown;
};
export type CanvasSide = z.infer<typeof side>;
export const emptyCanvas = (): CanvasData => ({
  schemaVersion: 1,
  nodes: [],
  edges: [],
});
export const canvasColors: Record<string, string> = {
  "1": "#c85d62",
  "2": "#c08750",
  "3": "#b49b3b",
  "4": "#61966b",
  "5": "#508ea6",
  "6": "#9771bb",
};
export function parseCanvas(source: string): CanvasData {
  if (source.length > 5_000_000)
    throw new Error("Canvas import exceeds 5 MB of text.");
  const value = JSON.parse(source || "{}");
  if (value && value.schemaVersion !== undefined && value.schemaVersion !== 1)
    throw new Error(
      "This canvas uses an unsupported document version. Update Axiom before editing it.",
    );
  const data = canvasSchema.parse(value);
  const nodes = new Set(data.nodes.map((n) => n.id));
  if (data.edges.some((e) => !nodes.has(e.fromNode) || !nodes.has(e.toNode)))
    throw new Error(
      "A connection refers to a missing card. Repair the canvas before importing it.",
    );
  return data;
}
/** Explicit external boundary. No view state, caches or private preview bodies. */
export function exportJsonCanvas(data: CanvasData): string {
  const { schemaVersion: _version, ...portable } = canvasSchema.parse(data);
  return JSON.stringify(portable, null, 2);
}
export function canvasTitle(node: CanvasNode): string {
  return (
    node.title?.trim() ||
    (node.type === "text"
      ? node.text
          .split("\n")
          .find((line) => line.trim())
          ?.replace(/^\s*#{1,6}\s+/, "")
          .slice(0, 100) || "Untitled card"
      : node.type === "group"
        ? node.label || "Untitled group"
        : node.type === "file"
          ? node.file || "File"
          : new URL(node.url).hostname)
  );
}
function maps(doc: Y.Doc) {
  const root = doc.getMap<unknown>("canvas");
  return {
    root,
    nodes: root.get("nodes") as Y.Map<Y.Map<unknown>> | undefined,
    edges: root.get("edges") as Y.Map<Y.Map<unknown>> | undefined,
    order: root.get("order") as Y.Array<string> | undefined,
  };
}
function sharedRecord(record: Record<string, unknown>) {
  const value = new Y.Map<unknown>();
  for (const [key, field] of Object.entries(record))
    value.set(
      key,
      key === "text" && typeof field === "string" ? new Y.Text(field) : field,
    );
  return value;
}
/** Only seed an empty, newly created document. Never replace a live shared root. */
export function seedCanvas(doc: Y.Doc, data: CanvasData) {
  data = canvasSchema.parse(data);
  const { root } = maps(doc);
  if (root.size) throw new Error("Canvas is already initialized.");
  doc.transact(() => {
    const nodes = new Y.Map<Y.Map<unknown>>(),
      edges = new Y.Map<Y.Map<unknown>>(),
      order = new Y.Array<string>();
    root.set("nodes", nodes);
    root.set("edges", edges);
    root.set("order", order);
    root.set(
      "metadata",
      Object.fromEntries(
        Object.entries(data).filter(
          ([key]) => !["nodes", "edges"].includes(key),
        ),
      ),
    );
    for (const node of data.nodes) nodes.set(node.id, sharedRecord(node));
    for (const edge of data.edges) edges.set(edge.id, sharedRecord(edge));
    order.push(data.nodes.map((n) => n.id));
  });
}
export function readCanvas(doc: Y.Doc): CanvasData {
  const { root, nodes, edges, order } = maps(doc);
  if (!nodes || !edges || !order) return emptyCanvas();
  const ids = [...new Set([...order.toArray(), ...nodes.keys()])].filter((id) =>
    nodes.has(id),
  );
  return {
    ...((root.get("metadata") as object) ?? {}),
    nodes: ids.map((id) => nodes.get(id)!.toJSON() as CanvasNode),
    edges: [...edges.values()]
      .map((e) => e.toJSON() as CanvasEdge)
      .filter((e) => nodes.has(e.fromNode) && nodes.has(e.toNode)),
  };
}
export function replaceSharedText(text: Y.Text, next: string) {
  const previous = text.toString();
  let start = 0,
    end = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  )
    start++;
  while (
    end < previous.length - start &&
    end < next.length - start &&
    previous[previous.length - 1 - end] === next[next.length - 1 - end]
  )
    end++;
  if (previous.length - start - end)
    text.delete(start, previous.length - start - end);
  if (next.length - start - end)
    text.insert(start, next.slice(start, next.length - end));
}
/** Remember character identities, not offsets, while an IME owns the DOM. */
export function captureCanvasComposition(text: Y.Text) {
  return {
    source: text.toString(),
    starts: Array.from({ length: text.length + 1 }, (_, i) =>
      Y.createRelativePositionFromTypeIndex(text, i),
    ),
    ends: Array.from({ length: text.length }, (_, i) =>
      Y.createRelativePositionFromTypeIndex(text, i + 1, -1),
    ),
  };
}
export function finishCanvasComposition(
  text: Y.Text,
  capture: ReturnType<typeof captureCanvasComposition>,
  value: string,
  origin: unknown,
) {
  const doc = text.doc!;
  let start = 0,
    end = 0;
  while (
    start < capture.source.length &&
    start < value.length &&
    capture.source[start] === value[start]
  )
    start++;
  while (
    end < capture.source.length - start &&
    end < value.length - start &&
    capture.source.at(-1 - end) === value.at(-1 - end)
  )
    end++;
  const inserted = value.slice(start, value.length - end);
  let cursor = 0;
  doc.transact(() => {
    // Delete only characters present at composition start. Remote insertions
    // within the selected range must not be swallowed by a whole-value diff.
    for (let i = capture.source.length - end - 1; i >= start; i--) {
      const a = Y.createAbsolutePositionFromRelativePosition(
        capture.starts[i],
        doc,
      );
      const b = Y.createAbsolutePositionFromRelativePosition(
        capture.ends[i],
        doc,
      );
      if (a?.type === text && b?.type === text && b.index > a.index)
        text.delete(a.index, b.index - a.index);
    }
    const anchor = Y.createAbsolutePositionFromRelativePosition(
      capture.starts[start],
      doc,
    );
    cursor = anchor?.type === text ? anchor.index : text.length;
    if (inserted) text.insert(cursor, inserted);
    cursor += inserted.length;
  }, origin);
  return cursor;
}
export type CanvasCommand =
  | { type: "add"; nodes?: CanvasNode[]; edges?: CanvasEdge[] }
  | { type: "update-node"; id: string; changes: Partial<CanvasNode> }
  | { type: "update-edge"; id: string; changes: Partial<CanvasEdge> }
  | { type: "remove"; ids: string[] }
  | { type: "order"; ids: string[]; placement?: "front" | "back" };
export const canvasCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("add"),
      nodes: z.array(canvasNodeSchema).max(2000).optional(),
      edges: z.array(canvasEdgeSchema).max(8000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("update-node"),
      id,
      changes: z.record(z.string().max(200), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("update-edge"),
      id,
      changes: z.record(z.string().max(200), z.unknown()),
    })
    .strict(),
  z.object({ type: z.literal("remove"), ids: z.array(id).max(10000) }).strict(),
  z
    .object({
      type: z.literal("order"),
      ids: z.array(id).max(2000),
      placement: z.enum(["front", "back"]).optional(),
    })
    .strict(),
]);
export function applyCanvasCommands(
  doc: Y.Doc,
  commands: CanvasCommand[],
  origin: unknown,
) {
  z.array(canvasCommandSchema).max(500).parse(commands);
  const { nodes, edges, order } = maps(doc);
  if (!nodes || !edges || !order)
    throw new Error("Wait for the canvas to finish loading.");
  // Validate a throwaway candidate first. Partial batches never reach a live room.
  const apply = (target: Y.Doc) => {
    const m = maps(target);
    for (const command of commands) {
      if (command.type === "add") {
        for (const node of command.nodes ?? []) {
          canvasNodeSchema.parse(node);
          if (m.nodes!.has(node.id))
            throw new Error("A card with this ID already exists.");
          m.nodes!.set(node.id, sharedRecord(node));
          m.order!.push([node.id]);
        }
        for (const edge of command.edges ?? []) {
          canvasEdgeSchema.parse(edge);
          if (!m.nodes!.has(edge.fromNode) || !m.nodes!.has(edge.toNode))
            throw new Error("Connection target is unavailable.");
          if (m.edges!.has(edge.id))
            throw new Error("A connection with this ID already exists.");
          m.edges!.set(edge.id, sharedRecord(edge));
        }
      } else if (
        command.type === "update-node" ||
        command.type === "update-edge"
      ) {
        const record = (
          command.type === "update-node" ? m.nodes : m.edges
        )!.get(command.id);
        if (!record)
          throw new Error("This item was removed by another collaborator.");
        if ("id" in command.changes || "type" in command.changes)
          throw new Error("Item identity cannot be changed.");
        for (const [key, value] of Object.entries(command.changes)) {
          if (value === undefined) record.delete(key);
          else if (key === "text" && record.get(key) instanceof Y.Text)
            replaceSharedText(record.get(key) as Y.Text, String(value));
          else record.set(key, value);
        }
        if (
          command.type === "update-edge" &&
          (!m.nodes!.has(String(record.get("fromNode"))) ||
            !m.nodes!.has(String(record.get("toNode"))))
        )
          throw new Error("Connection target is unavailable.");
      } else if (command.type === "remove") {
        for (const id of command.ids) {
          m.nodes!.delete(id);
          m.edges!.delete(id);
        }
        for (const [id, edge] of m.edges!)
          if (
            !m.nodes!.has(String(edge.get("fromNode"))) ||
            !m.nodes!.has(String(edge.get("toNode")))
          )
            m.edges!.delete(id);
        for (let i = m.order!.length - 1; i >= 0; i--)
          if (command.ids.includes(m.order!.get(i))) m.order!.delete(i, 1);
      } else if (command.type === "order") {
        const ids = [...new Set(command.ids)].filter((id) => m.nodes!.has(id));
        for (let i = m.order!.length - 1; i >= 0; i--)
          if (ids.includes(m.order!.get(i))) m.order!.delete(i, 1);
        if (command.placement === "back") m.order!.insert(0, ids);
        else m.order!.push(ids);
      }
    }
  };
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc));
    candidate.transact(() => apply(candidate));
    canvasSchema.parse(readCanvas(candidate));
  } finally {
    candidate.destroy();
  }
  doc.transact(() => apply(doc), origin);
}
export function canvasBounds(nodes: CanvasNode[]) {
  if (!nodes.length) return { x: 0, y: 0, width: 600, height: 400 };
  const x = Math.min(...nodes.map((n) => n.x)),
    y = Math.min(...nodes.map((n) => n.y));
  return {
    x,
    y,
    width: Math.max(...nodes.map((n) => n.x + n.width)) - x,
    height: Math.max(...nodes.map((n) => n.y + n.height)) - y,
  };
}
export function canvasPort(node: CanvasNode, side: CanvasSide = "right") {
  return {
    x:
      node.x +
      (side === "left" ? 0 : side === "right" ? node.width : node.width / 2),
    y:
      node.y +
      (side === "top" ? 0 : side === "bottom" ? node.height : node.height / 2),
  };
}
export function canvasCurve(
  a: { x: number; y: number },
  b: { x: number; y: number },
  from: CanvasSide = "right",
  to: CanvasSide = "left",
) {
  const d = Math.max(40, Math.hypot(a.x - b.x, a.y - b.y) / 2);
  const shift = (p: typeof a, side: CanvasSide) => ({
    x: p.x + (side === "right" ? d : side === "left" ? -d : 0),
    y: p.y + (side === "bottom" ? d : side === "top" ? -d : 0),
  });
  const c = shift(a, from),
    e = shift(b, to);
  return `M ${a.x} ${a.y} C ${c.x} ${c.y}, ${e.x} ${e.y}, ${b.x} ${b.y}`;
}
