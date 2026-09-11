/** Rotating a journal never deletes the previous IndexedDB database. Its full
 * CRDT and recovery text remain account scoped, including unacknowledged edits.
 * Other open views use the same pointer so none can replay a quarantined cache.
 */
export const recoveryEvent = "axiom:editor-cache-changed";
export const cachePointer = (scope: string) => `axiom:editor-cache:${scope}`;
export function currentCache(scope: string) {
  try {
    return localStorage.getItem(cachePointer(scope)) ?? "";
  } catch {
    return "";
  }
}
export function rotateCache(scope: string) {
  const id = crypto.randomUUID();
  // A failed pointer write leaves the original journal in use and read-only.
  // Do not switch to a cache we cannot find again after a reload.
  localStorage.setItem(cachePointer(scope), id);
  window.dispatchEvent(new CustomEvent(recoveryEvent, { detail: scope }));
  return id;
}
export type RecoveryDraft = { key: string; source: string; label: string };
const recoveryPrefix = (userId: string, noteId: string) =>
  `axiom:editor-recovery:${userId}:${noteId}`;
export function recoveryDrafts(
  userId: string,
  noteId: string,
): RecoveryDraft[] {
  const prefix = recoveryPrefix(userId, noteId);
  return Object.keys(localStorage)
    .filter((key) => key === prefix || key.startsWith(prefix + ":"))
    .sort()
    .reverse()
    .map((key) => ({
      key,
      source: localStorage.getItem(key) ?? "",
      label:
        key === prefix
          ? "Earlier recovery"
          : new Date(
              Number(key.slice(prefix.length + 1).split(":")[0]),
            ).toLocaleString(),
    }))
    .filter((draft) => draft.source.length > 0);
}
export function retainDraft(userId: string, noteId: string, source: string) {
  const existing = recoveryDrafts(userId, noteId).find(
    (draft) => draft.source === source,
  );
  if (existing) return existing;
  const key = `${recoveryPrefix(userId, noteId)}:${Date.now()}:${crypto.randomUUID()}`;
  // Separate immutable records prevent a clean tab from overwriting an offline
  // tab's recovery during a shared cache rotation. There is no automatic expiry.
  localStorage.setItem(key, source);
  return { key, source, label: new Date().toLocaleString() };
}
