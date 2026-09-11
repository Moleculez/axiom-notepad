import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import {
  parseMarkdown,
  sourceCommand,
  tableAction,
  tableModel,
  nodeAt,
} from "../packages/markdown/src/index";
import { projectMarkdown } from "../packages/editor/src/projection";
import {
  bridgeTransaction,
  bridgeComposition,
} from "../packages/editor/src/bridge";
import { NativeBinding as SourceBinding } from "../packages/editor/src/binding";
import { applyChanges } from "../packages/editor/src/transactions";
import { resolveAnchor } from "../packages/editor/src/annotations";
import { findMatches } from "../packages/editor/src/search";

const fixtures = [
  "# Title ###\r\n\r\n  * alternate __strong__ &amp; \\*escaped\\*\r\n",
  "> > Quoted **science**\n> > continued\n\n+ [x] task\n  - nested\n",
  "| A | B |\r\n| :--- | ---: |\r\n| α | $x$ |\r\n",
  "~~~python\r\nx = 1\r\n~~~\r\n\r\n$$\r\n\\int_0^1 x^2 dx\r\n$$\r\n",
  "---\ntitle: Lab\n---\n\n:::theorem Experiment\nTest\n:::\n\n[^a]: note\n\n[ref]: /paper\n\n[read][ref]\n",
  "Raw <script>alert(1)</script> and ![private](attachment://x)\n\nUnknown {{extension}}\n",
  "👩🏽‍🔬 e\u0301 𝛼 العربية 中文\n\n",
  "",
  "\n\n",
  "> ",
  "- [ ] ",
  "`",
  "**",
  "$$",
  "```py",
];
describe("source-authoritative Milkdown bridge", () => {
  test("replacement undo and redo restore both selections across peer rebasing", () => {
    const doc = new Y.Doc(),
      text = doc.getText("markdown");
    text.insert(0, "abcdef tail");
    const undo = new Y.UndoManager(text),
      binding = new SourceBinding(doc, undo, null);
    binding.select({ anchor: 2, head: 4 });
    binding.transact({
      changes: [{ from: 2, to: 4, insert: "XYZ" }],
      selection: { anchor: 5, head: 5 },
      kind: "command",
    });
    doc.transact(() => text.insert(0, "Peer "), "remote");
    for (let i = 0; i < 3; i++) {
      binding.history(false);
      expect(binding.source).toBe("Peer abcdef tail");
      expect(binding.selection()).toEqual({ anchor: 7, head: 9 });
      binding.history(true);
      expect(binding.source).toBe("Peer abXYZef tail");
      expect(binding.selection()).toEqual({ anchor: 10, head: 10 });
    }
    binding.destroy();
    undo.destroy();
    doc.destroy();
  });
  test("search treats punctuation literally, supports Unicode words and retains source offsets", () => {
    expect(findMatches("$x$ and $X$", "$x$")).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ]);
    expect(findMatches("$x$ and $X$", "$x$", true)).toEqual([
      { from: 0, to: 3 },
    ]);
    expect(findMatches("x xx αx xβ x", "x", false, true)).toEqual([
      { from: 0, to: 1 },
      { from: 11, to: 12 },
    ]);
    expect(findMatches("👩🏽‍🔬 研究", "研究")).toEqual([{ from: 8, to: 10 }]);
    expect(findMatches("[.*+?^${}()|\\]", "[.*+?^${}()|\\]")).toHaveLength(1);
    expect(findMatches("unchanged", "")).toEqual([]);
  });
  test("a failed view subscriber cannot pin subsequent remote edits to a stale local selection", () => {
    const doc = new Y.Doc(),
      text = doc.getText("markdown");
    text.insert(0, "abc");
    const undo = new Y.UndoManager(text),
      binding = new SourceBinding(doc, undo, null);
    binding.select({ anchor: 3, head: 3 });
    const unsubscribe = binding.subscribe(() => {
      throw new Error("view failure");
    });
    expect(() =>
      binding.transact({
        changes: [{ from: 3, to: 3, insert: "d" }],
        selection: { anchor: 4, head: 4 },
        kind: "typing",
      }),
    ).toThrow("view failure");
    unsubscribe();
    doc.transact(() => text.insert(0, "peer "), "remote");
    expect(binding.selection()).toEqual({ anchor: 9, head: 9 });
    binding.destroy();
    undo.destroy();
    doc.destroy();
  });
  test("discussion anchors follow source edits and become unresolved on deletion", () => {
    const doc = new Y.Doc(),
      text = doc.getText("markdown");
    text.insert(0, "A **finding** here");
    const anchor = {
      generation: 3,
      quote: "finding",
      start: Array.from(
        Y.encodeRelativePosition(
          Y.createRelativePositionFromTypeIndex(text, 4),
        ),
      ),
      end: Array.from(
        Y.encodeRelativePosition(
          Y.createRelativePositionFromTypeIndex(text, 11),
        ),
      ),
    };
    text.insert(0, "Peer ");
    expect(resolveAnchor(doc, 3, anchor)).toEqual({ from: 9, to: 16 });
    expect(resolveAnchor(doc, 4, anchor)).toBeNull();
    text.delete(9, 7);
    expect(resolveAnchor(doc, 3, anchor)).toBeNull();
    expect(anchor.quote).toBe("finding");
    expect(resolveAnchor(doc, 3, { ...anchor, start: [999] })).toBeNull();
    doc.destroy();
  });
  test.each(fixtures)(
    "opening/revealing a document never writes or normalizes %s",
    (source) => {
      const doc = new Y.Doc();
      doc.getText("markdown").insert(0, source);
      const binding = new SourceBinding(
        doc,
        new Y.UndoManager(doc.getText("markdown")),
        null,
      );
      let updates = 0;
      doc.on("update", () => updates++);
      for (const position of [
        0,
        Math.floor(source.length / 2),
        source.length,
      ]) {
        const p = projectMarkdown(source, {
          selection: { anchor: position, head: position },
          reveal: true,
        });
        p.doc.check();
        expect(p.source).toBe(source);
        expect(p.parsed).toEqual(parseMarkdown(source));
        binding.select({ anchor: position, head: position });
      }
      expect(updates).toBe(0);
      expect(binding.source).toBe(source);
      binding.destroy();
      doc.destroy();
    },
  );
  test("caret-local syntax is real mapped text and other formatting stays rich", () => {
    const source = "**one** and _two_";
    const p = projectMarkdown(source, {
      selection: { anchor: 3, head: 3 },
      reveal: true,
    });
    expect(p.doc.textContent).toBe("**one** and two");
    const pos = p.map.positionAt(1);
    expect(p.doc.textBetween(pos, pos + 1)).toBe("*");
    expect(p.map.sourceAt(pos)).toBe(1);
    const tr = EditorState.create({ doc: p.doc }).tr.delete(pos, pos + 1);
    expect(applyChanges(source, bridgeTransaction(p, tr).changes)).toBe(
      "*one** and _two_",
    );
  });
  test.each(["&amp;", "\\*", "&#x1F52C;", "&NotEqualTilde;"])(
    "entity/escape editing retains spelling: %s",
    (token) => {
      const source = `a ${token} z`;
      const p = projectMarkdown(source, {
        selection: { anchor: 3, head: 3 },
        reveal: true,
      });
      expect(p.doc.textContent).toBe(source);
      for (let at = 0; at < source.length; at++)
        expect(p.map.sourceAt(p.map.positionAt(at))).toBe(at);
    },
  );
  test("table-cell typing patches that cell, preserving separators and whitespace", () => {
    const source = "| A  | B |\r\n| :--- | ---: |\r\n| α | β |\r\n";
    const p = projectMarkdown(source),
      at = source.indexOf("α") + 1;
    const tr = EditorState.create({ doc: p.doc }).tr.insertText(
      "+1",
      p.map.positionAt(at, -1),
    );
    const edit = bridgeTransaction(p, tr);
    expect(edit.changes).toEqual([{ from: at, to: at, insert: "+1" }]);
    expect(applyChanges(source, edit.changes)).toBe(source.replace("α", "α+1"));
  });
  test("composition is one source patch and preserves surrounding delimiters", () => {
    const source = "**研究** and untouched _style_";
    const p = projectMarkdown(source, {
      reveal: true,
      selection: { anchor: 3, head: 3 },
    });
    const state = EditorState.create({ doc: p.doc });
    const tr = state.tr.insertText(
      "物理",
      p.map.positionAt(2),
      p.map.positionAt(4),
    );
    const edit = bridgeComposition(p, tr.doc)!;
    expect(applyChanges(source, edit.changes)).toBe(
      "**物理** and untouched _style_",
    );
  });
  test("selection-only transactions never produce patches", () => {
    const p = projectMarkdown("**test**");
    const state = EditorState.create({ doc: p.doc });
    expect(
      bridgeTransaction(
        p,
        state.tr.setSelection(TextSelection.create(p.doc, 2)),
      ).changes,
    ).toEqual([]);
  });
  test("source commands, rich edits and table operations share author-local Yjs undo", () => {
    const a = new Y.Doc(),
      b = new Y.Doc();
    a.getText("markdown").insert(
      0,
      "Hello\n\n| A | B |\n| --- | --- |\n| x | y |\n",
    );
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const undo = new Y.UndoManager(a.getText("markdown"));
    const binding = new SourceBinding(a, undo, null);
    const source = binding.source,
      p = projectMarkdown(source);
    const edit = bridgeTransaction(
      p,
      EditorState.create({ doc: p.doc }).tr.insertText(
        "!",
        p.map.positionAt(5, -1),
      ),
    );
    binding.transact({ ...edit, kind: "typing" });
    const format = sourceCommand("bold", binding.source, 0, 5)!;
    binding.transact({ changes: format.changes, kind: "command" });
    const model = tableModel(
      binding.source,
      nodeAt(binding.source, binding.source.indexOf("|"), ["table"])!,
    )!;
    binding.transact({
      changes: tableAction(model, binding.source, 1, 0, "rowAfter"),
      kind: "command",
    });
    b.getText("markdown").insert(0, "Peer ");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    binding.history(false);
    binding.history(false);
    binding.history(false);
    expect(binding.source).toBe("Peer " + source);
    binding.destroy();
    undo.destroy();
    a.destroy();
    b.destroy();
  });
});
