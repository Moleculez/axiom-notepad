"use client";
import { useEffect, useRef, useState } from "react";
import type { TrashOperation, TrashOperationPage } from "@axiom/shared/trash";
import { api } from "../../lib/client";
import Dialog from "../Dialog";
import { bytes, ErrorNotice, Loading, useAction, useData } from "./ui";
export { default } from "./TrashConsole";

export function TrashOperationDialog({
  id,
  onClose,
  onComplete,
  embedded = false,
}: {
  id: string;
  onClose: () => void;
  onComplete: (op: TrashOperation) => void;
  embedded?: boolean;
}) {
  const [tick, setTick] = useState(0),
    [offset, setOffset] = useState(0),
    [confirmation, setConfirmation] = useState("");
  const data = useData<TrashOperationPage>(
      `trash/${id}?offset=${offset}`,
      tick,
    ),
    action = useAction(),
    finished = useRef("");
  const op = data.data?.operation,
    busy = op?.status === "queued" || op?.status === "running";
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1800);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (
      op &&
      op.status !== "preview" &&
      !busy &&
      finished.current !== `${op.id}:${op.attempt}:${op.status}`
    ) {
      finished.current = `${op.id}:${op.attempt}:${op.status}`;
      onComplete(op);
    }
  }, [op]);
  const run = (command: string) =>
    void action.run(async () => {
      await api(`trash/${id}/${command}`, {
        method: "POST",
        body: JSON.stringify({ mutationId: crypto.randomUUID(), confirmation }),
      });
      setTick((n) => n + 1);
    });
  const title =
    op?.status === "preview"
      ? "Review Trash operation"
      : "Trash operation results";
  const content = (
    <>
      <ErrorNotice message={data.error || action.error} retry={data.reload} />
      {!op ? (
        <Loading />
      ) : (
        <>
          <p>
            {op.status === "preview"
              ? `${op.pending} eligible · ${op.blocked + op.skipped} protected or changed · ${op.total} unique ${op.target_kind === "workspaces" ? "workspace targets (groups include projects once)" : "items including descendants"}.`
              : `${op.done} completed · ${op.pending} remaining · ${op.blocked + op.skipped + op.cancelled} retained.`}
          </p>
          <p className="muted">
            {bytes(op.bytes)} stored across the selection. Shared blobs may
            remain in storage. Targets and revisions are frozen; new Trash items
            are not included. Protected or changed items are skipped.
          </p>
          {op.target_kind === "workspaces" && (
            <p className="ws-note">
              {op.action === "purge"
                ? "Completed here means the owner’s deletion request was queued. Each workspace has a 30-second cancellation window; review its Lifecycle page for final progress and blockers."
                : "Restores the workspace’s previous active or archived state. Independent project and file Trash states are preserved."}
            </p>
          )}
          {op.action === "restore" && op.target_kind !== "workspaces" && (
            <p className="ws-note">
              {op.destination_id
                ? "Top-level selections move to the chosen folder. "
                : "If the original folder is unavailable: "}
              {op.restore_policy === "retain"
                ? "keep items in Trash. Restore the original folder first, or change the choice and create a new preview."
                : "restore to the workspace root. Items with available folders return to their original location."}
            </p>
          )}
          {op.action === "restore" && op.target_kind !== "workspaces" && (
            <p className="ws-note">
              Name conflicts:{" "}
              {op.conflict_policy === "skip"
                ? "skip existing names"
                : "keep both with a numbered suffix"}
              . Existing files are never overwritten.
            </p>
          )}
          {op.status === "preview" && op.blocked > 0 && (
            <div className="trash-index-help">
              <p className="ws-note">
                Unsynchronized edits may contain references that are not indexed
                yet. Save your open notes, then recheck. Referenced research
                evidence is never force-deleted.
              </p>
              <button
                className="button secondary"
                disabled={action.busy}
                onClick={() => run("recheck")}
              >
                {action.busy
                  ? "Checking saved references…"
                  : "Sync & recheck preview"}
              </button>
            </div>
          )}
          {busy && (
            <>
              <progress
                aria-label="Trash operation progress"
                max={op.total}
                value={op.total - op.pending}
              />
              <p role="status">
                {op.status === "queued"
                  ? "Queued for background processing…"
                  : "Processing safely in the background…"}
              </p>
            </>
          )}
          <div className="trash-results" aria-label="Trash item results">
            {data.data!.items.map((item) => (
              <div key={item.resource_id} className="trash-result-row">
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.original_path}</small>
                  {item.reason && (
                    <small className="danger-text">{item.reason}</small>
                  )}
                </span>
                <span>
                  {item.status === "pending" && op.status === "preview"
                    ? "Eligible"
                    : item.status}
                </span>
              </div>
            ))}
          </div>
          <div className="productivity-pagination">
            <span>
              Items {offset + 1}–{Math.min(offset + 50, op.total)} of {op.total}
            </span>
            <button
              className="button secondary small"
              disabled={!offset}
              onClick={() => setOffset(offset - 50)}
            >
              Previous results
            </button>
            <button
              className="button secondary small"
              disabled={data.data!.nextOffset == null}
              onClick={() => setOffset(data.data!.nextOffset!)}
            >
              Next results
            </button>
          </div>
          {!busy &&
            (op.status === "preview" || op.blocked + op.cancelled > 0) && (
              <>
                {op.action === "purge" && (
                  <label>
                    Type DELETE FOREVER to confirm irreversible deletion of
                    eligible items
                    <input
                      aria-label="Confirm permanent Trash deletion"
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                )}
                <div className="ws-actions">
                  <button className="button secondary" onClick={onClose}>
                    Close
                  </button>
                  <button
                    className="button primary"
                    disabled={
                      action.busy ||
                      (op.action === "purge" &&
                        confirmation !== "DELETE FOREVER") ||
                      (op.status === "preview" && !op.pending)
                    }
                    onClick={() =>
                      run(op.status === "preview" ? "confirm" : "retry")
                    }
                  >
                    {op.status !== "preview"
                      ? "Retry retained items"
                      : op.action === "purge"
                        ? `Delete ${op.pending} eligible ${op.target_kind === "workspaces" ? "workspace" : "item"}${op.pending === 1 ? "" : "s"}`
                        : `Restore ${op.pending} ${op.target_kind === "workspaces" ? "workspace" : "item"}${op.pending === 1 ? "" : "s"}`}
                  </button>
                </div>
              </>
            )}
          {busy && (
            <div className="ws-actions">
              <button className="button secondary" onClick={onClose}>
                Continue in background
              </button>
              <button
                className="button secondary"
                disabled={action.busy}
                onClick={() => run("cancel")}
              >
                Cancel unfinished work
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
  return embedded ? (
    <section className="console-operation">
      <h2>{title}</h2>
      {content}
    </section>
  ) : (
    <Dialog title={title} onClose={onClose} wide>
      {content}
    </Dialog>
  );
}
