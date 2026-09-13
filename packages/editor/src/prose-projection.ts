import type { MarkdownNode } from "@axiom/markdown";
import { lineAt, type SourceSelection } from "./transactions";
import { quoteProse, type EditingProseNode } from "./quote-prose";
import { listMarker, listProse } from "./list-prose";

/** Presentation-only nodes. Their ranges always refer to the original Markdown,
 * including prefixes that the canonical parser omits from prose children. */
export function proseProjection(
  source: string,
  nodes: MarkdownNode[],
  selection: SourceSelection | undefined,
  literalSource?: number,
): MarkdownNode[] {
  const images: MarkdownNode[] = [];
  const collectImages = (node: MarkdownNode) => {
    if (node.type === "image") images.push(node);
    else node.children?.forEach(collectImages);
  };
  nodes.forEach(collectImages);
  const endpoints = selection ? [selection.anchor, selection.head] : [];
  const start = (node: MarkdownNode) => lineAt(source, node.from).from;
  const end = (node: MarkdownNode) => {
    let to = node.to;
    // AST ranges can own a final line ending or blank separator lines. Those
    // are not part of a heading/item's editable text.
    while (to > node.from && source[to - 1] === "\n") {
      to--;
      if (source[to - 1] === "\r") to--;
    }
    return to;
  };
  const selected = (from: number, to: number) =>
    endpoints.some((at) => at >= from && at <= to);
  const prose = new Set(["paragraph", "heading", "editingParagraph"]);
  // A divider has no inline body to edit. Keep its rendered view even when
  // its source range is selected; Source mode still exposes the real markers.
  const special = new Set([
    "codeBlock",
    "mathBlock",
    "table",
    "hr",
    "toc",
    "frontmatter",
  ]);
  const hardBreakStart = (node: MarkdownNode): number | null => {
    if (node.type !== "paragraph") return null;
    const match = source.slice(node.from, node.to).match(/( {2,}|\\+)\r?\n$/);
    if (!match || (match[1][0] === "\\" && match[1].length % 2 === 0))
      return null;
    return (
      node.from +
      match.index! +
      (match[1][0] === "\\" ? match[1].length - 1 : 0)
    );
  };
  const blank = (at: number): MarkdownNode => {
    const line = lineAt(source, at);
    const to = /^[ \t\r]*$/.test(source.slice(at, line.to))
      ? line.to - (source[line.to - 1] === "\r" ? 1 : 0)
      : at;
    return {
      type: "blankParagraph",
      from: at,
      to: Math.max(at, to),
      contentFrom: at,
      contentTo: Math.max(at, to),
      children:
        to > at
          ? [{ type: "text", from: at, to, text: source.slice(at, to) }]
          : [],
    };
  };
  const raw = (
    node: MarkdownNode,
    from: number,
    to: number,
    depth = 0,
    item?: MarkdownNode,
  ): EditingProseNode => {
    let quoteBody = quoteProse(source, from, to, depth);
    // A source-mode caret can explicitly address a hidden marker. Reveal the
    // exact unit in that case rather than silently moving its source position.
    if (
      selection?.anchor === selection?.head &&
      quoteBody?.lines.some(
        (line) =>
          selection &&
          selection.head >= line.from &&
          selection.head < line.bodyFrom,
      )
    )
      quoteBody = undefined;
    return {
      type: "sourceProse",
      kind: node.kind ?? node.type,
      level: node.level,
      key: node.key,
      from,
      to: Math.max(node.to, to),
      contentFrom: from,
      contentTo: to,
      quoteBody,
      listBody: item ? listProse(source, from, to, item) : undefined,
      images: images.filter((image) => image.from >= from && image.to <= to),
    };
  };
  const visit = (
    node: MarkdownNode,
    parent?: MarkdownNode,
    depth = 0,
  ): MarkdownNode | MarkdownNode[] => {
    if (node.type === "footnoteDefinition") return node;
    if (special.has(node.type)) {
      if (
        selection &&
        node.from === literalSource &&
        ["codeBlock", "mathBlock"].includes(node.type)
      )
        return raw(node, start(node), end(node), depth);
      return node;
    }
    const from = start(node);
    let to = end(node);
    // CommonMark accepts a marker at EOL as an empty item. During authoring it
    // remains ordinary text until its delimiter space exists. Never retain an
    // outer list wrapper, which would display a bullet beside the raw marker.
    if (node.type === "item" && !listMarker(source, node))
      return raw({ ...node, kind: "paragraph" }, from, to, depth);
    if (prose.has(node.type)) {
      // An unfinished quote continuation ("> ") is omitted from the AST's
      // paragraph. Keep it in the active paragraph, not a hidden caret gap.
      if (
        parent &&
        ["blockquote", "callout", "item"].includes(parent.type) &&
        parent.children?.at(-1) === node
      ) {
        const tail = source.slice(to, end(parent));
        if (/^[\r\n \t>]*$/.test(tail)) to = end(parent);
      }
      // Preserve a hard break before the next character is typed. The parser
      // drops a final hard break until a following line contains prose.
      const hardBreak = hardBreakStart(node);
      if (hardBreak !== null) to = Math.max(to, node.to);
      if (selected(from, to) || node.type === "editingParagraph")
        return raw(
          node,
          from,
          to,
          depth,
          parent?.type === "item" ? parent : undefined,
        );
      if (hardBreak !== null)
        return {
          ...node,
          children: [
            ...(node.children ?? []).flatMap((child) => {
              if (child.from >= hardBreak) return [];
              if (child.to <= hardBreak) return [child];
              return [
                {
                  ...child,
                  to: hardBreak,
                  text: source.slice(child.from, hardBreak),
                },
              ];
            }),
            { type: "hardbreak", from: hardBreak, to: node.to },
          ],
        };
      return node;
    }
    if (
      ["list", "item", "blockquote", "callout", "theorem", "proof"].includes(
        node.type,
      )
    ) {
      const quote = node.type === "blockquote" || node.type === "callout";
      const complete = quote && /^ {0,3}>[ \t]/.test(source.slice(node.from));
      const nextDepth = depth + (complete ? 1 : 0);
      if (!node.children?.length) {
        if (!selected(from, to)) return node;
        const body = raw(
          { ...node, kind: "paragraph" },
          from,
          to,
          nextDepth,
          node.type === "item" ? node : undefined,
        );
        return complete || body.listBody ? { ...node, children: [body] } : body;
      }
      // Legacy draft projection adds a callout header separately. The new raw
      // paragraph already includes that header, so never duplicate its offsets.
      const children = node.children.filter(
        (child) => child.kind !== "calloutHeader",
      );
      const processed: MarkdownNode[] = [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        // A multi-paragraph item's own prose is one editing unit. Nested items
        // and specialized blocks remain separate units and are never flattened.
        if (node.type === "item" && prose.has(child.type)) {
          let last = i;
          while (
            last + 1 < children.length &&
            prose.has(children[last + 1].type)
          )
            last++;
          if (last > i && selected(start(child), end(children[last]))) {
            processed.push(
              raw(
                { ...child, kind: "item", to: children[last].to },
                start(child),
                end(children[last]),
                nextDepth,
                node,
              ),
            );
            i = last;
            continue;
          }
        }
        const projected = visit(child, node, nextDepth);
        processed.push(...(Array.isArray(projected) ? projected : [projected]));
      }
      // Parsers omit empty quoted paragraphs after specialized blocks. Give an
      // active explicit quote prefix its own source-mapped insertion point.
      if (["blockquote", "callout", "item"].includes(node.type)) {
        const hasRawLine = (
          child: MarkdownNode,
          from: number,
          to: number,
        ): boolean =>
          (child.type === "sourceProse" &&
            child.from <= from &&
            (child.contentTo ?? child.to) >= to) ||
          !!child.children?.some((nested) => hasRawLine(nested, from, to));
        for (const at of new Set(endpoints)) {
          const line = lineAt(source, at);
          const lineTo = line.to - (source[line.to - 1] === "\r" ? 1 : 0);
          if (
            at < from ||
            at > node.to ||
            line.from < from ||
            !/^[ \t]*(?:(?:>[ \t]*)|(?:(?:[-+*]|\d+[.)])[ \t]+))+(?:\[[ xX]\][ \t]*)?$/.test(
              source.slice(line.from, lineTo),
            ) ||
            children.some(
              (child) => start(child) <= line.from && child.to > line.from,
            ) ||
            processed.some((child) => hasRawLine(child, line.from, lineTo))
          )
            continue;
          processed.push(
            raw(
              { type: "paragraph", from: line.from, to: lineTo },
              line.from,
              lineTo,
              nextDepth,
              node.type === "item" ? node : undefined,
            ),
          );
        }
        processed.sort((a, b) => a.from - b.from);
      }
      // A newly typed single-item list/quote must not replace an ordinary raw
      // paragraph with a decorated container as soon as its prefix parses.
      if (
        !complete &&
        !["list", "item"].includes(node.type) &&
        processed.length === 1 &&
        processed[0].type === "sourceProse"
      )
        return { ...processed[0], to: Math.max(node.to, processed[0].to) };
      if (
        node.type === "list" &&
        processed.some((child) => child.type !== "item")
      ) {
        const groups: MarkdownNode[] = [];
        let items: MarkdownNode[] = [];
        const flush = () => {
          if (!items.length) return;
          const first = items[0];
          groups.push({
            ...node,
            from: first.from,
            to: items.at(-1)!.to,
            start: node.ordered
              ? Number(
                  /^\d+/.exec(source.slice(first.from))?.[0] ?? node.start ?? 1,
                )
              : node.start,
            children: items,
          });
          items = [];
        };
        for (const child of processed) {
          if (child.type === "item") items.push(child);
          else {
            flush();
            groups.push(child);
          }
        }
        flush();
        return groups;
      }
      // A callout header is actual editable source, not a second generated title.
      const activeHeader =
        node.type === "callout" &&
        processed.some(
          (child) => child.type === "sourceProse" && start(child) === from,
        );
      return {
        ...node,
        ...(activeHeader ? { type: "blockquote" } : {}),
        children: processed,
      };
    }
    if (selected(from, to)) return raw(node, from, to, depth);
    return node;
  };

  const result: MarkdownNode[] = [];
  // The parser intentionally omits blank lines. Add only view insertion points:
  // two line endings are a paragraph separator, not two empty paragraphs.
  const gap = (
    from: number,
    to: number,
    leading: boolean,
    trailing: boolean,
  ) => {
    const value = source.slice(from, to);
    if (!/^[\t \r\n]*$/.test(value)) return;
    const boundaries = Array.from(
      value.matchAll(/\r?\n/g),
      (m) => from + m.index! + m[0].length,
    );
    if (leading && (from < to || trailing)) result.push(blank(from));
    for (let i = leading ? 1 : 0; i < boundaries.length; i += 2) {
      const at = boundaries[i];
      if (at < to || trailing) result.push(blank(at));
    }
    if (trailing && (!result.length || result.at(-1)!.to < to))
      result.push(blank(to));
  };
  let previous = 0;
  nodes.forEach((node, index) => {
    gap(previous, start(node), index === 0, false);
    const projected = visit(node);
    result.push(...(Array.isArray(projected) ? projected : [projected]));
    previous = node.to;
  });
  const last = result.at(-1);
  const lastOriginal = nodes.at(-1);
  const finalHardBreak =
    lastOriginal &&
    hardBreakStart(lastOriginal) !== null &&
    lastOriginal.to === source.length;
  const terminal =
    !nodes.length ||
    /\n$/.test(source) ||
    (lastOriginal &&
      ["codeBlock", "mathBlock", "table", "hr", "toc", "frontmatter"].includes(
        lastOriginal.type,
      ));
  if (!finalHardBreak && (previous < source.length || terminal))
    gap(previous, source.length, !nodes.length, true);
  if (!finalHardBreak && terminal && result.at(-1)?.type !== "blankParagraph")
    result.push(blank(source.length));
  // A non-newline source surface already owns EOF; no second caret at that offset.
  if (
    last?.type === "sourceProse" &&
    last.contentTo === source.length &&
    !/\n$/.test(source)
  ) {
    while (result.at(-1)?.type === "blankParagraph" && result.length > 1)
      result.pop();
  }
  return result;
}
