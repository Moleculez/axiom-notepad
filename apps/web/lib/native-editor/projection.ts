import {
  parseMarkdown,
  type MarkdownNode,
  type ParsedDocument,
} from "@axiom/markdown";
import { lineAt, selectionRange, type SourceSelection } from "./transactions";
import type { NativeBinding } from "./binding";

const draftHeader =
  /^[ \t]*(?:(?:>[ \t]*)|(?:(?:[-+*]|\d+[.)])[ \t]+))*(?:`{3,}[^`]*|~{3,}.*|\$\$|\\\[)$/;
export function isDraftHeader(text: string) {
  text = text.replace(/\r$/, "");
  text = text.replace(/^ {0,3}\[\^[^\]]+\]:[ \t]*/, "");
  return text === "---" || draftHeader.test(text);
}

/** View-local source ranges survive AST kind/identity changes and remote edits.
 * Nothing ephemeral is written to Markdown, presence, or the database. */
export class EditingSession {
  private active: ReturnType<NativeBinding["relative"]>[] = [];
  private pending: ReturnType<NativeBinding["relative"]> | null = null;
  constructor(private binding: NativeBinding) {}
  beginHeader(from: number, to: number) {
    this.pending = this.binding.relative({ anchor: from, head: to });
  }
  commitHeader() {
    this.pending = null;
  }
  header() {
    const range = this.pending && this.binding.absolute(this.pending);
    if (!range) return null;
    const line = lineAt(this.binding.source, range.anchor);
    if (range.anchor !== line.from || !isDraftHeader(line.text)) {
      this.pending = null;
      return null;
    }
    return { from: line.from, to: line.to };
  }
  ranges() {
    return this.active.flatMap((bookmark) => {
      const range = this.binding.absolute(bookmark);
      return range ? [{ from: range.anchor, to: range.head }] : [];
    });
  }
  capture(nodes: MarkdownNode[], selection: SourceSelection) {
    this.active = [];
    const visit = (node: MarkdownNode) => {
      if (!intersects(selection, node.from, node.to)) return;
      if (["editingParagraph", "paragraph", "heading"].includes(node.type))
        this.active.push(
          this.binding.relative({
            anchor: node.contentFrom ?? node.from,
            head: node.contentTo ?? node.to,
          }),
        );
      else node.children?.forEach(visit);
    };
    nodes.forEach(visit);
  }
}

export function proseRange(source: string, node: MarkdownNode) {
  const from = lineAt(source, node.contentFrom ?? node.from).from;
  const to = Math.max(from, node.to - (source[node.to - 1] === "\n" ? 1 : 0));
  return { from, to };
}

export function intersects(
  selection: SourceSelection,
  from: number,
  to: number,
) {
  const range = selectionRange(selection);
  return range.to >= from && range.from <= to;
}

/** A typing projection, never the canonical parse used by export, commands or
 * collaboration. An unfinished fence header cannot consume the following note. */
export function editingProjection(
  source: string,
  parsed: ParsedDocument,
  selection: SourceSelection,
  enabled: boolean,
  pending?: { from: number; to: number } | null,
  draftOnly = false,
) {
  if (!enabled) return parsed.ast.children ?? [];
  const physical = lineAt(source, selection.head);
  const line =
    draftOnly && physical.text.endsWith("\r")
      ? { ...physical, text: physical.text.slice(0, -1), to: physical.to - 1 }
      : physical;
  const header =
    /^([ \t]*(?:(?:>[ \t]*)|(?:(?:[-+*]|\d+[.)])[ \t]+))*)(`{3,}[^`]*|~{3,}.*|\$\$|\\\[)$/.exec(
      line.text,
    );
  let projection = parsed;
  const closedHeader = (nodes: MarkdownNode[]): boolean =>
    nodes.some(
      (node) =>
        (node.from >= line.from &&
          node.from <= line.to &&
          ["codeBlock", "mathBlock"].includes(node.type) &&
          (node.contentTo ?? node.to) < node.to) ||
        (node.from <= line.to &&
          node.to >= line.from &&
          !!node.children &&
          closedHeader(node.children)),
    );
  const metadataDraft =
    line.from === 0 && line.text === "---" && pending?.from === 0;
  if (
    metadataDraft ||
    (header &&
      selection.anchor >= line.from &&
      selection.anchor <= line.to &&
      (pending?.from === line.from || !closedHeader(parsed.ast.children ?? [])))
  ) {
    // Preserve container syntax and all offsets, masking only the draft marker.
    // Even a pre-existing closing fence stays outside this draft until Enter.
    const from = line.from + (header?.[1].length ?? 0);
    const masked =
      source.slice(0, from) +
      "x".repeat(line.to - from) +
      source.slice(line.to);
    projection = parseMarkdown(masked);
  }
  // vNext supplies its own prose projection. Only reuse fence-draft masking,
  // not the native caret-local views or synthetic empty container bodies.
  if (draftOnly) return projection.ast.children ?? [];
  const visit = (node: MarkdownNode): MarkdownNode => {
    if (!intersects(selection, lineAt(source, node.from).from, node.to))
      return node;
    // A draft is the only prose paragraph shown as source. Ordinary prose
    // keeps its inline tree; the renderer reveals syntax at the caret instead.
    if (
      (node.type === "paragraph" || node.type === "heading") &&
      projection !== parsed &&
      lineAt(source, node.from).from === line.from
    ) {
      const range = proseRange(source, node);
      if (intersects(selection, range.from, range.to))
        return {
          ...node,
          from: range.from,
          contentFrom: range.from,
          contentTo: range.to,
          type: "editingParagraph",
          kind: node.type,
          children: undefined,
        };
    }
    if (
      node.type === "toc" ||
      node.type === "hr" ||
      node.type === "frontmatter"
    ) {
      const range = proseRange(source, node);
      if (intersects(selection, range.from, range.to))
        return {
          ...node,
          from: range.from,
          contentFrom: range.from,
          contentTo: range.to,
          type: "editingParagraph",
          kind: node.type,
          children: undefined,
        };
    }
    if (
      ["item", "blockquote", "callout"].includes(node.type) &&
      !node.children?.length
    ) {
      const range = proseRange(source, node);
      if (intersects(selection, range.from, range.to)) {
        const raw = source.slice(range.from, range.to);
        // A bare > is still a draft. Once its separating space is typed,
        // expose an empty editable body, not a duplicate quote/list marker.
        if (raw.trimEnd().endsWith(">") && !raw.endsWith(" "))
          return { type: "editingParagraph", ...range };
        return {
          ...node,
          children: [
            {
              type: "paragraph",
              from: range.to,
              to: range.to,
              contentFrom: range.to,
              contentTo: range.to,
              text: "",
            },
          ],
        };
      }
    }
    if (!node.children?.length) return node;
    const children = node.children.map(visit);
    // A callout's first prose node starts on its header in the canonical AST.
    // Expose the header independently so editing its title never eats the body.
    if (node.type === "callout") {
      const header = lineAt(source, node.from);
      if (intersects(selection, header.from, header.to))
        children.unshift({
          type: "editingParagraph",
          from: header.from,
          to: header.to,
          kind: "calloutHeader",
        });
    }
    return children.some((child, index) => child !== node.children![index])
      ? { ...node, children }
      : node;
  };
  return (projection.ast.children ?? []).map(visit);
}
