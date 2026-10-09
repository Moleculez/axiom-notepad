"use client";
import { currentLocale } from "@axiom/i18n/client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  ActionRow,
  Button,
  Checkbox,
  HelpText,
  IconButton,
  TextInput,
  NativeSelect,
  TextArea,
  SearchField,
} from "../ui/controls";
import TaskPaperLinks from "./TaskPaperLinks";
import TaskResearchLinks from "./TaskResearchLinks";
import {
  PlanningIntegerInput,
  PlanningEntityPicker,
  PersonPicker,
  usePlanningRowSize,
} from "./PlanningFields";
import { PlanningBulkActions, PlanningViewActions } from "./PlanningActions";
import { PlanningGoals } from "./PlanningSuitePanels";
import { PlanningIntake } from "./PlanningIntake";
import { TaskCustomFields, PlanningPropertyView } from "./PlanningCustomFields";
const PlanningTime = dynamic(() => import("./PlanningTime"));
const PlanningRoutines = dynamic(() => import("./PlanningRoutines"));
import ScheduleCapacityPreview from "./ScheduleCapacityPreview";
import { openAssistant } from "../../lib/assistant";
import { useCallback, useEffect, useRef, useState } from "react";
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
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Space } from "@axiom/shared/workspace";
import { fieldSummaryText, type TaskField } from "@axiom/shared/planning-lab";
import {
  dayNumber,
  dateFromDay,
  planningCsv,
  planningDraftSchema,
  planningSvg,
  planningViews,
  taskDependencyLinks,
  resolveDependencyLinks,
  planningProgress,
  type PlanningCalendar,
  type PlanningDraft,
  type PlanningTask,
  type PlanningView,
  type ScheduleChange,
  type SchedulePlan,
} from "@axiom/shared/planning";
import PlanningGantt, { type Milestone } from "./PlanningGantt";
import type { PlanningAnalysis } from "@axiom/shared/planning-analysis";
const PlanningInsights = dynamic(() => import("./PlanningInsights"));
const GroupCapacity = dynamic(() =>
  import("./GroupPlanning").then((m) => m.GroupCapacity),
);
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
  loading: () => <Loading label={uiText("Opening Markdown editor…")} />,
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
  fields?: TaskField[];
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
  useInterfaceLocale();
  const { revision, refresh, notify } = useWorkspace(),
    { params, path } = useLocation(),
    tabs = useWorkSessions();
  const section = ["goals", "intake", "time"].includes(
    params.get("section") ?? "",
  )
    ? params.get("section")!
    : "tasks";
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
    "risk",
    "sort",
    "deleted",
    "fieldFilters",
    "sortField",
    "sortDirection",
    "includeFields",
  ])
    if (params.get(name)) filter.set(name, params.get(name)!);
  const data = useData<PlanData>(
      section === "tasks" ? `spaces/${space.id}/planning?${filter}` : null,
      revision,
    ),
    people = useData<Person[]>(`spaces/${space.id}/planning-members`, revision),
    action = useAction();
  const [preview, setPreview] = useState<Preview | null>(null),
    [undo, setUndo] = useState<string | null>(null),
    [manage, setManage] = useState<"milestones" | "recurrences" | null>(null),
    [search, setSearch] = useState(params.get("q") ?? ""),
    [exporting, setExporting] = useState(false);
  const [insights, setInsights] = useState(false),
    [analysis, setAnalysis] = useState<PlanningAnalysis | null>(null),
    [baseline, setBaseline] = useState<PlanningTask[]>([]);
  const [selection, setSelection] = useState(new Map<string, PlanningTask>()),
    anchor = useRef<string | null>(null);
  useEffect(() => {
    setSelection(new Map());
    anchor.current = null;
  }, [space.id]);
  const updateLayers = useCallback(
    (analysis: PlanningAnalysis | null, tasks: PlanningTask[]) => {
      setAnalysis(analysis);
      setBaseline(tasks);
    },
    [],
  );
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
  const selectTask = (task: PlanningTask, range = false) => {
    setSelection((old) => {
      const next = new Map(old);
      if (range && anchor.current) {
        const a = tasks.findIndex((t) => t.id === anchor.current),
          b = tasks.findIndex((t) => t.id === task.id);
        if (a >= 0 && b >= 0) {
          const span = tasks.slice(Math.min(a, b), Math.max(a, b) + 1);
          if (new Set([...next.keys(), ...span.map((t) => t.id)]).size > 1000) {
            notify(
              "Select at most 1,000 tasks per bulk change. Narrow the selection first.",
            );
            return old;
          }
          for (const t of span) next.set(t.id, t);
          return next;
        }
      }
      if (next.has(task.id)) next.delete(task.id);
      else if (next.size < 1000) next.set(task.id, task);
      else notify("At most 1,000 selected tasks.");
      return next;
    });
    anchor.current = task.id;
  };
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
      <nav
        className="planning-section-tabs"
        aria-label={uiText("Planning sections")}
      >
        {["tasks", "goals", "intake", "time"].map((key) => (
          <button
            key={key}
            aria-pressed={section === key}
            onClick={() =>
              change({ section: key === "tasks" ? null : key, task: null })
            }
          >
            {key[0].toUpperCase() + key.slice(1)}
          </button>
        ))}
      </nav>
      {section === "goals" ? (
        <PlanningGoals
          space={space}
          people={people.data ?? []}
          readOnly={readOnly}
        />
      ) : section === "time" ? (
        <PlanningTime
          space={space}
          people={people.data ?? []}
          readOnly={readOnly}
        />
      ) : section === "intake" ? (
        <PlanningIntake
          space={space}
          people={people.data ?? []}
          online={online}
        />
      ) : (
        <>
          <ActionRow className="planning-toolbar" size="standard">
            <Button
              className="button ghost"
              disabled={!tasks.length || tasks.length > 100}
              title={
                tasks.length > 100
                  ? uiText(
                      "Filter to at most 100 tasks to select exact planning evidence",
                    )
                  : uiText("Review selected planning evidence before sending")
              }
              onClick={() =>
                openAssistant({
                  spaceId: space.id,
                  selection: {
                    kind: "planning",
                    id: space.id,
                    taskIds: tasks.map((t) => t.id),
                  },
                  selectionLabel: `${space.name} · ${tasks.length} tasks`,
                  prompt:
                    "Explain schedule risks and missing information in these selected tasks. Distinguish the deterministic forecast from your interpretation.",
                })
              }
            >
              <I18nText id="Ask about this plan" />
            </Button>
            <Button
              className="button ghost"
              aria-pressed={insights}
              onClick={() => setInsights(!insights)}
            >
              <I18nText id="Insights & baselines" />
            </Button>
            <NativeSelect
              aria-label={uiText("Task view")}
              value={view}
              onChange={(e) => change({ view: e.target.value })}
            >
              {views.map(([key, , label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            <PlanningViewActions
              spaceId={space.id}
              canManage={space.can_manage}
              params={params}
              change={change}
            />
            <span className="planning-spacer" />
            <Button
              className="button ghost"
              onClick={() => setManage("milestones")}
            >
              <Flag size={15} />
              <I18nText id="Milestones" />
            </Button>
            <IconButton
              className="icon-button"
              title={uiText("Recurring tasks")}
              aria-label={uiText("Recurring tasks")}
              onClick={() => setManage("recurrences")}
            >
              <Repeat2 size={17} />
            </IconButton>
            <IconButton
              className="icon-button"
              title={uiText("Export filtered tasks")}
              aria-label={uiText("Export filtered tasks")}
              disabled={!tasks.length}
              onClick={() => setExporting(true)}
            >
              <Download size={17} />
            </IconButton>
            <Button
              className="button primary"
              disabled={readOnly}
              onClick={() => change({ task: "new" })}
            >
              <Plus size={16} />
              <I18nText id="New task" />
            </Button>
          </ActionRow>
          <ActionRow className="planning-filters" size="standard">
            <PlanningPropertyView
              spaceId={space.id}
              params={params}
              change={change}
              people={people.data ?? []}
            />
            <SearchField
              wrapperClassName="planning-search"
              aria-label={uiText("Find tasks")}
              placeholder={uiText("Find tasks or labels…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <NativeSelect
              aria-label={uiText("Filter task status")}
              value={params.get("status") ?? ""}
              onChange={(e) => change({ status: e.target.value || null })}
            >
              <option value="">
                <I18nText id="All statuses" />
              </option>
              {Object.entries(statusNames).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            <PersonPicker
              label={uiText("Filter assignee")}
              people={people.data ?? []}
              value={params.get("assignee") ?? ""}
              onChange={(v) => change({ assignee: v || null })}
            />
            <NativeSelect
              aria-label={uiText("Filter priority")}
              value={params.get("priority") ?? ""}
              onChange={(e) => change({ priority: e.target.value || null })}
            >
              <option value="">
                <I18nText id="All priorities" />
              </option>
              {["low", "normal", "high", "urgent"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </NativeSelect>
            <PlanningEntityPicker
              spaceId={space.id}
              kind="milestone"
              label={uiText("Filter milestone")}
              value={params.get("milestone") ?? ""}
              onChange={(v) => change({ milestone: String(v) || null })}
            />
            <NativeSelect
              aria-label={uiText("Filter planning risk")}
              value={params.get("risk") ?? ""}
              onChange={(e) => change({ risk: e.target.value || null })}
            >
              <option value="">
                <I18nText id="All risks" />
              </option>
              <option value="overdue">
                <I18nText id="Overdue" />
              </option>
              <option value="blocked">
                <I18nText id="Blocked" />
              </option>
              <option value="upcoming">
                <I18nText id="Upcoming · 7 days" />
              </option>
            </NativeSelect>
            <IconButton
              className={`icon-button ${deleted ? "active" : ""}`}
              aria-pressed={deleted}
              title={uiText("Deleted tasks")}
              aria-label={uiText("Deleted tasks")}
              onClick={() => change({ deleted: deleted ? null : "1" })}
            >
              <Trash2 size={16} />
            </IconButton>
            <span className="planning-count" role="status">
              {data.data
                ? `${data.data.total.toLocaleString(currentLocale())} tasks · ${data.data.completed} done`
                : uiText("Loading…")}
            </span>
          </ActionRow>
          <PlanningBulkActions
            spaceId={space.id}
            selected={[...selection.values()]}
            people={people.data ?? []}
            readOnly={readOnly}
            onClear={() => setSelection(new Map())}
            onSchedule={schedule}
          />
          {!online && (
            <p className="planning-notice">
              <I18nText id="Offline · You can keep a local task draft. Planning changes require a connection." />
            </p>
          )}
          {undo && (
            <div className="planning-notice">
              <I18nText id="Schedule updated." />
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
                <I18nText id="Undo" />
              </button>
              <IconButton
                className="icon-button"
                aria-label={uiText("Dismiss schedule receipt")}
                onClick={() => setUndo(null)}
              >
                <X size={14} />
              </IconButton>
            </div>
          )}
          <ErrorNotice
            message={data.error || people.error || action.error}
            retry={data.error ? data.reload : undefined}
          />
          {data.data?.nextOffset != null && (
            <p className="planning-notice">
              <I18nText id="Showing the first" />{" "}
              {tasks.length.toLocaleString(currentLocale())}{" "}
              <I18nText id="matching tasks. Refine filters to see the rest. Scheduling still validates the entire workspace dependency graph." />
            </p>
          )}
          {insights && data.data && (
            <PlanningInsights
              space={space}
              version={data.data.version}
              onClose={() => setInsights(false)}
              onLayers={updateLayers}
            />
          )}
          {data.loading && !data.data ? (
            <Loading />
          ) : (
            data.data && (
              <div className="planning-content">
                {!tasks.length && view !== "gantt" && view !== "workload" ? (
                  <Empty
                    title={
                      deleted
                        ? uiText("No deleted tasks")
                        : uiText("A clear plan starts here")
                    }
                  >
                    {deleted
                      ? uiText(
                          "Deleted tasks can be restored from their details.",
                        )
                      : uiText(
                          "Add a task, link research evidence, and plan your next milestone.",
                        )}
                  </Empty>
                ) : view === "gantt" ? (
                  <PlanningGantt
                    spaceId={space.id}
                    analysis={analysis}
                    baseline={baseline}
                    tasks={tasks}
                    milestones={milestones}
                    calendar={data.data.calendar}
                    readOnly={readOnly || deleted}
                    onOpen={(id) => change({ task: id })}
                    onSchedule={schedule}
                    selection={selection}
                    onSelect={selectTask}
                    grouping={params.get("grouping") ?? "parent"}
                    columns={
                      params.get("columns")?.split(",").filter(Boolean) ?? []
                    }
                    customFields={data.data.fields ?? []}
                    people={people.data ?? []}
                    showDependencies={params.get("dependencies") !== "0"}
                    showBaseline={params.get("baseline") !== "0"}
                    showCritical={params.get("critical") !== "0"}
                    onOptions={change}
                    onDependency={async (task, links) => {
                      await mutate(
                        `spaces/${space.id}/tasks/${task.id}`,
                        { version: task.version, dependencyLinks: links },
                        "PATCH",
                      );
                      refresh();
                      notify(
                        "Dependency saved. Dates have not moved; review any conflicts before rescheduling.",
                      );
                    }}
                    zoom={params.get("zoom") ?? "week"}
                    onZoom={(value) => change({ zoom: value })}
                    initialScroll={Number(
                      tabs?.active?.view?.planningScroll ?? 0,
                    )}
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
                  space.group_id ? (
                    <GroupCapacity groupId={space.group_id} />
                  ) : (
                    <TaskWorkload tasks={tasks} people={people.data ?? []} />
                  )
                ) : (
                  <TaskList
                    tasks={tasks}
                    fields={data.data.fields ?? []}
                    people={people.data ?? []}
                    onOpen={(id) => change({ task: id })}
                    onStatus={updateStatus}
                    readOnly={readOnly || deleted}
                    selection={selection}
                    onSelect={selectTask}
                    onSelectAll={() => {
                      if (tasks.length > 1000) {
                        notify(
                          "This view has more than 1,000 tasks. Refine filters before selecting all.",
                        );
                        return;
                      }
                      setSelection(
                        selection.size
                          ? new Map()
                          : new Map(tasks.map((t) => [t.id, t])),
                      );
                    }}
                  />
                )}
              </div>
            )
          )}
        </>
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
          title={uiText("Preview schedule changes")}
          subtitle={uiText(
            "Nothing changes until you apply. Working calendars affect proposals, never existing dates automatically.",
          )}
          onClose={() => !action.busy && setPreview(null)}
        >
          <div className="schedule-preview-summary">
            <strong>
              {preview.direct.length} <I18nText id="directly edited" />
            </strong>
            <span>
              {preview.proposed.length - preview.direct.length}{" "}
              <I18nText id="dependent tasks proposed" />
            </span>
            <span>
              {preview.conflicts.length} <I18nText id="dependency conflicts" />
            </span>
          </div>
          <div className="schedule-preview-table">
            <table>
              <thead>
                <tr>
                  <th>
                    <I18nText id="Task" />
                  </th>
                  <th>
                    <I18nText id="Current dates" />
                  </th>
                  <th>
                    <I18nText id="Proposed dates" />
                  </th>
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
          <ScheduleCapacityPreview capacity={preview.capacity} />
          {!!preview.conflicts.length && (
            <ScheduleCapacityPreview
              capacity={preview.capacity}
              mode="direct"
            />
          )}
          {!!preview.warnings.length && (
            <ul className="planning-warnings">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {!!preview.conflicts.length && (
            <HelpText>
              <I18nText id="Direct-only preserves dependent dates, including any conflicts. Proposed changes only push unfinished successors; completed work is never moved." />
            </HelpText>
          )}
          <ErrorNotice message={action.error} />
          <div className="dialog-footer">
            <Button
              data-dialog-cancel
              className="button secondary"
              disabled={action.busy}
              onClick={() => setPreview(null)}
            >
              <I18nText id="Cancel" />
            </Button>
            {!!preview.conflicts.length && (
              <Button
                className="button secondary"
                disabled={action.busy || readOnly}
                onClick={() => apply("direct")}
              >
                <I18nText id="Apply direct edits only" />
              </Button>
            )}
            <Button
              className="button primary"
              disabled={action.busy || readOnly}
              onClick={() => apply("proposed")}
            >
              <Check size={16} />
              <I18nText id="Apply" /> {preview.proposed.length}{" "}
              <I18nText id="changes" />
            </Button>
          </div>
        </Dialog>
      )}
      {exporting && (
        <Dialog
          title={uiText("Export planning view")}
          subtitle={`Export ${tasks.length.toLocaleString(currentLocale())} loaded, filtered tasks. Task descriptions and private drafts are not included.`}
          onClose={() => setExporting(false)}
        >
          <div className="planning-export-actions">
            <Button
              className="button secondary"
              onClick={() =>
                download(
                  `${space.name}-tasks.csv`,
                  planningCsv(tasks, {
                    fields: data.data?.fields,
                    people: people.data ?? [],
                    milestones,
                    baseline,
                    criticalIds: analysis?.tasks
                      .filter((t) => t.critical)
                      .map((t) => t.id),
                    scope: `${tasks.length} loaded filtered tasks; workspace milestones`,
                  }),
                )
              }
            >
              <Download size={16} />
              <I18nText id="Download CSV" />
            </Button>
            <Button
              className="button secondary"
              onClick={() =>
                download(
                  `${space.name}-timeline.svg`,
                  planningSvg(tasks, space.name, undefined, {
                    milestones,
                    baseline,
                    criticalIds: analysis?.tasks
                      .filter((t) => t.critical)
                      .map((t) => t.id),
                  }),
                  "image/svg+xml",
                )
              }
            >
              <ChartGantt size={16} />
              <I18nText id="Download SVG timeline" />
            </Button>
            <Button
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
                const figure = target.document.createElement("div");
                figure.innerHTML = planningSvg(tasks, space.name, undefined, {
                  milestones,
                  baseline,
                  criticalIds: analysis?.tasks
                    .filter((t) => t.critical)
                    .map((t) => t.id),
                });
                figure.style.cssText = "width:100%;break-inside:avoid";
                const svg = figure.querySelector("svg");
                if (svg) {
                  svg.style.width = "100%";
                  svg.style.height = "auto";
                }
                target.document.body.append(figure);
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
              <I18nText id="Print / Save PDF" />
            </Button>
          </div>
          <div className="dialog-footer">
            <Button
              className="button secondary"
              onClick={() => setExporting(false)}
            >
              <I18nText id="Done" />
            </Button>
          </div>
        </Dialog>
      )}
      {manage === "recurrences" ? (
        <PlanningRoutines
          space={space}
          readOnly={readOnly}
          onClose={() => setManage(null)}
        />
      ) : (
        manage && (
          <PlanningManager
            space={space}
            mode={manage}
            readOnly={readOnly}
            onClose={() => setManage(null)}
          />
        )
      )}
    </div>
  );
}

function TaskList({
  tasks,
  fields = [],
  people = [],
  onOpen,
  onStatus,
  readOnly,
  selection,
  onSelect,
  onSelectAll,
}: {
  tasks: PlanningTask[];
  fields?: TaskField[];
  people?: Person[];
  onOpen: (id: string) => void;
  onStatus: (task: PlanningTask, status: string) => void;
  readOnly: boolean;
  selection: Map<string, PlanningTask>;
  onSelect: (task: PlanningTask, range?: boolean) => void;
  onSelectAll: () => void;
}) {
  useInterfaceLocale();
  const [top, setTop] = useState(0),
    [height, setHeight] = useState(600),
    scroll = useRef<HTMLDivElement>(null),
    row = usePlanningRowSize(56),
    start = Math.max(0, Math.floor(top / row) - 6),
    visible = tasks.slice(start, start + Math.ceil(height / row) + 12);
  useEffect(() => {
    const node = scroll.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.clientHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const width = fields.length ? `${54 + fields.length * 12}em` : undefined,
    template = fields.length
      ? `42px minmax(15em,1fr) 9em 10em 12em repeat(${fields.length},12em)`
      : undefined;
  return (
    <div
      className="planning-list"
      role="table"
      aria-label={uiText("Tasks")}
      aria-rowcount={tasks.length + 1}
    >
      <div
        className="planning-list-head"
        role="row"
        style={{ minWidth: width, gridTemplateColumns: template }}
      >
        <span role="columnheader">
          <Checkbox
            aria-label={uiText("Select all visible tasks")}
            checked={!!tasks.length && tasks.every((t) => selection.has(t.id))}
            indeterminate={
              selection.size > 0 && !tasks.every((t) => selection.has(t.id))
            }
            onChange={onSelectAll}
          />
        </span>
        <span role="columnheader">
          <I18nText id="Task" />
        </span>
        <span role="columnheader">
          <I18nText id="Status" />
        </span>
        <span role="columnheader">
          <I18nText id="Assignee" />
        </span>
        <span role="columnheader">
          <I18nText id="Dates" />
        </span>
        {fields.map((f) => (
          <span role="columnheader" key={f.id}>
            {f.name}
          </span>
        ))}
      </div>
      <div
        className="planning-list-scroll"
        ref={scroll}
        onScroll={(e) => {
          setTop(e.currentTarget.scrollTop);
          const head =
            e.currentTarget.parentElement?.querySelector<HTMLElement>(
              ".planning-list-head",
            );
          if (head)
            head.style.transform = `translateX(${-e.currentTarget.scrollLeft}px)`;
        }}
      >
        <div
          style={{
            height: tasks.length * row,
            position: "relative",
            minWidth: width,
          }}
        >
          {visible.map((task, i) => (
            <div
              className="planning-task-row"
              key={task.id}
              role="row"
              aria-rowindex={start + i + 2}
              aria-selected={selection.has(task.id)}
              style={{
                top: (start + i) * row,
                height: row,
                gridTemplateColumns: template,
              }}
            >
              <span role="cell">
                <Checkbox
                  aria-label={`Select ${task.title}`}
                  checked={selection.has(task.id)}
                  onChange={() => {}}
                  onClick={(e) => onSelect(task, e.shiftKey)}
                />
              </span>
              <div role="cell">
                <button
                  className="planning-task-title"
                  onClick={() => onOpen(task.id)}
                >
                  <span className={`task-status-dot ${task.status}`} />
                  <span>
                    {task.parent_id && <small>↳ </small>}
                    {task.title}
                    {task.blocked && (
                      <small>
                        {" "}
                        <I18nText id="· Blocked" />
                      </small>
                    )}
                  </span>
                </button>
                <small>{task.labels.join(" · ")}</small>
              </div>
              <div role="cell">
                <NativeSelect
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
                </NativeSelect>
              </div>
              <span role="cell">{task.assignee_name ?? "Unassigned"}</span>
              <button role="cell" onClick={() => onOpen(task.id)}>
                {task.start_on ?? "—"} → {task.due_on ?? "—"}
              </button>
              {fields.map((f) => (
                <span
                  role="cell"
                  className="planning-property-cell"
                  key={f.id}
                  title={fieldSummaryText(f, task.field_summaries, people)}
                >
                  {fieldSummaryText(f, task.field_summaries, people)}
                </span>
              ))}
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
                {task.blocked && (
                  <small>
                    <I18nText id="Waiting for dependencies" />
                  </small>
                )}
              </button>
            ))}
            {group.length > limit && (
              <button
                className="text-button"
                onClick={() => setMore({ ...more, [status]: limit + 60 })}
              >
                <I18nText id="Show more (" />
                {group.length - limit})
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
  useInterfaceLocale();
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
          <I18nText id="Due dates" />{" "}
          <TextInput
            aria-label={uiText("Calendar month")}
            type="month"
            value={month}
            onChange={(e) => {
              if (/^\d{4}-\d{2}$/.test(e.target.value))
                setMonth(e.target.value);
            }}
          />
        </label>
        <small>
          <I18nText id="Dates are shown in the workspace calendar ·" />{" "}
          {calendar.timezone}
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
                  <summary>
                    {items.length - 8} <I18nText id="more" />
                  </summary>
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
      <h3>
        <I18nText id="Open work in this view" />
      </h3>
      <HelpText>
        <I18nText id="Estimates show total remaining task effort, not weekly utilization. Unestimated work is reported separately." />
      </HelpText>
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
            <span>
              {assigned.length} <I18nText id="tasks" />
            </span>
            <span>
              {hours} <I18nText id="h estimated" />
            </span>
            <span>
              {assigned.filter((t) => t.estimate_hours == null).length}{" "}
              <I18nText id="unestimated" />
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
    dependencyLinks: task ? taskDependencyLinks(task) : [],
    progressPercent: task?.progress_percent ?? 0,
    version: task?.version,
    fieldsVersion: task?.fields_version,
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
  useInterfaceLocale();
  const { revision } = useWorkspace(),
    detail = useData<PlanningTask>(
      props.id !== "new" ? `spaces/${props.space.id}/tasks/${props.id}` : null,
      revision,
    );
  return (
    <aside
      className="planning-inspector"
      aria-label={
        props.id === "new" ? uiText("New task") : uiText("Task details")
      }
    >
      <div
        className="planning-inspector-resize"
        role="separator"
        aria-label={uiText("Resize task inspector")}
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
            <h2>
              <I18nText id="Task details" />
            </h2>
            <IconButton
              className="icon-button"
              aria-label={uiText("Close task details")}
              onClick={props.onClose}
            >
              <X size={18} />
            </IconButton>
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
  useInterfaceLocale();
  const { session, refresh, notify } = useWorkspace(),
    action = useAction(),
    key = `axiom:task-draft:${session.user.id}:${space.id}:${id}`,
    baseline = useRef(taskDraft(task));
  const [recovered, setRecovered] = useState(false),
    [storageError, setStorageError] = useState(""),
    [panel, setPanel] = useState<"properties" | "time">("properties"),
    [fieldsValid, setFieldsValid] = useState(true);
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      const result =
        saved &&
        planningDraftSchema.safeParse({
          ...baseline.current,
          ...saved,
          dependencyLinks: resolveDependencyLinks(
            saved,
            baseline.current.dependencyLinks ?? [],
          ),
        });
      if (result?.success) return result.data;
    } catch {}
    return baseline.current;
  });
  const [schedule, setSchedule] = useState(false),
    [start, setStart] = useState(task?.start_on ?? ""),
    [end, setEnd] = useState(task?.due_on ?? ""),
    [labelsText, setLabelsText] = useState(draft.labels.join(", ")),
    [invalidOffsets, setInvalidOffsets] = useState(new Set<string>());
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
  const taskNames = new Map(tasks.map((t) => [t.id, t.title]));
  const hasChildren =
    task?.has_children ?? tasks.some((t) => t.parent_id === id);
  const removed = !!task?.deleted_at;
  return (
    <>
      <header>
        <div>
          <small>{space.name}</small>
          <h2>{task ? uiText("Task details") : uiText("New task")}</h2>
        </div>
        {task && (
          <Button
            className="button ghost"
            onClick={() =>
              openAssistant({
                spaceId: space.id,
                selection: { kind: "task", id: task.id, editable: false },
              })
            }
          >
            <I18nText id="Ask assistant" />
          </Button>
        )}
        <IconButton
          className="icon-button"
          aria-label={uiText("Close task details")}
          onClick={onClose}
        >
          <X size={18} />
        </IconButton>
      </header>
      {task && (
        <nav
          className="planning-section-tabs"
          aria-label={uiText("Task panels")}
        >
          <button
            aria-pressed={panel === "properties"}
            onClick={() => setPanel("properties")}
          >
            <I18nText id="Properties" />
          </button>
          <button
            aria-pressed={panel === "time"}
            onClick={() => setPanel("time")}
          >
            <I18nText id="Time" />
          </button>
        </nav>
      )}
      <div
        className="planning-inspector-body"
        style={{ display: panel === "time" ? "none" : undefined }}
      >
        {(recovered || storageError) && (
          <p className="planning-notice">
            {storageError ||
              "Recovered a local draft. Your saved version has not been overwritten."}
          </p>
        )}
        {task && draft.version !== task.version && (
          <p className="planning-notice">
            <I18nText id="This task changed since this draft began. Copy your work, close the inspector, then reopen to compare. Saving will not overwrite a newer version." />
          </p>
        )}
        <ErrorNotice message={action.error} />
        <fieldset disabled={readOnly || removed || action.busy}>
          <label>
            <I18nText id="Title" />
            <TextInput
              autoFocus
              maxLength={300}
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder={uiText("What needs to happen?")}
            />
          </label>
          <div className="planning-field-grid">
            <label>
              <I18nText id="Status" />
              <NativeSelect
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
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Priority" />
              <NativeSelect
                value={draft.priority}
                onChange={(e) =>
                  set({ priority: e.target.value as Draft["priority"] })
                }
              >
                {["low", "normal", "high", "urgent"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Assignee" />
              <PersonPicker
                label={uiText("Task assignee")}
                people={people}
                value={draft.assigneeId ?? ""}
                onChange={(value) => set({ assigneeId: value || null })}
              />
            </label>
            <label>
              <I18nText id="Progress (%)" />
              <TextInput
                type="number"
                min={0}
                max={100}
                step={1}
                value={
                  hasChildren
                    ? (task?.derived_progress_percent ??
                      planningProgress(tasks).get(id) ??
                      0)
                    : draft.status === "done"
                      ? 100
                      : draft.progressPercent
                }
                disabled={draft.status === "done" || hasChildren}
                onChange={(e) =>
                  set({
                    progressPercent: Math.max(
                      0,
                      Math.min(100, Number(e.target.value)),
                    ),
                  })
                }
              />
              {hasChildren && (
                <HelpText>
                  <I18nText id="Derived from non-cancelled descendant leaves. Parent dates remain independent." />
                </HelpText>
              )}
            </label>
            <label>
              <I18nText id="Effort (hours)" />
              <TextInput
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
          <TaskCustomFields
            spaceId={space.id}
            values={task?.custom_fields ?? {}}
            patch={draft.customFields ?? {}}
            people={people}
            onValidity={setFieldsValid}
            onChange={(customFields, version) =>
              set({
                customFields,
                fieldsVersion: draft.fieldsVersion ?? version,
              })
            }
          />
          <PlanningMarkdown
            key={`${id}:${baseline.current.version ?? "new"}`}
            initial={draft.body}
            onChange={(body) => set({ body })}
            readOnly={readOnly || removed || action.busy}
          />
          <label>
            <I18nText id="Labels (comma separated)" />
            <TextInput
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
            <I18nText id="Milestone" />
            <PlanningEntityPicker
              spaceId={space.id}
              kind="milestone"
              label={uiText("Task milestone")}
              value={draft.milestoneId ?? ""}
              onChange={(v) => set({ milestoneId: String(v) || null })}
            />
          </label>
          <details>
            <summary>
              <I18nText id="Subtasks & dependencies" />
            </summary>
            <label>
              <I18nText id="Parent task" />
              <PlanningEntityPicker
                spaceId={space.id}
                kind="task"
                label={uiText("Parent task")}
                exclude={[id]}
                value={draft.parentId ?? ""}
                onChange={(v) => set({ parentId: String(v) || null })}
              />
            </label>
            <label>
              <I18nText id="Finish-to-start dependencies" />
              <PlanningEntityPicker
                spaceId={space.id}
                kind="task"
                label={uiText("Predecessor tasks")}
                multiple
                exclude={[id]}
                value={draft.dependencies}
                onChange={(v) => {
                  const ids = v as string[];
                  set({
                    dependencies: ids,
                    dependencyLinks: resolveDependencyLinks(
                      { dependencies: ids },
                      draft.dependencyLinks ?? [],
                    ),
                  });
                }}
              />
            </label>
            {draft.dependencyLinks?.map((link, i) => (
              <label key={link.taskId} className="planning-lag-field">
                {taskNames.get(link.taskId) ?? `Predecessor ${i + 1}`}{" "}
                <I18nText id="· offset (working days)" />
                <PlanningIntegerInput
                  label={`Working-day offset for predecessor ${i + 1}`}
                  min={-365}
                  max={365}
                  value={link.lagDays}
                  onValidity={(valid) =>
                    setInvalidOffsets((previous) => {
                      if (valid === !previous.has(link.taskId)) return previous;
                      const next = new Set(previous);
                      if (valid) next.delete(link.taskId);
                      else next.add(link.taskId);
                      return next;
                    })
                  }
                  onCommit={(lagDays) =>
                    set({
                      dependencyLinks: draft.dependencyLinks?.map((d) =>
                        d.taskId === link.taskId ? { ...d, lagDays } : d,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <HelpText>
              <I18nText id="Zero starts on the next working day after finish; positive offsets delay and negative offsets overlap. Saving a link never moves dates. Cycles and cross-workspace links are rejected." />
            </HelpText>
          </details>
          <details>
            <summary>
              <I18nText id="Linked research evidence (" />
              {draft.resourceIds.length})
            </summary>
            <PlanningEntityPicker
              spaceId={space.id}
              kind="file"
              label={uiText("Linked workspace files")}
              multiple
              value={draft.resourceIds}
              onChange={(v) => set({ resourceIds: v as string[] })}
            />
            <div className="planning-evidence">
              {draft.resourceIds.map((resourceId, i) => (
                <WorkspaceLink key={resourceId} to={`/notes/${resourceId}`}>
                  <I18nText id="Open evidence" /> {i + 1} ↗
                </WorkspaceLink>
              ))}
            </div>
          </details>
          {task && <TaskPaperLinks taskId={task.id} readOnly={readOnly} />}
          {task && <TaskResearchLinks taskId={task.id} readOnly={readOnly} />}
          {!task && (
            <div className="planning-field-grid">
              <label>
                <I18nText id="Start" />
                <TextInput
                  type="date"
                  value={draft.startOn ?? ""}
                  onChange={(e) => set({ startOn: e.target.value || null })}
                />
              </label>
              <label>
                <I18nText id="Finish" />
                <TextInput
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
            <h3>
              <I18nText id="Schedule" />
            </h3>
            <p>
              {task.start_on ?? "No start date"} →{" "}
              {task.due_on ?? "No finish date"}
            </p>
            <Button
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
              <I18nText id="Reschedule…" />
            </Button>
            {dirty && (
              <small>
                <I18nText id="Save task details before previewing date changes." />
              </small>
            )}
          </section>
        )}
        {task && !removed && (
          <WorkspaceDiscussion space={space} taskId={id} compact />
        )}
        {task && (
          <small>
            <I18nText id="Updated" /> {timeAgo(task.updated_at)}{" "}
            <I18nText id="· revision" /> {task.version}
          </small>
        )}
      </div>
      {task && panel === "time" && (
        <div className="planning-inspector-time">
          <PlanningTime
            space={space}
            people={people}
            readOnly={readOnly}
            taskDeleted={removed}
            taskId={id}
          />
        </div>
      )}
      <footer style={{ display: panel === "time" ? "none" : undefined }}>
        <span className="planning-draft-state">
          {dirty ? uiText("Local draft · not yet shared") : uiText("Saved")}
        </span>
        {task && (
          <IconButton
            className="icon-button"
            title={removed ? uiText("Restore task") : uiText("Delete task")}
            aria-label={
              removed ? uiText("Restore task") : uiText("Delete task")
            }
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
          </IconButton>
        )}
        <Button
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
          <I18nText id="Discard draft" />
        </Button>
        <Button
          className="button primary"
          disabled={
            readOnly ||
            removed ||
            action.busy ||
            invalidOffsets.size > 0 ||
            !fieldsValid ||
            !draft.title.trim() ||
            (!!task && !dirty)
          }
          onClick={save}
        >
          <I18nText id="Save task" />
        </Button>
      </footer>
      {schedule && task && (
        <Dialog
          title={uiText("Reschedule task")}
          subtitle={task.title}
          onClose={() => setSchedule(false)}
        >
          <div className="planning-field-grid">
            <label>
              <I18nText id="Start date" />
              <TextInput
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              <I18nText id="Finish date" />
              <TextInput
                type="date"
                min={start || undefined}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <div className="dialog-footer">
            <Button
              data-dialog-cancel
              className="button secondary"
              onClick={() => setSchedule(false)}
            >
              <I18nText id="Cancel" />
            </Button>
            <Button
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
              <I18nText id="Preview changes" />
            </Button>
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
  useInterfaceLocale();
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
        title={uiText("Unsent discussion comment")}
      />
      <h3>
        {compact ? uiText("Task discussion") : uiText("Workspace discussions")}
      </h3>
      <HelpText>
        <I18nText id="Keep decisions and research context alongside the work." />
      </HelpText>
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
          {reply ? uiText("Reply to discussion") : uiText("Add a comment")}
          <TextArea
            rows={compact ? 3 : 4}
            value={body}
            maxLength={100000}
            onChange={(e) => setBody(e.target.value)}
            placeholder={uiText("Share a decision, observation, or question…")}
          />
        </label>
        <ActionRow>
          {reply && (
            <Button
              data-dialog-cancel
              type="button"
              className="text-button"
              onClick={() => setReply(null)}
            >
              <I18nText id="Cancel reply" />
            </Button>
          )}
          <Button
            className="button primary"
            disabled={
              action.busy ||
              !online ||
              !body.trim() ||
              space.role === "viewer" ||
              space.effective_status !== "active"
            }
          >
            <I18nText id="Post comment" />
          </Button>
        </ActionRow>
      </form>
      {data.data?.map((post) => (
        <article key={post.id} className={post.parent_id ? "reply" : ""}>
          <header>
            <strong>{post.author_name}</strong>
            <small>
              {timeAgo(post.created_at)}
              {post.parent_id ? uiText(" · reply") : ""}
            </small>
          </header>
          <p>{post.body}</p>
          <button className="text-button" onClick={() => setReply(post.id)}>
            <I18nText id="Reply" />
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
  useInterfaceLocale();
  const { revision, refresh } = useWorkspace(),
    data = useData<any[]>(`spaces/${space.id}/${mode}`, revision),
    action = useAction();
  const [title, setTitle] = useState(""),
    [date, setDate] = useState(""),
    [frequency, setFrequency] = useState("weekly");
  return (
    <Dialog
      title={
        mode === "milestones"
          ? uiText("Workspace milestones")
          : uiText("Recurring tasks")
      }
      subtitle={
        mode === "milestones"
          ? uiText("Review points shared by every planning view.")
          : uiText(
              "Create recurring research routines. Instances are generated in the workspace time zone.",
            )
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
            <Button
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
            </Button>
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
          {mode === "milestones"
            ? uiText("Milestone title")
            : uiText("Recurring task title")}
          <TextInput
            required
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="planning-field-grid">
          <label>
            {mode === "milestones"
              ? uiText("Target date")
              : uiText("First occurrence")}
            <TextInput
              type="date"
              required={mode === "recurrences"}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {mode === "recurrences" && (
            <label>
              <I18nText id="Repeat" />
              <NativeSelect
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                {["daily", "weekly", "monthly"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </NativeSelect>
            </label>
          )}
        </div>
        <Button
          className="button primary"
          disabled={readOnly || action.busy || !title.trim()}
        >
          <I18nText id="Create" />{" "}
          {mode === "milestones" ? uiText("milestone") : uiText("routine")}
        </Button>
      </form>
      <div className="dialog-footer">
        <Button className="button secondary" onClick={onClose}>
          <I18nText id="Done" />
        </Button>
      </div>
    </Dialog>
  );
}
