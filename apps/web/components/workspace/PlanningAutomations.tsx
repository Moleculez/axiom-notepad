"use client";
import { useState } from "react";
import { Archive, Check, Pause, Play, Plus, RotateCcw, X } from "lucide-react";
import type { Space } from "@axiom/shared/workspace";
import type { ArchivePage } from "@axiom/shared/planning-archives";
import {
  ruleInputSchema,
  validateRuleConfiguration,
  localDay,
  fieldDisplay,
  type AutomationRule,
  type AutomationRun,
  type FieldDefinitions,
  type TaskField,
  type FieldValue,
  type MetadataPatch,
} from "@axiom/shared/planning-lab";
import Dialog, { DialogBody, DialogFooter } from "../Dialog";
import {
  ActionRow,
  Button,
  Checkbox,
  Field,
  HelpText,
  IconButton,
  NativeSelect,
  TextInput,
} from "../ui/controls";
import { api, ApiError } from "../../lib/client";
import {
  ErrorNotice,
  Loading,
  Empty,
  mutate,
  useAction,
  useData,
  useWorkspace,
} from "./ui";
import {
  ArchiveSearch,
  ArchivePagination,
  usePlanningArchive,
} from "./PlanningArchiveControls";
import { closePlanningDraft, PersonPicker } from "./PlanningFields";
import { PlanningFieldSettings, TaskFieldInput } from "./PlanningCustomFields";
import DraftGuard from "./DraftGuard";
type People = Array<{ id: string; name: string }>;
type RuleDraft = ReturnType<typeof ruleInputSchema.parse>;
const statuses = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};
const priorities = ["low", "normal", "high", "urgent"] as const;
function fieldDefault(f: TaskField): FieldValue {
  return f.kind === "number"
    ? 0
    : f.kind === "checkbox"
      ? false
      : f.kind === "date"
        ? localDay("UTC")
        : f.kind === "select"
          ? (f.options.find((o) => !o.archived)?.id ?? null)
          : f.kind === "multiselect"
            ? []
            : "";
}
export default function PlanningLabSettings({ space }: { space: Space }) {
  const { revision } = useWorkspace(),
    people = useData<People>(`spaces/${space.id}/planning-members`, revision),
    [tab, setTab] = useState("fields");
  return (
    <div className="planning-lab-settings">
      <nav className="planning-section-tabs" aria-label="Planning settings">
        {["fields", "rules", "review"].map((v) => (
          <button key={v} aria-pressed={tab === v} onClick={() => setTab(v)}>
            {v === "fields"
              ? "Task fields"
              : v === "rules"
                ? "Automations"
                : "Review queue"}
          </button>
        ))}
      </nav>
      {tab === "fields" ? (
        <PlanningFieldSettings space={space} />
      ) : tab === "rules" ? (
        <AutomationRules
          space={space}
          people={people.data ?? []}
          onReview={() => setTab("review")}
        />
      ) : (
        <AutomationReviewQueue space={space} people={people.data ?? []} />
      )}
    </div>
  );
}
function AutomationRules({
  space,
  people,
  onReview,
}: {
  space: Space;
  people: People;
  onReview: () => void;
}) {
  const { revision, refresh, notify } = useWorkspace(),
    data = useData<{ items: AutomationRule[] }>(
      `spaces/${space.id}/planning-automations`,
      revision,
    ),
    fields = useData<FieldDefinitions>(
      `spaces/${space.id}/planning-fields`,
      revision,
    ),
    [editing, setEditing] = useState<AutomationRule | "new" | null>(null),
    [showArchived, setShowArchived] = useState(false),
    action = useAction(),
    canManage =
      space.can_manage &&
      space.role === "editor" &&
      space.effective_status === "active";
  const operate = (rule: AutomationRule, operation: string) =>
    void action.run(async () => {
      const result = await mutate(
        `spaces/${space.id}/planning-automations/${rule.id}/${operation}`,
        { version: rule.version },
      );
      refresh();
      if (operation === "run") {
        notify(
          result.status === "pending"
            ? "Proposal prepared. Review it before applying."
            : result.status === "noop"
              ? "No task changes matched this rule."
              : "This run needs attention. Open the review queue.",
        );
        onReview();
      }
    });
  return (
    <section className="planning-lab-settings">
      <ActionRow align="between">
        <div>
          <h2>Reviewed automations</h2>
          <HelpText>
            Rules only prepare metadata proposals. A manager must review and
            apply each run.
          </HelpText>
        </div>
        <Button
          disabled={!canManage || !fields.data}
          onClick={() => setEditing("new")}
        >
          <Plus size={15} />
          New rule
        </Button>
      </ActionRow>
      <ErrorNotice
        message={data.error || fields.error}
        retry={() => {
          data.reload();
          fields.reload();
        }}
      />
      <ErrorNotice message={action.error} />
      <label className="planning-check-label">
        <Checkbox
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Show archived rules
      </label>
      {!data.data ? (
        <Loading />
      ) : !data.data.items.filter((r) => showArchived || !r.archived).length ? (
        <Empty title="No automation rules">
          Start with one small rule. New rules are paused by default.
        </Empty>
      ) : (
        <div className="planning-lab-list">
          {data.data.items
            .filter((r) => showArchived || !r.archived)
            .map((r) => (
              <article className="planning-lab-row" key={r.id}>
                <div>
                  <Button variant="ghost" onClick={() => setEditing(r)}>
                    {r.name}
                  </Button>
                  <HelpText>
                    {r.archived ? "Archived" : r.enabled ? "Enabled" : "Paused"}{" "}
                    ·{" "}
                    {r.trigger === "daily"
                      ? `Daily at ${r.at} (${space.timezone ?? "UTC"})`
                      : r.trigger === "created"
                        ? "Task created"
                        : "Metadata changed"}{" "}
                    · {r.actions.length} actions
                  </HelpText>
                </div>
                <ActionRow>
                  {r.enabled && (
                    <Button
                      size="compact"
                      disabled={!canManage || action.busy}
                      onClick={() => operate(r, "run")}
                    >
                      <Play size={14} />
                      Run now
                    </Button>
                  )}
                  {r.enabled && (
                    <Button
                      size="compact"
                      disabled={!canManage || action.busy}
                      onClick={() => operate(r, "pause")}
                    >
                      <Pause size={14} />
                      Pause
                    </Button>
                  )}
                  <Button
                    size="compact"
                    variant="ghost"
                    disabled={!canManage || action.busy}
                    onClick={() =>
                      operate(r, r.archived ? "reopen" : "archive")
                    }
                  >
                    {r.archived ? (
                      <RotateCcw size={14} />
                    ) : (
                      <Archive size={14} />
                    )}{" "}
                    {r.archived ? "Reopen" : "Archive"}
                  </Button>
                </ActionRow>
              </article>
            ))}
        </div>
      )}
      {editing && fields.data && (
        <RuleEditor
          key={editing === "new" ? "new" : editing.id}
          space={space}
          people={people}
          definitions={fields.data ?? undefined}
          initial={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
function RuleEditor({
  space,
  people,
  definitions,
  initial,
  onClose,
}: {
  space: Space;
  people: People;
  definitions: FieldDefinitions;
  initial?: AutomationRule;
  onClose: () => void;
}) {
  const { refresh, notify } = useWorkspace(),
    action = useAction(),
    [source] = useState<RuleDraft>(() =>
      initial
        ? ruleInputSchema.parse(
            Object.fromEntries(
              Object.entries(initial).filter(
                ([k]) =>
                  !["id", "space_id", "version", "configured_by"].includes(k),
              ),
            ),
          )
        : {
            name: "",
            trigger: "changed",
            watched: ["status"],
            at: "09:00",
            conditions: [],
            actions: [{ kind: "status", value: "in_progress" }],
            enabled: false,
            archived: false,
          },
    ),
    [draft, setDraft] = useState(source),
    [fieldsVersion] = useState(definitions.version);
  const parsed = ruleInputSchema.safeParse(draft);
  let configurationError: string | null = null;
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    configurationError =
      issue.path[0] === "name"
        ? "Add a rule name."
        : `${issue.path.length ? issue.path.join(" · ") + ": " : ""}${issue.message}`;
  } else {
    try {
      validateRuleConfiguration(parsed.data, definitions.items);
    } catch (error) {
      configurationError = (error as Error).message;
    }
  }
  const dirty = JSON.stringify(source) !== JSON.stringify(draft),
    valid = !configurationError,
    canManage =
      space.can_manage &&
      space.role === "editor" &&
      space.effective_status === "active",
    fields = definitions.items.filter((f) => !f.archived),
    close = () =>
      closePlanningDraft(
        dirty,
        action.busy,
        onClose,
        "Unsaved automation rule",
      );
  const condition = (i: number, p: Partial<RuleDraft["conditions"][number]>) =>
    setDraft((old) => ({
      ...old,
      conditions: old.conditions.map((c, n) => (n === i ? { ...c, ...p } : c)),
    }));
  const setAction = (i: number, a: RuleDraft["actions"][number]) =>
    setDraft((old) => ({
      ...old,
      actions: old.actions.map((v, n) => (n === i ? a : v)),
    }));
  return (
    <Dialog
      title={initial ? "Edit automation rule" : "New automation rule"}
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || !canManage) return;
          void action.run(async () => {
            await mutate(
              `spaces/${space.id}/planning-automations${initial ? "/" + initial.id : ""}`,
              { ...draft, version: initial?.version, fieldsVersion },
              initial ? "PATCH" : "POST",
            );
            refresh();
            notify(
              draft.enabled
                ? "Rule enabled. All runs still need review."
                : "Paused rule saved.",
            );
            onClose();
          });
        }}
      >
        <DialogBody>
          <DraftGuard dirty={dirty} title="Unsaved automation rule" />
          <ErrorNotice message={action.error} />
          <fieldset
            disabled={!canManage || action.busy}
            className="planning-suite-form"
          >
            <Field label="Rule name">
              <TextInput
                required
                maxLength={120}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <div className="planning-field-grid">
              <Field label="Trigger">
                <NativeSelect
                  value={draft.trigger}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      trigger: e.target.value as RuleDraft["trigger"],
                    })
                  }
                >
                  <option value="created">Task created</option>
                  <option value="changed">Task metadata changed</option>
                  <option value="daily">Daily schedule</option>
                </NativeSelect>
              </Field>
              {draft.trigger === "daily" && (
                <Field label={`Local time (${space.timezone ?? "UTC"})`}>
                  <TextInput
                    required
                    type="time"
                    value={draft.at}
                    onChange={(e) => setDraft({ ...draft, at: e.target.value })}
                  />
                </Field>
              )}
            </div>
            {draft.trigger === "changed" && (
              <section>
                <h3>Watch changes to</h3>
                <ActionRow>
                  {(
                    [
                      "status",
                      "priority",
                      "assignee_id",
                      "labels",
                      "custom_fields",
                    ] as const
                  ).map((k) => (
                    <label className="planning-check-label" key={k}>
                      <Checkbox
                        checked={draft.watched.includes(k)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            watched: e.target.checked
                              ? [...draft.watched, k]
                              : draft.watched.filter((v) => v !== k),
                          })
                        }
                      />
                      {
                        {
                          status: "Status",
                          priority: "Priority",
                          assignee_id: "Assignee",
                          labels: "Labels",
                          custom_fields: "Custom properties",
                        }[k]
                      }
                    </label>
                  ))}
                </ActionRow>
              </section>
            )}
            <section>
              <h3>Conditions · all must match</h3>
              {draft.conditions.map((c, i) => {
                const f = fields.find((f) => f.id === c.fieldId),
                  ops =
                    c.field === "custom"
                      ? f && ["number", "date"].includes(f.kind)
                        ? ["eq", "gte", "lte", "empty", "notEmpty"]
                        : f && ["text", "url"].includes(f.kind)
                          ? ["eq", "contains", "empty", "notEmpty"]
                          : f && ["select", "multiselect"].includes(f.kind)
                            ? ["eq", "in", "empty", "notEmpty"]
                            : ["eq", "empty", "notEmpty"]
                      : c.field === "label"
                        ? ["contains", "empty", "notEmpty"]
                        : c.field === "overdue"
                          ? ["eq"]
                          : ["eq", "empty", "notEmpty"];
                return (
                  <ActionRow
                    className="planning-rule-clause"
                    size="standard"
                    key={i}
                  >
                    <Field
                      label={`Condition ${i + 1}`}
                      action={
                        <IconButton
                          type="button"
                          label={`Remove condition ${i + 1}`}
                          onClick={() => {
                            setDraft({
                              ...draft,
                              conditions: draft.conditions.filter(
                                (_, n) => n !== i,
                              ),
                            });
                          }}
                        >
                          <X size={14} />
                        </IconButton>
                      }
                    >
                      <NativeSelect
                        value={c.field === "custom" ? c.fieldId : c.field}
                        onChange={(e) => {
                          const field = fields.find(
                            (f) => f.id === e.target.value,
                          );
                          condition(
                            i,
                            field
                              ? {
                                  field: "custom",
                                  fieldId: field.id,
                                  op: "eq",
                                  value: fieldDefault(field),
                                }
                              : {
                                  field: e.target.value as typeof c.field,
                                  fieldId: undefined,
                                  op:
                                    e.target.value === "label"
                                      ? "contains"
                                      : "eq",
                                  value:
                                    e.target.value === "overdue"
                                      ? true
                                      : e.target.value === "status"
                                        ? "todo"
                                        : e.target.value === "priority"
                                          ? "normal"
                                          : "",
                                },
                          );
                        }}
                      >
                        {[
                          "status",
                          "priority",
                          "assignee",
                          "label",
                          "overdue",
                        ].map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                        {fields.map((f) => (
                          <option value={f.id} key={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="Operator">
                      <NativeSelect
                        value={c.op}
                        onChange={(e) => {
                          const op = e.target.value as typeof c.op;
                          condition(i, {
                            op,
                            ...(f?.kind === "select"
                              ? {
                                  value:
                                    op === "in"
                                      ? Array.isArray(c.value)
                                        ? c.value
                                        : c.value
                                          ? [String(c.value)]
                                          : []
                                      : op === "eq" && Array.isArray(c.value)
                                        ? (c.value[0] ?? null)
                                        : c.value,
                                }
                              : {}),
                          });
                        }}
                      >
                        {ops.map((op) => (
                          <option key={op}>{op}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                    {!["empty", "notEmpty"].includes(c.op) &&
                      (c.field === "custom" && f ? (
                        <TaskFieldInput
                          field={
                            c.op === "contains"
                              ? { ...f, kind: "text" }
                              : c.op === "in"
                                ? { ...f, kind: "multiselect" }
                                : f
                          }
                          value={c.value}
                          people={people}
                          onChange={(value) => condition(i, { value })}
                        />
                      ) : (
                        <Field label="Value">
                          {c.field === "status" || c.field === "priority" ? (
                            <NativeSelect
                              value={String(c.value ?? "")}
                              onChange={(e) =>
                                condition(i, { value: e.target.value })
                              }
                            >
                              {(c.field === "status"
                                ? Object.keys(statuses)
                                : priorities
                              ).map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </NativeSelect>
                          ) : c.field === "assignee" ? (
                            <PersonPicker
                              label="Condition assignee"
                              people={people}
                              value={String(c.value ?? "")}
                              onChange={(value) => condition(i, { value })}
                            />
                          ) : c.field === "overdue" ? (
                            <label className="planning-check-label">
                              <Checkbox
                                checked={c.value === true}
                                onChange={(e) =>
                                  condition(i, { value: e.target.checked })
                                }
                              />
                              Overdue
                            </label>
                          ) : (
                            <TextInput
                              value={String(c.value ?? "")}
                              maxLength={40}
                              onChange={(e) =>
                                condition(i, { value: e.target.value })
                              }
                            />
                          )}
                        </Field>
                      ))}
                    {c.field === "custom" && !f && (
                      <HelpText>
                        This field is archived or unavailable. Remove this
                        condition before enabling.
                      </HelpText>
                    )}
                  </ActionRow>
                );
              })}
              <Button
                type="button"
                size="compact"
                disabled={draft.conditions.length >= 8}
                onClick={() =>
                  setDraft({
                    ...draft,
                    conditions: [
                      ...draft.conditions,
                      { field: "status", op: "eq", value: "todo" },
                    ],
                  })
                }
              >
                <Plus size={14} />
                Add condition
              </Button>
              <HelpText>
                No conditions means every eligible task. Proposals over 100
                tasks are blocked, never truncated.
              </HelpText>
            </section>
            <section>
              <h3>Proposed changes</h3>
              {draft.actions.map((a, i) => {
                const f =
                  a.kind === "custom"
                    ? fields.find((f) => f.id === a.fieldId)
                    : undefined;
                return (
                  <ActionRow
                    className="planning-rule-clause"
                    size="standard"
                    key={i}
                  >
                    <Field
                      label={`Action ${i + 1}`}
                      action={
                        <IconButton
                          type="button"
                          label={`Remove action ${i + 1}`}
                          disabled={draft.actions.length === 1}
                          onClick={() => {
                            setDraft({
                              ...draft,
                              actions: draft.actions.filter((_, n) => n !== i),
                            });
                          }}
                        >
                          <X size={14} />
                        </IconButton>
                      }
                    >
                      <NativeSelect
                        value={a.kind === "custom" ? a.fieldId : a.kind}
                        onChange={(e) => {
                          const field = fields.find(
                            (f) => f.id === e.target.value,
                          );
                          setAction(
                            i,
                            field
                              ? {
                                  kind: "custom",
                                  fieldId: field.id,
                                  value: fieldDefault(field),
                                }
                              : e.target.value === "status"
                                ? { kind: "status", value: "in_progress" }
                                : e.target.value === "priority"
                                  ? { kind: "priority", value: "high" }
                                  : e.target.value === "assignee"
                                    ? { kind: "assignee", value: null }
                                    : {
                                        kind: e.target.value as
                                          "addLabel" | "removeLabel",
                                        value: "",
                                      },
                          );
                        }}
                      >
                        <option value="status">Set status</option>
                        <option value="priority">Set priority</option>
                        <option value="assignee">Set assignee</option>
                        <option value="addLabel">Add label</option>
                        <option value="removeLabel">Remove label</option>
                        {fields.map((f) => (
                          <option key={f.id} value={f.id}>
                            Set {f.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    {a.kind === "custom" && f ? (
                      <TaskFieldInput
                        field={f}
                        value={a.value}
                        people={people}
                        onChange={(value) => setAction(i, { ...a, value })}
                      />
                    ) : (
                      <Field label="Value">
                        {a.kind === "status" || a.kind === "priority" ? (
                          <NativeSelect
                            value={a.value}
                            onChange={(e) =>
                              setAction(i, {
                                ...a,
                                value: e.target.value,
                              } as typeof a)
                            }
                          >
                            {(a.kind === "status"
                              ? Object.keys(statuses)
                              : priorities
                            ).map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </NativeSelect>
                        ) : a.kind === "assignee" ? (
                          <PersonPicker
                            label="Action assignee"
                            people={people}
                            value={a.value ?? ""}
                            onChange={(value) =>
                              setAction(i, { ...a, value: value || null })
                            }
                          />
                        ) : (
                          <TextInput
                            value={String(a.value ?? "")}
                            maxLength={40}
                            onChange={(e) =>
                              setAction(i, { ...a, value: e.target.value })
                            }
                          />
                        )}
                      </Field>
                    )}
                    {a.kind === "custom" && !f && (
                      <HelpText>
                        This field is archived or unavailable. Choose another
                        field or remove this action.
                      </HelpText>
                    )}
                  </ActionRow>
                );
              })}
              <Button
                type="button"
                size="compact"
                disabled={draft.actions.length >= 8}
                onClick={() =>
                  setDraft({
                    ...draft,
                    actions: [
                      ...draft.actions,
                      { kind: "priority", value: "high" },
                    ],
                  })
                }
              >
                <Plus size={14} />
                Add action
              </Button>
            </section>
            <label className="planning-check-label">
              <Checkbox
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    enabled: e.target.checked,
                    archived: false,
                  })
                }
              />
              Enable this rule
            </label>
            <HelpText>
              Enabling never applies changes automatically. Apply and Undo do
              not recursively trigger rules. Run now also requires an enabled
              rule.
            </HelpText>
            <ErrorNotice
              message={
                dirty || initial ? (configurationError ?? undefined) : undefined
              }
            />
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button type="button" disabled={action.busy} onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            pending={action.busy}
            disabled={!canManage || !valid || (!!initial && !dirty)}
          >
            Save rule
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
function AutomationReviewQueue({
  space,
  people,
}: {
  space: Space;
  people: People;
}) {
  const { revision } = useWorkspace(),
    archive = usePlanningArchive<
      { q: string; sort: "newest"; limit: number; status: string },
      ArchivePage<AutomationRun>
    >(
      `spaces/${space.id}/planning-automation-runs`,
      { q: "", sort: "newest", limit: 30, status: "pending" },
      revision,
    ),
    fields = useData<FieldDefinitions>(
      `spaces/${space.id}/planning-fields`,
      revision,
    ),
    [open, setOpen] = useState<string | null>(null);
  return (
    <section className="planning-archive-content planning-automation-queue">
      <h2>Shared review queue</h2>
      <HelpText>
        Proposals are visible to workspace members. Only current editors with
        management access can approve.
      </HelpText>
      <ArchiveSearch
        label="Find automation runs"
        search={archive.search}
        onSearch={archive.setSearch}
        loading={archive.data.loading && !archive.data.data}
        onRefresh={archive.refresh}
      >
        <NativeSelect
          aria-label="Automation run status"
          value={archive.filters.status}
          onChange={(e) => archive.set({ status: e.target.value })}
        >
          {[
            "pending",
            "all",
            "applied",
            "blocked",
            "noop",
            "cancelled",
            "undone",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </NativeSelect>
      </ArchiveSearch>
      <ErrorNotice message={archive.data.error} retry={archive.refresh} />
      <HelpText>{archive.data.data?.total ?? 0} runs</HelpText>
      <div className="planning-archive-results" ref={archive.resultsRef}>
        {!archive.data.data ? (
          <Loading />
        ) : !archive.data.data.items.length ? (
          <Empty title="No matching proposals">
            Use Run now on an enabled rule, or wait for its trigger.
          </Empty>
        ) : (
          <div className="planning-lab-list">
            {archive.data.data.items.map((r) => (
              <article className="planning-lab-row" key={r.id}>
                <div>
                  <Button variant="ghost" onClick={() => setOpen(r.id)}>
                    {r.rule_name}
                  </Button>
                  <HelpText>
                    {r.status} · {r.tasks} tasks ·{" "}
                    {new Date(r.created_at).toLocaleString()}
                  </HelpText>
                  {r.error && <p>{r.error}</p>}
                </div>
                <Button size="compact" onClick={() => setOpen(r.id)}>
                  Review
                </Button>
              </article>
            ))}
          </div>
        )}
      </div>
      <ArchivePagination label="Automation runs" {...archive.pagination} />
      {open && (
        <RunDialog
          space={space}
          runId={open}
          definitions={fields.data ?? undefined}
          people={people}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}
function RunDialog({
  space,
  runId,
  definitions,
  people,
  onClose,
}: {
  space: Space;
  runId: string;
  definitions?: FieldDefinitions;
  people: People;
  onClose: () => void;
}) {
  const data = useData<{ item: AutomationRun }>(
    `spaces/${space.id}/planning-automation-runs/${runId}`,
  );
  if (!data.data)
    return (
      <Dialog title="Automation proposal" onClose={onClose}>
        <DialogBody>
          <ErrorNotice message={data.error} retry={data.reload} />
          {data.loading && <Loading />}
        </DialogBody>
      </Dialog>
    );
  return (
    <RunReview
      initial={data.data.item}
      space={space}
      definitions={definitions}
      people={people}
      onClose={onClose}
    />
  );
}
function RunReview({
  initial,
  space,
  definitions,
  people,
  onClose,
}: {
  initial: AutomationRun;
  space: Space;
  definitions?: FieldDefinitions;
  people: People;
  onClose: () => void;
}) {
  const { refresh } = useWorkspace(),
    action = useAction(),
    [run, setRun] = useState(initial),
    [selected, setSelected] = useState(
      (initial.changes ?? []).map((c) => c.id),
    ),
    [preview, setPreview] = useState<{
      id: string;
      expiresAt: string;
      version: number;
    } | null>(null),
    canManage =
      space.can_manage &&
      space.role === "editor" &&
      space.effective_status === "active";
  const operate = (operation: string) =>
    void action.run(async () => {
      let result;
      try {
        result = await mutate(
          `spaces/${space.id}/planning-automation-runs/${run.id}/${operation}`,
          {
            version: preview?.version ?? run.version,
            selected,
            previewId: preview?.id,
          },
        );
      } catch (error) {
        // An expired/replaced preview must be reviewable again without discarding
        // the selected tasks or replacing the user's open proposal.
        if (error instanceof ApiError && error.status === 409) setPreview(null);
        throw error;
      }
      if (operation === "preview") {
        setPreview({ ...result.preview, version: result.version });
        setRun({ ...run, version: result.version });
      } else {
        setRun({ ...result.item, rule_name: run.rule_name });
        setPreview(null);
      }
      refresh();
    });
  const values = (patch: MetadataPatch) =>
    Object.entries(patch).flatMap(([key, value]) =>
      key === "customFields"
        ? Object.entries(value as Record<string, FieldValue>).map(([id, v]) => {
            const field = definitions?.items.find((f) => f.id === id);
            return `${field?.name ?? "Unavailable field"}: ${field ? fieldDisplay(field, v, people) : String(v ?? "Not set")}`;
          })
        : [
            `${key === "assigneeId" ? "Assignee" : key}: ${key === "assigneeId" ? (people.find((p) => p.id === value)?.name ?? (value ? "Unavailable person" : "Unassigned")) : Array.isArray(value) ? value.join(", ") || "None" : String(value)}`,
          ],
    );
  const select = (ids: string[]) => {
    setSelected(ids);
    setPreview(null);
  };
  return (
    <Dialog
      title={`Review · ${run.rule_name}`}
      onClose={() => {
        if (!action.busy) onClose();
      }}
    >
      <DialogBody>
        <ErrorNotice message={action.error} />
        <HelpText>
          {run.status} · Revision {run.version}
          {preview
            ? ` · Preview expires ${new Date(preview.expiresAt).toLocaleTimeString()}`
            : ""}
        </HelpText>
        {run.error && <p>{run.error}</p>}
        {["applied", "undone"].includes(run.status) && (
          <HelpText>
            {(run.changes ?? []).filter((c) => c.resultVersion != null).length}{" "}
            applied
            {run.status === "undone" ? " and undone" : ""} ·{" "}
            {(run.changes ?? []).filter((c) => c.resultVersion == null).length}{" "}
            not selected
          </HelpText>
        )}
        {run.status === "pending" && (
          <label className="planning-check-label">
            <Checkbox
              disabled={action.busy || !canManage}
              checked={
                !!selected.length && selected.length === run.changes?.length
              }
              indeterminate={
                !!selected.length && selected.length !== run.changes?.length
              }
              onChange={(e) =>
                select(
                  e.target.checked ? (run.changes ?? []).map((c) => c.id) : [],
                )
              }
            />
            Select all proposed tasks
          </label>
        )}
        <div className="planning-lab-list">
          {(run.changes ?? []).map((c) => (
            <article className="planning-proposal-change" key={c.id}>
              {run.status === "pending" ? (
                <label className="planning-check-label">
                  <Checkbox
                    disabled={action.busy || !canManage}
                    checked={selected.includes(c.id)}
                    onChange={(e) =>
                      select(
                        e.target.checked
                          ? [...selected, c.id]
                          : selected.filter((id) => id !== c.id),
                      )
                    }
                  />
                  {c.title}
                </label>
              ) : (
                <h3>{c.title}</h3>
              )}
              {["applied", "undone"].includes(run.status) && (
                <HelpText>
                  {c.resultVersion == null
                    ? "Not selected · No changes applied."
                    : run.status === "undone"
                      ? "Undone · Applied changes were restored."
                      : `Applied · Confirmed task revision ${c.resultVersion}.`}
                </HelpText>
              )}
              <dl>
                <div>
                  <dt>Before</dt>
                  <dd>
                    {values(c.before).map((v, i) => (
                      <p key={i}>{v}</p>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt>{c.resultVersion != null ? "Applied" : "Proposed"}</dt>
                  <dd>
                    {values(c.patch).map((v, i) => (
                      <p key={i}>{v}</p>
                    ))}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
        <HelpText>
          Dates, dependencies, document contents, and time logs are never
          changed by rules. A changed task, rule, field schema or permission
          blocks Apply. Undo is available only while affected task versions are
          unchanged.
        </HelpText>
      </DialogBody>
      <DialogFooter>
        <Button
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const latest = await api<{ item: AutomationRun }>(
                `spaces/${space.id}/planning-automation-runs/${run.id}`,
              );
              setRun(latest.item);
              setSelected((latest.item.changes ?? []).map((c) => c.id));
              setPreview(null);
            })
          }
        >
          Reload confirmed state
        </Button>
        {["pending", "blocked"].includes(run.status) && (
          <Button
            variant="danger"
            disabled={!canManage || action.busy}
            onClick={() => operate("cancel")}
          >
            Cancel proposal
          </Button>
        )}
        {run.status === "applied" && (
          <Button
            disabled={!canManage}
            pending={action.busy}
            onClick={() => operate("undo")}
          >
            <RotateCcw size={14} />
            Undo run
          </Button>
        )}
        <Button disabled={action.busy} onClick={onClose}>
          Done
        </Button>
        {run.status === "pending" && (
          <Button
            variant="primary"
            pending={action.busy}
            disabled={!canManage || !selected.length}
            onClick={() => operate(preview ? "apply" : "preview")}
          >
            <Check size={14} />
            {preview ? "Apply reviewed changes" : "Preview selection"}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
