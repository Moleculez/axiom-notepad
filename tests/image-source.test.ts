import { afterEach, expect, test } from "vitest";
import * as Y from "yjs";
import { nodeAt } from "../packages/markdown/src";
import { NativeBinding } from "../packages/editor/src/binding";
import { projectMarkdown } from "../packages/editor/src/projection";
import { ImageSourceSession } from "../apps/web/lib/editor-vnext/image-source";

for (const prefix of [
  "",
  "> ",
  "> > ",
  "- ",
  "- > ",
  "[^id]: ",
  "[^id]:\n    ",
]) {
  for (const ending of ["\n", "\r\n"]) {
    test(`activated image is ordinary mapped prose: ${JSON.stringify({ prefix, ending })}`, () => {
      const source = (
        prefix + 'Before ![Figure](/figure.png "Title") after'
      ).replace(/\n/g, ending);
      const node = nodeAt(source, source.indexOf("Figure"), ["image"])!;
      expect(node).toBeDefined();
      const result = projectMarkdown(source, {
        proseSource: true,
        reveal: true,
        imageSource: node,
        selection: { anchor: node.to, head: node.to },
      });
      expect(result.doc.textContent).toContain(
        '![Figure](/figure.png "Title")',
      );
      expect(
        result.blocks.filter((block) => block.node.type === "image"),
      ).toHaveLength(0);
      for (let at = node.from; at <= node.to; at++)
        expect(result.map.sourceAt(result.map.positionAt(at))).toBe(at);
      expect(result.doc.check()).toBeUndefined();
    });
  }
}
test("only the activated image reveals source", () => {
  const source = "![One](/one.png) and ![Two](/two.png)";
  const node = nodeAt(source, 3, ["image"])!;
  const result = projectMarkdown(source, {
    proseSource: true,
    reveal: true,
    imageSource: node,
    selection: { anchor: node.to, head: node.to },
  });
  expect(result.doc.textContent).toBe("![One](/one.png) and ");
  expect(
    result.blocks.filter((block) => block.node.type === "image"),
  ).toHaveLength(1);
});
test("quoted multiline image source retains hidden-prefix and CRLF mapping", () => {
  const source = '> ![multi\r\n> line](/figure.png "Title") after';
  const node = nodeAt(source, 5, ["image"])!;
  const result = projectMarkdown(source, {
    proseSource: true,
    reveal: true,
    imageSource: node,
    selection: { anchor: node.to, head: node.to },
  });
  expect(result.doc.textContent).toBe(
    '![multi\nline](/figure.png "Title") after',
  );
  for (const token of ["multi", "line", "Title", "after"]) {
    const at = source.indexOf(token);
    expect(result.map.sourceAt(result.map.positionAt(at))).toBe(at);
  }
});
test("image source inside a table cell is text, not a second source-bearing atom", () => {
  const source = "| A | B |\n| --- | --- |\n| ![Figure](/fig.png) | text |";
  const node = nodeAt(source, source.indexOf("Figure"), ["image"])!;
  const result = projectMarkdown(source, {
    proseSource: true,
    reveal: true,
    imageSource: node,
    selection: { anchor: node.to, head: node.to },
  });
  expect(result.doc.textContent).toContain("![Figure](/fig.png)");
  expect(
    result.blocks.filter((block) => block.node.type === "image"),
  ).toHaveLength(0);
});
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((close) => close()));
function fixture(source = "Before\n\n![Figure](/figure.png) after") {
  const doc = new Y.Doc(),
    text = doc.getText("markdown");
  text.insert(0, source);
  const undo = new Y.UndoManager(text),
    binding = new NativeBinding(doc, undo, null);
  const node = nodeAt(source, source.indexOf("Figure"), ["image"])!;
  const session = new ImageSourceSession(binding, node);
  let alive = true;
  const stop = binding.subscribe((source, _selection, local, changes) => {
    alive = session.changed(changes, local) && session.resolve(source);
  });
  cleanup.push(() => {
    stop();
    binding.destroy();
    undo.destroy();
    doc.destroy();
  });
  const replace = (from: number, to: number, insert: string) =>
    binding.transact({
      changes: [{ from, to, insert }],
      selection: { anchor: from + insert.length, head: from + insert.length },
      kind: "typing",
    });
  return { text, doc, binding, session, node, replace, alive: () => alive };
}
test("a live incomplete replacement retains only local preview metadata", () => {
  const f = fixture();
  f.replace(f.node.from, f.node.to, "![incomplete");
  expect(f.alive()).toBe(true);
  expect(f.binding.source).toContain("![incomplete after");
  expect(f.session.range).toEqual({ from: f.node.from, to: f.node.from + 12 });
  expect(f.session.valid).toBe(false);
  expect(f.session.preview().href).toBe("/figure.png");
});
test("a complete replacement updates the live image and trims following prose", () => {
  const f = fixture();
  const image = "![New](/new.png)";
  f.replace(f.node.from, f.node.to, image + " extra");
  expect(f.alive()).toBe(true);
  expect(f.session.valid).toBe(true);
  expect(f.session.range.to).toBe(f.node.from + image.length);
  expect(f.session.preview().href).toBe("/new.png");
});
test("deleting all image source ends preview ownership", () => {
  const f = fixture();
  f.replace(f.node.from, f.node.to, "");
  expect(f.alive()).toBe(false);
});
test("disjoint peer insertion rebases activation without writing source", () => {
  const f = fixture();
  f.doc.transact(() => f.text.insert(0, "Peer\n\n"), "peer");
  expect(f.alive()).toBe(true);
  expect(f.session.range.from).toBe(f.node.from + 6);
});
for (const value of ["", "![Peer](/peer.png)", "![Figure](/figure.png)"])
  test(`peer replacement invalidates the previous image identity: ${value}`, () => {
    const f = fixture();
    f.doc.transact(() => {
      f.text.delete(f.node.from, f.node.to - f.node.from);
      f.text.insert(f.node.from, value);
    }, "peer");
    expect(f.alive()).toBe(false);
  });
