import {
  parseMarkdown,
  parseMarkdownFragment,
  plainText,
} from "../../markdown/src/parser";
import type { MarkdownNode, ParsedDocument } from "../../markdown/src/types";
import {
  mindmapLimits,
  type MindmapNode,
  type MindmapProjection,
} from "./types";

export type MindmapBlockPreview = {
  kind:
    | "prose"
    | "equation"
    | "code"
    | "diagram"
    | "image"
    | "table"
    | "quote"
    | "media"
    | "supporting";
  markdown: string;
  caption?: string;
  code?: string;
  language?: string;
  href?: string;
  alt?: string;
  expandable: boolean;
};
const find = (node: MarkdownNode, type: string): MarkdownNode | undefined =>
  node.type === type
    ? node
    : node.children?.map((n) => find(n, type)).find(Boolean);
const clipped = (text: string, max = 600) =>
  text.length > max ? text.slice(0, max) + "…" : text;
const escapeCell = (value: string) =>
  value.replace(/(?<!\\)\|/g, "\\|").replace(/[\r\n]/g, " ");
const literalInline = (value: string) =>
  value.replace(/([\\`*_{}\[\]<>()!$~^=])/g, "\\$1");

/** Bounded source descriptions; the host owns rendering and media policy. */
export function mindmapBlockPreview(
  source: string,
  node: MindmapNode,
  rich = true,
  owner?: ParsedDocument,
): MindmapBlockPreview {
  const base: MindmapBlockPreview = {
    kind: "prose",
    markdown: clipped(node.labelSource || node.label, 2000),
    expandable: false,
  };
  if (node.presentationOnly)
    return {
      kind: "supporting",
      markdown: node.label,
      caption:
        node.blockType === "supporting"
          ? "Source-backed definitions"
          : node.blockType === "frontmatter"
            ? "Metadata"
            : node.blockType === "footnoteDefinition"
              ? "Footnote"
              : "Reference",
      expandable: node.to > node.from,
    };
  if (!rich && !["heading", "item", "root"].includes(node.kind))
    return { ...base, markdown: node.label };
  if (["heading", "item", "root"].includes(node.kind)) return base;
  const raw = source.slice(node.from, node.to);
  if (raw.length > 64_000)
    return {
      ...base,
      markdown: node.label,
      caption: "Open full block",
      expandable: true,
    };
  const ast = (owner ? parseMarkdownFragment(raw, owner) : parseMarkdown(raw))
    .ast;
  if (node.blockType === "mathBlock")
    return {
      kind: "equation",
      markdown: raw.length <= 16000 ? raw : node.label,
      caption: "Equation",
      expandable: true,
    };
  if (node.blockType === "codeBlock") {
    const block = find(ast, "codeBlock"),
      code = block?.text ?? "",
      lines = code ? code.replace(/\r?\n$/, "").split(/\r?\n/) : [],
      language = block?.lang ?? "";
    const prefix = /^([ \t>]*)(`{3,}|~{3,})/.exec(raw)?.[2] ?? "```";
    // A diagram is a complete program, not a four-line code excerpt. The shared
    // renderer enforces its own 30k-character/resource/edge safety limits.
    if (language.toLowerCase() === "mermaid")
      return {
        kind: "diagram",
        markdown: `${prefix}mermaid\n${code}${code.endsWith("\n") ? "" : "\n"}${prefix}`,
        code,
        language: "mermaid",
        caption: "Mermaid diagram",
        expandable: true,
      };
    return {
      kind: "code",
      markdown: `${prefix}${language}\n${lines
        .slice(0, 4)
        .map((line) => clipped(line, 240))
        .join("\n")}\n${prefix}`,
      code,
      language,
      caption: `${language || "Code"} · ${lines.length} lines`,
      expandable: true,
    };
  }
  if (node.blockType === "table") {
    const table = find(ast, "table"),
      rows = table?.children ?? [],
      cols = Math.max(0, ...rows.map((row) => row.children?.length ?? 0));
    const sample = rows.slice(0, 4).map(
      (row) =>
        `| ${(row.children ?? [])
          .slice(0, 3)
          .map((cell) => {
            const contents = raw.slice(cell.from, cell.to);
            // Keep complete inline syntax (math, references and emphasis). Long
            // cells use a literal excerpt instead of cutting a delimiter pair.
            return escapeCell(
              contents.length <= 240
                ? contents
                : literalInline(clipped(plainText(cell), 48)),
            );
          })
          .join(" | ")} |`,
    );
    if (sample.length)
      sample.splice(
        1,
        0,
        `| ${Array.from({ length: Math.min(cols, 3) }, (_, i) =>
          table?.align?.[i] === "center"
            ? ":---:"
            : table?.align?.[i] === "right"
              ? "---:"
              : table?.align?.[i] === "left"
                ? ":---"
                : "---",
        ).join(" | ")} |`,
      );
    return {
      kind: "table",
      markdown: sample.join("\n"),
      caption: `${Math.max(0, rows.length - 1)} rows · ${cols} columns${rows.length > 4 || cols > 3 ? " · excerpt" : ""}`,
      expandable: true,
    };
  }
  if (node.kind === "container")
    return {
      kind: "quote",
      markdown: clipped(node.labelSource, 700),
      caption: node.label,
      expandable: true,
    };
  const media = find(ast, "image") ?? find(ast, "media");
  const paragraph = ast.children?.[0];
  const onlyMedia =
    ast.children?.length === 1 &&
    paragraph?.type === "paragraph" &&
    paragraph.children?.every(
      (child) =>
        ["image", "media"].includes(child.type) ||
        (child.type === "text" && !child.text?.trim()),
    );
  if (
    media &&
    ((node.blockType === "paragraph" && onlyMedia) ||
      ["image", "media"].includes(node.blockType))
  ) {
    return {
      kind: media.type === "image" ? "image" : "media",
      markdown: media.type === "image" ? raw : "",
      caption: media.type === "image" ? "Image" : "Attachment",
      href: media.href,
      alt: plainText(media),
      expandable: true,
    };
  }
  return {
    ...base,
    markdown: clipped(node.labelSource, 600),
    expandable: node.labelSource.length > 300,
  };
}

/** Synthetic supporting nodes are view-only; real source ranges remain exact. */
export function withMindmapSupporting(
  projection: MindmapProjection,
  source: string,
) {
  const unique = [
    ...new Map(
      projection.supporting.map((n) => [`${n.type}:${n.from}:${n.to}`, n]),
    ).values(),
  ].filter((n) => !["hr", "toc"].includes(n.type));
  if (!unique.length) return projection;
  if (projection.nodes.length + unique.length + 1 > mindmapLimits.nodes)
    throw new Error(
      "Supporting material exceeds the map node limit. Hide it to continue; complete source remains available.",
    );
  const group: MindmapNode = {
    id: "supporting",
    kind: "container",
    blockType: "supporting",
    from: 0,
    to: 0,
    branchTo: 0,
    labelFrom: 0,
    labelTo: 0,
    label: "Supporting material",
    labelSource: "",
    fingerprint: "",
    parentId: projection.rootId,
    children: [],
    scope: "supporting",
    presentationOnly: true,
  };
  const entries = unique.map((entry) => {
    const labelSource = source.slice(entry.from, entry.to);
    const label =
      entry.type === "frontmatter"
        ? "Document metadata"
        : clipped(labelSource.trim().split(/\r?\n/)[0], 120);
    const id = `supporting:${entry.type}:${entry.from}`;
    group.children.push(id);
    return {
      ...group,
      ...entry,
      id,
      blockType: entry.type,
      kind: "content" as const,
      children: [],
      parentId: group.id,
      branchTo: entry.to,
      labelFrom: entry.from,
      labelTo: entry.to,
      labelSource,
      label,
    };
  });
  return {
    ...projection,
    nodes: [
      ...projection.nodes.map((n) =>
        n.id === projection.rootId
          ? { ...n, children: [...n.children, group.id] }
          : n,
      ),
      group,
      ...entries,
    ],
  };
}
