"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, HelpText, TextInput } from "../ui/controls";
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
  useInterfaceLocale();
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
      title={uiText("Review schedule proposal")}
      subtitle={uiText(
        "Dates are applied only to this workspace. Dependency changes are included below.",
      )}
      onClose={onClose}
    >
      <p>{value.explanation}</p>
      <div className="productivity-subtoolbar">
        <label>
          <I18nText id="Start" />
          <TextInput
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
          <I18nText id="Finish" />
          <TextInput
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
            {preview.plan.proposed.length} <I18nText id="affected tasks" />
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
            <HelpText key={w}>{w}</HelpText>
          ))}
          <HelpText>
            <I18nText id="A newer task, calendar or availability change invalidates this preview. Undo will not overwrite a collaborator's later edits." />
          </HelpText>
        </>
      )}
      <ErrorNotice message={action.error} />
      <DialogFooter>
        <Button
          data-dialog-cancel
          className="button secondary"
          onClick={onClose}
        >
          <I18nText id="Keep private draft" />
        </Button>
        {preview ? (
          <Button
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
            <I18nText id="Apply reviewed schedule" />
          </Button>
        ) : (
          <Button
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
            <I18nText id="Preview affected tasks" />
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
