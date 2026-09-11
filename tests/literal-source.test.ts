import { expect, test } from "vitest";
import { nodeAt } from "../packages/markdown/src/index";
import {
  emptiesLiteralBody,
  literalBody,
} from "../packages/editor/src/literal";
import { projectMarkdown } from "../packages/editor/src/projection";

test("overlapping or partial deletions never count as an empty body", () => {
  const source = "```\nabc\n```",
    node = nodeAt(source, 5, ["codeBlock"])!;
  expect(
    emptiesLiteralBody(source, node, [{ from: 4, to: 6, insert: "" }]),
  ).toBe(false);
  expect(
    emptiesLiteralBody(source, node, [
      { from: 4, to: 6, insert: "" },
      { from: 5, to: 6, insert: "" },
    ]),
  ).toBe(false);
  expect(
    emptiesLiteralBody(source, node, [
      { from: 6, to: 7, insert: "" },
      { from: 4, to: 6, insert: "" },
    ]),
  ).toBe(true);
});

test.each([
  "```python\nx\n```",
  "~~~julia\nx\n~~~\n",
  "$$\nx\n$$",
  "$$x$$",
  "> $$\r\n> x\r\n> $$\r\n",
  "> ```py\r\n> first\r\n> last\r\n> ```",
  "- item\n\n  ```py\n  x\n  ```",
])(
  "only deleting the entire visible body requests a source handoff: %s",
  (source) => {
    const at =
      source.indexOf("first") >= 0
        ? source.indexOf("first")
        : source.indexOf("x");
    const node = nodeAt(source, at, ["codeBlock", "mathBlock"])!;
    const body = literalBody(source, node),
      from = body.offsets[0],
      to = body.offsets.at(-1)!;
    expect(emptiesLiteralBody(source, node, [{ from, to, insert: "" }])).toBe(
      true,
    );
    expect(emptiesLiteralBody(source, node, [{ from, to, insert: " " }])).toBe(
      false,
    );
    expect(
      emptiesLiteralBody(source, node, [{ from, to: from, insert: "" }]),
    ).toBe(false);
    expect(
      emptiesLiteralBody(source, node, [{ from: node.from, to, insert: "" }]),
    ).toBe(false);
  },
);

test.each([
  "```python\n\n```\n",
  "~~~\n\n~~~",
  "$$\n\n$$",
  "$$$$",
  "> $$\r\n> \r\n> $$\r\n",
  "- item\n\n  ```py\n  \n  ```",
])(
  "empty blocks reveal all real fences only after an explicit handoff: %s",
  (source) => {
    const parsed = projectMarkdown(source).parsed;
    const find = (
      nodes: NonNullable<typeof parsed.ast.children>,
    ): (typeof nodes)[number] | undefined => {
      for (const node of nodes) {
        if (["codeBlock", "mathBlock"].includes(node.type)) return node;
        const nested = node.children && find(node.children);
        if (nested) return nested;
      }
    };
    const node = find(parsed.ast.children!)!,
      body = literalBody(source, node);
    expect(body.text).toBe("");
    const options = {
      proseSource: true,
      reveal: true,
      selection: { anchor: body.offsets[0], head: body.offsets[0] },
    };
    expect(
      projectMarkdown(source, options).activeProse.some(
        (p) => p.kind === node.type,
      ),
    ).toBe(false);
    const projection = projectMarkdown(source, {
      ...options,
      literalSource: node.from,
    });
    expect(projection.activeProse.some((p) => p.kind === node.type)).toBe(true);
    expect(projection.doc.check()).toBeUndefined();
    expect(
      projection.map.sourceAt(projection.map.positionAt(body.offsets[0])),
    ).toBe(body.offsets[0]);
    expect(
      projectMarkdown(source, {
        ...options,
        reveal: false,
        literalSource: node.from,
      }).activeProse,
    ).toEqual([]);
    expect(emptiesLiteralBody(source, node, [])).toBe(false);
  },
);
