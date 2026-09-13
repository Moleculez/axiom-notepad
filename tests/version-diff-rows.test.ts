import { expect, it } from "vitest";
import {
  versionDiffRows,
  collapseRevisionRows,
} from "../packages/shared/src/version-diff-rows";
for (const [before, after] of [
  ["", "new\n"],
  ["same\n", "\nsame"],
  ["α\nβ\r\nlast", "α\nOther\nlast\n"],
  ["a\nb\nc\n", "x\ny\nz\nextra\n"],
  ["no newline", "not the same line"],
]) {
  it("line cells retain exact inputs " + JSON.stringify(before), () => {
    const rows = versionDiffRows(before, after);
    expect(rows.map((r) => r.before?.text ?? "").join("")).toBe(before);
    expect(rows.map((r) => r.after?.text ?? "").join("")).toBe(after);
    expect(rows.flatMap((r) => (r.before ? [r.before.number] : []))).toEqual(
      Array.from(
        { length: rows.filter((r) => r.before).length },
        (_, i) => i + 1,
      ),
    );
  });
}
it("collapses only unchanged runs with surrounding context", () => {
  const source = Array.from({ length: 100 }, (_, i) => i + "\n").join("");
  const rows = versionDiffRows(source, source.replace("50\n", "different\n")),
    collapsed = collapseRevisionRows(rows);
  expect(collapsed.filter((r) => r.changed)).toHaveLength(1);
  expect(collapsed.filter((r) => r.omitted).length).toBe(2);
  expect(collapsed.length).toBeLessThan(20);
});
