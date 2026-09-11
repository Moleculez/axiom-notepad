import { nodeAt, type SourceEdit, type TextChange } from "@axiom/markdown";
import { lineAt, selectionRange, type SourceSelection } from "./transactions";
import type { NativeBinding } from "./binding";

type Pair = {
  bookmark: ReturnType<NativeBinding["relative"]>;
  open: number;
  close: number;
  left: string;
  right: string;
};

/** Only this view's still-valid generated characters may be consumed. Imported
 * text, another researcher's closer, and undo-restored text are never owned. */
export class OwnedPairs {
  private pairs: Pair[] = [];
  constructor(private binding: NativeBinding) {}
  add(open: number, close: number, left: string, right: string) {
    this.pairs.push({
      bookmark: this.binding.relative({ anchor: open, head: close }),
      open,
      close,
      left,
      right,
    });
    if (this.pairs.length > 256) this.pairs.shift();
  }
  beforeChange(changes: TextChange[], remote = false) {
    this.pairs = this.pairs.filter(
      (pair) =>
        !changes.some(
          (change) =>
            (change.from <= pair.open && change.to > pair.open) ||
            (change.from <= pair.close && change.to > pair.close) ||
            (remote && change.from <= pair.close && change.to >= pair.open),
        ),
    );
  }
  rebase() {
    const source = this.binding.source;
    this.pairs = this.pairs.filter((pair) => {
      const range = this.binding.absolute(pair.bookmark);
      if (
        !range ||
        range.anchor >= range.head ||
        source[range.anchor] !== pair.left ||
        source[range.head] !== pair.right
      )
        return false;
      pair.open = range.anchor;
      pair.close = range.head;
      return true;
    });
  }
  closer(position: number, value: string, adjacent = false) {
    this.rebase();
    return this.pairs.find(
      (pair) =>
        pair.close === position &&
        pair.right === value &&
        (!adjacent || pair.open === position - 1),
    );
  }
  consume(position: number, value: string) {
    const pair = this.closer(position, value);
    if (!pair) return false;
    this.pairs = this.pairs.filter((candidate) => candidate !== pair);
    return true;
  }
}

/** Only pairs created by this view can be skipped/deleted. Imported Markdown
 * and another author's closing delimiters are ordinary editable characters. */
export function pairedInput(
  source: string,
  selection: SourceSelection,
  value: string,
  owned: OwnedPairs,
): {
  edit?: SourceEdit;
  skip?: number;
  pair?: { open: number; close: number; left: string; right: string };
} | null {
  const { from, to } = selectionRange(selection);
  if (
    value.length !== 1 ||
    (/\\+$/.exec(source.slice(0, from))?.[0].length ?? 0) % 2
  )
    return null;
  const line = lineAt(source, from);
  // A third backtick starts a fence, not another inline-code pair.
  if (
    value === "`" &&
    from === to &&
    from === line.to &&
    /^[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?``$/.test(line.text)
  )
    return null;
  const pairs: Record<string, string> = {
    "(": ")",
    "[": "]",
    "{": "}",
    '"': '"',
    "'": "'",
    "`": "`",
    $: "$",
  };
  const before = source[from - 1] ?? "",
    after = source[to] ?? "";
  if (from === to && after === value && owned.consume(from, value))
    return { skip: from + 1 };
  if (
    !pairs[value] ||
    (from === to && /[\p{L}\p{N}]/u.test(before) && /['"`$]/.test(value)) ||
    (after && !/[\s)\]}.,;:]/.test(after))
  )
    return null;
  if (/[`$]/.test(value)) {
    const literal = nodeAt(source, from, [
      "codeBlock",
      "mathBlock",
      "code",
      "mathInline",
    ]);
    if (literal && from >= (literal.contentFrom ?? literal.from + 1))
      return null;
  }
  return {
    edit: {
      changes: [
        { from, to, insert: value + source.slice(from, to) + pairs[value] },
      ],
      selection: { anchor: from + 1, head: to + 1 },
    },
    pair: { open: from, close: to + 1, left: value, right: pairs[value] },
  };
}
