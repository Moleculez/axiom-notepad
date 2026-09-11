import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import { parseMarkdown, nodeAt } from "../packages/markdown/src";
import { NativeBinding } from "../packages/editor/src/binding";
import {
  bookmarkTable,
  resolveTable,
} from "../packages/editor/src/table-target";

const make = (ending = "\n") => {
  const source = [
    "Before",
    "",
    "| A | B |",
    "| --- | ---: |",
    "| alpha | beta |",
    "",
    "After",
  ].join(ending);
  const doc = new Y.Doc();
  const text = doc.getText("markdown");
  text.insert(0, source);
  const undo = new Y.UndoManager(text);
  const binding = new NativeBinding(doc, undo, null);
  const node = nodeAt(source, source.indexOf("| A"), ["table"])!;
  const target = bookmarkTable(binding, source, node, { row: 1, column: 1 })!;
  const close = () => {
    binding.destroy();
    undo.destroy();
    doc.destroy();
  };
  return { source, text, target, binding, close };
};
describe("source-relative table action targets", () => {
  test.each(["\n", "\r\n"])(
    "unrelated edits rebase and cell typing retains its identity (%j)",
    (ending) => {
      const f = make(ending);
      try {
        f.text.insert(0, "Peer" + ending + ending);
        const at = f.text.toString().indexOf("alpha");
        f.text.insert(at + 2, "NEW");
        const current = resolveTable(f.binding, f.text.toString(), f.target);
        expect(current?.model.rows[1].cells[0].raw).toBe("alNEWpha");
        expect(current?.column).toBe(1);
        expect(current?.row).toBe(1);
        expect(current?.node.from).toBe(
          f.source.indexOf("| A") + "Peer".length + ending.length * 2,
        );
        expect(parseMarkdown(f.text.toString()).ast.children).toBeDefined();
      } finally {
        f.close();
      }
    },
  );
  test.each(["same-text replacement", "new row", "removed table"])(
    "invalidates a target after %s",
    (kind) => {
      const f = make();
      try {
        const at = f.source.indexOf("| alpha");
        if (kind === "new row") f.text.insert(at, "| new | row |\n");
        else if (kind === "removed table")
          f.text.delete(
            f.source.indexOf("| A"),
            f.source.indexOf("\n\nAfter") - f.source.indexOf("| A"),
          );
        else {
          const row = "| alpha | beta |";
          f.text.delete(at, row.length);
          f.text.insert(at, row);
        }
        expect(resolveTable(f.binding, f.text.toString(), f.target)).toBeNull();
      } finally {
        f.close();
      }
    },
  );
});
