import { describe, expect, test } from "vitest";
import { EditorState } from "@milkdown/kit/prose/state";
import {
  documentIndex,
  footnoteBody,
  footnoteDefinitionAt,
  footnoteCommand,
  nodeAt,
  parseMarkdown,
  sourceCommand,
  slashQuery,
  tableAction,
  tableModel,
} from "../packages/markdown/src";
import { projectMarkdown } from "../packages/editor/src/projection";
import { applyChanges, indentList } from "../packages/editor/src/transactions";
import { codeFenceQuery } from "../packages/editor/src/code-languages";
import { footnoteInput } from "../packages/editor/src/footnotes";
import { literalBody, literalPrefix } from "../packages/editor/src/literal";
import {
  bridgeTransaction,
  bridgeComposition,
} from "../packages/editor/src/bridge";

const before = "Result[^a].\n\n";
const project = (source: string, at?: number, extra = {}) =>
  projectMarkdown(source, {
    proseSource: true,
    reveal: at !== undefined,
    selection: at === undefined ? undefined : { anchor: at, head: at },
    ...extra,
  });
const bodyOf = (source: string) =>
  footnoteBody(
    source,
    parseMarkdown(source).definitions!.find(
      (n) => n.type === "footnoteDefinition",
    )!,
  );

describe("footnote rich projection and canonical source", () => {
  test.each(["\n", "\r\n"])(
    "child nodes hide only footnote prefixes (%j)",
    (ending) => {
      const source = (
        before +
        "[^a]: First **paragraph**.\n\n    Second _paragraph_.\n\n    > Quote\n\n    - Item\n\nAfter"
      ).replaceAll("\n", ending);
      const projection = project(source, source.indexOf("Second") + 3);
      const footnote = projection.doc.child(1);
      expect(footnote.type.name).toBe("footnote");
      expect(footnote.attrs.key).toBe("a");
      expect(footnote.textContent).toBe(
        "First paragraph.Second _paragraph_.QuoteItem",
      );
      expect(projection.doc.lastChild!.textContent).toBe("After");
      expect(projection.activeProse).toEqual([
        {
          from: source.indexOf("Second"),
          to: source.indexOf("Second") + "Second _paragraph_.".length,
          kind: "paragraph",
          footnote: before.replaceAll("\n", ending).length,
        },
      ]);
      const span = projection.activeProse[0];
      for (let at = span.from; at <= span.to; at++)
        expect(projection.map.sourceAt(projection.map.positionAt(at))).toBe(at);
      expect(projection.doc.check()).toBeUndefined();
    },
  );
  test.each(["    ", "\t"])(
    "marker-only header is not an extra body paragraph (%j)",
    (prefix) => {
      const source =
        before +
        "[^a]:\n" +
        prefix +
        "Body\n" +
        prefix +
        "\n" +
        prefix +
        "Second";
      const body = bodyOf(source);
      expect(body.text).toBe("Body\n\nSecond");
      expect(body.offsets).toHaveLength(body.text.length + 1);
      body.offsets.forEach((at, index) => expect(body.bodyAt(at)).toBe(index));
      const footnote = project(source, source.indexOf("Body")).doc.lastChild!;
      expect(footnote.childCount).toBe(2);
      expect(footnote.firstChild!.textContent).toBe("Body");
    },
  );
  test.each(["[^a]:", "[^a]:\n    "])(
    "empty footnote has exactly one editable body: %s",
    (tail) => {
      const source = before + tail;
      const body = bodyOf(source),
        projection = project(source, source.length);
      expect(body.text).toBe("");
      expect(projection.doc.lastChild!.type.name).toBe("footnote");
      expect(projection.doc.lastChild!.childCount).toBe(1);
      expect(
        projection.map.sourceAt(projection.map.positionAt(source.length)),
      ).toBe(source.length);
    },
  );
  test("an author-local draft is just the opener and does not affect other notes", () => {
    const source = before + "[^a]:\n\n[^b]: Elsewhere";
    const projection = project(source, before.length + 5, {
      footnoteDraft: before.length,
    });
    expect(projection.doc.child(1).type.name).toBe("source_prose");
    expect(projection.doc.child(1).textContent).toBe("[^a]:");
    expect(projection.doc.lastChild!.type.name).toBe("footnote");
  });
  test("references in a body retain document-wide definitions", () => {
    const source =
      before +
      "[^a]: See[^b] and [paper][p].\n\n[^b]: Other.\n[p]: https://example.org";
    const projection = project(source);
    expect(
      projection.blocks
        .filter((b) => b.node.type === "footnoteRef")
        .map((b) => b.node.key),
    ).toEqual(["a", "b"]);
    expect(projection.doc.child(1).firstChild!.lastChild!.text).toBe(".");
    expect(
      projection.blocks.find(
        (b) => b.node.type === "footnoteRef" && b.node.key === "b",
      )!.node.from,
    ).toBe(source.indexOf("[^b]"));
  });
  test.each(["$$\n    x=1\n    $$", "```py\n    x=1\n    ```"])(
    "literals retain their original canonical ranges: %s",
    (block) => {
      const source = before + "[^a]: " + block + "\n\nAfter";
      const at = source.indexOf("x=1"),
        projection = project(source, at);
      const nested = projection.blocks.find((b) =>
        ["mathBlock", "codeBlock"].includes(b.node.type),
      )!;
      expect(nested.node).toEqual(
        nodeAt(source, at, ["mathBlock", "codeBlock"]),
      );
      expect(literalBody(source, nested.node).text).toBe("x=1");
      expect(literalPrefix(source, nested.node)).toBe("    ");
      for (let offset = 0; offset <= 3; offset++)
        expect(
          projection.map.sourceAt(projection.map.positionAt(at + offset)),
        ).toBe(at + offset);
    },
  );
  test("an external empty literal handoff cannot reveal a footnote's literal", () => {
    const source = "$$\n\n$$\n\n" + before + "[^a]: $$\n    \n    $$";
    const projection = project(source, source.indexOf("    \n") + 4, {
      literalSource: 0,
    });
    expect(
      projection.activeProse.filter((range) => range.footnote !== undefined),
    ).toEqual([]);
  });
  test("equations inside definitions are indexed once in physical source order", () => {
    const source =
      "$$\nx\\label{first}\n$$\n\n" +
      before +
      "[^a]: $$\n    y\\label{note}\n    $$\n\n$$\nz\\label{last}\n$$";
    const index = documentIndex(parseMarkdown(source));
    expect([...index.labels]).toEqual([
      ["first", 1],
      ["note", 2],
      ["last", 3],
    ]);
    expect(index.equations).toHaveLength(3);
  });
});

describe("scoped footnote edits", () => {
  test.each(["[^a]: ", "[^a]: First\n\n    "])(
    "slash and language completion map the body query: %s",
    (prefix) => {
      const source = before + prefix;
      expect(slashQuery(source + "/math", source.length + 5)).toEqual({
        from: source.length,
        to: source.length + 5,
        prefix: "    ",
        query: "math",
      });
      expect(codeFenceQuery(source + "```py", source.length + 5)).toEqual({
        from: source.length + 3,
        to: source.length + 5,
        query: "py",
        header: source.lastIndexOf("\n") + 1,
      });
    },
  );
  test("list indentation cannot consume the footnote prefix", () => {
    const source = before + "[^a]: - First\n    - Second",
      selection = { anchor: source.length, head: source.length };
    expect(
      applyChanges(source, indentList(source, selection, true, 4)!.changes),
    ).toBe(source);
    const indent = indentList(source, selection, false, 4)!;
    const after = applyChanges(source, indent.changes);
    expect(after).toBe(source.replace("    - Second", "        - Second"));
    expect(
      applyChanges(
        after,
        indentList(
          after,
          { anchor: indent.selection.anchor, head: indent.selection.head! },
          true,
          4,
        )!.changes,
      ),
    ).toBe(source);
  });
  test.each(["\n", "\r\n"])(
    "commands, paste and composition preserve prefixes and caret (%j)",
    (ending) => {
      const source = (before + "[^a]: First.\n\n    Body\n\nAfter").replaceAll(
        "\n",
        ending,
      );
      const from = source.indexOf("Body"),
        selection = { anchor: from, head: from + 4 };
      const command = sourceCommand("bold", source, from, from + 4)!;
      expect(applyChanges(source, command.changes)).toBe(
        source.replace("Body", "**Body**"),
      );
      const value = "𝛼\n\nSecond";
      const edit = footnoteInput(source, selection, value)!;
      const expected = source.replace(
        "Body",
        value.replaceAll("\n", ending + "    "),
      );
      expect(applyChanges(source, edit.changes)).toBe(expected);
      expect(edit.selection.anchor).toBe(expected.indexOf("Second") + 6);
      const projection = project(source, from),
        state = EditorState.create({ doc: projection.doc });
      const transaction = state.tr.insertText(
        value,
        projection.map.positionAt(from),
        projection.map.positionAt(from + 4),
      );
      expect(
        applyChanges(
          source,
          bridgeTransaction(projection, transaction).changes,
        ),
      ).toBe(expected);
      expect(
        applyChanges(
          source,
          bridgeComposition(projection, transaction.doc)!.changes,
        ),
      ).toBe(expected);
    },
  );
  test("quote paste retains the inner prefix without repeating the definition marker", () => {
    const source = before + "[^a]: > Body";
    const edit = footnoteInput(
      source,
      { anchor: source.length, head: source.length },
      "\nNext",
    )!;
    expect(applyChanges(source, edit.changes)).toBe(source + "\n    > Next");
  });
  test("separate edits preserve untouched line indentation", () => {
    const source = before + "[^a]: One\n\n\tTwo\n\n    Three";
    const from = source.indexOf("One");
    const edit = footnoteCommand(
      source,
      { anchor: from, head: from },
      (body) => ({
        changes: [
          { from: 0, to: 3, insert: "1" },
          { from: body.indexOf("Three"), to: body.length, insert: "3" },
        ],
        selection: { anchor: 1, head: body.length - 6 },
      }),
    )!;
    expect(applyChanges(source, edit.changes)).toBe(
      source.replace("One", "1").replace("Three", "3"),
    );
    expect(edit.selection).toEqual({
      anchor: from + 1,
      head: source.length - 6,
    });
  });
  test("cross-container or out-of-bounds callbacks cannot damage another block", () => {
    const source = before + "[^a]: First\n\nOutside";
    expect(
      footnoteCommand(
        source,
        { anchor: source.indexOf("First"), head: source.length },
        () => null,
      ),
    ).toBeNull();
    expect(
      footnoteCommand(
        source,
        { anchor: source.indexOf("First"), head: source.indexOf("First") },
        () => ({
          changes: [{ from: -1, to: 1, insert: "" }],
          selection: { anchor: 0 },
        }),
      ),
    ).toBeNull();
    expect(
      footnoteDefinitionAt(source, source.indexOf("Outside")),
    ).toBeUndefined();
  });
  test.each(["    ", "\t"])(
    "first-line table controls never duplicate the footnote header (%j)",
    (prefix) => {
      const source =
        before +
        "[^a]: | A | B |\n" +
        prefix +
        "| --- | --- |\n" +
        prefix +
        "| C | D |\n\nAfter";
      const node = nodeAt(source, source.indexOf("A |"), ["table"])!,
        model = tableModel(source, node)!;
      expect(model.separator.prefix).toBe(prefix);
      expect(model.separator.cells.map((cell) => cell.raw)).toEqual([
        "---",
        "---",
      ]);
      for (const action of [
        "rowAfter",
        "duplicateRow",
        "columnRight",
        "alignCenter",
        "paste",
      ]) {
        const changes = tableAction(model, source, 0, 0, action, [
          ["a", "b"],
          ["c", "d"],
          ["e", "f"],
        ]);
        const next = applyChanges(source, changes);
        expect(next.match(/\[\^a\]:/g)).toHaveLength(1);
        expect(next.endsWith("\n\nAfter")).toBe(true);
        expect(parseMarkdown(next).footnotes.a[0].type).toBe("table");
        if (action === "paste")
          expect(parseMarkdown(next).footnotes.a[0].children).toHaveLength(3);
      }
    },
  );
});
