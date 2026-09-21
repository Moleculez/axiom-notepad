"use client";
import { useMemo, useState, type CSSProperties } from "react";
import { useAppearance } from "../../lib/appearance";
import { openAssistant } from "../../lib/assistant";
import { confirmAction } from "../../lib/app-prompt";
import {
  CalendarDays,
  ChartGantt,
  Download,
  Layers3,
  MessageSquare,
  Plus,
  Settings2,
  Users,
  X,
} from "lucide-react";
import type {
  Availability,
  CapacityPerson,
  capacityReport,
} from "@axiom/shared/planning-analysis";
import {
  availabilitySchema,
  capacityWeekStart,
} from "@axiom/shared/planning-analysis";
import { dayNumber } from "@axiom/shared/planning";
import Dialog, { DialogFooter } from "../Dialog";
import {
  ErrorNotice,
  Loading,
  PageHeading,
  mutate,
  useAction,
  useData,
  useLocation,
  useWorkspace,
  WorkspaceLink,
} from "./ui";
type Portfolio = {
  id: string;
  name: string;
  version: number;
  space_ids: string[];
};
type Summary = {
  id: string;
  name: string;
  total: number;
  completed: number;
  overdue: number;
  blocked: number;
  estimatedHours: number;
  unestimated: number;
  startOn: string | null;
  dueOn: string | null;
  milestones: { id: string; title: string; due_on: string | null }[];
};
type PortfolioData = {
  spaces: Summary[];
  portfolios: Portfolio[];
  canManage: boolean;
  coverage: string;
};
type CapacityData = ReturnType<typeof capacityReport> & {
  tasks: { id: string; title: string; spaceId: string }[];
  canManage: boolean;
  coverage: string;
};
const hours = (n: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n);
export default function GroupPlanning({ id }: { id: string }) {
  const { session, revision, navigate, spaces } = useWorkspace(),
    { params } = useLocation();
  const group = session.groups.find((g) => g.id === id),
    view = params.get("view") ?? "overview",
    portfolio = params.get("portfolio") ?? "";
  const data = useData<PortfolioData>(
    `groups/${id}/portfolio${portfolio ? `?portfolio=${portfolio}` : ""}`,
    revision,
  );
  const [editing, setEditing] = useState<Portfolio | "new" | null>(null);
  const change = (values: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(values)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    navigate(`/groups/${id}/planning?${p}`);
  };
  const rows = data.data?.spaces ?? [],
    dates = rows
      .flatMap((s) => [s.startOn, s.dueOn])
      .filter((x): x is string => !!x);
  const first = dates.length ? Math.min(...dates.map(dayNumber)) : 0,
    last = dates.length ? Math.max(...dates.map(dayNumber)) : 1;
  if (!group) return <ErrorNotice message="This group is unavailable." />;
  return (
    <main className="ws-page group-planning">
      <PageHeading eyebrow="GROUP PLANNING" title={group.name}>
        Coordinate research across accessible workspaces.
      </PageHeading>
      <div className="productivity-subtoolbar">
        <nav className="planning-view-switch" aria-label="Group planning views">
          {[
            ["overview", "Overview", Layers3],
            ["timeline", "Timeline", ChartGantt],
            ["capacity", "Capacity", Users],
          ].map(([v, label, Icon]: any) => (
            <button
              key={v}
              className={view === v ? "active" : ""}
              aria-pressed={view === v}
              onClick={() => change({ view: v })}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <label>
          Portfolio
          <select
            value={portfolio}
            onChange={(e) => change({ portfolio: e.target.value })}
          >
            <option value="">All accessible workspaces</option>
            {data.data?.portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {data.data?.canManage && (
          <>
            <button
              className="icon-button"
              aria-label="Create portfolio"
              title="Create portfolio"
              onClick={() => setEditing("new")}
            >
              <Plus size={17} />
            </button>
            {portfolio && (
              <button
                className="icon-button"
                aria-label="Edit portfolio"
                title="Edit portfolio"
                onClick={() =>
                  setEditing(
                    data.data!.portfolios.find((p) => p.id === portfolio)!,
                  )
                }
              >
                <Settings2 size={17} />
              </button>
            )}
          </>
        )}
        <span className="planning-spacer" />
        <button
          className="icon-button"
          title="Ask across this portfolio (up to 20 workspaces)"
          aria-label="Ask across portfolio"
          disabled={!rows.length}
          onClick={() =>
            openAssistant({
              spaceId: rows[0].id,
              spaceIds: rows.slice(0, 20).map((s) => s.id),
              prompt:
                "Compare the selected research evidence across this portfolio and identify planning risks. Separate evidence from inference.",
            })
          }
        >
          <MessageSquare size={17} />
        </button>
        <WorkspaceLink className="button ghost" to="/groups">
          Groups
        </WorkspaceLink>
        <button
          className="icon-button"
          title="Export visible portfolio"
          aria-label="Export visible portfolio"
          disabled={!data.data}
          onClick={() => {
            const u = URL.createObjectURL(
              new Blob([JSON.stringify(data.data, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = u;
            a.download = "portfolio.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(u), 1000);
          }}
        >
          <Download size={17} />
        </button>
      </div>
      <ErrorNotice message={data.error} retry={data.reload} />
      <p className="ws-note">
        Accessible active workspaces only. Totals never include work you cannot
        read.
      </p>
      {view === "capacity" ? (
        <GroupCapacity groupId={id} portfolioId={portfolio} />
      ) : data.loading && !data.data ? (
        <Loading />
      ) : (
        <div className="productivity-data-scroll">
          <table className="productivity-data-table">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>{view === "timeline" ? "Schedule" : "Progress"}</th>
                <th>Risks</th>
                <th>Estimated work</th>
                <th>Next milestones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <th>
                    <WorkspaceLink to={`/workspaces/${s.id}/planning`}>
                      {s.name}
                    </WorkspaceLink>
                  </th>
                  <td>
                    {view === "timeline" ? (
                      <>
                        <div
                          className="portfolio-timeline"
                          title={`${s.startOn ?? "Unscheduled"} → ${s.dueOn ?? "Unscheduled"}`}
                        >
                          {s.startOn && s.dueOn && (
                            <span
                              style={{
                                left: `${(100 * (dayNumber(s.startOn) - first)) / Math.max(1, last - first + 1)}%`,
                                width: `${(100 * (dayNumber(s.dueOn) - dayNumber(s.startOn) + 1)) / Math.max(1, last - first + 1)}%`,
                              }}
                            />
                          )}
                        </div>
                        <small>
                          {s.startOn ?? "—"} → {s.dueOn ?? "—"}
                        </small>
                      </>
                    ) : (
                      <>
                        <progress
                          value={s.completed}
                          max={s.total || 1}
                          aria-label={`${s.completed} of ${s.total} completed`}
                        />
                        <small>
                          {s.completed} / {s.total} done
                        </small>
                      </>
                    )}
                  </td>
                  <td>
                    <WorkspaceLink
                      to={`/workspaces/${s.id}/planning?risk=overdue`}
                    >
                      {s.overdue} overdue
                    </WorkspaceLink>
                    {" · "}
                    <WorkspaceLink
                      to={`/workspaces/${s.id}/planning?risk=blocked`}
                    >
                      {s.blocked} blocked
                    </WorkspaceLink>
                  </td>
                  <td>
                    {hours(s.estimatedHours)} h
                    <small>{s.unestimated} unestimated</small>
                  </td>
                  <td>
                    {s.milestones.slice(0, 3).map((m) => (
                      <div key={m.id}>
                        <WorkspaceLink
                          to={`/workspaces/${s.id}/planning?milestone=${m.id}`}
                        >
                          {m.title}
                        </WorkspaceLink>
                        <small>{m.due_on ?? "No date"}</small>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p>No accessible active workspaces in this portfolio.</p>
          )}
        </div>
      )}
      {editing && (
        <PortfolioEditor
          groupId={id}
          value={editing}
          spaces={spaces.filter(
            (s) => s.group_id === id && s.effective_status === "active",
          )}
          onClose={() => setEditing(null)}
          onDeleted={() => {
            setEditing(null);
            change({ portfolio: "" });
          }}
        />
      )}
    </main>
  );
}
export function GroupCapacity({
  groupId,
  portfolioId = "",
}: {
  groupId: string;
  portfolioId?: string;
}) {
  const { session, revision } = useWorkspace(),
    [start, setStart] = useState(() =>
      capacityWeekStart(new Date().toLocaleDateString("sv-SE")),
    ),
    [weeks, setWeeks] = useState(12),
    [person, setPerson] = useState<CapacityPerson | null>(null),
    [selection, setSelection] = useState<string[] | null>(null),
    [top, setTop] = useState(0);
  const appearance = useAppearance(session.user.id);
  const selectionIds = useMemo(() => new Set(selection ?? []), [selection]);
  const rowHeight = Math.max(64, Math.ceil(appearance.effective.uiSize * 4.6));
  const cellWidth = Math.max(120, Math.ceil(appearance.effective.uiSize * 9));
  const nameWidth = Math.max(220, Math.ceil(appearance.effective.uiSize * 15));
  const headHeight = Math.max(48, Math.ceil(appearance.effective.uiSize * 3.2));
  const data = useData<CapacityData>(
      `groups/${groupId}/capacity?start=${start}&weeks=${weeks}${portfolioId ? `&portfolio=${portfolioId}` : ""}`,
      revision,
    ),
    rows = data.data?.people ?? [],
    from = Math.max(0, Math.floor(top / rowHeight) - 3),
    shown = rows.slice(from, from + 20);
  return (
    <section className="group-capacity">
      <div className="productivity-subtoolbar">
        <CalendarDays size={17} />
        <label>
          Week of
          <input
            type="date"
            value={start}
            onChange={(e) => {
              if (e.target.value) setStart(capacityWeekStart(e.target.value));
            }}
          />
        </label>
        <label>
          Range
          <select
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
          >
            {[4, 8, 12, 26, 52].map((n) => (
              <option key={n} value={n}>
                {n} weeks
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="ws-note">
        Estimated demand / group availability. Unknown is not zero. Each
        estimate is the task’s own effort, not its children's rollup. Dates
        retain their workspace calendar; weeks start Monday.
      </p>
      <ErrorNotice message={data.error} retry={data.reload} />
      {data.loading && !data.data && <Loading />}
      {data.data && (
        <>
          <div
            className="capacity-scroll"
            onScroll={(e) => setTop(e.currentTarget.scrollTop)}
            role="table"
            aria-label="Weekly capacity"
            aria-rowcount={rows.length + 1}
          >
            <div
              className="capacity-grid"
              style={
                {
                  width: nameWidth + weeks * cellWidth,
                  height: headHeight + rows.length * rowHeight,
                  "--capacity-row": `${rowHeight}px`,
                  "--capacity-cell": `${cellWidth}px`,
                  "--capacity-name": `${nameWidth}px`,
                  "--capacity-head": `${headHeight}px`,
                } as CSSProperties
              }
            >
              <div className="capacity-head" role="row">
                <span role="columnheader">Member</span>
                {data.data.weeks.map((w) => (
                  <span role="columnheader" key={w}>
                    {w}
                  </span>
                ))}
              </div>
              {shown.map((p, i) => (
                <div
                  className="capacity-row"
                  role="row"
                  aria-rowindex={from + i + 2}
                  key={p.id}
                  style={{ top: headHeight + (from + i) * rowHeight }}
                >
                  <div className="capacity-name" role="rowheader">
                    <strong>{p.name}</strong>
                    {(p.id === session.user.id || data.data!.canManage) && (
                      <button
                        className="text-button"
                        onClick={() => setPerson(p)}
                      >
                        Availability
                      </button>
                    )}
                  </div>
                  {p.weeks.map((w) => (
                    <button
                      role="cell"
                      key={w.date}
                      className={`capacity-cell ${w.available !== null && w.demand > w.available ? "overloaded" : ""}`}
                      title={`${w.date}: ${hours(w.demand)} hours demand; ${w.available === null ? "availability unknown" : `${hours(w.available)} hours available`}`}
                      onClick={() => setSelection(w.taskIds)}
                    >
                      <span>
                        {hours(w.demand)} /{" "}
                        {w.available === null ? "?" : hours(w.available)} h
                      </span>
                      <small>
                        {w.available === null
                          ? "Availability unknown"
                          : w.demand > w.available
                            ? `${hours(w.demand - w.available)} h over capacity`
                            : `${hours(w.available - w.demand)} h available`}
                      </small>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="productivity-subtoolbar">
            {Object.entries(data.data.unallocated).map(([key, ids]) => (
              <button
                className="text-button"
                key={key}
                onClick={() => setSelection(ids)}
              >
                {ids.length} {key}
              </button>
            ))}
          </div>
        </>
      )}
      {person && (
        <AvailabilityEditor
          groupId={groupId}
          person={person}
          onClose={() => setPerson(null)}
        />
      )}
      {selection && (
        <Dialog
          title="Work contributing to this view"
          subtitle="Accessible tasks only"
          onClose={() => setSelection(null)}
        >
          <div className="planning-task-drilldown">
            {data.data?.tasks
              .filter((t) => selectionIds.has(t.id))
              .slice(0, 200)
              .map((t) => (
                <WorkspaceLink
                  key={t.id}
                  to={`/workspaces/${t.spaceId}/planning?task=${t.id}`}
                >
                  {t.title}
                </WorkspaceLink>
              ))}
            {!selection.length && (
              <p>No scheduled estimated work in this cell.</p>
            )}
            {selection.length > 200 && <p>Showing the first 200 tasks.</p>}
          </div>
        </Dialog>
      )}
    </section>
  );
}
function AvailabilityEditor({
  groupId,
  person,
  onClose,
}: {
  groupId: string;
  person: CapacityPerson;
  onClose: () => void;
}) {
  const { refresh } = useWorkspace(),
    action = useAction(),
    [value, setValue] = useState<Availability>(person.availability);
  const [date, setDate] = useState(""),
    [exceptionHours, setExceptionHours] = useState(0),
    validation = availabilitySchema.safeParse(value);
  return (
    <Dialog
      title={`${person.name} · Availability`}
      subtitle="For this group only. Zero hours means unavailable; blank means unknown."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await mutate(
              `groups/${groupId}/capacity`,
              {
                userId: person.id,
                version: person.version,
                settings: availabilitySchema.parse(value),
              },
              "PATCH",
            );
            refresh();
            onClose();
          });
        }}
      >
        <label>
          Weekly hours
          <input
            type="number"
            min={0}
            max={168}
            step="0.5"
            value={value.weeklyHours ?? ""}
            onChange={(e) =>
              setValue({
                ...value,
                weeklyHours:
                  e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        </label>
        <fieldset className="productivity-weekdays">
          <legend>Working days</legend>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
            <label className="productivity-check" key={day}>
              <input
                type="checkbox"
                checked={value.workingDays.includes(i)}
                onChange={(e) =>
                  setValue({
                    ...value,
                    workingDays: e.target.checked
                      ? [...value.workingDays, i].sort()
                      : value.workingDays.filter((d) => d !== i),
                  })
                }
              />
              {day}
            </label>
          ))}
        </fieldset>
        <h3>Date exceptions</h3>
        <p className="ws-note">
          Set zero for time off. Exceptions replace that day's normal hours.
        </p>
        <div className="productivity-subtoolbar">
          <label>
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Hours
            <input
              type="number"
              min={0}
              max={24}
              step="0.5"
              value={exceptionHours}
              onChange={(e) => setExceptionHours(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={!date || exceptionHours < 0 || exceptionHours > 24}
            onClick={() => {
              setValue({
                ...value,
                exceptions: [
                  ...value.exceptions.filter((e) => e.date !== date),
                  { date, hours: exceptionHours },
                ].sort((a, b) => a.date.localeCompare(b.date)),
              });
              setDate("");
            }}
          >
            Add exception
          </button>
        </div>
        {value.exceptions.map((ex) => (
          <div className="productivity-subtoolbar" key={ex.date}>
            <span>{ex.date}</span>
            <span>{ex.hours} h</span>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove ${ex.date} exception`}
              onClick={() =>
                setValue({
                  ...value,
                  exceptions: value.exceptions.filter(
                    (e) => e.date !== ex.date,
                  ),
                })
              }
            >
              <X size={15} />
            </button>
          </div>
        ))}
        <ErrorNotice
          message={
            action.error ||
            (!validation.success ? validation.error.issues[0].message : "")
          }
        />
        <DialogFooter>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={action.busy || !validation.success}
          >
            Save availability
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
function PortfolioEditor({
  groupId,
  value,
  spaces,
  onClose,
  onDeleted,
}: {
  groupId: string;
  value: Portfolio | "new";
  spaces: { id: string; name: string }[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { refresh } = useWorkspace(),
    action = useAction(),
    [name, setName] = useState(value === "new" ? "" : value.name),
    [selected, setSelected] = useState(value === "new" ? [] : value.space_ids);
  return (
    <Dialog
      title={value === "new" ? "Create portfolio" : "Edit portfolio"}
      subtitle="A saved group view. Workspace permissions remain unchanged."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await mutate(
              `groups/${groupId}/portfolios${value === "new" ? "" : `/${value.id}`}`,
              {
                name,
                spaceIds: selected,
                version: value === "new" ? 0 : value.version,
              },
              value === "new" ? "POST" : "PATCH",
            );
            refresh();
            onClose();
          });
        }}
      >
        <label>
          Name
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className="portfolio-workspaces">
          <legend>Included workspaces</legend>
          {spaces.map((s) => (
            <label className="productivity-check" key={s.id}>
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, s.id]
                      : selected.filter((id) => id !== s.id),
                  )
                }
              />
              {s.name}
            </label>
          ))}
        </fieldset>
        <ErrorNotice message={action.error} />
        <DialogFooter>
          {value !== "new" && (
            <button
              className="button ghost"
              type="button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  if (
                    !(await confirmAction(
                      "Remove this saved portfolio? Workspaces, tasks and files will remain unchanged.",
                      { title: "Remove portfolio", confirmLabel: "Remove" },
                    ))
                  )
                    return;
                  await mutate(
                    `groups/${groupId}/portfolios/${value.id}`,
                    {
                      name: value.name,
                      spaceIds: value.space_ids,
                      version: value.version,
                    },
                    "DELETE",
                  );
                  refresh();
                  onDeleted();
                })
              }
            >
              Remove portfolio
            </button>
          )}
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={action.busy || !name.trim()}
          >
            Save portfolio
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
