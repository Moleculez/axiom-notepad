"use client";
import { useState } from "react";
import type {
  AssistantProposalItem,
  AssistantProposal,
} from "@axiom/shared/assistant";
import type { SchedulePlan } from "@axiom/shared/planning";
import Dialog, { DialogFooter } from "../Dialog";
import { post } from "../../lib/client";
import { ErrorNotice, useAction, useWorkspace } from "../workspace/ui";
import ScheduleCapacityPreview from "../workspace/ScheduleCapacityPreview";
export default function AssistantScheduleReview({
  item,
  onClose,
  onChange,
}: {
  item: AssistantProposalItem;
  onClose: () => void;
  onChange: () => void;
}) {
  const [value, setValue] = useState(
      item.data as Extract<AssistantProposal, { kind: "schedule" }>,
    ),
    [preview, setPreview] = useState<{
      id: string;
      fingerprint: string;
      plan: SchedulePlan;
      spaceId: string;
    } | null>(null);
  const action = useAction(),
    { refresh, spaces } = useWorkspace();
  return (
    <Dialog
      title="Review schedule proposal"
      subtitle="Dates are applied only to this workspace. Dependency changes are included below."
      onClose={onClose}
    >
      <p>{value.explanation}</p>
      <div className="productivity-subtoolbar">
        <label>
          Start
          <input
            type="date"
            disabled={action.busy}
            value={value.startOn ?? ""}
            onChange={(e) => {
              setValue({ ...value, startOn: e.target.value || null });
              setPreview(null);
            }}
          />
        </label>
        <label>
          Finish
          <input
            type="date"
            disabled={action.busy}
            value={value.dueOn ?? ""}
            onChange={(e) => {
              setValue({ ...value, dueOn: e.target.value || null });
              setPreview(null);
            }}
          />
        </label>
      </div>
      {preview && (
        <>
          <h3>
            {spaces.find((s) => s.id === preview.spaceId)?.name} ·{" "}
            {preview.plan.proposed.length} affected tasks
          </h3>
          <div className="planning-insight-rows">
            {preview.plan.proposed.map((row) => {
              const old = preview.plan.before.find((t) => t.id === row.id);
              return (
                <div key={row.id}>
                  <strong>{old?.title ?? row.id}</strong>
                  <span>
                    {old?.startOn ?? "—"} → {old?.dueOn ?? "—"}
                  </span>
                  <span>
                    {row.startOn ?? "—"} → {row.dueOn ?? "—"}
                  </span>
                </div>
              );
            })}
          </div>
          <ScheduleCapacityPreview capacity={preview.plan.capacity} />
          {preview.plan.warnings.map((w) => (
            <p key={w} className="ws-note">
              {w}
            </p>
          ))}
          <p className="ws-note">
            A newer task, calendar or availability change invalidates this
            preview. Undo will not overwrite a collaborator's later edits.
          </p>
        </>
      )}
      <ErrorNotice message={action.error} />
      <DialogFooter>
        <button className="button secondary" onClick={onClose}>
          Keep private draft
        </button>
        {preview ? (
          <button
            className="button primary"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await post(`assistant/proposals/${item.id}/apply`, {
                  receiptId: preview.id,
                  fingerprint: preview.fingerprint,
                });
                refresh();
                onChange();
                onClose();
              })
            }
          >
            Apply reviewed schedule
          </button>
        ) : (
          <button
            className="button primary"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () =>
                setPreview(
                  await post(`assistant/proposals/${item.id}/preview`, value),
                ),
              )
            }
          >
            Preview affected tasks
          </button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
