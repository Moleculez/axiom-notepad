import * as Y from "yjs";
type DocumentSession = {
  doc: Y.Doc;
  undo: Y.UndoManager;
  users: number;
  selection?: { anchor: Y.RelativePosition; head: Y.RelativePosition };
  scroll?: { top: number; left: number };
  discard: boolean;
  persisted: boolean;
};
const sessions = new Map<string, DocumentSession>();
// An empty document can still contain an unsaved deletion. A nonempty state
// vector distinguishes that authored history from a pristine, unopened doc.
const hasLocalState = (doc: Y.Doc) => Y.encodeStateVector(doc).byteLength > 1;
export function documentsSavedLocally() {
  return [...sessions.values()].every(
    (session) => session.persisted || !hasLocalState(session.doc),
  );
}
export function acquireDocument(key: string) {
  let session = sessions.get(key);
  if (!session) {
    const doc = new Y.Doc();
    session = {
      doc,
      undo: new Y.UndoManager(doc.getText("markdown")),
      users: 0,
      discard: false,
      persisted: false,
    };
    sessions.set(key, session);
  }
  session.users++;
  return session;
}
export function releaseDocument(key: string) {
  const session = sessions.get(key);
  if (!session) return;
  session.users = Math.max(0, session.users - 1);
  if (!session.users && session.discard) {
    session.undo.destroy();
    session.doc.destroy();
    sessions.delete(key);
  }
}
export function discardDocuments(userId: string) {
  for (const [key, session] of sessions)
    if (key.startsWith(userId + ":")) {
      session.discard = true;
      if (!session.users) {
        session.undo.destroy();
        session.doc.destroy();
        sessions.delete(key);
      }
    }
}
export function closeDocument(userId: string, noteId: string) {
  const matches = [...sessions].filter(([key]) =>
    key.startsWith(`${userId}:${noteId}:`),
  );
  if (
    matches.some(
      ([, session]) => !session.persisted && hasLocalState(session.doc),
    )
  )
    return false;
  for (const [key, session] of matches) {
    session.discard = true;
    if (!session.users) releaseDocument(key);
  }
  return true;
}
// Retain only in-memory CRDT/undo state between tabs, never hidden editors,
// workers, live providers, or IndexedDB connections. IndexedDB remains durable.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (
      [...sessions.values()].some(
        (session) => !session.persisted && hasLocalState(session.doc),
      )
    )
      event.preventDefault();
  });
  window.addEventListener("axiom:close-documents", (event) =>
    discardDocuments((event as CustomEvent<string>).detail),
  );
  window.addEventListener("storage", (event) => {
    if (event.key === "axiom:pending-signout" && event.newValue)
      for (const key of sessions.keys()) discardDocuments(key.split(":")[0]);
  });
}
