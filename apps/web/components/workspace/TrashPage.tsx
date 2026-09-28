"use client";
import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  Trash2,
  RotateCcw,
} from "lucide-react";
import {
  trashItemStatus,
  type TrashOperation,
  type TrashOperationPage,
  type TrashResultFilter,
} from "@axiom/shared/trash";
import { api } from "../../lib/client";
import Dialog, { DialogFooter } from "../Dialog";
import TrashProtectionDetails from "./TrashProtectionDetails";
import TrashQuickPurgeDialog from "./TrashQuickPurgeDialog";
import {
  bytes,
  ErrorNotice,
  Loading,
  useAction,
  useData,
  useWorkspace,
} from "./ui";
export { default } from "./TrashConsole";

export function TrashOperationDialog({
  id,
  onClose,
  onComplete,
  embedded = false,
  initialQuickPurge,
}: {
  id: string;
  onClose: () => void;
  onComplete: (op: TrashOperation) => void;
  embedded?: boolean;
  initialQuickPurge?: string | null;
}) {
  const [tick, setTick] = useState(0),
    [offset, setOffset] = useState(0),
    [filter, setFilter] = useState<TrashResultFilter>("all"),
    [expanded, setExpanded] = useState<string | null>(null),
    [quickTarget, setQuickTarget] = useState<string | null>(
      initialQuickPurge ?? null,
    ),
    [confirmation, setConfirmation] = useState("");
  const data = useData<TrashOperationPage>(
      `trash/${id}?offset=${offset}&filter=${filter}`,
      tick,
    ),
    action = useAction(),
    finished = useRef("");
  const { navigate } = useWorkspace();
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
  const command = async (name: string) => {
    await api(`trash/${id}/${name}`, {
      method: "POST",
      body: JSON.stringify({ mutationId: crypto.randomUUID(), confirmation }),
    });
    setConfirmation("");
    setOffset(0);
    setTick((n) => n + 1);
  };
  const run = (name: string) => void action.run(() => command(name));
  const recheck = async () => {
    await command("recheck");
    setFilter("all");
    setExpanded(null);
  };
  const preview = op?.status === "preview",
    purge = op?.action === "purge",
    workspaces = op?.target_kind === "workspaces";
  const attention = op ? op.blocked + op.skipped + op.cancelled : 0;
  const title = busy
    ? purge
      ? "Deleting from Trash"
      : "Restoring from Trash"
    : preview
      ? purge
        ? "Delete permanently"
        : "Restore from Trash"
      : "Trash results";
  const footer = (
    <>
      <button className="button secondary" onClick={onClose}>
        {busy ? "Continue in background" : "Close"}
      </button>
      {busy ? (
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={() => run("cancel")}
        >
          Cancel unfinished work
        </button>
      ) : op && preview && op.pending > 0 ? (
        <button
          className={`button ${purge ? "danger" : "primary"}`}
          disabled={
            action.busy ||
            data.loading ||
            (purge && confirmation !== "DELETE FOREVER")
          }
          onClick={() => run("confirm")}
        >
          {purge ? (
            <Trash2 size={16} aria-hidden="true" />
          ) : (
            <RotateCcw size={16} aria-hidden="true" />
          )}
          {purge ? "Delete" : "Restore"} {op.pending}{" "}
          {workspaces ? "workspace" : "item"}
          {op.pending === 1 ? "" : "s"}
        </button>
      ) : null}
    </>
  );
  const content = (
    <>
      <ErrorNotice message={data.error || action.error} retry={data.reload} />
      {!op ? (
        <Loading />
      ) : (
        <div className="trash-review">
          <div className="trash-review-summary" aria-live="polite">
            <div>
              <CheckCircle2 size={18} aria-hidden="true" />
              <strong>{preview || busy ? op.pending : op.done}</strong>
              <span>{preview || busy ? "Ready" : "Completed"}</span>
            </div>
            <div>
              <ShieldCheck size={18} aria-hidden="true" />
              <strong>{attention}</strong>
              <span>Need attention</span>
            </div>
            <div>
              <span className="trash-review-size">{bytes(op.bytes)}</span>
              <span>Stored in selection</span>
            </div>
          </div>
          {preview && (
            <p className="trash-review-intro">
              {op.pending === 0
                ? `Nothing can be ${purge ? "deleted" : "restored"} yet. Review the protection below to see what to do next; you can also leave these items safely in Trash.`
                : `${purge ? "Only the ready items will be permanently deleted" : "Ready items will be restored"}. ${attention ? "Items needing attention will stay in Trash." : "Review the selection below before continuing."}`}
            </p>
          )}
          {preview && !purge && !op.pending && (
            <p>
              Restore the original folder or choose a different restore
              destination in Trash options.
            </p>
          )}
          {workspaces && (
            <p className="ws-note">
              {purge
                ? "Workspace deletion has a 30-second cancellation window. Open Lifecycle for final progress and any remaining protections."
                : "Restores each workspace’s previous active or archived state. Individual file Trash states are preserved."}
            </p>
          )}
          {op.action === "restore" && !workspaces && (
            <p className="ws-note">
              {op.destination_id
                ? "Restore to the chosen folder."
                : op.restore_policy === "root"
                  ? "Use the original location, or the workspace root if it is unavailable."
                  : "Keep items in Trash if their original folder is unavailable."}{" "}
              {op.conflict_policy === "keep-both"
                ? "Name conflicts keep both files."
                : "Existing names are skipped."}{" "}
              Nothing is overwritten.
            </p>
          )}
          {busy && (
            <div className="trash-review-progress">
              <progress
                aria-label="Trash operation progress"
                max={op.total || 1}
                value={op.total - op.pending}
              />
              <p role="status">
                {op.status === "queued"
                  ? "Queued for background processing…"
                  : "Processing in the background…"}
              </p>
            </div>
          )}
          <div className="trash-review-toolbar">
            <div
              className="trash-review-filters"
              role="group"
              aria-label="Filter Trash results"
            >
              {(
                [
                  ["all", "All", op.total],
                  ["attention", "Needs attention", attention],
                  ["ready", "Ready", op.pending],
                  ...(op.done ? [["done", "Completed", op.done]] : []),
                ] as [TrashResultFilter, string, number][]
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => {
                    setFilter(value);
                    setOffset(0);
                    setExpanded(null);
                  }}
                >
                  {label}
                  <span>{count}</span>
                </button>
              ))}
            </div>
            {!busy && (
              <button
                className="text-button"
                disabled={action.busy || data.loading}
                onClick={() => void action.run(recheck)}
              >
                <RefreshCw size={14} aria-hidden="true" />
                {action.busy ? "Checking…" : "Recheck"}
              </button>
            )}
          </div>
          <div
            className="trash-review-items"
            aria-label="Trash item results"
            aria-busy={data.loading}
          >
            {!data.data!.items.length && (
              <p className="trash-review-empty">No items in this view.</p>
            )}
            {data.data!.items.map((item) => (
              <article className="trash-review-item" key={item.resource_id}>
                <div className="trash-review-item-heading">
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.original_path} · {bytes(item.bytes)}
                    </small>
                  </div>
                  <span className="trash-item-state" data-status={item.status}>
                    {trashItemStatus(item, op)}
                  </span>
                </div>
                {item.reason && (
                  <p className="trash-item-reason">{item.reason}</p>
                )}
                {!busy &&
                  purge &&
                  !workspaces &&
                  item.kind === "file" &&
                  item.status === "blocked" && (
                    <button
                      className="text-button trash-quick-trigger"
                      onClick={() => setQuickTarget(item.resource_id)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      Remove protection & purge…
                    </button>
                  )}
                {!busy &&
                  purge &&
                  item.status === "blocked" &&
                  (workspaces ? (
                    <button
                      className="text-button"
                      onClick={() => {
                        onClose();
                        navigate(`/workspaces/${item.space_id}/lifecycle`);
                      }}
                    >
                      Review workspace lifecycle
                    </button>
                  ) : (
                    <button
                      className="text-button trash-protection-toggle"
                      aria-expanded={expanded === item.resource_id}
                      aria-controls={`trash-protection-${item.resource_id}`}
                      onClick={() =>
                        setExpanded((old) =>
                          old === item.resource_id ? null : item.resource_id,
                        )
                      }
                    >
                      {expanded === item.resource_id ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      Review protection
                    </button>
                  ))}
                {item.status === "skipped" && (
                  <p className="trash-guidance">
                    Close this preview and select the current item again if you
                    still want to remove it.
                  </p>
                )}
                {expanded === item.resource_id && !busy && (
                  <div id={`trash-protection-${item.resource_id}`}>
                    <TrashProtectionDetails
                      operationId={id}
                      resourceId={item.resource_id}
                      onChanged={recheck}
                      onClose={onClose}
                    />
                  </div>
                )}
              </article>
            ))}
          </div>
          {(data.data!.filteredTotal > 50 || offset > 0) && (
            <div className="productivity-pagination">
              <span>
                {Math.min(offset + 1, data.data!.filteredTotal)}–
                {Math.min(offset + 50, data.data!.filteredTotal)} of{" "}
                {data.data!.filteredTotal}
              </span>
              <button
                className="button secondary small"
                disabled={!offset || data.loading}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous results
              </button>
              <button
                className="button secondary small"
                disabled={data.data!.nextOffset == null || data.loading}
                onClick={() => setOffset(data.data!.nextOffset!)}
              >
                Next results
              </button>
            </div>
          )}
          <details className="trash-review-policy">
            <summary>How safe cleanup works</summary>
            <p>
              Only this selection and its included descendants are considered.
              New Trash items are never added automatically. Files that change
              after preview are skipped. Shared stored data may remain, so
              stored size is not a promise of space freed.
            </p>
            <p>
              Recheck examines saved server edits; it does not synchronize open
              notes on your devices. Save them first. Ordinary cleanup preserves
              references. The separate Remove protection & purge action requires
              explicit confirmation and permission to remove each supported
              protection.
            </p>
          </details>
          {!busy && preview && purge && op.pending > 0 && (
            <label className="trash-delete-confirm">
              Type <strong>DELETE FOREVER</strong> to delete the {op.pending}{" "}
              ready {workspaces ? "workspace" : "item"}
              {op.pending === 1 ? "" : "s"}. This cannot be undone.
              <input
                aria-label="Confirm permanent Trash deletion"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="DELETE FOREVER"
              />
            </label>
          )}
          {!preview && !busy && attention > 0 && (
            <p className="trash-guidance">
              Resolve any protection above, then choose Recheck to prepare a new
              confirmation for the remaining items.
            </p>
          )}
        </div>
      )}
    </>
  );
  if (quickTarget)
    return (
      <TrashQuickPurgeDialog
        operationId={id}
        resourceId={quickTarget}
        onClose={() => setQuickTarget(null)}
        onPurged={() => {
          setQuickTarget(null);
          setExpanded(null);
          setFilter("all");
          setOffset(0);
          setConfirmation("");
          setTick((n) => n + 1);
        }}
      />
    );
  return embedded ? (
    <section className="console-operation">
      <h2>{title}</h2>
      {content}
      <div className="ws-actions">{footer}</div>
    </section>
  ) : (
    <Dialog
      title={title}
      subtitle="Recover what matters. Remove only what is no longer in use."
      onClose={onClose}
      wide
      className="trash-review-dialog"
    >
      {content}
      <DialogFooter>{footer}</DialogFooter>
    </Dialog>
  );
}
