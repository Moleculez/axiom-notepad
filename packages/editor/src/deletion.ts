import {
  nodeAt,
  parseMarkdown,
  tableModel,
  footnoteAt,
  footnoteCommand,
  exitEmptyBlockLine,
  type MarkdownNode,
  type SourceEdit,
  type TextChange,
} from "@axiom/markdown";
import { literalBody, literalPrefix } from "./literal";
import {
  applyChanges,
  graphemeBoundary,
  lineAt,
  mapPosition,
  selectionRange,
  type SourceSelection,
} from "./transactions";
import { listMarker } from "./list-prose";

/** Only an already-empty editable unit is removable. Generated/atomic views
 * (images, rules, TOCs) are meaningful even when their textContent is empty. */
export function emptyBlockDelete(
  source: string,
  selection: SourceSelection,
): SourceEdit | null {
  if (selection.anchor !== selection.head) return null;
  const at = selection.head;
  const footnote = footnoteAt(source, at);
  if (footnote) {
    if (footnote.text.length === 0)
      return exitEmptyBlockLine(
        source,
        footnote.header.from,
        footnote.lines.at(-1)!.to,
        "",
      );
    return footnoteCommand(source, selection, emptyBlockDelete) ?? null;
  }
  const node = nodeAt(source, at, [
    "heading",
    "item",
    "blockquote",
    "callout",
    "theorem",
    "proof",
    "codeBlock",
    "mathBlock",
    "table",
    "frontmatter",
  ]);
  if (!node) return null;
  let empty = false;
  if (["codeBlock", "mathBlock"].includes(node.type))
    empty = literalBody(source, node).text.length === 0;
  else if (node.type === "table")
    empty = !!tableModel(source, node)?.rows.every((row) =>
      row.cells.every((cell) => !cell.raw.trim()),
    );
  else if (node.type === "frontmatter")
    empty = !source.slice(node.contentFrom, node.contentTo).trim();
  else if (node.type === "heading") empty = !node.text;
  else if (node.type === "item") {
    const marker = listMarker(source, node);
    empty = !!marker && !source.slice(marker.bodyFrom, node.to).trim();
  } else if (node.type === "callout") {
    const line = lineAt(source, node.from);
    // The default kind label is structural, not authored title text.
    empty =
      !node.children?.length &&
      /^>[ \t]*\[![\w-]+\][+-]?[ \t]*$/.test(
        source.slice(node.from, line.to).replace(/\r$/, ""),
      );
  } else {
    // Do not mistake an empty line inside a populated quote/callout for an
    // empty container; titles and nested blocks count as authored contents.
    empty = !source
      .slice(node.from, node.to)
      .replace(/^[ \t]*>[ \t]?/gm, "")
      .trim();
  }
  if (!empty) return null;
  const first = lineAt(source, node.from);
  let to = node.to;
  while (to > node.from && /[\r\n]/.test(source[to - 1])) to--;
  const prefix = source.slice(first.from, node.from);
  return exitEmptyBlockLine(
    source,
    first.from,
    to,
    prefix,
    /(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?$/.test(prefix),
  );
}

const proseTypes = ["paragraph", "heading"];
const blockTypes = [
  "paragraph",
  "heading",
  "codeBlock",
  "mathBlock",
  "table",
  "hr",
];

/** Literal deletion uses visible TeX/code coordinates. Hidden quote/list
 * prefixes never become stray text when two literal lines are joined. */
export function literalDelete(
  source: string,
  at: number,
  kind: string,
): SourceEdit | null {
  const node = nodeAt(source, at, ["codeBlock", "mathBlock"]);
  if (!node) return null;
  const body = literalBody(source, node),
    offset = body.offsets.indexOf(at);
  if (offset < 0) return null;
  const backward = !kind.includes("Forward"),
    line = lineAt(body.text, offset);
  let from = offset,
    to = offset;
  if (kind.includes("Word")) {
    if (backward)
      from = Math.max(
        0,
        offset -
          (body.text
            .slice(0, offset)
            .match(/(?:\s+|[\p{L}\p{N}_]+|[^\p{L}\p{N}\s])$/u)?.[0].length ??
            1),
      );
    else
      to = Math.min(
        body.text.length,
        offset +
          (body.text
            .slice(offset)
            .match(/^(?:\s+|[\p{L}\p{N}_]+|[^\p{L}\p{N}\s])/u)?.[0].length ??
            1),
      );
  } else if (kind.includes("Line")) {
    if (backward) from = line.from;
    else to = line.to;
  } else if (backward) from = graphemeBoundary(body.text, offset, -1);
  else to = graphemeBoundary(body.text, offset, 1);
  const start = body.offsets[from],
    end = body.offsets[to];
  return {
    changes: [{ from: start, to: end, insert: "" }],
    selection: { anchor: start },
  };
}

/** Unwrap one container without normalizing any unrelated source. */
export function unwrapBlock(
  source: string,
  node: MarkdownNode,
  at: number,
): SourceEdit {
  if (node.type === "codeBlock" || node.type === "mathBlock") {
    const literal = literalBody(source, node);
    const prefix = literalPrefix(source, node);
    const raw = literal.text.replaceAll("\n", "\n" + prefix);
    const insert = raw ? raw + (source[node.to - 1] === "\n" ? "\n" : "") : "";
    const offset = Math.max(
      0,
      literal.offsets.findIndex((p) => p >= at),
    );
    const before = literal.text.slice(0, offset);
    return {
      changes: [{ from: node.from, to: node.to, insert }],
      selection: {
        anchor:
          node.from +
          before.length +
          (before.match(/\n/g)?.length ?? 0) * prefix.length,
      },
    };
  }
  const changes: TextChange[] = [];
  if (node.type === "heading") {
    if (!node.text?.trim())
      return {
        changes: [
          { from: node.from, to: lineAt(source, node.from).to, insert: "" },
        ],
        selection: { anchor: node.from },
      };
    const start = node.contentFrom ?? node.from;
    changes.push({ from: node.from, to: start, insert: "" });
    const end = node.contentTo ?? node.to;
    const tail = source.slice(end, node.to);
    if (
      /^[ \t]+#+[ \t]*(?:\n)?$/.test(tail) ||
      /^\n[ \t]*(?:=+|-+)[ \t]*(?:\n)?$/.test(tail)
    )
      changes.push({
        from: end,
        to: node.to,
        insert: tail.endsWith("\n") ? "\n" : "",
      });
  } else if (node.type === "item") {
    const line = lineAt(source, node.from);
    const nested = node.from - line.from;
    const marker = /^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?/.exec(
      source.slice(node.from),
    );
    if (marker) {
      // Nested items first outdent to their parent level, retaining the item.
      // Top-level items become paragraphs, with continuation indentation removed.
      const quote = source.slice(line.from, node.from).lastIndexOf(">") + 1;
      const indentation = nested - quote;
      if (indentation >= 2) {
        const remove = Math.min(
          indentation,
          marker[0].replace(/\[[ xX]\][ \t]*$/, "").length,
        );
        for (let pos = line.from; pos < node.to;) {
          const next = lineAt(source, pos);
          if (source.slice(pos + quote, pos + quote + remove).trim() === "")
            changes.push({
              from: pos + quote,
              to: pos + quote + remove,
              insert: "",
            });
          pos = next.to + 1;
        }
      } else {
        changes.push({
          from: node.from,
          to: node.from + marker[0].length,
          insert: "",
        });
        const width = /^(?:[-+*]|\d+[.)])[ \t]+/.exec(marker[0])![0].length;
        for (let pos = line.to + 1; pos < node.to;) {
          const next = lineAt(source, pos);
          const prefix = source.slice(line.from, node.from);
          if (next.text.startsWith(prefix + " ".repeat(width)))
            changes.push({
              from: pos + prefix.length,
              to: pos + prefix.length + width,
              insert: "",
            });
          pos = next.to + 1;
        }
      }
    }
  } else if (node.type === "blockquote" || node.type === "callout") {
    const depth = node.from - lineAt(source, node.from).from;
    for (let pos = lineAt(source, node.from).from; pos < node.to;) {
      const line = lineAt(source, pos);
      const marker = /^> ?/.exec(line.text.slice(depth));
      if (marker)
        changes.push({
          from: pos + depth,
          to: pos + depth + marker[0].length,
          insert: "",
        });
      pos = line.to + 1;
    }
  }
  return { changes, selection: { anchor: mapPosition(at, changes) } };
}

function boundaryContainer(source: string, at: number) {
  const prose = nodeAt(source, at, proseTypes);
  if (
    prose?.type === "heading" &&
    !prose.text?.trim() &&
    at === lineAt(source, at).to
  )
    return prose;
  if (!prose) {
    const empty = nodeAt(source, at, ["heading", "item", "blockquote"]);
    if (
      empty &&
      /^(?:(?:>[ \t]*)+|(?:[-+*]|\d+[.)])[ \t]*(?:\[[ xX]\][ \t]*)?|#{1,6}[ \t]*)$/.test(
        source.slice(empty.from, empty.to).trimEnd(),
      )
    )
      return empty;
  }
  if (!prose || at !== (prose.contentFrom ?? prose.from)) return null;
  if (prose.type === "heading") return prose;
  const item = nodeAt(source, at, ["item"]);
  if (item && lineAt(source, item.from).from === lineAt(source, at).from)
    return item;
  const quote = nodeAt(source, at, ["blockquote", "callout"]);
  if (quote && lineAt(source, quote.from).from === lineAt(source, at).from)
    return quote;
  return null;
}

/** A handled boundary returns an edit (including caret-only navigation).
 * null means ordinary grapheme/word deletion may proceed. Never eat a hidden
 * fence, separator row, task marker, or closing heading marker one byte at a time. */
export function boundaryDelete(
  source: string,
  selection: SourceSelection,
  backward: boolean,
): SourceEdit | null {
  const { from, to } = selectionRange(selection);
  if (from !== to) return null;
  const fenced = nodeAt(source, from, ["codeBlock", "mathBlock"]);
  if (fenced) {
    const body = literalBody(source, fenced);
    if (
      (backward && from === body.offsets[0]) ||
      (!backward && from === body.offsets.at(-1))
    )
      return unwrapBlock(source, fenced, from);
    // A gap can collapse onto the hidden closing fence while deleting the
    // following paragraph. Unwrap it as a unit, never erase its backticks/$s.
    if (
      backward &&
      from > body.offsets.at(-1)! &&
      from >= (fenced.contentTo ?? fenced.to)
    ) {
      const edit = unwrapBlock(source, fenced, body.offsets.at(-1)!);
      return {
        ...edit,
        selection: { anchor: mapPosition(from, edit.changes) },
      };
    }
  }
  const table = nodeAt(source, from, ["table"]);
  if (table) {
    const model = tableModel(source, table)!;
    const cells = model.rows.flatMap((row) => row.cells);
    const index = cells.findIndex(
      (cell) => from >= cell.from && from <= cell.to,
    );
    const cell = cells[index];
    if (
      cell &&
      ((backward && from === cell.from) || (!backward && from === cell.to))
    ) {
      const neighbour = cells[index + (backward ? -1 : 1)];
      if (neighbour)
        return {
          changes: [],
          selection: { anchor: backward ? neighbour.to : neighbour.from },
        };
      return outsideBlock(source, table, backward);
    }
    return null;
  }
  const own = backward && boundaryContainer(source, from);
  if (own) return unwrapBlock(source, own, from);
  if (!backward) {
    const prefix = nodeAt(source, from, [
      "heading",
      "item",
      "blockquote",
      "callout",
    ]);
    if (prefix?.from === from) return unwrapBlock(source, prefix, from);
  }
  const current = nodeAt(source, from, proseTypes);
  const blocks: MarkdownNode[] = [];
  const visit = (node: MarkdownNode) => {
    if (blockTypes.includes(node.type)) blocks.push(node);
    else node.children?.forEach(visit);
  };
  parseMarkdown(source).ast.children?.forEach(visit);
  if (!current) {
    const adjacent = backward
      ? blocks.filter((node) => node.to <= from).at(-1)
      : blocks.find((node) => node.from >= from);
    if (
      !adjacent ||
      !/^\s*$/.test(
        source.slice(
          backward ? adjacent.to : from,
          backward ? from : adjacent.from,
        ),
      )
    )
      return null;
    if (["codeBlock", "mathBlock"].includes(adjacent.type)) {
      const edit = unwrapBlock(
        source,
        adjacent,
        editableEdge(source, adjacent, backward),
      );
      return {
        ...edit,
        selection: {
          anchor: mapPosition(from, edit.changes, backward ? 1 : -1),
        },
      };
    }
    if (adjacent.type === "table")
      return {
        changes: [],
        selection: { anchor: editableEdge(source, adjacent, backward) },
      };
    const edge = editableEdge(source, adjacent, backward);
    if (backward && edge < from)
      return {
        changes: [{ from: edge, to: from, insert: "" }],
        selection: { anchor: edge },
      };
    if (!backward && from < adjacent.from)
      return {
        changes: [{ from, to: adjacent.from, insert: "" }],
        selection: { anchor: from },
      };
    return null;
  }
  const edge = backward
    ? (current.contentFrom ?? current.from)
    : (current.contentTo ?? current.to);
  if (from !== edge) return null;
  const index = blocks.findIndex(
    (node) => node.from === current.from && node.type === current.type,
  );
  const adjacent = blocks[index + (backward ? -1 : 1)];
  if (!adjacent) return { changes: [], selection: { anchor: from } };
  if (["codeBlock", "mathBlock"].includes(adjacent.type)) {
    const edit = unwrapBlock(
      source,
      adjacent,
      backward
        ? literalBody(source, adjacent).offsets.at(-1)!
        : literalBody(source, adjacent).offsets[0],
    );
    return { ...edit, selection: { anchor: mapPosition(from, edit.changes) } };
  }
  if (adjacent.type === "table") {
    const cells = tableModel(source, adjacent)!.rows.flatMap(
      (row) => row.cells,
    );
    return {
      changes: [],
      selection: { anchor: backward ? cells.at(-1)!.to : cells[0].from },
    };
  }
  if (!backward) {
    const structure = boundaryContainer(
      source,
      adjacent.contentFrom ?? adjacent.from,
    );
    if (structure) {
      const edit = unwrapBlock(source, structure, from);
      return { ...edit, selection: { anchor: from } };
    }
  }
  if (proseTypes.includes(adjacent.type)) {
    const start = backward ? (adjacent.contentTo ?? adjacent.to) : from;
    const end = backward ? from : (adjacent.contentFrom ?? adjacent.from);
    // Only merge prose in the same container. A distinct list/quote is
    // unwrapped first, so neighbouring structure can never be accidentally cut.
    if (/^[\s]*$/.test(source.slice(start, end)))
      return {
        changes: [{ from: start, to: end, insert: "" }],
        selection: { anchor: start },
      };
  }
  return null;
}

function outsideBlock(
  source: string,
  block: MarkdownNode,
  before: boolean,
): SourceEdit {
  const candidates: MarkdownNode[] = [];
  const visit = (node: MarkdownNode) => {
    if (blockTypes.includes(node.type)) candidates.push(node);
    else node.children?.forEach(visit);
  };
  parseMarkdown(source).ast.children?.forEach(visit);
  const adjacent = before
    ? candidates.filter((node) => node.to <= block.from).at(-1)
    : candidates.find((node) => node.from >= block.to);
  if (adjacent)
    return {
      changes: [],
      selection: { anchor: editableEdge(source, adjacent, before) },
    };
  if (before) {
    const prefix = source.slice(0, block.from);
    if (prefix.trim()) {
      const at = prefix.trimEnd().length;
      return { changes: [], selection: { anchor: at } };
    }
    return {
      changes: [{ from: block.from, to: block.from, insert: "\n\n" }],
      selection: { anchor: block.from },
    };
  }
  const tail = source.slice(block.to);
  if (tail.length)
    return {
      changes: [],
      selection: { anchor: block.to + (/^\s*/.exec(tail)?.[0].length ?? 0) },
    };
  return {
    changes: [{ from: block.to, to: block.to, insert: "\n\n" }],
    selection: { anchor: block.to + 2 },
  };
}

function editableEdge(source: string, node: MarkdownNode, end: boolean) {
  if (["codeBlock", "mathBlock"].includes(node.type)) {
    const offsets = literalBody(source, node).offsets;
    return end ? offsets.at(-1)! : offsets[0];
  }
  if (node.type === "table") {
    const cells = tableModel(source, node)!.rows.flatMap((row) => row.cells);
    return end ? cells.at(-1)!.to : cells[0].from;
  }
  return end ? (node.contentTo ?? node.to) : (node.contentFrom ?? node.from);
}

/** Preserve delimiters of partially selected literal blocks and table cells.
 * A fully selected block is removed normally. The whole operation is one undo. */
export function rangeDelete(
  source: string,
  selection: SourceSelection,
): SourceEdit {
  const { from, to } = selectionRange(selection);
  const protectedRanges: { from: number; to: number }[] = [];
  const visit = (node: MarkdownNode) => {
    if (
      node.to <= from ||
      node.from >= to ||
      (from <= node.from && to >= node.to)
    )
      return;
    if (["codeBlock", "mathBlock"].includes(node.type)) {
      const literal = literalBody(source, node);
      protectedRanges.push(
        { from: node.from, to: literal.offsets[0] },
        { from: literal.offsets.at(-1)!, to: node.to },
      );
      for (let i = 0; i < literal.text.length; i++) {
        if (
          literal.text[i] === "\n" &&
          literal.offsets[i + 1] > literal.offsets[i] + 1
        )
          // Retain both newline and quote/list prefix of a partially selected
          // nested literal. Otherwise the next line escapes its container.
          protectedRanges.push({
            from: literal.offsets[i],
            to: literal.offsets[i + 1],
          });
      }
    } else if (node.type === "table") {
      const model = tableModel(source, node)!;
      let pos = node.from;
      for (const cell of model.rows.flatMap((row) => row.cells)) {
        if (cell.from > pos) protectedRanges.push({ from: pos, to: cell.from });
        pos = Math.max(pos, cell.to);
      }
      protectedRanges.push({ from: pos, to: node.to });
    } else node.children?.forEach(visit);
  };
  parseMarkdown(source).ast.children?.forEach(visit);
  const changes: TextChange[] = [];
  let at = from;
  for (const protectedRange of protectedRanges.sort(
    (a, b) => a.from - b.from,
  )) {
    if (protectedRange.to <= at || protectedRange.from >= to) continue;
    if (protectedRange.from > at)
      changes.push({
        from: at,
        to: Math.min(to, protectedRange.from),
        insert: "",
      });
    at = Math.max(at, protectedRange.to);
  }
  if (at < to) changes.push({ from: at, to, insert: "" });
  const after = applyChanges(source, changes);
  let caret = Math.min(after.length, mapPosition(from, changes, -1));
  const literal = nodeAt(after, caret, ["codeBlock", "mathBlock", "table"]);
  if (literal && caret < editableEdge(after, literal, false))
    caret = editableEdge(after, literal, false);
  return { changes, selection: { anchor: caret } };
}
