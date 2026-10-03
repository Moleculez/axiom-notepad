"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Archive, Check, Clock, Plus, RotateCcw, Target } from "lucide-react";
import { z } from "zod";
import {
  goalInputSchema,
  intakeInputSchema,
} from "@axiom/shared/planning-suite";
import type { Space } from "@axiom/shared/workspace";
import {
  ActionRow,
  Button,
  Checkbox,
  Field,
  HelpText,
  NativeSelect,
  TextInput,
  TextArea,
} from "../ui/controls";
import Dialog from "../Dialog";
import DraftGuard from "./DraftGuard";
import {
  PersonPicker,
  PlanningEntityPicker,
  closePlanningDraft,
} from "./PlanningFields";
import {
  Empty,
  ErrorNotice,
  Loading,
  mutate,
  useAction,
  useData,
  useWorkspace,
  WorkspaceLink,
} from "./ui";
const Markdown = dynamic(() => import("./PlanningMarkdown"), {
  loading: () => <Loading label="Opening editor…" />,
});
type GoalInput = z.infer<typeof goalInputSchema>;
type Goal = GoalInput & {
  id: string;
  version: number;
  owner_id: string | null;
  due_on: string | null;
  current_value: number;
  task_ids: string[];
  milestone_ids: string[];
  progress: {
    percent: number;
    tracked: number;
    completed: number;
    unavailable: number;
  };
};
type IntakeInput = z.infer<typeof intakeInputSchema>;
type Intake = IntakeInput & {
  id: string;
  version: number;
  created_by: string;
  author_name: string;
  status: string;
  due_on: string | null;
  decision_note: string;
  task_id: string | null;
};
const asDate = (value: string | null) => value?.slice(0, 10) ?? null;
export function PlanningHistory({
  spaceId,
  id,
}: {
  spaceId: string;
  id: string;
}) {
  const data = useData<
    Array<{
      id: string;
      summary: string;
      actor_name: string;
      created_at: string;
    }>
  >(`spaces/${spaceId}/planning-history/${id}`);
  return (
    <div className="planning-history">
      <ErrorNotice message={data.error} retry={data.reload} />
      {data.loading && !data.data ? (
        <Loading />
      ) : !data.data?.length ? (
        <HelpText>No recorded changes yet.</HelpText>
      ) : (
        <ol>
          {data.data.map((h) => (
            <li key={h.id}>
              <strong>{h.summary}</strong>
              <small>
                {h.actor_name ?? "Former member"} ·{" "}
                {new Date(h.created_at).toLocaleString()}
              </small>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
export function PlanningGoals({
  space,
  people,
  readOnly,
}: {
  space: Space;
  people: Array<{ id: string; name: string }>;
  readOnly: boolean;
}) {
  const { revision, refresh, notify } = useWorkspace(),
    data = useData<Goal[]>(`spaces/${space.id}/goals`, revision),
    action = useAction();
  const [archived, setArchived] = useState(false),
    [editing, setEditing] = useState<Goal | null | undefined>(undefined),
    [history, setHistory] = useState<string | null>(null);
  const rows = data.data?.filter((g) => g.archived === archived) ?? [];
  return (
    <section className="planning-suite-panel" aria-label="Workspace goals">
      <header>
        <div>
          <h2>Goals</h2>
          <HelpText>
            Research outcomes, linked milestones and measurable targets.
          </HelpText>
        </div>
        <label className="planning-check-label">
          <Checkbox
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Archived
        </label>
        <Button
          variant="primary"
          disabled={readOnly}
          onClick={() => setEditing(null)}
        >
          <Plus size={16} />
          New goal
        </Button>
      </header>
      <ErrorNotice message={data.error || action.error} retry={data.reload} />
      {data.loading && !data.data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title="No goals here">
          Track a measurable outcome or link the work that delivers it.
        </Empty>
      ) : (
        <div className="planning-outcome-grid">
          {rows.map((g) => (
            <article key={g.id}>
              <div className="planning-outcome-heading">
                <Target size={17} />
                <button onClick={() => setEditing(g)}>{g.title}</button>
                <strong>{g.progress.percent}%</strong>
              </div>
              <progress
                aria-label={`${g.title} progress`}
                max={100}
                value={g.progress.percent}
              />
              <p>
                {g.kind === "metric"
                  ? `${g.current_value} / ${g.target} ${g.unit}`
                  : `${g.progress.tracked} unique tasks and milestones`}
                {g.due_on ? ` · Due ${asDate(g.due_on)}` : ""}
              </p>
              {g.progress.unavailable > 0 && (
                <HelpText>
                  {g.progress.unavailable} unavailable linked items are
                  excluded.
                </HelpText>
              )}
              <ActionRow>
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => setHistory(g.id)}
                >
                  <Clock size={14} />
                  History
                </Button>
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={readOnly || action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await mutate(
                        `spaces/${space.id}/goals/${g.id}`,
                        { version: g.version, archived: !g.archived },
                        "PATCH",
                      );
                      refresh();
                    })
                  }
                >
                  {g.archived ? <RotateCcw size={14} /> : <Archive size={14} />}{" "}
                  {g.archived ? "Reopen" : "Archive"}
                </Button>
              </ActionRow>
            </article>
          ))}
        </div>
      )}
      {editing !== undefined && (
        <GoalEditor
          key={editing?.id ?? "new"}
          spaceId={space.id}
          people={people}
          goal={editing}
          readOnly={readOnly}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            refresh();
            setEditing(undefined);
            notify("Goal saved.");
          }}
        />
      )}
      {history && (
        <Dialog title="Goal history" onClose={() => setHistory(null)}>
          <PlanningHistory spaceId={space.id} id={history} />
        </Dialog>
      )}
    </section>
  );
}
function GoalEditor({
  spaceId,
  people,
  goal,
  readOnly,
  onClose,
  onSaved,
}: {
  spaceId: string;
  people: Array<{ id: string; name: string }>;
  goal: Goal | null;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial: GoalInput = goal
    ? {
        ...goal,
        ownerId: goal.owner_id,
        dueOn: asDate(goal.due_on),
        currentValue: Number(goal.current_value),
        target: Number(goal.target),
        taskIds: goal.task_ids,
        milestoneIds: goal.milestone_ids,
      }
    : goalInputSchema.parse({ title: "New research outcome", kind: "linked" });
  const [draft, setDraft] = useState(initial),
    action = useAction(),
    dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  const set = (patch: Partial<GoalInput>) =>
    setDraft((old) => ({ ...old, ...patch }));
  const close = () =>
    closePlanningDraft(dirty, action.busy, onClose, "Unsaved goal");
  return (
    <Dialog
      title={goal ? "Goal details" : "New goal"}
      onClose={close}
      subtitle="Linked goals count each non-cancelled descendant leaf once, even when parent and child are both selected."
    >
      <DraftGuard dirty={dirty} title="Unsaved goal" />
      <ErrorNotice message={action.error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await mutate(
              `spaces/${spaceId}/goals${goal ? "/" + goal.id : ""}`,
              {
                ...goalInputSchema.parse(draft),
                ...(goal ? { version: goal.version } : {}),
              },
              goal ? "PATCH" : "POST",
            );
            onSaved();
          });
        }}
      >
        <fieldset
          disabled={readOnly || action.busy}
          className="planning-suite-form"
        >
          <Field label="Outcome">
            <TextInput
              required
              maxLength={200}
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </Field>
          <div className="planning-field-grid">
            <Field label="Owner">
              <PersonPicker
                label="Goal owner"
                people={people}
                value={draft.ownerId ?? ""}
                onChange={(v) => set({ ownerId: v || null })}
              />
            </Field>
            <Field label="Target date">
              <TextInput
                type="date"
                value={draft.dueOn ?? ""}
                onChange={(e) => set({ dueOn: e.target.value || null })}
              />
            </Field>
          </div>
          <Field label="Track by">
            <NativeSelect
              value={draft.kind}
              onChange={(e) =>
                set({ kind: e.target.value as GoalInput["kind"] })
              }
            >
              <option value="linked">Linked work</option>
              <option value="metric">Manual metric</option>
            </NativeSelect>
          </Field>
          {draft.kind === "linked" ? (
            <>
              <Field label="Tasks">
                <PlanningEntityPicker
                  spaceId={spaceId}
                  kind="task"
                  label="Goal tasks"
                  multiple
                  value={draft.taskIds}
                  onChange={(v) => set({ taskIds: v as string[] })}
                />
              </Field>
              <Field label="Milestones">
                <PlanningEntityPicker
                  spaceId={spaceId}
                  kind="milestone"
                  label="Goal milestones"
                  multiple
                  value={draft.milestoneIds}
                  onChange={(v) => set({ milestoneIds: v as string[] })}
                />
              </Field>
            </>
          ) : (
            <div className="planning-field-grid">
              <Field label="Current value">
                <TextInput
                  type="number"
                  min={0}
                  max={1e9}
                  step="any"
                  value={draft.currentValue}
                  onChange={(e) =>
                    set({ currentValue: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Target">
                <TextInput
                  type="number"
                  min={0.000001}
                  max={1e9}
                  step="any"
                  value={draft.target}
                  onChange={(e) => set({ target: Number(e.target.value) })}
                />
              </Field>
              <Field label="Unit">
                <TextInput
                  maxLength={40}
                  value={draft.unit}
                  onChange={(e) => set({ unit: e.target.value })}
                />
              </Field>
            </div>
          )}
          <Markdown
            initial={draft.body}
            onChange={(body) => set({ body })}
            readOnly={readOnly || action.busy}
          />
        </fieldset>
        <ActionRow>
          <Button type="button" disabled={action.busy} onClick={close}>
            Close
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={readOnly || action.busy}
          >
            Save goal
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  );
}
const requestTemplates: Record<
  IntakeInput["kind"],
  { label: string; body: string }
> = {
  research: {
    label: "Research request",
    body: "## Question\n\n## Context and evidence\n\n## Expected outcome\n",
  },
  experiment: {
    label: "Experiment",
    body: "## Hypothesis\n\n## Method and controls\n\n## Resources and safety\n\n## Acceptance criteria\n",
  },
  "paper-review": {
    label: "Paper review",
    body: "## Paper / DOI\n\n## Review scope\n\n## Questions and deliverable\n",
  },
  "data-request": {
    label: "Data request",
    body: "## Dataset and provenance\n\n## Access and privacy constraints\n\n## Requested format\n\n## Intended use\n",
  },
};
export function PlanningIntake({
  space,
  people,
  online,
}: {
  space: Space;
  people: Array<{ id: string; name: string }>;
  online: boolean;
}) {
  const { revision, refresh, session, notify } = useWorkspace(),
    data = useData<{ canReview: boolean; items: Intake[] }>(
      `spaces/${space.id}/intake`,
      revision,
    ),
    action = useAction();
  const [editing, setEditing] = useState<Intake | null | undefined>(undefined),
    [filter, setFilter] = useState("open"),
    [review, setReview] = useState<Intake | null>(null),
    [decision, setDecision] = useState("accepted"),
    [note, setNote] = useState(""),
    [assignee, setAssignee] = useState(""),
    [history, setHistory] = useState<string | null>(null);
  const canSubmit =
      online &&
      space.effective_status === "active" &&
      ["editor", "commenter"].includes(space.role),
    canReview = data.data?.canReview && canSubmit;
  const rows =
    data.data?.items.filter(
      (r) =>
        filter === "all" ||
        (filter === "mine" && r.created_by === session.user.id) ||
        (filter === "open" && ["pending", "needs-changes"].includes(r.status)),
    ) ?? [];
  return (
    <section className="planning-suite-panel" aria-label="Research intake">
      <header>
        <div>
          <h2>Intake</h2>
          <HelpText>
            Private workspace requests; acceptance creates exactly one task.
          </HelpText>
        </div>
        <NativeSelect
          aria-label="Request filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="open">Open requests</option>
          <option value="mine">My requests</option>
          <option value="all">Recent requests</option>
        </NativeSelect>
        <Button
          variant="primary"
          disabled={!canSubmit}
          onClick={() => setEditing(null)}
        >
          <Plus size={16} />
          Submit request
        </Button>
      </header>
      <ErrorNotice message={data.error || action.error} retry={data.reload} />
      {data.loading && !data.data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title="No matching requests">
          Capture a question, experiment, review or data need before turning it
          into work.
        </Empty>
      ) : (
        <div className="planning-request-list">
          {rows.map((r) => (
            <article key={r.id}>
              <div>
                <button
                  className="planning-request-title"
                  onClick={() => setEditing(r)}
                >
                  {r.title}
                </button>
                <small>
                  {requestTemplates[r.kind].label} · {r.author_name} ·{" "}
                  {r.status.replaceAll("-", " ")}
                </small>
                {r.decision_note && <p>{r.decision_note}</p>}
                {r.task_id && (
                  <WorkspaceLink
                    to={`/workspaces/${space.id}/planning?task=${r.task_id}`}
                  >
                    Open accepted task ↗
                  </WorkspaceLink>
                )}
              </div>
              <ActionRow>
                {canReview && r.status === "pending" && (
                  <Button
                    size="compact"
                    onClick={() => {
                      setReview(r);
                      setDecision("accepted");
                      setNote("");
                      setAssignee("");
                    }}
                  >
                    Review
                  </Button>
                )}
                {r.created_by === session.user.id &&
                  ["pending", "needs-changes"].includes(r.status) && (
                    <Button
                      size="compact"
                      variant="ghost"
                      disabled={!canSubmit || action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await mutate(
                            `spaces/${space.id}/intake/${r.id}`,
                            { version: r.version, decision: "withdrawn" },
                            "PATCH",
                          );
                          refresh();
                        })
                      }
                    >
                      Withdraw
                    </Button>
                  )}
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => setHistory(r.id)}
                >
                  <Clock size={14} />
                  History
                </Button>
              </ActionRow>
            </article>
          ))}
        </div>
      )}
      {data.data?.items.length === 200 && (
        <HelpText>Showing the 200 most recently updated requests.</HelpText>
      )}
      {editing !== undefined && (
        <IntakeEditor
          key={editing?.id ?? "new"}
          spaceId={space.id}
          request={editing}
          readOnly={
            !canSubmit ||
            (!!editing &&
              (editing.created_by !== session.user.id ||
                !["pending", "needs-changes"].includes(editing.status)))
          }
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            refresh();
            notify("Request submitted.");
          }}
        />
      )}
      {review && (
        <Dialog
          title="Review research request"
          subtitle={review.title}
          onClose={() => !action.busy && setReview(null)}
        >
          <ErrorNotice message={action.error} />
          <Markdown initial={review.body} onChange={() => {}} readOnly />
          <Field label="Decision">
            <NativeSelect
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            >
              <option value="accepted">Accept and create task</option>
              <option value="needs-changes">Ask for changes</option>
              <option value="rejected">Reject</option>
            </NativeSelect>
          </Field>
          {decision === "accepted" && (
            <Field label="Task assignee">
              <PersonPicker
                label="Accepted task assignee"
                people={people}
                value={assignee}
                onChange={setAssignee}
              />
            </Field>
          )}
          <Field label="Review note">
            <TextArea
              rows={3}
              maxLength={4000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required={decision !== "accepted"}
            />
          </Field>
          <ActionRow>
            <Button onClick={() => setReview(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={
                action.busy || (decision !== "accepted" && !note.trim())
              }
              onClick={() =>
                void action.run(async () => {
                  await mutate(
                    `spaces/${space.id}/intake/${review.id}`,
                    {
                      version: review.version,
                      decision,
                      note,
                      task: { assigneeId: assignee || null },
                    },
                    "PATCH",
                  );
                  setReview(null);
                  refresh();
                  notify(
                    decision === "accepted"
                      ? "Accepted; a task was created."
                      : "Review saved.",
                  );
                })
              }
            >
              <Check size={15} />
              Save decision
            </Button>
          </ActionRow>
        </Dialog>
      )}
      {history && (
        <Dialog title="Request history" onClose={() => setHistory(null)}>
          <PlanningHistory spaceId={space.id} id={history} />
        </Dialog>
      )}
    </section>
  );
}
function IntakeEditor({
  spaceId,
  request,
  readOnly,
  onClose,
  onSaved,
}: {
  spaceId: string;
  request: Intake | null;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial: IntakeInput = request
    ? { ...request, dueOn: asDate(request.due_on) }
    : {
        title: "",
        kind: "research",
        body: requestTemplates.research.body,
        dueOn: null,
        priority: "normal",
      };
  const [draft, setDraft] = useState(initial),
    [editorKey, setEditorKey] = useState(0),
    action = useAction(),
    set = (patch: Partial<IntakeInput>) =>
      setDraft((old) => ({ ...old, ...patch }));
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft),
    close = () =>
      closePlanningDraft(dirty, action.busy, onClose, "Unsaved request");
  return (
    <Dialog
      title={request ? "Request details" : "New research request"}
      onClose={close}
    >
      <DraftGuard dirty={dirty} title="Unsaved request" />
      <ErrorNotice message={action.error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await mutate(
              `spaces/${spaceId}/intake${request ? "/" + request.id : ""}`,
              {
                ...intakeInputSchema.parse(draft),
                ...(request ? { version: request.version } : {}),
              },
              request ? "PATCH" : "POST",
            );
            onSaved();
          });
        }}
      >
        <fieldset
          disabled={readOnly || action.busy}
          className="planning-suite-form"
        >
          <Field label="Template">
            <NativeSelect
              value={draft.kind}
              onChange={(e) => {
                const kind = e.target.value as IntakeInput["kind"];
                set({
                  kind,
                  ...(!request &&
                  draft.body === requestTemplates[draft.kind].body
                    ? { body: requestTemplates[kind].body }
                    : {}),
                });
                setEditorKey((k) => k + 1);
              }}
            >
              {Object.entries(requestTemplates).map(([id, t]) => (
                <option key={id} value={id}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Request">
            <TextInput
              autoFocus
              required
              maxLength={300}
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </Field>
          <div className="planning-field-grid">
            <Field label="Desired date">
              <TextInput
                type="date"
                value={draft.dueOn ?? ""}
                onChange={(e) => set({ dueOn: e.target.value || null })}
              />
            </Field>
            <Field label="Priority">
              <NativeSelect
                value={draft.priority}
                onChange={(e) =>
                  set({ priority: e.target.value as IntakeInput["priority"] })
                }
              >
                {["low", "normal", "high", "urgent"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Markdown
            key={editorKey}
            initial={draft.body}
            onChange={(body) => set({ body })}
            readOnly={readOnly || action.busy}
          />
        </fieldset>
        {request?.decision_note && <HelpText>{request.decision_note}</HelpText>}
        <ActionRow>
          <Button type="button" disabled={action.busy} onClick={close}>
            Close
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={readOnly || action.busy}
          >
            {request ? "Resubmit" : "Submit request"}
          </Button>
        </ActionRow>
      </form>
    </Dialog>
  );
}
