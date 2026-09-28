import { describe, expect, it } from "vitest";
import {
  evidenceSelectionSchema,
  synthesisSource,
  type EvidenceItem,
} from "../packages/shared/src/research-workbench";
import { readingInputSchema } from "../packages/shared/src/research";
import { parseCanvas } from "../packages/shared/src/canvas";
const id = "00000000-0000-4000-8000-000000000001";
const item: EvidenceItem = {
  key: "annotation:" + id,
  id,
  kind: "annotation",
  title: "A [linked] paper",
  detail: "Author",
  quote: "An <iframe> is plain evidence.",
  body: "**Private** observation",
  revision: "2",
  updated_at: "2026-01-01T00:00:00Z",
  resource_id: id,
  attachment_id: id,
  space_id: id,
  group_id: id,
  private: true,
  page: 3,
  route: `/pdf/${id}?version=${id}#page=3`,
  status: null,
  reading: null,
};
describe("evidence synthesis", () => {
  it("is deterministic, escapes copied text and retains provenance", () => {
    const source = synthesisSource([item], "A finding", "markdown");
    expect(source).toBe(synthesisSource([item], "A finding", "markdown"));
    expect(source).toContain("\\<iframe\\>");
    expect(source).toContain("\\*\\*Private\\*\\*");
    expect(source).toContain("#page=3");
    expect(source).toContain("revision: 2 · copied from private evidence");
    expect(source).toContain("## Open questions");
  });
  it("creates portable Canvas source/quote cards and provenance connections", () => {
    const source = synthesisSource([item], "Evidence map", "canvas");
    const canvas = parseCanvas(source);
    expect(canvas.nodes).toHaveLength(3);
    expect(canvas.edges).toHaveLength(2);
    expect(canvas.nodes.find((n) => n.type === "file")).toMatchObject({
      resourceId: id,
      versionId: id,
    });
    expect(source).toBe(synthesisSource([item], "Evidence map", "canvas"));
  });
  it("rejects empty, duplicated or oversized selection", () => {
    for (const value of [
      [],
      [
        { kind: "annotation", id },
        { kind: "annotation", id },
      ],
      Array.from({ length: 51 }, () => ({ kind: "paper", id })),
    ])
      expect(evidenceSelectionSchema.safeParse(value).success).toBe(false);
    expect(
      evidenceSelectionSchema.safeParse([{ kind: "paper", id }]).success,
    ).toBe(true);
  });
  it("allows PDF reading statuses without weakening other target contracts", () => {
    const base = {
      id,
      group_id: id,
      kind: "reading",
      target_type: "attachment",
      target_id: id,
      version: 0,
      mutation_id: id,
      data: { status: "reading" },
    };
    expect(readingInputSchema.safeParse(base).success).toBe(true);
    expect(
      readingInputSchema.safeParse({ ...base, target_type: "note" }).success,
    ).toBe(false);
    expect(readingInputSchema.safeParse({ ...base, data: {} }).success).toBe(
      false,
    );
  });
});
