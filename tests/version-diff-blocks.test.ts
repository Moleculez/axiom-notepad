import { test, expect } from "vitest";
import { parseMarkdown } from "../packages/markdown/src/parser";
import { versionDiffBlocks } from "../packages/shared/src/version-diff-blocks";
test("unified rendering interleaves changed blocks with each unchanged region once", () => {
  const before = "# Stable\n\nAlpha.\n\n> Same quote\n\nEnd.\n",
    after = "# Stable\n\nBeta.\n\n> Same quote\n\nEnd.\n";
  const groups = versionDiffBlocks(
    before,
    parseMarkdown(before),
    after,
    parseMarkdown(after),
  );
  expect(groups.map((g) => g.kind)).toEqual([
    "equal",
    "remove",
    "add",
    "equal",
  ]);
  expect(
    groups.flatMap((g) => g.nodes.filter((n) => n.type === "blockquote")),
  ).toHaveLength(1);
  for (const [source, side] of [
    [before, "remove"],
    [after, "add"],
  ] as const) {
    expect(
      groups
        .filter((g) => g.kind === "equal" || g.kind === side)
        .flatMap((g) => g.nodes.map((n) => n.type)),
    ).toEqual(parseMarkdown(source).ast.children!.map((n) => n.type));
  }
});
test("tables, nested lists and fences remain whole blocks even when changed", () => {
  const before = "- Parent\n  - Old\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
    after = before.replace("Old", "New").replace("1 | 2", "3 | 4");
  const groups = versionDiffBlocks(
    before,
    parseMarkdown(before),
    after,
    parseMarkdown(after),
  );
  expect(groups.flatMap((g) => g.nodes.map((n) => n.type))).toEqual([
    "list",
    "table",
    "list",
    "table",
  ]);
});
