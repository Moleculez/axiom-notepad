import { describe, expect, it } from "vitest";
import {
  trashComponents,
  trashSelectionSchema,
} from "../packages/shared/src/trash";
import { randomUUID } from "node:crypto";
describe("frozen Trash selections", () => {
  it("requires explicit workspace scope and one selection mode", () => {
    const base = {
      mutationId: randomUUID(),
      spaceIds: [randomUUID()],
      action: "purge",
      ids: [randomUUID()],
    };
    expect(trashSelectionSchema.safeParse(base).success).toBe(true);
    expect(
      trashSelectionSchema.safeParse({ ...base, spaceIds: [] }).success,
    ).toBe(false);
    expect(
      trashSelectionSchema.safeParse({ ...base, allMatching: true }).success,
    ).toBe(false);
    expect(
      trashSelectionSchema.safeParse({ ...base, ids: [], allMatching: true })
        .success,
    ).toBe(true);
  });
  it("deduplicates reference cycles and nested targets into stable atomic units", () => {
    const ids = ["folder", "note", "file", "second-note", "independent"];
    const edges: [string, string][] = [
      ["folder", "note"],
      ["note", "file"],
      ["file", "second-note"],
      ["second-note", "note"],
      ["outside", "file"],
    ];
    const a = trashComponents(ids, edges),
      b = trashComponents([...ids].reverse(), [...edges].reverse());
    for (const id of ids) expect(a.get(id)).toBe(b.get(id));
    expect(new Set([...a.values()]).size).toBe(2);
    expect(a.get("file")).toBe(a.get("folder"));
    expect(a.get("independent")).not.toBe(a.get("folder"));
  });
});
