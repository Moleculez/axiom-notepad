"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage, SIGN_OUT_PENDING } from "./client";
import {
  readingInputSchema,
  normalizeReadingData,
  annotationDataSchema,
  type Annotation,
  type AnnotationData,
  type ReadingItem,
  type ReadingData,
} from "@axiom/shared/research";
export type PaperMeta = {
  id: string;
  name: string;
  note_id: string;
  group_id: string;
  mime: string;
  sha256: string;
  bytes: number;
  visibility: "shared" | "private";
  role: "owner" | "admin" | "member";
};
export type CachedPaper = {
  key: string;
  kind: "pdf";
  groupId: string;
  meta: PaperMeta;
  bytes?: Uint8Array;
  /** Compatibility with copies pinned before binary-array storage. */
  blob?: Blob;
  savedAt: string;
};
export type ResearchEntry = {
  key: string;
  kind: "reading" | "annotation";
  groupId: string;
  value: ReadingItem | Annotation;
  pending: boolean;
  error?: string;
  conflict?: ReadingItem | Annotation | null;
};
export type StoredResearch = CachedPaper | ResearchEntry;
const dbName = (user: string) => `axiom:${user}:research-v1`;
function assertAccount(user: string) {
  let id: string | undefined;
  try {
    id = JSON.parse(localStorage.getItem("axiom:session") ?? "null")?.user?.id;
  } catch {
    /* Fail closed. */
  }
  if (id !== user || localStorage.getItem(SIGN_OUT_PENDING))
    throw new Error(
      "This account is locked. Sign in again before using local research data.",
    );
}
function changed(user: string) {
  window.dispatchEvent(new CustomEvent("axiom-research", { detail: user }));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(`axiom-research:${user}`);
    channel.postMessage("changed");
    channel.close();
  }
}
export async function researchStorage<T>(
  user: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  assertAccount(user);
  return new Promise<T>((resolve, reject) => {
    const request = indexedDB.open(dbName(user), 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("items", { keyPath: "key" });
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Research storage is blocked by another tab."));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      let value: T;
      try {
        assertAccount(user);
        const tx = db.transaction(
          "items",
          mode,
          mode === "readwrite" ? { durability: "strict" } : undefined,
        );
        tx.oncomplete = () => {
          db.close();
          try {
            assertAccount(user);
            resolve(value);
            if (mode === "readwrite") changed(user);
          } catch (e) {
            reject(e);
          }
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("Research storage was not saved."));
        };
        operation(tx.objectStore("items"), (result) => {
          value = result;
        });
      } catch (e) {
        db.close();
        reject(e);
      }
    };
  });
}
export const allResearch = (user: string) =>
  researchStorage<StoredResearch[]>(user, "readonly", (s, done) => {
    s.getAll().onsuccess = (e) => done((e.target as IDBRequest).result);
  });
export const storeResearch = (user: string, value: StoredResearch) =>
  researchStorage<void>(user, "readwrite", (s) => {
    s.put(value);
  });
export const removeResearch = (user: string, key: string) =>
  researchStorage<void>(user, "readwrite", (s) => {
    s.delete(key);
  });
export const updateResearch = (
  user: string,
  key: string,
  fn: (entry: StoredResearch | undefined) => StoredResearch | undefined,
) =>
  researchStorage<void>(user, "readwrite", (s) => {
    s.get(key).onsuccess = (e) => {
      const next = fn((e.target as IDBRequest).result);
      if (next) s.put(next);
      else s.delete(key);
    };
  });
async function revokeCachedPaper(user: string, id: string) {
  await researchStorage<void>(user, "readwrite", (s) => {
    s.getAll().onsuccess = (e) => {
      for (const r of (e.target as IDBRequest<StoredResearch[]>).result)
        if (
          (r.kind === "pdf" && r.meta.id === id) ||
          (r.kind === "annotation" &&
            (r.value as Annotation).attachment_id === id &&
            !r.pending)
        )
          s.delete(r.key);
    };
  });
  window.dispatchEvent(
    new CustomEvent("axiom-paper-unavailable", { detail: id }),
  );
}
async function cachedPaperBytes(paper: CachedPaper) {
  if (paper.bytes) return new Uint8Array(paper.bytes);
  if (paper.blob) return new Uint8Array(await paper.blob.arrayBuffer());
  throw new Error(
    "This offline copy is incomplete. Remove it and download the paper again.",
  );
}
export async function loadPaper(
  user: string,
  id: string,
): Promise<{ meta: PaperMeta; bytes: Uint8Array; pinned: boolean }> {
  assertAccount(user);
  // Online viewing must remain available when local storage is denied.
  const stored: StoredResearch[] = await allResearch(user).catch(() => {
    assertAccount(user);
    return [];
  });
  const cached = stored.find(
    (r): r is CachedPaper => r.kind === "pdf" && r.meta.id === id,
  );
  try {
    const meta = await api<PaperMeta>(`attachments/${id}/meta`);
    assertAccount(user);
    if (cached && cached.meta.sha256 === meta.sha256) {
      const bytes = await cachedPaperBytes(cached);
      await verifyPaper(bytes, meta.sha256);
      assertAccount(user);
      return { meta, bytes, pinned: true };
    }
    const response = await fetch(`/api/v1/attachments/${id}`, {
      cache: "no-store",
    });
    if (!response.ok)
      throw new ApiError("The paper is unavailable.", response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertAccount(user);
    if (bytes.length > 50 * 1024 * 1024)
      throw new Error("PDF exceeds the 50 MB file limit.");
    await verifyPaper(bytes, meta.sha256);
    return { meta, bytes, pinned: false };
  } catch (e) {
    if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
      await revokeCachedPaper(user, id).catch(() => {});
      throw e;
    }
    if (
      cached &&
      (!navigator.onLine ||
        e instanceof TypeError ||
        (e instanceof ApiError && e.status >= 500))
    ) {
      const bytes = await cachedPaperBytes(cached);
      await verifyPaper(bytes, cached.meta.sha256);
      assertAccount(user);
      return { meta: cached.meta, bytes, pinned: true };
    }
    throw e;
  }
}
export async function verifyPaper(bytes: Uint8Array, hash: string) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  if (
    [...new Uint8Array(digest)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("") !== hash
  )
    throw new Error(
      "The PDF checksum does not match. Remove its offline copy and download it again.",
    );
}
export async function pinPaper(
  user: string,
  meta: PaperMeta,
  bytes: Uint8Array,
) {
  await verifyPaper(bytes, meta.sha256);
  await storeResearch(user, {
    key: "pdf:" + meta.id,
    kind: "pdf",
    groupId: meta.group_id,
    meta,
    // Typed arrays also work in WebKit contexts that reject persistent Blobs.
    bytes: new Uint8Array(bytes),
    savedAt: new Date().toISOString(),
  });
}
export function useResearch(userId?: string, groupId?: string) {
  const [entries, setEntries] = useState<ResearchEntry[]>([]),
    [papers, setPapers] = useState<CachedPaper[]>([]),
    [status, setStatus] = useState("");
  const watched = useRef<string | null>(null),
    active = useRef(false),
    syncRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(async () => {
    if (!userId || !active.current) return;
    try {
      const all = await allResearch(userId);
      if (!active.current) return;
      setEntries(
        all.filter(
          (r): r is ResearchEntry => r.kind !== "pdf" && r.groupId === groupId,
        ),
      );
      setPapers(all.filter((r): r is CachedPaper => r.kind === "pdf"));
    } catch (e) {
      if (active.current) setStatus((e as Error).message);
    }
  }, [userId, groupId]);
  useEffect(() => {
    active.current = true;
    let alive = true,
      busy = false,
      lastPaperCheck = 0,
      leaving = false,
      controller = new AbortController();
    setEntries([]);
    setPapers([]);
    setStatus("");
    watched.current = null;
    const valid = () =>
      alive &&
      !leaving &&
      active.current &&
      !!userId &&
      !localStorage.getItem(SIGN_OUT_PENDING);
    const cacheRemote = async (
      kind: "reading" | "annotation",
      records: (ReadingItem | Annotation)[],
      attachmentId?: string,
    ) => {
      if (!valid()) return;
      await researchStorage<void>(userId!, "readwrite", (s) => {
        s.getAll().onsuccess = (e) => {
          const local = (e.target as IDBRequest<StoredResearch[]>).result;
          for (const record of records) {
            const key = `${kind}:${record.id}`,
              old = local.find((r) => r.key === key) as
                ResearchEntry | undefined;
            if (!old?.pending)
              s.put({
                key,
                kind,
                groupId: groupId!,
                value: record,
                pending: false,
              } satisfies ResearchEntry);
          }
          const ids = new Set(records.map((r) => r.id));
          for (const r of local)
            if (
              r.kind === kind &&
              r.groupId === groupId &&
              !r.pending &&
              (!attachmentId ||
                (r.value as Annotation).attachment_id === attachmentId) &&
              !ids.has(r.value.id)
            )
              s.delete(r.key);
        };
      });
    };
    const sync = async () => {
      if (!valid() || busy || !navigator.onLine) return;
      const signal = controller.signal;
      const running = () => valid() && !signal.aborted;
      busy = true;
      try {
        const all = await allResearch(userId!);
        if (!running()) return;
        if (Date.now() - lastPaperCheck > 60000) {
          for (const paper of all.filter(
            (r): r is CachedPaper => r.kind === "pdf",
          )) {
            if (!running()) return;
            try {
              await api<PaperMeta>(`attachments/${paper.meta.id}/meta`, {
                signal,
              });
            } catch (e) {
              if (e instanceof ApiError && [401, 403, 404].includes(e.status))
                await revokeCachedPaper(userId!, paper.meta.id);
              else throw e;
            }
          }
          lastPaperCheck = Date.now();
        }
        if (!running() || !groupId) return;
        for (const entry of all.filter(
          (r): r is ResearchEntry =>
            r.kind !== "pdf" && r.groupId === groupId && r.pending && !r.error,
        )) {
          if (!running()) return;
          const value = entry.value;
          const endpoint =
            entry.kind === "reading"
              ? "me/reading"
              : `attachments/${(value as Annotation).attachment_id}/annotations/${value.id}`;
          try {
            const data =
              entry.kind === "reading"
                ? readingInputSchema.parse(
                    Object.fromEntries(
                      Object.keys(readingInputSchema.shape).map((k) => [
                        k,
                        k === "data"
                          ? normalizeReadingData(value.data as ReadingData)
                          : (value as any)[k],
                      ]),
                    ),
                  )
                : {
                    id: value.id,
                    data: value.data,
                    version: value.version,
                    mutation_id: value.mutation_id,
                    shared: (value as Annotation).shared,
                    deleted: value.deleted,
                  };
            const saved = await api<ReadingItem | Annotation>(endpoint, {
              method: "PUT",
              body: JSON.stringify(data),
              signal,
            });
            if (!running()) return;
            await updateResearch(userId!, entry.key, (local) => {
              if (!local || local.kind === "pdf") return local;
              return local.value.mutation_id === value.mutation_id
                ? {
                    ...local,
                    value: saved,
                    pending: false,
                    error: undefined,
                    conflict: undefined,
                  }
                : {
                    ...local,
                    value: { ...local.value, version: saved.version },
                  };
            });
          } catch (e) {
            if (!running()) return;
            // Progress is a replaceable position, not authored annotation text.
            // Adopt the singleton ID/revision when another device created it.
            if (
              entry.kind === "reading" &&
              (value as ReadingItem).kind === "progress" &&
              e instanceof ApiError &&
              e.status === 409 &&
              e.data?.current
            ) {
              const remote = e.data.current as ReadingItem;
              await researchStorage<void>(userId!, "readwrite", (s) => {
                s.get(entry.key).onsuccess = (event) => {
                  const local = (
                    event.target as IDBRequest<ResearchEntry | undefined>
                  ).result;
                  if (!local) return;
                  s.put({
                    ...local,
                    key: `reading:${remote.id}`,
                    value: {
                      ...local.value,
                      id: remote.id,
                      version: remote.version,
                      mutation_id: crypto.randomUUID(),
                    },
                    error: undefined,
                    conflict: undefined,
                    pending: true,
                  });
                  if (remote.id !== value.id) s.delete(entry.key);
                };
              });
              continue;
            }
            if (
              (e instanceof ApiError &&
                [400, 401, 403, 404, 409, 422].includes(e.status)) ||
              (e instanceof Error && e.name === "ZodError")
            ) {
              await updateResearch(userId!, entry.key, (local) =>
                local &&
                local.kind !== "pdf" &&
                local.value.mutation_id === value.mutation_id
                  ? {
                      ...local,
                      error: errorMessage(e),
                      ...(e instanceof ApiError && e.status === 409
                        ? { conflict: e.data?.current ?? null }
                        : {}),
                    }
                  : local,
              );
              setStatus(
                "Some reading changes need attention. Open Offline files & reading data.",
              );
            } else throw e;
          }
        }
        if (!running()) return;
        try {
          const records = await api<ReadingItem[]>(
            `me/reading?groupId=${groupId}`,
            { signal },
          );
          if (!running()) return;
          await cacheRemote("reading", records);
        } catch (e) {
          if (e instanceof ApiError && [401, 403, 404].includes(e.status))
            await cacheRemote("reading", []);
          throw e;
        }
        const attachmentId = watched.current;
        if (attachmentId) {
          try {
            const annotations = await api<Annotation[]>(
              `attachments/${attachmentId}/annotations`,
              { signal },
            );
            if (!running()) return;
            await cacheRemote("annotation", annotations, attachmentId);
          } catch (e) {
            if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
              await cacheRemote("annotation", [], attachmentId);
              await revokeCachedPaper(userId!, attachmentId);
            } else throw e;
          }
        }
        if (running()) {
          await refresh();
          const pending = (await allResearch(userId!)).filter(
            (r): r is ResearchEntry =>
              r.kind !== "pdf" && r.groupId === groupId && r.pending,
          );
          if (running())
            setStatus(
              pending.some((r) => r.error)
                ? "Some reading changes need attention. Open Offline files & reading data."
                : pending.length
                  ? "Saved on this device · reading changes awaiting sync"
                  : "Reading data synced",
            );
        }
      } catch (e) {
        if (running())
          setStatus(
            e instanceof ApiError && [401, 403].includes(e.status)
              ? "Access changed. Your unsynced work is retained for export."
              : e instanceof ApiError || e instanceof TypeError
                ? "Reading sync unavailable. Check local changes in Offline files & reading data."
                : errorMessage(e),
          );
      } finally {
        busy = false;
      }
    };
    syncRef.current = sync;
    void refresh();
    void sync();
    const change = () => {
        if (valid()) void refresh();
      },
      tick = () => {
        if (document.visibilityState === "visible") void sync();
      },
      online = () => {
        lastPaperCheck = 0;
        tick();
      };
    const signedOut = (e: StorageEvent) => {
      if (e.key === SIGN_OUT_PENDING && e.newValue) {
        active.current = false;
        controller.abort();
        setEntries([]);
        setPapers([]);
      }
    };
    // A full navigation may not unmount React before asynchronous IDB work
    // finishes. Never launch requests from a departing page; bfcache restores
    // get a fresh request lifetime while queued local mutations stay intact.
    const pageHide = () => {
      leaving = true;
      controller.abort();
    };
    const pageShow = () => {
      if (!leaving) return;
      leaving = false;
      controller = new AbortController();
      online();
    };
    const channel =
      typeof BroadcastChannel === "undefined" || !userId
        ? undefined
        : new BroadcastChannel(`axiom-research:${userId}`);
    if (channel) channel.onmessage = change;
    window.addEventListener("axiom-research", change);
    window.addEventListener("online", online);
    window.addEventListener("focus", online);
    window.addEventListener("storage", signedOut);
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", pageShow);
    const timer = setInterval(tick, 10000);
    return () => {
      alive = false;
      active.current = false;
      controller.abort();
      channel?.close();
      clearInterval(timer);
      window.removeEventListener("axiom-research", change);
      window.removeEventListener("online", online);
      window.removeEventListener("focus", online);
      window.removeEventListener("storage", signedOut);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", pageShow);
    };
  }, [userId, groupId, refresh]);
  const saveReading = useCallback(
    async (
      kind: ReadingItem["kind"],
      target_type: ReadingItem["target_type"],
      target_id: string,
      data: ReadingData,
      existing?: ReadingItem,
    ) => {
      if (!userId || !groupId) throw new Error("Sign in first.");
      const all = await allResearch(userId);
      const old =
        ((
          all.find(
            (r) =>
              r.kind === "reading" &&
              (!r.value.deleted || !!existing) &&
              (existing
                ? r.value.id === existing.id
                : ["progress", "reading"].includes(kind) &&
                  (r.value as ReadingItem).kind === kind &&
                  (r.value as ReadingItem).target_id === target_id),
          ) as ResearchEntry | undefined
        )?.value as ReadingItem | undefined) ?? existing;
      const value = readingInputSchema.parse({
        id: old?.id ?? crypto.randomUUID(),
        group_id: groupId,
        kind,
        target_type,
        target_id,
        data: normalizeReadingData(data),
        version: old?.version ?? 0,
        mutation_id: crypto.randomUUID(),
        deleted: false,
      });
      await storeResearch(userId, {
        key: "reading:" + value.id,
        kind: "reading",
        groupId,
        value,
        pending: true,
      });
      await refresh();
      void syncRef.current();
      return value;
    },
    [userId, groupId, refresh],
  );
  const saveAnnotation = useCallback(
    async (
      attachment_id: string,
      data: AnnotationData,
      shared: boolean,
      existing?: Annotation,
    ) => {
      if (!userId || !groupId) throw new Error("Sign in first.");
      if (shared && !navigator.onLine)
        throw new Error(
          "Sharing annotations requires a connection. Save a private annotation offline.",
        );
      const value: Annotation = {
        id: existing?.id ?? crypto.randomUUID(),
        attachment_id,
        author_id: existing?.author_id ?? userId,
        author_name: existing?.author_name,
        data: annotationDataSchema.parse(data),
        shared,
        version: existing?.version ?? 0,
        mutation_id: crypto.randomUUID(),
        deleted: false,
        updated_at: new Date().toISOString(),
      };
      await storeResearch(userId, {
        key: "annotation:" + value.id,
        kind: "annotation",
        groupId,
        value,
        pending: true,
      });
      await refresh();
      void syncRef.current();
      return value;
    },
    [userId, groupId, refresh],
  );
  const remove = async (entry: ResearchEntry) => {
    if (!userId) return;
    await storeResearch(userId, {
      ...entry,
      value: {
        ...entry.value,
        deleted: true,
        mutation_id: crypto.randomUUID(),
      },
      pending: true,
      error: undefined,
      conflict: undefined,
    });
    await refresh();
    void syncRef.current();
  };
  const resolve = async (entry: ResearchEntry, mine: boolean) => {
    if (!userId) return;
    const remote = entry.conflict;
    if (!mine) {
      if (remote)
        await storeResearch(userId, {
          ...entry,
          key: `${entry.kind}:${remote.id}`,
          value: remote,
          pending: false,
          error: undefined,
          conflict: undefined,
        });
      if (!remote || remote.id !== entry.value.id)
        await removeResearch(userId, entry.key);
    } else {
      const id = remote?.id ?? entry.value.id;
      await storeResearch(userId, {
        ...entry,
        key: `${entry.kind}:${id}`,
        value: {
          ...entry.value,
          id,
          version: remote?.version ?? entry.value.version,
          mutation_id: crypto.randomUUID(),
        },
        pending: true,
        error: undefined,
        conflict: undefined,
      });
      if (id !== entry.value.id) await removeResearch(userId, entry.key);
    }
    await refresh();
    void syncRef.current();
  };
  const watchPaper = useCallback((id: string | null) => {
    watched.current = id;
    if (id) void syncRef.current();
  }, []);
  return {
    groupId,
    entries,
    papers,
    status,
    saveReading,
    saveAnnotation,
    remove,
    resolve,
    watchPaper,
    refresh,
    sync: () => syncRef.current(),
  };
}
export type ResearchController = ReturnType<typeof useResearch>;
