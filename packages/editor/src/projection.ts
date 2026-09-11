import {
  type Mark,
  type Node as ProseNode,
  type Schema,
} from "@milkdown/kit/prose/model";
import {
  parseMarkdown,
  tableModel,
  sourceLine,
  type MarkdownNode,
  type ParsedDocument,
} from "@axiom/markdown";
import { editorSchema } from "./schema";
import { SourceMap, type SourceSpan } from "./source-map";
import { literalBody } from "./literal";
import type { SourceSelection } from "./transactions";
import { proseProjection } from "./prose-projection";
import type { EditingProseNode, QuoteProse } from "./quote-prose";
import { projectFootnote } from "./footnote-projection";

export type ProjectedBlock = {
  from: number;
  to: number;
  node: MarkdownNode;
  cell?: { tableFrom: number; row: number; column: number; missing: boolean };
};
export type Projection = {
  doc: ProseNode;
  map: SourceMap;
  blocks: ProjectedBlock[];
  parsed: ParsedDocument;
  source: string;
  imageSource?: { from: number; to: number };
  activeProse: {
    from: number;
    to: number;
    kind: string;
    quote?: QuoteProse;
    footnote?: number;
  }[];
};
export type ProjectionOptions = {
  schema?: Schema;
  parsed?: ParsedDocument;
  nodes?: MarkdownNode[];
  selection?: SourceSelection;
  reveal?: boolean;
  /** vNext-only source-while-editing and visible blank paragraph policy. */
  proseSource?: boolean;
  /** Author-local empty-block handoff; never an automatic rule for new blocks. */
  literalSource?: number;
  footnoteDraft?: number;
  draftHeader?: { from: number; to: number } | null;
  /** Only this image exposes ordinary source text; its preview is a decoration. */
  imageSource?: { from: number; to: number };
};

/** Source -> ephemeral rich projection only. There is deliberately no serializer.
 * Unknown syntax remains an editable source block, never discarded or normalized. */
export function projectMarkdown(
  source: string,
  options: ProjectionOptions = {},
): Projection {
  const schema = options.schema ?? editorSchema;
  const parsed = options.parsed ?? parseMarkdown(source);
  const spans: SourceSpan[] = [],
    blocks: ProjectedBlock[] = [];
  const activeProse: Projection["activeProse"] = [];
  let position = 0;
  const active = (node: MarkdownNode) =>
    !!options.reveal &&
    !!options.selection &&
    [options.selection.anchor, options.selection.head].some(
      (p) => p >= node.from && p <= node.to,
    );
  const revealedImage = (node: MarkdownNode) =>
    node.type === "image" &&
    options.imageSource?.from === node.from &&
    node.to <= options.imageSource.to;
  const text = (
    value: string,
    from: number,
    to = from + value.length,
    marks: Mark[] = [],
    boundaries?: number[],
  ) => {
    spans.push({
      from: position,
      to: position + value.length,
      sourceFrom: from,
      sourceTo: to,
      ...(boundaries ? { boundaries } : {}),
    });
    position += value.length;
    return value ? [schema.text(value, marks)] : [];
  };
  const raw = (from: number, to: number, marks: Mark[] = []) =>
    text(source.slice(from, to), from, to, marks);
  const syntax = (from: number, to: number) =>
    raw(from, to, [schema.marks.syntax.create()]);
  const sourceText = (from: number, to: number, marks: Mark[] = []) => {
    const value = source.slice(from, to);
    if (!value.includes("\r\n")) return raw(from, to, marks);
    const boundaries = [from];
    let display = "";
    for (let at = from; at < to; at++) {
      if (source[at] === "\r" && source[at + 1] === "\n") at++;
      display += source[at];
      boundaries.push(at + 1);
    }
    return text(display, from, to, marks, boundaries);
  };
  const sourceProseText = (from: number, to: number) => {
    const result: ProseNode[] = [];
    let at = from;
    // A quiet tint on actual structural prefixes, never generated widgets or
    // smaller glyphs. The literal text and all caret positions remain intact.
    const prefixes =
      /^[ \t]*(?:(?:>[ \t]*)+(?:(?:#{1,6}|[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?)?|(?:#{1,6}|[-+*]|\d+[.)])(?=[ \t\r\n]|$)[ \t]*(?:\[[ xX]\][ \t]*)?)/gm;
    for (const match of source.slice(from, to).matchAll(prefixes)) {
      const begin = from + match.index!;
      if (begin > at) result.push(...sourceText(at, begin));
      at = begin + match[0].length;
      result.push(...sourceText(begin, at, [schema.marks.syntax.create()]));
    }
    if (at < to) result.push(...sourceText(at, to));
    return result;
  };
  const inline = (node: MarkdownNode, inherited: Mark[] = []): ProseNode[] => {
    const from = node.from,
      to = node.to;
    if (revealedImage(node)) return sourceText(from, to, inherited);
    if (
      [
        "mathInline",
        "image",
        "wikiLink",
        "citation",
        "equationRef",
        "footnoteRef",
        "emoji",
      ].includes(node.type) &&
      (node.type === "image" || !active(node))
    ) {
      const start = position++;
      spans.push({
        from: start,
        to: position,
        sourceFrom: from,
        sourceTo: to,
        boundaries: [from, to],
      });
      blocks.push({ from: start, to: position, node });
      return [
        schema.nodes.inline_preview.create(
          { kind: node.type, source: source.slice(from, to) },
          null,
          inherited,
        ),
      ];
    }
    if (node.type === "text") {
      const value = node.text ?? source.slice(from, to),
        original = source.slice(from, to);
      // Literal text (including the parser's trimmed trailing-space case).
      if (
        original === value ||
        (original.startsWith(value) &&
          /^[ \t]+$/.test(original.slice(value.length)))
      )
        return text(value, from, from + value.length, inherited);
      // Escapes/entities are indivisible lexemes. Reveal their actual spelling
      // while editing, so deleting '&' cannot silently corrupt '&amp;'.
      if (active(node)) return raw(from, to, inherited);
      const boundaries = Array.from({ length: value.length + 1 }, (_, i) =>
        i === value.length ? to : from,
      );
      return text(value, from, to, inherited, boundaries);
    }
    if (node.type === "softbreak" || node.type === "hardbreak") {
      const fromCR =
        source[from] === "\n" && source[from - 1] === "\r" ? from - 1 : from;
      return text("\n", fromCR, to, inherited, [fromCR, to]);
    }
    const mark = schema.marks[node.type];
    if (node.children && mark) {
      const contentFrom = node.contentFrom ?? node.children[0]?.from ?? from;
      const contentTo = node.contentTo ?? node.children.at(-1)?.to ?? to;
      const formatting = [
        ...inherited,
        mark.create(
          node.type === "link" ? { target: node.href ?? "" } : undefined,
        ),
      ];
      const result: ProseNode[] = [];
      if (active(node)) result.push(...syntax(from, contentFrom));
      for (const child of node.children)
        result.push(...inline(child, formatting));
      if (active(node)) result.push(...syntax(contentTo, to));
      return result;
    }
    if (node.type === "code" || node.type === "mathInline") {
      const a = node.contentFrom ?? from,
        b = node.contentTo ?? to;
      // Multiline code spans have normalization/prefix rules; show a lossless
      // lexeme until a dedicated inline-literal mapping can prove them.
      if (/[\r\n]/.test(source.slice(a, b))) return raw(from, to, inherited);
      const marks = [
        ...inherited,
        schema.marks[node.type === "code" ? "code" : "math"].create(),
      ];
      return [
        ...(active(node) ? syntax(from, a) : []),
        ...raw(a, b, marks),
        ...(active(node) ? syntax(b, to) : []),
      ];
    }
    // References, images and raw HTML are retained verbatim in the bridge gate.
    return raw(from, to, inherited);
  };
  const prose = (
    node: MarkdownNode,
    type = "paragraph",
    attrs?: Record<string, unknown>,
  ) => {
    const start = position++;
    const quote = (node as EditingProseNode).quoteBody;
    const authored = (from: number, to: number) => {
      const result: ProseNode[] = [];
      let at = from;
      for (const image of (node as EditingProseNode).images ?? []) {
        // Preserve the usual per-line mapping for multiline image source.
        if (revealedImage(image)) continue;
        if (image.to <= from || image.from >= to) continue;
        if (image.from < from) {
          at = Math.max(at, image.to);
          continue;
        }
        result.push(...sourceProseText(at, image.from), ...inline(image));
        at = image.to;
      }
      if (at < to) result.push(...sourceProseText(at, to));
      return result;
    };
    const children = quote
      ? quote.lines.flatMap((line, index) => [
          ...authored(line.bodyFrom, line.to),
          ...(index < quote.lines.length - 1 &&
          !(node as EditingProseNode).images?.some(
            (image) =>
              !revealedImage(image) &&
              image.from <= line.to &&
              image.to >= quote.lines[index + 1].bodyFrom,
          )
            ? text(
                "\n",
                line.to,
                quote.lines[index + 1].bodyFrom,
                [],
                [line.to, quote.lines[index + 1].bodyFrom],
              )
            : []),
        ])
      : node.type === "sourceProse"
        ? authored(node.contentFrom ?? node.from, node.contentTo ?? node.to)
        : node.type === "editingParagraph"
          ? sourceText(node.contentFrom ?? node.from, node.contentTo ?? node.to)
          : (node.children ?? []).flatMap((child) => inline(child));
    if (!children.length)
      text("", quote?.lines[0]?.bodyFrom ?? node.contentFrom ?? node.from);
    const result = schema.nodes[type].create(attrs, children);
    position++;
    blocks.push({ from: start, to: position, node });
    return result;
  };
  const container = (
    node: MarkdownNode,
    type: string,
    attrs?: Record<string, unknown>,
  ) => {
    const start = position++;
    const children = (node.children ?? []).map(block);
    if (!children.length)
      children.push(
        prose({
          type: "paragraph",
          from: node.to,
          to: node.to,
          contentFrom: node.to,
        }),
      );
    const result = schema.nodes[type].create(attrs, children);
    position++;
    blocks.push({ from: start, to: position, node });
    return result;
  };
  const block = (node: MarkdownNode): ProseNode => {
    if (node.type === "footnoteDefinition" && options.proseSource) {
      const header = sourceLine(source, node.from);
      if (options.footnoteDraft === node.from) {
        activeProse.push({
          from: header.from,
          to: header.to,
          kind: "footnoteHeader",
        });
        return prose(
          {
            type: "sourceProse",
            kind: "footnoteHeader",
            from: header.from,
            to: header.to,
            contentFrom: header.from,
            contentTo: header.to,
          },
          "source_prose",
          { kind: "footnoteHeader" },
        );
      }
      const start = position++;
      const { body, sub, out } = projectFootnote(
        source,
        node,
        parsed,
        { ...options, schema },
        projectMarkdown,
      );
      for (const span of sub.map.spans) {
        const boundaries = Array.from(
          { length: span.to - span.from + 1 },
          (_, i) => body.sourceAt(span.boundaries?.[i] ?? span.sourceFrom + i),
        );
        spans.push({
          from: position + span.from,
          to: position + span.to,
          sourceFrom: boundaries[0],
          sourceTo: boundaries.at(-1)!,
          boundaries,
        });
      }
      blocks.push(
        ...sub.blocks.map((block) => ({
          ...block,
          from: position + block.from,
          to: position + block.to,
          node: out(block.node),
          ...(block.cell
            ? {
                cell: {
                  ...block.cell,
                  tableFrom: body.sourceAt(block.cell.tableFrom),
                },
              }
            : {}),
        })),
      );
      activeProse.push(
        ...sub.activeProse.map((range) => ({
          ...range,
          from: body.sourceAt(range.from),
          to: body.sourceAt(range.to),
          footnote: node.from,
          ...(range.quote
            ? {
                quote: {
                  ...range.quote,
                  lines: range.quote.lines.map((line) => ({
                    from: body.sourceAt(line.from),
                    bodyFrom: body.sourceAt(line.bodyFrom),
                    to: body.sourceAt(line.to),
                    markers: line.markers.map((marker) => ({
                      from: body.sourceAt(marker.from),
                      to: body.sourceAt(marker.to),
                    })),
                  })),
                },
              }
            : {}),
        })),
      );
      position += sub.doc.content.size + 1;
      blocks.push({ from: start, to: position, node });
      return schema.nodes.footnote.create({ key: node.key }, sub.doc.content);
    }
    if (node.type === "sourceProse") {
      const quote = (node as EditingProseNode).quoteBody;
      activeProse.push({
        from: quote?.lines[0]?.bodyFrom ?? node.contentFrom ?? node.from,
        to: node.contentTo ?? node.to,
        kind: node.kind ?? "paragraph",
        ...(quote ? { quote } : {}),
      });
      return prose(node, "source_prose", {
        kind: node.kind,
        level: node.level ?? 0,
      });
    }
    if (node.type === "blankParagraph")
      return prose(node, "paragraph", { blank: true });
    if (["paragraph", "editingParagraph", "heading"].includes(node.type))
      return prose(
        node,
        node.type === "heading" ? "heading" : "paragraph",
        node.type === "heading" ? { level: node.level } : undefined,
      );
    if (node.type === "blockquote") return container(node, "blockquote");
    if (
      ["callout", "theorem", "proof"].includes(node.type) &&
      node.children?.length
    )
      return container(node, "callout", {
        kind: node.kind ?? node.type,
        title: node.title ?? node.label ?? "",
      });
    if (node.type === "list")
      return container(
        node,
        node.ordered ? "ordered_list" : "bullet_list",
        node.ordered ? { start: node.start ?? 1 } : undefined,
      );
    if (node.type === "item")
      return container(node, "list_item", { checked: node.checked ?? null });
    if (node.type === "table") {
      const model = tableModel(source, node);
      if (model) {
        const start = position++;
        const rows = model.rows.map((row, r) => {
          position++;
          const cells = row.cells.map((cell, c) => {
            const astCell = node.children?.[r]?.children?.[c];
            const result = prose(
              astCell ?? {
                type: "tableCell",
                from: cell.from,
                to: cell.to,
                contentFrom: cell.from,
                children: [],
              },
              "table_cell",
              { header: r === 0, align: node.align?.[c] ?? "" },
            );
            blocks[blocks.length - 1].cell = {
              tableFrom: node.from,
              row: r,
              column: c,
              missing: !!cell.missing,
            };
            return result;
          });
          position++;
          return schema.nodes.table_row.create(null, cells);
        });
        position++;
        blocks.push({ from: start, to: position, node });
        return schema.nodes.table.create(null, rows);
      }
    }
    const start = position++;
    const literal = ["codeBlock", "mathBlock"].includes(node.type);
    const body = literal ? literalBody(source, node) : null;
    const children = body
      ? text(body.text, body.offsets[0], body.offsets.at(-1), [], body.offsets)
      : raw(node.from, node.to);
    position++;
    blocks.push({ from: start, to: position, node });
    return schema.nodes[literal ? "embedded" : "raw_block"].create(
      { kind: node.type, lang: node.lang ?? "" },
      children,
    );
  };
  let projectedNodes = [
    ...(options.nodes ?? parsed.ast.children ?? []),
    ...(parsed.definitions ?? []),
  ].sort((a, b) => a.from - b.from);
  if (options.proseSource)
    projectedNodes = proseProjection(
      source,
      projectedNodes,
      options.reveal ? options.selection : undefined,
      options.literalSource,
    );
  const children = projectedNodes.map(block);
  const last = spans.at(-1);
  const terminal = projectedNodes.at(-1);
  // A terminal insertion point is view-only. Focusing it must not insert a newline.
  if (
    !options.proseSource &&
    (!children.length ||
      /[\r\n]$/.test(source) ||
      (terminal &&
        ["codeBlock", "mathBlock", "table", "hr"].includes(terminal.type)) ||
      (last &&
        source.slice(last.sourceTo).trim() === "" &&
        last.sourceTo < source.length))
  )
    children.push(
      prose({
        type: "paragraph",
        from: source.length,
        to: source.length,
        contentFrom: source.length,
      }),
    );
  const doc = schema.nodes.doc.create(null, children);
  doc.check();
  return {
    doc,
    map: new SourceMap(spans, source.length),
    blocks,
    parsed,
    source,
    activeProse,
    imageSource: options.imageSource,
  };
}
