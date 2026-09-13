import { describe, expect, test } from "vitest";
import {
  parseMarkdown,
  nodeAt,
  paragraphBesideBlock,
} from "../packages/markdown/src/index";
import { enterEdit, applyChanges } from "../packages/editor/src/transactions";
import { emptyBlockDelete } from "../packages/editor/src/deletion";
import { projectMarkdown } from "../packages/editor/src/projection";
import { editorDefaults } from "../packages/shared/src/editor";

describe("authoring block boundaries", () => {
  test.each(["*", "-", "+", "1.", "12)"])(
    "%s needs its delimiter space, not just a parsed wrapper",
    (marker) => {
      for (const prefix of ["", "- existing\n", "> ", "- parent\n  "]) {
        const source = prefix + marker;
        const p = projectMarkdown(source, {
          proseSource: true,
          reveal: true,
          selection: { anchor: source.length, head: source.length },
        });
        const raw: string[] = [];
        p.doc.descendants((n) => {
          if (n.type.name === "source_prose") raw.push(n.textContent);
        });
        expect(raw.some((text) => text.endsWith(marker))).toBe(true);
        expect(p.map.sourceAt(p.map.positionAt(source.length))).toBe(
          source.length,
        );
        if (!prefix) expect(p.doc.firstChild?.type.name).toBe("source_prose");
        p.doc.check();
      }
    },
  );
  test.each([
    ["> 1\n> 2\n> ", "> 1\n> 2\n\n"],
    ["> > 1\n> > ", "> > 1\n>\n> "],
    ["- a\n- ", "- a\n\n"],
    ["> - a\n> - ", "> - a\n>\n> "],
    ["- parent\n    - child\n    - ", "- parent\n    - child\n- "],
    ["> - parent\n>   - child\n>   - ", "> - parent\n>   - child\n> - "],
    ["[^n]:\n    > a\n    > ", "[^n]:\n    > a\n    \n    "],
  ])("Enter exits only the requested level: %s", (source, expected) => {
    const edit = enterEdit(
      source,
      { anchor: source.length, head: source.length },
      editorDefaults,
    );
    expect(applyChanges(source, edit.changes)).toBe(expected);
    expect(edit.selection.anchor).toBe(expected.length);
  });
  test("root quote exit excludes the next text but imported lazy prose remains valid", () => {
    const source = "> 1\n> 2\n> ";
    const edit = enterEdit(
      source,
      { anchor: source.length, head: source.length },
      editorDefaults,
    );
    const after = applyChanges(source, edit.changes) + "3";
    expect(parseMarkdown(after).ast.children?.map((n) => n.type)).toEqual([
      "blockquote",
      "paragraph",
    ]);
    expect(
      parseMarkdown("> 1\n> 2\n3").ast.children?.map((n) => n.type),
    ).toEqual(["blockquote"]);
  });
  test.each([
    ["$$\n\n$$", 3, ""],
    ["```py\n\n```", 6, ""],
    ["# ", 2, ""],
    ["- [ ] ", 6, ""],
    ["> ", 2, ""],
    ["> [!NOTE]\n> ", 12, ""],
    ["[^n]:\n    ", 10, ""],
    ["- parent\n    - ", 15, "- parent\n\n  "],
    ["> - parent\n>   - ", 17, "> - parent\n>\n>   "],
    ["|  |  |\n| --- | --- |\n|  |  |", 2, ""],
  ] as const)(
    "already-empty Backspace removes structure: %s",
    (source, at, expected) => {
      const edit = emptyBlockDelete(source, { anchor: at, head: at });
      expect(edit).not.toBeNull();
      expect(applyChanges(source, edit!.changes)).toBe(expected);
    },
  );
  test.each([
    "$$\n \n$$",
    "- parent\n  - child",
    "> kept\n> ",
    "| A | B |\n| --- | --- |\n|  |  |",
    "![image](https://example.com/a.png)",
    "---",
    "[TOC]",
  ])("meaningful contents and atoms are not empty: %s", (source) => {
    expect(
      emptyBlockDelete(source, {
        anchor: source.length - 1,
        head: source.length - 1,
      }),
    ).toBeNull();
  });
  test("a nested literal exits within its owning item and reuses the paragraph", () => {
    const source = "- parent\n\n  ```py\n  x\n  ```";
    const node = nodeAt(source, source.indexOf("x"), ["codeBlock"])!;
    const edit = paragraphBesideBlock(source, node);
    const after = applyChanges(source, edit.changes);
    expect(after).toBe(source + "\n\n  ");
    const again = paragraphBesideBlock(
      after,
      nodeAt(after, source.indexOf("x"), ["codeBlock"])!,
    );
    expect(again.changes).toEqual([]);
    expect(nodeAt(after + "next", after.length + 2, ["item"])).toBeDefined();
  });
});
