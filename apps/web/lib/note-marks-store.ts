"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { api, ApiError, SIGN_OUT_PENDING, errorMessage } from "./client";
import {
  commentCreateSchema,
  commentPatchSchema,
  commentContentPatch as authoredPatch,
  type CommentCreate,
  type CommentPatch,
  type NoteComment,
} from "@axiom/shared/note-comments";

export type AnnotationDraft = {
  id: string;
  noteId: string;
  input: CommentCreate;
  base?: NoteComment;
  updatedAt: string;
};
type Pending = {
  method: "POST" | "PATCH";
  path: string;
  input: CommentCreate | CommentPatch;
  optimistic: NoteComment;
};
type Stored = { key: string; noteId: string } & (
  | { kind: "cache"; value: NoteComment[] }
  | { kind: "draft"; value: AnnotationDraft }
  | { kind: "pending"; value: Pending; error?: string; conflict?: NoteComment }
);
function assertAccount(user: string) {
  const session = JSON.parse(localStorage.getItem("axiom:session") ?? "null");
  if (session?.user?.id !== user || localStorage.getItem(SIGN_OUT_PENDING))
    throw new Error("This account is locked. Sign in to access reading marks.");
}
const operations = new Map<string, Promise<unknown>>();
function storage<T>(
  user: string,
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  // Separate IDB connections do not guarantee request order. In particular,
  // an earlier draft write must never resurrect a draft after Save/Discard.
  const previous = operations.get(user) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => transaction(user, mode, work));
  operations.set(user, next);
  void next
    .finally(() => {
      if (operations.get(user) === next) operations.delete(user);
    })
    .catch(() => {});
  return next;
}
function transaction<T>(
  user: string,
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  assertAccount(user);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`axiom:${user}:note-marks-v1`, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("items", { keyPath: "key" });
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Reading-mark storage is blocked by another tab."));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      let value: T;
      try {
        assertAccount(user);
        const tx = db.transaction("items", mode);
        tx.oncomplete = () => {
          db.close();
          try {
            assertAccount(user);
            resolve(value);
          } catch (e) {
            reject(e);
          }
          if (mode === "readwrite") {
            window.dispatchEvent(new Event("axiom:note-marks"));
            const channel = new BroadcastChannel(`axiom-note-marks:${user}`);
            channel.postMessage("changed");
            channel.close();
          }
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("Reading marks were not saved."));
        };
        work(tx.objectStore("items"), (next) => {
          value = next;
        });
      } catch (e) {
        db.close();
        reject(e);
      }
    };
  });
}
const all = (user: string) =>
  storage<Stored[]>(user, "readonly", (s, done) => {
    s.getAll().onsuccess = (e) =>
      done((e.target as IDBRequest<Stored[]>).result);
  });
const put = (user: string, entry: Stored) =>
  storage<void>(user, "readwrite", (s) => {
    s.put(entry);
  });
const remove = (user: string, key: string) =>
  storage<void>(user, "readwrite", (s) => {
    s.delete(key);
  });
function cacheRecord(s: IDBObjectStore, noteId: string, record: NoteComment) {
  s.get(`cache:${noteId}`).onsuccess = (event) => {
    const cache = (event.target as IDBRequest<Stored | undefined>).result;
    const rows = new Map(
      (cache?.kind === "cache" ? cache.value : []).map((c) => [c.id, c]),
    );
    if ((rows.get(record.id)?.version ?? 0) <= record.version)
      rows.set(record.id, record);
    s.put({
      key: `cache:${noteId}`,
      noteId,
      kind: "cache",
      value: [...rows.values()],
    });
  };
}
function queuePrivate(
  user: string,
  entry: Extract<Stored, { kind: "pending" }>,
) {
  return storage<void>(user, "readwrite", (s) => {
    s.get(entry.key).onsuccess = (event) => {
      const old = (event.target as IDBRequest<Stored | undefined>).result;
      // Keep an already queued request immutable, including its retry token.
      // The acknowledgement will rebase any newer local edits onto its version.
      s.put(
        old?.kind === "pending"
          ? {
              ...old,
              value: { ...old.value, optimistic: entry.value.optimistic },
            }
          : entry,
      );
    };
  });
}
export async function exportNoteMarks(user: string) {
  return (await all(user))
    .filter(
      (item) =>
        item.kind !== "cache" || item.value.some((c) => c.author_id === user),
    )
    .map((item) =>
      item.kind === "cache"
        ? { ...item, value: item.value.filter((c) => c.author_id === user) }
        : item,
    );
}
export function useNoteThreads(
  user: { id: string; name: string },
  noteId: string,
  revision: number,
  active = true,
) {
  const [data, setData] = useState<NoteComment[] | null>(null),
    [drafts, setDrafts] = useState<AnnotationDraft[]>([]),
    [pending, setPending] = useState<Extract<Stored, { kind: "pending" }>[]>(
      [],
    ),
    [error, setError] = useState("");
  const current = useRef({ user, noteId, active });
  current.current = { user, noteId, active };
  const alive = useRef(false),
    reloadRef = useRef<() => Promise<void>>(async () => {});
  const readLocal = useCallback(async () => {
    const entries = (await all(user.id)).filter((v) => v.noteId === noteId);
    if (
      !alive.current ||
      current.current.noteId !== noteId ||
      current.current.user.id !== user.id
    )
      return;
    const cache = entries.find(
      (e): e is Extract<Stored, { kind: "cache" }> => e.kind === "cache",
    );
    const queue = entries.filter(
      (e): e is Extract<Stored, { kind: "pending" }> => e.kind === "pending",
    );
    const merged = new Map((cache?.value ?? []).map((c) => [c.id, c]));
    queue.forEach((e) => merged.set(e.value.optimistic.id, e.value.optimistic));
    setData([...merged.values()]);
    setPending(queue);
    setDrafts(entries.flatMap((e) => (e.kind === "draft" ? [e.value] : [])));
  }, [user.id, noteId]);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let syncing = false;
    const refresh = async () => {
      if (syncing || !alive.current || controller.signal.aborted) return;
      syncing = true;
      try {
        await readLocal();
        if (!navigator.onLine || !alive.current || controller.signal.aborted)
          return;
        for (let attempt = 0; attempt < 40; attempt++) {
          const entry = (await all(user.id)).find(
            (e): e is Extract<Stored, { kind: "pending" }> =>
              e.noteId === noteId && e.kind === "pending" && !e.error,
          );
          if (!entry) break;
          if (!alive.current || controller.signal.aborted) return;
          try {
            const saved = await api<NoteComment>(entry.value.path, {
              method: entry.value.method,
              body: JSON.stringify(entry.value.input),
              signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            await storage<void>(user.id, "readwrite", (s) => {
              cacheRecord(s, noteId, {
                ...saved,
                author_name: entry.value.optimistic.author_name,
              });
              s.get(entry.key).onsuccess = (event) => {
                const local = (event.target as IDBRequest<Stored | undefined>)
                  .result;
                if (local?.kind !== "pending") return;
                // Another tab may already have acknowledged this request and
                // queued its successor. An older ACK must not rebase it again.
                if (
                  local.value.input.mutationId !== entry.value.input.mutationId
                )
                  return;
                const desired = authoredPatch(local.value.optimistic);
                const actual = authoredPatch(saved);
                if (
                  Object.keys(desired).every(
                    (key) =>
                      JSON.stringify(desired[key as keyof CommentPatch]) ===
                      JSON.stringify(actual[key as keyof CommentPatch]),
                  )
                )
                  s.delete(entry.key);
                else
                  s.put({
                    ...local,
                    value: {
                      ...local.value,
                      method: "PATCH",
                      path: `comments/${saved.id}`,
                      input: {
                        ...desired,
                        expectedVisibility: "private",
                        version: saved.version,
                        mutationId: crypto.randomUUID(),
                      },
                      optimistic: {
                        ...local.value.optimistic,
                        version: saved.version,
                      },
                    },
                  });
              };
            });
          } catch (e) {
            if (controller.signal.aborted) return;
            if (e instanceof ApiError && e.status < 500)
              await storage<void>(user.id, "readwrite", (s) => {
                s.get(entry.key).onsuccess = (event) => {
                  const local = (event.target as IDBRequest<Stored | undefined>)
                    .result;
                  if (
                    local?.kind === "pending" &&
                    local.value.input.mutationId ===
                      entry.value.input.mutationId
                  )
                    s.put({
                      ...local,
                      error: errorMessage(e),
                      conflict: e.status === 409 ? e.data?.current : undefined,
                    });
                };
              });
            else throw e;
          }
        }
        // Background tabs still replay authored work, but do not continually
        // download discussion histories for documents nobody is viewing.
        if (!current.current.active) return;
        const records = await api<NoteComment[]>(`notes/${noteId}/comments`, {
          signal: controller.signal,
        });
        if (!Array.isArray(records))
          throw new Error("The discussion response could not be read.");
        if (!alive.current || controller.signal.aborted) return;
        await put(user.id, {
          key: `cache:${noteId}`,
          noteId,
          kind: "cache",
          value: records,
        });
        setError("");
        await readLocal();
      } catch (e) {
        if (
          !alive.current ||
          controller.signal.aborted ||
          (e instanceof DOMException && e.name === "AbortError")
        )
          return;
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          await remove(user.id, `cache:${noteId}`).catch(() => {});
          await readLocal().catch(() => {});
        }
        setError(errorMessage(e));
      } finally {
        syncing = false;
      }
    };
    reloadRef.current = refresh;
    const local = () => {
      void readLocal().catch((e) => {
        if (alive.current && !controller.signal.aborted)
          setError(errorMessage(e));
      });
    };
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const channel = new BroadcastChannel(`axiom-note-marks:${user.id}`);
    channel.onmessage = local;
    const signedOut = () => {
      if (localStorage.getItem(SIGN_OUT_PENDING)) {
        alive.current = false;
        controller.abort();
        setData([]);
        setDrafts([]);
        setPending([]);
      }
    };
    window.addEventListener("axiom:note-marks", local);
    window.addEventListener("online", tick);
    window.addEventListener("focus", tick);
    window.addEventListener("storage", signedOut);
    const timer = setInterval(tick, 10000);
    void refresh();
    return () => {
      alive.current = false;
      controller.abort();
      clearInterval(timer);
      channel.close();
      window.removeEventListener("axiom:note-marks", local);
      window.removeEventListener("online", tick);
      window.removeEventListener("focus", tick);
      window.removeEventListener("storage", signedOut);
    };
  }, [user.id, noteId, readLocal]);
  useEffect(() => {
    void reloadRef.current();
  }, [revision, active]);
  const saveDraft = useCallback(
    async (draft: AnnotationDraft) => {
      await put(user.id, {
        key: `draft:${noteId}:${draft.id}`,
        noteId,
        kind: "draft",
        value: draft,
      });
    },
    [user.id, noteId],
  );
  const discard = useCallback(
    (id: string) => remove(user.id, `draft:${noteId}:${id}`),
    [user.id, noteId],
  );
  const acknowledge = (record: NoteComment) =>
    storage<void>(user.id, "readwrite", (s) =>
      cacheRecord(s, noteId, {
        ...record,
        author_name:
          record.author_name ??
          (record.author_id === user.id ? user.name : undefined),
      }),
    );
  const commit = async (draft: AnnotationDraft) => {
    await saveDraft(draft);
    const create = commentCreateSchema.parse({
      ...draft.input,
      id: draft.id,
      mutationId: crypto.randomUUID(),
    });
    const patch = commentPatchSchema.parse({
      body: create.body,
      title: create.title,
      category: create.category,
      tags: create.tags,
      bodyFormat: create.bodyFormat,
      ...(draft.base?.parent_id ? {} : { anchor: create.anchor }),
      version: draft.base?.version || undefined,
      expectedVisibility: draft.base?.visibility,
      mutationId: create.mutationId,
    });
    const method = draft.base && draft.base.version > 0 ? "PATCH" : "POST";
    const path =
      method === "PATCH" ? `comments/${draft.id}` : `notes/${noteId}/comments`;
    const input = method === "PATCH" ? patch : create;
    if (
      (draft.base?.visibility ?? create.visibility) === "shared" ||
      create.parentId
    ) {
      if (!navigator.onLine)
        throw new Error(
          "Go online to publish. Your draft is retained privately.",
        );
      await acknowledge(
        await api<NoteComment>(path, { method, body: JSON.stringify(input) }),
      );
    } else {
      const now = new Date().toISOString();
      const optimistic: NoteComment = {
        id: draft.id,
        note_id: noteId,
        author_id: user.id,
        author_name: user.name,
        parent_id: null,
        body: create.body,
        anchor: create.anchor,
        kind: "annotation",
        visibility: "private",
        title: create.title,
        category: create.category,
        tags: create.tags,
        body_format: "markdown",
        version: draft.base?.version ?? 0,
        mutation_id: create.mutationId!,
        resolved: draft.base?.resolved ?? false,
        deleted: false,
        created_at: draft.base?.created_at ?? now,
        updated_at: now,
      };
      await queuePrivate(user.id, {
        key: `pending:${noteId}:${draft.id}`,
        noteId,
        kind: "pending",
        value: { method, path, input, optimistic },
      });
    }
    await discard(draft.id);
    await readLocal();
    void reloadRef.current();
  };
  const change = async (entry: NoteComment, value: CommentPatch) => {
    const patch = commentPatchSchema.parse({
      ...value,
      version: entry.version || undefined,
      expectedVisibility: entry.visibility,
      mutationId: crypto.randomUUID(),
    });
    if (
      !navigator.onLine &&
      (entry.visibility === "shared" || value.visibility)
    )
      throw new Error("Reconnect to change a shared card or its visibility.");
    // Visibility changes never enter an automatically replayed outbox.
    if (entry.visibility === "shared" || value.visibility) {
      const saved = await api<NoteComment>(`comments/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await acknowledge(saved);
      await readLocal();
      void reloadRef.current();
      return saved;
    }
    const previous = pending.find((p) => p.value.optimistic.id === entry.id);
    const optimistic = {
      ...entry,
      ...value,
      updated_at: new Date().toISOString(),
    };
    await queuePrivate(user.id, {
      key: `pending:${noteId}:${entry.id}`,
      noteId,
      kind: "pending",
      value: {
        method: previous?.value.method ?? "PATCH",
        path: previous?.value.path ?? `comments/${entry.id}`,
        input: previous?.value.input ?? patch,
        optimistic,
      },
    });
    await readLocal();
    void reloadRef.current();
    return optimistic;
  };
  const resolve = async (
    entry: Extract<Stored, { kind: "pending" }>,
    mine: boolean,
  ) => {
    if (!mine) {
      if (entry.conflict) await acknowledge(entry.conflict);
      await remove(user.id, entry.key);
    } else {
      if (!entry.conflict)
        throw new Error(
          "Access or validation needs attention. Export your work before retrying.",
        );
      if (entry.conflict.visibility !== "private") {
        const record = entry.value.optimistic;
        await saveDraft({
          id: crypto.randomUUID(),
          noteId,
          updatedAt: new Date().toISOString(),
          input: {
            body: record.body,
            title: record.title,
            tags: record.tags,
            category: record.category,
            anchor: record.anchor,
            parentId: null,
            kind: "annotation",
            visibility: "private",
            bodyFormat: record.body_format,
          },
        });
        await acknowledge(entry.conflict);
        await remove(user.id, entry.key);
        await readLocal();
        return;
      }
      await put(user.id, {
        ...entry,
        error: undefined,
        conflict: undefined,
        value: {
          ...entry.value,
          method: "PATCH",
          path: `comments/${entry.value.optimistic.id}`,
          input: {
            ...authoredPatch(entry.value.optimistic),
            expectedVisibility: "private",
            version: entry.conflict.version,
            mutationId: crypto.randomUUID(),
          },
        },
      });
    }
    await readLocal();
    void reloadRef.current();
  };
  return {
    data,
    drafts,
    pending,
    error,
    saveDraft,
    discard,
    commit,
    change,
    resolve,
    reload: () => void reloadRef.current(),
  };
}
export type NoteThreads = ReturnType<typeof useNoteThreads>;
