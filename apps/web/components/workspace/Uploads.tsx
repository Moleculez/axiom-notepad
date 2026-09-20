"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileUp, Pause, Play, Upload, X } from "lucide-react";
import { MAX_FILE_BYTES, UPLOAD_CHUNK_BYTES } from "@axiom/shared/workspace";
import { api, post, SIGN_OUT_PENDING } from "../../lib/client";
import { bytes, ErrorNotice, useWorkspace } from "./ui";
import { uploadRelativePath } from "@axiom/shared/file-workflows";
import Dialog from "../Dialog";

type Transfer = {
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
  completed_resource_id?: string;
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
    setFolderBatch(null);
    files.current.clear();
    for (const controller of running.current.values()) controller.abort();
    running.current.clear();
    if (userId)
      void api<Transfer[]>("uploads")
        .then((items) => {
          if (alive)
            setTransfers(
              items
                .filter(
                  (item) =>
                    !["cancelled", "expired", "complete"].includes(item.status),
                )
                .map((item) => ({
                  ...item,
                  bytes: Number(item.bytes),
                  received: Number(item.received),
                  status: item.status === "uploading" ? "paused" : item.status,
                })),
            );
        })
        .catch(() => {});
    return () => {
      alive = false;
      for (const controller of running.current.values()) controller.abort();
    };
  }, [userId]);
  const start = async (item: Transfer, file: File) => {
    if (
      !userId ||
      owner.current !== userId ||
      running.current.has(item.id) ||
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
      const remote = await api(`uploads/${item.id}`, { signal });
      valid();
      if (remote.status === "complete") {
        update(item.id, {
          status: "complete",
          completed_resource_id: remote.resourceId,
          received: file.size,
        });
        onDone.current();
        return;
      }
      if (remote.status === "verifying") {
        update(item.id, { status: "verifying", received: file.size });
        return;
      }
      const present = new Map<number, string>(
        remote.chunks.map((chunk: any) => [Number(chunk.part), chunk.sha256]),
      );
      const hash = async (part: number) => {
        const chunk = await file
          .slice((part - 1) * UPLOAD_CHUNK_BYTES, part * UPLOAD_CHUNK_BYTES)
          .arrayBuffer();
        valid();
        const checksum = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", chunk)),
        )
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
        return { chunk, checksum };
      };
      // Validate all previously accepted parts before sending any new bytes.
      for (const [part, checksum] of present)
        if ((await hash(part)).checksum !== checksum)
          throw new Error(
            "This is not the original file. Its saved parts have different checksums. No existing file was changed.",
          );
      let received = remote.chunks.reduce(
        (total: number, chunk: any) => total + Number(chunk.bytes),
        0,
      );
      update(item.id, { received });
      for (
        let part = 1;
        part <= Math.ceil(file.size / UPLOAD_CHUNK_BYTES);
        part++
      ) {
        valid();
        if (present.has(part)) continue;
        const { chunk, checksum } = await hash(part);
        await api(`uploads/${item.id}/chunks/${part}`, {
          method: "PUT",
          signal,
          headers: {
            "content-type": "application/octet-stream",
            "x-content-sha256": checksum,
          },
          body: chunk,
        });
        received += chunk.byteLength;
        valid();
        update(item.id, { received });
      }
      await api(`uploads/${item.id}/complete`, {
        method: "POST",
        signal,
        body: "{}",
      });
      valid();
      update(item.id, { status: "verifying" });
    } catch (error) {
      if (owner.current === userId)
        update(item.id, {
          status: "paused",
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
    ) => {
      if (
        !flat &&
        !resourceId &&
        selected.some((file) => file.webkitRelativePath)
      ) {
        setFolderBatch({ files: selected, spaceId, parentId });
        setFolderError("");
        folderIdentity.current = { key: "", id: crypto.randomUUID() };
        return;
      }
      setShown(true);
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
    },
    [userId],
  );
  useEffect(() => {
    if (!transfers.some((item) => item.status === "verifying")) return;
    let alive = true,
      inFlight = false;
    const timer = setInterval(() => {
      if (inFlight || !navigator.onLine) return;
      inFlight = true;
      void api<Transfer[]>("uploads")
        .then((remote) => {
          if (!alive) return;
          let completed = false;
          for (const current of remote)
            if (
              current.status === "complete" &&
              files.current.has(current.id)
            ) {
              files.current.delete(current.id);
              completed = true;
            }
          if (completed || remote.some((item) => item.status === "complete"))
            onDone.current();
          setTransfers((previous) =>
            previous.map((item) => {
              if (item.status !== "verifying") return item;
              const current = remote.find((row) => row.id === item.id);
              if (!current)
                return {
                  ...item,
                  status: "paused",
                  error:
                    "Destination access changed. Reconnect or ask a project lead.",
                };
              return {
                ...current,
                bytes: Number(current.bytes),
                received: Number(current.received),
              };
            }),
          );
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    }, 1800);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [transfers.some((item) => item.status === "verifying")]);
  return {
    transfers,
    shown,
    setShown,
    add,
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
      await post(`uploads/${item.id}/complete`);
      update(item.id, { status: "verifying", error: "" });
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
  const { open } = useWorkspace(),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null),
    reselect = useRef<Transfer | null>(null);
  if (controller.folderBatch)
    return (
      <Dialog
        title="Upload folder"
        subtitle={`${controller.folderBatch.files.length} files · hierarchy will be preserved`}
        onClose={controller.closeFolder}
      >
        <p>
          Choose how to handle folders with matching names. Existing files and
          versions are never overwritten.
        </p>
        <label>
          Folder name conflicts
          <select
            aria-label="Folder name conflicts"
            value={controller.folderConflict}
            disabled={controller.folderBusy}
            onChange={(e) =>
              controller.setFolderConflict(
                e.target.value as typeof controller.folderConflict,
              )
            }
          >
            <option value="keepBoth">
              Keep both — create a numbered folder
            </option>
            <option value="merge">
              Merge folders — keep incoming files as separate copies
            </option>
            <option value="skip">
              Skip matching folders and their incoming contents
            </option>
          </select>
        </label>
        <ErrorNotice message={controller.folderError} />
        <div className="dialog-footer">
          <button
            className="button secondary"
            disabled={controller.folderBusy}
            onClick={controller.closeFolder}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={controller.folderBusy}
            onClick={() => void controller.uploadFolder()}
          >
            {controller.folderBusy ? "Preparing folders…" : "Upload folder"}
          </button>
        </div>
      </Dialog>
    );
  if (!controller.shown) return null;
  return (
    <section className="ws-transfers" aria-label="File transfers">
      <header>
        <h2>
          <Upload size={17} />
          File transfers
        </h2>
        <button
          className="icon-button"
          aria-label="Hide file transfers"
          onClick={() => controller.setShown(false)}
        >
          <X size={17} />
        </button>
      </header>
      <p className="ws-small muted">
        Up to 1 GB per file. Interrupted uploads can be resumed for seven days.
        Completed files are never auto-deleted.
      </p>
      <ErrorNotice message={error} />
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
          <p className="muted">Your uploads will appear here.</p>
        )}
        {controller.transfers.map((item) => (
          <div className="ws-transfer" key={item.id}>
            <FileUp size={19} />
            <div className="ws-transfer-body">
              <strong>{item.name}</strong>
              <span>
                {bytes(item.received)} / {bytes(item.bytes)} ·{" "}
                {item.status === "verifying"
                  ? "Verifying file on server…"
                  : item.status}
              </span>
              <progress
                max={Math.max(1, item.bytes)}
                value={item.received}
                aria-label={`${item.name} uploaded bytes`}
              />
              <ErrorNotice message={item.error} />
            </div>
            {item.status === "uploading" && (
              <button
                className="icon-button"
                onClick={() => controller.pause(item.id)}
                aria-label={`Pause ${item.name}`}
              >
                <Pause size={16} />
              </button>
            )}
            {item.status === "paused" && (
              <button
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
              </button>
            )}
            {item.status === "failed" && (
              <>
                <button
                  className="button secondary"
                  onClick={() =>
                    void controller
                      .retryVerification(item)
                      .catch((e) => setError(e.message))
                  }
                >
                  Retry verification
                </button>
                {item.resource_id && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      void controller
                        .saveCopy(item)
                        .catch((e) => setError(e.message))
                    }
                  >
                    Save as a separate copy
                  </button>
                )}
              </>
            )}
            {item.status === "complete" && item.completed_resource_id && (
              <button
                className="icon-button"
                aria-label={`Open ${item.name}`}
                onClick={() =>
                  open({ id: item.completed_resource_id!, kind: "file" })
                }
              >
                <Check size={17} />
              </button>
            )}
            {!["uploading", "verifying", "queued"].includes(item.status) && (
              <button
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
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
