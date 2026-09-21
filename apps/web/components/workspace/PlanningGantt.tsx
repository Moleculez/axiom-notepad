"use client";
import { useMemo, useRef, useState } from "react";
import type { PlanningAnalysis } from "@axiom/shared/planning-analysis";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Diamond,
  Focus,
  Minus,
  Plus,
} from "lucide-react";
import {
  addDays,
  dayNumber,
  dateFromDay,
  workingDay,
  type PlanningCalendar,
  type PlanningTask,
  type ScheduleChange,
} from "@axiom/shared/planning";

export type Milestone = {
  id: string;
  title: string;
  due_on: string | null;
  completed_at: string | null;
  version: number;
};
const rowHeight = 44,
  headerHeight = 48;
type Row = { task?: PlanningTask; milestone?: Milestone; depth: number };
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

/** DOM bars, a clipped SVG dependency layer, and virtual rows share one scrollport. */
export default function PlanningGantt({
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
}: {
  tasks: PlanningTask[];
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
}) {
  const root = useRef<HTMLDivElement>(null),
    [scroll, setScroll] = useState({
      top: initialScroll,
      left: 0,
      height: 600,
      width: 1000,
    });
  const [collapsed, setCollapsed] = useState(new Set<string>()),
    [tableWidth, setTableWidth] = useState(290),
    [fit, setFit] = useState<number | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    mode: "move" | "start" | "end";
    x: number;
    delta: number;
  } | null>(null);
  const dragged = useRef(false);
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: calendar.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const rows = useMemo<Row[]>(
    () => [
      ...orderedPlanningRows(tasks, collapsed),
      ...milestones.map((milestone) => ({ milestone, depth: 0 })),
    ],
    [tasks, collapsed, milestones],
  );
  const dates = [
    ...baseline.flatMap((t) => [t.start_on, t.due_on]),
    ...tasks.flatMap((t) => [t.start_on, t.due_on]),
    ...milestones.map((m) => m.due_on),
  ].filter((d): d is string => !!d);
  const first =
    (dates.length ? Math.min(...dates.map(dayNumber)) : dayNumber(today)) - 7;
  const last = Math.max(
    first + 60,
    (dates.length ? Math.max(...dates.map(dayNumber)) : first + 30) + 21,
  );
  const dayWidth = fit ?? { day: 30, week: 12, month: 4 }[zoom] ?? 12,
    timelineWidth = (last - first + 1) * dayWidth;
  const start = Math.max(
      0,
      Math.floor((scroll.top - headerHeight) / rowHeight) - 8,
    ),
    end = Math.min(
      rows.length,
      start + Math.ceil(scroll.height / rowHeight) + 18,
    );
  const visible = rows.slice(start, end),
    index = new Map(
      rows.flatMap((r, i) => (r.task ? [[r.task.id, i] as const] : [])),
    ),
    byId = new Map(tasks.map((t) => [t.id, t]));
  const firstDay = Math.max(
      0,
      Math.floor((scroll.left - tableWidth) / dayWidth) - 2,
    ),
    lastDay = Math.min(
      last - first + 1,
      firstDay + Math.ceil(scroll.width / dayWidth) + 5,
    );
  const x = (date: string) => (dayNumber(date) - first) * dayWidth;
  const edges = visible.flatMap(
    (row) =>
      row.task?.dependencies?.flatMap((id) => {
        const predecessor = byId.get(id),
          from = index.get(id),
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
          y1 = from * rowHeight + 22,
          y2 = to * rowHeight + 22;
        return [
          {
            key: id + row.task!.id,
            path: `M ${a} ${y1} H ${a + 8} V ${y2 - 16} H ${b - 8} V ${y2} H ${b}`,
            invalid: b < a,
          },
        ];
      }) ?? [],
  );
  function move(
    event: React.PointerEvent,
    task: PlanningTask,
    mode: "move" | "start" | "end",
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
    dragged.current = false;
    setDrag({ id: task.id, mode, x: event.clientX, delta: 0 });
  }
  function openFromBar(id: string) {
    if (!dragged.current) onOpen(id);
    dragged.current = false;
  }
  function finish(event: React.PointerEvent, task: PlanningTask) {
    if (!drag || drag.id !== task.id) return;
    event.stopPropagation();
    const amount = Math.round((event.clientX - drag.x) / dayWidth);
    setDrag(null);
    if (!amount || !task.start_on || !task.due_on) return;
    dragged.current = true;
    let startOn =
        drag.mode === "end" ? task.start_on : addDays(task.start_on, amount),
      dueOn =
        drag.mode === "start" ? task.due_on : addDays(task.due_on, amount);
    if (startOn > dueOn) {
      if (drag.mode === "start") startOn = dueOn;
      else dueOn = startOn;
    }
    onSchedule([{ id: task.id, version: task.version, startOn, dueOn }]);
  }
  return (
    <section className="planning-gantt" aria-label="Gantt schedule">
      <div className="planning-gantt-controls">
        <div
          className="scratchpad-modes"
          aria-label="Timeline scale"
          role="group"
        >
          {["day", "week", "month"].map((value) => (
            <button
              key={value}
              aria-pressed={!fit && zoom === value}
              onClick={() => {
                setFit(null);
                onZoom(value);
              }}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <button
          className="button ghost"
          onClick={() =>
            root.current?.scrollTo({
              left: Math.max(0, x(today) - 80),
              behavior: "smooth",
            })
          }
        >
          <CalendarDays size={15} />
          Today
        </button>
        <button
          className="button ghost"
          onClick={() => {
            setFit(
              Math.max(
                1,
                Math.min(
                  30,
                  ((root.current?.clientWidth ?? 1000) - tableWidth - 24) /
                    (last - first + 1),
                ),
              ),
            );
            root.current?.scrollTo({ left: 0 });
          }}
        >
          <Focus size={15} />
          Fit
        </button>
        <span className="planning-spacer" />
        <label className="planning-width">
          Task column{" "}
          <input
            aria-label="Task column width"
            type="range"
            min="220"
            max="480"
            value={tableWidth}
            onChange={(e) => setTableWidth(Number(e.target.value))}
          />
        </label>
        <small>Drag to preview · {calendar.timezone}</small>
      </div>
      <div
        className="gantt-scroll"
        ref={(node) => {
          root.current = node;
          if (node && !node.dataset.restored) {
            node.scrollTop = initialScroll;
            node.dataset.restored = "1";
          }
        }}
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
      >
        <div
          className="gantt-canvas"
          style={{
            width: tableWidth + timelineWidth,
            height: headerHeight + rows.length * rowHeight,
          }}
        >
          <div
            className="gantt-dates"
            style={{
              marginLeft: tableWidth,
              width: timelineWidth,
              height: headerHeight,
            }}
          >
            {Array.from({ length: Math.max(0, lastDay - firstDay) }, (_, i) => {
              const offset = i + firstDay,
                date = dateFromDay(first + offset),
                show =
                  dayWidth >= 24 ||
                  (dayWidth >= 8
                    ? new Date(date + "T00:00:00Z").getUTCDay() === 1
                    : date.endsWith("-01"));
              return show ? (
                <span key={date} style={{ left: offset * dayWidth }}>
                  {new Date(date + "T00:00:00Z").toLocaleDateString(undefined, {
                    timeZone: "UTC",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              ) : null;
            })}
          </div>
          <div
            className="gantt-corner"
            style={{ width: tableWidth, height: headerHeight }}
          >
            Work item{" "}
            <small>
              {tasks.length} tasks · {milestones.length} milestones
            </small>
          </div>
          <div
            className="gantt-timeline"
            style={{
              left: tableWidth,
              top: headerHeight,
              width: timelineWidth,
              height: rows.length * rowHeight,
            }}
          >
            {dayWidth >= 8 &&
              Array.from(
                { length: Math.max(0, lastDay - firstDay) },
                (_, i) => {
                  const offset = i + firstDay;
                  return !workingDay(dateFromDay(first + offset), calendar) ? (
                    <div
                      key={offset}
                      className="gantt-nonworking"
                      style={{ left: offset * dayWidth, width: dayWidth }}
                    />
                  ) : null;
                },
              )}
            {dayNumber(today) >= first && dayNumber(today) <= last && (
              <div
                className="gantt-today"
                aria-label={`Today: ${today}`}
                style={{ left: x(today) + dayWidth / 2 }}
              />
            )}
            <svg
              className="gantt-dependencies"
              aria-label="Finish-to-start dependencies"
              width={timelineWidth}
              height={rows.length * rowHeight}
            >
              {edges.map((edge) => (
                <path
                  key={edge.key}
                  d={edge.path}
                  className={edge.invalid ? "conflict" : ""}
                />
              ))}
            </svg>
          </div>
          {visible.map((row, offset) => {
            const rowIndex = start + offset,
              task = row.task,
              milestone = row.milestone,
              top = headerHeight + rowIndex * rowHeight;
            let left = task?.start_on
              ? x(task.start_on)
              : milestone?.due_on
                ? x(milestone.due_on)
                : null;
            let width =
              task?.start_on && task.due_on
                ? Math.max(
                    dayWidth,
                    (dayNumber(task.due_on) - dayNumber(task.start_on) + 1) *
                      dayWidth,
                  )
                : 0;
            if (drag && task && drag.id === task.id && left !== null) {
              if (drag.mode !== "end") left += drag.delta * dayWidth;
              if (drag.mode === "start") width -= drag.delta * dayWidth;
              if (drag.mode === "end") width += drag.delta * dayWidth;
              width = Math.max(dayWidth, width);
            }
            const hasChildren =
              task && tasks.some((t) => t.parent_id === task.id);
            const original = task && baseline.find((t) => t.id === task.id);
            return (
              <div
                className="gantt-row"
                key={task?.id ?? milestone!.id}
                style={{
                  top,
                  height: rowHeight,
                  width: tableWidth + timelineWidth,
                }}
              >
                <div
                  className="gantt-label"
                  style={{
                    width: tableWidth,
                    paddingLeft: 12 + Math.min(row.depth, 8) * 16,
                  }}
                >
                  {hasChildren ? (
                    <button
                      className="icon-button"
                      aria-label={`${collapsed.has(task.id) ? "Expand" : "Collapse"} ${task.title}`}
                      onClick={() =>
                        setCollapsed((old) => {
                          const next = new Set(old);
                          if (next.has(task.id)) next.delete(task.id);
                          else next.add(task.id);
                          return next;
                        })
                      }
                    >
                      {collapsed.has(task.id) ? (
                        <ChevronRight size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </button>
                  ) : milestone ? (
                    <Diamond size={14} />
                  ) : (
                    <span className={`task-status-dot ${task!.status}`} />
                  )}
                  {task ? (
                    <button onClick={() => onOpen(task.id)} title={task.title}>
                      {task.title}
                    </button>
                  ) : (
                    <span>{milestone!.title}</span>
                  )}
                  {task?.blocked && (
                    <small title="Waiting for dependencies">Blocked</small>
                  )}
                </div>
                {original?.start_on && original.due_on && (
                  <div
                    className="gantt-baseline"
                    title={`Baseline: ${original.start_on} → ${original.due_on}`}
                    style={{
                      left: tableWidth + x(original.start_on),
                      width: Math.max(
                        dayWidth,
                        (dayNumber(original.due_on) -
                          dayNumber(original.start_on) +
                          1) *
                          dayWidth,
                      ),
                    }}
                  />
                )}
                {task && left !== null && width > 0 ? (
                  <div
                    className={`gantt-bar ${task.status} ${analysis?.tasks.find((t) => t.id === task.id)?.critical ? "critical" : ""} ${width < 70 ? "compact" : ""} ${drag?.id === task.id ? "dragging" : ""}`}
                    style={{ left: tableWidth + left, width }}
                    onPointerDown={(e) => move(e, task, "move")}
                    onPointerMove={(e) => {
                      if (drag?.id === task.id)
                        setDrag({
                          ...drag,
                          delta: Math.round((e.clientX - drag.x) / dayWidth),
                        });
                    }}
                    onPointerUp={(e) => finish(e, task)}
                    onPointerCancel={() => setDrag(null)}
                  >
                    {!readOnly && (
                      <button
                        className="gantt-resize start"
                        aria-label={`Resize start of ${task.title}`}
                        title="Drag start date, or open task to enter dates"
                        onClick={() => openFromBar(task.id)}
                        onPointerDown={(e) => move(e, task, "start")}
                      >
                        <Minus size={10} />
                      </button>
                    )}
                    <button
                      className="gantt-bar-title"
                      title={`${task.title} · ${task.start_on} → ${task.due_on}. Open to edit dates.`}
                      onClick={() => openFromBar(task.id)}
                    >
                      {task.title}
                    </button>
                    {!readOnly && (
                      <button
                        className="gantt-resize end"
                        aria-label={`Resize end of ${task.title}`}
                        title="Drag finish date, or open task to enter dates"
                        onClick={() => openFromBar(task.id)}
                        onPointerDown={(e) => move(e, task, "end")}
                      >
                        <Plus size={10} />
                      </button>
                    )}
                  </div>
                ) : milestone && left !== null ? (
                  <span
                    className="gantt-milestone"
                    title={`${milestone.title} · ${milestone.due_on}`}
                    style={{ left: tableWidth + left }}
                  >
                    <Diamond size={18} />
                  </span>
                ) : (
                  <button
                    className="gantt-unscheduled"
                    style={{ left: tableWidth + 16 }}
                    onClick={() => task && onOpen(task.id)}
                  >
                    {task ? "Set start and finish dates" : "No milestone date"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="planning-caption">
        <span className="gantt-legend-line" /> Today · shaded days are
        non-working · connector lines show finish-to-start dependencies.
        Unscheduled tasks stay undated.
      </div>
    </section>
  );
}
