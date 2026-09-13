import {
  footnoteBody,
  parseMarkdown,
  sourceLine,
  type MarkdownNode,
  type ParsedDocument,
} from "@axiom/markdown";
import type { Projection, ProjectionOptions } from "./projection";

/** Reuse the main rich projection for the body, then lift its source spans back
 * to the one shared Markdown document. There is no nested editor or Y.Text. */
export function projectFootnote(
  source: string,
  definition: MarkdownNode,
  parsed: ParsedDocument,
  options: ProjectionOptions,
  project: (source: string, options: ProjectionOptions) => Projection,
) {
  const body = footnoteBody(source, definition);
  const originals = new Map<string, MarkdownNode>();
  const intoBody = (node: MarkdownNode): MarkdownNode => {
    const from = body.bodyAt(node.from);
    originals.set(node.type + ":" + from, node);
    return {
      ...node,
      from,
      to: body.bodyAt(node.to),
      ...(node.contentFrom === undefined
        ? {}
        : { contentFrom: body.bodyAt(node.contentFrom) }),
      ...(node.contentTo === undefined
        ? {}
        : { contentTo: body.bodyAt(node.contentTo) }),
      ...(node.children ? { children: node.children.map(intoBody) } : {}),
    };
  };
  const canonical = (definition.children ?? []).map(intoBody);
  const selection = options.selection && {
    anchor: body.bodyAt(options.selection.anchor),
    head: body.bodyAt(options.selection.head),
  };
  const contains =
    options.selection &&
    [options.selection.anchor, options.selection.head].some(
      (at) => at >= definition.from && at <= body.offsets.at(-1)!,
    );
  let nodes = canonical;
  // Preserve typed nested fences until Enter, even if an imported later fence
  // could close them. Match the main editor's source-while-typing contract.
  if (contains && options.reveal && selection?.anchor === selection?.head) {
    const line = sourceLine(body.text, selection!.head);
    const header =
      /^([ \t]*(?:(?:>[ \t]*)|(?:(?:[-+*]|\d+[.)])[ \t]+))*)(`{3,}[^`]*|~{3,}.*|\$\$|\\\[)$/.exec(
        line.text,
      );
    const closed = (nodes: MarkdownNode[]): boolean =>
      nodes.some(
        (node) =>
          (["codeBlock", "mathBlock"].includes(node.type) &&
            node.from >= line.from &&
            node.from <= line.to &&
            (node.contentTo ?? node.to) < node.to) ||
          closed(node.children ?? []),
      );
    if (
      header &&
      (options.draftHeader?.from ===
        sourceLine(source, body.sourceAt(line.from)).from ||
        !closed(canonical))
    ) {
      const from = line.from + header[1].length;
      nodes =
        parseMarkdown(
          body.text.slice(0, from) +
            "x".repeat(line.to - from) +
            body.text.slice(line.to),
        ).ast.children ?? [];
    }
  }
  const sub = project(body.text, {
    ...options,
    parsed: {
      ...parsed,
      ast: {
        type: "document",
        from: 0,
        to: body.text.length,
        children: canonical,
      },
      definitions: [],
    },
    nodes,
    selection: contains ? selection : undefined,
    reveal: !!contains && options.reveal,
    footnoteDraft: undefined,
    folded: options.folded
      ?.filter(
        (range) => range.from >= body.offsets[0] && range.to <= definition.to,
      )
      .map((range) => ({
        ...range,
        from: body.bodyAt(range.from),
        to: body.bodyAt(range.to),
      })),
    draftHeader: undefined,
    imageSource:
      options.imageSource &&
      options.imageSource.from >= body.offsets[0] &&
      options.imageSource.to <= body.offsets.at(-1)!
        ? {
            from: body.bodyAt(options.imageSource.from),
            to: body.bodyAt(options.imageSource.to),
          }
        : undefined,
    literalSource:
      options.literalSource === undefined ||
      options.literalSource < definition.from ||
      options.literalSource >= definition.to
        ? undefined
        : body.bodyAt(options.literalSource),
  });
  const out = (node: MarkdownNode): MarkdownNode =>
    originals.get(node.type + ":" + node.from) ?? {
      ...node,
      from: body.sourceAt(node.from),
      to: body.sourceAt(node.to),
      ...(node.contentFrom === undefined
        ? {}
        : { contentFrom: body.sourceAt(node.contentFrom) }),
      ...(node.contentTo === undefined
        ? {}
        : { contentTo: body.sourceAt(node.contentTo) }),
      ...(node.children ? { children: node.children.map(out) } : {}),
    };
  return { body, sub, out };
}
