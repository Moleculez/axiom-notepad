import { nodeAt, type MarkdownNode, type TextChange } from "@axiom/markdown";
import type { NativeBinding } from "@axiom/editor/binding";
import { mapPosition } from "@axiom/editor/transactions";

/** Author-local reveal intent, not an input buffer or a second document. */
export class ImageSourceSession {
  readonly key = crypto.randomUUID();
  private bookmark: ReturnType<NativeBinding["relative"]>;
  range: { from: number; to: number };
  lastValid: MarkdownNode;
  valid = true;

  constructor(
    private binding: NativeBinding,
    node: MarkdownNode,
  ) {
    this.range = { from: node.from, to: node.to };
    this.lastValid = node;
    this.bookmark = binding.relative({ anchor: node.from, head: node.to });
  }

  /** Called with actual Yjs deltas, including same-text peer replacements. */
  changed(changes: TextChange[], local: boolean) {
    const { from, to } = this.range;
    if (
      !local &&
      changes.some((change) => change.from <= from && change.to >= to)
    )
      return false;
    // Y.Text reports a replacement as a deletion followed by an insertion at
    // its old end. Combine adjacent deltas before mapping either endpoint.
    const joined: TextChange[] = [];
    for (const change of changes) {
      const previous = joined.at(-1);
      if (previous && previous.to === change.from) {
        previous.to = change.to;
        previous.insert += change.insert;
      } else joined.push({ ...change });
    }
    const range = {
      from: mapPosition(from, joined, local ? -1 : 1),
      to: mapPosition(to, joined, local ? 1 : -1),
    };
    if (range.to <= range.from) return false;
    this.range = range;
    this.bookmark = this.binding.relative({
      anchor: range.from,
      head: range.to,
    });
    return true;
  }

  resolve(source: string) {
    const at = this.binding.absolute(this.bookmark);
    if (!at || at.head <= at.anchor) return false;
    this.range = { from: at.anchor, to: at.head };
    const image = nodeAt(source, at.anchor, ["image"]);
    this.valid = !!image && image.from === at.anchor && image.to <= at.head;
    if (this.valid) {
      this.lastValid = image!;
      // Text typed after a complete image belongs to its paragraph, not its URL.
      this.range.to = image!.to;
      this.bookmark = this.binding.relative({
        anchor: image!.from,
        head: image!.to,
      });
    }
    return true;
  }

  preview() {
    return { ...this.lastValid, ...this.range };
  }
}
