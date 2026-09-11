"use client";
import { useEffect, useRef, useState } from "react";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import { NativeBinding, type PeerSelection } from "@axiom/editor/binding";
import { LocalPersistence } from "../persistence";
import { acquireDocument, releaseDocument } from "../document-sessions";
import {
  currentCache,
  retainDraft,
  rotateCache,
  cachePointer,
  recoveryEvent,
} from "../editor-recovery";
import { post, ApiError, colorFor, SIGN_OUT_PENDING } from "../client";
import type * as Y from "yjs";
import {
  documentSource,
  type DocumentFormat,
} from "@axiom/shared/document-format";

/** Same room, access-epoch, durable journal and save-check protocol as notes.
 * Math adapters only author bounded source transactions; no second document. */
export function useToolDocument(
  noteId: string,
  generation: number,
  user: { id: string; name: string },
  editable: boolean,
  format: DocumentFormat = "latex",
) {
  const [document, setDocument] = useState<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<
    HocuspocusProvider["awareness"] | null
  >(null);
  const [binding, setBinding] = useState<NativeBinding | null>(null),
    [source, setSource] = useState(""),
    [status, setStatus] = useState("Connecting…"),
    [readOnly, setReadOnly] = useState(true),
    [error, setError] = useState(""),
    [peers, setPeers] = useState<PeerSelection[]>([]),
    [recovery, setRecovery] = useState<string | null>(null);
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const [retry, setRetry] = useState(0);
  const retryConnection = useRef<() => void>(() => {});
  const flush = useRef<() => Promise<void>>(async () => {
    throw new Error("Collaboration is not connected yet.");
  });
  useEffect(() => {
    let alive = true,
      connected = false,
      authorized = false,
      blocked = false,
      localSaved = false,
      localError = false,
      revision = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const scope = `${user.id}:${noteId}:${generation}`,
      cache = currentCache(scope),
      key = `${user.id}:${noteId}:${generation}${cache ? ":" + cache : ""}`,
      session = acquireDocument(key),
      doc = session.doc;
    const sourceValue = () => documentSource(doc, format);
    const journal = new LocalPersistence(`axiom:${key}`, doc, (saved, e) => {
      localSaved = saved;
      session.persisted = saved && !e;
      if (e) {
        localError = true;
        if (alive)
          setError(
            "Device storage is unavailable. Keep this page open and export your source.",
          );
      }
      if (alive && !connected)
        setStatus(saved ? "Saved locally · offline" : "Saving on device…");
    });
    const pending = new Map<
      string,
      {
        resolve: () => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();
    const transport = new HocuspocusProviderWebsocket({
      autoConnect: false,
      url:
        process.env.NEXT_PUBLIC_SYNC_URL ||
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/sync`,
    });
    const quarantine = (message: string) => {
      blocked = true;
      authorized = false;
      if (alive) {
        setReadOnly(true);
        setError(message);
        setRecovery(sourceValue());
        setStatus("Access changed · draft retained");
      }
      void journal.set("access-denied", true, true).catch(() => {});
      try {
        retainDraft(user.id, noteId, sourceValue());
      } catch {
        /* In-memory export remains available. */
      }
      transport.disconnect();
    };
    const check = () =>
      new Promise<void>((resolve, reject) => {
        if (
          !alive ||
          !connected ||
          !authorized ||
          blocked ||
          !provider.isSynced ||
          provider.hasUnsyncedChanges
        ) {
          reject(
            new Error(
              "Reconnect and wait for synchronization before saving a checkpoint.",
            ),
          );
          return;
        }
        const id = crypto.randomUUID(),
          at = revision;
        const deadline = setTimeout(() => {
          pending.delete(id);
          if (alive) setStatus("Saved locally · server confirmation pending");
          reject(new Error("The server has not confirmed the latest save."));
        }, 15000);
        pending.set(id, {
          timer: deadline,
          reject,
          resolve: () => {
            clearTimeout(deadline);
            if (alive && revision === at && !provider.hasUnsyncedChanges) {
              setStatus(
                localError
                  ? "Saved on server · device storage unavailable"
                  : "Saved on server",
              );
              void journal
                .set("server-source", sourceValue(), true)
                .catch(() => {});
            }
            resolve();
          },
        });
        provider.sendStateless(JSON.stringify({ type: "save-check", id }));
      });
    flush.current = check;
    const provider = new HocuspocusProvider({
      websocketProvider: transport,
      name: `${noteId}:${generation}`,
      document: doc,
      token: async () => {
        await journal.whenSynced.catch(() => {});
        if (!alive || blocked || localStorage.getItem(SIGN_OUT_PENDING))
          return "";
        try {
          const result = await post(`notes/${noteId}/sync-token`, {
            accessProtocol: 1,
          });
          if (!alive) return "";
          const epoch = String(result.accessEpoch ?? "0"),
            [previous, denied, saved] = await Promise.all([
              journal.get<string>("access-epoch", true),
              journal.get<boolean>("access-denied", true),
              journal.get<string>("server-source", true),
            ]);
          if (!alive) return "";
          if (
            result.room !== `${noteId}:${generation}` ||
            ((doc.getText("markdown").length ||
              (format === "canvas" && previous !== undefined)) &&
              ((previous !== undefined
                ? previous !== epoch
                : !epoch.endsWith(":0")) ||
                denied ||
                (result.readOnly && saved !== sourceValue())))
          ) {
            quarantine(
              "This project's access or generation changed. Export the retained draft, then reopen the current server version.",
            );
            return "";
          }
          await journal.set("access-epoch", epoch, true);
          await journal.set("authorized-editor", !result.readOnly, true);
          authorized = true;
          setReadOnly(!!result.readOnly || !editableRef.current);
          return result.token;
        } catch (e) {
          if (e instanceof ApiError && [401, 403, 404, 409].includes(e.status))
            quarantine(e.message);
          else if (alive) {
            transport.disconnect();
            setStatus(
              localSaved
                ? "Saved locally · connection unavailable"
                : "Connecting…",
            );
            setError(
              "Collaboration is unavailable. Your local source is retained.",
            );
          }
          return "";
        }
      },
      onStatus: ({ status: s }) => {
        connected = s === "connected";
        if (alive && !blocked)
          setStatus(
            connected
              ? "Synchronizing…"
              : localSaved
                ? "Saved locally · offline"
                : "Connecting…",
          );
      },
      onSynced: () => {
        if (alive && !blocked) {
          setError("");
          void check().catch(() => {});
        }
      },
      onUnsyncedChanges: ({ number }) => {
        if (!number && alive && authorized && !blocked) {
          clearTimeout(timer);
          timer = setTimeout(() => void check().catch(() => {}), 100);
        }
      },
      onAuthenticationFailed: () => {
        if (authorized && !blocked)
          quarantine(
            "Collaboration access changed. Your local draft has not been discarded.",
          );
      },
      onClose: ({ event }) => {
        connected = false;
        if (alive && !blocked && !("wasClean" in event)) {
          authorized = false;
          setReadOnly(true);
          transport.disconnect();
          setStatus("Connection interrupted · reconnecting…");
        }
      },
      onStateless: ({ payload }) => {
        try {
          const value = JSON.parse(payload),
            p = pending.get(value.id);
          if (value.type === "persisted" && p) {
            pending.delete(value.id);
            p.resolve();
          } else if (value.type === "save-error") {
            if (p) {
              clearTimeout(p.timer);
              p.reject(new Error("Server storage is unavailable."));
              pending.delete(value.id);
            }
            if (alive) setStatus("Saved locally · server unavailable");
          }
        } catch {
          /* Ignore unrelated protocol messages. */
        }
      },
    });
    provider.attach();
    setAwareness(provider.awareness);
    const adapter = new NativeBinding(doc, session.undo, provider.awareness);
    setDocument(doc);
    setBinding(adapter);
    setSource(adapter.source);
    const unsubscribe = adapter.subscribe((value) => {
      revision++;
      if (alive) {
        setSource(value);
        // Only the journal's transaction-complete callback may acknowledge a
        // device save. Rendering the new source is not a durability boundary.
        setStatus(connected ? "Saving…" : "Saving on device…");
      }
      clearTimeout(timer);
      timer = setTimeout(() => void check().catch(() => {}), 600);
    });
    const canvasChanged = () => {
      if (format !== "canvas" || !alive) return;
      revision++;
      setSource(sourceValue());
      setStatus(connected ? "Saving…" : "Saving on device…");
      clearTimeout(timer);
      timer = setTimeout(() => void check().catch(() => {}), 600);
    };
    doc.on("update", canvasChanged);
    const presence = adapter.onPresence((value) => {
      if (alive) setPeers(value);
    });
    provider.setAwarenessField("user", {
      id: user.id,
      name: user.name,
      color: colorFor(user.id),
    });
    const reconnect = () => {
      if (
        alive &&
        !blocked &&
        navigator.onLine &&
        !localStorage.getItem(SIGN_OUT_PENDING)
      )
        void transport.connect();
    };
    retryConnection.current = reconnect;
    void journal.whenSynced
      .then(async () => {
        const [editor, denied] = await Promise.all([
          journal.get<boolean>("authorized-editor", true),
          journal.get<boolean>("access-denied", true),
        ]);
        if (alive && !blocked && !navigator.onLine && editor && !denied)
          setReadOnly(!editableRef.current);
        canvasChanged();
      })
      .finally(reconnect)
      .catch(() => {});
    const interval = setInterval(() => {
      if (!connected) reconnect();
    }, 5000);
    const signout = () => {
      blocked = true;
      authorized = false;
      setReadOnly(true);
      transport.disconnect();
    };
    const storage = (e: StorageEvent) => {
      if (e.key === SIGN_OUT_PENDING && e.newValue) signout();
      if (e.key === cachePointer(scope) && e.newValue !== cache) changedCache();
    };
    const changedCache = () => {
      if (!alive || currentCache(scope) === cache) return;
      quarantine(
        "Another view reopened the current server version. Your previous local source is retained for recovery.",
      );
      setRetry((v) => v + 1);
    };
    const cacheEvent = (e: Event) => {
      if ((e as CustomEvent<string>).detail === scope) changedCache();
    };
    window.addEventListener("online", reconnect);
    window.addEventListener("axiom:close-documents", signout);
    window.addEventListener("storage", storage);
    window.addEventListener(recoveryEvent, cacheEvent);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("axiom:close-documents", signout);
      window.removeEventListener("storage", storage);
      window.removeEventListener(recoveryEvent, cacheEvent);
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("Studio closed. Your local journal is retained."));
      }
      unsubscribe();
      doc.off("update", canvasChanged);
      presence();
      adapter.destroy();
      provider.destroy();
      transport.destroy();
      journal.destroy();
      releaseDocument(key);
    };
  }, [noteId, generation, user.id, user.name, retry, format]);
  return {
    binding,
    document,
    awareness,
    source,
    status,
    readOnly: readOnly || !editable,
    error,
    peers,
    recovery,
    flush: () => flush.current(),
    reconnect: () => retryConnection.current(),
    reopen: () => {
      rotateCache(`${user.id}:${noteId}:${generation}`);
      setRecovery(null);
      setRetry((v) => v + 1);
    },
  };
}
