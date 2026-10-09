"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, HelpText, IconButton, NativeSelect } from "../ui/controls";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileUp, Pause, Play, RefreshCw, Upload, X } from "lucide-react";
import { MAX_FILE_BYTES } from "@axiom/shared/workspace";
import { transferUpload } from "../../lib/upload-transfer";
import {
  readUploadStatuses,
  uploadStatusLabel,
  verificationWaitMessage,
  type VerificationProgress,
} from "../../lib/upload-status";
import { api, post, SIGN_OUT_PENDING } from "../../lib/client";
import { bytes, ErrorNotice, useWorkspace } from "./ui";
import { uploadRelativePath } from "@axiom/shared/file-workflows";
import Dialog from "../Dialog";
import RecoveryActivity from "./RecoveryActivity";
import { ImportTransfers } from "./WorkspaceImports";
import type {
  UploadBatch,
  UploadResult,
  ResolvedAsset,
} from "@axiom/shared/editor-media";

export type Transfer = VerificationProgress & {
  id: string;
  space_id: string;
  parent_id: string | null;
  resource_id?: string;
  expected_version_id?: string;
  expected_resource_version?: number;
  name: string;
  bytes: number;
  status: string;
  received: number;
  error?: string;
  statusError?: string;
  rechecking?: boolean;
  completed_resource_id?: string;
  completed_version_id?: string;
  expires_at?: string;
};
export function useUploads(userId: string | undefined, onComplete: () => void) {
  const [transfers, setTransfers] = useState<Transfer[]>([]),
    [shown, setShown] = useState(false),
    [folderBatch, setFolderBatch] = useState<{
      files: File[];
      spaceId: string;
      parentId: string | null;
    } | null>(null),
    [folderConflict, setFolderConflict] = useState<
      "keepBoth" | "merge" | "skip"
    >("keepBoth"),
    [folderBusy, setFolderBusy] = useState(false),
    [folderError, setFolderError] = useState("");
  const folderIdentity = useRef({ key: "", id: crypto.randomUUID() });
  const batches = useRef(
    new Map<
      string,
      {
        ids: string[];
        resolve: (items: UploadResult[]) => void;
        reject: (error: Error) => void;
        resolving?: boolean;
      }
    >(),
  );
  const snapshot = useRef(transfers);
  snapshot.current = transfers;
  const completed = useRef(new Set<string>());
  const cancelled = useRef(new Set<string>());
  const files = useRef(new Map<string, File>()),
    running = useRef(new Map<string, AbortController>()),
    queue = useRef(Promise.resolve()),
    owner = useRef(userId),
    onDone = useRef(onComplete);
  onDone.current = onComplete;
  owner.current = userId;
  const update = (id: string, patch: Partial<Transfer>) =>
    setTransfers((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  useEffect(() => {
    let alive = true;
    setTransfers([]);
    completed.current.clear();
    cancelled.current.clear();
    for (const batch of batches.current.values())
      batch.reject(
        new Error("The upload account changed. No files were inserted."),
      );
    batches.current.clear();
    setFolderBatch(null);
    files.current.clear();
    for (const controller of running.current.values()) controller.abort();
    running.current.clear();
    if (userId)
      void api<Transfer[]>("uploads")
        .then((items) => {
          if (alive && owner.current === userId)
            setTransfers((previous) => [
              ...previous,
              ...items
                .filter(
                  (item) =>
                    !["cancelled", "expired", "complete"].includes(
                      item.status,
                    ) && !previous.some((current) => current.id === item.id),
                )
                .map((item) => ({
                  ...item,
                  bytes: Number(item.bytes),
                  received: Number(item.received),
                  status: item.status === "uploading" ? "paused" : item.status,
                })),
            ]);
        })
        .catch(() => {});
    return () => {
      alive = false;
      for (const controller of running.current.values()) controller.abort();
      for (const batch of batches.current.values())
        batch.reject(
          new Error("Upload session closed. No files were inserted."),
        );
      batches.current.clear();
    };
  }, [userId]);
  const start = async (item: Transfer, file: File) => {
    if (
      !userId ||
      owner.current !== userId ||
      running.current.has(item.id) ||
      cancelled.current.has(item.id) ||
      localStorage.getItem(SIGN_OUT_PENDING)
    )
      return;
    const controller = new AbortController(),
      signal = controller.signal;
    running.current.set(item.id, controller);
    files.current.set(item.id, file);
    update(item.id, { status: "uploading", error: "" });
    const valid = () => {
      if (signal.aborted || owner.current !== userId)
        throw new DOMException("Paused", "AbortError");
    };
    try {
      if (file.name !== item.name || file.size !== Number(item.bytes))
        throw new Error(
          "Choose the original file with the same name and size.",
        );
      // Initialization is idempotent, including when the first response was lost.
      if (item.resource_id && !item.expected_version_id) {
        const target = await api(`resources/${item.resource_id}`, { signal });
        item.expected_version_id = target.current_version_id;
        item.expected_resource_version = target.version;
        update(item.id, {
          expected_version_id: item.expected_version_id,
          expected_resource_version: item.expected_resource_version,
        });
      }
      await api("uploads", {
        method: "POST",
        signal,
        body: JSON.stringify({
          id: item.id,
          name: file.name,
          bytes: file.size,
          spaceId: item.space_id,
          parentId: item.parent_id,
          resourceId: item.resource_id,
          expectedVersionId: item.expected_version_id,
          expectedResourceVersion: item.expected_resource_version,
        }),
      });
      const remote = await transferUpload(file, `uploads/${item.id}`, {
        signal,
        valid,
        progress: (received) => update(item.id, { received }),
      });
      valid();
      if (remote.status === "complete") {
        update(item.id, {
          status: "complete",
          completed_resource_id: remote.resourceId,
          completed_version_id: remote.versionId,
          received: file.size,
        });
        if (!completed.current.has(item.id)) {
          completed.current.add(item.id);
          onDone.current();
        }
        return;
      }
      if (remote.status === "verifying") {
        update(item.id, { status: "verifying", received: file.size });
        return;
      }
      update(item.id, { status: "verifying" });
    } catch (error) {
      if (owner.current === userId)
        update(item.id, {
          status: cancelled.current.has(item.id) ? "cancelled" : "paused",
          error: signal.aborted
            ? ""
            : error instanceof Error
              ? error.message
              : "Upload interrupted. Resume to retry.",
        });
    } finally {
      running.current.delete(item.id);
    }
  };
  const add = useCallback(
    (
      selected: File[],
      spaceId: string,
      parentId: string | null = null,
      resourceId?: string,
      flat = false,
      quiet = false,
    ) => {
      if (
        !flat &&
        !resourceId &&
        selected.some((file) => file.webkitRelativePath)
      ) {
        setFolderBatch({ files: selected, spaceId, parentId });
        setFolderError("");
        folderIdentity.current = { key: "", id: crypto.randomUUID() };
        return [];
      }
      if (!quiet) setShown(true);
      const items = selected.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        bytes: file.size,
        space_id: spaceId,
        parent_id: parentId,
        resource_id: resourceId,
        status:
          file.size === 0 || file.size > MAX_FILE_BYTES ? "invalid" : "queued",
        received: 0,
        error:
          file.size === 0
            ? "Empty files are not supported."
            : file.size > MAX_FILE_BYTES
              ? "The maximum file size is 1 GB (1,000,000,000 bytes)."
              : "",
      }));
      setTransfers((previous) => [...items, ...previous]);
      // Bound browser/server memory: the transfer queue runs one file at a time.
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          for (let index = 0; index < items.length; index++)
            if (items[index].status === "queued")
              await start(items[index], selected[index]);
        });
      return items.map((item) => item.id);
    },
    [userId],
  );
  const hasVerifying = transfers.some((item) => item.status === "verifying");
  useEffect(() => {
    if (!userId || !hasVerifying) return;
    let alive = true,
      inFlight = false;
    const controller = new AbortController();
    const poll = () => {
      if (inFlight || !navigator.onLine) return;
      const pending = snapshot.current.filter(
        (item) => item.status === "verifying",
      );
      if (!pending.length) return;
      const pendingIds = new Set(pending.map((item) => item.id));
      inFlight = true;
      void readUploadStatuses<Transfer>(
        pending.map((item) => item.id),
        controller.signal,
      )
        .then((remote) => {
          if (!alive || owner.current !== userId) return;
          let changed = false;
          const byId = new Map(remote.map((item) => [item.id, item]));
          for (const current of remote)
            if (
              current.status === "complete" &&
              pendingIds.has(current.id) &&
              !completed.current.has(current.id)
            ) {
              files.current.delete(current.id);
              completed.current.add(current.id);
              changed = true;
            }
          if (changed) onDone.current();
          setTransfers((previous) =>
            previous.map((item) => {
              if (item.status !== "verifying" || !pendingIds.has(item.id))
                return item;
              const current = byId.get(item.id);
              if (!current)
                return {
                  ...item,
                  status: "paused",
                  error:
                    "Destination access changed. Reconnect or ask a project lead.",
                };
              return {
                ...item,
                ...current,
                bytes: Number(current.bytes),
                received: Number(current.received),
                statusError: "",
              };
            }),
          );
        })
        .catch(() => {
          if (!alive || owner.current !== userId) return;
          setTransfers((previous) =>
            previous.map((item) =>
              item.status === "verifying" && pendingIds.has(item.id)
                ? {
                    ...item,
                    statusError:
                      "Could not check verification. Your uploaded parts are retained. Recheck or reconnect; no re-upload is needed.",
                  }
                : item,
            ),
          );
        })
        .finally(() => {
          inFlight = false;
        });
    };
    poll();
    const timer = setInterval(poll, 1800);
    window.addEventListener("online", poll);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("online", poll);
    };
  }, [hasVerifying, userId]);
  useEffect(() => {
    const byId = new Map(transfers.map((item) => [item.id, item]));
    for (const [key, batch] of batches.current) {
      if (batch.resolving) continue;
      const items = batch.ids.map((id) => byId.get(id));
      if (
        items.some(
          (item) => item?.status === "invalid" || item?.status === "cancelled",
        )
      ) {
        batch.reject(
          new Error(
            "Upload insertion cancelled. Completed files remain in the library.",
          ),
        );
        batches.current.delete(key);
      } else if (
        items.every(
          (item) => item?.status === "complete" && item.completed_version_id,
        )
      ) {
        batch.resolving = true;
        const account = userId;
        void post<ResolvedAsset[]>("media-assets", {
          versions: items.map((item) => item!.completed_version_id),
        })
          .then((assets) => {
            if (owner.current !== account || !batches.current.has(key)) return;
            if (assets.some((asset) => asset.unavailable))
              throw new Error("File access changed before insertion.");
            batch.resolve(
              assets.map((asset, index) => ({
                transferId: batch.ids[index],
                resourceId: asset.resourceId!,
                versionId: asset.versionId,
                name: asset.name!,
                mime: asset.mime!,
                bytes: asset.bytes!,
              })),
            );
            batches.current.delete(key);
          })
          .catch((error) => {
            batch.reject(error);
            batches.current.delete(key);
          });
      }
    }
  }, [transfers, userId]);
  const addBatch = (
    selected: File[],
    spaceId: string,
    parentId: string | null = null,
  ): UploadBatch => {
    if (!selected.length || selected.length > 60) {
      const ready = Promise.reject<UploadResult[]>(
        new Error("Choose between 1 and 60 files per insertion."),
      );
      void ready.catch(() => {});
      return { ids: [], ready, cancel: async () => {} };
    }
    const ids = add(selected, spaceId, parentId, undefined, true, true),
      key = crypto.randomUUID();
    const ready = new Promise<UploadResult[]>((resolve, reject) =>
      batches.current.set(key, { ids, resolve, reject }),
    );
    // Callers may attach after their UI mounts; prevent unhandled cancellations.
    void ready.catch(() => {});
    return {
      ids,
      ready,
      cancel: async () => {
        batches.current
          .get(key)
          ?.reject(
            new Error(
              "Insertion cancelled. Completed files remain in the library.",
            ),
          );
        batches.current.delete(key);
        for (const id of ids) {
          cancelled.current.add(id);
          running.current.get(id)?.abort();
          const item = snapshot.current.find((entry) => entry.id === id);
          if (
            item &&
            !["complete", "invalid", "cancelled"].includes(item.status)
          ) {
            try {
              await post(`uploads/${id}/cancel`);
            } catch (error) {
              if (!(
                error instanceof Error &&
                "status" in error &&
                error.status === 404
              ))
                update(id, {
                  error:
                    "Remote cancellation could not be confirmed. No insertion will occur.",
                });
            }
          }
          if (item?.status !== "complete") update(id, { status: "cancelled" });
        }
      },
    };
  };
  return {
    transfers,
    shown,
    setShown,
    add,
    addBatch,
    folderBatch,
    folderConflict,
    setFolderConflict,
    folderBusy,
    folderError,
    closeFolder: () => {
      if (!folderBusy) setFolderBatch(null);
    },
    uploadFolder: async () => {
      if (!folderBatch || folderBusy || owner.current !== userId) return;
      setFolderBusy(true);
      setFolderError("");
      try {
        if (folderBatch.files.length > 2000)
          throw new Error(
            "Upload up to 2,000 files at a time. Choose a smaller folder.",
          );
        const paths = folderBatch.files.map((file) => [
          ...uploadRelativePath(file),
          file.name,
        ]);
        const input = {
            spaceId: folderBatch.spaceId,
            parentId: folderBatch.parentId,
            paths,
            conflict: folderConflict,
          },
          key = JSON.stringify(input);
        if (folderIdentity.current.key !== key)
          folderIdentity.current = { key, id: crypto.randomUUID() };
        const plan = await post("folder-upload-plan", {
          ...input,
          mutationId: folderIdentity.current.id,
        });
        if (owner.current !== userId) return;
        const groups = new Map<string | null, File[]>();
        for (let i = 0; i < folderBatch.files.length; i++) {
          const parent = paths[i].slice(0, -1).join("/");
          if (
            plan.skipped.some(
              (p: string) => parent === p || parent.startsWith(p + "/"),
            )
          )
            continue;
          const target = plan.folders[parent] ?? folderBatch.parentId;
          groups.set(target, [
            ...(groups.get(target) ?? []),
            folderBatch.files[i],
          ]);
        }
        for (const [parent, files] of groups)
          add(files, folderBatch.spaceId, parent, undefined, true);
        setFolderBatch(null);
        onDone.current();
      } catch (e) {
        setFolderError(
          e instanceof Error
            ? e.message
            : "Folder upload could not be prepared.",
        );
      } finally {
        setFolderBusy(false);
      }
    },
    pause: (id: string) => running.current.get(id)?.abort(),
    resume: (item: Transfer, selected?: File) => {
      const file = selected ?? files.current.get(item.id);
      if (file) {
        update(item.id, { status: "queued", error: "" });
        queue.current = queue.current
          .catch(() => {})
          .then(() => start(item, file));
      }
    },
    retryVerification: async (item: Transfer) => {
      if (
        snapshot.current.find((current) => current.id === item.id)?.rechecking
      )
        return;
      update(item.id, { rechecking: true });
      try {
        const remote = await api<{
          status: string;
          resourceId?: string;
          versionId?: string;
        }>(`uploads/${item.id}/complete`, {
          method: "POST",
          body: "{}",
          signal: AbortSignal.timeout(15_000),
        });
        if (owner.current !== userId) return;
        update(item.id, {
          status: remote.status,
          error: "",
          statusError: "",
          completed_resource_id: remote.resourceId,
          completed_version_id: remote.versionId,
        });
        if (remote.status === "complete" && !completed.current.has(item.id)) {
          completed.current.add(item.id);
          files.current.delete(item.id);
          onDone.current();
        }
      } finally {
        if (owner.current === userId) update(item.id, { rechecking: false });
      }
    },
    saveCopy: async (item: Transfer) => {
      await post(`uploads/${item.id}/save-copy`, {
        name: item.name,
        parentId: item.parent_id,
      });
      update(item.id, {
        status: "verifying",
        resource_id: undefined,
        error: "",
      });
    },
    hasFile: (id: string) => files.current.has(id),
    cancel: async (item: Transfer) => {
      cancelled.current.add(item.id);
      running.current.get(item.id)?.abort();
      if (item.status !== "invalid") {
        try {
          await post(`uploads/${item.id}/cancel`);
        } catch (error) {
          if (!(
            error instanceof Error &&
            "status" in error &&
            error.status === 404
          ))
            throw error;
        }
      }
      update(item.id, { status: "cancelled", error: "" });
      files.current.delete(item.id);
    },
    dismiss: (id: string) => {
      files.current.delete(id);
      setTransfers((items) => items.filter((item) => item.id !== id));
    },
  };
}
export default function Uploads({
  controller,
}: {
  controller: ReturnType<typeof useUploads>;
}) {
  useInterfaceLocale();
  const { open, imports } = useWorkspace(),
    [error, setError] = useState(""),
    [view, setView] = useState<"uploads" | "activity">("uploads");
  const input = useRef<HTMLInputElement>(null),
    reselect = useRef<Transfer | null>(null);
  if (controller.folderBatch)
    return (
      <Dialog
        title={uiText("Upload folder")}
        subtitle={`${controller.folderBatch.files.length} files · hierarchy will be preserved`}
        onClose={controller.closeFolder}
      >
        <p>
          <I18nText id="Choose how to handle folders with matching names. Existing files and versions are never overwritten." />
        </p>
        <label>
          <I18nText id="Folder name conflicts" />
          <NativeSelect
            aria-label={uiText("Folder name conflicts")}
            value={controller.folderConflict}
            disabled={controller.folderBusy}
            onChange={(e) =>
              controller.setFolderConflict(
                e.target.value as typeof controller.folderConflict,
              )
            }
          >
            <option value="keepBoth">
              <I18nText id="Keep both — create a numbered folder" />
            </option>
            <option value="merge">
              <I18nText id="Merge folders — keep incoming files as separate copies" />
            </option>
            <option value="skip">
              <I18nText id="Skip matching folders and their incoming contents" />
            </option>
          </NativeSelect>
        </label>
        <ErrorNotice message={controller.folderError} />
        <div className="dialog-footer">
          <Button
            data-dialog-cancel
            className="button secondary"
            disabled={controller.folderBusy}
            onClick={controller.closeFolder}
          >
            <I18nText id="Cancel" />
          </Button>
          <Button
            className="button primary"
            disabled={controller.folderBusy}
            onClick={() => void controller.uploadFolder()}
          >
            {controller.folderBusy
              ? uiText("Preparing folders…")
              : uiText("Upload folder")}
          </Button>
        </div>
      </Dialog>
    );
  if (!controller.shown) return null;
  return (
    <section
      className="ws-transfers"
      aria-label={uiText("Activity & recovery")}
    >
      <header>
        <h2>
          <Upload size={17} />
          <I18nText id="Activity & recovery" />
        </h2>
        <IconButton
          className="icon-button"
          aria-label={uiText("Hide activity & recovery")}
          onClick={() => controller.setShown(false)}
        >
          <X size={17} />
        </IconButton>
      </header>
      <nav className="recovery-filter" aria-label={uiText("Activity views")}>
        <Button
          size="compact"
          variant="ghost"
          aria-pressed={view === "uploads"}
          onClick={() => setView("uploads")}
        >
          <I18nText id="Uploads" />{" "}
          {controller.transfers.length
            ? "(" + controller.transfers.length + ")"
            : ""}
        </Button>
        <Button
          size="compact"
          variant="ghost"
          aria-pressed={view === "activity"}
          onClick={() => setView("activity")}
        >
          <I18nText id="Background work" />
        </Button>
      </nav>
      {view === "activity" ? (
        <RecoveryActivity onClose={() => controller.setShown(false)} />
      ) : (
        <>
          <p className="ws-small muted">
            <I18nText id="Up to 1 GB per file. Interrupted uploads can be resumed for seven days. Completed files are never auto-deleted." />
          </p>
          <ErrorNotice message={error} />
          {imports && (
            <ImportTransfers
              controller={imports}
              closeUploads={() => controller.setShown(false)}
            />
          )}
          <input
            ref={input}
            hidden
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file && reselect.current)
                controller.resume(reselect.current, file);
              event.target.value = "";
            }}
          />
          <div className="ws-transfer-list">
            {!controller.transfers.length && (
              <p className="muted">
                <I18nText id="Your uploads will appear here." />
              </p>
            )}
            {controller.transfers.map((item) => (
              <div className="ws-transfer" key={item.id}>
                <FileUp size={19} />
                <div className="ws-transfer-body">
                  <strong>{item.name}</strong>
                  <span>
                    {bytes(item.received)} / {bytes(item.bytes)} ·{" "}
                    {uploadStatusLabel(item)}
                  </span>
                  <progress
                    max={Math.max(1, item.bytes)}
                    value={item.received}
                    aria-label={`${item.name} uploaded bytes`}
                  />
                  {verificationWaitMessage(item) && (
                    <HelpText>{verificationWaitMessage(item)}</HelpText>
                  )}
                  <ErrorNotice message={item.statusError || item.error} />
                </div>
                {item.status === "uploading" && (
                  <IconButton
                    className="icon-button"
                    onClick={() => controller.pause(item.id)}
                    aria-label={`Pause ${item.name}`}
                  >
                    <Pause size={16} />
                  </IconButton>
                )}
                {item.status === "paused" && (
                  <IconButton
                    className="icon-button"
                    onClick={() => {
                      if (controller.hasFile(item.id)) controller.resume(item);
                      else {
                        reselect.current = item;
                        input.current?.click();
                      }
                    }}
                    aria-label={`Resume ${item.name}`}
                  >
                    <Play size={16} />
                  </IconButton>
                )}
                {["failed", "verifying"].includes(item.status) && (
                  <>
                    <Button
                      className="button secondary"
                      size="compact"
                      pending={!!item.rechecking}
                      aria-label={`${item.status === "verifying" ? "Recheck" : "Retry verification for"} ${item.name}`}
                      title={uiText(
                        "Recheck verification without uploading the file again",
                      )}
                      onClick={() =>
                        void controller
                          .retryVerification(item)
                          .catch((e) => setError(e.message))
                      }
                    >
                      <RefreshCw size={15} />
                      {item.status === "verifying"
                        ? uiText("Recheck")
                        : uiText("Retry verification")}
                    </Button>
                    {item.status === "failed" && item.resource_id && (
                      <Button
                        className="button secondary"
                        onClick={() =>
                          void controller
                            .saveCopy(item)
                            .catch((e) => setError(e.message))
                        }
                      >
                        <I18nText id="Save as a separate copy" />
                      </Button>
                    )}
                  </>
                )}
                {item.status === "complete" && item.completed_resource_id && (
                  <IconButton
                    className="icon-button"
                    aria-label={`Open ${item.name}`}
                    onClick={() =>
                      open({ id: item.completed_resource_id!, kind: "file" })
                    }
                  >
                    <Check size={17} />
                  </IconButton>
                )}
                {!["uploading", "verifying", "queued"].includes(
                  item.status,
                ) && (
                  <IconButton
                    className="icon-button"
                    aria-label={`${["paused", "failed"].includes(item.status) ? "Cancel" : "Dismiss"} ${item.name}`}
                    onClick={() => {
                      if (["paused", "failed"].includes(item.status))
                        void controller
                          .cancel(item)
                          .catch((e) => setError(e.message));
                      else controller.dismiss(item.id);
                    }}
                  >
                    <X size={16} />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
