import * as Y from "yjs";
import { NativeBinding, type PeerSelection } from "@axiom/editor/binding";
import {
  applyChanges,
  mapPosition,
  type NativeTransaction,
} from "@axiom/editor/transactions";
import {
  captureHunks,
  resolveHunks,
  applyHunks,
} from "@axiom/shared/suggestion-hunks";
import { diffChanges } from "@axiom/shared/version-diff";
import type { SuggestionHunk } from "@axiom/shared/revisions";

/** An unsynchronized editing projection. It NEVER writes to accepted.doc.
 * Every native editor transaction (including embedded blocks and undo) lands in
 * this independent Y.Doc, with proposals anchored to accepted CRDT identities.
 */
export class SuggestionProjection extends NativeBinding {
  hunks: SuggestionHunk[] = [];
  conflict = "";
  private mirroring = false;
  private disposed = false;
  private stopAccepted: () => void;
  private stopProjection: () => void;
  constructor(
    readonly accepted: NativeBinding,
    private updated: () => void,
    initial?: { hunks: SuggestionHunk[]; source: string },
  ) {
    const doc = new Y.Doc(),
      text = doc.getText("markdown");
    let source = accepted.source,
      conflict = "";
    if (initial) {
      try {
        source = applyChanges(
          source,
          resolveHunks(accepted.doc, initial.hunks),
        );
      } catch (e) {
        source = initial.source;
        conflict = (e as Error).message;
      }
    }
    text.insert(0, source);
    super(doc, new Y.UndoManager(text), null);
    this.hunks = initial?.hunks ?? [];
    this.conflict = conflict;
    this.stopProjection = this.subscribe(
      (_source, _selection, _local, changes) => {
        if (!changes.length || this.mirroring || this.conflict) return;
        this.hunks = captureHunks(
          accepted.doc,
          diffChanges(accepted.source, this.source),
        );
        updated();
      },
    );
    this.stopAccepted = accepted.subscribe(
      (_source, _selection, _local, changes) => {
        if (!changes.length || this.conflict) return;
        try {
          const source = applyChanges(
            accepted.source,
            resolveHunks(accepted.doc, this.hunks),
          );
          this.mirroring = true;
          applyHunks(
            this.doc,
            diffChanges(this.source, source),
            "accepted-update",
          );
        } catch (e) {
          // Preserve the entire local proposal, without finding a similar string
          // elsewhere or silently converting a peer's edit into this proposal.
          this.conflict = (e as Error).message;
        } finally {
          this.mirroring = false;
          updated();
        }
      },
    );
  }
  override transact(transaction: NativeTransaction) {
    if (!this.conflict) super.transact(transaction);
  }
  override history(redo: boolean) {
    if (!this.conflict) super.history(redo);
  }
  override onPresence(listener: (peers: PeerSelection[]) => void) {
    return this.accepted.onPresence((peers) => {
      let changes: ReturnType<typeof diffChanges> = [];
      try {
        changes = resolveHunks(this.accepted.doc, this.hunks);
      } catch {
        /* No invented peer position after a conflict. */
      }
      listener(
        peers.map((p) => ({
          ...p,
          selection:
            p.selection && !this.conflict
              ? {
                  anchor: mapPosition(p.selection.anchor, changes),
                  head: mapPosition(p.selection.head, changes),
                }
              : null,
        })),
      );
    });
  }
  override destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAccepted();
    this.stopProjection();
    super.destroy();
    this.undo.destroy();
    this.doc.destroy();
  }
}
