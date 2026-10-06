import { parseMarkdown, plainText } from "../../markdown/src/parser";
import type { MarkdownNode, ParsedDocument } from "../../markdown/src/types";
import {
  mindmapLimits,
  type MindmapNode,
  type MindmapProjection,
} from "./types";

const semantic = (node: MarkdownNode): unknown => ({
  type: node.type,
  text: node.text,
  href: node.href,
  title: node.title,
  lang: node.lang,
  checked: node.checked,
  kind: node.kind,
  key: node.type === "heading" ? undefined : node.key,
  children: node.children?.map(semantic),
});

export function projectMindmap(
  source: string,
  title = "Untitled",
  parsed?: ParsedDocument,
): MindmapProjection {
  if (source.length > mindmapLimits.source)
    throw new Error(
      "Mind maps use the existing one-million-character document limit.",
    );
  const document = parsed ?? parseMarkdown(source);
  if (
    document.diagnostics.some((d) =>
      d.message.startsWith("Exceptionally complex Markdown"),
    )
  )
    throw new Error(
      "The Markdown parser reached its complexity limit. The complete source remains available; simplify a deeply nested branch before mapping it.",
    );
  const nodes: MindmapNode[] = [],
    supporting: MindmapProjection["supporting"] = [];
  const add = (value: MindmapNode) => {
    if (nodes.length >= mindmapLimits.nodes)
      throw new Error(
        "This document exceeds 5,000 map nodes. The complete Markdown remains available in Document or Source.",
      );
    nodes.push(value);
    return value;
  };
  const make = (
    ast: MarkdownNode,
    parent: MindmapNode,
    scope: string,
    kind: MindmapNode["kind"],
    branchTo = ast.to,
  ) => {
    const start = source.lastIndexOf("\n", ast.from - 1) + 1;
    const endAt = source.indexOf("\n", ast.from),
      end = endAt < 0 ? source.length : endAt;
    const lineEnd = source[end - 1] === "\r" ? end - 1 : end;
    const match =
      kind === "item"
        ? /^([ \t]*)((?:[-+*]|\d+[.)])[ \t]+)(\[[ xX]\][ \t]*)?/.exec(
            source.slice(ast.from, lineEnd),
          )
        : null;
    const labelFrom = match
      ? ast.from + match[0].length
      : (ast.contentFrom ?? ast.from);
    const labelTo =
      kind === "heading"
        ? (ast.contentTo ?? lineEnd)
        : kind === "item"
          ? lineEnd
          : ast.to;
    const labelSource = source.slice(labelFrom, labelTo);
    const content =
      kind === "item" ? ast.children?.find((n) => n.type === "paragraph") : ast;
    let label = content ? plainText(content) : "";
    if (kind === "content") {
      const names: Record<string, string> = {
        mathBlock: "Equation",
        codeBlock: ast.lang ? `${ast.lang} code` : "Code",
        table: "Table",
        image: "Image",
        media: "Attachment",
        htmlBlock: "HTML",
      };
      label = names[ast.type]
        ? `${names[ast.type]}${ast.text ? " · " + ast.text.trim().split("\n")[0] : ""}`
        : label;
    }
    if (kind === "container")
      label =
        ast.title ??
        ast.kind ??
        (ast.type === "blockquote" ? "Quotation" : ast.type);
    label = label.replace(/\s+/g, " ").trim().slice(0, 180) || "Empty node";
    const value = add({
      id: `${ast.type}:${ast.from}`,
      parentId: parent.id,
      children: [],
      kind,
      blockType: ast.type,
      from: ast.from,
      to: ast.to,
      branchTo,
      labelFrom,
      labelTo,
      label,
      labelSource,
      fingerprint: JSON.stringify({
        checked: ast.checked,
        content: semantic(content ?? ast),
      }),
      scope,
      ...(ast.level ? { level: ast.level } : {}),
      ...(ast.checked !== undefined ? { checked: ast.checked } : {}),
      ...(match
        ? {
            item: {
              prefix:
                source.slice(start, ast.from).replace(/^\ufeff/, "") + match[1],
              marker: match[2],
              task: match[3] ?? "",
              ordered: /^\d/.test(match[2]),
              width: match[2].length,
            },
          }
        : {}),
    });
    parent.children.push(value.id);
    return value;
  };
  const initial = document.ast.children ?? [];
  const h1 = initial.filter((n) => n.type === "heading" && n.level === 1);
  const substantive = initial.filter(
    (n) => !["frontmatter", "hr", "toc"].includes(n.type),
  );
  const promoted =
    h1.length === 1 && substantive[0] === h1[0] ? h1[0] : undefined;
  const root = add({
    id: "root",
    parentId: null,
    children: [],
    kind: "root",
    blockType: promoted ? "heading" : "root",
    from: promoted?.from ?? 0,
    to: promoted?.to ?? 0,
    branchTo: source.length,
    labelFrom: promoted?.contentFrom ?? 0,
    labelTo: promoted?.contentTo ?? 0,
    label: (promoted ? plainText(promoted) || title : title)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180),
    labelSource: promoted
      ? source.slice(
          promoted.contentFrom ?? promoted.from,
          promoted.contentTo ?? promoted.to,
        )
      : "",
    fingerprint: promoted ? JSON.stringify(semantic(promoted)) : "",
    scope: "document",
    ...(promoted ? { level: 1 } : {}),
  });
  const visit = (
    blocks: MarkdownNode[],
    parent: MindmapNode,
    scope: string,
    depth: number,
  ) => {
    if (depth > mindmapLimits.depth)
      throw new Error(
        "This map exceeds 64 hierarchy levels. Its complete source remains available.",
      );
    const stack: MindmapNode[] = [parent];
    // A reverse level stack avoids scanning the rest of the document per heading.
    const ends = new Map<number, number>();
    const following: MarkdownNode[] = [];
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index];
      if (block.type !== "heading") continue;
      while (
        following.length &&
        (following.at(-1)!.level ?? 1) > (block.level ?? 1)
      )
        following.pop();
      ends.set(index, following.at(-1)?.from ?? parent.branchTo);
      following.push(block);
    }
    blocks.forEach((block, index) => {
      if (block === promoted) return;
      if (
        [
          "frontmatter",
          "hr",
          "toc",
          "footnoteDefinition",
          "definition",
        ].includes(block.type)
      ) {
        supporting.push({ type: block.type, from: block.from, to: block.to });
        return;
      }
      if (block.type === "heading") {
        while (
          stack.length > 1 &&
          (stack.at(-1)!.level ?? 0) >= (block.level ?? 1)
        )
          stack.pop();
        const heading = make(
          block,
          stack.at(-1)!,
          scope,
          "heading",
          ends.get(index),
        );
        stack.push(heading);
        return;
      }
      const owner = stack.at(-1)!;
      if (block.type === "list") {
        for (const item of block.children ?? []) {
          const value = make(item, owner, scope, "item");
          const children = item.children ?? [];
          visit(
            children.filter((n, i) => i !== 0 || n.type !== "paragraph"),
            value,
            scope,
            depth + 1,
          );
        }
      } else if (
        ["blockquote", "callout", "theorem", "proof"].includes(block.type)
      ) {
        const value = make(block, owner, scope, "container");
        visit(block.children ?? [], value, value.id, depth + 1);
      } else make(block, owner, scope, "content");
    });
  };
  visit(initial, root, "document", 0);
  for (const definition of document.definitions ?? [])
    supporting.push({
      type: definition.type,
      from: definition.from,
      to: definition.to,
    });
  return { rootId: root.id, nodes, supporting };
}
export function nodeAtMindmapPosition(
  projection: MindmapProjection,
  position: number,
) {
  return (
    projection.nodes
      .filter(
        (n) =>
          n.from <= position &&
          (position < n.branchTo ||
            (position === n.branchTo &&
              n.branchTo === projection.nodes[0].branchTo)),
      )
      .sort((a, b) => a.branchTo - a.from - (b.branchTo - b.from))[0] ??
    projection.nodes[0]
  );
}
