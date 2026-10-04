"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Archive, Clock, Plus, RotateCcw, Target } from "lucide-react";
import { z } from "zod";
import { goalInputSchema } from "@axiom/shared/planning-suite";
import type { Space } from "@axiom/shared/workspace";
import {
  ActionRow,
  Button,
  Checkbox,
  Field,
  HelpText,
  NativeSelect,
  TextInput,
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
