import { describe, expect, test } from "vitest";
import {
  boundaryDelete,
  literalDelete,
  rangeDelete,
} from "../apps/web/lib/native-editor/deletion";
import { applyChanges } from "../apps/web/lib/native-editor/transactions";
import { parseMarkdown } from "../packages/markdown/src/index";

describe("structure-aware Write deletion", () => {
  test.each([
    ["# Heading\n\nafter", "Heading", "Heading\n\nafter"],
    ["### Heading ###\n", "Heading", "Heading\n"],
    ["> quote\n> second\n", "quote", "quote\nsecond\n"],
    ["> > quote\n> > second\n", "quote", "> quote\n> second\n"],
    ["- [ ] alpha\n  more\n", "alpha", "alpha\nmore\n"],
    ["- parent\n  - child\n", "child", "- parent\n- child\n"],
    ["```text\nalpha\n```\n\nafter", "alpha", "alpha\n\nafter"],
    ["> ```text\n> alpha\n> beta\n> ```\n", "alpha", "> alpha\n> beta\n"],
    ["- ```text\n  alpha\n  beta\n  ```\n", "alpha", "- alpha\n  beta\n"],
    ["$$\nx^2\n$$\n\nafter", "x^2", "x^2\n\nafter"],
  ])("unwraps once and preserves text: %s", (source, target, expected) => {
    const at = source.indexOf(target);
    const edit = boundaryDelete(source, { anchor: at, head: at }, true);
    expect(edit).not.toBeNull();
    expect(applyChanges(source, edit!.changes)).toBe(expected);
    expect(expected.slice(edit!.selection.anchor)).toMatch(
      new RegExp("^" + target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });
  test("an unwrapped paragraph joins the previous paragraph on the next Backspace", () => {
    const source = "before\n\n# Heading";
    const at = source.indexOf("Heading");
    const first = boundaryDelete(source, { anchor: at, head: at }, true)!;
    const plain = applyChanges(source, first.changes);
    const second = boundaryDelete(
      plain,
      { anchor: first.selection.anchor, head: first.selection.anchor },
      true,
    )!;
    expect(applyChanges(plain, second.changes)).toBe("beforeHeading");
  });
  test("table boundaries navigate without changing any cell", () => {
    const source = "| A | B |\n| --- | --- |\n| alpha | beta |";
    const at = source.indexOf("beta");
    const edit = boundaryDelete(source, { anchor: at, head: at }, true)!;
    expect(edit.changes).toEqual([]);
    expect(edit.selection.anchor).toBe(source.indexOf("alpha") + 5);
  });
  test.each(["> ", "  "])(
    "nested code joins lines without leaking its container prefix: %s",
    (prefix) => {
      const source = `${prefix.trim() ? prefix : "- "}\`\`\`js\n${prefix}alpha\n${prefix}beta\n${prefix}\`\`\``;
      const at = source.indexOf("beta"),
        edit = literalDelete(source, at, "deleteContentBackward")!;
      expect(applyChanges(source, edit.changes)).toContain(
        prefix + "alphabeta",
      );
      expect(
        applyChanges(
          source,
          literalDelete(
            source,
            source.indexOf("alpha") + 5,
            "deleteContentForward",
          )!.changes,
        ),
      ).toContain(prefix + "alphabeta");
    },
  );
  test("cross-block selection retains partially selected code fences", () => {
    const source = "before\n\n```js\nalpha\nbeta\n```\n\nafter";
    const edit = rangeDelete(source, {
      anchor: 0,
      head: source.indexOf("beta"),
    });
    const after = applyChanges(source, edit.changes);
    expect(after).toBe("```js\nbeta\n```\n\nafter");
    expect(parseMarkdown(after).ast.children?.[0].type).toBe("codeBlock");
    expect(edit.selection.anchor).toBe(after.indexOf("beta"));
  });
  test("a completely selected table is removed; a cell range retains the grid", () => {
    const source = "| A | B |\n| --- | --- |\n| alpha | beta |";
    expect(
      applyChanges(
        source,
        rangeDelete(source, { anchor: 0, head: source.length }).changes,
      ),
    ).toBe("");
    const edit = rangeDelete(source, {
      anchor: source.indexOf("alpha"),
      head: source.indexOf("beta") + 4,
    });
    expect(
      parseMarkdown(applyChanges(source, edit.changes)).ast.children?.[0].type,
    ).toBe("table");
  });
  test("table navigation lands in neighbouring content, not its hidden fences or heading marker", () => {
    const source =
      "```js\nx\n```\n\n| A | B |\n| --- | --- |\n| a | b |\n\n# After";
    const first = source.indexOf("A"),
      last = source.indexOf("b |") + 1;
    expect(
      boundaryDelete(source, { anchor: first, head: first }, true)?.selection
        .anchor,
    ).toBe(source.indexOf("x") + 1);
    expect(
      boundaryDelete(source, { anchor: last, head: last }, false)?.selection
        .anchor,
    ).toBe(source.indexOf("After"));
  });
});
