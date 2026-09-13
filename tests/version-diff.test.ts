import { describe, expect, test } from "vitest";
import { versionDiff, diffChanges } from "../packages/shared/src/version-diff";
describe("lossless revision comparison", () => {
  test.each([
    ["", ""],
    ["", "hello"],
    ["hello", ""],
    ["same\n", "same\n"],
    ["a\nb\na\nb\n", "b\na\nb\na\n"],
    ["a\r\nb\r\n", "a\nb\n"],
    ["# Title\n\nA proof.\n", "# Title\n\nAn improved proof.\n"],
    ["你好 α😀é\n", "你好 β😀é\n"],
    ["| A | B |\n| - | - |", "| A | C |\n| - | - |"],
    ["$$\nx^2\n$$", "$$\nx^3\n$$"],
    ["a\n".repeat(5000), "b\n".repeat(5000)],
  ])("reconstructs both inputs exactly", (a, b) => {
    const diff = versionDiff(a, b);
    expect(
      diff.spans
        .filter((s) => s.kind !== "add")
        .map((s) => s.text)
        .join(""),
    ).toBe(a);
    expect(
      diff.spans
        .filter((s) => s.kind !== "remove")
        .map((s) => s.text)
        .join(""),
    ).toBe(b);
    let value = a;
    for (const c of diffChanges(a, b).reverse())
      value = value.slice(0, c.from) + c.insert + value.slice(c.to);
    expect(value).toBe(b);
    for (const s of diff.spans) {
      if (s.kind !== "add")
        expect(a.slice(s.oldFrom, s.oldFrom + s.text.length)).toBe(s.text);
      if (s.kind !== "remove")
        expect(b.slice(s.newFrom, s.newFrom + s.text.length)).toBe(s.text);
    }
  });
  test("labels bounded fallback and rejects oversized input", () => {
    expect(versionDiff("a\n".repeat(5000), "b\n".repeat(5000)).coarse).toBe(
      true,
    );
    expect(() => versionDiff("x".repeat(1_000_001), "")).toThrow("million");
  });
  test("refines individual words without rewriting neighbors", () => {
    expect(diffChanges("The old theory.", "The new theory.")).toEqual([
      { from: 4, to: 7, insert: "new" },
    ]);
  });
  test("fuzzes repeated sequences deterministically", () => {
    let seed = 17;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let n = 0; n < 300; n++) {
      const make = () =>
        Array.from(
          { length: Math.floor(random() * 50) },
          () => ["a\n", "b\n", "c\r\n", "😀\n"][Math.floor(random() * 4)],
        ).join("");
      const a = make(),
        b = make();
      let value = a;
      for (const c of diffChanges(a, b).reverse())
        value = value.slice(0, c.from) + c.insert + value.slice(c.to);
      expect(value).toBe(b);
    }
  });
});
