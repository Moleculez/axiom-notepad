"use client";
import { useState } from "react";
import {
  Clock3,
  Download,
  History,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import type { Space } from "@axiom/shared/workspace";
import { addDays, dateFromDay, dayNumber } from "@axiom/shared/planning";
import {
  localDay,
  timeCsv,
  timeInputSchema,
  type TimeEntry,
  type TimeInput,
  type TimePage,
} from "@axiom/shared/planning-lab";
import type {
  ArchivePage,
  HistoryQuery,
} from "@axiom/shared/planning-archives";
import Dialog, { DialogBody, DialogFooter } from "../Dialog";
import {
  ActionRow,
  Button,
  Checkbox,
  Field,
  HelpText,
  NativeSelect,
  TextArea,
  TextInput,
} from "../ui/controls";
import { api } from "../../lib/client";
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
import {
  closePlanningDraft,
  PersonPicker,
  PlanningEntityPicker,
} from "./PlanningFields";
import DraftGuard from "./DraftGuard";

type People = Array<{ id: string; name: string }>;
type TimeFilters = {
  q: string;
  sort: "newest";
  limit: number;
  from: string;
  to: string;
  member: string;
  task: string;
  state: "active" | "withdrawn" | "all";
  descendants: "0" | "1";
};
const duration = (minutes: number) =>
  `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
export default function PlanningTime({
  space,
  people,
  readOnly,
  taskId,
  taskDeleted = false,
}: {
  space: Space;
  people: People;
  readOnly: boolean;
  taskId?: string;
  taskDeleted?: boolean;
}) {
  const { revision } = useWorkspace(),
    today = localDay(space.timezone ?? "UTC"),
    monday = dateFromDay(
      dayNumber(today) - ((new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7),
    );
  const archive = usePlanningArchive<TimeFilters, TimePage>(
    `spaces/${space.id}/planning-time`,
    {
      q: "",
      sort: "newest" as const,
      limit: 30,
      from: monday,
      to: addDays(monday, 6),
      member: "",
      task: taskId ?? "",
      state: "active" as "active" | "withdrawn" | "all",
      descendants: "0" as "0" | "1",
    },
    revision,
  );
  const [filterOpen, setFilterOpen] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [history, setHistory] = useState<string | null>(null),
    action = useAction();
  const page = archive.data.data;
  const exportCsv = () =>
    void action.run(async () => {
      const params = new URLSearchParams(
        Object.entries(archive.filters).map(([k, v]) => [k, String(v)]),
      );
      params.set("limit", "100");
      const entries: TimeEntry[] = [];
      let next: string | null = null;
      do {
        if (next) params.set("cursor", next);
        const result = await api<TimePage>(
          `spaces/${space.id}/planning-time/export?${params}`,
        );
        entries.push(...result.items);
        next = result.nextCursor;
        if (entries.length > 10000 || (next && entries.length === 10000))
          throw new Error(
            "This export exceeds 10,000 entries. Narrow the report; no partial file was downloaded.",
          );
      } while (next);
      const url = URL.createObjectURL(
          new Blob(["\ufeff" + timeCsv(entries)], {
            type: "text/csv;charset=utf-8",
          }),
        ),
        link = document.createElement("a");
      link.href = url;
      link.download = `time-${archive.filters.from}-${archive.filters.to}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  return (
    <section
      className="planning-suite-panel planning-archive-content planning-time"
      aria-label={taskId ? "Task time ledger" : "Workspace time ledger"}
    >
      <ActionRow align="between">
        <div>
          <h2>
            <Clock3 size={18} />
            Time ledger
          </h2>
          <HelpText>
            Recorded work, not estimates. Entries are shared with workspace
            members.
          </HelpText>
        </div>
        <Button
          disabled={readOnly || taskDeleted}
          onClick={() => setEditing("new")}
        >
          <Plus size={15} />
          Log time
        </Button>
      </ActionRow>
      <ArchiveSearch
        label="Find time entries"
        search={archive.search}
        onSearch={archive.setSearch}
        loading={archive.data.loading && !page}
        onRefresh={archive.refresh}
      >
        <Button size="compact" onClick={() => setFilterOpen(true)}>
          <SlidersHorizontal size={14} />
          Filters
        </Button>
        <Button
          size="compact"
          disabled={!page?.total}
          pending={action.busy}
          onClick={exportCsv}
        >
          <Download size={14} />
          CSV
        </Button>
      </ArchiveSearch>
      <ErrorNotice message={archive.data.error} retry={archive.refresh} />
      <ErrorNotice message={action.error} />
      <div className="planning-archive-summary">
        <strong>{page ? duration(page.totals.minutes) : "…"}</strong>
        <HelpText>
          {page?.total ?? 0} entries · {archive.filters.from} –{" "}
          {archive.filters.to}
          {archive.filters.descendants === "1"
            ? " · Includes descendants"
            : " · Direct task entries"}
          {archive.filters.state !== "active"
            ? ` · ${archive.filters.state} entries`
            : ""}
        </HelpText>
      </div>
      <div className="planning-archive-results" ref={archive.resultsRef}>
        {!page ? (
          archive.data.loading && <Loading />
        ) : !page.items.length ? (
          <Empty title="No time recorded">
            Choose another date range, or log work on a task.
          </Empty>
        ) : (
          <div className="planning-lab-list">
            {page.items.map((e) => (
              <article className="planning-time-row" key={e.id}>
                <div>
                  <Button variant="ghost" onClick={() => setEditing(e.id)}>
                    {e.task_title}
                    {e.task_deleted_at ? " · Deleted task" : ""}
                  </Button>
                  <HelpText>
                    {e.spent_on} · {e.author_name ?? "Unavailable member"} ·{" "}
                    {duration(e.minutes)}
                    {e.withdrawn ? " · Withdrawn" : ""}
                  </HelpText>
                  {e.note_preview && (
                    <p className="planning-time-note">
                      {e.note_preview}
                      {e.note_truncated ? "…" : ""}
                    </p>
                  )}
                </div>
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => setHistory(e.id)}
                >
                  <History size={14} />
                  History
                </Button>
              </article>
            ))}
          </div>
        )}
        {page && (
          <details className="planning-time-report">
            <summary>By member and week</summary>
            <div className="planning-field-grid">
              <section>
                <h3>Members</h3>
                {page.totals.byMember.map((m) => (
                  <p key={m.id ?? "deleted"}>
                    {m.name ?? "Unavailable member"}{" "}
                    <strong>{duration(m.minutes)}</strong>
                  </p>
                ))}
              </section>
              <section>
                <h3>Weeks starting Monday</h3>
                {page.totals.byWeek.map((w) => (
                  <p key={w.week}>
                    {w.week} <strong>{duration(w.minutes)}</strong>
                  </p>
                ))}
              </section>
            </div>
          </details>
        )}
      </div>
      <HelpText>
        Creation-bounded pages; later corrections remain live. Withdrawn entries
        are excluded unless selected.
      </HelpText>
      <ArchivePagination label="Time entries" {...archive.pagination} />
      {filterOpen && (
        <Dialog
          title="Time report filters"
          onClose={() => setFilterOpen(false)}
        >
          <DialogBody>
            <div className="planning-field-grid">
              <Field label="From">
                <TextInput
                  type="date"
                  value={archive.filters.from}
                  onChange={(e) => archive.set({ from: e.target.value })}
                />
              </Field>
              <Field label="To">
                <TextInput
                  type="date"
                  value={archive.filters.to}
                  onChange={(e) => archive.set({ to: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Member">
              <PersonPicker
                label="Time report member"
                people={people}
                value={archive.filters.member}
                onChange={(member) => archive.set({ member })}
              />
            </Field>
            {!taskId && (
              <Field label="Task">
                <PlanningEntityPicker
                  label="Time report task"
                  spaceId={space.id}
                  kind="task"
                  value={archive.filters.task}
                  onChange={(v) => archive.set({ task: String(v) })}
                />
              </Field>
            )}
            <Field label="State">
              <NativeSelect
                value={archive.filters.state}
                onChange={(e) =>
                  archive.set({
                    state: e.target.value as typeof archive.filters.state,
                  })
                }
              >
                <option value="active">Active</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="all">All</option>
              </NativeSelect>
            </Field>
            {archive.filters.task && (
              <label className="planning-check-label">
                <Checkbox
                  checked={archive.filters.descendants === "1"}
                  onChange={(e) =>
                    archive.set({ descendants: e.target.checked ? "1" : "0" })
                  }
                />
                Include descendant tasks (each entry counts once)
              </label>
            )}
          </DialogBody>
          <DialogFooter>
            <Button onClick={archive.reset}>Reset</Button>
            <Button variant="primary" onClick={() => setFilterOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </Dialog>
      )}
      {editing && (
        <TimeEntryDialog
          key={editing}
          space={space}
          entryId={editing}
          taskId={taskId}
          readOnly={readOnly}
          onClose={() => setEditing(null)}
        />
      )}{" "}
      {history && (
        <TimeHistory
          spaceId={space.id}
          entryId={history}
          onClose={() => setHistory(null)}
        />
      )}
    </section>
  );
}
function TimeEntryDialog({
  space,
  entryId,
  taskId,
  readOnly,
  onClose,
}: {
  space: Space;
  entryId: string;
  taskId?: string;
  readOnly: boolean;
  onClose: () => void;
}) {
  const data = useData<{ item: TimeEntry }>(
    entryId !== "new" ? `spaces/${space.id}/planning-time/${entryId}` : null,
  );
  if (entryId !== "new" && !data.data)
    return (
      <Dialog title="Time entry" onClose={onClose}>
        <DialogBody>
          <ErrorNotice message={data.error} retry={data.reload} />
          {data.loading && <Loading />}
        </DialogBody>
      </Dialog>
    );
  return (
    <TimeEditor
      space={space}
      initial={data.data?.item}
      taskId={taskId}
      readOnly={readOnly}
      onClose={onClose}
    />
  );
}
function TimeEditor({
  space,
  initial: received,
  taskId,
  readOnly,
  onClose,
}: {
  space: Space;
  initial?: TimeEntry;
  taskId?: string;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [initial] = useState(received);
  const { session, refresh, notify } = useWorkspace(),
    action = useAction(),
    [baseline] = useState<TimeInput>(() => ({
      taskId: initial?.task_id ?? taskId ?? "",
      spentOn: initial?.spent_on ?? localDay(space.timezone ?? "UTC"),
      minutes: initial?.minutes ?? 60,
      note: initial?.note ?? "",
    })),
    [draft, setDraft] = useState(baseline),
    [minutes, setMinutes] = useState(String(baseline.minutes)),
    [reason, setReason] = useState("");
  const correction = !!initial && initial.author_id !== session.user.id,
    canEdit = !readOnly && (!correction || space.can_manage),
    dirty =
      JSON.stringify(draft) !== JSON.stringify(baseline) ||
      minutes !== String(baseline.minutes) ||
      !!reason;
  const valid =
    timeInputSchema.safeParse(draft).success &&
    /^\d+$/.test(minutes) &&
    Number(minutes) >= 1 &&
    Number(minutes) <= 1440 &&
    (!correction || !!reason.trim());
  const close = () =>
    closePlanningDraft(dirty, action.busy, onClose, "Unsaved time entry");
  const save = (operation?: "withdraw" | "restore") =>
    void action.run(async () => {
      await mutate(
        `spaces/${space.id}/planning-time${initial ? "/" + initial.id : ""}${operation ? "/" + operation : ""}`,
        { ...draft, version: initial?.version, reason },
        operation ? "POST" : initial ? "PATCH" : "POST",
      );
      refresh();
      notify(
        operation
          ? `Time entry ${operation === "withdraw" ? "withdrawn" : "restored"}.`
          : "Time entry saved.",
      );
      onClose();
    });
  return (
    <Dialog title={initial ? "Time entry" : "Log time"} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && canEdit && !initial?.withdrawn) save();
        }}
      >
        <DialogBody>
          <DraftGuard dirty={dirty} title="Unsaved time entry" />
          <ErrorNotice message={action.error} />
          {initial && (
            <HelpText>
              By {initial.author_name ?? "Unavailable member"} · Revision{" "}
              {initial.version}
              {initial.withdrawn ? " · Withdrawn" : ""}
            </HelpText>
          )}
          <fieldset
            className="planning-suite-form"
            disabled={!canEdit || action.busy}
          >
            <Field label="Task">
              {initial ? (
                <HelpText>
                  {initial.task_title}
                  {initial.task_deleted_at
                    ? " · Deleted (history retained)"
                    : ""}
                </HelpText>
              ) : (
                <PlanningEntityPicker
                  label="Task for time entry"
                  spaceId={space.id}
                  kind="task"
                  value={draft.taskId}
                  onChange={(v) => setDraft({ ...draft, taskId: String(v) })}
                />
              )}
            </Field>
            <div className="planning-field-grid">
              <Field label="Work date">
                <TextInput
                  required
                  type="date"
                  max={localDay(space.timezone ?? "UTC")}
                  disabled={!!initial?.withdrawn || !!initial?.task_deleted_at}
                  value={draft.spentOn}
                  onChange={(e) =>
                    setDraft({ ...draft, spentOn: e.target.value })
                  }
                />
              </Field>
              <Field label="Minutes" hint="1–1,440 minutes per entry">
                <TextInput
                  required
                  type="number"
                  min={1}
                  max={1440}
                  step={1}
                  disabled={!!initial?.withdrawn || !!initial?.task_deleted_at}
                  value={minutes}
                  aria-invalid={
                    !/^\d+$/.test(minutes) ||
                    Number(minutes) < 1 ||
                    Number(minutes) > 1440
                  }
                  onChange={(e) => {
                    setMinutes(e.target.value);
                    setDraft({ ...draft, minutes: Number(e.target.value) });
                  }}
                />
              </Field>
            </div>
            <Field label="Note">
              <TextArea
                maxLength={2000}
                rows={4}
                disabled={!!initial?.withdrawn || !!initial?.task_deleted_at}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </Field>
            {correction && (
              <Field
                label="Correction reason"
                hint="Required for changes to another member’s entry"
              >
                <TextArea
                  required
                  maxLength={500}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            )}
          </fieldset>
        </DialogBody>
        <DialogFooter>
          {initial && (
            <Button
              type="button"
              variant={initial.withdrawn ? "secondary" : "danger"}
              disabled={
                !canEdit || action.busy || (correction && !reason.trim())
              }
              onClick={() => save(initial.withdrawn ? "restore" : "withdraw")}
            >
              {initial.withdrawn ? "Restore" : "Withdraw"}
            </Button>
          )}
          <Button type="button" disabled={action.busy} onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            pending={action.busy}
            disabled={
              !canEdit ||
              !valid ||
              !!initial?.withdrawn ||
              !!initial?.task_deleted_at ||
              (!!initial && !dirty)
            }
          >
            Save entry
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
type TimeHistoryEntry = {
  id: string;
  actor_name: string | null;
  created_at: string;
  reason: string;
  before_data: TimeEntry | null;
  after_data: TimeEntry;
};
function TimeHistory({
  spaceId,
  entryId,
  onClose,
}: {
  spaceId: string;
  entryId: string;
  onClose: () => void;
}) {
  const archive = usePlanningArchive<
    Omit<HistoryQuery, "cursor">,
    ArchivePage<TimeHistoryEntry>
  >(`spaces/${spaceId}/planning-time/${entryId}/history`, {
    q: "",
    sort: "newest",
    mine: "0",
    limit: 30,
  });
  return (
    <Dialog title="Time entry history" onClose={onClose}>
      <DialogBody>
        <ArchiveSearch
          label="Find time corrections"
          search={archive.search}
          onSearch={archive.setSearch}
          loading={archive.data.loading && !archive.data.data}
          onRefresh={archive.refresh}
        >
          <NativeSelect
            aria-label="Time history order"
            value={archive.filters.sort}
            onChange={(e) =>
              archive.set({ sort: e.target.value as HistoryQuery["sort"] })
            }
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </NativeSelect>
          <label className="planning-check-label">
            <Checkbox
              checked={archive.filters.mine === "1"}
              onChange={(e) =>
                archive.set({ mine: e.target.checked ? "1" : "0" })
              }
            />
            My changes
          </label>
        </ArchiveSearch>
        <ErrorNotice message={archive.data.error} retry={archive.refresh} />
        {!archive.data.data ? (
          <Loading />
        ) : (
          <div className="planning-lab-list">
            {archive.data.data.items.map((h) => (
              <article className="planning-time-history-entry" key={h.id}>
                <h3>
                  {h.before_data
                    ? h.after_data.withdrawn
                      ? "Withdrawn"
                      : h.before_data.withdrawn
                        ? "Restored"
                        : "Corrected"
                    : "Recorded"}
                </h3>
                <HelpText>
                  {h.actor_name ?? "Unavailable member"} ·{" "}
                  {new Date(h.created_at).toLocaleString()}
                </HelpText>
                {h.reason && <p>{h.reason}</p>}
                <dl>
                  <div>
                    <dt>Before</dt>
                    <dd>
                      {h.before_data
                        ? `${h.before_data.spent_on} · ${duration(h.before_data.minutes)} · ${h.before_data.note ?? ""}`
                        : "No entry"}
                    </dd>
                  </div>
                  <div>
                    <dt>After</dt>
                    <dd>
                      {h.after_data.spent_on} · {duration(h.after_data.minutes)}{" "}
                      · {h.after_data.note}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <ArchivePagination label="Time history" {...archive.pagination} />
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </Dialog>
  );
}
