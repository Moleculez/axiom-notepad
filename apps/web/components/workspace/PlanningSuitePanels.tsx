"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import {
  Archive,
  Clock,
  ListFilter,
  Plus,
  RotateCcw,
  Target,
} from "lucide-react";
import { z } from "zod";
import { goalInputSchema } from "@axiom/shared/planning-suite";
import {
  workspaceGoalLimit,
  type GoalDetail,
  type GoalPage,
  type GoalQuery,
} from "@axiom/shared/planning-archives";
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
import Dialog, { DialogBody, DialogFooter } from "../Dialog";
import {
  ArchiveSearch,
  ArchivePagination,
  usePlanningArchive,
} from "./PlanningArchiveControls";
import { PlanningHistoryDialog } from "./PlanningArchives";
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
const asDate = (value: string | null) => value?.slice(0, 10) ?? null;
const goalDefaults: GoalQuery = {
  q: "",
  sort: "newest",
  limit: 30,
  filter: "active",
  mine: "0",
};
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
    archive = usePlanningArchive<GoalQuery, GoalPage>(
      `spaces/${space.id}/goals`,
      goalDefaults,
      revision,
    ),
    data = archive.data,
    action = useAction();
  const [editing, setEditing] = useState<string | null | undefined>(undefined),
    [history, setHistory] = useState<string | null>(null),
    [filtering, setFiltering] = useState(false);
  const rows = data.data?.items ?? [],
    counts = data.data?.stateCounts,
    atLimit = (data.data?.workspaceTotal ?? 0) >= workspaceGoalLimit;
  const filtered =
    !!archive.filters.q ||
    !!archive.filters.kind ||
    archive.filters.mine === "1" ||
    archive.filters.sort !== "newest" ||
    archive.filters.filter !== "active";
  return (
    <section
      className="planning-suite-panel planning-goals"
      aria-label="Workspace goals"
    >
      <header>
        <div>
          <h2>Goals</h2>
        </div>
        <Button
          variant="primary"
          disabled={readOnly || atLimit || !data.data}
          title={
            atLimit
              ? "The workspace limit includes archived goals; existing goals can still be edited or reopened."
              : undefined
          }
          onClick={() => setEditing(null)}
        >
          <Plus size={16} />
          New goal
        </Button>
      </header>
      <ArchiveSearch
        label="Search goals"
        search={archive.search}
        onSearch={archive.setSearch}
        loading={data.loading}
        onRefresh={archive.refresh}
      >
        <NativeSelect
          aria-label="Goal filter"
          value={archive.filters.filter}
          onChange={(e) =>
            archive.set({ filter: e.target.value as GoalQuery["filter"] })
          }
        >
          <option value="active">
            Active{counts ? ` · ${counts.active}` : ""}
          </option>
          <option value="archived">
            Archived{counts ? ` · ${counts.archived}` : ""}
          </option>
          <option value="all">
            All goals{counts ? ` · ${counts.active + counts.archived}` : ""}
          </option>
        </NativeSelect>
        <Button size="compact" onClick={() => setFiltering(true)}>
          <ListFilter size={14} />
          Filters
          {archive.filters.kind ||
          archive.filters.mine === "1" ||
          archive.filters.sort !== "newest"
            ? " · On"
            : ""}
        </Button>
      </ArchiveSearch>
      <div className="planning-archive-summary">
        <HelpText aria-live="polite">
          {data.data
            ? `${data.data.total} matching goals · ${data.data.workspaceTotal} / ${data.data.goalLimit} in this workspace${atLimit ? " (includes archived)" : ""}`
            : "Loading goals…"}
        </HelpText>
        {filtered && (
          <Button size="compact" variant="ghost" onClick={archive.reset}>
            Reset filters
          </Button>
        )}
      </div>
      <ErrorNotice
        message={data.error || action.error}
        retry={archive.refresh}
      />
      <div
        className="planning-goal-results"
        ref={archive.resultsRef}
        aria-busy={data.loading}
      >
        {data.loading && !data.data ? (
          <Loading />
        ) : data.error && !data.data ? null : !rows.length ? (
          <Empty title="No matching goals">
            Try another filter, or track a measurable outcome and link the work
            that delivers it.
          </Empty>
        ) : (
          <div className="planning-outcome-grid">
            {rows.map((g) => (
              <article key={g.id}>
                <div className="planning-outcome-heading">
                  <Target size={17} />
                  <button onClick={() => setEditing(g.id)}>{g.title}</button>
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
                  {g.owner_name ? ` · ${g.owner_name}` : ""}
                  {g.archived ? " · Archived" : ""}
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
                    {g.archived ? (
                      <RotateCcw size={14} />
                    ) : (
                      <Archive size={14} />
                    )}{" "}
                    {g.archived ? "Reopen" : "Archive"}
                  </Button>
                </ActionRow>
              </article>
            ))}
          </div>
        )}
      </div>
      <ArchivePagination label="Goals" {...archive.pagination} />
      {filtering && (
        <GoalFilters
          filters={archive.filters}
          onClose={() => setFiltering(false)}
          onApply={(patch) => {
            archive.set(patch);
            setFiltering(false);
          }}
        />
      )}
      {editing !== undefined && (
        <GoalOpener
          key={editing ?? "new"}
          spaceId={space.id}
          people={people}
          id={editing}
          readOnly={readOnly}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            archive.first();
            refresh();
            setEditing(undefined);
            notify("Goal saved.");
          }}
        />
      )}
      {history && (
        <PlanningHistoryDialog
          spaceId={space.id}
          id={history}
          title="Goal history"
          onClose={() => setHistory(null)}
        />
      )}
    </section>
  );
}
function GoalFilters({
  filters,
  onClose,
  onApply,
}: {
  filters: GoalQuery;
  onClose: () => void;
  onApply: (patch: Partial<GoalQuery>) => void;
}) {
  const [draft, setDraft] = useState({
    kind: filters.kind,
    mine: filters.mine,
    sort: filters.sort,
  });
  return (
    <Dialog title="Filter goals" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply(draft);
        }}
      >
        <DialogBody>
          <div className="planning-suite-form">
            <Field label="Tracking type">
              <NativeSelect
                value={draft.kind ?? ""}
                onChange={(e) =>
                  setDraft((old) => ({
                    ...old,
                    kind: e.target.value
                      ? (e.target.value as GoalQuery["kind"])
                      : undefined,
                  }))
                }
              >
                <option value="">All tracking types</option>
                <option value="linked">Linked work</option>
                <option value="metric">Manual metrics</option>
              </NativeSelect>
            </Field>
            <Field label="Creation order">
              <NativeSelect
                value={draft.sort}
                onChange={(e) =>
                  setDraft((old) => ({
                    ...old,
                    sort: e.target.value as GoalQuery["sort"],
                  }))
                }
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </NativeSelect>
            </Field>
            <label className="planning-check-label">
              <Checkbox
                checked={draft.mine === "1"}
                onChange={(e) =>
                  setDraft((old) => ({
                    ...old,
                    mine: e.target.checked ? "1" : "0",
                  }))
                }
              />
              My goals only
            </label>
            <HelpText>
              Search includes saved descriptions. The creation limit counts all
              goals, including archives and other owners.
            </HelpText>
          </div>
        </DialogBody>
        <DialogFooter>
          <ActionRow>
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Apply filters
            </Button>
          </ActionRow>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
function GoalOpener({
  id,
  ...props
}: {
  id: string | null;
  spaceId: string;
  people: Array<{ id: string; name: string }>;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  // No background revision dependency: this opened source/version is the draft's fence.
  const data = useData<{ item: GoalDetail }>(
    id ? `spaces/${props.spaceId}/goals/${id}` : null,
  );
  if (id && !data.data)
    return (
      <Dialog title="Goal details" onClose={props.onClose}>
        <DialogBody>
          <ErrorNotice message={data.error} retry={data.reload} />
          {data.loading && <Loading label="Opening goal…" />}
        </DialogBody>
        <DialogFooter>
          <ActionRow>
            <Button onClick={props.onClose}>Close</Button>
          </ActionRow>
        </DialogFooter>
      </Dialog>
    );
  return <GoalEditor {...props} goal={data.data?.item ?? null} />;
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
  goal: GoalDetail | null;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial: GoalInput = goal
    ? goalInputSchema.parse({
        ...goal,
        ownerId: goal.owner_id,
        dueOn: asDate(goal.due_on),
        currentValue: Number(goal.current_value),
        target: Number(goal.target),
        taskIds: goal.task_ids,
        milestoneIds: goal.milestone_ids,
      })
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
        <DialogBody>
          <DraftGuard dirty={dirty} title="Unsaved goal" />
          <ErrorNotice message={action.error} />
          <fieldset
            disabled={readOnly || action.busy}
            className="planning-suite-form"
          >
            <Field label="Outcome">
              <TextInput
                autoFocus
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
        </DialogBody>
        <DialogFooter>
          <ActionRow>
            <Button type="button" disabled={action.busy} onClick={close}>
              Close
            </Button>
            <Button
              type="submit"
              variant="primary"
              pending={action.busy}
              disabled={
                readOnly ||
                (!!goal && !dirty) ||
                !goalInputSchema.safeParse(draft).success
              }
            >
              Save goal
            </Button>
          </ActionRow>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
