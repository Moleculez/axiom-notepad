"use client";
import { currentLocale } from "@axiom/i18n/client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Diamond,
  Focus,
  Link2,
  Settings2,
} from "lucide-react";
import type { PlanningAnalysis } from "@axiom/shared/planning-analysis";
import { fieldSummaryText, type TaskField } from "@axiom/shared/planning-lab";
import {
  addDays,
  dayNumber,
  dateFromDay,
  dependencyStart,
  planningProgress,
  taskDependencyLinks,
  workingDay,
  type DependencyLink,
  type PlanningCalendar,
  type PlanningTask,
  type ScheduleChange,
} from "@axiom/shared/planning";
import {
  ActionRow,
  Button,
  Checkbox,
  Field,
  HelpText,
  IconButton,
  NativeSelect,
  Switch,
} from "../ui/controls";
import Dialog from "../Dialog";
import {
  PlanningEntityPicker,
  PlanningIntegerInput,
  usePlanningRowSize,
} from "./PlanningFields";
import { ErrorNotice, useAction } from "./ui";
import { api } from "../../lib/client";
export type Milestone = {
  id: string;
  title: string;
  due_on: string | null;
  completed_at: string | null;
  version: number;
};
type Row = {
  task?: PlanningTask;
  milestone?: Milestone;
  depth: number;
  group?: { id: string; title: string; tasks: PlanningTask[] };
};
export function orderedPlanningRows(
  tasks: PlanningTask[],
  collapsed: Set<string>,
): Row[] {
  const ids = new Set(tasks.map((t) => t.id)),
    children = new Map<string, PlanningTask[]>();
  for (const task of tasks) {
    const parent =
      task.parent_id && ids.has(task.parent_id) ? task.parent_id : "";
    const list = children.get(parent) ?? [];
    list.push(task);
    children.set(parent, list);
  }
  const stack = [...(children.get("") ?? [])]
      .reverse()
      .map((task) => ({ task, depth: 0 })),
    rows: Row[] = [],
    seen = new Set<string>();
  while (stack.length) {
    const row = stack.pop()!;
    if (seen.has(row.task.id)) continue;
    seen.add(row.task.id);
    rows.push(row);
    if (!collapsed.has(row.task.id))
      for (const task of [...(children.get(row.task.id) ?? [])].reverse())
        stack.push({ task, depth: row.depth + 1 });
  }
  return rows;
}
const columnLabels: Record<string, string> = {
  assignee: "Assignee",
  status: "Status",
  priority: "Priority",
  start: "Start",
  due: "Finish",
  progress: "Progress",
};
const scales: Record<string, number> = {
  day: 32,
  week: 14,
  month: 5,
  quarter: 2,
  year: 0.9,
};
type Drag = {
  id: string;
  mode: "move" | "start" | "end";
  x: number;
  delta: number;
};
type LinkDraft = {
  predecessor: string;
  successor: string;
  lag: number;
  existing?: boolean;
};
/** Shared virtual geometry; one scrollport owns table, timeline and all overlays. */
export default function PlanningGantt({
  spaceId = "",
  tasks,
  milestones,
  calendar,
  readOnly,
  onOpen,
  onSchedule,
  zoom,
  onZoom,
  initialScroll = 0,
  onScrollPosition,
  analysis,
  baseline = [],
  selection = new Map(),
  onSelect = () => {},
  grouping = "parent",
  columns = [],
  customFields = [],
  people = [],
  showDependencies = true,
  showBaseline = true,
  showCritical = true,
  onOptions = () => {},
  onDependency = async () => {},
}: {
  spaceId?: string;
  tasks: PlanningTask[];
  customFields?: TaskField[];
  people?: Array<{ id: string; name: string }>;
  milestones: Milestone[];
  calendar: PlanningCalendar;
  readOnly: boolean;
  onOpen: (id: string) => void;
  onSchedule: (changes: ScheduleChange[]) => void;
  zoom: string;
  onZoom: (value: string) => void;
  initialScroll?: number;
  onScrollPosition?: (value: number) => void;
  analysis?: PlanningAnalysis | null;
  baseline?: PlanningTask[];
  selection?: Map<string, PlanningTask>;
  onSelect?: (task: PlanningTask, range?: boolean) => void;
  grouping?: string;
  columns?: string[];
  showDependencies?: boolean;
  showBaseline?: boolean;
  showCritical?: boolean;
  onOptions?: (options: Record<string, string | null>) => void;
  onDependency?: (task: PlanningTask, links: DependencyLink[]) => Promise<void>;
}) {
  useInterfaceLocale();
  const rowHeight = usePlanningRowSize(52),
    headerHeight = usePlanningRowSize(72),
    root = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({
      top: initialScroll,
      left: 0,
      height: 600,
      width: 1000,
    }),
    [collapsed, setCollapsed] = useState(new Set<string>()),
    [tableWidth, setTableWidth] = useState(300),
    [fit, setFit] = useState<number | null>(null),
    [drag, setDrag] = useState<Drag | null>(null),
    [link, setLink] = useState<LinkDraft | null>(null),
    [linkSource, setLinkSource] = useState<string | null>(null),
    [validOffset, setValidOffset] = useState(true),
    [settings, setSettings] = useState(false);
  const dragRef = useRef<Drag | null>(null),
    moved = useRef(false),
    linkDropFinished = useRef(false),
    frame = useRef(0),
    pending = useRef(0),
    anchor = useRef<number | null>(null),
    action = useAction();
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: calendar.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const maps = useMemo(
    () => ({
      byId: new Map(tasks.map((t) => [t.id, t])),
      parents: new Set(
        tasks.flatMap((t) => (t.parent_id ? [t.parent_id] : [])),
      ),
      baseline: new Map(baseline.map((t) => [t.id, t])),
      analysis: new Map(analysis?.tasks.map((t) => [t.id, t]) ?? []),
      progress: planningProgress(tasks),
      milestones: new Map(milestones.map((m) => [m.id, m.title])),
    }),
    [tasks, baseline, analysis, milestones],
  );
  const rows = useMemo<Row[]>(() => {
    if (grouping === "parent")
      return [
        ...orderedPlanningRows(tasks, collapsed),
        ...milestones.map((milestone) => ({ milestone, depth: 0 })),
      ];
    const groups = new Map<
      string,
      { id: string; title: string; tasks: PlanningTask[] }
    >();
    for (const task of tasks) {
      const key =
          grouping === "assignee"
            ? (task.assignee_id ?? "none")
            : (task.milestone_id ?? "none"),
        id = `${grouping}:${key}`;
      let g = groups.get(id);
      if (!g) {
        g = {
          id,
          title:
            grouping === "assignee"
              ? (task.assignee_name ?? "Unassigned")
              : (maps.milestones.get(key) ?? "No milestone"),
          tasks: [],
        };
        groups.set(id, g);
      }
      g.tasks.push(task);
    }
    return [...groups.values()]
      .sort((a, b) => a.title.localeCompare(b.title))
      .flatMap((group) => [
        { group, depth: 0 },
        ...(collapsed.has(group.id)
          ? []
          : group.tasks.map((task) => ({ task, depth: 1 }))),
      ]) as Row[];
  }, [tasks, milestones, collapsed, grouping, maps]);
  let low = Infinity,
    high = -Infinity;
  for (const t of [...tasks, ...(showBaseline ? baseline : [])])
    for (const d of [t.start_on, t.due_on])
      if (d) {
        low = Math.min(low, dayNumber(d));
        high = Math.max(high, dayNumber(d));
      }
  for (const m of milestones)
    if (m.due_on) {
      low = Math.min(low, dayNumber(m.due_on));
      high = Math.max(high, dayNumber(m.due_on));
    }
  const first = (Number.isFinite(low) ? low : dayNumber(today)) - 7,
    last = Math.max(
      first + 60,
      first + ({ quarter: 360, year: 1080, month: 180, week: 90 }[zoom] ?? 60),
      (Number.isFinite(high) ? high : first + 30) + 21,
    ),
    dayWidth = fit ?? scales[zoom] ?? 14,
    labelWidth = tableWidth + (columns.length + customFields.length) * 110,
    timelineWidth = (last - first + 1) * dayWidth;
  const start = Math.max(
      0,
      Math.floor((scroll.top - headerHeight) / rowHeight) - 8,
    ),
    end = Math.min(
      rows.length,
      start + Math.ceil(scroll.height / rowHeight) + 18,
    ),
    visible = rows.slice(start, end),
    index = useMemo(
      () =>
        new Map(
          rows.flatMap((r, i) => (r.task ? [[r.task.id, i] as const] : [])),
        ),
      [rows],
    );
  const firstDay = Math.max(0, Math.floor(scroll.left / dayWidth) - 2),
    lastDay = Math.min(
      last - first + 1,
      firstDay +
        Math.ceil(Math.max(0, scroll.width - labelWidth) / dayWidth) +
        6,
    ),
    x = (date: string) => (dayNumber(date) - first) * dayWidth;
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    node.scrollTop = initialScroll;
    const update = () =>
      setScroll((s) => ({
        ...s,
        width: node.clientWidth,
        height: node.clientHeight,
      }));
    update();
    const resize = new ResizeObserver(update);
    resize.observe(node);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    if (anchor.current !== null && root.current) {
      root.current.scrollLeft = Math.max(
        0,
        (anchor.current - first) * dayWidth - (scroll.width - labelWidth) / 2,
      );
      anchor.current = null;
    }
  }, [dayWidth, first]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    if (!linkSource) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLinkSource(null);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [linkSource]);
  function scale(value: string) {
    anchor.current =
      first + (scroll.left + (scroll.width - labelWidth) / 2) / dayWidth;
    setFit(null);
    onZoom(value);
  }
  function collapse(id: string) {
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function begin(
    event: React.PointerEvent,
    task: PlanningTask,
    mode: Drag["mode"],
  ) {
    if (
      readOnly ||
      !task.start_on ||
      !task.due_on ||
      ["done", "cancelled"].includes(task.status) ||
      event.button !== 0
    )
      return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    moved.current = false;
    const d = { id: task.id, mode, x: event.clientX, delta: 0 };
    dragRef.current = d;
    setDrag(d);
  }
  function pointerMove(event: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    pending.current = event.clientX - d.x;
    if (Math.abs(pending.current) > 3) moved.current = true;
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (dragRef.current) {
          dragRef.current = { ...dragRef.current, delta: pending.current };
          setDrag(dragRef.current);
        }
      });
  }
  function changesFor(task: PlanningTask, mode: Drag["mode"], amount: number) {
    const targets =
      mode === "move" && selection.has(task.id)
        ? [...selection.values()].filter(
            (t) =>
              t.start_on &&
              t.due_on &&
              !t.deleted_at &&
              !["done", "cancelled"].includes(t.status),
          )
        : [task];
    return targets.map((t) => {
      let startOn = mode === "end" ? t.start_on! : addDays(t.start_on!, amount),
        dueOn = mode === "start" ? t.due_on! : addDays(t.due_on!, amount);
      if (startOn > dueOn) {
        if (mode === "start") startOn = dueOn;
        else dueOn = startOn;
      }
      return { id: t.id, version: t.version, startOn, dueOn };
    });
  }
  function finish(event: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    dragRef.current = null;
    setDrag(null);
    const amount = Math.round((event.clientX - d.x) / dayWidth),
      task = maps.byId.get(d.id);
    if (task && amount) {
      moved.current = true;
      onSchedule(changesFor(task, d.mode, amount));
    }
  }
  function keyboardMove(
    event: React.KeyboardEvent,
    task: PlanningTask,
    mode: Drag["mode"],
  ) {
    if (
      readOnly ||
      !task.start_on ||
      !task.due_on ||
      ["done", "cancelled"].includes(task.status) ||
      !["ArrowLeft", "ArrowRight"].includes(event.key) ||
      !event.altKey
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    onSchedule(changesFor(task, mode, event.key === "ArrowLeft" ? -1 : 1));
  }
  const edges = showDependencies
    ? visible.flatMap((row) =>
        row.task
          ? taskDependencyLinks(row.task).flatMap((dep) => {
              const predecessor = maps.byId.get(dep.taskId),
                from = index.get(dep.taskId),
                to = index.get(row.task!.id);
              if (
                !predecessor?.due_on ||
                !row.task!.start_on ||
                from === undefined ||
                to === undefined
              )
                return [];
              const a = x(predecessor.due_on) + dayWidth,
                b = x(row.task!.start_on),
                y1 = from * rowHeight + rowHeight / 2,
                y2 = to * rowHeight + rowHeight / 2;
              return [
                {
                  key: dep.taskId + row.task!.id,
                  path: `M ${a} ${y1} H ${a + 10} V ${y2 - rowHeight * 0.3} H ${b - 10} V ${y2} H ${b}`,
                  invalid:
                    row.task!.start_on <
                    dependencyStart(predecessor.due_on, dep.lagDays, calendar),
                  a,
                  b,
                  y: y2 - rowHeight * 0.3,
                  source: dep.taskId,
                  target: row.task!.id,
                  lag: dep.lagDays,
                },
              ];
            })
          : [],
      )
    : [];
  const dates = Array.from(
    { length: Math.max(0, lastDay - firstDay) },
    (_, i) => first + firstDay + i,
  );
  const headerGroups: Array<{ label: string; left: number; width: number }> =
    [];
  for (const day of dates) {
    const date = dateFromDay(day),
      label =
        zoom === "year"
          ? date.slice(0, 4)
          : zoom === "quarter"
            ? `${date.slice(0, 4)} · Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`
            : date.slice(0, 7),
      left = (day - first) * dayWidth,
      previous = headerGroups.at(-1);
    if (previous?.label === label) previous.width += dayWidth;
    else headerGroups.push({ label, left, width: dayWidth });
  }
  return (
    <section className="planning-gantt" aria-label={uiText("Gantt schedule")}>
      <ActionRow className="planning-gantt-controls" size="standard">
        <NativeSelect
          aria-label={uiText("Timeline scale")}
          value={fit ? "fit" : zoom}
          onChange={(e) => scale(e.target.value)}
        >
          {fit && (
            <option value="fit">
              <I18nText id="Fit" />
            </option>
          )}
          {Object.keys(scales).map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </NativeSelect>
        <Button
          variant="ghost"
          onClick={() =>
            root.current?.scrollTo({
              left: Math.max(0, x(today) - (scroll.width - labelWidth) / 2),
              behavior: "smooth",
            })
          }
        >
          <CalendarDays size={15} />
          <I18nText id="Today" />
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setFit(
              Math.max(
                0.1,
                Math.min(
                  32,
                  (scroll.width - labelWidth - 24) / (last - first + 1),
                ),
              ),
            );
            root.current?.scrollTo({ left: 0 });
          }}
        >
          <Focus size={15} />
          <I18nText id="Fit" />
        </Button>
        <span className="planning-spacer" />
        <Button
          variant="ghost"
          disabled={readOnly}
          onClick={() => setLink({ predecessor: "", successor: "", lag: 0 })}
        >
          <Link2 size={15} />
          <I18nText id="Link tasks" />
        </Button>
        <IconButton
          label={uiText("Timeline columns and layers")}
          onClick={() => setSettings(true)}
        >
          <Settings2 size={16} />
        </IconButton>
      </ActionRow>
      <HelpText className="planning-gantt-help">
        <I18nText id="Drag bars to review schedule changes; Alt + ←/→ moves a day. Drag a finish connector to another task’s start, or use Link tasks. Shift-select rows for a range." />
        {linkSource
          ? uiText(" Choose a successor start connector · Escape cancels.")
          : ""}
      </HelpText>
      <div
        className="gantt-scroll"
        ref={root}
        onScroll={(e) => {
          const node = e.currentTarget;
          setScroll({
            top: node.scrollTop,
            left: node.scrollLeft,
            height: node.clientHeight,
            width: node.clientWidth,
          });
          onScrollPosition?.(node.scrollTop);
        }}
        onPointerMove={pointerMove}
        onPointerUp={finish}
        onPointerCancel={() => {
          dragRef.current = null;
          setDrag(null);
        }}
      >
        <div
          className="gantt-canvas"
          style={{
            width: labelWidth + timelineWidth,
            height: headerHeight + rows.length * rowHeight,
            minHeight: "100%",
          }}
        >
          <div className="gantt-header" style={{ height: headerHeight }}>
            <div
              className="gantt-label-header"
              style={{ width: labelWidth, height: headerHeight }}
            >
              <strong style={{ width: tableWidth }}>
                <I18nText id="Tasks ·" />{" "}
                {tasks.length.toLocaleString(currentLocale())}
              </strong>
              {columns.map((c) => (
                <span key={c}>{columnLabels[c]}</span>
              ))}
              {customFields.map((f) => (
                <span key={f.id} title={f.name}>
                  {f.name}
                </span>
              ))}
              <div
                className="gantt-column-resizer"
                role="separator"
                aria-label={uiText("Task column width")}
                aria-orientation="vertical"
                aria-valuemin={220}
                aria-valuemax={560}
                aria-valuenow={tableWidth}
                tabIndex={0}
                style={{ left: tableWidth - 4 }}
                onKeyDown={(e) => {
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                  ) {
                    e.preventDefault();
                    setTableWidth((w) =>
                      e.key === "Home"
                        ? 220
                        : e.key === "End"
                          ? 560
                          : Math.max(
                              220,
                              Math.min(
                                560,
                                w + (e.key === "ArrowRight" ? 10 : -10),
                              ),
                            ),
                    );
                  }
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  e.currentTarget.dataset.start = String(e.clientX);
                  e.currentTarget.dataset.width = String(tableWidth);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    setTableWidth(
                      Math.max(
                        220,
                        Math.min(
                          560,
                          Number(e.currentTarget.dataset.width) +
                            e.clientX -
                            Number(e.currentTarget.dataset.start),
                        ),
                      ),
                    );
                }}
                onPointerUp={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }}
              />
            </div>
            <div
              className="gantt-date-headers"
              style={{ left: labelWidth, width: timelineWidth }}
            >
              {headerGroups.map((g) => (
                <span
                  key={g.label}
                  className="gantt-date-major"
                  style={{ left: g.left, width: g.width }}
                >
                  {g.label}
                </span>
              ))}
              {dates
                .filter(
                  (day) =>
                    dayWidth >= 18 ||
                    (zoom === "week" &&
                      new Date(day * 86400000).getUTCDay() === 1) ||
                    (zoom === "month" &&
                      new Date(day * 86400000).getUTCDay() === 1) ||
                    (["quarter", "year"].includes(zoom) &&
                      dateFromDay(day).endsWith("-01")) ||
                    (fit && dateFromDay(day).endsWith("-01")),
                )
                .map((day) => (
                  <span
                    key={day}
                    className="gantt-date-minor"
                    style={{
                      left: (day - first) * dayWidth,
                      width: Math.max(
                        dayWidth,
                        dayWidth * (dayWidth < 5 ? 28 : 7),
                      ),
                    }}
                  >
                    {dayWidth >= 18
                      ? dateFromDay(day).slice(8)
                      : ["quarter", "year"].includes(zoom) || fit
                        ? dateFromDay(day).slice(5, 7)
                        : dateFromDay(day).slice(5)}
                  </span>
                ))}
            </div>
          </div>
          <div
            className="gantt-nonworking"
            style={{
              left: labelWidth,
              top: headerHeight,
              height: rows.length * rowHeight,
              width: timelineWidth,
            }}
          >
            {dayWidth >= 2 &&
              dates
                .filter((day) => !workingDay(dateFromDay(day), calendar))
                .map((day) => (
                  <span
                    key={day}
                    style={{ left: (day - first) * dayWidth, width: dayWidth }}
                  />
                ))}
          </div>
          <div
            className="gantt-today"
            style={{
              left: labelWidth + x(today),
              top: headerHeight,
              height: rows.length * rowHeight,
            }}
            aria-hidden="true"
          />
          <svg
            className="gantt-dependencies"
            width={timelineWidth}
            height={rows.length * rowHeight}
            style={{ left: labelWidth, top: headerHeight }}
            aria-label={uiText("Finish-to-start dependencies")}
          >
            <defs>
              <marker
                id="planning-arrow"
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
              </marker>
            </defs>
            {edges.map((edge) => (
              <g
                key={edge.key}
                className={edge.invalid ? "gantt-dependency-conflict" : ""}
              >
                <path d={edge.path} markerEnd="url(#planning-arrow)" />
                <path
                  className="gantt-edge-hit"
                  d={edge.path}
                  onClick={() =>
                    !readOnly &&
                    setLink({
                      predecessor: edge.source,
                      successor: edge.target,
                      lag: edge.lag,
                      existing: true,
                    })
                  }
                >
                  <title>
                    {maps.byId.get(edge.source)?.title} →{" "}
                    {maps.byId.get(edge.target)?.title} · {edge.lag}{" "}
                    <I18nText id="working days" />
                    {edge.invalid ? uiText(" · conflict") : ""}
                  </title>
                </path>
                {edge.lag !== 0 && (
                  <text x={(edge.a + edge.b) / 2} y={edge.y - 4}>
                    {edge.lag > 0 ? "+" : ""}
                    {edge.lag}d
                  </text>
                )}
              </g>
            ))}
          </svg>
          {visible.map((row, i) => {
            const task = row.task,
              key = task?.id ?? row.milestone?.id ?? row.group!.id,
              y = headerHeight + (start + i) * rowHeight;
            if (row.group) {
              const g = row.group,
                dated = g.tasks.filter((t) => t.start_on && t.due_on),
                beg = dated.reduce(
                  (a, t) => (!a || t.start_on! < a ? t.start_on! : a),
                  "",
                ),
                finish = dated.reduce(
                  (a, t) => (t.due_on! > a ? t.due_on! : a),
                  "",
                ),
                leaf = g.tasks.filter(
                  (t) => !maps.parents.has(t.id) && t.status !== "cancelled",
                ),
                progress = leaf.length
                  ? Math.round(
                      leaf.reduce(
                        (n, t) => n + (maps.progress.get(t.id) ?? 0),
                        0,
                      ) / leaf.length,
                    )
                  : 0;
              return (
                <div
                  key={key}
                  className="gantt-row gantt-group-row"
                  style={{ top: y, height: rowHeight }}
                >
                  <div className="gantt-label" style={{ width: labelWidth }}>
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() => collapse(g.id)}
                    >
                      {collapsed.has(g.id) ? (
                        <ChevronRight size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                      <strong>{g.title}</strong>
                      <small>
                        {g.tasks.length} · {progress}%
                      </small>
                    </Button>
                  </div>
                  {beg && finish && (
                    <span
                      className="gantt-group-span"
                      style={{
                        left: labelWidth + x(beg),
                        width: Math.max(5, x(finish) - x(beg) + dayWidth),
                      }}
                      title={`Derived group span ${beg} → ${finish}`}
                    />
                  )}
                </div>
              );
            }
            const milestone = row.milestone,
              base =
                task && showBaseline ? maps.baseline.get(task.id) : undefined,
              progress = task ? (maps.progress.get(task.id) ?? 0) : 0,
              offset =
                drag && task && drag.id === task.id
                  ? Math.round(drag.delta / dayWidth)
                  : 0,
              beg = task?.start_on
                ? addDays(task.start_on, drag?.mode === "end" ? 0 : offset)
                : null,
              finishDate = task?.due_on
                ? addDays(task.due_on, drag?.mode === "start" ? 0 : offset)
                : null;
            return (
              <div
                key={key}
                className={`gantt-row ${task && selection.has(task.id) ? "is-selected" : ""}`}
                style={{ top: y, height: rowHeight }}
              >
                <div className="gantt-label" style={{ width: labelWidth }}>
                  <div
                    className="gantt-task-cell"
                    style={{
                      width: tableWidth,
                      paddingInlineStart: 12 + Math.min(row.depth, 8) * 14,
                    }}
                  >
                    {task ? (
                      <>
                        <Checkbox
                          aria-label={`Select ${task.title}`}
                          checked={selection.has(task.id)}
                          onChange={() => {}}
                          onClick={(e) => onSelect(task, e.shiftKey)}
                        />
                        {maps.parents.has(task.id) ? (
                          <IconButton
                            label={`${collapsed.has(task.id) ? "Expand" : "Collapse"} ${task.title}`}
                            onClick={() => collapse(task.id)}
                          >
                            {collapsed.has(task.id) ? (
                              <ChevronRight size={14} />
                            ) : (
                              <ChevronDown size={14} />
                            )}
                          </IconButton>
                        ) : (
                          <span className="gantt-fold-placeholder" />
                        )}
                        <button
                          className="gantt-task-name"
                          onClick={() => onOpen(task.id)}
                          title={task.title}
                        >
                          {task.title}
                        </button>
                        {task.blocked && (
                          <span
                            title={uiText("Blocked by unfinished work")}
                            className="gantt-blocked-dot"
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <Diamond size={15} />
                        <span>{milestone?.title}</span>
                      </>
                    )}
                  </div>
                  {columns.map((c) => (
                    <span
                      className="gantt-data-cell"
                      key={c}
                      title={
                        task
                          ? String(
                              c === "progress"
                                ? `${progress}%`
                                : c === "assignee"
                                  ? (task.assignee_name ?? "Unassigned")
                                  : c === "start"
                                    ? (task.start_on ?? "—")
                                    : c === "due"
                                      ? (task.due_on ?? "—")
                                      : task[c as "status" | "priority"],
                            )
                          : ""
                      }
                    >
                      {task
                        ? c === "progress"
                          ? `${progress}%`
                          : c === "assignee"
                            ? (task.assignee_name ?? "Unassigned")
                            : c === "start"
                              ? (task.start_on ?? "—")
                              : c === "due"
                                ? (task.due_on ?? "—")
                                : task[c as "status" | "priority"].replaceAll(
                                    "_",
                                    " ",
                                  )
                        : "—"}
                    </span>
                  ))}
                  {customFields.map((f) => (
                    <span
                      className="gantt-data-cell"
                      key={f.id}
                      title={
                        task
                          ? fieldSummaryText(f, task.field_summaries, people)
                          : ""
                      }
                    >
                      {task
                        ? fieldSummaryText(f, task.field_summaries, people)
                        : ""}
                    </span>
                  ))}
                </div>
                {base?.start_on && base.due_on && (
                  <span
                    className="gantt-baseline-bar"
                    style={{
                      left: labelWidth + x(base.start_on),
                      width: Math.max(
                        3,
                        x(base.due_on) - x(base.start_on) + dayWidth,
                      ),
                    }}
                    title={`Baseline: ${base.start_on} → ${base.due_on}`}
                  />
                )}
                {task && beg && finishDate ? (
                  <div
                    className={`gantt-bar ${task.status} ${showCritical && maps.analysis.get(task.id)?.critical ? "is-critical" : ""} ${drag?.id === task.id ? "is-dragging" : ""}`}
                    style={{
                      left: labelWidth + x(beg),
                      width: Math.max(22, x(finishDate) - x(beg) + dayWidth),
                    }}
                  >
                    <span
                      className="gantt-progress-fill"
                      style={{ width: `${progress}%` }}
                    />
                    <button
                      className="gantt-resize start"
                      aria-label={`Resize start of ${task.title}`}
                      disabled={readOnly}
                      onPointerDown={(e) => begin(e, task, "start")}
                      onKeyDown={(e) => keyboardMove(e, task, "start")}
                    />
                    <button
                      className="gantt-bar-title"
                      aria-label={`${task.title}, ${beg} to ${finishDate}, ${progress}% complete. Alt arrows to move.`}
                      onPointerDown={(e) => begin(e, task, "move")}
                      onKeyDown={(e) => keyboardMove(e, task, "move")}
                      onClick={() => {
                        if (!moved.current) onOpen(task.id);
                        moved.current = false;
                      }}
                    >
                      {task.title}
                    </button>
                    <button
                      className="gantt-resize end"
                      aria-label={`Resize finish of ${task.title}`}
                      disabled={readOnly}
                      onPointerDown={(e) => begin(e, task, "end")}
                      onKeyDown={(e) => keyboardMove(e, task, "end")}
                    />
                    {!readOnly && (
                      <>
                        <button
                          className={`gantt-link-handle start ${linkSource ? "is-target" : ""}`}
                          data-dependency-target={task.id}
                          aria-label={`Link predecessor to ${task.title}`}
                          onClick={() => {
                            if (linkSource)
                              setLink({
                                predecessor: linkSource,
                                successor: task.id,
                                lag: 0,
                              });
                            else
                              setLink({
                                predecessor: "",
                                successor: task.id,
                                lag: 0,
                              });
                            setLinkSource(null);
                          }}
                        />
                        <button
                          className="gantt-link-handle end"
                          aria-label={`Connect ${task.title} to a successor`}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            linkDropFinished.current = false;
                            e.currentTarget.setPointerCapture(e.pointerId);
                            setLinkSource(task.id);
                          }}
                          onPointerUp={(e) => {
                            e.stopPropagation();
                            const target = document
                              .elementFromPoint(e.clientX, e.clientY)
                              ?.closest<HTMLElement>("[data-dependency-target]")
                              ?.dataset.dependencyTarget;
                            if (target && target !== task.id) {
                              linkDropFinished.current = true;
                              setLink({
                                predecessor: task.id,
                                successor: target,
                                lag: 0,
                              });
                              setLinkSource(null);
                            }
                          }}
                          onPointerCancel={() => setLinkSource(null)}
                          onClick={() => {
                            if (!linkDropFinished.current)
                              setLinkSource(task.id);
                            linkDropFinished.current = false;
                          }}
                        />
                      </>
                    )}
                  </div>
                ) : task ? (
                  <Button
                    className="gantt-unscheduled"
                    variant="ghost"
                    size="compact"
                    style={{ left: labelWidth + 16 }}
                    onClick={() => onOpen(task.id)}
                  >
                    <I18nText id="Set dates" />
                  </Button>
                ) : milestone?.due_on ? (
                  <span
                    className={`gantt-milestone ${milestone.completed_at ? "done" : ""}`}
                    style={{ left: labelWidth + x(milestone.due_on) }}
                    title={`${milestone.title} · ${milestone.due_on}`}
                  >
                    <Diamond size={17} />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {settings && (
        <Dialog
          title={uiText("Timeline display")}
          onClose={() => setSettings(false)}
        >
          <Field label={uiText("Group tasks")}>
            <NativeSelect
              value={grouping}
              onChange={(e) => onOptions({ grouping: e.target.value })}
            >
              <option value="parent">
                <I18nText id="Task hierarchy" />
              </option>
              <option value="assignee">
                <I18nText id="Assignee" />
              </option>
              <option value="milestone">
                <I18nText id="Milestone" />
              </option>
            </NativeSelect>
          </Field>
          <fieldset className="planning-column-options">
            <legend>
              <I18nText id="Table columns" />
            </legend>
            {Object.entries(columnLabels).map(([id, label]) => (
              <label key={id}>
                <Checkbox
                  checked={columns.includes(id)}
                  onChange={(e) =>
                    onOptions({
                      columns:
                        (e.target.checked
                          ? [...columns, id]
                          : columns.filter((c) => c !== id)
                        ).join(",") || null,
                    })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="planning-layer-options">
            {[
              ["dependencies", "Dependencies", showDependencies],
              ["baseline", "Baseline", showBaseline],
              ["critical", "Critical path", showCritical],
            ].map(([id, label, checked]) => (
              <label key={String(id)}>
                {label}
                <Switch
                  aria-label={String(label)}
                  checked={Boolean(checked)}
                  onChange={(e) =>
                    onOptions({ [String(id)]: e.target.checked ? null : "0" })
                  }
                />
              </label>
            ))}
          </div>
          <HelpText>
            <I18nText id="Grouping spans and progress are derived; no authored parent dates are changed." />
          </HelpText>
          <ActionRow>
            <Button onClick={() => setSettings(false)}>
              <I18nText id="Done" />
            </Button>
          </ActionRow>
        </Dialog>
      )}
      {link && (
        <Dialog
          title={
            link.existing ? uiText("Edit dependency") : uiText("Link tasks")
          }
          subtitle={uiText(
            "Finish-to-start links use the workspace working calendar. Saving does not move dates.",
          )}
          onClose={() => !action.busy && setLink(null)}
        >
          <ErrorNotice message={action.error} />
          <Field label={uiText("Predecessor")}>
            <PlanningEntityPicker
              spaceId={spaceId}
              kind="task"
              label={uiText("Dependency predecessor")}
              value={link.predecessor}
              onChange={(v) =>
                setLink((l) => l && { ...l, predecessor: String(v) })
              }
            />
          </Field>
          <Field label={uiText("Successor")}>
            <PlanningEntityPicker
              spaceId={spaceId}
              kind="task"
              label={uiText("Dependency successor")}
              value={link.successor}
              onChange={(v) =>
                setLink((l) => l && { ...l, successor: String(v) })
              }
            />
          </Field>
          <Field
            label={uiText("Offset in working days")}
            hint={uiText(
              "0 = next working day; positive = delay; negative = overlap.",
            )}
          >
            <PlanningIntegerInput
              label={uiText("Dependency offset in working days")}
              min={-365}
              max={365}
              value={link.lag}
              onValidity={setValidOffset}
              onCommit={(lag) => setLink((l) => l && { ...l, lag })}
            />
          </Field>
          <HelpText>
            <I18nText id="Tasks outside the current view remain available. Current versions and the full dependency graph are checked before saving." />
          </HelpText>
          <ActionRow>
            {link.existing && (
              <Button
                variant="danger"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const task =
                      maps.byId.get(link.successor) ??
                      (await api<PlanningTask>(
                        `spaces/${spaceId}/tasks/${link.successor}`,
                      ));
                    await onDependency(
                      task,
                      taskDependencyLinks(task).filter(
                        (d) => d.taskId !== link.predecessor,
                      ),
                    );
                    setLink(null);
                  })
                }
              >
                <I18nText id="Remove link" />
              </Button>
            )}
            <Button data-dialog-cancel onClick={() => setLink(null)}>
              <I18nText id="Cancel" />
            </Button>
            <Button
              variant="primary"
              disabled={
                action.busy ||
                !validOffset ||
                !link.predecessor ||
                !link.successor ||
                link.predecessor === link.successor
              }
              onClick={() =>
                void action.run(async () => {
                  const task =
                    maps.byId.get(link.successor) ??
                    (await api<PlanningTask>(
                      `spaces/${spaceId}/tasks/${link.successor}`,
                    ));
                  const links = taskDependencyLinks(task).filter(
                    (d) => d.taskId !== link.predecessor,
                  );
                  await onDependency(task, [
                    ...links,
                    { taskId: link.predecessor, lagDays: link.lag },
                  ]);
                  setLink(null);
                })
              }
            >
              <I18nText id="Save link" />
            </Button>
          </ActionRow>
        </Dialog>
      )}
    </section>
  );
}
