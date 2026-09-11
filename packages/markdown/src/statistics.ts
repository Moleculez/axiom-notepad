import type { MarkdownNode, ParsedDocument } from "./types";

const words = new Intl.Segmenter(undefined, { granularity: "word" });
const characters = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function textStatistics(text: string) {
  let wordCount = 0,
    characterCount = 0,
    nonSpace = 0;
  for (const segment of words.segment(text))
    if (segment.isWordLike) wordCount++;
  for (const segment of characters.segment(text)) {
    characterCount++;
    if (/\S/u.test(segment.segment)) nonSpace++;
  }
  return {
    words: wordCount,
    characters: characterCount,
    nonSpace,
    readingMinutes: Math.max(1, Math.ceil(wordCount / 200)),
  };
}
export function documentStatistics(parsed: ParsedDocument, source: string) {
  const parts: string[] = [];
  let equations = 0,
    codeBlocks = 0,
    tables = 0,
    tasks = 0,
    completedTasks = 0;
  const visit = (node: MarkdownNode) => {
    if (["mathBlock", "mathInline"].includes(node.type)) {
      equations++;
      return;
    }
    if (node.type === "codeBlock") {
      codeBlocks++;
      return;
    }
    if (
      [
        "frontmatter",
        "toc",
        "html",
        "htmlBlock",
        "citation",
        "equationRef",
        "footnoteRef",
      ].includes(node.type)
    )
      return;
    if (node.type === "table") tables++;
    if (node.type === "item" && node.checked !== undefined) {
      tasks++;
      if (node.checked) completedTasks++;
    }
    if (node.children?.length) {
      node.children.forEach(visit);
      if (["paragraph", "heading", "item", "tableCell"].includes(node.type))
        parts.push("\n");
    } else if (node.type.endsWith("break")) parts.push("\n");
    else if (node.text) parts.push(node.text);
  };
  visit(parsed.ast);
  Object.values(parsed.footnotes).forEach((nodes) => nodes.forEach(visit));
  const text = parts.join("").trim();
  return {
    ...textStatistics(text),
    equations,
    codeBlocks,
    tables,
    tasks,
    completedTasks,
    sourceCharacters: source.length,
    lines: source ? source.split(/\r\n|\r|\n/).length : 0,
  };
}
