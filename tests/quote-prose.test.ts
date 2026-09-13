import { expect, test } from "vitest";
import { projectMarkdown } from "../packages/editor/src/projection";
import {
  quoteBodyDelete,
  quoteBodyEdit,
} from "../packages/editor/src/quote-prose";
import { applyChanges } from "../packages/editor/src/transactions";
import { bridgeComposition } from "../packages/editor/src/bridge";
import { TextSelection } from "@milkdown/kit/prose/state";
import { EditorState } from "@milkdown/kit/prose/state";

const project = (source: string, at = source.length) =>
  projectMarkdown(source, {
    proseSource: true,
    reveal: true,
    selection: { anchor: at, head: at },
  });

test.each([">", ">no space", ">>nested"])(
  "pending marker remains literal: %s",
  (source) => {
    const p = project(source);
    expect(p.doc.firstChild!.type.name).toBe("source_prose");
    expect(p.doc.textContent).toBe(source);
  },
);
test.each([
  "> ",
  ">\t",
  "> **literal**",
  "> > nested",
  "  > ### Heading",
  "- > quoted",
  "> - [ ] task",
])("completed quote has an editable, exactly mapped body: %s", (source) => {
  const p = project(source);
  expect(p.activeProse[0].quote).toBeDefined();
  for (const line of (p.activeProse[0].list ?? p.activeProse[0].quote)!.lines)
    for (let at = line.bodyFrom; at <= line.to; at++)
      expect(p.map.sourceAt(p.map.positionAt(at))).toBe(at);
  expect(p.doc.check()).toBeUndefined();
  expect(p.doc.textContent).not.toContain(">");
});
test("the next nested quote only renders after its own space", () => {
  const pending = project("> >");
  expect(pending.doc.firstChild!.firstChild!.type.name).toBe("source_prose");
  expect(pending.doc.textContent).toBe(">");
  const complete = project("> > ");
  expect(complete.doc.firstChild!.firstChild!.type.name).toBe("blockquote");
  expect(complete.doc.textContent).toBe("");
});
test.each([0, 1, 2, 3])(
  "explicit source caret %i can edit nested quote markers",
  (at) => {
    const p = project("> > text", at);
    expect(p.map.sourceAt(p.map.positionAt(at))).toBe(at);
  },
);
test("nested headings keep real hashes and their semantic level", () => {
  const p = project("> > ### A **heading**");
  const node = p.doc.firstChild!.firstChild!.firstChild!;
  expect(node.attrs).toEqual({ kind: "heading", level: 3 });
  expect(node.textContent).toBe("### A **heading**");
});
test.each(["\n", "\r\n"])(
  "multiline typing and paste preserve quote prefixes and %j",
  (ending) => {
    const source = "> > alpha" + ending + "> > beta";
    const p = project(source, 9),
      quote = p.activeProse[0].quote!;
    const edit = quoteBodyEdit(source, { anchor: 9, head: 9 }, "\nx\ny", quote);
    expect(applyChanges(source, edit.changes)).toBe(
      "> > alpha" + ending + "> > x" + ending + "> > y" + ending + "> > beta",
    );
    const unwrapped = quoteBodyDelete(source, 4, true, quote)!;
    expect(applyChanges(source, unwrapped.changes)).toBe(
      "> alpha" + ending + "> beta",
    );
    expect(unwrapped.selection.anchor).toBe(2);
    const join = quoteBodyDelete(source, 9 + ending.length + 4, true, quote)!;
    expect(applyChanges(source, join.changes)).toBe("> > alphabeta");
  },
);
test("unwrapping affects only the current paragraph, never adjacent equations", () => {
  const source = "> before\n>\n> $$\n> x=1\n> $$\n>\n> after";
  const p = project(source);
  const edit = quoteBodyDelete(
    source,
    source.indexOf("after"),
    true,
    p.activeProse[0].quote!,
  )!;
  expect(applyChanges(source, edit.changes)).toBe(
    source.replace("> after", "after"),
  );
});
test("composition replacement across hidden prefixes adds continuation markers once", () => {
  const source = "> alpha\r\n> beta";
  const p = project(source);
  let state = EditorState.create({ doc: p.doc });
  const tr = state.tr
    .setSelection(
      TextSelection.create(
        state.doc,
        p.map.positionAt(2),
        p.map.positionAt(source.length),
      ),
    )
    .insertText("研\n究");
  state = state.apply(tr);
  const edit = bridgeComposition(p, state.doc)!;
  expect(applyChanges(source, edit.changes)).toBe("> 研\r\n> 究");
});
test("lazy nested continuations retain the outer quote on unwrap and gain explicit depth on paste", () => {
  const source = "> > first\n> lazy";
  const p = project(source);
  const quote = p.activeProse[0].quote!;
  expect(
    applyChanges(source, quoteBodyDelete(source, 4, true, quote)!.changes),
  ).toBe("> first\n> lazy");
  const at = source.length;
  expect(
    applyChanges(
      source,
      quoteBodyEdit(source, { anchor: at, head: at }, "\nnext", quote).changes,
    ),
  ).toBe(source + "\n> > next");
});
test("a bare continuation marker stays literal and source-addressable", () => {
  const source = "> first\n>";
  const p = project(source);
  expect(p.doc.textContent).toBe("first\n>");
  expect(p.map.sourceAt(p.map.positionAt(source.length))).toBe(source.length);
});
test("a mixed-ending note uses the nearest line ending for an EOF quote paste", () => {
  const source = "Earlier\r\n\r\nLater\n\n> body";
  const p = project(source);
  const at = source.length;
  expect(
    applyChanges(
      source,
      quoteBodyEdit(
        source,
        { anchor: at, head: at },
        "\nnext",
        p.activeProse[0].quote,
      ).changes,
    ),
  ).toBe(source + "\n> next");
});
