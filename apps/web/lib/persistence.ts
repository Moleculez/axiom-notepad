import * as Y from "yjs";
const volatileCheckpoints = new WeakMap<Y.Doc, Map<string, unknown>>();

/** Account- and generation-scoped Yjs journal, compatible with existing caches.
 * A save is acknowledged only by IDBTransaction.complete, never request.success.
 * Quota/permission failures keep the in-memory document intact for export.
 */
export class LocalPersistence {
  readonly whenSynced: Promise<void>;
  private db: IDBDatabase | null = null;
  private closed = false;
  private pending = 0;
  private failed = false;
  private metadata: Map<string, unknown>;

  constructor(
    name: string,
    private doc: Y.Doc,
    private onState: (saved: boolean, error?: Error) => void,
  ) {
    this.metadata = volatileCheckpoints.get(doc) ?? new Map();
    volatileCheckpoints.set(doc, this.metadata);
    this.doc.on("update", this.update);
    this.whenSynced = new Promise<void>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(name);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        request.result.createObjectStore("updates", { autoIncrement: true });
        request.result.createObjectStore("custom");
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Device storage is blocked by another tab."));
      request.onsuccess = () => {
        if (this.closed) {
          request.result.close();
          resolve();
          return;
        }
        this.db = request.result;
        this.db.onversionchange = () => {
          this.db?.close();
          this.fail(
            new Error(
              "Device storage was cleared in another tab. Reopen this note.",
            ),
          );
        };
        try {
          const tx = this.transaction();
          const store = tx.objectStore("updates");
          const all = store.getAll();
          all.onsuccess = () => {
            if (this.closed) return;
            try {
              Y.transact(
                doc,
                () => {
                  for (const update of all.result)
                    Y.applyUpdate(doc, update, this);
                },
                this,
              );
              // Compact while holding the same store lock. Other tabs' writes
              // either precede this read or follow this snapshot; none are lost.
              store.clear();
              store.add(Y.encodeStateAsUpdate(doc));
            } catch (error) {
              tx.abort();
              reject(error);
            }
          };
          tx.oncomplete = () => {
            if (!this.closed) this.onState(this.pending === 0);
            resolve();
          };
          tx.onabort = () =>
            reject(
              tx.error ?? new Error("Device storage transaction was aborted."),
            );
        } catch (error) {
          reject(error);
        }
      };
    });
    // Attach the failure handler immediately, including when opening IDB fails.
    void this.whenSynced.catch((error: unknown) => this.fail(error));
  }

  private transaction() {
    if (!this.db || this.failed)
      throw new Error("Device storage is unavailable.");
    return this.db.transaction("updates", "readwrite", {
      durability: "strict",
    });
  }

  async get<T>(key: string, allowVolatile = false): Promise<T | undefined> {
    await this.whenSynced.catch((error) => {
      if (!allowVolatile) throw error;
    });
    if (allowVolatile && (this.failed || !this.db))
      return this.metadata.get(key) as T | undefined;
    if (!this.db || this.failed || this.closed)
      throw new Error("Device storage is unavailable.");
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction("custom", "readonly"),
        request = tx.objectStore("custom").get(key);
      tx.oncomplete = () => {
        this.metadata.set(key, request.result);
        resolve(request.result as T | undefined);
      };
      tx.onabort = () =>
        reject(tx.error ?? new Error("Device checkpoint could not be read."));
    });
  }

  async set(key: string, value: unknown, allowVolatile = false): Promise<void> {
    this.metadata.set(key, value);
    await this.whenSynced.catch((error) => {
      if (!allowVolatile) throw error;
    });
    if (allowVolatile && (this.failed || !this.db)) return;
    if (!this.db || this.failed || this.closed)
      throw new Error("Device storage is unavailable.");
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction("custom", "readwrite", {
        durability: "strict",
      });
      tx.objectStore("custom").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error ?? new Error("Device checkpoint could not be saved."));
    });
  }

  private fail(error: unknown) {
    this.failed = true;
    if (!this.closed)
      this.onState(
        false,
        error instanceof Error
          ? error
          : new Error("Device storage is unavailable."),
      );
  }

  private update = (update: Uint8Array, origin: unknown) => {
    if (this.closed || origin === this || this.failed) return;
    this.onState(false);
    // Changes arriving before open() completes are included in its snapshot.
    if (!this.db) return;
    try {
      const tx = this.transaction();
      this.pending++;
      tx.objectStore("updates").add(update);
      tx.oncomplete = () => {
        this.pending--;
        if (!this.closed && !this.failed) this.onState(this.pending === 0);
      };
      tx.onabort = () => {
        this.pending--;
        this.fail(
          tx.error ?? new Error("Device storage transaction was aborted."),
        );
      };
    } catch (error) {
      this.fail(error);
    }
  };

  async flush() {
    await this.whenSynced;
    if (!this.db || this.failed || this.closed)
      throw new Error("Device storage is unavailable.");
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(["updates", "custom"], "readwrite", {
        durability: "strict",
      });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Device save failed."));
    });
  }

  destroy() {
    this.closed = true;
    this.doc.off("update", this.update);
    // close() waits for already queued transactions to finish.
    this.db?.close();
  }
}
