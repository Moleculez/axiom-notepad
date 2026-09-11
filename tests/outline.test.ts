import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../packages/markdown/src";
import {
  outlineAncestors,
  outlineBranches,
  outlineTree,
  sectionAtPosition,
} from "../apps/web/lib/outline";

describe("document outline", () => {
  it("uses real ancestry with flush roots and no phantom skipped levels", () => {
    const headings = parseMarkdown(
      "## Opening\n\n#### Detail\n\n##### Evidence\n\n### Second child\n\n# New root\n\n### Conclusion\n",
    ).outline;
    const tree = outlineTree(headings);
    expect(tree.map((n) => [n.text, n.depth, n.parentId])).toEqual([
      ["Opening", 0, null],
      ["New root", 0, null],
    ]);
    expect(tree[0].children.map((n) => [n.text, n.depth])).toEqual([
      ["Detail", 1],
      ["Second child", 1],
    ]);
    expect(tree[0].children[0].children[0].depth).toBe(2);
    expect(tree[1].children[0].depth).toBe(1);
    expect(outlineAncestors(tree, headings[2].id)).toEqual([
      headings[0].id,
      headings[1].id,
    ]);
    expect(outlineAncestors(tree, "missing")).toEqual([]);
    expect(outlineBranches(tree)).toEqual([
      headings[0].id,
      headings[1].id,
      headings[4].id,
    ]);
  });
  it("indents H2 beneath H1 and preserves source offsets and duplicate IDs", () => {
    const source =
      "# Theory\n\nText 🧪.\n\n## Theory\n\n### Theory\n\n## Theory\n";
    const headings = parseMarkdown(source).outline,
      tree = outlineTree(headings);
    expect(new Set(headings.map((h) => h.id)).size).toBe(4);
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[0].children[0].depth).toBe(2);
    expect(tree[0].children[1].from).toBe(source.lastIndexOf("## Theory"));
    expect(outlineAncestors(tree, headings[3].id)).toEqual([headings[0].id]);
    for (const h of headings)
      expect(sectionAtPosition(headings, h.from)).toBe(h.id);
    expect(sectionAtPosition(headings, headings[1].from - 1)).toBe(
      headings[0].id,
    );
    expect(sectionAtPosition(headings, source.length)).toBe(headings[3].id);
  });
  it("handles empty notes, setext headings and fenced non-headings", () => {
    expect(outlineTree([])).toEqual([]);
    expect(sectionAtPosition([], 0)).toBeNull();
    const headings = parseMarkdown(
      "Title\n=====\n\nSubheading\n----------\n\n```md\n# Not a heading\n```\n",
    ).outline;
    expect(outlineTree(headings)[0].children[0].text).toBe("Subheading");
    expect(headings).toHaveLength(2);
    expect(sectionAtPosition(headings, -10)).toBe(headings[0].id);
  });
});
