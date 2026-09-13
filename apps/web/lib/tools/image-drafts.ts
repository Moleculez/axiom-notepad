import { SIGN_OUT_PENDING } from "../client";
export type ImageDraft = {
  blob: Blob;
  baseVersion: string | null;
  updatedAt: string;
};
type StoredImageDraft = Omit<ImageDraft, "blob"> & {
  blob: Blob | ArrayBuffer;
  mime?: string;
};
async function database(userId: string) {
  if (localStorage.getItem(SIGN_OUT_PENDING))
    throw new Error("Sign-out is in progress.");
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(`axiom:${userId}:image-drafts`, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("drafts");
    r.onsuccess = () => {
      r.result.onversionchange = () => r.result.close();
      resolve(r.result);
    };
    r.onerror = () => reject(r.error);
  });
}
export async function imageDraft(
  userId: string,
  id: string,
  value?: ImageDraft | null,
) {
  // Some WebKit environments reject Blob records in IndexedDB. Store cloneable
  // bytes, but continue accepting existing Blob drafts without a migration.
  const stored = value
    ? {
        ...value,
        blob: await value.blob.arrayBuffer(),
        mime: value.blob.type,
      }
    : value;
  const db = await database(userId);
  try {
    const result = await new Promise<StoredImageDraft | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(
            "drafts",
            value === undefined ? "readonly" : "readwrite",
            { durability: "strict" },
          ),
          store = tx.objectStore("drafts");
        const r =
          value === undefined
            ? store.get(id)
            : value === null
              ? store.delete(id)
              : store.put(stored, id);
        tx.oncomplete = () =>
          resolve(value === undefined ? r.result : undefined);
        tx.onabort = () => reject(tx.error);
      },
    );
    if (!result) return undefined;
    return {
      baseVersion: result.baseVersion,
      updatedAt: result.updatedAt,
      blob:
        result.blob instanceof Blob
          ? result.blob
          : new Blob([result.blob], {
              type: result.mime ?? "application/vnd.axiom.image+zip",
            }),
    };
  } finally {
    db.close();
  }
}
