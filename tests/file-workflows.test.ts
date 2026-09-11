import { describe, it, expect } from "vitest";
import {
  fileOperationSchema,
  renameFiles,
  selectFileRange,
  uploadRelativePath,
} from "@axiom/shared/file-workflows";
describe("file workflows", () => {
  const items = [
    { id: "1", kind: "file" as const, version: 3, name: "experiment.csv" },
    { id: "2", kind: "file" as const, version: 1, name: "notes.txt" },
  ];
  it("preserves file extensions in every rename mode", () => {
    expect(
      renameFiles(items, { mode: "prefix", text: "AI-", find: "", start: 1 })[0]
        .name,
    ).toBe("AI-experiment.csv");
    expect(
      renameFiles(items, {
        mode: "number",
        text: "Study",
        find: "",
        start: 9,
      }).map((r) => r.name),
    ).toEqual(["Study 09.csv", "Study 10.txt"]);
    expect(
      renameFiles(items, {
        mode: "replace",
        text: "measurement",
        find: "experiment",
        start: 1,
      })[0].name,
    ).toBe("measurement.csv");
    expect(() =>
      renameFiles(items, { mode: "prefix", text: "../", find: "", start: 1 }),
    ).toThrow();
  });
  it("range and additive selection follow the visible order", () => {
    expect(
      selectFileRange(["a", "b", "c", "d"], ["d"], "a", "c", true, false),
    ).toEqual(["a", "b", "c"]);
    expect(
      selectFileRange(["a", "b", "c", "d"], ["d"], "b", "c", true, true),
    ).toEqual(["d", "b", "c"]);
    expect(selectFileRange(["a", "b"], ["a"], null, "a", false, true)).toEqual(
      [],
    );
  });
  it("accepts nested native upload paths but rejects traversal and excessive depth", () => {
    expect(
      uploadRelativePath({
        name: "a.csv",
        webkitRelativePath: "Study/results/a.csv",
      }),
    ).toEqual(["Study", "results"]);
    expect(() =>
      uploadRelativePath({ name: "a", webkitRelativePath: "../a" }),
    ).toThrow();
    expect(() =>
      uploadRelativePath({
        name: "a",
        webkitRelativePath: "x/".repeat(33) + "a",
      }),
    ).toThrow();
  });
  it("requires versioned bounded operations", () => {
    for (const command of ["move", "copy", "rename"])
      expect(
        fileOperationSchema.safeParse({
          id: crypto.randomUUID(),
          command,
          items: [{ id: crypto.randomUUID(), version: 1 }],
        }).success,
      ).toBe(false);
    expect(
      fileOperationSchema.safeParse({
        id: crypto.randomUUID(),
        command: "move",
        items: [],
      }).success,
    ).toBe(false);
    expect(
      fileOperationSchema.safeParse({
        id: crypto.randomUUID(),
        command: "delete",
        items: [{ id: crypto.randomUUID(), version: 1 }],
      }).success,
    ).toBe(false);
  });
});
