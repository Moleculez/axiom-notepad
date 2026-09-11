import { SIGN_OUT_PENDING } from "../client";
export type ImageDraft = {
  blob: Blob;
  baseVersion: string | null;
  updatedAt: string;
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
  const db = await database(userId);
  try {
    return await new Promise<ImageDraft | undefined>((resolve, reject) => {
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
            : store.put(value, id);
      tx.oncomplete = () => resolve(value === undefined ? r.result : undefined);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
