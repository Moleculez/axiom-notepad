import type { SuggestionHunk, SuggestionWrite } from "@axiom/shared/revisions";
import { api, ApiError, SIGN_OUT_PENDING } from "./client";
import { SaveCoordinator } from "./save-coordinator";
import { LatestCheckpoint } from "./latest-checkpoint";
export type ProposalDraft = {
  /** AI-generated recovery must never publish without an explicit user action. */
  manualPublish?: boolean;
  /** Retain provenance through local recovery, even after a private chat expires. */
  assistantContextId?: string;
  assistantStateVector?: string;
  id: string;
  noteId: string;
  generation: number;
  source: string;
  hunks: SuggestionHunk[];
  message: string;
  version: number;
  revision: number;
  confirmed: number;
  updatedAt: string;
  /** An uncertain request must be replayed with the SAME mutation identifier. */
  pending?: SuggestionWrite & { localRevision: number };
};
async function database(account: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("axiom:proposals:" + account, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("drafts", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Proposal recovery storage is blocked by another tab."));
  });
}
function assertAccount(account: string) {
  const session = JSON.parse(localStorage.getItem("axiom:session") ?? "null");
  if (session?.user?.id !== account || localStorage.getItem(SIGN_OUT_PENDING))
    throw new Error(
      "Proposal publishing is locked. Sign in to the original account to recover it.",
    );
}
export async function proposalDrafts(
  account: string,
  noteId: string,
): Promise<ProposalDraft[]> {
  assertAccount(account);
  const db = await database(account);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts"),
        request = tx.objectStore("drafts").getAll();
      tx.oncomplete = () =>
        resolve(
          (request.result as ProposalDraft[])
            .filter((d) => d.noteId === noteId)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        );
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function writeDraft(
  account: string,
  draft: ProposalDraft | { id: string },
  remove = false,
) {
  const db = await database(account);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite", {
        durability: "strict",
      });
      if (remove) tx.objectStore("drafts").delete(draft.id);
      else tx.objectStore("drafts").put(draft);
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(
          tx.error ?? new Error("Proposal could not be saved on this device."),
        );
    });
  } finally {
    db.close();
  }
}
export const removeProposalDraft = (account: string, id: string) =>
  writeDraft(account, { id }, true);

/** Do not let two tabs overwrite the same account-scoped recovery draft. */
export async function claimProposal(
  account: string,
  id: string,
): Promise<() => void> {
  assertAccount(account);
  if (!navigator.locks)
    throw new Error(
      "This browser cannot safely lock a proposal draft. Use a current desktop browser.",
    );
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request(
        "axiom:proposal:" + account + ":" + id,
        { ifAvailable: true },
        (lock) => {
          if (!lock) {
            reject(
              new Error(
                "This proposal is already being edited in another tab. Close that editor before reopening it here.",
              ),
            );
            return;
          }
          return new Promise<void>((release) => resolve(release));
        },
      )
      .catch(reject);
  });
}

/** Single-flight publishing, immediate account-scoped durable recovery.
 * A received acknowledgement never replaces edits typed while it was in flight.
 */
export class SuggestionOutbox {
  private local: Promise<void> = Promise.resolve();
  private checkpoints: LatestCheckpoint<ProposalDraft>;
  private saves: SaveCoordinator;
  private closed = false;
  private paused = false;
  private request = new AbortController();
  constructor(
    private account: string,
    public draft: ProposalDraft,
    private status: (text: string) => void,
  ) {
    this.checkpoints = new LatestCheckpoint((value) =>
      writeDraft(this.account, value),
    );
    this.saves = new SaveCoordinator(() => this.publish(), 1500, 5000);
    if (
      !draft.manualPublish &&
      (draft.revision > draft.confirmed || draft.pending)
    )
      this.saves.changed();
    if (draft.manualPublish) void this.persist();
    window.addEventListener("online", this.reconnect);
    window.addEventListener("storage", this.accountChanged);
    window.addEventListener("axiom:close-documents", this.lock);
  }
  update(value: Pick<ProposalDraft, "source" | "hunks" | "message">) {
    const changed =
      this.draft.message !== value.message ||
      JSON.stringify(this.draft.hunks) !== JSON.stringify(value.hunks);
    this.draft = {
      ...this.draft,
      ...value,
      revision: this.draft.revision + (changed ? 1 : 0),
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    if (changed && !this.draft.manualPublish) this.saves.changed();
  }
  private persist() {
    const value = structuredClone(this.draft);
    this.local = this.checkpoints.write(value);
    void this.local
      .then(() => {
        if (!this.closed && !this.paused)
          this.status(
            this.draft.manualPublish
              ? "Private AI-assisted draft · click Publish to share"
              : navigator.onLine
                ? "Proposal saved on device · publishing…"
                : "Proposal saved on device · offline",
          );
      })
      .catch((e) => {
        if (!this.closed)
          this.status(
            "Recovery storage failed · export proposal: " + e.message,
          );
      });
    return this.local;
  }
  private async publish() {
    if (this.closed || this.paused)
      throw new Error(
        "Proposal publishing is paused. Reopen it to resolve the conflict.",
      );
    await this.local;
    assertAccount(this.account);
    if (!navigator.onLine) {
      this.status("Proposal saved on device · offline");
      throw new Error("Connect to publish the proposal.");
    }
    if (!this.draft.pending) {
      if (this.draft.revision <= this.draft.confirmed) return;
      if (!this.draft.hunks.length && this.draft.version === 0) {
        this.draft.confirmed = this.draft.revision;
        await this.persist();
        this.status("No proposed changes.");
        return;
      }
      this.draft.pending = {
        id: this.draft.id,
        mutationId: crypto.randomUUID(),
        generation: this.draft.generation,
        ...(this.draft.assistantContextId
          ? { assistantContextId: this.draft.assistantContextId }
          : {}),
        version: this.draft.version,
        hunks: this.draft.hunks,
        message: this.draft.message,
        localRevision: this.draft.revision,
      };
      await this.persist();
    }
    if (this.closed) throw new Error("Proposal publishing has stopped.");
    assertAccount(this.account);
    const { localRevision, ...input } = this.draft.pending;
    try {
      const saved = await api<{ version: number }>(
        "resources/" + this.draft.noteId + "/suggestions",
        {
          method: "POST",
          body: JSON.stringify(input),
          signal: this.request.signal,
        },
      );
      this.draft = {
        ...this.draft,
        version: saved.version,
        confirmed: localRevision,
        pending: undefined,
      };
      await this.persist();
      if (!this.closed)
        this.status(
          this.draft.revision === localRevision
            ? input.hunks.length
              ? "Proposal published · awaiting review"
              : "Proposal cleared · no pending changes"
            : "Newer proposal edits saved on device",
        );
      if (this.draft.revision > localRevision && !this.draft.manualPublish)
        this.saves.changed();
    } catch (e) {
      if (e instanceof ApiError && [400, 401, 403, 404, 409].includes(e.status))
        this.paused = true;
      if (!this.closed)
        this.status(
          this.paused
            ? "Proposal needs attention · " + (e as Error).message
            : "Proposal saved on device · retry when connected",
        );
      throw e;
    }
  }
  async flush() {
    await this.local;
    if (this.draft.manualPublish) this.saves.changed();
    await this.saves.flush();
  }
  async localFlush() {
    await this.local;
  }
  private reconnect = () => {
    if (!this.closed && !this.paused && !this.draft.manualPublish) {
      this.saves.reconnect();
      void this.saves.confirm().catch(() => {});
    }
  };
  private lock = () => this.destroy();
  private accountChanged = (e: StorageEvent) => {
    if (
      (e.key === SIGN_OUT_PENDING && e.newValue) ||
      e.key === "axiom:session"
    ) {
      try {
        assertAccount(this.account);
      } catch {
        this.destroy();
      }
    }
  };
  destroy() {
    this.closed = true;
    this.request.abort();
    this.saves.destroy();
    window.removeEventListener("online", this.reconnect);
    window.removeEventListener("storage", this.accountChanged);
    window.removeEventListener("axiom:close-documents", this.lock);
  }
}
