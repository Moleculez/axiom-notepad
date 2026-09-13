import type { MarkdownNode, ParsedDocument } from "@axiom/markdown";
export type ReadingBlock = { from: number; to: number; type: string };
export type ReadingBlockRect = ReadingBlock & {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
export const readingBlockTypes = new Set([
  "paragraph",
  "heading",
  "list",
  "item",
  "blockquote",
  "callout",
  "theorem",
  "proof",
  "codeBlock",
  "mathBlock",
  "image",
  "table",
  "frontmatter",
  "footnoteDefinition",
  "hr",
  "toc",
  "htmlBlock",
]);
export function readingBlocks(parsed: ParsedDocument): ReadingBlock[] {
  const blocks: ReadingBlock[] = [];
  const visit = (node: MarkdownNode) => {
    if (readingBlockTypes.has(node.type))
      blocks.push({ from: node.from, to: node.to, type: node.type });
    node.children?.forEach(visit);
  };
  visit(parsed.ast);
  parsed.definitions?.forEach(visit);
  return blocks.sort((a, b) => a.from - b.from || b.to - a.to);
}
export function blockLabel(type: string) {
  return (
    (
      {
        hr: "Divider",
        toc: "Contents",
        item: "List item",
        codeBlock: "Code",
        mathBlock: "Equation",
        frontmatter: "Metadata",
        footnoteDefinition: "Footnote",
        sourceProse: "Paragraph",
      } as Record<string, string>
    )[type] ?? type.charAt(0).toUpperCase() + type.slice(1)
  );
}
