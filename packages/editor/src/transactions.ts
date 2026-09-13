import {
  nodeAt,
  quoteContext,
  footnoteCommand,
  blockPath,
  exitEmptyBlockLine,
  type MarkdownNode,
  type SourceEdit,
  type TextChange,
} from "@axiom/markdown";
import { literalBody, literalPrefix } from "./literal";
import { footnoteEnter } from "./footnotes";
import { listMarker } from "./list-prose";

/** All coordinates are UTF-16 offsets in the original Markdown, never HTML. */
export type SourceSelection = { anchor: number; head: number };
export type NativeTransaction = {
  changes: TextChange[];
  selection?: SourceSelection;
  kind: "typing" | "delete" | "command" | "paste" | "composition";
};
export type DocumentSnapshot = {
  source: string;
  revision: number;
  selection: SourceSelection;
};
export function selectionRange(s: SourceSelection) {
  return { from: Math.min(s.anchor, s.head), to: Math.max(s.anchor, s.head) };
}
export function clampSelection(
  s: SourceSelection,
  length: number,
): SourceSelection {
  const clamp = (n: number) => Math.max(0, Math.min(length, n));
  return { anchor: clamp(s.anchor), head: clamp(s.head) };
}
export function orderedChanges(changes: readonly TextChange[], length: number) {
  const sorted = changes
    .map((c) => ({ ...c }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  let end = 0;
  for (const change of sorted) {
    if (
      !Number.isInteger(change.from) ||
      !Number.isInteger(change.to) ||
      change.from < end ||
      change.to < change.from ||
      change.to > length
    )
      throw new RangeError("Invalid or overlapping Markdown changes.");
    end = change.to;
  }
  return sorted;
}
export function applyChanges(source: string, changes: readonly TextChange[]) {
  let end = 0,
    result = "";
  for (const c of orderedChanges(changes, source.length)) {
    result += source.slice(end, c.from) + c.insert;
    end = c.to;
  }
  return result + source.slice(end);
}
export function mapPosition(
  position: number,
  changes: readonly TextChange[],
  association = 1,
) {
  let delta = 0;
  for (const c of changes) {
    if (position < c.from || (position === c.from && association < 0)) break;
    if (position <= c.to)
      return c.from + delta + (association < 0 ? 0 : c.insert.length);
    delta += c.insert.length - (c.to - c.from);
  }
  return position + delta;
}
export function lineAt(source: string, at: number) {
  const from = at ? source.lastIndexOf("\n", at - 1) + 1 : 0;
  const end = source.indexOf("\n", at),
    to = end < 0 ? source.length : end;
  return { from, to, text: source.slice(from, to) };
}
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** Never split surrogate pairs, combining characters, flags or emoji ZWJ sequences. */
export function graphemeBoundary(
  source: string,
  position: number,
  direction: -1 | 1,
) {
  // A line bounds the search without placing an arbitrary cut inside a grapheme.
  const line = lineAt(source, position);
  if (direction < 0 && position === line.from) return Math.max(0, position - 1);
  if (direction > 0 && position === line.to)
    return Math.min(source.length, position + 1);
  let prior = line.from;
  for (const part of graphemes.segment(line.text)) {
    const start = line.from + part.index,
      end = start + part.segment.length;
    if (direction > 0 && end > position) return end;
    if (direction < 0 && end >= position) return start;
    prior = end;
  }
  return direction < 0 ? prior : source.length;
}
export function replacement(
  selection: SourceSelection,
  insert: string,
): SourceEdit {
  const { from, to } = selectionRange(selection);
  return {
    changes: [{ from, to, insert }],
    selection: { anchor: from + insert.length },
  };
}

/** Structural Enter is source-based, and therefore identical in both modes. */
export function enterEdit(
  source: string,
  selection: SourceSelection,
  options: {
    continuation: boolean;
    indentSize: number;
    codeIndentOnEnter: boolean;
    defaultCodeLanguage: string;
  },
  soft = false,
  pendingHeader = false,
): SourceEdit {
  if (options.continuation) {
    const continued = footnoteEnter(source, selection, soft, (body, at) =>
      enterEdit(body, at, options, soft, pendingHeader),
    );
    if (continued) return continued;
  }
  const { from, to } = selectionRange(selection),
    line = lineAt(source, from);
  const enclosing = nodeAt(source, from, ["codeBlock", "mathBlock"]);
  const fenced =
    /^([ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?)(`{3,}|~{3,})([\w+#.-]*)$/.exec(
      line.text,
    );
  const math =
    /^([ \t]*(?:(?:>[ \t]*)|(?:(?:[-+*]|\d+[.)])[ \t]+))*)(\$\$|\\\[)$/.exec(
      line.text,
    );
  if (
    !soft &&
    from === to &&
    from === line.to &&
    line.from === 0 &&
    line.text === "---"
  ) {
    if (!pendingHeader && nodeAt(source, from, ["frontmatter"]))
      return { changes: [], selection: { anchor: line.to + 1 } };
    return {
      changes: [{ from, to, insert: "\n\n---\n\n" }],
      selection: { anchor: from + 1 },
    };
  }
  if (
    !soft &&
    from === to &&
    from === line.to &&
    (fenced || math) &&
    (!enclosing || enclosing.from >= line.from)
  ) {
    if (
      !pendingHeader &&
      enclosing &&
      (enclosing.contentTo ?? enclosing.to) < enclosing.to
    )
      return {
        changes: [],
        selection: { anchor: literalBody(source, enclosing).offsets[0] },
      };
    const prefix = (fenced?.[1] ?? math![1]).replace(
        /(?:[-+*]|\d+[.)])[ \t]+/g,
        (marker) => " ".repeat(marker.length),
      ),
      fence = fenced?.[2] ?? (math![2] === "\\[" ? "\\]" : "$$");
    const language = fenced && !fenced[3] ? options.defaultCodeLanguage : "";
    const insert =
      language +
      "\n" +
      prefix +
      "\n" +
      prefix +
      fence +
      (math && prefix.includes(">") ? "\n" + prefix : "\n\n");
    return {
      changes: [{ from, to, insert }],
      selection: { anchor: from + language.length + 1 + prefix.length },
    };
  }
  if (enclosing) {
    const container = literalPrefix(source, enclosing);
    const bodyLine = line.text.startsWith(container)
      ? line.text.slice(container.length)
      : line.text;
    const indentation =
      enclosing.type === "codeBlock" && options.codeIndentOnEnter
        ? (/^[ \t]*/.exec(bodyLine)?.[0] ?? "") +
          (/[:{[(]\s*$/.test(source.slice(line.from, from))
            ? " ".repeat(options.indentSize)
            : "")
        : "";
    return replacement(selection, "\n" + container + indentation);
  }
  const quoted = options.continuation && quoteContext(source, from);
  const itemBeforeQuote =
    quoted && /(?:[-+*]|\d+[.)])[ \t]+[^\r\n]*>/.test(quoted.authored);
  if (quoted && itemBeforeQuote) {
    if (!soft && !source.slice(quoted.contentFrom, line.to).trim()) {
      const next = quoted.authored.replace(/>[ \t]*$/, "");
      return exitEmptyBlockLine(source, line.from, line.to, next);
    }
    return replacement(selection, (soft ? "  \n" : "\n") + quoted.prefix);
  }
  const item = options.continuation && nodeAt(source, from, ["item"]);
  const innerQuote = item && nodeAt(source, from, ["blockquote", "callout"]);
  if (item && (!innerQuote || innerQuote.from <= item.from)) {
    const marker = listMarker(source, item);
    if (marker) {
      const prefix = marker.prefix,
        header = marker.line;
      if (
        !soft &&
        line.from === header.from &&
        !source.slice(marker.bodyFrom, line.to).trim()
      ) {
        const path = listPath(source, item);
        const parent = path.filter((node) => node.type === "item").at(-2);
        const parentMarker = parent && listMarker(source, parent);
        const next =
          parent && parentMarker
            ? parentMarker.prefix +
              parentMarker.marker.replace(/\d+/, (n) => String(Number(n) + 1)) +
              (parentMarker.task ? "[ ] " : "")
            : prefix;
        return exitEmptyBlockLine(
          source,
          line.from,
          line.to,
          next,
          !!parentMarker,
        );
      }
      const next = soft
        ? " ".repeat(marker.marker.length)
        : marker.marker.replace(/\d+/, (n) => String(Number(n) + 1)) +
          (marker.task ? "[ ] " : "");
      return replacement(selection, (soft ? "  \n" : "\n") + prefix + next);
    }
  }
  const prefix =
    /^(\s*)((?:>\s*)*)((?:(?:[-+*]|\d+[.)])\s+)?)(\[[ xX]\]\s+)?(.*)$/.exec(
      line.text,
    );
  if (options.continuation && prefix && (prefix[2] || prefix[3])) {
    if (!soft && !prefix[5].trim()) {
      // An empty nested item outdents one level before leaving the list.
      let next = prefix[3]
        ? prefix[1] + prefix[2]
        : (prefix[1] + prefix[2]).replace(/>\s*$/, "");
      if (prefix[3] && prefix[1].length)
        next =
          prefix[1].slice(
            0,
            Math.max(0, prefix[1].length - options.indentSize),
          ) +
          prefix[2] +
          prefix[3] +
          (prefix[4] ? "[ ] " : "");
      return exitEmptyBlockLine(
        source,
        line.from,
        line.to,
        next,
        !!prefix[3] && !!prefix[1].length,
      );
    }
    const marker = soft
      ? " ".repeat((prefix[3] ?? "").length + (prefix[4] ?? "").length)
      : (prefix[3] ?? "").replace(/\d+/, (n) => String(Number(n) + 1)) +
        (prefix[4] ? "[ ] " : "");
    return replacement(
      selection,
      (soft ? "  \n" : "\n") + prefix[1] + prefix[2] + marker,
    );
  }
  if (soft) return replacement(selection, "  \n");
  // A completed pipe header creates a real table, without a modal picker.
  if (
    from === line.to &&
    /^\s*\|.+\|\s*$/.test(line.text) &&
    !nodeAt(source, from, ["table"])
  ) {
    const columns = line.text
      .trim()
      .slice(1, -1)
      .split(/(?<!\\)\|/).length;
    const insert =
      "\n| " +
      Array(columns).fill("---").join(" | ") +
      " |\n| " +
      Array(columns).fill("").join(" | ") +
      " |\n\n";
    const offset = insert.indexOf("\n", 1) + 3;
    return {
      changes: [{ from, to, insert }],
      selection: { anchor: from + offset },
    };
  }
  return replacement(selection, "\n\n");
}

function listPath(source: string, item: MarkdownNode) {
  return blockPath(source, item);
}

export function indentList(
  source: string,
  selection: SourceSelection,
  outdent: boolean,
  size: number,
): SourceEdit | null {
  const scoped = footnoteCommand(source, selection, (body, at) =>
    indentList(body, at, outdent, size),
  );
  if (scoped !== undefined) return scoped;
  const { from, to } = selectionRange(selection);
  const item = nodeAt(source, from, ["item"]);
  if (!item) return null;
  const first = lineAt(source, item.from).from;
  const path = listPath(source, item);
  const parent = path.filter((node) => node.type === "item").at(-2);
  if (outdent && !parent) return { changes: [], selection };
  const siblings = path.at(-2)?.children ?? [];
  const previous = siblings[siblings.indexOf(item) - 1];
  const marker = listMarker(source, item);
  const parentPrefix = parent
    ? (listMarker(source, parent)?.prefix.length ?? 0)
    : 0;
  const quoteEnd =
    marker?.prefix.lastIndexOf(">") !== undefined
      ? marker.prefix.lastIndexOf(">") + 1
      : 0;
  const offset = Math.max(quoteEnd, parentPrefix);
  if (outdent && parent)
    size = (marker?.prefix.length ?? item.from - first) - parentPrefix;
  if (!outdent) {
    // A first item has no preceding sibling to own it. Do not accidentally
    // turn a four-space-indented first item into a code block.
    if (!previous) return { changes: [], selection };
    const markerWidth = listMarker(source, previous)?.marker.length ?? 2;
    size = Math.max(size, markerWidth);
  }
  const end = from === to ? item.to : lineAt(source, Math.max(from, to - 1)).to;
  const changes: TextChange[] = [];
  if (!outdent && marker && /^\d/.test(marker.marker)) {
    const digits = /^\d+/.exec(marker.marker)![0];
    if (digits !== "1")
      changes.push({
        from: marker.from,
        to: marker.from + digits.length,
        insert: "1",
      });
  }
  for (let at = first; at < end;) {
    const line = lineAt(source, at);
    if (outdent) {
      const count = Math.min(
        size,
        /^[ \t]*/.exec(line.text.slice(offset))![0].length,
      );
      if (count)
        changes.push({
          from: at + offset,
          to: at + offset + count,
          insert: "",
        });
    } else
      changes.push({
        from: at + offset,
        to: at + offset,
        insert: " ".repeat(size),
      });
    at = line.to + 1;
  }
  return {
    changes: changes.sort((a, b) => a.from - b.from || a.to - b.to),
    selection: {
      anchor: mapPosition(selection.anchor, changes),
      head: mapPosition(selection.head, changes),
    },
  };
}

/** Line operations inside code never include opening/closing fences. */
export function codeLineEdit(
  source: string,
  selection: SourceSelection,
  command: "duplicate" | "moveUp" | "moveDown",
): SourceEdit | null {
  const node = nodeAt(source, selection.head, ["codeBlock"]);
  if (!node || node.contentFrom === undefined || node.contentTo === undefined)
    return null;
  const bodyEnd = /^(?:`{3,}|~{3,})/.test(source.slice(node.contentTo, node.to))
    ? lineAt(source, node.contentTo).from
    : node.contentTo;
  const { from, to } = selectionRange(selection);
  const first = lineAt(source, from),
    last = lineAt(source, to > from ? to - 1 : to);
  if (first.from < node.contentFrom || last.to >= bodyEnd) return null;
  if (command === "duplicate") {
    const at = Math.min(bodyEnd, last.to + 1),
      value = source.slice(first.from, last.to + 1);
    return {
      changes: [{ from: at, to: at, insert: value }],
      selection: {
        anchor: selection.anchor + value.length,
        head: selection.head + value.length,
      },
    };
  }
  if (command === "moveUp") {
    if (first.from <= node.contentFrom) return null;
    const previous = lineAt(source, first.from - 1),
      value = source.slice(first.from, last.to + 1);
    return {
      changes: [
        {
          from: previous.from,
          to: last.to + 1,
          insert: value + source.slice(previous.from, first.from),
        },
      ],
      selection: {
        anchor: selection.anchor - (first.from - previous.from),
        head: selection.head - (first.from - previous.from),
      },
    };
  }
  if (last.to + 1 >= bodyEnd) return null;
  const next = lineAt(source, last.to + 1),
    value = source.slice(next.from, next.to + 1);
  return {
    changes: [
      {
        from: first.from,
        to: next.to + 1,
        insert: value + source.slice(first.from, last.to + 1),
      },
    ],
    selection: {
      anchor: selection.anchor + value.length,
      head: selection.head + value.length,
    },
  };
}
