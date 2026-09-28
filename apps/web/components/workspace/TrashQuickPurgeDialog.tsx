"use client";
import { useRef, useState } from "react";
import { Trash2, Unlink, ShieldCheck } from "lucide-react";
import type { TrashQuickPurgePlan } from "@axiom/shared/trash";
import { post } from "../../lib/client";
import Dialog, { DialogFooter } from "../Dialog";
import {
  bytes,
  ErrorNotice,
  Loading,
  useAction,
  useData,
  useWorkspace,
} from "./ui";

export default function TrashQuickPurgeDialog({
  operationId,
  resourceId,
  onClose,
  onPurged,
}: {
  operationId: string;
  resourceId: string;
  onClose: () => void;
  onPurged: () => void;
}) {
  const path = `trash/${operationId}/items/${resourceId}/quick-purge`;
  const data = useData<TrashQuickPurgePlan>(path),
    action = useAction();
  const [confirmation, setConfirmation] = useState(""),
    [acknowledged, setAcknowledged] = useState(false);
  const mutationId = useRef(crypto.randomUUID());
  const { refresh, notify } = useWorkspace();
  const plan = data.data;
  const reload = () => {
    setConfirmation("");
    setAcknowledged(false);
    mutationId.current = crypto.randomUUID();
    data.reload();
  };
  return (
    <Dialog
      title="Remove protection & purge"
      subtitle="One confirmation. Protection removal and file deletion happen together."
      onClose={() => {
        if (!action.busy) onClose();
      }}
      className="trash-quick-dialog"
    >
      <ErrorNotice message={data.error || action.error} retry={reload} />
      {!plan ? (
        <Loading />
      ) : (
        <div className="trash-quick-review">
          <div className="trash-quick-file">
            <Trash2 size={20} aria-hidden="true" />
            <div>
              <strong>{plan.name}</strong>
              <small>{bytes(plan.bytes)} stored across all versions</small>
            </div>
          </div>
          <section aria-label="Quick purge impact">
            <h3>
              <Unlink size={16} aria-hidden="true" />
              This action will remove
            </h3>
            <ul className="trash-quick-impact">
              {plan.impacts.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </li>
              ))}
            </ul>
          </section>
          {plan.breaksLinks && (
            <p className="trash-quick-warning">
              Notes and saved revisions will be kept, but their links to this
              file will stop working. Their text is not rewritten. This includes
              older versions of the file.
            </p>
          )}
          {plan.canPurge ? (
            <>
              {plan.breaksLinks && (
                <label className="ws-checkbox">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={action.busy}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  I understand that existing attachment links will stop working.
                </label>
              )}
              <label className="trash-delete-confirm">
                Type <strong>DELETE FOREVER</strong> to remove the protection
                above and permanently delete this file.
                <input
                  aria-label="Confirm quick purge"
                  placeholder="DELETE FOREVER"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmation}
                  disabled={action.busy}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            </>
          ) : (
            <section
              className="trash-quick-blockers"
              aria-label="Remaining protection"
            >
              <h3>
                <ShieldCheck size={16} aria-hidden="true" />
                Still requires permission or review
              </h3>
              <ul>
                {plan.blockers.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p>Nothing will be changed while these protections remain.</p>
            </section>
          )}
          <p className="ws-note">
            This affects this file only. It cannot be undone. Shared stored data
            may remain. If protection changes after this preview, nothing is
            removed.
          </p>
        </div>
      )}
      <DialogFooter>
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={onClose}
        >
          Back
        </button>
        <button
          className="button secondary"
          disabled={action.busy || data.loading}
          onClick={reload}
        >
          Refresh preview
        </button>
        {plan?.canPurge && (
          <button
            className="button danger"
            disabled={
              action.busy ||
              data.loading ||
              confirmation !== "DELETE FOREVER" ||
              (plan.breaksLinks && !acknowledged)
            }
            onClick={() =>
              void action.run(async () => {
                const result = await post<{ purged: boolean; name: string }>(
                  path,
                  {
                    mutationId: mutationId.current,
                    fingerprint: plan.fingerprint,
                    confirmation,
                    acknowledgeBrokenLinks: acknowledged,
                  },
                );
                refresh();
                notify(
                  `Permanently deleted ${result.name} and removed the confirmed protection. This cannot be undone.`,
                );
                onPurged();
              })
            }
          >
            <Trash2 size={15} aria-hidden="true" />
            {action.busy ? "Removing…" : "Remove protection & purge"}
          </button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
