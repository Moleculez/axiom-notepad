import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import type { TextChange } from "@axiom/markdown";
import {
  clampSelection,
  orderedChanges,
  type NativeTransaction,
  type SourceSelection,
} from "./transactions";

export type PeerSelection = {
  clientId: number;
  id: string;
  name: string;
  color: string;
  selection: SourceSelection | null;
};
type Bookmark = { anchor: Y.RelativePosition; head: Y.RelativePosition };

/** Own Y.Text adapter. It has no DOM-focus assumptions and no editor dependencies. */
export class NativeBinding {
  readonly origin = { editor: "axiom-native" };
  readonly text: Y.Text;
  private bookmark: Bookmark;
  private listeners = new Set<
    (
      source: string,
      selection: SourceSelection,
      local: boolean,
      changes: TextChange[],
    ) => void
  >();
  private selectionListeners = new Set<(peers: PeerSelection[]) => void>();
  private applying: SourceSelection | null = null;
  private destroyed = false;
  private previousSelection: SourceSelection = { anchor: 0, head: 0 };
  private previousKind: NativeTransaction["kind"] | null = null;
  private beforeBookmark: Bookmark | null = null;
  constructor(
    readonly doc: Y.Doc,
    readonly undo: Y.UndoManager,
    readonly awareness: Awareness | null,
    text: Y.Text = doc.getText("markdown"),
  ) {
    if (text.doc !== doc)
      throw new Error(
        "The editor text must belong to its collaborative document.",
      );
    this.text = text;
    this.bookmark = this.relative({ anchor: 0, head: 0 });
    // Null-origin state loads and remote updates are never this author's edits.
    undo.removeTrackedOrigin(null);
    undo.addTrackedOrigin(this.origin);
    this.text.observe(this.changed);
    awareness?.on("change", this.presenceChanged);
    undo.on("stack-item-added", this.stackAdded);
    undo.on("stack-item-popped", this.stackPopped);
  }
  get source() {
    return this.text.toString();
  }
  relative(selection: SourceSelection): Bookmark {
    const s = clampSelection(selection, this.text.length);
    return {
      anchor: Y.createRelativePositionFromTypeIndex(this.text, s.anchor),
      head: Y.createRelativePositionFromTypeIndex(this.text, s.head),
    };
  }
  absolute(bookmark: Bookmark): SourceSelection | null {
    const a = Y.createAbsolutePositionFromRelativePosition(
        bookmark.anchor,
        this.doc,
      ),
      b = Y.createAbsolutePositionFromRelativePosition(bookmark.head, this.doc);
    return a?.type === this.text && b?.type === this.text
      ? { anchor: a.index, head: b.index }
      : null;
  }
  selection() {
    return this.absolute(this.bookmark) ?? { anchor: 0, head: 0 };
  }
  select(selection: SourceSelection, publish = true) {
    this.bookmark = this.relative(selection);
    if (publish) this.awareness?.setLocalStateField("cursor", this.bookmark);
  }
  blur() {
    this.awareness?.setLocalStateField("cursor", null);
  }
  subscribe(
    listener: (
      source: string,
      selection: SourceSelection,
      local: boolean,
      changes: TextChange[],
    ) => void,
  ) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  onPresence(listener: (peers: PeerSelection[]) => void) {
    this.selectionListeners.add(listener);
    listener(this.peers());
    return () => {
      this.selectionListeners.delete(listener);
    };
  }
  peers(): PeerSelection[] {
    const peers: PeerSelection[] = [];
    this.awareness?.getStates().forEach((s, clientId) => {
      if (clientId === this.doc.clientID || typeof s.user?.id !== "string")
        return;
      let selection: SourceSelection | null = null;
      try {
        if (s.cursor?.anchor && s.cursor?.head)
          selection = this.absolute(s.cursor);
      } catch {
        /* Invalid ephemeral peer data is ignored. */
      }
      peers.push({
        clientId,
        id: s.user.id,
        name: String(s.user.name ?? "Researcher").slice(0, 120),
        color: /^#[\da-f]{6}$/i.test(s.user.color) ? s.user.color : "#64748b",
        selection,
      });
    });
    return peers;
  }
  transact(transaction: NativeTransaction) {
    if (this.destroyed) return;
    const changes = orderedChanges(transaction.changes, this.text.length);
    if (!changes.length) {
      if (transaction.selection) this.select(transaction.selection);
      return;
    }
    this.previousSelection = this.selection();
    this.beforeBookmark = this.relative(this.previousSelection);
    if (transaction.kind !== this.previousKind) this.undo.stopCapturing();
    this.previousKind = transaction.kind;
    if (transaction.kind !== "typing" && transaction.kind !== "delete")
      this.undo.stopCapturing();
    this.applying = transaction.selection ?? null;
    try {
      this.doc.transact(() => {
        // Reverse order preserves all original-source coordinates, including equal-offset insertions.
        for (const c of [...changes].reverse()) {
          if (c.to > c.from) this.text.delete(c.from, c.to - c.from);
          if (c.insert) this.text.insert(c.from, c.insert);
        }
      }, this.origin);
    } finally {
      // A subscriber failure must not leave the next remote update using an
      // old local selection or merging into the previous composition undo item.
      this.applying = null;
      if (transaction.kind !== "typing" && transaction.kind !== "delete")
        this.undo.stopCapturing();
    }
  }
  history(redo: boolean) {
    this.undo.stopCapturing();
    // Yjs creates the opposite stack entry during undo/redo. Bookmark the
    // current caret for that entry, not the stale pre-edit selection; a
    // replacement may have inserted the very characters we are restoring.
    this.beforeBookmark = this.relative(this.selection());
    if (redo) this.undo.redo();
    else this.undo.undo();
  }
  private changed = (event: Y.YTextEvent, transaction: Y.Transaction) => {
    const local = transaction.origin === this.origin;
    const selection = clampSelection(
      this.applying ?? this.selection(),
      this.text.length,
    );
    this.select(selection, local);
    // Real Yjs deltas retain same-text replacements. A string diff would miss
    // another author's replacement of a delimiter and mistakenly keep ownership.
    const changes: TextChange[] = [];
    let at = 0;
    for (const part of event.delta) {
      if (part.retain) at += part.retain;
      if (part.delete) {
        changes.push({ from: at, to: at + part.delete, insert: "" });
        at += part.delete;
      }
      if (typeof part.insert === "string")
        changes.push({ from: at, to: at, insert: part.insert });
    }
    for (const listener of this.listeners)
      listener(this.source, selection, local, changes);
    this.presenceChanged();
  };
  private presenceChanged = () => {
    const peers = this.peers();
    for (const listener of this.selectionListeners) listener(peers);
  };
  private stackAdded = ({
    stackItem,
  }: {
    stackItem: { meta: Map<unknown, unknown> };
  }) => {
    if (!stackItem.meta.has(this.text))
      stackItem.meta.set(
        this.text,
        this.beforeBookmark ?? this.relative(this.previousSelection),
      );
  };
  private stackPopped = ({
    stackItem,
  }: {
    stackItem: { meta: Map<unknown, unknown> };
  }) => {
    const bookmark = stackItem.meta.get(this.text) as Bookmark | undefined;
    const selection = bookmark && this.absolute(bookmark);
    if (selection) {
      this.select(selection);
      for (const listener of this.listeners)
        listener(this.source, selection, true, []);
    }
  };
  destroy() {
    this.destroyed = true;
    this.blur();
    this.text.unobserve(this.changed);
    this.awareness?.off("change", this.presenceChanged);
    this.undo.off("stack-item-added", this.stackAdded);
    this.undo.off("stack-item-popped", this.stackPopped);
    this.undo.removeTrackedOrigin(this.origin);
    this.listeners.clear();
    this.selectionListeners.clear();
  }
}
