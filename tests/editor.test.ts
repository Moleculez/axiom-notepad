import { describe, expect, it } from "vitest";
import {
  parseMarkdown,
  sourceCommand,
  tableModel,
  tableAction,
  minimalChange,
  slashQuery,
  type TextChange,
} from "../packages/markdown/src/index";
import {
  editorCommands,
  editorDefaults,
  keysFor,
  validateEditorPreferences,
  bindingProblem,
  bindingConflicts,
  eventBinding,
  mergeEditorPreferences,
} from "../packages/shared/src/editor";
const apply = (source: string, changes: TextChange[]) => {
  let result = "",
    from = 0;
  for (const c of [...changes].sort((a, b) => a.from - b.from)) {
    expect(c.from).toBeGreaterThanOrEqual(from);
    result += source.slice(from, c.from) + c.insert;
    from = c.to;
  }
  return result + source.slice(from);
};
const table =
  "Before\n\n| A | B |\n| :--- | ---: |\n| x\\|y |  |\n| z | 2 |\n\nAfter\n";
function model(source = table) {
  return tableModel(
    source,
    parseMarkdown(source).ast.children!.find((n) => n.type === "table")!,
  )!;
}
describe("editor command foundation", () => {
  it("has unique command IDs and conflict-free defaults", () => {
    expect(new Set(editorCommands.map((c) => c.id)).size).toBe(
      editorCommands.length,
    );
    for (const platform of ["mac", "windowsLinux"] as const)
      for (const c of editorCommands)
        for (const key of keysFor(c.id, editorDefaults, platform))
          expect(
            bindingConflicts(editorDefaults, platform, c.id, key),
            c.id,
          ).toEqual([]);
  });
  it("preserves note search and gives source its requested shortcut and alias", () => {
    expect(keysFor("source", editorDefaults, "mac")).toEqual([
      "Mod-/",
      "Mod-Shift-m",
    ]);
    expect(keysFor("searchNotes", editorDefaults, "windowsLinux")).toEqual([
      "Mod-k",
    ]);
  });
  it("records platform modifiers and shifted punctuation", () => {
    const event = {
      key: ">",
      code: "Period",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    };
    expect(eventBinding(event, "mac")).toBe("Mod-Shift-.");
    expect(
      eventBinding(
        {
          ...event,
          key: "/",
          code: "Slash",
          metaKey: false,
          ctrlKey: true,
          shiftKey: false,
        },
        "windowsLinux",
      ),
    ).toBe("Mod-/");
  });
  it("rejects unknown commands, typing keys, reserved keys and collisions", () => {
    expect(bindingProblem("a")).toBeTruthy();
    expect(bindingProblem("Mod-t")).toBeTruthy();
    expect(() =>
      validateEditorPreferences({
        ...editorDefaults,
        keybindings: { mac: { constructor: ["Mod-b"] }, windowsLinux: {} },
      }),
    ).toThrow();
    expect(() =>
      validateEditorPreferences({
        ...editorDefaults,
        keybindings: { mac: { bold: ["Mod-k"] }, windowsLinux: {} },
      }),
    ).toThrow();
    expect(
      validateEditorPreferences({
        ...editorDefaults,
        keybindings: {
          mac: { bold: ["Mod-k"], searchNotes: [] },
          windowsLinux: {},
        },
      }).keybindings.mac.searchNotes,
    ).toEqual([]);
  });
  it("merges per-command offline changes and detects cross-command collisions", () => {
    const a = structuredClone(editorDefaults),
      b = structuredClone(editorDefaults);
    a.keybindings.mac.bold = ["Mod-Alt-z"];
    b.keybindings.mac.italic = ["Mod-Alt-y"];
    expect(mergeEditorPreferences(editorDefaults, a, b).conflicts).toEqual([]);
    b.keybindings.mac.italic = ["Mod-Alt-z"];
    expect(mergeEditorPreferences(editorDefaults, a, b).conflicts).toContain(
      "keybindings.mac.bold",
    );
  });
  it.each([
    "bold",
    "italic",
    "strike",
    "highlight",
    "inlineCode",
    "inlineMath",
  ])("%s uses an empty typing position instead of placeholder prose", (id) => {
    const edit = sourceCommand(id, "", 0, 0)!;
    expect(apply("", edit.changes)).not.toContain("text");
    expect(edit.selection.anchor).toBeGreaterThan(0);
    expect(edit.selection.head).toBe(edit.selection.anchor);
  });
  it("toggles formatting around a selection", () => {
    const edit = sourceCommand("bold", "A **result**.", 4, 10)!;
    expect(apply("A **result**.", edit.changes)).toBe("A result.");
  });
  it("converts heading levels without stacking markers", () => {
    expect(
      apply("### Old", sourceCommand("heading1", "### Old", 4, 7)!.changes),
    ).toBe("# Old");
    expect(
      apply("> ## Old", sourceCommand("paragraph", "> ## Old", 5, 8)!.changes),
    ).toBe("> Old");
  });
  it("inserts code with fences long enough to preserve backticks", () => {
    const source = "```",
      edit = sourceCommand("codeBlock", source, 0, 3)!;
    const next = apply(source, edit.changes);
    expect(next).toContain("````python\n```\n````");
    expect(parseMarkdown(next).ast.children?.[0].type).toBe("codeBlock");
  });
  it("inserts distinct footnote keys without rewriting existing definitions", () => {
    const source = "Text[^note1]\n\n[^note1]: Preserve";
    expect(
      apply(source, sourceCommand("footnote", source, 4, 4)!.changes),
    ).toBe("Text[^note2][^note1]\n\n[^note1]: Preserve\n\n[^note2]: ");
  });
  it("identifies only empty paragraph slash queries", () => {
    for (const source of ["/", "/math", "> /theorem", "- [ ] /table"])
      expect(slashQuery(source, source.length)).not.toBeNull();
    for (const source of [
      "a / b",
      "https://example.com/",
      "```python\n/table",
      "$$\nx/y\n$$",
      "    /code",
      "$x/y$",
      "| / | B |\n|---|---|",
    ])
      expect(slashQuery(source, source.length)).toBeNull();
  });
  it("creates minimal UTF-16-safe changes", () => {
    for (const [a, b] of [
      ["ab", "acb"],
      ["😄 done", "😎 done"],
      ["α\\|β", "α\\|γ"],
    ])
      expect(apply(a, [minimalChange(a, b)])).toBe(b);
  });
});
describe("source-mapped table editing", () => {
  it("maps empty cells and escaped pipes to exact source positions", () => {
    const m = model();
    expect(m.columns).toBe(2);
    expect(m.rows[1].cells[0].raw).toBe("x\\|y");
    const empty = m.rows[1].cells[1];
    expect(empty.from).toBe(empty.to);
    expect(
      apply(table, [{ from: empty.from, to: empty.to, insert: "42" }]),
    ).toBe(table.replace("| x\\|y |  |", "| x\\|y | 42 |"));
  });
  it("adds a row without rewriting any other line", () => {
    const m = model(),
      next = apply(table, tableAction(m, table, 1, 0, "rowAfter"));
    expect(next).toBe(table.replace("| z | 2 |", "|  |  |\n| z | 2 |"));
  });
  it("changes only the chosen alignment marker", () => {
    expect(apply(table, tableAction(model(), table, 1, 1, "alignCenter"))).toBe(
      table.replace("---:", ":---:"),
    );
  });
  it.each([
    "columnBefore",
    "columnAfter",
    "deleteColumn",
    "columnLeft",
    "columnRight",
    "rowUp",
    "rowDown",
  ])("%s retains valid Markdown and surrounding prose", (action) => {
    const next = apply(
      table,
      tableAction(model(), table, action === "rowUp" ? 2 : 1, 1, action),
    );
    expect(next.startsWith("Before\n\n")).toBe(true);
    expect(next.endsWith("\nAfter\n")).toBe(true);
    expect(
      parseMarkdown(next).ast.children?.some((n) => n.type === "table"),
    ).toBe(true);
  });
  it("pastes a larger grid and escapes literal pipes", () => {
    const next = apply(
      table,
      tableAction(model(), table, 1, 0, "paste", [
        ["a|b", "c", "d"],
        ["e", "f", "g"],
        ["h", "i", "j"],
      ]),
    );
    const m = model(next);
    expect(m.columns).toBe(3);
    expect(m.rows).toHaveLength(4);
    expect(next).toContain("a\\|b");
    expect(next).toContain("After");
  });
  it("never deletes the header or final column", () => {
    expect(tableAction(model(), table, 0, 0, "deleteRow")).toEqual([]);
    const source = "| A |\n| --- |\n| x |\n";
    expect(tableAction(model(source), source, 1, 0, "deleteColumn")).toEqual(
      [],
    );
  });
});
