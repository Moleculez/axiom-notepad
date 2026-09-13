import { parseMarkdown } from "./parser";
import { parsedForCommands } from "./engine";
import type { MarkdownNode, TextChange } from "./types";
import { quotedEquationEdit } from "./containers";
import { paragraphBesideBlock } from "./block-boundaries";
import {
  footnoteCommand,
  footnoteDefinitionAt,
  footnoteBody,
  footnoteAt,
} from "./footnotes";

export type SourceEdit = {
  changes: TextChange[];
  selection: { anchor: number; head?: number };
};
export function nodeAt(
  source: string,
  position: number,
  types?: string[],
): MarkdownNode | undefined {
  let found: MarkdownNode | undefined;
  const visit = (n: MarkdownNode) => {
    if (n.from <= position && position <= n.to) {
      if (!types || types.includes(n.type)) found = n;
      n.children?.forEach(visit);
    }
  };
  parsedForCommands(source).ast.children?.forEach(visit);
  parsedForCommands(source).definitions?.forEach(visit);
  return found;
}
export function minimalChange(
  before: string,
  after: string,
  offset = 0,
): TextChange {
  let start = 0,
    end = before.length,
    nextEnd = after.length;
  while (start < end && start < nextEnd && before[start] === after[start])
    start++;
  // Avoid splitting UTF-16 pairs in a CRDT insertion.
  if (start && /[\uD800-\uDBFF]/.test(before[start - 1])) start--;
  while (
    end > start &&
    nextEnd > start &&
    before[end - 1] === after[nextEnd - 1]
  ) {
    end--;
    nextEnd--;
  }
  if (end < before.length && /[\uDC00-\uDFFF]/.test(before[end])) {
    end++;
    nextEnd++;
  }
  return {
    from: offset + start,
    to: offset + end,
    insert: after.slice(start, nextEnd),
  };
}
export function sourceCommand(
  id: string,
  source: string,
  from: number,
  to: number,
  options: {
    language?: string;
    rows?: number;
    columns?: number;
    indent?: number;
    value?: string;
  } = {},
): SourceEdit | null {
  if (id === "metadata") {
    const existing = parsedForCommands(source).ast.children?.find(
      (node) => node.type === "frontmatter",
    );
    if (existing) return { changes: [], selection: { anchor: existing.from } };
    const ending = source.includes("\r\n") ? "\r\n" : "\n";
    const insert = ["---", "title: Untitled", "tags: []", "---", "", ""].join(
      ending,
    );
    const query = /^\/[^\r\n]*$/.test(source.slice(from, to));
    return {
      changes: [
        { from: 0, to: query && from === 0 ? to : 0, insert },
        ...(query && from > 0 ? [{ from, to, insert: "" }] : []),
      ],
      selection: { anchor: 3 + ending.length + 7 },
    };
  }
  if (id !== "footnote") {
    const scoped = footnoteCommand(
      source,
      { anchor: from, head: to },
      (body, at) => sourceCommand(id, body, at.anchor, at.head, options),
    );
    if (scoped !== undefined) return scoped;
  }
  const selected = source.slice(from, to);
  if (id === "mathBlock") {
    const quoted = quotedEquationEdit(source, from, to);
    if (quoted !== undefined) return quoted;
  }
  const result = (
    change: TextChange,
    anchor = change.from + change.insert.length,
    head?: number,
  ): SourceEdit => ({
    changes: [change],
    selection: { anchor, ...(head === undefined ? {} : { head }) },
  });
  const wrappers: Record<string, string> = {
    bold: "**",
    italic: "*",
    strike: "~~",
    highlight: "==",
    inlineCode: "`",
    inlineMath: "$",
  };
  if (wrappers[id]) {
    let wrap = wrappers[id];
    if (id === "inlineCode" && selected.includes("`"))
      wrap = "`".repeat(
        Math.max(...Array.from(selected.matchAll(/`+/g), (m) => m[0].length)) +
          1,
      );
    if (
      source.slice(Math.max(0, from - wrap.length), from) === wrap &&
      source.slice(to, to + wrap.length) === wrap
    )
      return result(
        { from: from - wrap.length, to: to + wrap.length, insert: selected },
        from - wrap.length,
        to - wrap.length,
      );
    if (
      selected.length >= wrap.length * 2 &&
      selected.startsWith(wrap) &&
      selected.endsWith(wrap)
    )
      return result(
        { from, to, insert: selected.slice(wrap.length, -wrap.length) },
        from,
        to - 2 * wrap.length,
      );
    return result(
      { from, to, insert: wrap + selected + wrap },
      from + wrap.length,
      to + wrap.length,
    );
  }
  const start = from === 0 ? 0 : source.lastIndexOf("\n", from - 1) + 1;
  const endIndex = source.indexOf(
    "\n",
    to > from && source[to - 1] === "\n" ? to - 1 : to,
  );
  const end = endIndex < 0 ? source.length : endIndex;
  const lines = source.slice(start, end).split("\n");
  if (/^heading[1-6]$/.test(id) || id === "paragraph") {
    const prefix =
      id === "paragraph" ? "" : "#".repeat(Number(id.slice(-1))) + " ";
    const insert = lines
      .map((line) =>
        line.replace(/^(\s*(?:>\s*)*)(?:#{1,6}\s+)?/, "$1" + prefix),
      )
      .join("\n");
    return result({ from: start, to: end, insert }, start + insert.length);
  }
  if (["quote", "bullet", "ordered", "task"].includes(id)) {
    const prefix = {
      quote: "> ",
      bullet: "- ",
      ordered: "1. ",
      task: "- [ ] ",
    }[id]!;
    const test = {
      quote: /^> ?/,
      bullet: /^[-+*] (?!\[)/,
      ordered: /^\d+[.)] /,
      task: /^[-+*] \[[ xX]\] /,
    }[id]!;
    const all = lines.every((line) => test.test(line));
    const insert = lines
      .map((line, i) =>
        all
          ? line.replace(test, "")
          : (id === "ordered" ? `${i + 1}. ` : prefix) +
            line.replace(
              id === "quote" ? /$^/ : /^(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/,
              "",
            ),
      )
      .join("\n");
    return result({ from: start, to: end, insert }, start + insert.length);
  }
  if (id === "toggleTask") {
    const insert = lines
      .map((line) =>
        line.replace(
          /^(\s*(?:>\s*)*[-+*]\s+)\[([ xX])\]/,
          (_m, p, checked) => p + (checked === " " ? "[x]" : "[ ]"),
        ),
      )
      .join("\n");
    return result({ from: start, to: end, insert }, from, to);
  }
  if (id === "indent" || id === "outdent") {
    const size = options.indent ?? 4;
    const insert = lines
      .map((line) =>
        id === "indent"
          ? " ".repeat(size) + line
          : line.replace(new RegExp(`^(?: {1,${size}}|\\t)`), ""),
      )
      .join("\n");
    return result(
      { from: start, to: end, insert },
      start,
      start + insert.length,
    );
  }
  if (id === "link") {
    const link = nodeAt(source, from, ["link"]);
    if (link && from === to) {
      const raw = source.slice(link.from, link.to),
        at = raw.indexOf("](");
      if (at >= 0)
        return {
          changes: [],
          selection: { anchor: link.from + at + 2, head: link.to - 1 },
        };
    }
    const insert = `[${selected}](https://)`;
    return result(
      { from, to, insert },
      selected ? from + selected.length + 3 : from + 1,
      selected ? from + insert.length - 1 : from + 1,
    );
  }
  if (["citation", "noteLink", "equationRef"].includes(id)) {
    const [left, right] = {
      citation: ["[@", "]"],
      noteLink: ["[[", "]]"],
      equationRef: ["\\eqref{", "}"],
    }[id]!;
    return result(
      { from, to, insert: left + selected + right },
      from + left.length,
      to + left.length,
    );
  }
  if (id === "footnote") {
    let i = 1;
    while (source.includes(`[^note${i}]`)) i++;
    const ref = `[^note${i}]`,
      tail = `\n\n${ref}: ${selected}`;
    if (to === source.length)
      return result(
        { from, to, insert: ref + tail },
        from + ref.length + tail.length,
      );
    return {
      changes: [
        { from, to, insert: ref },
        { from: source.length, to: source.length, insert: tail },
      ],
      selection: {
        anchor: source.length - selected.length + ref.length + tail.length,
      },
    };
  }
  const blocks = parseMarkdown(source).ast.children ?? [];
  const index = blocks.findIndex((n) => from >= n.from && from < n.to),
    block = blocks[index];
  if (id === "duplicate") {
    const a = from === to ? (block?.from ?? start) : from,
      b = from === to ? (block?.to ?? end) : to;
    const value = source.slice(a, b),
      insert =
        from === to ? (value.endsWith("\n") ? "\n" : "\n\n") + value : value;
    return result({ from: b, to: b, insert }, b, b + insert.length);
  }
  if (id === "moveUp" || id === "moveDown") {
    const other = blocks[index + (id === "moveUp" ? -1 : 1)];
    if (!block || !other) return null;
    const first = id === "moveUp" ? other : block,
      last = id === "moveUp" ? block : other;
    const firstText = source.slice(first.from, first.to),
      lastText = source.slice(last.from, last.to),
      gap = source.slice(first.to, last.from);
    const insert = lastText.replace(/\n?$/, "\n") + (gap || "\n") + firstText;
    return result(
      { from: first.from, to: last.to, insert },
      id === "moveUp"
        ? first.from
        : first.from +
            lastText.replace(/\n?$/, "\n").length +
            (gap || "\n").length,
    );
  }
  if (id === "finishBlock" || id === "paragraphBefore") {
    const n = nodeAt(source, from, [
      "codeBlock",
      "mathBlock",
      "table",
      "blockquote",
      "callout",
      "list",
      "toc",
      "frontmatter",
    ]);
    if (n) return paragraphBesideBlock(source, n, id === "paragraphBefore");
    const at =
      id === "paragraphBefore"
        ? start === 0
          ? 0
          : source.lastIndexOf("\n", start - 1) + 1
        : end;
    const insert = (source[at - 1] === "\n" ? "" : "\n") + "\n";
    return result(
      { from: at, to: at, insert },
      id === "paragraphBefore" ? at : at + insert.length,
    );
  }
  let content: string | undefined,
    caret = 0;
  if (id === "codeBlock" || id === "diagram") {
    const language =
      id === "diagram" ? "mermaid" : (options.language ?? "python");
    const fence = "`".repeat(
      Math.max(
        3,
        ...Array.from(selected.matchAll(/`+/g), (m) => m[0].length + 1),
      ),
    );
    content = fence + language + "\n" + selected + "\n" + fence;
    caret = fence.length + language.length + 1;
  }
  if (id === "mathBlock") {
    content = "$$\n" + selected + "\n$$";
    caret = 3;
  }
  if (id === "divider") {
    content = "---";
    caret = 3;
  }
  if (id === "toc") {
    content = "[TOC]";
    caret = 5;
  }
  if (id === "table") {
    const cols = Math.max(1, Math.min(30, options.columns ?? 2)),
      rows = Math.max(1, Math.min(100, options.rows ?? 2));
    content = [
      Array.from({ length: cols }, (_, i) => `Column ${i + 1}`),
      Array(cols).fill("---"),
      ...Array.from({ length: rows }, () => Array(cols).fill("")),
    ]
      .map((cells) => "| " + cells.join(" | ") + " |")
      .join("\n");
    caret = 2;
  }
  if (
    [
      "theorem",
      "proof",
      "definition",
      "lemma",
      "note",
      "warning",
      "question",
    ].includes(id)
  ) {
    content = `> [!${id.toUpperCase()}]\n> ${selected}`;
    caret = content.length - selected.length;
  }
  if (content === undefined) return null;
  const before = source.slice(0, from),
    after = source.slice(to);
  const lead =
    !before || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const tail =
    !after || after.startsWith("\n\n")
      ? "\n\n"
      : after.startsWith("\n")
        ? "\n"
        : "\n\n";
  return result(
    { from, to, insert: lead + content + tail },
    from + lead.length + caret,
    from + lead.length + caret + selected.length,
  );
}

export type TableCell = {
  missing?: boolean;
  from: number;
  to: number;
  raw: string;
  fieldFrom: number;
  fieldTo: number;
};
export type TableRow = {
  from: number;
  to: number;
  prefix: string;
  cells: TableCell[];
};
export type TableModel = {
  from: number;
  to: number;
  rows: TableRow[];
  separator: TableRow;
  columns: number;
  align: string[];
};
export function tableRow(source: string, from: number, to: number): TableRow {
  const physical = from === 0 ? 0 : source.lastIndexOf("\n", from - 1) + 1;
  const prefix = source.slice(physical, from);
  let end = to;
  while (end > from && /[\r\n]/.test(source[end - 1])) end--;
  let a = from;
  while (a < end && /[ \t]/.test(source[a])) a++;
  if (source[a] === "|") a++;
  let b = end;
  while (b > a && /[ \t]/.test(source[b - 1])) b--;
  if (source[b - 1] === "|" && source[b - 2] !== "\\") b--;
  const cells: TableCell[] = [];
  const push = (left: number, right: number) => {
    const fieldFrom = left,
      fieldTo = right;
    while (left < right && /[ \t]/.test(source[left])) left++;
    while (right > left && /[ \t]/.test(source[right - 1])) right--;
    // An empty padded field has an insertion point between its two margins.
    if (left === right)
      left = right = fieldFrom + Math.ceil((fieldTo - fieldFrom) / 2);
    cells.push({
      from: left,
      to: right,
      raw: source.slice(left, right),
      fieldFrom,
      fieldTo,
    });
  };
  let start = a;
  for (let i = a; i < b; i++) {
    if (source[i] === "\\" && source[i + 1] === "|") {
      i++;
      continue;
    }
    if (source[i] === "|") {
      push(start, i);
      start = i + 1;
    }
  }
  push(start, b);
  return { from: physical, to, prefix, cells };
}
export function tableModel(
  source: string,
  node: MarkdownNode,
): TableModel | null {
  if (node.type !== "table" || !node.children?.length) return null;
  const rows = node.children.map((n) => tableRow(source, n.from, n.to));
  const columns = node.align?.length ?? rows[0].cells.length;
  rows.forEach((row, index) => {
    while (row.cells.length < columns) {
      const from =
        node.children![index].children?.[row.cells.length]?.from ??
        row.to - (source[row.to - 1] === "\n" ? 1 : 0);
      row.cells.push({
        from,
        to: from,
        fieldFrom: from,
        fieldTo: from,
        raw: "",
        missing: true,
      });
    }
  });
  const sepFrom = node.children[0].to;
  const sepEnd = source.indexOf("\n", sepFrom);
  const footnote = footnoteDefinitionAt(source, node.from);
  const separatorPrefix = footnote
    ? (footnoteBody(source, footnote).lines.find(
        (line) => line.from === sepFrom,
      )?.prefix.length ?? rows[0].prefix.length)
    : rows[0].prefix.length;
  const separator = tableRow(
    source,
    sepFrom + separatorPrefix,
    sepEnd < 0 ? source.length : sepEnd + 1,
  );
  return {
    from: rows[0].from,
    to: node.to,
    rows,
    separator,
    columns,
    align: node.align ?? [],
  };
}
export function escapeCell(value: string) {
  return value.replace(/\r\n?|\n/g, "<br>").replace(/(?<!\\)\|/g, "\\|");
}
function tableLineEnding(source: string, row: TableRow) {
  return source[row.to - 1] === "\n"
    ? source[row.to - 2] === "\r"
      ? "\r\n"
      : "\n"
    : "";
}
function tableEol(source: string, model: TableModel, row: TableRow) {
  return (
    tableLineEnding(source, row) ||
    tableLineEnding(source, model.separator) ||
    tableLineEnding(source, model.rows[0]) ||
    "\n"
  );
}
export function moveTableAxis(
  model: TableModel,
  source: string,
  axis: "row" | "column",
  from: number,
  to: number,
): TextChange[] {
  if (
    from === to ||
    Math.min(from, to) < (axis === "row" ? 1 : 0) ||
    Math.max(from, to) >= (axis === "row" ? model.rows.length : model.columns)
  )
    return [];
  if (axis === "row") {
    const first = Math.min(from, to),
      last = Math.max(from, to),
      rows = model.rows.slice(first, last + 1);
    const moved = rows.splice(from - first, 1)[0];
    rows.splice(to - first, 0, moved);
    return [
      {
        from: model.rows[first].from,
        to: model.rows[last].to,
        insert: rows
          .map(
            (row, index) =>
              source.slice(row.from, row.to).replace(/\r?\n$/, "") +
              tableLineEnding(source, model.rows[first + index]),
          )
          .join(""),
      },
    ];
  }
  return [...model.rows, model.separator]
    .map((row) => {
      const values = Array.from(
        { length: model.columns },
        (_, column) => row.cells[column]?.raw ?? "",
      );
      const moved = values.splice(from, 1)[0];
      values.splice(to, 0, moved);
      return minimalChange(
        source.slice(row.from, row.to),
        row.prefix +
          "| " +
          values.join(" | ") +
          " |" +
          tableLineEnding(source, row),
        row.from,
      );
    })
    .sort((a, b) => a.from - b.from);
}
export function tableAction(
  model: TableModel,
  source: string,
  row: number,
  column: number,
  action: string,
  grid?: string[][],
): TextChange[] {
  const current = model.rows[row];
  if (!current) return [];
  const empty = () => Array(model.columns).fill("") as string[];
  const values = (r: TableRow) =>
    Array.from({ length: model.columns }, (_, i) => r.cells[i]?.raw ?? "");
  const eol = tableEol(source, model, current);
  const line = (
    cells: string[],
    target = current,
    ending = tableLineEnding(source, target),
  ) => target.prefix + "| " + cells.join(" | ") + " |" + ending;
  if (
    action === "rowBefore" ||
    action === "rowAfter" ||
    action === "duplicateRow"
  ) {
    if (model.rows.length >= 1000)
      throw new Error("Tables support up to 1,000 rows.");
    const at =
      row === 0
        ? model.separator.to
        : action === "rowBefore"
          ? current.from
          : current.to;
    return [
      {
        from: at,
        to: at,
        insert:
          (at > 0 && source[at - 1] !== "\n" ? eol : "") +
          line(
            action === "duplicateRow" ? values(current) : empty(),
            row === 0 ? model.separator : current,
            at === source.length && source[at - 1] !== "\n" ? "" : eol,
          ),
      },
    ];
  }
  if (action === "deleteRow")
    return row === 0
      ? []
      : [{ from: current.from, to: current.to, insert: "" }];
  if (action === "rowUp" || action === "rowDown") {
    const target = row + (action === "rowUp" ? -1 : 1);
    if (row === 0 || target < 1 || target >= model.rows.length) return [];
    return moveTableAxis(model, source, "row", row, target);
  }
  if (action.startsWith("align")) {
    const cell = model.separator.cells[column];
    if (!cell) return [];
    const alignment = {
      alignDefault: "---",
      alignLeft: ":---",
      alignCenter: ":---:",
      alignRight: "---:",
    }[action];
    return alignment
      ? [{ from: cell.from, to: cell.to, insert: alignment }]
      : [];
  }
  if (action === "paste" && grid) {
    const width = Math.max(
      model.columns,
      column + Math.max(...grid.map((r) => r.length)),
    );
    const count = Math.max(model.rows.length, row + grid.length);
    if (width > 100 || count > 1000)
      throw new Error("Paste up to 100 columns and 1,000 rows at a time.");
    const edits: TextChange[] = [];
    const added: string[] = [];
    for (let r = 0; r < count; r++) {
      if (width === model.columns && (r < row || r >= row + grid.length))
        continue;
      const old = model.rows[r],
        v = old ? values(old) : empty();
      while (v.length < width) v.push("");
      if (grid[r - row])
        for (let c = 0; c < grid[r - row].length; c++)
          v[column + c] = escapeCell(grid[r - row][c]);
      if (old)
        edits.push(
          minimalChange(source.slice(old.from, old.to), line(v, old), old.from),
        );
      else
        added.push(
          line(
            v,
            row === 0 ? model.separator : current,
            r === count - 1 &&
              model.to === source.length &&
              source[model.to - 1] !== "\n"
              ? ""
              : eol,
          ),
        );
    }
    if (added.length)
      edits.push({
        from: model.to,
        to: model.to,
        insert: (source[model.to - 1] !== "\n" ? eol : "") + added.join(""),
      });
    if (width > model.columns) {
      const sep = values(model.separator);
      while (sep.length < width) sep.push("---");
      edits.push(
        minimalChange(
          source.slice(model.separator.from, model.separator.to),
          line(sep, model.separator),
          model.separator.from,
        ),
      );
    }
    return edits.sort((a, b) => a.from - b.from);
  }
  const target = column + (action === "columnLeft" ? -1 : 1);
  if (
    (action === "deleteColumn" && model.columns <= 1) ||
    ((action === "columnLeft" || action === "columnRight") &&
      (target < 0 || target >= model.columns))
  )
    return [];
  if (
    ![
      "columnBefore",
      "columnAfter",
      "deleteColumn",
      "columnLeft",
      "columnRight",
      "duplicateColumn",
    ].includes(action)
  )
    return [];
  if (
    ["columnBefore", "columnAfter", "duplicateColumn"].includes(action) &&
    model.columns >= 100
  )
    throw new Error("Tables support up to 100 columns.");
  return [...model.rows, model.separator]
    .map((r) => {
      const v = values(r);
      if (action === "deleteColumn") v.splice(column, 1);
      else if (action === "duplicateColumn") v.splice(column + 1, 0, v[column]);
      else if (action === "columnBefore" || action === "columnAfter")
        v.splice(
          column + (action === "columnAfter" ? 1 : 0),
          0,
          r === model.separator ? "---" : "",
        );
      else [v[column], v[target]] = [v[target], v[column]];
      return minimalChange(source.slice(r.from, r.to), line(v, r), r.from);
    })
    .sort((a, b) => a.from - b.from);
}

/** A slash query must occupy a new, empty paragraph, not a scientific expression. */
export function slashQuery(
  source: string,
  position: number,
): { from: number; to: number; query: string; prefix: string } | null {
  const footnote = footnoteAt(source, position);
  if (footnote) {
    const query = slashQuery(footnote.text, footnote.bodyAt(position));
    return (
      query && {
        ...query,
        from: footnote.sourceAt(query.from),
        to: footnote.sourceAt(query.to),
        prefix: footnote.prefix + query.prefix,
      }
    );
  }
  const start = position === 0 ? 0 : source.lastIndexOf("\n", position - 1) + 1;
  const end = source.indexOf("\n", position);
  if (source.slice(position, end < 0 ? source.length : end).trim()) return null;
  const text = source.slice(start, position),
    match =
      /^(\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?)\/([\w -]*)$/.exec(
        text,
      );
  if (!match || /^ {4}|\t/.test(match[1])) return null;
  if (
    nodeAt(source, position, [
      "codeBlock",
      "mathBlock",
      "mathInline",
      "code",
      "table",
      "link",
    ])
  )
    return null;
  return {
    from: start + match[1].length,
    to: position,
    query: match[2],
    prefix: match[1],
  };
}
