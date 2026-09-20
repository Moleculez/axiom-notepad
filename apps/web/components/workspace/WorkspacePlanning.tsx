"use client";
import { openAssistant } from "../../lib/assistant";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  CalendarDays,
  ChartGantt,
  Check,
  Columns3,
  Download,
  Flag,
  List,
  Plus,
  Repeat2,
  RotateCcw,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Resource, Space } from "@axiom/shared/workspace";
import {
  dayNumber,
  dateFromDay,
  planningCsv,
  planningDraftSchema,
  planningSvg,
  planningViews,
  type PlanningCalendar,
  type PlanningDraft,
  type PlanningTask,
  type PlanningView,
  type ScheduleChange,
  type SchedulePlan,
} from "@axiom/shared/planning";
import PlanningGantt, { type Milestone } from "./PlanningGantt";
import { useWorkSessions } from "../../lib/workspace-sessions";
import { confirmAction } from "../../lib/app-prompt";
import { timeAgo } from "../../lib/client";
import Dialog from "../Dialog";
import DraftGuard from "./DraftGuard";
import {
  Empty,
  ErrorNotice,
  go,
  Loading,
  mutate,
  useAction,
  useData,
  useLocation,
  useWorkspace,
  WorkspaceLink,
} from "./ui";
const PlanningMarkdown = dynamic(() => import("./PlanningMarkdown"), {
  loading: () => <Loading label="Opening Markdown editor…" />,
});
const statusNames: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};
const views = [
  ["list", List, "List"],
  ["board", Columns3, "Board"],
  ["calendar", CalendarDays, "Calendar"],
  ["gantt", ChartGantt, "Gantt"],
  ["workload", Users, "Workload"],
] as const;
type Person = {
  id: string;
  name: string;
  role: string;
  weekly_capacity?: number;
};
type PlanData = {
  items: PlanningTask[];
  total: number;
  completed: number;
  nextOffset: number | null;
  milestones: Milestone[];
  calendar: PlanningCalendar;
  version: number;
};
type Preview = SchedulePlan & { id: string; expires_at: string };
function download(name: string, body: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([body], { type })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function useOnline() {
  const [online, set] = useState(true);
  useEffect(() => {
    const update = () => set(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export default function WorkspacePlanning({ space }: { space: Space }) {
  const { revision, refresh, notify } = useWorkspace(),
    { params, path } = useLocation(),
    tabs = useWorkSessions();
  const online = useOnline(),
    readOnly =
      space.role !== "editor" || space.effective_status !== "active" || !online;
  const view = (
    planningViews.includes(params.get("view") as PlanningView)
      ? params.get("view")
      : "list"
  ) as PlanningView;
  const filter = new URLSearchParams({ limit: "5000" });
  for (const name of [
    "q",
    "status",
    "priority",
    "assignee",
    "milestone",
    "sort",
    "deleted",
  ])
    if (params.get(name)) filter.set(name, params.get(name)!);
  const data = useData<PlanData>(
      `spaces/${space.id}/planning?${filter}`,
      revision,
    ),
    people = useData<Person[]>(`spaces/${space.id}/planning-members`, revision),
    action = useAction();
  const [preview, setPreview] = useState<Preview | null>(null),
    [undo, setUndo] = useState<string | null>(null),
    [manage, setManage] = useState<"milestones" | "recurrences" | null>(null),
    [search, setSearch] = useState(params.get("q") ?? ""),
    [exporting, setExporting] = useState(false);
  const routeRef = useRef({ path, params });
  routeRef.current = { path, params };
  const tabsRef = useRef(tabs),
    scrollPosition = useRef<number | null>(null);
  tabsRef.current = tabs;
  useEffect(() => {
    const tabId = tabs?.active?.id;
    scrollPosition.current = null;
    const saveScroll = () => {
      const current = tabsRef.current;
      const tab = current?.state.sessions.find((row) => row.id === tabId);
      if (tab && scrollPosition.current != null) {
        current?.update(tab.id, {
          view: { ...tab.view, planningScroll: scrollPosition.current },
        });
        scrollPosition.current = null;
      }
    };
    // Persist on leaving, not at pointer/scroll frequency.
    window.addEventListener("pagehide", saveScroll);
    return () => {
      window.removeEventListener("pagehide", saveScroll);
      saveScroll();
    };
  }, [tabs?.active?.id, space.id, view]);
  function change(values: Record<string, string | null>) {
    const p = new URLSearchParams(routeRef.current.params);
    for (const [key, value] of Object.entries(values))
      if (value) p.set(key, value);
      else p.delete(key);
    go(`${path}?${p}`, true);
  }
  useEffect(() => {
    setSearch(params.get("q") ?? "");
  }, [params.get("q")]);
  useEffect(() => {
    if (search === (params.get("q") ?? "")) return;
    const timer = setTimeout(() => change({ q: search || null }), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const tasks = data.data?.items ?? [],
    milestones = data.data?.milestones ?? [],
    selected = params.get("task"),
    deleted = params.get("deleted") === "1";
  const schedule = (changes: ScheduleChange[]) =>
    void action.run(async () => {
      setPreview(
        await mutate(`spaces/${space.id}/schedule/preview`, { changes }),
      );
    });
  const apply = (mode: "direct" | "proposed") =>
    void action.run(async () => {
      const result = await mutate(`spaces/${space.id}/schedule/apply`, {
        previewId: preview!.id,
        mode,
      });
      setPreview(null);
      setUndo(result.undoId);
      refresh();
      notify(`Updated ${result.count} scheduled tasks.`);
    });
  const updateStatus = (task: PlanningTask, status: string) =>
    void action.run(async () => {
      await mutate(
        `spaces/${space.id}/tasks/${task.id}`,
        { version: task.version, status },
        "PATCH",
      );
      refresh();
    });
  return (
    <div className="workspace-planning">
      <div className="planning-toolbar">
        <nav className="planning-view-switch" aria-label="Planning views">
          {views.map(([key, Icon, label]) => (
            <button
              key={key}
              aria-pressed={view === key}
              onClick={() => change({ view: key })}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <span className="planning-spacer" />
        <button
          className="button ghost"
          onClick={() => setManage("milestones")}
        >
          <Flag size={15} />
          Milestones
        </button>
        <button
          className="icon-button"
          title="Recurring tasks"
          aria-label="Recurring tasks"
          onClick={() => setManage("recurrences")}
        >
          <Repeat2 size={17} />
        </button>
        <button
          className="icon-button"
          title="Export filtered tasks"
          aria-label="Export filtered tasks"
          disabled={!tasks.length}
          onClick={() => setExporting(true)}
        >
          <Download size={17} />
        </button>
        <button
          className="button primary"
          disabled={readOnly}
          onClick={() => change({ task: "new" })}
        >
          <Plus size={16} />
          New task
        </button>
      </div>
      <div className="planning-filters">
        <label className="planning-search">
          <Search size={15} />
          <input
            aria-label="Find tasks"
            placeholder="Find tasks or labels…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter task status"
          value={params.get("status") ?? ""}
          onChange={(e) => change({ status: e.target.value || null })}
        >
          <option value="">All statuses</option>
          {Object.entries(statusNames).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter assignee"
          value={params.get("assignee") ?? ""}
          onChange={(e) => change({ assignee: e.target.value || null })}
        >
          <option value="">Anyone</option>
          {people.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter priority"
          value={params.get("priority") ?? ""}
          onChange={(e) => change({ priority: e.target.value || null })}
        >
          <option value="">All priorities</option>
          {["low", "normal", "high", "urgent"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          aria-label="Filter milestone"
          value={params.get("milestone") ?? ""}
          onChange={(e) => change({ milestone: e.target.value || null })}
        >
          <option value="">All milestones</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
        <button
          className={`icon-button ${deleted ? "active" : ""}`}
          aria-pressed={deleted}
          title="Deleted tasks"
          aria-label="Deleted tasks"
          onClick={() => change({ deleted: deleted ? null : "1" })}
        >
          <Trash2 size={16} />
        </button>
        <span className="planning-count" role="status">
          {data.data
            ? `${data.data.total.toLocaleString()} tasks · ${data.data.completed} done`
            : "Loading…"}
        </span>
      </div>
      {!online && (
        <p className="planning-notice">
          Offline · You can keep a local task draft. Planning changes require a
          connection.
        </p>
      )}
      {undo && (
        <div className="planning-notice">
          Schedule updated.
          <button
            className="text-button"
            disabled={action.busy || readOnly}
            onClick={() =>
              void action.run(async () => {
                await mutate(`spaces/${space.id}/schedule/undo`, {
                  previewId: undo,
                });
                setUndo(null);
                refresh();
                notify("Schedule restored.");
              })
            }
          >
            <RotateCcw size={14} />
            Undo
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss schedule receipt"
            onClick={() => setUndo(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <ErrorNotice
        message={data.error || people.error || action.error}
        retry={data.error ? data.reload : undefined}
      />
      {data.data?.nextOffset != null && (
        <p className="planning-notice">
          Showing the first {tasks.length.toLocaleString()} matching tasks.
          Refine filters to see the rest. Scheduling still validates the entire
          workspace dependency graph.
        </p>
      )}
      {data.loading && !data.data ? (
        <Loading />
      ) : (
        data.data && (
          <div className="planning-content">
            {!tasks.length && view !== "gantt" ? (
              <Empty
                title={
                  deleted ? "No deleted tasks" : "A clear plan starts here"
                }
              >
                {deleted
                  ? "Deleted tasks can be restored from their details."
                  : "Add a task, link research evidence, and plan your next milestone."}
              </Empty>
            ) : view === "gantt" ? (
              <PlanningGantt
                tasks={tasks}
                milestones={milestones}
                calendar={data.data.calendar}
                readOnly={readOnly || deleted}
                onOpen={(id) => change({ task: id })}
                onSchedule={schedule}
                zoom={params.get("zoom") ?? "week"}
                onZoom={(value) => change({ zoom: value })}
                initialScroll={Number(tabs?.active?.view?.planningScroll ?? 0)}
                onScrollPosition={(scroll) => {
                  scrollPosition.current = scroll;
                }}
              />
            ) : view === "board" ? (
              <TaskBoard
                tasks={tasks}
                readOnly={readOnly || deleted}
                onOpen={(id) => change({ task: id })}
                onStatus={updateStatus}
              />
            ) : view === "calendar" ? (
              <TaskCalendar
                tasks={tasks}
                calendar={data.data.calendar}
                onOpen={(id) => change({ task: id })}
              />
            ) : view === "workload" ? (
              <TaskWorkload tasks={tasks} people={people.data ?? []} />
            ) : (
              <TaskList
                tasks={tasks}
                onOpen={(id) => change({ task: id })}
                onStatus={updateStatus}
                readOnly={readOnly || deleted}
              />
            )}
          </div>
        )
      )}
      {selected && (
        <TaskInspector
          key={space.id + selected}
          space={space}
          id={selected}
          tasks={tasks}
          people={people.data ?? []}
          milestones={milestones}
          readOnly={readOnly}
          onClose={() => change({ task: null })}
          onSchedule={schedule}
        />
      )}
      {preview && (
        <Dialog
          title="Preview schedule changes"
          subtitle="Nothing changes until you apply. Working calendars affect proposals, never existing dates automatically."
          onClose={() => !action.busy && setPreview(null)}
        >
          <div className="schedule-preview-summary">
            <strong>{preview.direct.length} directly edited</strong>
            <span>
              {preview.proposed.length - preview.direct.length} dependent tasks
              proposed
            </span>
            <span>{preview.conflicts.length} dependency conflicts</span>
          </div>
          <div className="schedule-preview-table">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Current dates</th>
                  <th>Proposed dates</th>
                </tr>
              </thead>
              <tbody>
                {preview.proposed.map((c) => {
                  const task = preview.before.find((t) => t.id === c.id);
                  return (
                    <tr key={c.id}>
                      <th>
                        {task?.title ?? "Dependent task outside this view"}
                      </th>
                      <td>
                        {task?.startOn ?? "—"} → {task?.dueOn ?? "—"}
                      </td>
                      <td>
                        {c.startOn ?? "—"} → {c.dueOn ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!!preview.warnings.length && (
            <ul className="planning-warnings">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {!!preview.conflicts.length && (
            <p className="ws-note">
              Direct-only preserves dependent dates, including any conflicts.
              Proposed changes only push unfinished successors; completed work
              is never moved.
            </p>
          )}
          <ErrorNotice message={action.error} />
          <div className="dialog-footer">
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={() => setPreview(null)}
            >
              Cancel
            </button>
            {!!preview.conflicts.length && (
              <button
                className="button secondary"
                disabled={action.busy || readOnly}
                onClick={() => apply("direct")}
              >
                Apply direct edits only
              </button>
            )}
            <button
              className="button primary"
              disabled={action.busy || readOnly}
              onClick={() => apply("proposed")}
            >
              <Check size={16} />
              Apply {preview.proposed.length} changes
            </button>
          </div>
        </Dialog>
      )}
      {exporting && (
        <Dialog
          title="Export planning view"
          subtitle={`Export ${tasks.length.toLocaleString()} loaded, filtered tasks. Task descriptions and private drafts are not included.`}
          onClose={() => setExporting(false)}
        >
          <div className="planning-export-actions">
            <button
              className="button secondary"
              onClick={() =>
                download(`${space.name}-tasks.csv`, planningCsv(tasks))
              }
            >
              <Download size={16} />
              Download CSV
            </button>
            <button
              className="button secondary"
              onClick={() =>
                download(
                  `${space.name}-timeline.svg`,
                  planningSvg(tasks, space.name),
                  "image/svg+xml",
                )
              }
            >
              <ChartGantt size={16} />
              Download SVG timeline
            </button>
            <button
              className="button secondary"
              onClick={() => {
                const target = window.open("", "_blank");
                if (!target) {
                  notify("Allow a new window to print the timeline.");
                  return;
                }
                target.opener = null;
                target.document.title = space.name;
                const heading = target.document.createElement("h1");
                heading.textContent = space.name;
                target.document.body.append(heading);
                const list = target.document.createElement("table");
                list.style.cssText =
                  "width:100%;border-collapse:collapse;font:12px system-ui";
                const head = list.createTHead().insertRow();
                for (const label of [
                  "Task",
                  "Status",
                  "Assignee",
                  "Start",
                  "Finish",
                ]) {
                  const cell = target.document.createElement("th");
                  cell.textContent = label;
                  cell.style.cssText =
                    "text-align:left;padding:10px;border-bottom:1px solid #bbb";
                  head.append(cell);
                }
                for (const task of tasks) {
                  const row = list.insertRow();
                  row.style.breakInside = "avoid";
                  for (const value of [
                    task.title,
                    statusNames[task.status],
                    task.assignee_name ?? "—",
                    task.start_on ?? "—",
                    task.due_on ?? "—",
                  ]) {
                    const cell = row.insertCell();
                    cell.textContent = value;
                    cell.style.cssText =
                      "padding:10px;border-bottom:1px solid #ddd";
                  }
                }
                target.document.body.append(list);
                target.print();
              }}
            >
              Print / Save PDF
            </button>
          </div>
          <div className="dialog-footer">
            <button
              className="button secondary"
              onClick={() => setExporting(false)}
            >
              Done
            </button>
          </div>
        </Dialog>
      )}
      {manage && (
        <PlanningManager
          space={space}
          mode={manage}
          readOnly={readOnly}
          onClose={() => setManage(null)}
        />
      )}
    </div>
  );
}

function TaskList({
  tasks,
  onOpen,
  onStatus,
  readOnly,
}: {
  tasks: PlanningTask[];
  onOpen: (id: string) => void;
  onStatus: (task: PlanningTask, status: string) => void;
  readOnly: boolean;
}) {
  const [top, setTop] = useState(0),
    row = 52,
    start = Math.max(0, Math.floor(top / row) - 6),
    visible = tasks.slice(start, start + 32);
  return (
    <div
      className="planning-list"
      role="table"
      aria-label="Tasks"
      aria-rowcount={tasks.length + 1}
    >
      <div className="planning-list-head" role="row">
        <span role="columnheader">Task</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Assignee</span>
        <span role="columnheader">Dates</span>
      </div>
      <div
        className="planning-list-scroll"
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: tasks.length * row, position: "relative" }}>
          {visible.map((task, i) => (
            <div
              className="planning-task-row"
              key={task.id}
              role="row"
              aria-rowindex={start + i + 2}
              style={{ top: (start + i) * row, height: row }}
            >
              <div role="cell">
                <button
                  className="planning-task-title"
                  onClick={() => onOpen(task.id)}
                >
                  <span className={`task-status-dot ${task.status}`} />
                  <span>
                    {task.parent_id && <small>↳ </small>}
                    {task.title}
                    {task.blocked && <small> · Blocked</small>}
                  </span>
                </button>
                <small>{task.labels.join(" · ")}</small>
              </div>
              <div role="cell">
                <select
                  aria-label={`Status of ${task.title}`}
                  value={task.status}
                  disabled={readOnly}
                  onChange={(e) => onStatus(task, e.target.value)}
                >
                  {Object.entries(statusNames).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <span role="cell">{task.assignee_name ?? "Unassigned"}</span>
              <button role="cell" onClick={() => onOpen(task.id)}>
                {task.start_on ?? "—"} → {task.due_on ?? "—"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function TaskBoard({
  tasks,
  readOnly,
  onOpen,
  onStatus,
}: {
  tasks: PlanningTask[];
  readOnly: boolean;
  onOpen: (id: string) => void;
  onStatus: (task: PlanningTask, status: string) => void;
}) {
  const [more, setMore] = useState<Record<string, number>>({});
  return (
    <div className="planning-board">
      {Object.entries(statusNames).map(([status, label]) => {
        const group = tasks.filter((t) => t.status === status),
          limit = more[status] ?? 60;
        return (
          <section
            key={status}
            aria-label={label}
            onDragOver={(e) => {
              if (
                !readOnly &&
                e.dataTransfer.types.includes("application/x-axiom-task")
              )
                e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const task = tasks.find(
                (t) =>
                  t.id === e.dataTransfer.getData("application/x-axiom-task"),
              );
              if (task && !readOnly && task.status !== status)
                onStatus(task, status);
            }}
          >
            <header>
              <span className={`task-status-dot ${status}`} />
              <h3>{label}</h3>
              <small>{group.length}</small>
            </header>
            {group.slice(0, limit).map((task) => (
              <button
                className="planning-board-card"
                key={task.id}
                draggable={!readOnly}
                onDragStart={(e) =>
                  e.dataTransfer.setData("application/x-axiom-task", task.id)
                }
                onClick={() => onOpen(task.id)}
              >
                <strong>{task.title}</strong>
                <span>{task.labels.join(" · ")}</span>
                <footer>
                  <small>{task.assignee_name ?? "Unassigned"}</small>
                  <small>{task.due_on ?? "No date"}</small>
                </footer>
                {task.blocked && <small>Waiting for dependencies</small>}
              </button>
            ))}
            {group.length > limit && (
              <button
                className="text-button"
                onClick={() => setMore({ ...more, [status]: limit + 60 })}
              >
                Show more ({group.length - limit})
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
function TaskCalendar({
  tasks,
  calendar,
  onOpen,
}: {
  tasks: PlanningTask[];
  calendar: PlanningCalendar;
  onOpen: (id: string) => void;
}) {
  const [month, setMonth] = useState(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: calendar.timezone,
      year: "numeric",
      month: "2-digit",
    }).format(new Date()),
  );
  const first = dayNumber(month + "-01"),
    weekday = (new Date(month + "-01T00:00:00Z").getUTCDay() + 6) % 7;
  return (
    <section className="planning-calendar">
      <header>
        <label>
          Due dates{" "}
          <input
            aria-label="Calendar month"
            type="month"
            value={month}
            onChange={(e) => {
              if (/^\d{4}-\d{2}$/.test(e.target.value))
                setMonth(e.target.value);
            }}
          />
        </label>
        <small>
          Dates are shown in the workspace calendar · {calendar.timezone}
        </small>
      </header>
      <div className="planning-calendar-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <strong key={d}>{d}</strong>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const date = dateFromDay(first - weekday + i),
            items = tasks.filter((t) => t.due_on === date);
          return (
            <section
              key={date}
              className={date.startsWith(month) ? "" : "outside"}
              aria-label={date}
            >
              <time dateTime={date}>{Number(date.slice(-2))}</time>
              {items.slice(0, 8).map((t) => (
                <button key={t.id} onClick={() => onOpen(t.id)}>
                  <span className={`task-status-dot ${t.status}`} />
                  {t.title}
                </button>
              ))}
              {items.length > 8 && (
                <details>
                  <summary>{items.length - 8} more</summary>
                  {items.slice(8).map((t) => (
                    <button key={t.id} onClick={() => onOpen(t.id)}>
                      {t.title}
                    </button>
                  ))}
                </details>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
function TaskWorkload({
  tasks,
  people,
}: {
  tasks: PlanningTask[];
  people: Person[];
}) {
  return (
    <section className="planning-workload">
      <h3>Open work in this view</h3>
      <p className="ws-note">
        Estimates show total remaining task effort, not weekly utilization.
        Unestimated work is reported separately.
      </p>
      {[{ id: "", name: "Unassigned" }, ...people].map((person) => {
        const assigned = tasks.filter(
            (t) =>
              (t.assignee_id ?? "") === person.id &&
              !["done", "cancelled"].includes(t.status),
          ),
          hours = assigned.reduce(
            (sum, t) => sum + Number(t.estimate_hours ?? 0),
            0,
          );
        return (
          <div className="planning-workload-row" key={person.id}>
            <strong>{person.name}</strong>
            <span>{assigned.length} tasks</span>
            <span>{hours} h estimated</span>
            <span>
              {assigned.filter((t) => t.estimate_hours == null).length}{" "}
              unestimated
            </span>
          </div>
        );
      })}
    </section>
  );
}

type Draft = PlanningDraft;
function taskDraft(task?: PlanningTask): Draft {
  return {
    title: task?.title ?? "",
    body: task?.body ?? "",
    status: task?.status ?? "todo",
    priority: task?.priority ?? "normal",
    assigneeId: task?.assignee_id ?? null,
    parentId: task?.parent_id ?? null,
    startOn: task?.start_on ?? null,
    dueOn: task?.due_on ?? null,
    estimateHours:
      task?.estimate_hours == null ? null : Number(task.estimate_hours),
    labels: task?.labels ?? [],
    milestoneId: task?.milestone_id ?? null,
    resourceIds: task?.resource_ids ?? [],
    dependencies: task?.dependencies ?? [],
    version: task?.version,
  };
}
function TaskInspector(props: {
  space: Space;
  id: string;
  tasks: PlanningTask[];
  people: Person[];
  milestones: Milestone[];
  readOnly: boolean;
  onClose: () => void;
  onSchedule: (changes: ScheduleChange[]) => void;
}) {
  const { revision } = useWorkspace(),
    detail = useData<PlanningTask>(
      props.id !== "new" ? `spaces/${props.space.id}/tasks/${props.id}` : null,
      revision,
    );
  return (
    <aside
      className="planning-inspector"
      aria-label={props.id === "new" ? "New task" : "Task details"}
    >
      <div
        className="planning-inspector-resize"
        role="separator"
        aria-label="Resize task inspector"
        aria-orientation="vertical"
        tabIndex={0}
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
          e.preventDefault();
          const panel = e.currentTarget.parentElement!;
          panel.style.width =
            Math.max(
              360,
              Math.min(
                760,
                panel.clientWidth + (e.key === "ArrowLeft" ? 24 : -24),
              ),
            ) + "px";
        }}
        onPointerDown={(e) => {
          const panel = e.currentTarget.parentElement!,
            x = e.clientX,
            width = panel.clientWidth;
          const move = (event: PointerEvent) => {
            panel.style.width =
              Math.max(360, Math.min(760, width + x - event.clientX)) + "px";
          };
          const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", end, { once: true });
          window.addEventListener("pointercancel", end, { once: true });
        }}
      />
      {props.id === "new" || detail.data ? (
        <TaskForm {...props} task={detail.data ?? undefined} />
      ) : (
        <>
          <header>
            <h2>Task details</h2>
            <button
              className="icon-button"
              aria-label="Close task details"
              onClick={props.onClose}
            >
              <X size={18} />
            </button>
          </header>
          <ErrorNotice message={detail.error} retry={detail.reload} />
          {detail.loading && <Loading />}
        </>
      )}
    </aside>
  );
}
function TaskForm({
  space,
  id,
  task,
  tasks,
  people,
  milestones,
  readOnly,
  onClose,
  onSchedule,
}: {
  space: Space;
  id: string;
  task?: PlanningTask;
  tasks: PlanningTask[];
  people: Person[];
  milestones: Milestone[];
  readOnly: boolean;
  onClose: () => void;
  onSchedule: (changes: ScheduleChange[]) => void;
}) {
  const { session, refresh, notify } = useWorkspace(),
    action = useAction(),
    key = `axiom:task-draft:${session.user.id}:${space.id}:${id}`,
    baseline = useRef(taskDraft(task));
  const [recovered, setRecovered] = useState(false),
    [storageError, setStorageError] = useState("");
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      const result =
        saved &&
        planningDraftSchema.safeParse({ ...baseline.current, ...saved });
      if (result?.success) return result.data;
    } catch {}
    return baseline.current;
  });
  const [schedule, setSchedule] = useState(false),
    [start, setStart] = useState(task?.start_on ?? ""),
    [end, setEnd] = useState(task?.due_on ?? ""),
    [evidenceSearch, setEvidenceSearch] = useState(""),
    [related, setRelated] = useState(""),
    [labelsText, setLabelsText] = useState(draft.labels.join(", "));
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline.current),
    dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (task && !dirty && task.version > (baseline.current.version ?? 0)) {
      baseline.current = taskDraft(task);
      setDraft(baseline.current);
      setLabelsText(baseline.current.labels.join(", "));
    }
  }, [task?.version, dirty]);
  useEffect(() => {
    setRecovered(dirty);
  }, []);
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(key, JSON.stringify(draft));
      else localStorage.removeItem(key);
      setStorageError("");
    } catch {
      setStorageError(
        "Local draft storage is unavailable. Keep this task open until saved.",
      );
    }
  }, [draft, dirty, key]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: Event) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      void confirmAction(
        "This task has unsaved changes. Leave and keep a local draft on this device?",
        { title: "Keep task draft?", confirmLabel: "Keep draft and leave" },
      ).then((ok) => {
        if (ok) (event as CustomEvent).detail.proceed();
      });
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("axiom:before-navigate", navigate);
    return () => {
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("axiom:before-navigate", navigate);
    };
  }, []);
  const evidence = useData<{ items: Resource[] }>(
    `resources?spaceId=${space.id}&view=all&limit=100&q=${encodeURIComponent(evidenceSearch)}`,
  );
  const set = (patch: Partial<Draft>) =>
    setDraft((old) => ({ ...old, ...patch }));
  const save = () =>
    void action.run(async () => {
      const input = { ...draft };
      if (task) {
        delete (input as Partial<Draft>).startOn;
        delete (input as Partial<Draft>).dueOn;
      }
      const result = await mutate(
        `spaces/${space.id}/tasks${task ? "/" + id : ""}`,
        input,
        task ? "PATCH" : "POST",
      );
      dirtyRef.current = false;
      baseline.current = taskDraft({
        ...result,
        resource_ids: result.resource_ids ?? draft.resourceIds,
      });
      setDraft(baseline.current);
      try {
        localStorage.removeItem(key);
      } catch {
        /* The server receipt still confirms the save. */
      }
      refresh();
      notify("Task saved.");
      onClose();
    });
  const relatedTasks = tasks
    .filter(
      (t) =>
        t.id !== id &&
        (draft.dependencies.includes(t.id) ||
          t.id === draft.parentId ||
          t.title.toLowerCase().includes(related.toLowerCase())),
    )
    .slice(0, 150);
  const removed = !!task?.deleted_at;
  return (
    <>
      <header>
        <div>
          <small>{space.name}</small>
          <h2>{task ? "Task details" : "New task"}</h2>
        </div>
        {task && (
          <button
            className="button ghost"
            onClick={() =>
              openAssistant({
                spaceId: space.id,
                selection: { kind: "task", id: task.id, editable: false },
              })
            }
          >
            Ask assistant
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Close task details"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="planning-inspector-body">
        {(recovered || storageError) && (
          <p className="planning-notice">
            {storageError ||
              "Recovered a local draft. Your saved version has not been overwritten."}
          </p>
        )}
        {task && draft.version !== task.version && (
          <p className="planning-notice">
            This task changed since this draft began. Copy your work, close the
            inspector, then reopen to compare. Saving will not overwrite a newer
            version.
          </p>
        )}
        <ErrorNotice message={action.error} />
        <fieldset disabled={readOnly || removed || action.busy}>
          <label>
            Title
            <input
              autoFocus
              maxLength={300}
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="What needs to happen?"
            />
          </label>
          <div className="planning-field-grid">
            <label>
              Status
              <select
                value={draft.status}
                onChange={(e) =>
                  set({ status: e.target.value as Draft["status"] })
                }
              >
                {Object.entries(statusNames).map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={draft.priority}
                onChange={(e) =>
                  set({ priority: e.target.value as Draft["priority"] })
                }
              >
                {["low", "normal", "high", "urgent"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              Assignee
              <select
                value={draft.assigneeId ?? ""}
                onChange={(e) => set({ assigneeId: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Effort (hours)
              <input
                type="number"
                min="0"
                max="10000"
                step="0.25"
                value={draft.estimateHours ?? ""}
                onChange={(e) =>
                  set({
                    estimateHours:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <PlanningMarkdown
            key={`${id}:${baseline.current.version ?? "new"}`}
            initial={draft.body}
            onChange={(body) => set({ body })}
            readOnly={readOnly || removed || action.busy}
          />
          <label>
            Labels (comma separated)
            <input
              value={labelsText}
              maxLength={818}
              onChange={(e) => {
                setLabelsText(e.target.value);
                set({
                  labels: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                });
              }}
            />
          </label>
          <label>
            Milestone
            <select
              value={draft.milestoneId ?? ""}
              onChange={(e) => set({ milestoneId: e.target.value || null })}
            >
              <option value="">No milestone</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary>Subtasks & dependencies</summary>
            <label>
              Find related task
              <input
                value={related}
                onChange={(e) => setRelated(e.target.value)}
                placeholder="Search tasks in the current view…"
              />
            </label>
            <label>
              Parent task
              <select
                value={draft.parentId ?? ""}
                onChange={(e) => set({ parentId: e.target.value || null })}
              >
                <option value="">Top-level task</option>
                {relatedTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Finish-to-start dependencies
              <select
                multiple
                size={5}
                value={draft.dependencies}
                onChange={(e) =>
                  set({
                    dependencies: Array.from(
                      e.target.selectedOptions,
                      (o) => o.value,
                    ),
                  })
                }
              >
                {relatedTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <small>
              Use ⌘/Ctrl to select several. Clear view filters to find more
              tasks. Cycles and cross-workspace links are rejected by the
              server.
            </small>
          </details>
          <details>
            <summary>
              Linked research evidence ({draft.resourceIds.length})
            </summary>
            <label>
              Find workspace files
              <input
                value={evidenceSearch}
                onChange={(e) => setEvidenceSearch(e.target.value)}
              />
            </label>
            <div className="planning-evidence">
              {[
                ...new Set([
                  ...draft.resourceIds,
                  ...(evidence.data?.items
                    .filter((r) => r.kind !== "folder")
                    .map((r) => r.id) ?? []),
                ]),
              ].map((resourceId) => {
                const r = evidence.data?.items.find((r) => r.id === resourceId);
                return (
                  <label key={resourceId}>
                    <input
                      type="checkbox"
                      checked={draft.resourceIds.includes(resourceId)}
                      onChange={(e) =>
                        set({
                          resourceIds: e.target.checked
                            ? [...draft.resourceIds, resourceId]
                            : draft.resourceIds.filter((v) => v !== resourceId),
                        })
                      }
                    />
                    <span>{r?.name ?? "Linked file"}</span>
                    <WorkspaceLink
                      to={`/notes/${resourceId}`}
                      aria-label={`Open ${r?.name ?? "linked file"}`}
                    >
                      ↗
                    </WorkspaceLink>
                  </label>
                );
              })}
            </div>
            <ErrorNotice message={evidence.error} />
          </details>
          {!task && (
            <div className="planning-field-grid">
              <label>
                Start
                <input
                  type="date"
                  value={draft.startOn ?? ""}
                  onChange={(e) => set({ startOn: e.target.value || null })}
                />
              </label>
              <label>
                Finish
                <input
                  type="date"
                  min={draft.startOn ?? undefined}
                  value={draft.dueOn ?? ""}
                  onChange={(e) => set({ dueOn: e.target.value || null })}
                />
              </label>
            </div>
          )}
        </fieldset>
        {task && (
          <section className="planning-task-schedule">
            <h3>Schedule</h3>
            <p>
              {task.start_on ?? "No start date"} →{" "}
              {task.due_on ?? "No finish date"}
            </p>
            <button
              className="button secondary"
              disabled={
                readOnly ||
                removed ||
                dirty ||
                ["done", "cancelled"].includes(task.status)
              }
              onClick={() => {
                setStart(task.start_on ?? "");
                setEnd(task.due_on ?? "");
                setSchedule(true);
              }}
            >
              <ChartGantt size={15} />
              Reschedule…
            </button>
            {dirty && (
              <small>Save task details before previewing date changes.</small>
            )}
          </section>
        )}
        {task && !removed && (
          <WorkspaceDiscussion space={space} taskId={id} compact />
        )}
        {task && (
          <small>
            Updated {timeAgo(task.updated_at)} · revision {task.version}
          </small>
        )}
      </div>
      <footer>
        <span className="planning-draft-state">
          {dirty ? "Local draft · not yet shared" : "Saved"}
        </span>
        {task && (
          <button
            className="icon-button"
            title={removed ? "Restore task" : "Delete task"}
            aria-label={removed ? "Restore task" : "Delete task"}
            disabled={readOnly || action.busy}
            onClick={() =>
              void action.run(async () => {
                if (
                  !removed &&
                  !(await confirmAction(
                    "Move this task to deleted tasks? Its history is retained and you can restore it.",
                    {
                      title: "Delete task?",
                      confirmLabel: "Delete task",
                      destructive: true,
                    },
                  ))
                )
                  return;
                await mutate(
                  `spaces/${space.id}/tasks/${id}`,
                  { version: task.version, deleted: !removed },
                  "PATCH",
                );
                dirtyRef.current = false;
                try {
                  localStorage.removeItem(key);
                } catch {}
                refresh();
                onClose();
              })
            }
          >
            {removed ? <RotateCcw size={16} /> : <Trash2 size={16} />}
          </button>
        )}
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={() => {
            dirtyRef.current = false;
            setDraft(baseline.current);
            try {
              localStorage.removeItem(key);
            } catch {}
            onClose();
          }}
        >
          Discard draft
        </button>
        <button
          className="button primary"
          disabled={
            readOnly ||
            removed ||
            action.busy ||
            !draft.title.trim() ||
            (!!task && !dirty)
          }
          onClick={save}
        >
          Save task
        </button>
      </footer>
      {schedule && task && (
        <Dialog
          title="Reschedule task"
          subtitle={task.title}
          onClose={() => setSchedule(false)}
        >
          <div className="planning-field-grid">
            <label>
              Start date
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Finish date
              <input
                type="date"
                min={start || undefined}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <div className="dialog-footer">
            <button
              className="button secondary"
              onClick={() => setSchedule(false)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={!!start && !!end && end < start}
              onClick={() => {
                setSchedule(false);
                onSchedule([
                  {
                    id: task.id,
                    version: task.version,
                    startOn: start || null,
                    dueOn: end || null,
                  },
                ]);
              }}
            >
              Preview changes
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function WorkspaceDiscussion({
  space,
  taskId,
  compact = false,
}: {
  space: Space;
  taskId?: string;
  compact?: boolean;
}) {
  const { revision, refresh } = useWorkspace(),
    online = useOnline(),
    data = useData<any[]>(
      `spaces/${space.id}/discussions${taskId ? `?task=${taskId}` : ""}`,
      revision,
    ),
    action = useAction();
  const [body, setBody] = useState(""),
    [reply, setReply] = useState<string | null>(null);
  return (
    <section className={`workspace-discussion ${compact ? "compact" : ""}`}>
      <DraftGuard
        dirty={!compact && !!body.trim()}
        title="Unsent discussion comment"
      />
      <h3>{compact ? "Task discussion" : "Workspace discussions"}</h3>
      <p className="ws-note">
        Keep decisions and research context alongside the work.
      </p>
      <ErrorNotice
        message={data.error || action.error}
        retry={data.error ? data.reload : undefined}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await mutate(`spaces/${space.id}/discussions`, {
              body,
              parentId: reply,
              taskId: taskId ?? null,
            });
            setBody("");
            setReply(null);
            refresh();
          });
        }}
      >
        <label>
          {reply ? "Reply to discussion" : "Add a comment"}
          <textarea
            rows={compact ? 3 : 4}
            value={body}
            maxLength={100000}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share a decision, observation, or question…"
          />
        </label>
        <div className="ws-actions">
          {reply && (
            <button
              type="button"
              className="text-button"
              onClick={() => setReply(null)}
            >
              Cancel reply
            </button>
          )}
          <button
            className="button primary"
            disabled={
              action.busy ||
              !online ||
              !body.trim() ||
              space.role === "viewer" ||
              space.effective_status !== "active"
            }
          >
            Post comment
          </button>
        </div>
      </form>
      {data.data?.map((post) => (
        <article key={post.id} className={post.parent_id ? "reply" : ""}>
          <header>
            <strong>{post.author_name}</strong>
            <small>
              {timeAgo(post.created_at)}
              {post.parent_id ? " · reply" : ""}
            </small>
          </header>
          <p>{post.body}</p>
          <button className="text-button" onClick={() => setReply(post.id)}>
            Reply
          </button>
        </article>
      ))}
      {data.loading && !data.data && <Loading />}
    </section>
  );
}
function PlanningManager({
  space,
  mode,
  readOnly,
  onClose,
}: {
  space: Space;
  mode: "milestones" | "recurrences";
  readOnly: boolean;
  onClose: () => void;
}) {
  const { revision, refresh } = useWorkspace(),
    data = useData<any[]>(`spaces/${space.id}/${mode}`, revision),
    action = useAction();
  const [title, setTitle] = useState(""),
    [date, setDate] = useState(""),
    [frequency, setFrequency] = useState("weekly");
  return (
    <Dialog
      title={mode === "milestones" ? "Workspace milestones" : "Recurring tasks"}
      subtitle={
        mode === "milestones"
          ? "Review points shared by every planning view."
          : "Create recurring research routines. Instances are generated in the workspace time zone."
      }
      onClose={onClose}
    >
      <ErrorNotice
        message={data.error || action.error}
        retry={data.error ? data.reload : undefined}
      />
      <div className="planning-manager-list">
        {data.data?.map((row) => (
          <div key={row.id}>
            <div>
              <strong>{row.title ?? row.template.title}</strong>
              <small>{row.due_on?.slice(0, 10) ?? row.rule?.frequency}</small>
            </div>
            <button
              className="button secondary"
              disabled={readOnly || action.busy}
              onClick={() =>
                void action.run(async () => {
                  await mutate(
                    `spaces/${space.id}/${mode}/${row.id}`,
                    mode === "milestones"
                      ? {
                          version: row.version,
                          title: row.title,
                          dueOn: row.due_on?.slice(0, 10) ?? null,
                          completed: !row.completed_at,
                        }
                      : { version: row.version, enabled: !row.enabled },
                    "PATCH",
                  );
                  refresh();
                })
              }
            >
              {mode === "milestones"
                ? row.completed_at
                  ? "Reopen"
                  : "Complete"
                : row.enabled
                  ? "Pause"
                  : "Resume"}
            </button>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await mutate(
              `spaces/${space.id}/${mode}`,
              mode === "milestones"
                ? { title, dueOn: date || null }
                : {
                    rule: { frequency, start: date, interval: 1 },
                    template: { title },
                  },
            );
            setTitle("");
            refresh();
          });
        }}
      >
        <label>
          {mode === "milestones" ? "Milestone title" : "Recurring task title"}
          <input
            required
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="planning-field-grid">
          <label>
            {mode === "milestones" ? "Target date" : "First occurrence"}
            <input
              type="date"
              required={mode === "recurrences"}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {mode === "recurrences" && (
            <label>
              Repeat
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                {["daily", "weekly", "monthly"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button
          className="button primary"
          disabled={readOnly || action.busy || !title.trim()}
        >
          Create {mode === "milestones" ? "milestone" : "routine"}
        </button>
      </form>
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
