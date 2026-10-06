"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Archive, Clock, Pause, Play, Plus } from "lucide-react";
import { z } from "zod";
import { recurrenceSchema, type Space } from "@axiom/shared/workspace";
import { nextRecurrenceDates } from "@axiom/shared/planning-suite";
import {
  planningDraftSchema,
  type PlanningDraft,
} from "@axiom/shared/planning";
import {
  ActionRow,
  Button,
  Checkbox,
  Field,
  HelpText,
  NativeSelect,
  TextInput,
} from "../ui/controls";
import Dialog, { DialogBody, DialogFooter } from "../Dialog";
import DraftGuard from "./DraftGuard";
import {
  PlanningEntityPicker,
  PersonPicker,
  closePlanningDraft,
} from "./PlanningFields";
import { PlanningHistoryDialog } from "./PlanningArchives";
import {
  Empty,
  ErrorNotice,
  Loading,
  mutate,
  useAction,
  useData,
  useWorkspace,
} from "./ui";
const Markdown = dynamic(() => import("./PlanningMarkdown"));
type Rule = z.infer<typeof recurrenceSchema>;
type Routine = {
  id: string;
  rule: Rule;
  template: PlanningDraft;
  version: number;
  enabled: boolean;
  archived: boolean;
  last_date: string | null;
};
export default function PlanningRoutines({
  space,
  readOnly,
  onClose,
}: {
  space: Space;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { revision, refresh } = useWorkspace(),
    data = useData<Routine[]>(`spaces/${space.id}/recurrences`, revision),
    people = useData<Array<{ id: string; name: string }>>(
      `spaces/${space.id}/planning-members`,
      revision,
    ),
    action = useAction();
  const [editing, setEditing] = useState<Routine | null | undefined>(undefined),
    [archived, setArchived] = useState(false),
    [history, setHistory] = useState<string | null>(null);
  const rows = data.data?.filter((r) => r.archived === archived) ?? [];
  return (
    <>
      <Dialog
        title="Recurring tasks"
        subtitle="Future template changes never rewrite generated tasks. Occurrences remain idempotent."
        onClose={onClose}
      >
        <ErrorNotice message={data.error || action.error} />
        <ActionRow>
          <label className="planning-check-label">
            <Checkbox
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Archived routines
          </label>
          <Button
            variant="primary"
            disabled={readOnly}
            onClick={() => setEditing(null)}
          >
            <Plus size={15} />
            New routine
          </Button>
        </ActionRow>
        {data.loading && !data.data ? (
          <Loading />
        ) : !rows.length ? (
          <Empty title="No recurring tasks">
            Schedule routine reviews, backups or experiments.
          </Empty>
        ) : (
          <div className="planning-routine-list">
            {rows.map((r) => (
              <article key={r.id}>
                <button onClick={() => setEditing(r)}>
                  <strong>{r.template.title}</strong>
                  <small>
                    Every {r.rule.interval} {r.rule.frequency} ·{" "}
                    {r.archived ? "archived" : r.enabled ? "active" : "paused"}
                  </small>
                </button>
                <ActionRow>
                  <Button
                    size="compact"
                    variant="ghost"
                    onClick={() => setHistory(r.id)}
                  >
                    <Clock size={14} />
                    History
                  </Button>
                  {!r.archived && (
                    <Button
                      size="compact"
                      variant="ghost"
                      disabled={readOnly || action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await mutate(
                            `spaces/${space.id}/recurrences/${r.id}`,
                            { version: r.version, enabled: !r.enabled },
                            "PATCH",
                          );
                          refresh();
                        })
                      }
                    >
                      {r.enabled ? <Pause size={14} /> : <Play size={14} />}{" "}
                      {r.enabled ? "Pause" : "Resume"}
                    </Button>
                  )}
                  <Button
                    size="compact"
                    variant="ghost"
                    disabled={readOnly || action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await mutate(
                          `spaces/${space.id}/recurrences/${r.id}`,
                          {
                            version: r.version,
                            archived: !r.archived,
                            enabled: false,
                          },
                          "PATCH",
                        );
                        refresh();
                      })
                    }
                  >
                    <Archive size={14} />
                    {r.archived ? "Reopen paused" : "Archive"}
                  </Button>
                </ActionRow>
              </article>
            ))}
          </div>
        )}
      </Dialog>
      {editing !== undefined && (
        <RoutineEditor
          key={editing?.id ?? "new"}
          space={space}
          routine={editing}
          people={people.data ?? []}
          readOnly={readOnly}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            refresh();
          }}
        />
      )}
      {history && (
        <PlanningHistoryDialog
          spaceId={space.id}
          id={history}
          title="Routine history"
          onClose={() => setHistory(null)}
          onNavigate={onClose}
          withOccurrences
        />
      )}
    </>
  );
}
function RoutineEditor({
  space,
  routine,
  people,
  readOnly,
  onClose,
  onSaved,
}: {
  space: Space;
  routine: Routine | null;
  people: Array<{ id: string; name: string }>;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: space.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    initialRule = routine
      ? { ...routine.rule, weekdays: [...(routine.rule.weekdays ?? [])] }
      : {
          frequency: "weekly" as const,
          interval: 1,
          start: today,
          until: undefined,
          weekdays: [1],
        };
  if (initialRule.frequency === "weekly" && !initialRule.weekdays?.length)
    initialRule.weekdays = [
      new Date(`${initialRule.start}T00:00:00Z`).getUTCDay(),
    ];
  const initialTemplate = planningDraftSchema.parse({
    title: "",
    body: "",
    status: "todo",
    priority: "normal",
    assigneeId: null,
    parentId: null,
    startOn: null,
    dueOn: null,
    estimateHours: null,
    labels: [],
    milestoneId: null,
    resourceIds: [],
    dependencies: [],
    ...routine?.template,
  });
  const [rule, setRule] = useState<Rule>(initialRule),
    [template, setTemplate] = useState(initialTemplate),
    [labelsText, setLabelsText] = useState(initialTemplate.labels.join(", ")),
    action = useAction(),
    parsed = recurrenceSchema.safeParse(rule),
    validDays = rule.frequency !== "weekly" || !!rule.weekdays?.length,
    dates =
      parsed.success && validDays
        ? nextRecurrenceDates(
            parsed.data,
            routine?.last_date?.slice(0, 10) ?? null,
            today,
          )
        : [];
  const patch = (value: Partial<PlanningDraft>) =>
    setTemplate((old) => ({ ...old, ...value }));
  const dirty =
      JSON.stringify(rule) !== JSON.stringify(initialRule) ||
      JSON.stringify(template) !== JSON.stringify(initialTemplate),
    close = () =>
      closePlanningDraft(dirty, action.busy, onClose, "Unsaved routine");
  return (
    <Dialog
      title={routine ? "Edit future occurrences" : "New recurring task"}
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await mutate(
              `spaces/${space.id}/recurrences${routine ? "/" + routine.id : ""}`,
              {
                rule: recurrenceSchema.parse(rule),
                template: planningDraftSchema.parse(template),
                ...(routine ? { version: routine.version } : {}),
              },
              routine ? "PATCH" : "POST",
            );
            onSaved();
          });
        }}
      >
        <DialogBody>
          <DraftGuard dirty={dirty} title="Unsaved routine" />
          <ErrorNotice message={action.error} />
          <fieldset
            disabled={readOnly || action.busy}
            className="planning-suite-form"
          >
            <Field label="Task title">
              <TextInput
                autoFocus
                required
                value={template.title}
                maxLength={300}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </Field>
            <div className="planning-field-grid">
              <Field label="Frequency">
                <NativeSelect
                  value={rule.frequency}
                  onChange={(e) =>
                    setRule((r) => ({
                      ...r,
                      frequency: e.target.value as Rule["frequency"],
                    }))
                  }
                >
                  {["daily", "weekly", "monthly"].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Interval">
                <TextInput
                  required
                  type="number"
                  min={1}
                  max={52}
                  step={1}
                  value={rule.interval}
                  onChange={(e) =>
                    setRule((r) => ({ ...r, interval: Number(e.target.value) }))
                  }
                />
              </Field>
              <Field label="Start">
                <TextInput
                  required
                  type="date"
                  value={rule.start}
                  onChange={(e) =>
                    setRule((r) => ({ ...r, start: e.target.value }))
                  }
                />
              </Field>
              <Field label="Until (optional)">
                <TextInput
                  type="date"
                  min={rule.start}
                  value={rule.until ?? ""}
                  onChange={(e) =>
                    setRule((r) => ({
                      ...r,
                      until: e.target.value || undefined,
                    }))
                  }
                />
              </Field>
            </div>
            {rule.frequency === "weekly" && (
              <fieldset className="planning-weekdays">
                <legend>Weekdays</legend>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (label, i) => (
                    <label key={label}>
                      <Checkbox
                        checked={rule.weekdays?.includes(i) ?? false}
                        onChange={(e) =>
                          setRule((r) => ({
                            ...r,
                            weekdays: e.target.checked
                              ? [...(r.weekdays ?? []), i].sort()
                              : (r.weekdays ?? []).filter((d) => d !== i),
                          }))
                        }
                      />
                      {label}
                    </label>
                  ),
                )}
              </fieldset>
            )}
            {!validDays && <HelpText>Choose at least one weekday.</HelpText>}
            <HelpText>
              {rule.frequency === "monthly"
                ? "Monthly occurrences use the start date’s day, clamped to the last day of shorter months. "
                : ""}
              Next occurrences in {space.timezone}:{" "}
              {dates.length
                ? dates.join(" · ")
                : "No future occurrences in this rule."}{" "}
              Dates already processed are never regenerated.
            </HelpText>
            <div className="planning-field-grid">
              <Field label="Assignee">
                <PersonPicker
                  label="Recurring task assignee"
                  people={people}
                  value={template.assigneeId ?? ""}
                  onChange={(v) => patch({ assigneeId: v || null })}
                />
              </Field>
              <Field label="Priority">
                <NativeSelect
                  value={template.priority}
                  onChange={(e) =>
                    patch({
                      priority: e.target.value as PlanningDraft["priority"],
                    })
                  }
                >
                  {["low", "normal", "high", "urgent"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Effort (hours)">
                <TextInput
                  type="number"
                  min={0}
                  max={10000}
                  step={0.25}
                  value={template.estimateHours ?? ""}
                  onChange={(e) =>
                    patch({
                      estimateHours:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Labels">
                <TextInput
                  value={labelsText}
                  onChange={(e) => {
                    setLabelsText(e.target.value);
                    patch({
                      labels: e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    });
                  }}
                />
              </Field>
            </div>
            <Field label="Milestone">
              <PlanningEntityPicker
                spaceId={space.id}
                kind="milestone"
                label="Recurring task milestone"
                value={template.milestoneId ?? ""}
                onChange={(v) => patch({ milestoneId: String(v) || null })}
              />
            </Field>
            <Field label="Evidence">
              <PlanningEntityPicker
                spaceId={space.id}
                kind="file"
                label="Recurring task evidence"
                multiple
                value={template.resourceIds}
                onChange={(v) => patch({ resourceIds: v as string[] })}
              />
            </Field>
            <Markdown
              initial={template.body}
              onChange={(body) => patch({ body })}
              readOnly={readOnly || action.busy}
            />
          </fieldset>
          <HelpText>
            Generated tasks are due on the occurrence date. Parent and
            dependency links are intentionally not copied.
          </HelpText>
        </DialogBody>
        <DialogFooter>
          <ActionRow>
            <Button type="button" disabled={action.busy} onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              pending={action.busy}
              disabled={
                readOnly ||
                action.busy ||
                !parsed.success ||
                !validDays ||
                !template.title.trim()
              }
            >
              Save routine
            </Button>
          </ActionRow>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
