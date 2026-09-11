import { expect, test } from "vitest";
import { preserveLineEndings } from "../packages/editor/src/line-endings";
import { enterEdit, applyChanges } from "../packages/editor/src/transactions";
import { editorDefaults } from "../packages/shared/src/editor";

test.each([
  ["alpha\r\n\r\nomega", 5, false, "alpha\r\n\r\n\r\n\r\nomega", 9],
  ["alpha\r\n\r\nomega", 5, true, "alpha  \r\n\r\n\r\nomega", 9],
  ["> first\r\n\r\nAfter", 7, false, "> first\r\n> \r\n\r\nAfter", 11],
  ["- first\r\n\r\nAfter", 7, false, "- first\r\n- \r\n\r\nAfter", 11],
  ["# Title\r\n\r\nAfter", 7, false, "# Title\r\n\r\n\r\n\r\nAfter", 11],
  ["```py\r\n\r\nAfter", 5, false, "```py\r\n\r\n```\r\n\r\n\r\n\r\nAfter", 7],
  ["First\r\n\r\nlast", 13, false, "First\r\n\r\nlast\r\n\r\n", 17],
  ["First\r\n\r\nlast\nnext", 13, false, "First\r\n\r\nlast\n\n\nnext", 15],
  ["alpha\n\nomega", 5, false, "alpha\n\n\n\nomega", 7],
] as const)(
  "Enter maps changes and caret without normalizing %s",
  (source, at, soft, expected, caret) => {
    const edit = preserveLineEndings(
      source,
      { anchor: at, head: at },
      (source, selection) =>
        enterEdit(source, selection, editorDefaults, soft, true),
    );
    expect(applyChanges(source, edit.changes)).toBe(expected);
    expect(edit.selection.anchor).toBe(caret);
  },
);
test("a no-change command preserves a backward selection", () => {
  const selection = { anchor: 10, head: 3 };
  const edit = preserveLineEndings(
    "one\r\n\r\ntwo",
    selection,
    (_source, selection) => ({ changes: [], selection }),
  );
  expect(edit).toEqual({ changes: [], selection });
});
test("multiple changes preserve untouched mixed endings and map the result selection", () => {
  const source = "a\r\nb\nc";
  const edit = preserveLineEndings(source, { anchor: 0, head: 0 }, () => ({
    changes: [
      { from: 1, to: 1, insert: "\nx" },
      { from: 4, to: 5, insert: "z\nq" },
    ],
    selection: { anchor: 9, head: 2 },
  }));
  expect(applyChanges(source, edit.changes)).toBe("a\r\nx\r\nb\nz\nq");
  expect(edit.selection).toEqual({ anchor: 11, head: 3 });
});
