"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  Button,
  HelpText,
  TextArea,
  TextInput,
  NativeSelect,
} from "../ui/controls";
import { useMemo, useState } from "react";
import { versionDiff } from "@axiom/shared/version-diff";
import { taskStatusSchema, taskPrioritySchema } from "@axiom/shared/workspace";
import type {
  AssistantEvidence,
  AssistantProposalItem,
  AssistantProposal,
} from "@axiom/shared/assistant";
import { api, post } from "../../lib/client";
import Dialog from "../Dialog";
import { ErrorNotice, useData, useWorkspace } from "../workspace/ui";
import AssistantScheduleReview from "./AssistantScheduleReview";
type Preview = {
  id: string;
  fingerprint: string;
  before: unknown;
  after: unknown;
  kind: string;
};
export default function AssistantProposalReview(props: {
  item: AssistantProposalItem;
  spaceId: string;
  evidence: AssistantEvidence[];
  onClose: () => void;
  onChange: () => void;
}) {
  return props.item.data.kind === "schedule" ? (
    <AssistantScheduleReview {...props} />
  ) : (
    <TaskDocumentReview {...props} />
  );
}
function TaskDocumentReview({
  item,
  spaceId,
  evidence,
  onClose,
  onChange,
}: {
  item: AssistantProposalItem;
  spaceId: string;
  evidence: AssistantEvidence[];
  onClose: () => void;
  onChange: () => void;
}) {
  useInterfaceLocale();
  const { navigate, refresh, notify } = useWorkspace();
  const [data, setData] = useState<
      Exclude<AssistantProposal, { kind: "schedule" }>
    >(item.data as Exclude<AssistantProposal, { kind: "schedule" }>),
    [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [labels, setLabels] = useState(
    data.kind === "document" ? "" : data.fields.labels.join(", "),
  );
  const members = useData<{ id: string; name: string }[]>(
    data.kind !== "document"
      ? `spaces/${data.kind === "task-update" ? (evidence.find((e) => e.key === data.evidenceKey)?.spaceId ?? spaceId) : spaceId}/planning-members`
      : null,
  );
  const text = (v: unknown) =>
    typeof v === "string" ? v : JSON.stringify(v, null, 2);
  const diff = useMemo(
    () =>
      preview
        ? versionDiff(text(preview.before ?? ""), text(preview.after))
        : null,
    [preview],
  );
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const update = (next: Exclude<AssistantProposal, { kind: "schedule" }>) => {
    setData(next);
    setPreview(null);
  };
  return (
    <Dialog
      title={uiText("Review proposed changes")}
      subtitle={uiText(
        "Private draft · Nothing changes until you explicitly publish or apply",
      )}
      onClose={onClose}
    >
      <p>{data.explanation}</p>
      <fieldset className="assistant-proposal-form" disabled={busy}>
        {data.kind === "document" ? (
          <label>
            <I18nText id="Proposed replacement" />
            <TextArea
              rows={10}
              maxLength={30000}
              value={data.source}
              onChange={(e) => update({ ...data, source: e.target.value })}
            />
          </label>
        ) : (
          <>
            <label>
              <I18nText id="Title" />
              <TextInput
                value={data.fields.title}
                maxLength={300}
                onChange={(e) =>
                  update({
                    ...data,
                    fields: { ...data.fields, title: e.target.value },
                  })
                }
              />
            </label>
            <label>
              <I18nText id="Description" />
              <TextArea
                rows={5}
                maxLength={12000}
                value={data.fields.body}
                onChange={(e) =>
                  update({
                    ...data,
                    fields: { ...data.fields, body: e.target.value },
                  })
                }
              />
            </label>
            <div className="assistant-fields">
              <label>
                <I18nText id="Status" />
                <NativeSelect
                  value={data.fields.status}
                  onChange={(e) =>
                    update({
                      ...data,
                      fields: {
                        ...data.fields,
                        status: taskStatusSchema.parse(e.target.value),
                      },
                    })
                  }
                >
                  {taskStatusSchema.options.map((v) => (
                    <option key={v} value={v}>
                      {v.replaceAll("_", " ")}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label>
                <I18nText id="Priority" />
                <NativeSelect
                  value={data.fields.priority}
                  onChange={(e) =>
                    update({
                      ...data,
                      fields: {
                        ...data.fields,
                        priority: taskPrioritySchema.parse(e.target.value),
                      },
                    })
                  }
                >
                  {taskPrioritySchema.options.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </NativeSelect>
              </label>
              <label>
                <I18nText id="Assignee" />
                <NativeSelect
                  value={data.fields.assigneeId ?? ""}
                  onChange={(e) =>
                    update({
                      ...data,
                      fields: {
                        ...data.fields,
                        assigneeId: e.target.value || null,
                      },
                    })
                  }
                >
                  <option value="">
                    <I18nText id="Unassigned" />
                  </option>
                  {members.data?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label>
                <I18nText id="Effort (hours)" />
                <TextInput
                  type="number"
                  min={0}
                  max={10000}
                  value={data.fields.estimateHours ?? ""}
                  onChange={(e) =>
                    update({
                      ...data,
                      fields: {
                        ...data.fields,
                        estimateHours:
                          e.target.value === "" ? null : Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            </div>
            <label>
              <I18nText id="Labels, separated by commas" />
              <TextInput
                value={labels}
                onChange={(e) => {
                  setLabels(e.target.value);
                  update({
                    ...data,
                    fields: {
                      ...data.fields,
                      labels: e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    },
                  });
                }}
              />
            </label>
            <HelpText>
              <I18nText id="Schedules and dependencies are unchanged. New tasks are unscheduled." />
            </HelpText>
          </>
        )}
      </fieldset>
      {preview && (
        <section aria-label={uiText("Changes to review")}>
          <h3>
            <I18nText id="Before → proposed" />
          </h3>
          <pre className="assistant-diff">
            {diff?.spans.map((span, i) =>
              span.kind === "remove" ? (
                <del key={i}>{span.text}</del>
              ) : span.kind === "add" ? (
                <ins key={i}>{span.text}</ins>
              ) : (
                <span key={i}>{span.text}</span>
              ),
            )}
          </pre>
        </section>
      )}
      <ErrorNotice message={error} />
      <div className="dialog-footer">
        <Button
          data-dialog-cancel
          className="button secondary"
          disabled={busy}
          onClick={onClose}
        >
          <I18nText id="Keep private draft" />
        </Button>
        {!preview ? (
          <Button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void run(async () =>
                setPreview(
                  await post(`assistant/proposals/${item.id}/preview`, data),
                ),
              )
            }
          >
            <I18nText id="Preview exact changes" />
          </Button>
        ) : (
          <Button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (data.kind === "document") {
                  const e = evidence.find((e) => e.key === data.evidenceKey)!;
                  // Validate again before navigation; the mounted suggestion editor repeats this check.
                  await api(
                    `assistant/proposals/${item.id}/draft?receipt=${preview.id}`,
                  );
                  navigate(
                    `/${e.format === "latex" ? "math" : "notes"}/${e.id}?assistantDraft=${item.id}&assistantReceipt=${preview.id}`,
                  );
                  onClose();
                  notify(
                    "Review and edit the private proposal, then explicitly publish it. Publishing shares it with collaborators.",
                  );
                } else {
                  await post(`assistant/proposals/${item.id}/apply`, {
                    receiptId: preview.id,
                    fingerprint: preview.fingerprint,
                  });
                  refresh();
                  onChange();
                  onClose();
                  notify(
                    "Reviewed task change applied. Undo is available in the assistant.",
                  );
                }
              })
            }
          >
            {data.kind === "document"
              ? uiText("Open suggestion editor")
              : uiText("Apply reviewed task change")}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
