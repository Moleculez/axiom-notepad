import { describe, expect, test } from "vitest";
import { parseMarkdown, nodeAt } from "../packages/markdown/src/index";
import { projectMarkdown } from "../packages/editor/src/projection";
import {
  enterEdit,
  applyChanges,
  indentList,
} from "../packages/editor/src/transactions";
import { editorDefaults } from "../packages/shared/src/editor";
import { listBodyEdit } from "../packages/editor/src/list-prose";

describe("persistent rendered list markers", () => {
  test.each(["- ", "* ", "1. ", "12) ", "- [ ] ", "- [x] "])(
    "completed marker %s retains a real list and a body caret",
    (marker) => {
      for (const contents of ["", "α **research**"]) {
        const source = marker + contents;
        const projection = projectMarkdown(source, {
          proseSource: true,
          reveal: true,
          selection: { anchor: source.length, head: source.length },
        });
        expect(projection.doc.firstChild!.type.name).toMatch(
          /^(bullet|ordered)_list$/,
        );
        expect(projection.doc.textContent).toBe(contents);
        expect(
          projection.map.sourceAt(projection.map.positionAt(source.length)),
        ).toBe(source.length);
        expect(projection.activeProse[0].list).toBeDefined();
        projection.doc.check();
      }
    },
  );
  test.each([
    "- a\n  - child",
    "> 1. a\n>    1. child",
    "[^n]:\n    - a\n      - child",
  ])("nested bodies hide only their own structural prefix: %s", (source) => {
    const at = source.indexOf("child") + 3;
    const projection = projectMarkdown(source, {
      proseSource: true,
      reveal: true,
      selection: { anchor: at, head: at },
    });
    expect(projection.doc.textContent).toContain("child");
    expect(projection.doc.textContent).not.toContain("- child");
    expect(projection.doc.textContent).not.toContain("1. child");
    expect(projection.map.sourceAt(projection.map.positionAt(at))).toBe(at);
  });
});
describe("list line and group boundaries", () => {
  const enter = (source: string, soft = false) => {
    const edit = enterEdit(
      source,
      { anchor: source.length, head: source.length },
      editorDefaults,
      soft,
    );
    return applyChanges(source, edit.changes);
  };
  test("a hard break continues the same item; Enter on that continuation creates the next item", () => {
    const source = enter("12. alpha", true) + "beta";
    expect(source).toBe("12. alpha  \n    beta");
    expect(enter(source)).toBe("12. alpha  \n    beta\n13. ");
  });
  test("empty nested ordered and quoted items exit exactly one actual level", () => {
    expect(enter("1. parent\n   1. child\n   2. ")).toBe(
      "1. parent\n   1. child\n2. ",
    );
    expect(enter("> - parent\n>   - child\n>   - ")).toBe(
      "> - parent\n>   - child\n> - ",
    );
    expect(enter("- parent\n    - child\n        - ")).toBe(
      "- parent\n    - child\n    - ",
    );
  });
  test("Tab uses enough indentation for a long ordered parent; first items do not turn into code", () => {
    const source = "1000. parent\n1001. child",
      at = source.length;
    const edit = indentList(source, { anchor: at, head: at }, false, 2)!;
    const after = applyChanges(source, edit.changes);
    expect(after).toBe("1000. parent\n      1. child");
    expect(nodeAt(after, after.length, ["item"])?.from).toBe(
      after.indexOf("1. child"),
    );
    expect(
      indentList("- first", { anchor: 7, head: 7 }, false, 4)?.changes,
    ).toEqual([]);
    expect(parseMarkdown(after).ast.children?.[0].type).toBe("list");
  });
  test("multiline input carries explicit quote/list continuation prefixes", () => {
    const source = "> - alpha",
      at = source.length;
    const edit = listBodyEdit(source, { anchor: at, head: at }, "\nsecond")!;
    expect(applyChanges(source, edit.changes)).toBe("> - alpha\n>   second");
  });
});
