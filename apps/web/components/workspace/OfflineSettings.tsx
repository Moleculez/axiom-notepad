"use client";
import { ActionRow, Button, HelpText, IconButton } from "../ui/controls";
import { useEffect, useState } from "react";
import {
  Download,
  HardDrive,
  RefreshCw,
  Trash2,
  FolderOpen,
  UploadCloud,
} from "lucide-react";
import {
  offlineState,
  pinOffline,
  removeOffline,
  replayOffline,
  resolveOffline,
  offlineFilesEvent,
  exportOfflineRecovery,
  cancelPendingOffline,
  reviewOffline,
} from "../../lib/offline-files";
import { downloadText, downloadBlob } from "../../lib/tools/download";
import Dialog from "../Dialog";
import { ErrorNotice, Loading, bytes, useWorkspace, WorkspaceLink } from "./ui";
import type { OfflineCommand, OfflinePackage } from "@axiom/shared/offline";
export default function OfflineSettings() {
  const { session, open, notify } = useWorkspace(),
    [state, setState] = useState<{
      packages: OfflinePackage[];
      queue: OfflineCommand[];
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [review, setReview] = useState<Awaited<
      ReturnType<typeof reviewOffline>
    > | null>(null),
    [cancel, setCancel] = useState(false),
    [storage, setStorage] = useState<{
      quota?: number;
      usage?: number;
      persistent?: boolean;
    }>({});
  const load = () =>
    void offlineState(session.user.id)
      .then(setState)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    window.addEventListener(offlineFilesEvent, load);
    void navigator.storage
      ?.estimate()
      .then(async (e) =>
        setStorage({ ...e, persistent: await navigator.storage.persisted() }),
      );
    return () => window.removeEventListener(offlineFilesEvent, load);
  }, [session.user.id]);
  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError("");
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="offline-settings">
      <header>
        <div>
          <h2>
            <HardDrive size={20} />
            Selected offline work
          </h2>
          <p>
            Download files or folders from Explorer’s context menu. Ready means
            all selected document journals and file downloads were saved on this
            device and checksummed. External websites remain online-only.
          </p>
        </div>
        <WorkspaceLink to="/explorer" className="button secondary">
          <FolderOpen size={16} />
          Choose in Explorer
        </WorkspaceLink>
      </header>
      <div className="offline-storage-line">
        <span>
          {bytes(storage.usage)} used
          {storage.quota ? ` of ${bytes(storage.quota)}` : ""} ·{" "}
          {storage.persistent
            ? "Persistent device storage"
            : "Browser-managed storage"}
        </span>
        {!storage.persistent && (
          <Button
            className="button ghost"
            onClick={() =>
              void navigator.storage.persist().then((persistent) => {
                setStorage((s) => ({ ...s, persistent }));
                notify(
                  persistent
                    ? "Persistent storage enabled."
                    : "The browser did not grant persistent storage. Keep important backups.",
                );
              })
            }
          >
            Keep on this device
          </Button>
        )}
      </div>
      <ErrorNotice message={error} />
      {!state ? (
        <Loading />
      ) : (
        <>
          <div className="offline-packages">
            {!state.packages.length && (
              <HelpText>No selections have been downloaded yet.</HelpText>
            )}
            {state.packages.map((p) => (
              <article key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    {p.state} · {p.resourceIds.length} items · {bytes(p.bytes)}
                    {p.state === "preparing" ? ` · ${p.done}/${p.total}` : ""}
                  </small>
                  {p.error && <p>{p.error}</p>}
                </div>
                <ActionRow>
                  <IconButton
                    className="icon-button"
                    title="Refresh offline copy"
                    aria-label={`Refresh ${p.name}`}
                    disabled={!!busy || !navigator.onLine}
                    onClick={() =>
                      void run(p.id, () => pinOffline(session.user.id, p.id))
                    }
                  >
                    <RefreshCw size={16} />
                  </IconButton>
                  <IconButton
                    className="icon-button"
                    title="Remove downloaded copy only"
                    aria-label={`Remove offline copy of ${p.name}`}
                    disabled={!!busy}
                    onClick={() =>
                      void run(p.id, () => removeOffline(session.user.id, p.id))
                    }
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </ActionRow>
              </article>
            ))}
          </div>
          <h2>
            <UploadCloud size={20} />
            Pending file operations
          </h2>
          <HelpText>
            Common changes replay in order after reconnection. A conflict pauses
            the queue; it never silently overwrites newer server changes.
            Document text synchronizes through its independent collaboration
            journal.
          </HelpText>
          <ActionRow>
            <Button
              className="button secondary"
              disabled={!!busy}
              onClick={() =>
                void run("recovery", async () =>
                  downloadBlob(
                    await exportOfflineRecovery(session.user.id),
                    "axiom-offline-recovery.zip",
                  ),
                )
              }
            >
              <Download size={15} />
              Export pending work
            </Button>
            <Button
              className="button secondary"
              disabled={!!busy || !navigator.onLine}
              onClick={() =>
                void run("queue", () => replayOffline(session.user.id))
              }
            >
              <RefreshCw size={15} />
              Sync now
            </Button>
            <Button
              className="button ghost"
              onClick={() =>
                downloadText(
                  JSON.stringify(state, null, 2),
                  "axiom-offline-operations.json",
                  "application/json",
                )
              }
            >
              <Download size={15} />
              Export operation log
            </Button>
            {state.queue.some(
              (c) => !["done", "cancelled"].includes(c.status),
            ) && (
              <Button
                className="button ghost"
                disabled={!!busy || !navigator.onLine}
                onClick={() => setCancel(true)}
              >
                Stop pending operations…
              </Button>
            )}
          </ActionRow>
          {!state.queue.some(
            (c) => !["done", "cancelled"].includes(c.status),
          ) && (
            <HelpText>All queued file operations are synchronized.</HelpText>
          )}
          {state.queue
            .filter((c) => !["done", "cancelled"].includes(c.status))
            .map((c) => (
              <article className="offline-queue-item" key={c.id}>
                <header>
                  <strong>
                    {c.method} {c.path}
                  </strong>
                  <span>{c.status}</span>
                </header>
                <p>{String(c.body.name ?? c.resourceId)}</p>
                {c.error && <ErrorNotice message={c.error} />}
                <ActionRow>
                  <Button
                    className="button ghost"
                    onClick={() =>
                      c.body.kind === "folder"
                        ? notify(
                            "Open the containing workspace in Explorer to inspect this folder.",
                          )
                        : open({
                            id: c.resourceId,
                            kind: "note",
                            document_type:
                              c.body.type === "canvas" ||
                              c.body.kind === "canvas"
                                ? "canvas"
                                : c.body.type === "math" ||
                                    c.body.kind === "math"
                                  ? "math"
                                  : c.body.type === "text" ||
                                      c.body.kind === "text"
                                    ? "text"
                                    : undefined,
                          })
                    }
                  >
                    Open retained work
                  </Button>
                  {["conflict", "blocked"].includes(c.status) && (
                    <>
                      {c.method === "PATCH" || c.path.endsWith("/trash") ? (
                        <Button
                          className="button primary"
                          disabled={!!busy || !navigator.onLine}
                          onClick={() =>
                            void run(c.id, async () =>
                              setReview(
                                await reviewOffline(session.user.id, c.id),
                              ),
                            )
                          }
                        >
                          Review server changes…
                        </Button>
                      ) : null}
                      <Button
                        className="button secondary"
                        disabled={!!busy || !navigator.onLine}
                        onClick={() =>
                          void run(c.id, () =>
                            resolveOffline(session.user.id, c.id, "retry"),
                          )
                        }
                      >
                        Retry unchanged request
                      </Button>
                    </>
                  )}
                </ActionRow>
              </article>
            ))}
        </>
      )}
      <HelpText>
        Removing an offline copy does not delete server files. Editor recovery
        journals are retained. Sign out to remove this account’s device caches.
        Offline copies cannot be remotely erased while a device is disconnected.
      </HelpText>
      {review && (
        <Dialog title="Review offline conflict" onClose={() => setReview(null)}>
          <p>
            The server version changed. Reapply your requested fields only after
            comparing them below. Unchanged server fields will be preserved.
          </p>
          <div className="offline-conflict-comparison">
            <section>
              <h3>Current server values</h3>
              <pre>
                {JSON.stringify(
                  {
                    name: review.server.name,
                    parentId: review.server.parent_id,
                    description: review.server.description,
                    tags: review.server.tags,
                    version: review.server.version,
                  },
                  null,
                  2,
                )}
              </pre>
            </section>
            <section>
              <h3>Your pending changes</h3>
              <pre>{JSON.stringify(review.command.body, null, 2)}</pre>
            </section>
          </div>
          <ErrorNotice message={error} />
          <ActionRow>
            <Button
              className="button secondary"
              onClick={() => setReview(null)}
            >
              Keep paused
            </Button>
            <Button
              className="button primary"
              disabled={!!busy}
              onClick={() =>
                void run("rebase", async () => {
                  await resolveOffline(
                    session.user.id,
                    review.command.id,
                    "rebase",
                    review.server.version,
                  );
                  setReview(null);
                })
              }
            >
              Apply my changes to this version
            </Button>
          </ActionRow>
        </Dialog>
      )}
      {cancel && (
        <Dialog
          title="Stop all pending file operations?"
          onClose={() => setCancel(false)}
        >
          <p>
            A recovery ZIP will download first, including your selected files
            and retained document journals. All unfinished create, rename, move
            and trash requests will stop together so dependent requests cannot
            become orphaned.
          </p>
          <p>
            Already accepted server changes are not undone. Document
            collaboration journals remain on this device. Refresh your offline
            downloads afterwards.
          </p>
          <ErrorNotice message={error} />
          <ActionRow>
            <Button
              className="button secondary"
              onClick={() => setCancel(false)}
            >
              Keep queue
            </Button>
            <Button
              className="button danger"
              disabled={!!busy}
              onClick={() =>
                void run("cancel", async () => {
                  downloadBlob(
                    await exportOfflineRecovery(session.user.id),
                    "axiom-offline-recovery.zip",
                  );
                  await cancelPendingOffline(session.user.id);
                  setCancel(false);
                })
              }
            >
              Download recovery & stop queue
            </Button>
          </ActionRow>
        </Dialog>
      )}
    </section>
  );
}
