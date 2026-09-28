import { z } from "zod";
import { canvasSchema, type CanvasData } from "./canvas";
import { resourceNameSchema } from "./workspace";

export const evidenceSelectionSchema = z
  .array(
    z
      .object({
        kind: z.enum(["paper", "reference", "annotation"]),
        id: z.uuid(),
      })
      .strict(),
  )
  .min(1)
  .max(50)
  .refine(
    (items) => new Set(items.map((i) => i.kind + i.id)).size === items.length,
    "Choose each source only once.",
  );
export type EvidenceSelection = z.infer<typeof evidenceSelectionSchema>;
export const synthesisInputSchema = z
  .object({
    selection: evidenceSelectionSchema,
    groupId: z.uuid().nullable().default(null),
    spaceId: z.uuid().nullable(),
    destination: z.uuid(),
    name: resourceNameSchema,
    type: z.enum(["markdown", "canvas"]),
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    acknowledgePrivate: z.boolean().default(false),
    mutationId: z.uuid().optional(),
    id: z.uuid().optional(),
  })
  .strict();
export type EvidenceItem = {
  key: string;
  id: string;
  kind: "paper" | "reference" | "annotation" | "bookmark" | "progress";
  title: string;
  detail: string;
  quote: string;
  body: string;
  revision: string;
  updated_at: string;
  resource_id: string | null;
  attachment_id: string | null;
  space_id: string | null;
  group_id: string | null;
  private: boolean;
  page: number | null;
  route: string;
  status: string | null;
  reading: import("./research").ReadingItem | null;
};
export type EvidencePage = {
  items: EvidenceItem[];
  next: string | null;
  canEditLibrary: boolean;
};
export type SynthesisPreview = {
  source: string;
  hash: string;
  privateCount: number;
  sharedDestination: boolean;
  sources: number;
};
const escape = (s: string) =>
  s.replace(/[\\`*_{}\[\]<>#|!]/g, "\\$&").replace(/\r?\n/g, " ");
const quotation = (s: string) =>
  s
    .split(/\r?\n/)
    .map((line) => `> ${escape(line)}`)
    .join("\n");
export function synthesisSource(
  items: EvidenceItem[],
  name: string,
  type: "markdown" | "canvas",
) {
  const evidence = (item: EvidenceItem) =>
    `### ${escape(item.title)}\n\n${item.detail ? escape(item.detail) + "\n\n" : ""}${item.quote ? quotation(item.quote) + "\n\n" : ""}${item.body ? "Annotation: " + escape(item.body) + "\n\n" : ""}[Open source${item.page ? ` · page ${item.page}` : ""}](/workbench${item.route})\n\nSource revision: ${escape(item.revision)}${item.private ? " · copied from private evidence" : ""}`;
  if (type === "markdown")
    return `# ${escape(name)}\n\n## Research question\n\nWrite the question this evidence will help answer.\n\n## Evidence\n\n${items.map(evidence).join("\n\n")}\n\n## Findings\n\nDistinguish observations from interpretation.\n\n## Open questions\n\n- [ ] Check the assumptions and source access\n`;
  const data: CanvasData = {
    schemaVersion: 1,
    nodes: [
      {
        id: "question",
        type: "text",
        title: name,
        text: `# ${escape(name)}\n\nWhat does the evidence support?\n\n- [ ] Check the assumptions\n- [ ] Identify uncertainty`,
        x: 0,
        y: 0,
        width: 320,
        height: 260,
      },
    ],
    edges: [],
  };
  items.forEach((item, index) => {
    const id = `evidence-${index}`,
      x = 440 + (index % 2) * 780,
      y = Math.floor(index / 2) * 400;
    data.nodes.push({
      id,
      type: "text",
      title: item.title.slice(0, 200),
      text: evidence(item),
      x,
      y,
      width: 360,
      height: 320,
    });
    data.edges.push({
      id: `supports-${index}`,
      fromNode: id,
      fromSide: "left",
      toNode: "question",
      toSide: "right",
      label: "evidence",
    });
    if (item.resource_id && item.attachment_id) {
      data.nodes.push({
        id: `source-${index}`,
        type: "file",
        file: item.title,
        resourceId: item.resource_id,
        versionId: item.attachment_id,
        title: item.title.slice(0, 200),
        x: x + 390,
        y,
        width: 320,
        height: 320,
      });
      data.edges.push({
        id: `provenance-${index}`,
        fromNode: id,
        fromSide: "right",
        toNode: `source-${index}`,
        toSide: "left",
        label: "source",
      });
    }
  });
  return JSON.stringify(canvasSchema.parse(data), null, 2);
}
