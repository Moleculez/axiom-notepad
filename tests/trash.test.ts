import { describe, expect, it } from "vitest";
import {
  trashComponents,
  trashSelectionSchema,
  trashReadingCleanupSchema,
  trashQuickPurgeSchema,
  trashResultFilterSchema,
  trashItemStatus,
  type TrashItem,
  type TrashOperation,
} from "../packages/shared/src/trash";
import { randomUUID } from "node:crypto";
describe("frozen Trash selections", () => {
  it("requires a frozen quick-purge impact and explicit irreversible confirmation", () => {
    const input = {
      mutationId: randomUUID(),
      fingerprint: "a".repeat(64),
      confirmation: "DELETE FOREVER",
      acknowledgeBrokenLinks: true,
    };
    expect(trashQuickPurgeSchema.safeParse(input).success).toBe(true);
    for (const change of [
      { confirmation: "DELETE" },
      { fingerprint: "" },
      { acknowledgeBrokenLinks: undefined },
      { force: true },
    ])
      expect(
        trashQuickPurgeSchema.safeParse({ ...input, ...change }).success,
      ).toBe(false);
  });
  it("only clears an explicit, versioned and confirmed set of personal reading records", () => {
    const record = { id: randomUUID(), version: 1 };
    const input = {
      mutationId: randomUUID(),
      confirmation: "REMOVE MY READING DATA",
      records: [record],
    };
    expect(trashReadingCleanupSchema.safeParse(input).success).toBe(true);
    for (const change of [
      { confirmation: "DELETE FOREVER" },
      { records: [] },
      { records: [record, record] },
      { records: [{ ...record, version: 0 }] },
      {
        records: Array.from({ length: 501 }, () => ({
          id: randomUUID(),
          version: 1,
        })),
      },
      { userId: "someone-else" },
    ])
      expect(
        trashReadingCleanupSchema.safeParse({ ...input, ...change }).success,
      ).toBe(false);
  });
  it("uses plain status labels without exposing internal operation jargon", () => {
    const item = { status: "pending" } as TrashItem;
    const operation = { status: "preview", action: "purge" } as TrashOperation;
    expect(trashItemStatus(item, operation)).toBe("Ready");
    expect(trashItemStatus({ ...item, status: "blocked" }, operation)).toBe(
      "Needs attention",
    );
    expect(
      trashItemStatus(
        { ...item, status: "done" },
        { ...operation, action: "restore" },
      ),
    ).toBe("Restored");
    expect(trashResultFilterSchema.safeParse("attention").success).toBe(true);
    expect(trashResultFilterSchema.safeParse("unrecognized").success).toBe(
      false,
    );
  });
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
