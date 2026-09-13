import { describe, expect, it } from "vitest";
import {
  parseMarkdown,
  type MarkdownNode,
} from "../packages/markdown/src/index";
import {
  BlockFolds,
  canFold,
  foldDescription,
} from "../packages/editor/src/folding";
import { projectMarkdown } from "../packages/editor/src/projection";
import { applyChanges } from "../packages/editor/src/transactions";

function nodes(source: string) {
  const parsed = parseMarkdown(source),
    all: MarkdownNode[] = [];
  const visit = (node: MarkdownNode) => {
    all.push(node);
    node.children?.forEach(visit);
  };
  visit(parsed.ast);
  parsed.definitions?.forEach(visit);
  return all;
}
describe("local Markdown folding", () => {
  it.each([
    "```python\nx = 1\ny = 2\n```",
    "$$\nx^2\n$$",
    "- Parent\n  - Child\n  - Sibling",
    "> A quotation\n>\n> Another paragraph",
    "| A | B |\n| --- | --- |\n| C | D |",
    "---\ntitle: Research\nauthor: Ada\n---",
    "[^n]: A note\n\n    Another paragraph",
  ])(
    "projects a bounded atomic preview while retaining exact source: %s",
    (body) => {
      const source = body + "\n\nAfter",
        node = nodes(source).find((n) => canFold(source, n))!;
      expect(node).toBeDefined();
      const folds = new BlockFolds();
      folds.toggle(node);
      const projection = projectMarkdown(source, {
        proseSource: true,
        folded: folds.ranges,
      });
      projection.doc.check();
      const collapsed = projection.blocks.find((b) => b.folded)!;
      expect(collapsed.node).toMatchObject({ from: node.from, to: node.to });
      expect(projection.map.sourceAt(collapsed.from)).toBe(node.from);
      expect(projection.map.sourceAt(collapsed.to, -1)).toBe(node.to);
      expect(projection.source).toBe(source);
      folds.toggle(node);
      expect(
        projectMarkdown(source, {
          proseSource: true,
          folded: folds.ranges,
        }).doc.toJSON(),
      ).toEqual(projectMarkdown(source, { proseSource: true }).doc.toJSON());
    },
  );
  it("rebases peer changes without folding a replacement identity", () => {
    let source = "Intro\n\n```py\nx = 1\n```\n\nEnd";
    const folds = new BlockFolds();
    folds.toggle(nodes(source).find((n) => n.type === "codeBlock")!);
    for (const changes of [
      [{ from: 0, to: 0, insert: "Before\n\n" }],
      [{ from: 23, to: 24, insert: "22" }],
    ]) {
      folds.changed(changes);
      source = applyChanges(source, changes);
      folds.reconcile(source, parseMarkdown(source));
      expect(folds.ranges).toHaveLength(1);
    }
    const node = nodes(source).find((n) => n.type === "codeBlock")!;
    folds.changed([
      { from: node.from, to: node.from + 1, insert: source[node.from] },
    ]);
    folds.reconcile(source, parseMarkdown(source));
    expect(folds.ranges).toHaveLength(0);
  });
  it("reveals enclosing scopes for navigation without clearing unrelated folds", () => {
    const source = "- Parent\n  - Child\n  - Sibling\n\n> A\n> B";
    const folds = new BlockFolds();
    nodes(source)
      .filter((n) => canFold(source, n))
      .forEach((n) => folds.toggle(n));
    folds.reveal({
      anchor: source.indexOf("Child"),
      head: source.indexOf("Child"),
    });
    expect(folds.ranges.map((r) => r.type)).toEqual(["blockquote"]);
  });
  it("maps nested footnote folds through their continuation prefixes", () => {
    const source =
      "[^n]: Evidence\n\n    ```py\n    x = 1\n    y = 2\n    ```\n\nAfter";
    const node = nodes(source).find((n) => n.type === "codeBlock")!;
    const projection = projectMarkdown(source, {
      proseSource: true,
      folded: [node],
    });
    const collapsed = projection.blocks.find((b) => b.folded)!;
    expect(collapsed.node.from).toBe(node.from);
    expect(projection.map.sourceAt(collapsed.from)).toBe(node.from);
    expect(projection.map.sourceAt(collapsed.to, -1)).toBe(node.to);
  });
  it("uses the first item body for a compact list summary", () => {
    const source = "- Parent\n  - Child\n  - Sibling";
    expect(
      foldDescription(
        source,
        nodes(source).find((n) => n.type === "list")!,
      ).summary,
    ).toBe("Parent");
  });
});
