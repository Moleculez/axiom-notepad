"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as Y from "yjs";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import { LocalPersistence } from "../lib/persistence";
import { acquireDocument, releaseDocument } from "../lib/document-sessions";
import {
  type FormatCommand,
  type ParsedDocument,
  type RenderContext,
} from "@axiom/markdown";
import { api, colorFor, ApiError } from "../lib/client";
import {
  cachePointer,
  currentCache,
  recoveryEvent,
  rotateCache,
} from "../lib/editor-recovery";
import type { Preferences } from "@axiom/shared/appearance";
import type { EditorPreferences, EditorCommandId } from "@axiom/shared/editor";
import { NativeBinding } from "../lib/native-editor/binding";
import { type CommandArguments } from "../lib/native-editor/view";
import { EditorView } from "../lib/editor-view";
import { installMarkdownVisuals } from "../lib/visual-surface";
import { selectionRange } from "../lib/native-editor/transactions";
import { resolveAnchor, createMarkAnchor } from "@axiom/editor/annotations";
import type { MarkAnchor } from "@axiom/shared/note-comments";
import type { ReadingBlockRect } from "@axiom/editor/reading-marks";
import type {
  EditorNavigationState,
  NavigationBlock,
  NavigationPosition,
} from "@axiom/editor/minimap";
import { editorAppearanceKey } from "@axiom/shared/minimap";
export type EditorMode = "write" | "source" | "read";
export type CommentAnchor = {
  start: number[];
  end: number[];
  quote: string;
  generation: number;
};
export interface EditorHandle {
  markAnchor: (
    from: number,
    to: number,
    kind?: MarkAnchor["kind"],
    blockType?: string,
  ) => MarkAnchor | null;
  resolveMark: (anchor: MarkAnchor) => { from: number; to: number } | null;
  markGeometry: () => ReadingBlockRect[];
  navigationGeometry: () => NavigationBlock[];
  navigationSnapshot: () => EditorNavigationState | null;
  navigationPosition: (position: number) => NavigationPosition | null;
  execute: (id: EditorCommandId, args?: CommandArguments) => boolean;
  jumpToCollaborator: (clientId: number) => boolean;
  tableActive: () => boolean;
  prepareInsert: (range?: { from: number; to: number }) => void;
  cancelInsert: () => void;
  insert: (value: string) => void;
  format: (command: FormatCommand) => void;
  focus: (position?: number) => void;
  anchor: () => CommentAnchor | null;
  captureSourceRange: (from: number, to: number) => CommentAnchor | null;
  replaceSourceRange: (anchor: CommentAnchor, value: string) => boolean;
  locate: (anchor: CommentAnchor) => boolean;
  flush: () => Promise<void>;
  text: () => string;
  position: () => number;
  visiblePosition: (viewportY: number) => number | null;
}
interface Props {
  note: { id: string; generation: number };
  readOnly?: boolean;
  retainSession?: boolean;
  user: { id: string; name: string };
  mode: EditorMode;
  appearance: Preferences;
  preferences: EditorPreferences;
  onCommand: (command: EditorCommandId) => void;
  onRecover: (text: string) => void | boolean;
  renderContext: RenderContext;
  notes: { id: string; title: string }[];
  annotations?: {
    id: string;
    anchor: CommentAnchor | null;
    resolved?: boolean;
  }[];
  onAnnotation?: (id: string) => void;
  onUnresolvedAnnotations?: (ids: string[]) => void;
  onChange: (source: string, parsed: ParsedDocument) => void;
  onNavigation?: (position: number) => void;
  onStatus: (status: string) => void;
  onPresence: (
    users: { id: string; name: string; color: string; clientId?: number }[],
  ) => void;
  onRefresh: () => void;
  onError: (error: string) => void;
  onLink: (target: string) => void;
  onFiles?: (files: File[]) => void;
}

const Editor = forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const scope = `${props.user.id}:${props.note.id}:${props.note.generation}`;
  const [cache, setCache] = useState(() => ({
    scope,
    id: currentCache(scope),
  }));
  const cacheId = cache.scope === scope ? cache.id : currentCache(scope);
  const container = useRef<HTMLDivElement>(null),
    viewRef = useRef<EditorView | null>(null),
    serverReadOnly = useRef(false),
    docRef = useRef<Y.Doc | null>(null),
    providerRef = useRef<HocuspocusProvider | null>(null),
    pendingInsert = useRef<{
      start: Y.RelativePosition;
      end: Y.RelativePosition;
      text: string;
    } | null>(null),
    propsRef = useRef(props),
    unresolvedAnnotations = useRef<string | null>(null),
    flushRef = useRef<() => Promise<void>>(async () => {}),
    waiters = useRef(
      new Map<
        string,
        { resolve: () => void; reject: (error: Error) => void }
      >(),
    );
  propsRef.current = props;
  const prepareInsert = (range?: { from: number; to: number }) => {
    const view = viewRef.current,
      doc = docRef.current;
    if (!view || !doc) return;
    const { from, to } = range ?? selectionRange(view.selection),
      text = doc.getText("markdown");
    pendingInsert.current = {
      start: Y.createRelativePositionFromTypeIndex(text, from),
      end: Y.createRelativePositionFromTypeIndex(text, to, -1),
      text: view.source.slice(from, to),
    };
  };
  const execute = (id: EditorCommandId, args: CommandArguments = {}) => {
    const view = viewRef.current,
      doc = docRef.current;
    if (!view || !doc) return false;
    const pending = pendingInsert.current;
    pendingInsert.current = null;
    if (pending) {
      const a = Y.createAbsolutePositionFromRelativePosition(
          pending.start,
          doc,
        ),
        b = Y.createAbsolutePositionFromRelativePosition(pending.end, doc);
      if (
        !a ||
        !b ||
        a.index > b.index ||
        view.source.slice(a.index, b.index) !== pending.text
      ) {
        propsRef.current.onError(
          "The insertion location changed. Choose a new location and try again.",
        );
        return false;
      }
      args = { ...args, from: a.index, to: b.index };
    }
    return view.execute(id, args);
  };
  useImperativeHandle(
    ref,
    () => ({
      execute,
      jumpToCollaborator: (clientId) =>
        viewRef.current?.jumpToPeer(clientId) ?? false,
      tableActive: () => viewRef.current?.tableActive() ?? false,
      prepareInsert,
      cancelInsert() {
        pendingInsert.current = null;
      },
      insert(value) {
        execute("paragraph", { value });
      },
      format(command) {
        execute(
          (
            {
              heading: "heading2",
              math: "inlineMath",
              code: "inlineCode",
            } as Record<string, EditorCommandId>
          )[command] ?? (command as EditorCommandId),
        );
      },
      focus(position) {
        const view = viewRef.current;
        if (view)
          view.focus(
            position ?? view.selection.anchor,
            position ?? view.selection.head,
          );
      },
      markAnchor(from, to, kind, blockType) {
        return docRef.current
          ? createMarkAnchor(
              docRef.current,
              propsRef.current.note.generation,
              from,
              to,
              kind,
              blockType,
            )
          : null;
      },
      resolveMark(anchor) {
        return docRef.current
          ? resolveAnchor(
              docRef.current,
              propsRef.current.note.generation,
              anchor,
            )
          : null;
      },
      markGeometry() {
        const view = viewRef.current;
        return view && "markGeometry" in view ? view.markGeometry() : [];
      },
      navigationGeometry() {
        const view = viewRef.current;
        return view && "navigationGeometry" in view
          ? view.navigationGeometry()
          : [];
      },
      navigationSnapshot() {
        const view = viewRef.current;
        return view && "navigationSnapshot" in view
          ? view.navigationSnapshot()
          : null;
      },
      navigationPosition(position) {
        const view = viewRef.current;
        return view && "navigationPosition" in view
          ? view.navigationPosition(position)
          : null;
      },
      anchor() {
        const view = viewRef.current,
          doc = docRef.current;
        if (!view || !doc) return null;
        const { from, to } = selectionRange(view.selection),
          text = doc.getText("markdown");
        if (from === to) return null;
        return {
          start: Array.from(
            Y.encodeRelativePosition(
              Y.createRelativePositionFromTypeIndex(text, from),
            ),
          ),
          end: Array.from(
            Y.encodeRelativePosition(
              Y.createRelativePositionFromTypeIndex(text, to),
            ),
          ),
          quote: view.source.slice(from, to).slice(0, 2000),
          generation: propsRef.current.note.generation,
        };
      },
      captureSourceRange(from, to) {
        const doc = docRef.current,
          view = viewRef.current;
        if (!doc || !view || from < 0 || to > view.source.length || from > to)
          return null;
        const text = doc.getText("markdown");
        return {
          start: Array.from(
            Y.encodeRelativePosition(
              Y.createRelativePositionFromTypeIndex(text, from),
            ),
          ),
          end: Array.from(
            Y.encodeRelativePosition(
              Y.createRelativePositionFromTypeIndex(text, to, -1),
            ),
          ),
          quote: view.source.slice(from, to),
          generation: propsRef.current.note.generation,
        };
      },
      replaceSourceRange(anchor, value) {
        const doc = docRef.current,
          view = viewRef.current;
        if (
          !doc ||
          !view ||
          view.options.readOnly() ||
          anchor.generation !== propsRef.current.note.generation
        )
          return false;
        try {
          const a = Y.createAbsolutePositionFromRelativePosition(
            Y.decodeRelativePosition(new Uint8Array(anchor.start)),
            doc,
          );
          const b = Y.createAbsolutePositionFromRelativePosition(
            Y.decodeRelativePosition(new Uint8Array(anchor.end)),
            doc,
          );
          if (
            !a ||
            !b ||
            a.type !== doc.getText("markdown") ||
            b.type !== a.type ||
            a.index > b.index ||
            view.source.slice(a.index, b.index) !== anchor.quote
          )
            return false;
          view.binding.transact({
            kind: "command",
            changes: [{ from: a.index, to: b.index, insert: value }],
            selection: {
              anchor: a.index + value.length,
              head: a.index + value.length,
            },
          });
          return true;
        } catch {
          return false;
        }
      },
      locate(anchor) {
        const view = viewRef.current,
          doc = docRef.current;
        if (
          !view ||
          !doc ||
          anchor.generation !== propsRef.current.note.generation
        )
          return false;
        try {
          const a = Y.createAbsolutePositionFromRelativePosition(
              Y.decodeRelativePosition(new Uint8Array(anchor.start)),
              doc,
            ),
            b = Y.createAbsolutePositionFromRelativePosition(
              Y.decodeRelativePosition(new Uint8Array(anchor.end)),
              doc,
            );
          if (
            !a ||
            !b ||
            a.type !== doc.getText("markdown") ||
            b.type !== a.type ||
            a.index === b.index
          )
            return false;
          view.focus(a.index, b.index);
          return true;
        } catch {
          return false;
        }
      },
      flush: () => flushRef.current(),
      text: () => docRef.current?.getText("markdown").toString() ?? "",
      position: () => viewRef.current?.position() ?? 0,
      visiblePosition: (y) => viewRef.current?.visiblePosition(y) ?? null,
    }),
    [],
  );
  useEffect(() => {
    if (!container.current) return;
    const requests = new AbortController();
    let alive = true,
      localRevision = 0,
      parseVersion = 0,
      saveTimer: ReturnType<typeof setTimeout> | undefined,
      connected = false,
      accessUnavailable = false,
      temporaryAuthorizationFailure = false,
      localSaved = false,
      localFailed = false,
      quarantined = false,
      recoveryExportOnly = false;
    const localStatus = (message: string) => {
      if (alive)
        propsRef.current.onStatus(
          localFailed
            ? "Device storage unavailable · export your edits"
            : localSaved
              ? message
              : "Saving on device…",
        );
    };
    const room = `${props.note.id}:${props.note.generation}`,
      sessionKey = `${props.user.id}:${room}${cacheId ? ":" + cacheId : ""}`,
      retained = props.retainSession ? acquireDocument(sessionKey) : null,
      doc = retained?.doc ?? new Y.Doc(),
      ytext = doc.getText("markdown");
    docRef.current = doc;
    const persistence = new LocalPersistence(
        `axiom:${sessionKey}`,
        doc,
        (saved, error) => {
          localSaved = saved;
          if (retained) retained.persisted = saved && !error;
          if (error) {
            localFailed = true;
            if (alive)
              propsRef.current.onError(
                "Device storage failed. Keep this tab open and export unsynchronized edits. " +
                  error.message,
              );
          }
          if (!connected || localFailed || accessUnavailable)
            localStatus(
              accessUnavailable
                ? "Access changed · local copy retained"
                : "Saved locally · offline",
            );
        },
      ),
      undoManager = retained?.undo ?? new Y.UndoManager(ytext);
    const setAccess = () => viewRef.current?.configure();
    serverReadOnly.current = !!props.readOnly;
    const retainRecovery = () => {
      const source = ytext.toString();
      if (source && alive && propsRef.current.onRecover(source) === false)
        recoveryExportOnly = true;
      return source;
    };
    const recoverAndReopen = async () => {
      quarantined = true;
      serverReadOnly.current = true;
      setAccess();
      providerRef.current?.configuration.websocketProvider.disconnect();
      const source = retainRecovery();
      // Both the full original journal and a readable snapshot remain durable.
      await persistence.set("recovery", {
        source,
        createdAt: new Date().toISOString(),
      });
      await persistence.set("access-denied", true);
      if (!alive) return;
      if (recoveryExportOnly)
        throw new Error(
          "Download the recovered draft and free device storage before reopening this note. Collaboration is paused to keep the draft safe.",
        );
      if (retained) retained.discard = true;
      rotateCache(scope);
    };
    let worker: Worker | undefined;
    const workerUnavailable = () => {
      worker?.terminate();
      worker = undefined;
      if (alive)
        propsRef.current.onError(
          "Markdown preview stopped. Your source remains editable; reopen this note to retry the preview.",
        );
    };
    try {
      worker = new Worker(new URL("./markdown.worker.ts", import.meta.url));
      worker.onerror = (event) => {
        event.preventDefault();
        workerUnavailable();
      };
    } catch {
      workerUnavailable();
    }
    const parse = () => {
      const source = ytext.toString();
      if (worker) worker.postMessage({ source, version: parseVersion });
      else if (alive && viewRef.current)
        propsRef.current.onChange(source, viewRef.current.engine.parse(source));
    };
    const sendCheck = () =>
      new Promise<void>((resolve, reject) => {
        const currentProvider = providerRef.current;
        if (
          !connected ||
          !currentProvider ||
          accessUnavailable ||
          quarantined
        ) {
          reject(
            new Error(
              "Your edits are saved on this device. Reconnect to save them on the server.",
            ),
          );
          return;
        }
        if (!currentProvider.isSynced || currentProvider.hasUnsyncedChanges) {
          localStatus("Saved locally · synchronizing");
          reject(
            new Error(
              "The server is still acknowledging your edits. Try again once synchronization finishes.",
            ),
          );
          return;
        }
        const id = crypto.randomUUID(),
          revision = localRevision;
        const timeout = setTimeout(() => {
          waiters.current.delete(id);
          localStatus("Saved locally · retrying");
          reject(new Error("The server has not confirmed this save yet."));
        }, 15000);
        waiters.current.set(id, {
          resolve: () => {
            clearTimeout(timeout);
            if (
              alive &&
              revision === localRevision &&
              !accessUnavailable &&
              !quarantined &&
              !currentProvider.hasUnsyncedChanges
            ) {
              propsRef.current.onStatus(
                localFailed
                  ? "Saved on server · device storage unavailable"
                  : "Saved on server",
              );
              void persistence
                .set("server-source", ytext.toString(), true)
                .catch(() => {});
            }
            resolve();
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        currentProvider.sendStateless(
          JSON.stringify({ type: "save-check", id }),
        );
      });
    flushRef.current = sendCheck;
    const transport = new HocuspocusProviderWebsocket({
      autoConnect: false,
      url:
        process.env.NEXT_PUBLIC_SYNC_URL ||
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/sync`,
    });
    const provider = new HocuspocusProvider({
      websocketProvider: transport,
      name: room,
      document: doc,
      token: async () => {
        try {
          await persistence.whenSynced.catch(() => {});
          if (!alive || quarantined) return "";
          temporaryAuthorizationFailure = false;
          const result = await api(`notes/${props.note.id}/sync-token`, {
            method: "POST",
            body: JSON.stringify({ accessProtocol: 1 }),
            signal: requests.signal,
          });
          if (!alive || requests.signal.aborted) return "";
          if (result.room !== room) {
            propsRef.current.onStatus("New version available");
            propsRef.current.onRefresh();
            throw new Error(
              "Document restored elsewhere. Export unsaved local edits before reopening.",
            );
          }
          const epoch = String(result.accessEpoch ?? "0");
          const [previous, denied, saved] = await Promise.all([
            persistence.get<string>("access-epoch", true),
            persistence.get<boolean>("access-denied", true),
            persistence.get<string>("server-source", true),
          ]);
          if (!alive) return "";
          const changed =
            previous !== undefined ? previous !== epoch : !epoch.endsWith(":0");
          if (
            ytext.length &&
            (changed ||
              denied ||
              (result.readOnly && saved !== ytext.toString()))
          ) {
            await recoverAndReopen();
            return "";
          }
          await persistence.set("access-epoch", epoch, true);
          accessUnavailable = false;
          serverReadOnly.current = !!result.readOnly;
          if (alive) setAccess();
          return result.token;
        } catch (error) {
          if (!alive || requests.signal.aborted) return "";
          accessUnavailable =
            quarantined ||
            (error instanceof ApiError &&
              [401, 403, 404, 409].includes(error.status));
          temporaryAuthorizationFailure = !accessUnavailable;
          if (accessUnavailable) {
            serverReadOnly.current = true;
            if (alive) setAccess();
            retainRecovery();
            void persistence.set("access-denied", true, true).catch(() => {});
          }
          localStatus("Saved locally · access unavailable");
          if (alive && navigator.onLine)
            propsRef.current.onError(
              error instanceof Error
                ? error.message
                : "Collaboration access is unavailable.",
            );
          return "";
        }
      },
      onStatus: ({ status }) => {
        connected = status === "connected";
        if (alive)
          localStatus(
            accessUnavailable
              ? "Access changed · local copy retained"
              : connected
                ? "Synchronizing…"
                : "Saved locally · offline",
          );
      },
      onSynced: () => {
        if (alive) {
          parse();
          void sendCheck().catch(() => {});
        }
      },
      onUnsyncedChanges: ({ number }) => {
        if (number === 0 && alive && connected && !quarantined) {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            void sendCheck().catch(() => {});
          }, 50);
        }
      },
      onAuthenticationFailed: () => {
        if (quarantined || !alive) return;
        if (temporaryAuthorizationFailure) {
          // An offline/503 token request is not an access revocation. Keep
          // typing locally and retry authorization without quarantining it.
          transport.disconnect();
          localStatus("Saved locally · retrying connection");
          return;
        }
        accessUnavailable = true;
        serverReadOnly.current = true;
        if (alive) setAccess();
        if (alive) localStatus("Access changed · local copy retained");
        retainRecovery();
        void persistence.set("access-denied", true, true).catch(() => {});
      },
      onClose: ({ event }) => {
        connected = false;
        if (alive)
          localStatus(
            accessUnavailable
              ? "Access changed · local copy retained"
              : navigator.onLine
                ? "Saved locally · reconnecting"
                : "Saved locally · offline",
          );
        // Hocuspocus also closes individual documents without closing their
        // multiplexed socket. Reconnect that socket to rerun authorization.
        if (!("wasClean" in event) && alive && navigator.onLine) {
          const transport =
            providerRef.current?.configuration.websocketProvider;
          if (transport) {
            const reconnect = () => {
              transport.off("disconnect", reconnect);
              if (alive) void transport.connect();
            };
            transport.on("disconnect", reconnect);
            transport.disconnect();
          }
        }
      },
      onStateless: ({ payload }) => {
        try {
          const msg = JSON.parse(payload);
          if (msg.type === "persisted") {
            waiters.current.get(msg.id)?.resolve();
            waiters.current.delete(msg.id);
          }
          if (msg.type === "save-error") {
            if (!msg.id) {
              for (const waiter of waiters.current.values())
                waiter.reject(
                  new Error(
                    "The server could not save this update. Your local copy is retained.",
                  ),
                );
              waiters.current.clear();
            }
            waiters.current
              .get(msg.id)
              ?.reject(
                new Error(
                  "Server storage is unavailable. Your local copy is retained.",
                ),
              );
            waiters.current.delete(msg.id);
            if (alive) localStatus("Saved locally · server unavailable");
          }
          if (msg.type === "workspace-changed" && alive)
            propsRef.current.onRefresh();
        } catch {
          /* Unknown protocol messages are ignored. */
        }
      },
    });
    providerRef.current = provider;
    provider.attach();

    const binding = new NativeBinding(doc, undoManager, provider.awareness);
    // A cached thread may arrive before persistence hydrates this view. Strict
    // Mode remounts must not reuse a notification signature whose callback was
    // discarded by the previous lifecycle's cleanup.
    unresolvedAnnotations.current = null;
    const view = new EditorView(container.current, binding, {
      mode: () => propsRef.current.mode,
      preferences: () => propsRef.current.preferences,
      appearance: () => propsRef.current.appearance,
      context: () => propsRef.current.renderContext,
      readOnly: () => !!propsRef.current.readOnly || serverReadOnly.current,
      workspace: (id) => propsRef.current.onCommand(id),
      message: (message) => propsRef.current.onError(message),
      recover: (source) => propsRef.current.onRecover(source),
      prepare: prepareInsert,
      navigate: (position) => propsRef.current.onNavigation?.(position),
      link: (target) => propsRef.current.onLink(target),
      notes: () =>
        propsRef.current.notes.filter((n) => n.id !== propsRef.current.note.id),
      files: propsRef.current.onFiles
        ? (files) => propsRef.current.onFiles?.(files)
        : undefined,
      annotations: () => {
        const unavailable: string[] = [];
        const ranges = (propsRef.current.annotations ?? []).flatMap((item) => {
          if (!item.anchor || item.resolved) return [];
          const range = resolveAnchor(
            doc,
            propsRef.current.note.generation,
            item.anchor,
          );
          if (!range) {
            unavailable.push(item.id);
            return [];
          }
          return [{ id: item.id, ...range }];
        });
        const signature = unavailable.join(",");
        if (signature !== unresolvedAnnotations.current) {
          unresolvedAnnotations.current = signature;
          queueMicrotask(() => {
            if (alive) propsRef.current.onUnresolvedAnnotations?.(unavailable);
          });
        }
        return ranges;
      },
      annotation: (id) => propsRef.current.onAnnotation?.(id),
      changed: (source, parsed) => {
        if (alive) propsRef.current.onChange(source, parsed);
      },
    });
    viewRef.current = view;
    const closeVisuals = installMarkdownVisuals(view.dom, {
      selection: () => view.selection,
      parsed: () => view.parsed,
      source: () => view.source,
      binding,
      generation: props.note.generation,
      context: () => ({ resourceId: props.note.id }),
      captureRestore: () => {
        const bookmark = binding.relative(view.selection);
        return () => {
          const at = binding.absolute(bookmark);
          if (alive && at) view.focus(at.anchor, at.head);
        };
      },
      editorMenu: (x, y, at) =>
        view.openBlockMenu(x, y, { anchor: at, head: at }),
    });
    const unsubscribe = binding.subscribe(() => {
      localRevision++;
      parseVersion++;
      clearTimeout(saveTimer);
      if (alive)
        localStatus(
          accessUnavailable
            ? "Access changed · local copy retained"
            : connected
              ? "Saving…"
              : "Saved locally · offline",
        );
      saveTimer = setTimeout(() => {
        void sendCheck().catch(() => {});
      }, 600);
    });
    if (retained?.selection) {
      const selection = binding.absolute(retained.selection);
      if (selection) view.setSelection(selection);
    }
    parse();
    let restoredScroll = false;
    if (worker)
      worker.onmessage = (
        event: MessageEvent<{
          version: number;
          parsed?: ParsedDocument;
          error?: string;
        }>,
      ) => {
        if (!alive || event.data.version !== parseVersion) return;
        if (event.data.parsed) {
          propsRef.current.onChange(ytext.toString(), event.data.parsed);
          if (!restoredScroll && retained?.scroll) {
            restoredScroll = true;
            view.scrollDOM.scrollTop = retained.scroll.top;
            view.scrollDOM.scrollLeft = retained.scroll.left;
          }
        } else if (event.data.error) propsRef.current.onError(event.data.error);
      };
    const stopPresence = binding.onPresence((peers) => {
      if (alive)
        propsRef.current.onPresence(
          peers.map((peer) => ({
            id: peer.id,
            clientId: peer.clientId,
            name:
              peer.name +
              (peer.id === props.user.id ? " (your other session)" : ""),
            color: peer.color,
          })),
        );
    });
    provider.setAwarenessField("user", {
      id: props.user.id,
      name: props.user.name,
      color: colorFor(props.user.id),
      colorLight: colorFor(props.user.id) + "22",
    });
    void persistence.whenSynced
      .catch(() => {})
      .then(() => {
        if (alive) {
          parse();
          if (navigator.onLine && !quarantined)
            void transport.connect().catch(() => {});
        }
      })
      .catch(() => {});
    const socket = provider.configuration.websocketProvider;
    let reconnectRequested = false;
    const reconnect = () => {
      if (!alive || quarantined || !navigator.onLine || !reconnectRequested)
        return;
      // disconnect() closes asynchronously. connect() is a no-op while the
      // provider still reports "connected", even if its socket is closing.
      // Resume after its disconnect event instead of losing a fast online event.
      if (
        socket.status === "connected" &&
        socket.webSocket?.readyState !== WebSocket.OPEN
      )
        return;
      reconnectRequested = false;
      void socket
        .connect()
        .catch(() => localStatus("Saved locally · retrying"));
    };
    socket.on("disconnect", reconnect);
    const online = () => {
        reconnectRequested = true;
        reconnect();
      },
      offline = () => {
        reconnectRequested = false;
        connected = false;
        provider.configuration.websocketProvider.disconnect();
        localStatus("Saved locally · offline");
      };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    const resumeVisible = () => {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine &&
        !connected &&
        socket.status !== "connecting"
      )
        online();
    };
    window.addEventListener("focus", resumeVisible);
    window.addEventListener("axiom:connection-restored", resumeVisible);
    document.addEventListener("visibilitychange", resumeVisible);
    if (!navigator.onLine) offline();
    const editorContainer = container.current;
    const cacheChanged = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== cachePointer(scope))
        return;
      if (event instanceof CustomEvent && event.detail !== scope) return;
      const next = currentCache(scope);
      if (next === cacheId || !alive) return;
      quarantined = true;
      serverReadOnly.current = true;
      setAccess();
      transport.disconnect();
      retainRecovery();
      if (retained) retained.discard = true;
      setCache({ scope, id: next });
    };
    window.addEventListener("storage", cacheChanged);
    window.addEventListener(recoveryEvent, cacheChanged);
    const navigateNote = (event: Event) =>
      propsRef.current.onLink((event as CustomEvent<string>).detail);
    editorContainer.addEventListener("axiom-open-note", navigateNote);
    const retry = setInterval(() => {
      if (connected) void sendCheck().catch(() => {});
      else resumeVisible(); // Some browsers miss `online` after an offline reload.
    }, 12000);

    return () => {
      alive = false;
      requests.abort();
      pendingInsert.current = null;
      clearInterval(retry);
      clearTimeout(saveTimer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("storage", cacheChanged);
      window.removeEventListener(recoveryEvent, cacheChanged);
      window.removeEventListener("focus", resumeVisible);
      window.removeEventListener("axiom:connection-restored", resumeVisible);
      document.removeEventListener("visibilitychange", resumeVisible);
      socket.off("disconnect", reconnect);
      editorContainer.removeEventListener("axiom-open-note", navigateNote);
      worker?.terminate();
      unsubscribe();
      stopPresence();
      if (retained) {
        retained.scroll = {
          top: view.scrollDOM.scrollTop,
          left: view.scrollDOM.scrollLeft,
        };
        retained.selection = binding.relative(view.selection);
      }
      closeVisuals();
      view.destroy();
      provider.destroy();
      transport.destroy();
      void persistence.destroy();
      if (retained) releaseDocument(sessionKey);
      else {
        undoManager.destroy();
        doc.destroy();
      }
      for (const waiter of waiters.current.values())
        waiter.reject(new Error("Document closed."));
      waiters.current.clear();
      viewRef.current = null;
      providerRef.current = null;
      docRef.current = null;
    };
  }, [props.note.id, props.note.generation, props.user.id, cacheId]);
  useEffect(() => {
    viewRef.current?.configure();
  }, [
    props.readOnly,
    props.mode,
    props.renderContext,
    editorAppearanceKey(props.appearance),
    props.preferences,
    props.annotations,
  ]);
  return (
    <div className={`research-editor mode-${props.mode}`} ref={container} />
  );
});
export default Editor;
