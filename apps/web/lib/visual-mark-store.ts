"use client";
import { useEffect, useRef, useState } from "react";
import {
  visualWriteSchema,
  type VisualAnnotation,
  type VisualWrite,
} from "@axiom/shared/visual-annotations";
import { api, ApiError, SIGN_OUT_PENDING } from "./client";
import {
  changedVisualMarks,
  currentVisualUser,
  loadVisualMarks,
  visualMarksEvent,
} from "./visual-surface";

type LocalMark = {
  id: string;
  resourceId: string;
  record: VisualAnnotation;
  pending: boolean;
  error?: string;
  conflict?: VisualAnnotation | null;
};
function guard(user: string) {
  if (
    !user ||
    currentVisualUser() !== user ||
    localStorage.getItem(SIGN_OUT_PENDING)
  )
    throw new Error(
      "Sign in to this account before accessing visual annotations.",
    );
}
const queues = new Map<string, Promise<unknown>>();
async function storage<T>(
  user: string,
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore, done: (v: T) => void) => void,
): Promise<T> {
  guard(user);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`axiom:${user}:visual-marks-v1`, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("marks", { keyPath: "id" });
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error("Annotation storage is blocked by another tab."));
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      let value: T;
      try {
        guard(user);
        const tx = db.transaction("marks", mode);
        tx.oncomplete = () => {
          db.close();
          try {
            guard(user);
            resolve(value);
          } catch (e) {
            reject(e);
          }
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("Annotation draft was not saved."));
        };
        work(tx.objectStore("marks"), (v) => {
          value = v;
        });
      } catch (e) {
        db.close();
        reject(e);
      }
    };
  });
}
const all = (user: string) =>
  storage<LocalMark[]>(user, "readonly", (s, done) => {
    s.getAll().onsuccess = (e) => done((e.target as IDBRequest).result);
  });
const put = (user: string, value: LocalMark) =>
  storage<void>(user, "readwrite", (s) => {
    s.put(value);
  });
const remove = (user: string, id: string) =>
  storage<void>(user, "readwrite", (s) => {
    s.delete(id);
  });
function update(
  user: string,
  id: string,
  fn: (v: LocalMark | undefined) => LocalMark | undefined,
) {
  return storage<void>(user, "readwrite", (s) => {
    s.get(id).onsuccess = (e) => {
      const next = fn((e.target as IDBRequest).result);
      if (next) s.put(next);
      else s.delete(id);
    };
  });
}
function serialize<T>(key: string, run: () => Promise<T>): Promise<T> {
  const p = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
  queues.set(key, p);
  void p
    .finally(() => {
      if (queues.get(key) === p) queues.delete(key);
    })
    .catch(() => {});
  return p;
}
function write(record: VisualAnnotation): VisualWrite {
  const {
    authorId: _a,
    authorName: _b,
    createdAt: _c,
    updatedAt: _d,
    ...input
  } = record;
  return visualWriteSchema.parse(input);
}
async function drainVisualDrafts(user: string, resourceId: string) {
  return serialize("sync:" + user + ":" + resourceId, async () => {
    guard(user);
    const entries = (await all(user))
      .filter((e) => e.resourceId === resourceId && e.pending && !e.error)
      .slice(0, 50);
    for (const item of entries) {
      guard(user);
      if (!navigator.onLine) return;
      try {
        const record = await api<VisualAnnotation>(
          item.record.version
            ? `visual-annotations/${item.id}`
            : `resources/${resourceId}/visual-annotations`,
          {
            method: item.record.version ? "PATCH" : "POST",
            body: JSON.stringify(write(item.record)),
          },
        );
        guard(user);
        await update(user, item.id, (latest) =>
          latest?.record.mutationId === item.record.mutationId
            ? { id: item.id, resourceId, record, pending: false }
            : latest
              ? {
                  ...latest,
                  record: { ...latest.record, version: record.version },
                }
              : undefined,
        );
        changedVisualMarks(resourceId);
      } catch (e) {
        if (e instanceof ApiError && e.status < 500) {
          await update(user, item.id, (v) =>
            v
              ? {
                  ...v,
                  error: e.message,
                  conflict: e.status === 409 ? e.data?.current : undefined,
                }
              : v,
          );
        } else throw e;
      }
    }
  });
}
/** Reconnect replay continues even after the viewer was closed. */
export async function replayVisualDrafts(user: string) {
  if (!navigator.onLine) return;
  guard(user);
  const resources = new Set(
    (await all(user))
      .filter((e) => e.pending && !e.error)
      .map((e) => e.resourceId),
  );
  for (const resource of resources) await drainVisualDrafts(user, resource);
}
export function useVisualMarks(
  user: { id: string; name: string },
  resourceId?: string,
) {
  const [rows, setRows] = useState<VisualAnnotation[]>([]),
    [local, setLocal] = useState<LocalMark[]>([]),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  const alive = useRef(false),
    current = useRef({ user, resourceId });
  current.current = { user, resourceId };
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let running = false;
    let disposed = false;
    alive.current = true;
    setRows([]);
    setLocal([]);
    setLoaded(false);
    setError("");
    const valid = () =>
      !disposed &&
      alive.current &&
      current.current.resourceId === resourceId &&
      current.current.user.id === user.id &&
      currentVisualUser() === user.id &&
      !localStorage.getItem(SIGN_OUT_PENDING);
    const read = async () => {
      const entries = (await all(user.id)).filter(
        (e) => e.resourceId === resourceId,
      );
      if (valid()) {
        setLocal(entries.filter((e) => e.pending));
        setRows(entries.map((e) => e.record));
      }
      return entries;
    };
    const refresh = async () => {
      if (!resourceId || !valid() || running) return;
      running = true;
      try {
        await read();
        if (navigator.onLine) {
          // Network latency must never block durable local keystroke writes.
          await drainVisualDrafts(user.id, resourceId);
          const remote = await loadVisualMarks(resourceId, true);
          if (!valid()) return;
          await serialize(user.id + ":" + resourceId, async () => {
            const entries = (await all(user.id)).filter(
                (e) => e.resourceId === resourceId,
              ),
              ids = new Set(remote.map((r) => r.id));
            for (const record of remote)
              await update(user.id, record.id, (v) =>
                v?.pending
                  ? v
                  : { id: record.id, resourceId, record, pending: false },
              );
            for (const v of entries)
              if (!v.pending && !ids.has(v.id)) await remove(user.id, v.id);
          });
          await read();
        }
      } catch (e) {
        if (valid()) {
          setError(
            e instanceof Error ? e.message : "Annotations could not be loaded.",
          );
          if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
            for (const item of await all(user.id))
              if (item.resourceId === resourceId && !item.pending)
                await remove(user.id, item.id);
            setRows([]);
          }
        }
      } finally {
        if (valid()) setLoaded(true);
        running = false;
      }
    };
    refreshRef.current = refresh;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const lock = () => {
      if (!valid()) {
        setRows([]);
        setLocal([]);
        setError("This account is locked.");
      }
    };
    const channel = new BroadcastChannel(`axiom-visual-marks:${user.id}`);
    channel.onmessage = tick;
    window.addEventListener("online", tick);
    window.addEventListener("focus", tick);
    window.addEventListener(visualMarksEvent, tick);
    window.addEventListener("storage", lock);
    const timer = setInterval(tick, 10000);
    void refresh();
    return () => {
      disposed = true;
      alive.current = false;
      clearInterval(timer);
      channel.close();
      window.removeEventListener("online", tick);
      window.removeEventListener("focus", tick);
      window.removeEventListener(visualMarksEvent, tick);
      window.removeEventListener("storage", lock);
    };
  }, [resourceId, user.id]);
  const save = async (input: VisualWrite) => {
    if (!resourceId)
      throw new Error("Open the saved document to retain annotations.");
    guard(user.id);
    input = visualWriteSchema.parse(input);
    if (input.placement.resourceId !== resourceId)
      throw new Error(
        "The document changed. Reopen this annotation before editing.",
      );
    if (input.visibility === "shared" && !navigator.onLine)
      throw new Error(
        "Go online to publish. Keep this draft private meanwhile.",
      );
    const previous = rows.find((r) => r.id === input.id),
      record: VisualAnnotation = {
        ...input,
        authorId: previous?.authorId ?? user.id,
        authorName: previous?.authorName ?? user.name,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    await serialize(user.id + ":" + resourceId, async () => {
      // Read the latest acknowledged revision, including an in-flight save.
      const old = (await all(user.id)).find((v) => v.id === input.id);
      if (old?.error)
        throw new Error(
          "Resolve the retained draft conflict before editing this annotation.",
        );
      // Rebase acknowledgements of our own queued write, not a newer remote
      // edit/audience change that this editor has not reviewed.
      if (
        old &&
        (old.pending || old.record.mutationId === previous?.mutationId)
      )
        record.version = old.record.version;
      await put(user.id, { id: record.id, resourceId, record, pending: true });
    });
    if (
      alive.current &&
      current.current.resourceId === resourceId &&
      current.current.user.id === user.id
    ) {
      setRows((v) => [...v.filter((r) => r.id !== record.id), record]);
      setError("");
    }
    const channel = new BroadcastChannel(`axiom-visual-marks:${user.id}`);
    channel.postMessage("changed");
    channel.close();
    changedVisualMarks(resourceId);
    void refreshRef.current();
    return record;
  };
  const resolve = async (id: string, keep: boolean) => {
    await serialize(user.id + ":" + resourceId, async () => {
      const item = (await all(user.id)).find((e) => e.id === id);
      if (!item) return;
      if (keep) {
        if (item.conflict && item.conflict.authorId !== user.id)
          throw new Error("Only the author can reapply a draft.");
        if (item.conflict?.deleted)
          throw new Error(
            "This annotation was removed. Export your retained draft or use the server version.",
          );
        if (
          item.conflict &&
          item.conflict.visibility !== item.record.visibility
        )
          throw new Error(
            "Sharing changed on another device. Use the server version, then explicitly choose its audience.",
          );
        await put(user.id, {
          ...item,
          error: undefined,
          conflict: undefined,
          record: {
            ...item.record,
            version: item.conflict?.version ?? item.record.version,
            mutationId: crypto.randomUUID(),
          },
        });
      } else if (item.conflict)
        await put(user.id, {
          ...item,
          record: item.conflict,
          pending: false,
          error: undefined,
          conflict: undefined,
        });
      else await remove(user.id, id);
    });
    void refreshRef.current();
  };
  return {
    rows,
    pending: local,
    error,
    loaded,
    save,
    resolve,
    reload: () => refreshRef.current(),
  };
}
/** Account-owned recovery export; never includes other researchers' notes. */
export async function exportVisualMarks(user: string) {
  return (await all(user)).filter((v) => v.record.authorId === user);
}
