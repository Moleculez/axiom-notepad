import type { ParsedDocument } from "@axiom/markdown";

export type OutlineHeading = ParsedDocument["outline"][number];
export type OutlineNode = OutlineHeading & {
  depth: number;
  parentId: string | null;
  children: OutlineNode[];
};

/** Nest by actual ancestry, not (heading level - 1). Skips create no empty levels. */
export function outlineTree(headings: OutlineHeading[]): OutlineNode[] {
  const roots: OutlineNode[] = [],
    stack: OutlineNode[] = [];
  for (const heading of headings) {
    while (stack.length && stack[stack.length - 1].level >= heading.level)
      stack.pop();
    const parent = stack[stack.length - 1];
    const node: OutlineNode = {
      ...heading,
      depth: stack.length,
      parentId: parent?.id ?? null,
      children: [],
    };
    (parent?.children ?? roots).push(node);
    stack.push(node);
  }
  return roots;
}

export function outlineAncestors(tree: OutlineNode[], id: string): string[] {
  for (const node of tree) {
    if (node.id === id) return [];
    // The depth is at most six, but the document may have many siblings.
    if (node.children.some((child) => child.id === id)) return [node.id];
    const path = outlineAncestors(node.children, id);
    if (path.length) return [node.id, ...path];
  }
  return [];
}

export function sectionAtPosition(
  headings: OutlineHeading[],
  position: number,
): string | null {
  let low = 0,
    high = headings.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (headings[mid].from <= position) low = mid + 1;
    else high = mid;
  }
  return headings[Math.max(0, low - 1)]?.id ?? null;
}

export function outlineBranches(tree: OutlineNode[]): string[] {
  return tree.flatMap((node) =>
    node.children.length ? [node.id, ...outlineBranches(node.children)] : [],
  );
}
