import { afterEach, expect, test } from "vitest";
import * as Y from "yjs";
import { nodeAt, sourceLine, type SourceEdit } from "../packages/markdown/src";
import { NativeBinding } from "../packages/editor/src/binding";
import { GeneratedFences } from "../packages/editor/src/generated-fences";
import {
  enterEdit,
  type NativeTransaction,
} from "../packages/editor/src/transactions";
import { preserveLineEndings } from "../packages/editor/src/line-endings";
import { editorDefaults } from "../packages/shared/src/editor";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((close) => close()));
function fixture(source: string) {
  const doc = new Y.Doc(),
    text = doc.getText("markdown");
  text.insert(0, source);
  const undo = new Y.UndoManager(text),
    binding = new NativeBinding(doc, undo, null);
  const fences = new GeneratedFences(binding);
  const unsubscribe = binding.subscribe(
    (_source, _selection, local, changes) => {
      if (!local) fences.beforeChange(changes, true);
      fences.rebase();
    },
  );
  cleanup.push(() => {
    unsubscribe();
    binding.destroy();
    undo.destroy();
    doc.destroy();
  });
  const apply = (
    edit: SourceEdit,
    kind: NativeTransaction["kind"] = "command",
    intent?: "code-language",
  ) => {
    fences.beforeChange(edit.changes, false, intent);
    binding.transact({
      ...edit,
      selection: {
        anchor: edit.selection.anchor,
        head: edit.selection.head ?? edit.selection.anchor,
      },
      kind,
    });
  };
  const complete = (at: number, language = "") => {
    const before = binding.source;
    binding.select({ anchor: at, head: at });
    const edit = preserveLineEndings(
      before,
      binding.selection(),
      (source, selection) =>
        enterEdit(
          source,
          selection,
          { ...editorDefaults, defaultCodeLanguage: language },
          false,
          true,
        ),
    );
    apply(edit);
    fences.remember(before, edit);
  };
  const node = () =>
    nodeAt(binding.source, binding.selection().anchor, [
      "codeBlock",
      "mathBlock",
    ])!;
  const language = (value: string) => {
    const code = node(),
      header = sourceLine(binding.source, code.from),
      marker = /^([ \t]*(?:`{3,}|~{3,})[ \t]*)/.exec(
        binding.source.slice(code.from, header.to),
      )![0];
    const from = code.from + marker.length;
    apply(
      {
        changes: [{ from, to: header.to, insert: value }],
        selection: {
          anchor:
            binding.selection().anchor + value.length - (header.to - from),
        },
      },
      "command",
      "code-language",
    );
  };
  return { doc, text, binding, fences, apply, complete, node, language };
}

for (const ending of ["\n", "\r\n"]) {
  test.each(["```", "```python", "~~~~julia", "> > ```py", "- ```"])(
    `language-only controls retain the exact original opener after rebasing (%s, ${JSON.stringify(ending)})`,
    (opener) => {
      const before = "Before" + ending.repeat(2),
        after = ending.repeat(2) + "After",
        peer = "Peer" + ending.repeat(2),
        source = before + opener + after;
      const f = fixture(source);
      f.complete(before.length + opener.length, "python");
      f.text.insert(0, peer);
      // Repeated changes, shorter labels, custom labels and clearing the field.
      for (const value of ["julia", "r", "custom-lang", ""]) f.language(value);
      const populated = f.binding.source;
      expect(f.node()).toBeDefined();
      const collapse = f.fences.collapse(f.node());
      expect(collapse).not.toBeNull();
      f.apply(collapse!);
      expect(f.binding.source).toBe(peer + source);
      expect(f.binding.selection()).toEqual({
        anchor: peer.length + before.length + opener.length,
        head: peer.length + before.length + opener.length,
      });
      f.binding.history(false);
      expect(f.binding.source).toBe(populated);
      f.binding.history(true);
      expect(f.binding.source).toBe(peer + source);
      expect(f.binding.selection()).toEqual({
        anchor: peer.length + before.length + opener.length,
        head: peer.length + before.length + opener.length,
      });
    },
  );
}

test.each(["\\[", "> \\[", "- \\[", "> > \\["])(
  "generated TeX bracket fences collapse to the authored opener after a peer prefix: %s",
  (opener) => {
    const f = fixture(opener);
    f.complete(opener.length);
    expect(f.node().type).toBe("mathBlock");
    expect(f.binding.source).toContain("\\]");
    f.text.insert(0, "Peer\n\n");
    const paired = f.binding.source;
    f.apply(f.fences.collapse(f.node())!);
    expect(f.binding.source).toBe("Peer\n\n" + opener);
    f.binding.history(false);
    expect(f.binding.source).toBe(paired);
    f.binding.history(true);
    expect(f.binding.source).toBe("Peer\n\n" + opener);
  },
);

test.each(["opening", "closing", "body and language", "invalid language"])(
  "code-language intent cannot authorize delimiter or unrelated edits: %s",
  (part) => {
    const f = fixture("```py");
    f.complete(5);
    const body = f.binding.selection().anchor,
      closing = f.binding.source.lastIndexOf("```");
    const changes =
      part === "opening"
        ? [{ from: 2, to: 5, insert: "`julia" }]
        : part === "closing"
          ? [{ from: closing, to: closing + 1, insert: "`" }]
          : part === "invalid language"
            ? [{ from: 3, to: 5, insert: "julia extra" }]
            : [
                { from: 3, to: 5, insert: "jl" },
                { from: body, to: body, insert: "x" },
              ];
    f.apply(
      { changes, selection: { anchor: body } },
      "command",
      "code-language",
    );
    const node = nodeAt(f.binding.source, 2, ["codeBlock"])!;
    expect(node).toBeDefined();
    expect(f.fences.collapse(node)).toBeNull();
  },
);

test("a local language choice cannot reclaim a peer-edited header", () => {
  const f = fixture("```");
  f.complete(3, "python");
  f.doc.transact(() => {
    f.text.delete(3, 6);
    f.text.insert(3, "rust");
  });
  f.language("julia");
  expect(f.fences.collapse(f.node())).toBeNull();
});

for (const ending of ["\n", "\r\n"]) {
  test.each([
    "$$",
    "```",
    "```python",
    "~~~~julia",
    "> $$",
    "> > ```py",
    "- $$",
    "- ```py",
  ])(
    `collapses only generated scaffolding and retains authored opener (%s, ${JSON.stringify(ending)})`,
    (opener) => {
      const before =
        "Before" + ending.repeat(2) + opener + ending.repeat(2) + "After";
      const f = fixture(before);
      f.complete(before.indexOf(opener) + opener.length, "julia");
      expect(f.node()).toBeDefined();
      const edit = f.fences.collapse(f.node());
      expect(edit).not.toBeNull();
      f.apply(edit!);
      expect(f.binding.source).toBe(before);
      expect(f.binding.selection().anchor).toBe(
        before.indexOf(opener) + opener.length,
      );
    },
  );
}

test.each(["$$", "```"])(
  "EOF cycles do not accumulate blank lines: %s",
  (opener) => {
    const f = fixture(opener);
    for (let i = 0; i < 4; i++) {
      f.complete(opener.length);
      f.apply(f.fences.collapse(f.node())!);
      expect(f.binding.source).toBe(opener);
    }
  },
);

test("local multiline typing and edits above preserve ownership and one-step undo", () => {
  const f = fixture("```py\n\nAfter");
  f.complete(5);
  const at = f.binding.selection().anchor;
  f.apply(
    {
      changes: [{ from: at, to: at, insert: "first\nlast" }],
      selection: { anchor: at + 10 },
    },
    "typing",
  );
  f.text.insert(0, "Peer\n\n");
  const before = f.binding.source,
    node = f.node();
  f.apply(f.fences.collapse(node)!);
  expect(f.binding.source).toBe("Peer\n\n```py\n\nAfter");
  f.binding.history(false);
  expect(f.binding.source).toBe(before);
  expect(f.fences.collapse(f.node())).toBeNull(); // Restored fences are not newly generated.
  f.binding.history(true);
  expect(f.binding.source).toBe("Peer\n\n```py\n\nAfter");
});

test.each(["body", "opening", "closing", "same closer", "same tail"])(
  "peer %s edits never authorize deleting their delimiters or spacing",
  (part) => {
    const f = fixture("$$");
    f.complete(2);
    const source = f.binding.source,
      body = f.binding.selection().anchor;
    if (part === "body") f.text.insert(body, "peer");
    else {
      const at =
        part === "opening"
          ? 0
          : part === "same tail"
            ? source.length - 1
            : source.lastIndexOf("$$");
      f.doc.transact(() => {
        f.text.delete(at, 1);
        f.text.insert(at, source[at]);
      });
    }
    const collapse = f.fences.collapse(f.node());
    if (part === "same tail") {
      expect(collapse).not.toBeNull();
      f.apply(collapse!);
      expect(f.binding.source).toBe("$$\n\n"); // Their separator is not ours to remove.
    } else expect(collapse).toBeNull();
  },
);

test.each(["header", "closer"])(
  "local %s edits revoke generated-fence ownership",
  (part) => {
    const f = fixture("```py");
    f.complete(5);
    const at = part === "header" ? 4 : f.binding.source.lastIndexOf("```") + 1;
    f.apply({
      changes: [{ from: at, to: at + 1, insert: f.binding.source[at] }],
      selection: { anchor: 6 },
    });
    expect(f.fences.collapse(f.node())).toBeNull();
  },
);

test("following authored paragraph keeps the generated separators it now needs", () => {
  const f = fixture("$$");
  f.complete(2);
  const at = f.binding.source.length;
  f.apply(
    {
      changes: [{ from: at, to: at, insert: "After" }],
      selection: { anchor: 3 },
    },
    "typing",
  );
  f.apply(f.fences.collapse(f.node())!);
  expect(f.binding.source).toBe("$$\n\nAfter");
});

test("local separator edits are preserved without revoking untouched fences", () => {
  const f = fixture("$$");
  f.complete(2);
  const at = f.binding.source.length - 1;
  f.apply(
    { changes: [{ from: at, to: at, insert: "\n" }], selection: { anchor: 3 } },
    "typing",
  );
  f.apply(f.fences.collapse(f.node())!);
  expect(f.binding.source).toBe("$$\n\n\n");
});

test("an imported or pasted closed block is never assumed to be generated", () => {
  const f = fixture("```py\n\n```");
  f.binding.select({ anchor: 6, head: 6 });
  expect(f.fences.collapse(f.node())).toBeNull();
  const before = f.binding.source;
  const edit: SourceEdit = {
    changes: [
      { from: before.length, to: before.length, insert: "\n\n$$\n\n$$" },
    ],
    selection: { anchor: before.length + 5 },
  };
  f.apply(edit);
  // Even an accidental remember call cannot claim a non-opener Enter edit.
  f.fences.remember(before, edit);
  expect(f.fences.collapse(f.node())).toBeNull();
  expect(sourceLine(f.binding.source, 0).text).toBe("```py");
});
