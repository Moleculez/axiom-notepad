import { expect, test } from "vitest";
import { nodeAt, quoteContext } from "../packages/markdown/src/index";
import { editorDefaults } from "../packages/shared/src/editor";
import { projectMarkdown } from "../packages/editor/src/projection";
import { applyChanges, enterEdit } from "../packages/editor/src/transactions";
import { preserveLineEndings } from "../packages/editor/src/line-endings";

for (const prefix of ["", "> ", "> > ", "- ", "- > "]) {
  test(`images remain mapped atoms in active prose: ${JSON.stringify(prefix)}`, () => {
    const source = prefix + "Before ![Figure](/figure.png) after";
    const image = nodeAt(source, source.indexOf("Figure"), ["image"])!;
    for (const at of [source.length, image.from, image.to]) {
      const projection = projectMarkdown(source, {
        proseSource: true,
        reveal: true,
        selection: { anchor: at, head: at },
      });
      const atom = projection.blocks.find((b) => b.node.type === "image")!;
      expect(atom).toBeDefined();
      expect(projection.doc.nodeAt(atom.from)?.type.name).toBe(
        "inline_preview",
      );
      expect(projection.map.sourceAt(atom.from)).toBe(image.from);
      expect(projection.map.sourceAt(atom.to, -1)).toBe(image.to);
      expect(projection.doc.textContent).not.toContain("![Figure]");
      expect(projection.doc.textContent).toContain("Before ");
      expect(projection.doc.textContent).toContain(" after");
      expect(projection.doc.check()).toBeUndefined();
    }
  });
}

test("incomplete image syntax and code literals remain text", () => {
  for (const source of [
    "![unfinished",
    "```md\n![literal](/figure.png)\n```",
    "`![literal](/figure.png)`",
  ]) {
    const projection = projectMarkdown(source, {
      proseSource: true,
      reveal: true,
      selection: { anchor: source.length, head: source.length },
    });
    expect(projection.blocks.some((b) => b.node.type === "image")).toBe(false);
  }
});

test("multiline images stay atomic inside quote authoring units", () => {
  for (const source of [
    "> Before ![multi\n> line](/figure.png) after",
    '> Before ![Figure](/figure.png\n> "Title") after',
  ]) {
    const projection = projectMarkdown(source, {
      proseSource: true,
      reveal: true,
      selection: { anchor: source.length, head: source.length },
    });
    const atom = projection.blocks.find((b) => b.node.type === "image")!;
    expect(atom).toBeDefined();
    expect(projection.doc.textContent).toBe("Before  after");
    expect(projection.map.sourceAt(atom.from)).toBe(atom.node.from);
    expect(projection.map.sourceAt(atom.to, -1)).toBe(atom.node.to);
    expect(projection.doc.check()).toBeUndefined();
  }
});

for (const ending of ["\n", "\r\n"]) {
  for (const [sourcePrefix, parentPrefix] of [
    ["> > ", "> "],
    ["> > > ", "> > "],
    ["- > > ", "  > "],
    ["> - > > ", ">   > "],
  ]) {
    test(`leaving child prose prevents lazy continuation: ${sourcePrefix} ${JSON.stringify(ending)}`, () => {
      const before = "Before" + ending.repeat(2);
      let source = before + sourcePrefix + "Child";
      let selection = { anchor: source.length, head: source.length };
      for (let i = 0; i < 2; i++) {
        const edit = preserveLineEndings(source, selection, (text, at) =>
          enterEdit(text, at, editorDefaults),
        );
        source = applyChanges(source, edit.changes);
        selection = {
          anchor: edit.selection.anchor,
          head: edit.selection.head ?? edit.selection.anchor,
        };
      }
      expect(source).toBe(
        before +
          sourcePrefix +
          "Child" +
          ending +
          parentPrefix.trimEnd() +
          ending +
          parentPrefix,
      );
      source += "Parent";
      const context = quoteContext(source, source.length)!;
      expect(context.prefix).toBe(parentPrefix);
      expect(nodeAt(source, source.length - 1, ["paragraph"])?.text).toBe(
        "Parent",
      );
      const projection = projectMarkdown(source, {
        proseSource: true,
        reveal: true,
        selection: { anchor: source.length, head: source.length },
      });
      expect(
        projection.map.sourceAt(projection.map.positionAt(source.length)),
      ).toBe(source.length);
    });
  }
}

test("exiting a quote after mathematics inserts a parent-level separator", () => {
  const source = "> > $$\n> > x\n> > $$\n> > ";
  const edit = enterEdit(
    source,
    { anchor: source.length, head: source.length },
    editorDefaults,
  );
  expect(applyChanges(source, edit.changes)).toBe(
    "> > $$\n> > x\n> > $$\n>\n> ",
  );
});
