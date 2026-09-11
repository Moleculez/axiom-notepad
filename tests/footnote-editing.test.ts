import { describe, expect, test } from "vitest";
import { parseMarkdown, renderFootnoteContent } from "../packages/markdown/src";
import { applyChanges, enterEdit } from "../packages/editor/src/transactions";
import { preserveLineEndings } from "../packages/editor/src/line-endings";
import { editorDefaults } from "../packages/shared/src/editor";

const prefix = "Result[^a].\n\n[^a]: ";
function enter(source: string, at = source.length, soft = false, head = at) {
  const edit = preserveLineEndings(source, { anchor: at, head }, (text, pos) =>
    enterEdit(text, pos, editorDefaults, soft),
  );
  return {
    source: applyChanges(source, edit.changes),
    at: edit.selection.anchor,
  };
}

describe("footnote continuation", () => {
  test.each(["\n", "\r\n"])(
    "wrapped text belongs to its definition (%j)",
    (ending) => {
      const source = (
        prefix +
        "First line.\nSecond **line**.\nThird line.\n\nOutside.\n\n[^b]: Other."
      ).replaceAll("\n", ending);
      const parsed = parseMarkdown(source);
      const html = renderFootnoteContent(parsed, "a")!;
      expect(html).toContain("Second <strong>line</strong>.");
      expect(html).toContain("Third line.");
      expect(html).not.toContain("Outside");
      expect(html).not.toContain("Other");
      expect(parsed.footnotes.b).toHaveLength(1);
    },
  );
  test.each([
    "# Outside",
    "> Outside",
    "- Outside",
    "```\nOutside\n```",
    "$$\nOutside\n$$",
    "\\[\nOutside\n\\]",
    "[^b]: Outside",
  ])("does not capture the next unindented block: %s", (next) => {
    const parsed = parseMarkdown(prefix + "First line.\n" + next);
    expect(renderFootnoteContent(parsed, "a")).not.toContain("Outside");
  });
  test("a continuation after a non-paragraph footnote block stays outside", () => {
    const parsed = parseMarkdown(
      prefix + "First.\n\n    $$\n    E=mc^2\n    $$\nOutside.",
    );
    expect(renderFootnoteContent(parsed, "a")).not.toContain("Outside");
  });
  for (const ending of ["\n", "\r\n"]) {
    test(`Enter and Shift-Enter retain the footnote (${JSON.stringify(ending)})`, () => {
      const original = (prefix + "First.").replaceAll("\n", ending);
      for (const soft of [false, true]) {
        const result = enter(original, original.length, soft);
        expect(result.source).toBe(
          original + (soft ? "  " + ending : ending + "    " + ending) + "    ",
        );
        const typed =
          result.source.slice(0, result.at) +
          "Second." +
          result.source.slice(result.at);
        expect(renderFootnoteContent(parseMarkdown(typed), "a")).toContain(
          "Second.",
        );
      }
    });
    test(`empty continuation exits without absorbing following prose (${JSON.stringify(ending)})`, () => {
      const original = (prefix + "First.\n\n    ").replaceAll("\n", ending);
      const result = enter(original);
      const typed =
        result.source.slice(0, result.at) +
        "Outside." +
        result.source.slice(result.at);
      expect(renderFootnoteContent(parseMarkdown(typed), "a")).toContain(
        "First.",
      );
      expect(renderFootnoteContent(parseMarkdown(typed), "a")).not.toContain(
        "Outside.",
      );
      expect(parseMarkdown(typed).ast.children?.at(-1)?.text).toBe("Outside.");
    });
    for (const [open, close] of [
      ["$$", "$$"],
      ["\\[", "\\]"],
      ["```python", "```"],
    ]) {
      test(`fences and body newlines stay inside the footnote (${open}, ${JSON.stringify(ending)})`, () => {
        const original = (prefix + "First.\n\n    " + open).replaceAll(
          "\n",
          ending,
        );
        const result = enter(original);
        const typed =
          result.source.slice(0, result.at) +
          "x=1" +
          result.source.slice(result.at);
        expect(typed).toContain(
          "    " + open + ending + "    x=1" + ending + "    " + close,
        );
        const next = enter(typed, result.at + 3);
        const final =
          next.source.slice(0, next.at) + "y=2" + next.source.slice(next.at);
        const children = parseMarkdown(final).footnotes.a;
        expect(
          children?.some(
            (node) =>
              node.type ===
                (open.startsWith("```") ? "codeBlock" : "mathBlock") &&
              node.text?.includes("x=1\ny=2"),
          ),
        ).toBe(true);
      });
    }
  }
  test.each([
    ["- First", "- First\n    - "],
    ["- ", ""],
    ["> First", "> First\n    > "],
    ["> ", ""],
  ])(
    "nested structures continue or exit within the footnote: %s",
    (body, expected) => {
      const source = prefix + "Note.\n\n    " + body;
      expect(enter(source).source).toBe(prefix + "Note.\n\n    " + expected);
    },
  );
  test("splitting a selected first-line body leaves its marker and following text intact", () => {
    const original = prefix + "alpha beta gamma\n\nOutside.";
    const from = original.indexOf("beta"),
      to = from + 4;
    const result = enter(original, from, false, to);
    expect(result.source).toBe(prefix + "alpha \n    \n     gamma\n\nOutside.");
    expect(result.at).toBe(from + "\n    \n    ".length);
  });
  test("an external blank paragraph is not an empty footnote continuation", () => {
    const original = prefix + "First.\n\n";
    expect(enter(original).source).toBe(original + "\n\n");
  });
  test("Enter in an unclosed code body's empty line does not exit the footnote", () => {
    const original = prefix + "First.\n\n    ```python\n    ";
    expect(enter(original).source).toBe(original + "\n    ");
  });
  test("tab-indented continuations keep their original indentation", () => {
    const original = prefix + "First.\n\n\tSecond.";
    expect(enter(original).source).toBe(original + "\n\t\n\t");
  });
  test("splitting a Unicode body uses exact UTF-16 source offsets", () => {
    const original = prefix + "𝛼 é 👩🏽‍🔬 end";
    const at = original.indexOf(" end");
    const result = enter(original, at, true);
    expect(result.source).toBe(
      original.slice(0, at) + "  \n    " + original.slice(at),
    );
    expect(result.at).toBe(at + 7);
  });
});
