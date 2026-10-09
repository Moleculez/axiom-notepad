"use client";
import { currentLocale } from "@axiom/i18n/client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  Check,
  ChevronRight,
  FileArchive,
  FileText,
  FolderInput,
  Import,
  Pause,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import {
  Button,
  Field,
  HelpText,
  NativeSelect,
  Notice,
  Picker,
  ActionRow,
} from "../ui/controls";
import Dialog, { DialogFooter } from "../Dialog";
import { api, errorMessage, SIGN_OUT_PENDING } from "../../lib/client";
import { droppedInventory } from "../../lib/folder-drop";
import { transferUpload } from "../../lib/upload-transfer";
import { beginWorkspaceActivity } from "../../lib/workspace-activity";
import type {
  ImportInventory,
  ImportInventoryInput,
} from "../../lib/workspace-import-inventory";
import type {
  ImportConflict,
  ImportManifest,
  ImportSource,
  WorkspaceImportBatch,
  WorkspaceImportPreview,
  WorkspaceImportPoll,
} from "@axiom/shared/workspace-import";
import { retainImportReceipt } from "@axiom/shared/workspace-import";
import { bytes, useWorkspace, ResourceIcon } from "./ui";
const PlanningMarkdown = dynamic(() => import("./PlanningMarkdown"), {
  loading: () => (
    <div className="import-preview-empty" role="status">
      <FileText size={24} aria-hidden="true" />
      <p>
        <I18nText id="Loading local preview…" />
      </p>
    </div>
  ),
});
const CanvasPlayground = dynamic(() => import("../tools/CanvasPlayground"), {
  loading: () => (
    <div className="import-preview-empty" role="status">
      <I18nText id="Loading local Canvas preview…" />
    </div>
  ),
});

type ImportTarget = { spaceId: string; parentId?: string | null };
type Draft = ImportTarget & {
  source: ImportSource;
  resume?: WorkspaceImportBatch;
};
const root = (batch: Pick<WorkspaceImportBatch, "spaceId" | "id">) =>
  `spaces/${batch.spaceId}/imports/${batch.id}`;
const manifestFor = (batch: WorkspaceImportBatch): ImportManifest => ({
  source: batch.source,
  parentId: batch.parentId,
  conflict: batch.conflict,
  diagnostics: batch.diagnostics,
  entries: batch.entries.map(
    ({
      id,
      path,
      kind,
      bytes,
      digest,
      sourceFormat,
      metadata,
      expectedSha256,
      asAttachment,
    }) => ({
      id,
      path,
      kind,
      bytes,
      digest,
      sourceFormat,
      metadata,
      expectedSha256,
      asAttachment,
    }),
  ),
});

export function useWorkspaceImports(
  userId: string | undefined,
  onComplete: () => void,
) {
  const [batches, setBatches] = useState<WorkspaceImportBatch[]>([]),
    [draft, setDraft] = useState<Draft | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(""),
    [progress, setProgress] = useState<Record<string, number>>({}),
    [runningIds, setRunningIds] = useState<string[]>([]);
  const owner = useRef(userId),
    running = useRef(new Map<string, AbortController>()),
    originals = useRef(new Map<string, ImportInventory>()),
    queue = useRef(Promise.resolve()),
    completed = useRef(new Set<string>()),
    initialized = useRef(false),
    done = useRef(onComplete);
  const snapshot = useRef(batches),
    selectedId = useRef(selected),
    refreshing = useRef(false),
    generation = useRef(0);
  snapshot.current = batches;
  selectedId.current = selected;
  owner.current = userId;
  done.current = onComplete;
  const merge = (batch: WorkspaceImportBatch) =>
    setBatches((old) => [
      retainImportReceipt(
        old.find((item) => item.id === batch.id),
        batch,
      ),
      ...old.filter((item) => item.id !== batch.id),
    ]);
  const refresh = useCallback(async () => {
    if (!userId || refreshing.current) return;
    refreshing.current = true;
    const token = generation.current;
    try {
      const items = !initialized.current
        ? await api<WorkspaceImportBatch[]>("me/imports")
        : await (async () => {
            const polls = await api<WorkspaceImportPoll[]>(
                "me/imports?compact=1",
              ),
              previous = new Map(snapshot.current.map((b) => [b.id, b]));
            const items = await Promise.all(
              polls.map(async (poll) => {
                const saved = previous.get(poll.id);
                if (
                  !saved ||
                  (poll.status === "complete" && saved.status !== "complete")
                )
                  return api<WorkspaceImportBatch>(root(poll));
                const states = new Map(
                  poll.entries.map((entry) => [entry.id, entry]),
                );
                return {
                  ...saved,
                  ...poll,
                  entries: saved.entries.map((entry) => ({
                    ...entry,
                    ...states.get(entry.id),
                  })),
                };
              }),
            );
            // The bounded recovery ledger is not the identity of an open/running
            // transfer. Keep its exact receipt even when other active batches
            // push it outside the latest 30 entries.
            const present = new Set(items.map((item) => item.id));
            for (const id of new Set([
              selectedId.current,
              ...running.current.keys(),
            ])) {
              const saved = id && previous.get(id);
              if (saved && !present.has(saved.id)) {
                try {
                  items.unshift(await api<WorkspaceImportBatch>(root(saved)));
                } catch {
                  items.unshift(saved);
                }
              }
            }
            return items;
          })();
      if (owner.current !== userId || generation.current !== token) return;
      for (const item of items)
        if (item.status === "complete" && !completed.current.has(item.id)) {
          completed.current.add(item.id);
          originals.current.delete(item.id);
          if (initialized.current) done.current();
        }
      initialized.current = true;
      setBatches((old) => {
        const previous = new Map(old.map((item) => [item.id, item]));
        return items.map((item) =>
          retainImportReceipt(previous.get(item.id), item),
        );
      });
    } finally {
      if (generation.current === token) refreshing.current = false;
    }
  }, [userId]);
  useEffect(() => {
    generation.current++;
    refreshing.current = false;
    setBatches([]);
    setDraft(null);
    setSelected(null);
    setError("");
    setProgress({});
    setRunningIds([]);
    completed.current.clear();
    initialized.current = false;
    originals.current.clear();
    for (const controller of running.current.values()) controller.abort();
    running.current.clear();
    if (userId) void refresh().catch(() => {});
    const stop = () => {
      for (const controller of running.current.values()) controller.abort();
      originals.current.clear();
    };
    window.addEventListener("axiom:close-documents", stop);
    return () => {
      stop();
      window.removeEventListener("axiom:close-documents", stop);
    };
  }, [userId, refresh]);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void refresh().catch(() => {});
    };
    window.addEventListener("focus", visible);
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", visible);
      window.removeEventListener("online", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  const active =
    runningIds.length > 0 ||
    batches.some(
      (batch) =>
        batch.status === "publishing" ||
        (batch.status === "preparing" &&
          batch.entries.some((entry) => entry.status === "verifying")),
    );
  useEffect(() => {
    if (!active) return;
    // Quiet status checks never activate the app's foreground loading bar.
    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void refresh().catch(() => {});
    }, 1800);
    return () => clearInterval(interval);
  }, [active, refresh]);
  const run = (batch: WorkspaceImportBatch, inventory: ImportInventory) => {
    if (
      !userId ||
      running.current.has(batch.id) ||
      owner.current !== userId ||
      localStorage.getItem(SIGN_OUT_PENDING)
    )
      return;
    originals.current.set(batch.id, inventory);
    const controller = new AbortController();
    running.current.set(batch.id, controller);
    setRunningIds([...running.current.keys()]);
    const signal = controller.signal,
      valid = () => {
        signal.throwIfAborted();
        if (owner.current !== userId || localStorage.getItem(SIGN_OUT_PENDING))
          throw new DOMException("Import paused", "AbortError");
      };
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          valid();
          const files = new Map(
            inventory.files.map((item) => [item.path, item.file]),
          );
          for (const entry of batch.entries.filter(
            (entry) =>
              entry.kind !== "folder" &&
              entry.disposition === "create" &&
              !["staged", "complete", "verifying"].includes(entry.status ?? ""),
          )) {
            valid();
            const file = files.get(entry.path);
            if (!file)
              throw new Error(
                `Reselect the original collection. Missing: ${entry.path}`,
              );
            const base = `${root(batch)}/entries/${entry.id}`;
            await api(base + "/prepare", {
              method: "POST",
              signal,
              body: "{}",
            });
            await transferUpload(file, base, {
              signal,
              valid,
              progress: (received) => {
                if (owner.current === userId)
                  setProgress((old) => ({ ...old, [entry.id]: received }));
              },
            });
          }
          valid();
          // A coalesced ledger read may have started before the last part was
          // accepted. Read this exact batch after completion so verification or
          // publication remains observed even when no browser transfer is running.
          const latest = await api<WorkspaceImportBatch>(root(batch), {
            signal,
          });
          valid();
          merge(latest);
          if (
            latest.status === "complete" &&
            !completed.current.has(latest.id)
          ) {
            completed.current.add(latest.id);
            originals.current.delete(latest.id);
            done.current();
          }
          await refresh();
        } catch (e) {
          if (owner.current === userId && !signal.aborted)
            setError(errorMessage(e));
        } finally {
          if (running.current.get(batch.id) === controller)
            running.current.delete(batch.id);
          if (owner.current === userId)
            setRunningIds([...running.current.keys()]);
        }
      });
  };
  return {
    batches,
    draft,
    selected,
    error,
    progress,
    runningIds,
    refresh,
    open: useCallback((source: ImportSource, target: ImportTarget) => {
      setSelected(null);
      setDraft({ ...target, source });
      setError("");
    }, []),
    closeDraft: () => setDraft(null),
    close: () => setSelected(null),
    view: (batch: WorkspaceImportBatch) => {
      setDraft(null);
      setSelected(batch.id);
      setError("");
    },
    begin: async (
      manifest: ImportManifest,
      inventory: ImportInventory,
      preview: WorkspaceImportPreview,
      identity: string,
      spaceId: string,
    ) => {
      const batch = await api<WorkspaceImportBatch>(
        `spaces/${spaceId}/imports`,
        {
          method: "POST",
          body: JSON.stringify({
            id: identity,
            manifest,
            fingerprint: preview.fingerprint,
          }),
        },
      );
      if (owner.current !== userId)
        throw new Error(
          "The import account changed. Inspect the original import after signing back in.",
        );
      merge(batch);
      setDraft(null);
      setSelected(batch.id);
      run(batch, inventory);
    },
    resume: (batch: WorkspaceImportBatch) => {
      const inventory = originals.current.get(batch.id);
      if (inventory) {
        setError("");
        run(batch, inventory);
      } else {
        setSelected(null);
        setDraft({
          source: batch.source,
          spaceId: batch.spaceId,
          parentId: batch.parentId,
          resume: batch,
        });
      }
    },
    resumeSelected: async (
      batch: WorkspaceImportBatch,
      inventory: ImportInventory,
    ) => {
      const incoming = new Map(
        inventory.entries.map((entry) => [entry.path, entry]),
      );
      for (const entry of batch.entries.filter(
        (e) =>
          e.disposition === "create" &&
          e.kind !== "folder" &&
          !["staged", "complete", "verifying"].includes(e.status ?? ""),
      )) {
        const original = incoming.get(entry.path);
        if (
          !original ||
          original.bytes !== entry.bytes ||
          original.digest !== entry.digest
        )
          throw new Error(
            `This is not the reviewed original: ${entry.path}. Choose the matching file/folder/ZIP.`,
          );
      }
      setDraft(null);
      setSelected(batch.id);
      run(batch, inventory);
    },
    pause: (batch: WorkspaceImportBatch) => {
      running.current.get(batch.id)?.abort();
      running.current.delete(batch.id);
      setRunningIds([...running.current.keys()]);
    },
    cancel: async (batch: WorkspaceImportBatch) => {
      running.current.get(batch.id)?.abort();
      const cancelled = await api<WorkspaceImportBatch>(
        root(batch) + "/cancel",
        {
          method: "POST",
          body: "{}",
        },
      );
      if (owner.current !== userId) return;
      merge(cancelled);
      originals.current.delete(batch.id);
      running.current.delete(batch.id);
      setRunningIds([...running.current.keys()]);
      setError("");
    },
    review: (batch: WorkspaceImportBatch) => {
      setSelected(null);
      setDraft({
        source: batch.source,
        spaceId: batch.spaceId,
        parentId: batch.parentId,
        resume: batch,
      });
    },
    recheck: async (
      batch: WorkspaceImportBatch,
      preview: WorkspaceImportPreview,
    ) => {
      const updated = await api<WorkspaceImportBatch>(
        root(batch) + "/recheck",
        {
          method: "POST",
          body: JSON.stringify({ fingerprint: preview.fingerprint }),
        },
      );
      if (owner.current !== userId) return;
      merge(updated);
      setDraft(null);
      setSelected(batch.id);
      const inventory = originals.current.get(batch.id);
      if (inventory) run(updated, inventory);
    },
  };
}
export type WorkspaceImportsController = ReturnType<typeof useWorkspaceImports>;

export function ImportTransfers({
  controller,
  closeUploads,
}: {
  controller: WorkspaceImportsController;
  closeUploads: () => void;
}) {
  useInterfaceLocale();
  if (!controller.batches.length) return null;
  return (
    <section
      className="import-transfers"
      aria-label={uiText("Workspace imports")}
    >
      <header>
        <h3>
          <I18nText id="Workspace imports" />
        </h3>
        <span>
          <I18nText id="Prepared privately · published together" />
        </span>
      </header>
      <div>
        {controller.batches
          .filter((b) => b.status !== "cancelled")
          .slice(0, 10)
          .map((batch) => (
            <button
              className="import-transfer-row"
              type="button"
              key={batch.id}
              onClick={() => {
                closeUploads();
                controller.view(batch);
              }}
            >
              <Import size={17} />
              <span>
                <strong>
                  {batch.source === "markdown"
                    ? uiText("Markdown files")
                    : (batch.entries.find((e) => e.kind === "folder")?.path ??
                      "Folder import")}
                </strong>
                <small>
                  {batch.entries.length} <I18nText id="items ·" />{" "}
                  {batch.status}
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
      </div>
    </section>
  );
}

export default function WorkspaceImportsHost({
  controller,
}: {
  controller: WorkspaceImportsController;
}) {
  useInterfaceLocale();
  const workspace = useWorkspace(),
    batch = controller.batches.find((b) => b.id === controller.selected),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState("");
  const action = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setActionError("");
    try {
      await work();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (controller.draft)
    return (
      <ImportDialog
        key={
          controller.draft.resume?.id ??
          `${controller.draft.spaceId}:${controller.draft.parentId}:${controller.draft.source}`
        }
        draft={controller.draft}
        controller={controller}
      />
    );
  if (!batch) return null;
  const totals = batch.entries.filter((e) => e.disposition === "create"),
    totalBytes = totals.reduce((sum, e) => sum + e.bytes, 0),
    received = totals.reduce(
      (sum, e) =>
        sum + Math.min(e.bytes, controller.progress[e.id] ?? e.received ?? 0),
      0,
    ),
    isRunning = controller.runningIds.includes(batch.id),
    complete = batch.status === "complete",
    cancelled = batch.status === "cancelled",
    first =
      batch.result?.resources.find(
        (r) => r.kind === "folder" && r.parentId === batch.parentId,
      ) ??
      batch.result?.resources.find((r) => r.kind === "note") ??
      batch.result?.resources[0];
  return (
    <Dialog
      title={
        complete
          ? uiText("Import complete")
          : cancelled
            ? "Import cancelled"
            : "Import progress"
      }
      subtitle={`${workspace.spaces.find((s) => s.id === batch.spaceId)?.name ?? "Workspace"} · ${totals.length} new items`}
      onClose={controller.close}
      className="workspace-import-dialog"
    >
      <div className="import-progress-summary">
        <span>{complete ? <Check size={20} /> : <Import size={20} />}</span>
        <div>
          <strong>
            {complete
              ? uiText("Your files are ready")
              : cancelled
                ? "Private preparation discarded"
                : batch.status === "publishing"
                  ? "Publishing the complete collection"
                  : batch.status === "blocked"
                    ? "Review needed — originals unchanged"
                    : "Preparing privately"}
          </strong>
          <p>
            {complete
              ? uiText(
                  "Native documents are now editable and collaborative. Supporting files and safe metadata retain their reviewed hierarchy.",
                )
              : cancelled
                ? "No files were published by this import. Existing contents are unchanged."
                : "Nothing is visible to other members until every item is ready. You can close this dialog and keep working."}
          </p>
        </div>
      </div>
      {!complete && !cancelled && (
        <div className="import-meter">
          <progress
            aria-label={uiText("Import transferred bytes")}
            max={Math.max(1, totalBytes)}
            value={received}
          />
          <span>
            {bytes(received)} / {bytes(totalBytes)} · {batch.status}
          </span>
        </div>
      )}
      {(actionError || controller.error || batch.error) && (
        <Notice tone="danger">
          {actionError || controller.error || batch.error}
        </Notice>
      )}
      <div
        className="import-entry-list"
        role="list"
        aria-label={uiText("Import entries")}
      >
        {batch.entries.map((entry) => (
          <div className="import-entry-row" role="listitem" key={entry.id}>
            <ResourceIcon resource={{ kind: entry.kind }} />
            <span>
              <strong title={entry.path}>{entry.path}</strong>
              {entry.name !==
                entry.path
                  .split("/")
                  .at(-1)
                  ?.replace(/\.(md|markdown)$/i, "") && (
                <small>
                  <I18nText id="Saved as" /> {entry.name}
                </small>
              )}
            </span>
            <small>
              {entry.disposition === "skip"
                ? uiText("Skipped")
                : cancelled
                  ? "Cancelled"
                  : entry.disposition === "merge"
                    ? "Merged folder"
                    : entry.kind === "folder" || complete
                      ? "Ready"
                      : entry.status === "staged"
                        ? "Ready"
                        : entry.status}
            </small>
          </div>
        ))}
      </div>
      {!!batch.result?.warnings.length && (
        <details className="import-warnings">
          <summary>
            {batch.result.warnings.length}{" "}
            <I18nText id="unresolved links (source retained)" />
          </summary>
          <ul>
            {batch.result.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      {!complete && !cancelled && (
        <HelpText>
          <I18nText id="Private preparation expires" />{" "}
          {new Date(batch.expiresAt).toLocaleDateString(currentLocale())}
          <I18nText id=". Reloaded transfers resume after reselecting the same originals." />
        </HelpText>
      )}
      <DialogFooter>
        {!["complete", "cancelled"].includes(batch.status) && (
          <Button
            data-dialog-cancel
            variant="danger"
            disabled={busy}
            onClick={() => void action(() => controller.cancel(batch))}
          >
            <X size={16} />
            <I18nText id="Cancel import" />
          </Button>
        )}
        <Button variant="secondary" onClick={controller.close}>
          {complete ? uiText("Done") : uiText("Continue working")}
        </Button>
        {batch.status === "blocked" ? (
          <Button onClick={() => controller.review(batch)}>
            <RotateCcw size={16} />
            <I18nText id="Review destination" />
          </Button>
        ) : (
          batch.status === "preparing" &&
          (isRunning ? (
            <Button variant="secondary" onClick={() => controller.pause(batch)}>
              <Pause size={16} />
              <I18nText id="Pause" />
            </Button>
          ) : (
            <Button onClick={() => controller.resume(batch)}>
              <Upload size={16} />
              <I18nText id="Resume import" />
            </Button>
          ))
        )}
        {complete && first && (
          <Button
            onClick={() => {
              controller.close();
              if (first.kind === "folder")
                workspace.navigate(
                  `/workspaces/${batch.spaceId}/files?folder=${first.id}`,
                );
              else workspace.open({ ...first, space_id: batch.spaceId });
            }}
          >
            <ArrowRight size={16} />
            <I18nText id="Open" />{" "}
            {first.kind === "folder" ? uiText("folder") : uiText("file")}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}

function ImportDialog({
  draft,
  controller,
}: {
  draft: Draft;
  controller: WorkspaceImportsController;
}) {
  useInterfaceLocale();
  const workspace = useWorkspace(),
    [source, setSource] = useState(draft.source),
    [spaceId, setSpaceId] = useState(draft.spaceId),
    [conflict, setConflict] = useState<ImportConflict>(
      draft.resume?.conflict ?? "keepBoth",
    ),
    [inventory, setInventory] = useState<ImportInventory | null>(null),
    [preview, setPreview] = useState<WorkspaceImportPreview | null>(null),
    [selectedPath, setSelectedPath] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(false),
    [label, setLabel] = useState(""),
    [revision, setRevision] = useState(0);
  const [previewMode, setPreviewMode] = useState<"preview" | "source">(
    "preview",
  );
  const lastInput = useRef<ImportInventoryInput | null>(null);
  const picker = useRef<HTMLInputElement>(null),
    worker = useRef<Worker | null>(null),
    sequence = useRef(0),
    identity = useRef(crypto.randomUUID());
  const parentId = spaceId === draft.spaceId ? (draft.parentId ?? null) : null;
  const manifest = useMemo<ImportManifest | null>(
    () =>
      draft.resume
        ? manifestFor(draft.resume)
        : inventory
          ? {
              source,
              parentId,
              conflict,
              entries: inventory.entries,
              diagnostics: inventory.diagnostics,
            }
          : null,
    [draft.resume, inventory, source, parentId, conflict],
  );
  const localActivity = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      sequence.current++;
      worker.current?.terminate();
      localActivity.current?.();
    },
    [],
  );
  useEffect(() => {
    setPreview(null);
    if (!manifest || !spaceId) {
      setChecking(false);
      return;
    }
    const abort = new AbortController();
    setChecking(true);
    setError("");
    void api<WorkspaceImportPreview>(`spaces/${spaceId}/imports/preview`, {
      method: "POST",
      signal: abort.signal,
      body: JSON.stringify(manifest),
    })
      .then((value) => {
        if (!abort.signal.aborted) setPreview(value);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setChecking(false);
      });
    return () => abort.abort();
  }, [manifest, spaceId, revision]);
  const read = (input: ImportInventoryInput) => {
    // A resume reuses frozen conversion choices; bytes still need to match.
    if (draft.resume && !input.decisions)
      input = {
        ...input,
        decisions: Object.fromEntries(
          draft.resume.entries
            .filter((entry) => entry.asAttachment)
            .map((entry) => [entry.path, "attachment" as const]),
        ),
      };
    lastInput.current = input;
    const token = ++sequence.current;
    worker.current?.terminate();
    localActivity.current?.();
    if (!input.decisions) setInventory(null);
    setError("");
    setBusy(true);
    setLabel("Reading local files…");
    identity.current = crypto.randomUUID();
    const finishActivity = beginWorkspaceActivity();
    localActivity.current = finishActivity;
    try {
      const instance = new Worker(
        new URL("../../lib/workspace-import.worker.ts", import.meta.url),
      );
      worker.current = instance;
      instance.onmessage = (
        event: MessageEvent<{
          inventory?: ImportInventory;
          progress?: string;
          error?: string;
        }>,
      ) => {
        if (sequence.current !== token) return;
        if (event.data.progress) {
          setLabel(event.data.progress);
          return;
        }
        finishActivity();
        instance.terminate();
        worker.current = null;
        setBusy(false);
        setLabel("");
        if (event.data.error) setError(event.data.error);
        else if (event.data.inventory) {
          setInventory(
            draft.resume
              ? {
                  ...event.data.inventory,
                  diagnostics: draft.resume.diagnostics ?? [],
                }
              : event.data.inventory,
          );
          setSelectedPath(
            event.data.inventory.entries.find((entry) => entry.kind === "note")
              ?.path ?? "",
          );
        }
      };
      instance.onerror = () => {
        if (sequence.current === token) {
          finishActivity();
          instance.terminate();
          setBusy(false);
          setError(
            "The local import worker failed. Reselect the collection to retry.",
          );
        }
      };
      instance.postMessage(input);
    } catch (e) {
      finishActivity();
      setBusy(false);
      setError(errorMessage(e));
    }
  };
  const reviewOnly = draft.resume?.status === "blocked";
  const execute = async () => {
    if (!manifest || !preview) return;
    setBusy(true);
    setError("");
    const finish = beginWorkspaceActivity();
    try {
      if (reviewOnly) await controller.recheck(draft.resume!, preview);
      else if (draft.resume && inventory)
        await controller.resumeSelected(draft.resume, inventory);
      else if (inventory)
        await controller.begin(
          manifest,
          inventory,
          preview,
          identity.current,
          spaceId,
        );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      finish();
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={
        reviewOnly
          ? uiText("Review import destination")
          : draft.resume
            ? "Resume import"
            : "Import into workspace"
      }
      subtitle={uiText(
        "Native documents, canvases and supporting files — one reviewed collection.",
      )}
      className="workspace-import-dialog"
      onClose={controller.closeDraft}
    >
      <div className="import-fields">
        <Field label={uiText("Import")}>
          <NativeSelect
            value={source}
            disabled={busy || !!draft.resume}
            onChange={(event) => {
              sequence.current++;
              worker.current?.terminate();
              setSource(event.target.value as ImportSource);
              setInventory(null);
              setPreview(null);
              setError("");
            }}
          >
            <option value="markdown">
              <I18nText id="Markdown files" />
            </option>
            <option value="canvas">
              <I18nText id="Canvas files" />
            </option>
            <option value="folder">
              <I18nText id="Folder with notes & files" />
            </option>
            <option value="zip">
              <I18nText id="ZIP archive" />
            </option>
          </NativeSelect>
        </Field>
        <Field label={uiText("Workspace")}>
          <Picker
            label={uiText("Workspace")}
            required
            value={spaceId}
            disabled={busy || !!draft.resume}
            onChange={(value) => setSpaceId(String(value))}
            options={workspace.spaces
              .filter(
                (s) => s.role === "editor" && s.effective_status === "active",
              )
              .map((space) => ({
                value: space.id,
                label: space.name,
                description:
                  space.kind === "personal"
                    ? "Personal · only you"
                    : space.group_name,
              }))}
          />
        </Field>
        <Field label={uiText("Matching names")}>
          <NativeSelect
            value={conflict}
            disabled={busy || !!draft.resume}
            onChange={(event) =>
              setConflict(event.target.value as ImportConflict)
            }
          >
            <option value="keepBoth">
              <I18nText id="Keep both · numbered copies" />
            </option>
            <option value="merge">
              <I18nText id="Merge folders · separate file copies" />
            </option>
            <option value="skip">
              <I18nText id="Skip matching items" />
            </option>
          </NativeSelect>
        </Field>
      </div>
      <div className="import-destination">
        <FolderInput size={17} />
        <span>
          {preview?.destination.spaceName ??
            workspace.spaces.find((s) => s.id === spaceId)?.name}
          {preview?.destination.breadcrumbs.map((item) => (
            <span key={item.id}>
              <ChevronRight size={13} />
              {item.name}
            </span>
          ))}
          {!parentId && (
            <small>
              <I18nText id="Workspace root" />
            </small>
          )}
        </span>
        <small>
          {preview?.destination.audience ?? "Destination permissions apply"}
        </small>
      </div>
      {!reviewOnly && (
        <div
          className="import-dropzone"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (busy) return;
            void droppedInventory(event.dataTransfer)
              .then(({ files, directories }) => {
                read({
                  source,
                  files: files.map((file) => ({
                    file,
                    path: file.webkitRelativePath || file.name,
                  })),
                  directories,
                });
              })
              .catch((e) => setError(errorMessage(e)));
          }}
        >
          <span aria-hidden="true">
            {source === "markdown" ? (
              <FileText size={24} />
            ) : source === "folder" ? (
              <FolderInput size={24} />
            ) : (
              <FileArchive size={24} />
            )}
          </span>
          <div>
            <strong>
              {inventory
                ? `${inventory.entries.length} items selected`
                : uiText("Drop your collection here")}
            </strong>
            <p>
              {source === "markdown"
                ? uiText(".md and .markdown become editable notes")
                : source === "canvas"
                  ? ".canvas becomes an editable board; originals are retained"
                  : source === "folder"
                    ? "Keep folders, notes and supporting files together"
                    : "One ZIP · 50 MB compressed / 100 MB expanded"}
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            {inventory
              ? uiText("Choose again")
              : source === "folder"
                ? "Choose folder"
                : source === "zip"
                  ? "Choose ZIP"
                  : "Choose files"}
          </Button>
        </div>
      )}
      <input
        key={source}
        type="file"
        hidden
        ref={picker}
        accept={
          source === "markdown"
            ? ".md,.markdown"
            : source === "canvas"
              ? ".canvas,application/json"
              : source === "zip"
                ? ".zip"
                : undefined
        }
        multiple={source !== "zip"}
        {...(source === "folder" ? { webkitdirectory: "" } : {})}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          if (files.length)
            read({
              source,
              files: files.map((file) => ({
                file,
                path: file.webkitRelativePath || file.name,
              })),
            });
          event.currentTarget.value = "";
        }}
      />
      {(busy || checking) && (
        <p className="import-local-progress" role="status">
          {label || (busy ? "Preparing import…" : "Checking destination…")}
        </p>
      )}
      {error && (
        <Notice tone="danger">
          {error}
          <Button
            variant="ghost"
            onClick={() => setRevision((v) => v + 1)}
            disabled={!manifest || busy}
          >
            <I18nText id="Refresh preview" />
          </Button>
        </Notice>
      )}
      {preview && (
        <>
          <div className="import-counts" aria-label={uiText("Import summary")}>
            <span>
              <strong>{preview.counts.notes}</strong> <I18nText id="notes" />
            </span>
            <span>
              <strong>{preview.counts.files}</strong> <I18nText id="files" />
            </span>
            <span>
              <strong>{preview.counts.folders}</strong>{" "}
              <I18nText id="folders" />
            </span>
            <span>{bytes(preview.counts.bytes)}</span>
            {preview.counts.conflicts > 0 && (
              <span>
                {preview.counts.conflicts} <I18nText id="matching names" />
              </span>
            )}
            {preview.counts.skipped > 0 && (
              <span>
                {preview.counts.skipped} <I18nText id="skipped" />
              </span>
            )}
          </div>
          <div className="import-review">
            <div
              className="import-entry-list"
              aria-label={uiText("Selected collection")}
            >
              {preview.entries.map((entry) => (
                <button
                  className="import-entry-row"
                  type="button"
                  key={entry.id}
                  aria-pressed={entry.path === selectedPath}
                  disabled={
                    entry.kind !== "note" ||
                    (!inventory?.previews[entry.path] &&
                      inventory?.previews[entry.path] !== "")
                  }
                  onClick={() => setSelectedPath(entry.path)}
                >
                  <ResourceIcon resource={{ kind: entry.kind }} />
                  <span>
                    <strong title={entry.path}>{entry.path}</strong>
                    <small>
                      {entry.disposition === "skip"
                        ? uiText("Skip")
                        : entry.disposition === "merge"
                          ? "Merge folder"
                          : entry.conflict
                            ? `Keep as ${entry.name}`
                            : entry.kind === "note"
                              ? entry.sourceFormat === "canvas"
                                ? "Editable Canvas"
                                : entry.sourceFormat === "latex"
                                  ? "Math project"
                                  : entry.sourceFormat === "text"
                                    ? "Text project"
                                    : "Editable note"
                              : entry.kind === "folder"
                                ? "Folder"
                                : bytes(entry.bytes)}
                    </small>
                  </span>
                  {entry.kind === "note" && <ChevronRight size={14} />}
                </button>
              ))}
            </div>
            <div className="workspace-import-preview">
              <ActionRow className="import-preview-toolbar" align="between">
                <HelpText as="span">
                  <I18nText id="Local preview · no uploads or remote media" />
                </HelpText>
                <div>
                  <Button
                    variant="ghost"
                    size="compact"
                    aria-pressed={previewMode === "preview"}
                    onClick={() => setPreviewMode("preview")}
                  >
                    <I18nText id="Preview" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="compact"
                    aria-pressed={previewMode === "source"}
                    onClick={() => setPreviewMode("source")}
                  >
                    <I18nText id="Source" />
                  </Button>
                </div>
              </ActionRow>
              {inventory && selectedPath in inventory.previews ? (
                previewMode === "source" ||
                !["markdown", "canvas", undefined].includes(
                  inventory.entries.find((e) => e.path === selectedPath)
                    ?.sourceFormat,
                ) ? (
                  <pre
                    className="import-source-preview"
                    tabIndex={0}
                    aria-label={uiText("Selected source")}
                  >
                    {inventory.previews[selectedPath]}
                  </pre>
                ) : inventory.entries.find((e) => e.path === selectedPath)
                    ?.sourceFormat === "canvas" ? (
                  <CanvasPlayground
                    key={selectedPath}
                    source={inventory.previews[selectedPath].replace(
                      /^\ufeff/,
                      "",
                    )}
                    title={uiText("Local Canvas preview")}
                    readOnly
                  />
                ) : (
                  <PlanningMarkdown
                    key={selectedPath}
                    initial={inventory.previews[selectedPath]}
                    onChange={() => {}}
                    readOnly
                    preview
                    isolated
                    label={uiText("Selected note")}
                  />
                )
              ) : (
                <div className="import-preview-empty">
                  <FileText size={24} />
                  <p>
                    {reviewOnly
                      ? uiText(
                          "Previously prepared files are retained. Review the updated names and destination before continuing.",
                        )
                      : uiText(
                          "Select a Markdown note to preview its contents. Images stay offline until the import finishes.",
                        )}
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {!!inventory?.exclusions.length && (
        <details className="import-warnings">
          <summary>
            {inventory.exclusions.length}{" "}
            <I18nText id="excluded system or sensitive items" />
          </summary>
          <ul>
            {inventory.exclusions.map((item, index) => (
              <li key={index}>
                {item.path} — {item.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {inventory?.warnings.map((warning) => (
        <HelpText key={warning}>{warning}</HelpText>
      ))}
      {!!inventory?.diagnostics.length && (
        <details
          className="import-warnings"
          open={inventory.diagnostics.some((d) => d.severity === "error")}
        >
          <summary>
            <I18nText id="Preservation & conversion review ·" />{" "}
            {inventory.diagnostics.length} <I18nText id="messages" />
          </summary>
          <ul>
            {inventory.diagnostics.map((diagnostic, index) => (
              <li
                key={`${diagnostic.path ?? "collection"}:${diagnostic.code}:${index}`}
              >
                {diagnostic.path && <strong>{diagnostic.path} — </strong>}
                {diagnostic.message}
                {diagnostic.severity === "error" &&
                  diagnostic.path &&
                  diagnostic.code === "conversion-choice" && (
                    <Field label={`Action for ${diagnostic.path}`}>
                      <NativeSelect
                        value=""
                        disabled={busy}
                        onChange={(event) => {
                          const choice = event.target.value as
                            "attachment" | "skip";
                          if (choice && lastInput.current)
                            read({
                              ...lastInput.current,
                              decisions: {
                                ...lastInput.current.decisions,
                                [diagnostic.path!]: choice,
                              },
                            });
                        }}
                      >
                        <option value="">
                          <I18nText id="Choose an action…" />
                        </option>
                        <option value="attachment">
                          <I18nText id="Keep as attachment" />
                        </option>
                        <option value="skip">
                          <I18nText id="Skip file" />
                        </option>
                      </NativeSelect>
                    </Field>
                  )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <HelpText>
        <I18nText id="Existing contents are never overwritten. Imports do not restore permissions, plugins or version history." />
      </HelpText>
      <DialogFooter>
        <Button variant="secondary" onClick={controller.closeDraft}>
          <I18nText id="Close" />
        </Button>
        <Button
          disabled={
            busy ||
            checking ||
            !preview ||
            (!reviewOnly && !inventory) ||
            inventory?.diagnostics.some((d) => d.severity === "error")
          }
          onClick={() => void execute()}
        >
          <Import size={16} />
          {reviewOnly
            ? uiText("Apply reviewed destination")
            : draft.resume
              ? "Resume original collection"
              : "Import collection"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
