import { parseMarkdown, plainText, slug } from "./parser";
import type { Dialect, MarkdownNode, ParsedDocument } from "./types";

function shift(node: MarkdownNode, delta: number): MarkdownNode {
  return {
    ...node,
    from: node.from + delta,
    to: node.to + delta,
    ...(node.contentFrom === undefined
      ? {}
      : { contentFrom: node.contentFrom + delta }),
    ...(node.contentTo === undefined
      ? {}
      : { contentTo: node.contentTo + delta }),
    ...(node.children
      ? { children: node.children.map((child) => shift(child, delta)) }
      : {}),
  };
}

/** Conservative incremental parsing. Only interior, single-line text edits in
 * an independently delimited top-level block qualify. Changes to syntax,
 * references, boundaries, or a budget-limited document use the full parser.
 * No global document cache: each worker/view owns and can discard its engine. */
export class MarkdownEngine {
  private source = "";
  private parsed?: ParsedDocument;
  private dialect: Dialect = "stem-v1";
  stats = { full: 0, incremental: 0, reused: 0 };
  clear() {
    this.source = "";
    this.parsed = undefined;
  }
  /** Reuse an already parsed revision from the view for its synchronous commands. */
  adopt(source: string, parsed: ParsedDocument, dialect: Dialect = "stem-v1") {
    this.source = source;
    this.parsed = parsed;
    this.dialect = dialect;
  }
  parse(source: string, dialect: Dialect = "stem-v1"): ParsedDocument {
    if (this.parsed && source === this.source && dialect === this.dialect) {
      this.stats.reused++;
      return this.parsed;
    }
    const next =
      this.parsed && dialect === this.dialect
        ? this.increment(source, this.parsed)
        : null;
    if (next) this.stats.incremental++;
    else this.stats.full++;
    this.source = source;
    this.dialect = dialect;
    return (this.parsed = next ?? parseMarkdown(source, dialect));
  }
  private increment(
    source: string,
    previous: ParsedDocument,
  ): ParsedDocument | null {
    if (
      previous.diagnostics.length ||
      previous.definitions?.length ||
      Object.keys(previous.footnotes).length ||
      /^ {0,3}\[[^\]\n]+\]:/m.test(this.source)
    )
      return null;
    let from = 0,
      to = this.source.length,
      end = source.length;
    while (from < to && from < end && this.source[from] === source[from])
      from++;
    while (to > from && end > from && this.source[to - 1] === source[end - 1]) {
      to--;
      end--;
    }
    // Structural delimiters (including Unicode line breaks) are deliberately
    // excluded; this fast path must never reinterpret neighboring blocks.
    if (
      !/^[\p{L}\p{N} ,.!?:;()]*$/u.test(
        this.source.slice(from, to) + source.slice(from, end),
      )
    )
      return null;
    const children = previous.ast.children ?? [];
    const index = children.findIndex(
      (node) => node.from < from && node.to > to,
    );
    const old = children[index];
    if (
      !old ||
      !["paragraph", "heading", "table", "codeBlock", "mathBlock"].includes(
        old.type,
      )
    )
      return null;
    const lineStart = this.source.lastIndexOf("\n", from - 1) + 1;
    if (!this.source.slice(lineStart, from).trim()) return null;
    if (
      old.type.endsWith("Block") &&
      (from < (old.contentFrom ?? old.to) || to > (old.contentTo ?? old.from))
    )
      return null;
    const delta = source.length - this.source.length;
    // Include the original top-level indentation, not only the syntax marker.
    const start = this.source.lastIndexOf("\n", old.from - 1) + 1;
    const fragment = parseMarkdown(
      source.slice(start, old.to + delta),
      this.dialect,
    );
    if (
      fragment.diagnostics.length ||
      fragment.ast.children?.length !== 1 ||
      fragment.ast.children[0].type !== old.type ||
      Object.keys(fragment.footnotes).length
    )
      return null;
    const replacement = shift(fragment.ast.children[0], start);
    if (replacement.from !== old.from || replacement.to !== old.to + delta)
      return null;
    const nodes = children.map((node, i) =>
      i === index ? replacement : shift(node, i > index ? delta : 0),
    );
    const parsed: ParsedDocument = {
      ast: { ...previous.ast, to: source.length, children: nodes },
      diagnostics: [],
      outline: [],
      links: [],
      citations: [],
      footnotes: {},
      definitions: [],
    };
    const slugs = new Map<string, number>(),
      citations = new Set<string>();
    const visit = (node: MarkdownNode) => {
      if (node.type === "heading") {
        const text = plainText(node),
          base = slug(text),
          count = slugs.get(base) ?? 0;
        slugs.set(base, count + 1);
        node.key = count ? `${base}-${count}` : base;
        parsed.outline.push({
          level: node.level!,
          text,
          id: node.key,
          from: node.from,
        });
      }
      if (node.type === "wikiLink" || node.type === "link")
        parsed.links.push({
          target: node.href!,
          label: plainText(node),
          from: node.from,
          to: node.to,
        });
      if (node.type === "citation")
        node.key!.split(";").forEach((key) => citations.add(key));
      node.children?.forEach(visit);
    };
    nodes.forEach(visit);
    parsed.citations = [...citations];
    return parsed;
  }
}

// Small synchronous command path, separate from each rendering worker. It
// avoids reparsing an unchanged source for selection and context-menu actions.
const commands = new MarkdownEngine();
export const parsedForCommands = (source: string) => commands.parse(source);
export const clearMarkdownCommandCache = () => commands.clear();
export const adoptMarkdownCommandDocument = (
  source: string,
  parsed: ParsedDocument,
) => commands.adopt(source, parsed);
