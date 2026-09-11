import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from "y-protocols/awareness";
import { editorDefaults } from "../packages/shared/src/editor";
import {
  applyChanges,
  codeLineEdit,
  enterEdit,
  graphemeBoundary,
  indentList,
  mapPosition,
  orderedChanges,
} from "../apps/web/lib/native-editor/transactions";
import { NativeBinding } from "../apps/web/lib/native-editor/binding";
import {
  displayOffsets,
  sourceOffsets,
} from "../apps/web/lib/native-editor/selection";
import {
  editingProjection,
  EditingSession,
} from "../apps/web/lib/native-editor/projection";
import { OwnedPairs } from "../apps/web/lib/native-editor/pairs";
import {
  literalBody,
  literalPrefix,
} from "../apps/web/lib/native-editor/literal";
import { nodeAt, parseMarkdown } from "../packages/markdown/src/index";

describe("native Markdown transactions", () => {
  test("validates original-source changes and stable equal-offset inserts", () => {
    expect(
      applyChanges("abcd", [
        { from: 1, to: 2, insert: "X" },
        { from: 3, to: 3, insert: "Y" },
      ]),
    ).toBe("aXcYd");
    expect(
      applyChanges("a", [
        { from: 1, to: 1, insert: "b" },
        { from: 1, to: 1, insert: "c" },
      ]),
    ).toBe("abc");
    expect(() =>
      orderedChanges(
        [
          { from: 1, to: 3, insert: "" },
          { from: 2, to: 4, insert: "" },
        ],
        5,
      ),
    ).toThrow();
    expect(() =>
      orderedChanges([{ from: -1, to: 0, insert: "" }], 5),
    ).toThrow();
    expect(mapPosition(4, [{ from: 0, to: 0, insert: "hi" }])).toBe(6);
  });
  test.each(["👩🏽‍🔬", "🇨🇳", "e\u0301", "𝛼", "क्‍ष"])(
    "deletes a whole grapheme: %s",
    (value) => {
      expect(graphemeBoundary("a" + value + "z", value.length + 1, -1)).toBe(1);
      expect(graphemeBoundary("a" + value + "z", 1, 1)).toBe(value.length + 1);
    },
  );
  test.each([
    ["- Result", "- Result\n- "],
    ["3. Result", "3. Result\n4. "],
    ["- [x] Result", "- [x] Result\n- [ ] "],
    ["> Result", "> Result\n> "],
    ["- ", ""],
    ["> > ", "> "],
    ["- parent\n    - ", "- parent\n- "],
  ])("structural Enter in %s", (source, result) => {
    const edit = enterEdit(
      source,
      { anchor: source.length, head: source.length },
      editorDefaults,
    );
    expect(applyChanges(source, edit.changes)).toBe(result);
  });
  test("indents an item with its children, not just the first physical line", () => {
    const source = "- first\n- second\n    - child\n- third\n";
    const selection = { anchor: 11, head: 11 };
    const edit = indentList(source, selection, false, 4)!;
    expect(applyChanges(source, edit.changes)).toBe(
      "- first\n    - second\n        - child\n- third\n",
    );
  });
  test("fences and pipe headers create editable body positions", () => {
    for (const source of ["```python", "$$", "| A | B |"]) {
      const edit = enterEdit(
        source,
        { anchor: source.length, head: source.length },
        editorDefaults,
      );
      const result = applyChanges(source, edit.changes);
      expect(result).toContain(
        source === "$$"
          ? "\n\n$$"
          : source.startsWith("|")
            ? "| --- | --- |"
            : "\n\n```",
      );
      expect(edit.selection.anchor).toBeLessThan(result.length);
    }
  });
  test("decoded text retains escaped/entity offsets", () => {
    expect(displayOffsets("A & B", "A &amp; B", 5)).toEqual([
      5, 6, 7, 12, 13, 14,
    ]);
    expect(displayOffsets("a|b", "a\\|b", 0)).toEqual([0, 2, 3, 4]);
  });
  test.each(["&amp;", "\\\\name", "\\> literal", "𝛼 é 👩🏽‍🔬", "  trailing  "])(
    "raw source maps every UTF-16 boundary literally: %s",
    (source) => {
      expect(sourceOffsets(source, 7)).toEqual(
        Array.from({ length: source.length + 1 }, (_, i) => i + 7),
      );
      expect(displayOffsets(source, source, 7)).toEqual(
        sourceOffsets(source, 7),
      );
    },
  );
  test("live editing retains the inline tree and container hierarchy without changing the canonical AST", () => {
    const source = "> - **one**  \n>\n> - *two*\n\nnext";
    const parsed = parseMarkdown(source),
      before = JSON.stringify(parsed);
    const nodes = editingProjection(
      source,
      parsed,
      { anchor: 8, head: 8 },
      true,
    );
    const first = nodes[0].children![0].children![0].children![0];
    expect(first.type).toBe("paragraph");
    expect(first.children?.[0].type).toBe("strong");
    expect(nodes.at(-1)?.type).toBe("paragraph");
    expect(JSON.stringify(parsed)).toBe(before);
  });
  test("a pending header cannot borrow the closing fence of a following block", () => {
    const source = "```python\n\n```js\nexisting\n```\n";
    const parsed = parseMarkdown(source);
    const projection = editingProjection(
      source,
      parsed,
      { anchor: 9, head: 9 },
      true,
      { from: 0, to: 9 },
    );
    expect(projection[0].type).toBe("editingParagraph");
    expect(projection[1].type).toBe("codeBlock");
    expect(projection[1].lang).toBe("js");
    const edit = enterEdit(
      source,
      { anchor: 9, head: 9 },
      editorDefaults,
      false,
      true,
    );
    expect(applyChanges(source, edit.changes)).toBe(
      "```python\n\n```\n\n\n\n```js\nexisting\n```\n",
    );
  });
  test("metadata and existing fence headers have deliberate Enter transitions", () => {
    const metadata = enterEdit(
      "---\n\nTail",
      { anchor: 3, head: 3 },
      editorDefaults,
    );
    expect(applyChanges("---\n\nTail", metadata.changes)).toBe(
      "---\n\n---\n\n\n\nTail",
    );
    const code = enterEdit(
      "```py\nx\n```",
      { anchor: 5, head: 5 },
      editorDefaults,
    );
    expect(code.changes).toEqual([]);
    expect(code.selection.anchor).toBe(6);
  });
  test("nested literal blocks hide only container prefixes and preserve them on Enter", () => {
    for (const source of [
      "> ```python\n> if x:\n>     y = '&amp;'\n> ```\n",
      "- item\n\n  ```python\n  if x:\n      y = 2\n  ```\n",
      "> $$\n> x+y\n> z\n> $$\n",
    ]) {
      const at = source.indexOf("x"),
        node = nodeAt(source, at, ["codeBlock", "mathBlock"])!;
      const literal = literalBody(source, node);
      expect(literal.text).not.toContain("> ");
      for (let i = 0; i < literal.text.length; i++)
        expect(source[literal.offsets[i]]).toBe(literal.text[i]);
      const end = source.indexOf("\n", at);
      const edit = enterEdit(
        source,
        { anchor: end, head: end },
        editorDefaults,
      );
      expect(edit.changes[0].insert).toBe(
        "\n" +
          literalPrefix(source, node) +
          (node.type === "codeBlock" ? "    " : ""),
      );
    }
  });
  test("nested code line moves cannot include the closing container fence", () => {
    const source = "> ```python\n> x = 1\n> ```\n";
    const selection = {
      anchor: source.indexOf("x"),
      head: source.indexOf("x"),
    };
    expect(codeLineEdit(source, selection, "moveDown")).toBeNull();
    const duplicate = codeLineEdit(source, selection, "duplicate")!;
    expect(applyChanges(source, duplicate.changes)).toBe(
      "> ```python\n> x = 1\n> x = 1\n> ```\n",
    );
  });
});

describe("native collaborative binding", () => {
  test("active source and pending header bookmarks rebase independently of parser identities", () => {
    const doc = new Y.Doc();
    doc.getText("markdown").insert(0, "```python\n\nFollowing");
    const undo = new Y.UndoManager(doc.getText("markdown"));
    const binding = new NativeBinding(doc, undo, null),
      session = new EditingSession(binding);
    session.beginHeader(0, 9);
    session.capture(
      editingProjection(
        binding.source,
        parseMarkdown(binding.source),
        { anchor: 9, head: 9 },
        true,
      ),
      { anchor: 9, head: 9 },
    );
    doc.getText("markdown").insert(0, "Remote\n\n");
    expect(session.header()).toEqual({ from: 8, to: 17 });
    expect(session.ranges()).toEqual([{ from: 8, to: 17 }]);
    session.commitHeader();
    expect(session.header()).toBeNull();
    binding.destroy();
    undo.destroy();
    doc.destroy();
  });
  test("owned pairs rebase with unrelated edits and are cancelled by a competing inner edit", () => {
    const doc = new Y.Doc();
    doc.getText("markdown").insert(0, "()");
    const undo = new Y.UndoManager(doc.getText("markdown")),
      binding = new NativeBinding(doc, undo, null),
      pairs = new OwnedPairs(binding);
    pairs.add(0, 1, "(", ")");
    doc.getText("markdown").insert(0, "Prefix ");
    pairs.rebase();
    expect(pairs.closer(8, ")")).toBeTruthy();
    pairs.beforeChange([{ from: 8, to: 8, insert: "peer" }], true);
    doc.getText("markdown").insert(8, "peer");
    pairs.rebase();
    expect(pairs.closer(12, ")")).toBeUndefined();
    binding.destroy();
    undo.destroy();
    doc.destroy();
  });
  function pair() {
    const a = new Y.Doc(),
      b = new Y.Doc();
    a.getText("markdown").insert(
      0,
      "# Study\n\n| A | B |\n| --- | --- |\n| x | y |\n",
    );
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const awarenessA = new Awareness(a),
      awarenessB = new Awareness(b);
    const one = new NativeBinding(
        a,
        new Y.UndoManager(a.getText("markdown")),
        awarenessA,
      ),
      two = new NativeBinding(
        b,
        new Y.UndoManager(b.getText("markdown")),
        awarenessB,
      );
    return {
      a,
      b,
      one,
      two,
      awarenessA,
      awarenessB,
      sync() {
        const av = Y.encodeStateAsUpdate(a),
          bv = Y.encodeStateAsUpdate(b);
        Y.applyUpdate(a, bv);
        Y.applyUpdate(b, av);
      },
      close() {
        one.destroy();
        two.destroy();
        awarenessA.destroy();
        awarenessB.destroy();
        one.undo.destroy();
        two.undo.destroy();
        a.destroy();
        b.destroy();
      },
    };
  }
  test("concurrent edits converge and undo removes only this author's operation", () => {
    const p = pair();
    const original = p.one.source;
    p.one.transact({
      changes: [{ from: 2, to: 2, insert: "Alice " }],
      selection: { anchor: 8, head: 8 },
      kind: "typing",
    });
    p.two.transact({
      changes: [{ from: 2, to: 2, insert: "Bob " }],
      selection: { anchor: 6, head: 6 },
      kind: "typing",
    });
    p.sync();
    expect(p.one.source).toBe(p.two.source);
    expect(p.one.source).toContain("Alice");
    expect(p.one.source).toContain("Bob");
    p.one.history(false);
    p.sync();
    expect(p.one.source).toBe(
      original.slice(0, 2) + "Bob " + original.slice(2),
    );
    p.one.history(true);
    p.sync();
    expect(p.one.source).toContain("Alice");
    p.close();
  });
  test("table positions and same-account devices publish without parent focus", () => {
    const p = pair();
    p.awarenessA.setLocalStateField("user", {
      id: "same",
      name: "Ada",
      color: "#224466",
    });
    p.awarenessB.setLocalStateField("user", {
      id: "same",
      name: "Ada",
      color: "#224466",
    });
    const at = p.one.source.indexOf("x | y");
    p.one.select({ anchor: at, head: at + 1 });
    applyAwarenessUpdate(
      p.awarenessB,
      encodeAwarenessUpdate(p.awarenessA, [p.a.clientID]),
      null,
    );
    expect(p.two.peers()).toEqual([
      {
        clientId: p.a.clientID,
        id: "same",
        name: "Ada",
        color: "#224466",
        selection: { anchor: at, head: at + 1 },
      },
    ]);
    p.two.transact({
      changes: [{ from: 0, to: 0, insert: "intro\n\n" }],
      kind: "typing",
    });
    expect(p.two.peers()[0].selection).toEqual({
      anchor: at + 7,
      head: at + 8,
    });
    p.close();
  });
  test("existing Y.Text updates round trip without document-format migration", () => {
    const p = pair(),
      state = Y.encodeStateAsUpdate(p.a);
    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, state);
    expect(loaded.getText("markdown").toString()).toBe(p.one.source);
    loaded.destroy();
    p.close();
  });
});
