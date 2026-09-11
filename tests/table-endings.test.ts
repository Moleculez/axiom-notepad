import { describe, expect, test } from "vitest";
import {
  nodeAt,
  tableAction,
  tableModel,
  moveTableAxis,
} from "../packages/markdown/src/editing";
import { applyChanges } from "../packages/editor/src/transactions";

const model = (source: string) =>
  tableModel(source, nodeAt(source, source.indexOf("A"), ["table"])!)!;
describe("table operations preserve physical line endings", () => {
  test.each(["\n", "\r\n"])(
    "append, duplicate and paste with %j, including EOF",
    (eol) => {
      const source = ["| A | B |", "| --- | --- |", "| x | y |"].join(eol);
      const table = model(source);
      expect(
        applyChanges(source, tableAction(table, source, 1, 1, "columnAfter")),
      ).toBe(["| A | B |  |", "| --- | --- | --- |", "| x | y |  |"].join(eol));
      expect(
        applyChanges(source, tableAction(table, source, 1, 1, "rowAfter")),
      ).toBe(source + eol + "|  |  |");
      expect(
        applyChanges(source, tableAction(table, source, 1, 1, "duplicateRow")),
      ).toBe(source + eol + "| x | y |");
      expect(
        applyChanges(
          source,
          tableAction(table, source, 1, 0, "paste", [
            ["1", "2", "3"],
            ["4", "5", "6"],
            ["7", "8", "9"],
          ]),
        ),
      ).toBe(
        [
          "| A | B |  |",
          "| --- | --- | --- |",
          "| 1 | 2 | 3 |",
          "| 4 | 5 | 6 |",
          "| 7 | 8 | 9 |",
        ].join(eol),
      );
    },
  );
  test("reordering preserves destination line endings and an unterminated last row", () => {
    const source = "| A | B |\r\n| --- | --- |\n| x | y |\r\n| p | q |";
    const table = model(source);
    const expected = "| A | B |\r\n| --- | --- |\n| p | q |\r\n| x | y |";
    expect(
      applyChanges(source, tableAction(table, source, 1, 0, "rowDown")),
    ).toBe(expected);
    expect(
      applyChanges(source, moveTableAxis(table, source, "row", 2, 1)),
    ).toBe(expected);
    expect(
      applyChanges(source, moveTableAxis(table, source, "column", 0, 1)),
    ).toBe("| B | A |\r\n| --- | --- |\n| y | x |\r\n| q | p |");
  });
  test.each(["> ", "  "])(
    "nested %j tables retain prefixes and surrounding source",
    (prefix) => {
      const before =
        prefix === "  " ? "- Experiment\r\n\r\n" : "Before\r\n\r\n";
      const after = "\r\nAfter\r\n";
      const source =
        before +
        ["| A | B |", "| --- | --- |", "| x | y |"]
          .map((row) => prefix + row + "\r\n")
          .join("") +
        after;
      const table = model(source);
      expect(
        applyChanges(source, tableAction(table, source, 1, 0, "rowAfter")),
      ).toBe(source.replace(after, prefix + "|  |  |\r\n" + after));
      const next = applyChanges(
        source,
        tableAction(table, source, 1, 1, "columnAfter"),
      );
      expect(next).toBe(
        before +
          ["| A | B |  |", "| --- | --- | --- |", "| x | y |  |"]
            .map((row) => prefix + row + "\r\n")
            .join("") +
          after,
      );
    },
  );
  test("header-only EOF tables append the first body row with the separator's ending", () => {
    const source = "| A |\r\n| --- |";
    expect(
      applyChanges(
        source,
        tableAction(model(source), source, 0, 0, "rowAfter"),
      ),
    ).toBe(source + "\r\n|  |");
  });
});
