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
  TextArea,
  NativeSelect,
  SearchField,
} from "../ui/controls";
import TimeZoneInput from "../TimeZoneInput";
import DraftGuard from "./DraftGuard";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Flag,
  FlaskConical,
  FolderOpen,
  Kanban,
  List,
  MessageSquare,
  Plus,
  Repeat2,
} from "lucide-react";
import type { ResourcePage, Task } from "@axiom/shared/workspace";
import { parseMarkdown } from "@axiom/markdown";
import { timeAgo } from "../../lib/client";
import Dialog from "../Dialog";
import ReadingView from "../ReadingView";
import { Avatar } from "./Pages";
import {
  Badge,
  Empty,
  ErrorNotice,
  Loading,
  mutate,
  PageHeading,
  useAction,
  useData,
  useLocation,
  useWorkspace,
  WorkspaceLink,
} from "./ui";

const statuses = [
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["in_review", "In review"],
  ["done", "Done"],
  ["cancelled", "Cancelled"],
] as const;
const dateOnly = (value?: string | null) => value?.slice(0, 10) ?? "";
export default function ProjectsPage({
  id,
  section = "tasks",
}: {
  id?: string;
  section?: string;
}) {
  useInterfaceLocale();
  const { revision, navigate, refresh, spaces } = useWorkspace(),
    data = useData<any>(id ? `projects/${id}` : "projects", revision),
    [create, setCreate] = useState(false);
  if (id) {
    const project = data.data,
      space = spaces.find((space) => space.project_id === id);
    return (
      <main className="ws-page ws-project-page">
        <ErrorNotice message={data.error} retry={data.reload} />
        {!project ? (
          data.loading && (
            <Loading label={uiText("Opening research project…")} />
          )
        ) : (
          <>
            <WorkspaceLink className="ws-back-link" to="/projects">
              <ArrowLeft size={14} />
              <I18nText id="All projects" />
            </WorkspaceLink>
            <PageHeading
              eyebrow="RESEARCH PROJECT"
              title={project.name}
              actions={
                <WorkspaceLink
                  className="button secondary"
                  to={`/explorer?space=${space?.id ?? project.space_id}`}
                >
                  <FolderOpen size={17} />
                  Project files
                </WorkspaceLink>
              }
            >
              {project.description ||
                "A shared place to connect questions, evidence, and next steps."}
            </PageHeading>
            <div className="ws-project-meta">
              <Badge>
                {project.audience === "restricted"
                  ? uiText("Invited project members")
                  : uiText("Entire group")}
              </Badge>
              <Badge>{project.role}</Badge>
              {project.archived_at && (
                <Badge tone="warning">
                  <I18nText id="Archived" />
                </Badge>
              )}
              <span>{project.timezone}</span>
            </div>
            <nav
              className="page-section-navigation"
              aria-label={uiText("Project sections")}
            >
              {[
                "tasks",
                "milestones",
                "reviews",
                "discussions",
                "workload",
                "activity",
                "members",
                ...(project.can_manage ? ["settings"] : []),
              ].map((tab) => (
                <WorkspaceLink
                  key={tab}
                  className={`page-section-link ${tab === section ? "active" : ""}`}
                  aria-current={tab === section ? "page" : undefined}
                  to={`/projects/${id}/${tab}`}
                >
                  {tab}
                </WorkspaceLink>
              ))}
            </nav>
            {section === "tasks" ? (
              <Tasks project={{ ...project, space_id: space?.id }} />
            ) : section === "members" ? (
              <ProjectMembers project={project} />
            ) : section === "settings" && project.can_manage ? (
              <ProjectSettings key={project.id} project={project} />
            ) : (
              <ProjectSection
                project={{ ...project, space_id: space?.id }}
                section={section}
              />
            )}
          </>
        )}
      </main>
    );
  }
  return (
    <main className="ws-page">
      <PageHeading
        eyebrow="PROJECTS"
        title={uiText("From open questions to shared progress")}
        actions={
          <Button className="button primary" onClick={() => setCreate(true)}>
            <Plus size={17} />
            New project
          </Button>
        }
      >
        <I18nText id="Give each line of research its own files, tasks, discussions, and review space." />
      </PageHeading>
      <ErrorNotice message={data.error} retry={data.reload} />
      {data.loading && !data.data ? (
        <Loading />
      ) : !data.data?.length ? (
        <Empty
          icon={FlaskConical}
          title={uiText("Every project starts with a question")}
        >
          <I18nText id="Create a private-by-default project and invite the right collaborators." />
        </Empty>
      ) : (
        <div className="ws-project-grid">
          {data.data.map((project: any) => (
            <WorkspaceLink
              className="ws-project-card"
              key={project.id}
              to={`/projects/${project.id}/tasks`}
            >
              <div className="ws-project-card-top">
                <span className="ws-resource-glyph">
                  <FlaskConical size={24} strokeWidth={1.5} />
                </span>
                <Badge>
                  {project.archived_at
                    ? uiText("Archived")
                    : project.audience === "restricted"
                      ? "Restricted"
                      : "Group"}
                </Badge>
              </div>
              <h2>{project.name}</h2>
              <p>
                {project.description || "A new direction to explore together."}
              </p>
              <small>{project.group_name}</small>
              <footer>
                <span>
                  {project.open_tasks} <I18nText id="open tasks ·" />{" "}
                  {project.resource_count} <I18nText id="items" />
                </span>
                <ArrowUpRight size={17} />
              </footer>
            </WorkspaceLink>
          ))}
        </div>
      )}
      {create && (
        <CreateProject
          onClose={() => setCreate(false)}
          onCreated={(project) => {
            setCreate(false);
            refresh();
            navigate(`/projects/${project.id}/tasks`);
          }}
        />
      )}
    </main>
  );
}
function CreateProject({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: any) => void;
}) {
  useInterfaceLocale();
  const { session } = useWorkspace(),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [groupId, setGroup] = useState(session.groups[0]?.id ?? ""),
    [timezone, setTimezone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    action = useAction();
  return (
    <Dialog
      title={uiText("A new direction")}
      subtitle={uiText(
        "Projects start restricted to you. Invite collaborators after creating the project.",
      )}
      onClose={() => !action.busy && onClose()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () =>
            onCreated(
              await mutate("projects", {
                name,
                description,
                groupId,
                timezone,
                audience: "restricted",
              }),
            ),
          );
        }}
      >
        <label>
          <I18nText id="Project name" />
          <TextInput
            autoFocus
            required
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            placeholder={uiText("e.g. Learning physical structure")}
          />
        </label>
        <label>
          <I18nText id="Research question or purpose" />
          <TextArea
            value={description}
            maxLength={3000}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
          />
        </label>
        <div className="ws-form-grid">
          <label>
            <I18nText id="Research group" />
            <NativeSelect
              required
              value={groupId}
              onChange={(event) => setGroup(event.target.value)}
            >
              {session.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            <I18nText id="Calendar time zone" />
            <TimeZoneInput
              required
              aria-label={uiText("Calendar time zone")}
              value={timezone}
              onChange={setTimezone}
            />
          </label>
        </div>
        <ErrorNotice message={action.error} />
        <div className="dialog-footer">
          <Button
            data-dialog-cancel
            className="button secondary"
            type="button"
            disabled={action.busy}
            onClick={onClose}
          >
            <I18nText id="Cancel" />
          </Button>
          <Button className="button primary" disabled={action.busy || !groupId}>
            <I18nText id="Create project" />
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function Tasks({ project }: { project: any }) {
  useInterfaceLocale();
  const { revision, refresh, navigate, session } = useWorkspace(),
    { params } = useLocation(),
    [offset, setOffset] = useState(0),
    [previous, setPrevious] = useState<Task[]>([]),
    [view, setView] = useState("board"),
    [search, setSearch] = useState(""),
    [mine, setMine] = useState(false),
    [create, setCreate] = useState(false);
  const result = useData<{ items: Task[]; nextOffset: number | null }>(
      `projects/${project.id}/tasks?limit=100&offset=${offset}`,
      revision,
    ),
    members = useData<any[]>(`projects/${project.id}/members`, revision),
    milestones = useData<any[]>(`projects/${project.id}/milestones`, revision),
    recurrences = useData<any[]>(
      `projects/${project.id}/recurrences`,
      revision,
    ),
    notes = useData<ResourcePage>(
      project.space_id
        ? `resources?spaceId=${project.space_id}&view=all&kind=note&limit=100`
        : null,
      revision,
    ),
    taskData = useData<Task>(
      params.get("task") ? `tasks/${params.get("task")}` : null,
      revision,
    );
  const [recurring, setRecurring] = useState(false),
    action = useAction();
  useEffect(() => {
    setOffset(0);
    setPrevious([]);
  }, [project.id, revision]);
  const all = [
      ...new Map(
        [...previous, ...(result.data?.items ?? [])].map((task) => [
          task.id,
          task,
        ]),
      ).values(),
    ],
    tasks = all.filter(
      (task) =>
        (!mine || task.assignee_id === session.user.id) &&
        `${task.title} ${task.labels.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ),
    editable = project.role === "editor" && !project.archived_at;
  const edit = (task: Task) =>
    navigate(`/projects/${project.id}/tasks?task=${task.id}`);
  const updateStatus = (task: Task, status: Task["status"]) =>
    action.run(async () => {
      await mutate(
        `tasks/${task.id}`,
        { version: task.version, status },
        "PATCH",
      );
      refresh();
    });
  return (
    <>
      <div className="ws-list-toolbar">
        <div className="ws-segmented">
          {[
            ["board", Kanban],
            ["list", List],
            ["calendar", CalendarDays],
          ].map(([value, Icon]) => (
            <button
              key={value as string}
              aria-label={`${value} view`}
              aria-pressed={view === value}
              onClick={() => setView(value as string)}
            >
              {typeof Icon !== "string" && <Icon size={16} />}
              <span>{value as string}</span>
            </button>
          ))}
        </div>
        <SearchField
          wrapperClassName="ws-search-field"
          aria-label={uiText("Filter tasks")}
          placeholder={uiText("Filter tasks or labels…")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button
          className="button secondary"
          aria-pressed={mine}
          onClick={() => setMine(!mine)}
        >
          <I18nText id="Assigned to me" />
        </Button>
        {editable && (
          <>
            <IconButton
              className="icon-button"
              aria-label={uiText("Recurring tasks")}
              onClick={() => setRecurring(true)}
            >
              <Repeat2 size={17} />
            </IconButton>
            <Button className="button primary" onClick={() => setCreate(true)}>
              <Plus size={16} />
              <I18nText id="Task" />
            </Button>
          </>
        )}
      </div>
      <ErrorNotice
        message={result.error || action.error || taskData.error}
        retry={result.error ? result.reload : undefined}
      />
      {result.loading && !result.data && !previous.length ? (
        <Loading label={uiText("Loading tasks…")} />
      ) : view === "calendar" ? (
        <TaskCalendar tasks={tasks} onOpen={edit} timezone={project.timezone} />
      ) : view === "board" ? (
        <div className="ws-board">
          {statuses
            .filter(([status]) => status !== "cancelled")
            .map(([status, label]) => (
              <section
                className="ws-board-column"
                key={status}
                aria-label={label}
              >
                <header>
                  <span className="ws-status-dot" data-status={status} />
                  <h2>{label}</h2>
                  <span>
                    {tasks.filter((task) => task.status === status).length}
                  </span>
                </header>
                <div>
                  {tasks
                    .filter((task) => task.status === status)
                    .map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onOpen={() => edit(task)}
                        onStatus={
                          editable
                            ? (status) => void updateStatus(task, status)
                            : undefined
                        }
                        disabled={action.busy}
                      />
                    ))}
                  {!tasks.some((task) => task.status === status) && (
                    <p className="ws-board-empty">
                      <I18nText id="Nothing here yet." />
                    </p>
                  )}
                </div>
              </section>
            ))}
        </div>
      ) : (
        <div className="ws-task-list">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onOpen={() => edit(task)}
              onStatus={
                editable
                  ? (status) => void updateStatus(task, status)
                  : undefined
              }
              disabled={action.busy}
            />
          ))}
          {!tasks.length && (
            <Empty icon={CheckCircle2} title={uiText("No matching tasks")}>
              <I18nText id="Add a task to turn a question into a next step." />
            </Empty>
          )}
        </div>
      )}
      {tasks.some((task) => task.status === "cancelled") &&
        view === "board" && (
          <p className="ws-small muted">
            <I18nText id="Cancelled tasks remain available in List view." />
          </p>
        )}
      <footer className="ws-list-footer">
        <span>
          {all.length} <I18nText id="tasks loaded" />
          {result.data?.nextOffset !== null &&
          result.data?.nextOffset !== undefined
            ? uiText(
                " · Load more to include later tasks in filters and calendar",
              )
            : ""}
        </span>
        {result.data?.nextOffset !== null &&
          result.data?.nextOffset !== undefined && (
            <Button
              className="button secondary"
              disabled={result.loading}
              onClick={() => {
                setPrevious(all);
                setOffset(result.data!.nextOffset!);
              }}
            >
              <I18nText id="Load more tasks" />
            </Button>
          )}
      </footer>
      {(create || taskData.data) && (
        <TaskDialog
          key={create ? "new" : taskData.data!.id}
          project={project}
          task={create ? undefined : taskData.data!}
          tasks={all}
          members={members.data ?? []}
          milestones={milestones.data ?? []}
          notes={notes.data?.items ?? []}
          editable={editable}
          onClose={() => {
            setCreate(false);
            if (params.get("task")) navigate(`/projects/${project.id}/tasks`);
          }}
          onSaved={() => {
            setCreate(false);
            refresh();
            if (params.get("task")) navigate(`/projects/${project.id}/tasks`);
          }}
        />
      )}
      {recurring && (
        <Recurrences
          project={project}
          rows={recurrences.data ?? []}
          members={members.data ?? []}
          onClose={() => setRecurring(false)}
          onChanged={() => {
            recurrences.reload();
            refresh();
          }}
        />
      )}
    </>
  );
}
function TaskCard({
  task,
  onOpen,
  onStatus,
  disabled,
}: {
  task: Task;
  onOpen: () => void;
  onStatus?: (status: Task["status"]) => void;
  disabled?: boolean;
}) {
  return (
    <article className="ws-task-card">
      <button className="ws-task-title" onClick={onOpen}>
        {task.parent_id && (
          <span className="ws-small muted">
            <I18nText id="Subtask ·" />{" "}
          </span>
        )}
        {task.title}
      </button>
      <div className="ws-task-badges">
        {task.priority !== "normal" && (
          <Badge tone={task.priority === "urgent" ? "danger" : "neutral"}>
            {task.priority}
          </Badge>
        )}
        {task.blocked && (
          <Badge tone="warning">
            <I18nText id="Blocked" />
          </Badge>
        )}
        {task.labels.map((label) => (
          <Badge key={label}>{label}</Badge>
        ))}
      </div>
      <footer>
        <span>{task.assignee_name || "Unassigned"}</span>
        {task.due_on && (
          <time dateTime={dateOnly(task.due_on)}>{dateOnly(task.due_on)}</time>
        )}
      </footer>
      {onStatus && (
        <NativeSelect
          aria-label={`Status of ${task.title}`}
          disabled={disabled}
          value={task.status}
          onChange={(event) => onStatus(event.target.value as Task["status"])}
        >
          {statuses.map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      )}
    </article>
  );
}
function TaskDialog({
  project,
  task,
  tasks,
  members,
  milestones,
  notes,
  editable,
  onClose,
  onSaved,
}: {
  project: any;
  task?: Task;
  tasks: Task[];
  members: any[];
  milestones: any[];
  notes: any[];
  editable: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  useInterfaceLocale();
  const [draft, setDraft] = useState({
      title: task?.title ?? "",
      body: task?.body ?? "",
      status: task?.status ?? "todo",
      priority: task?.priority ?? "normal",
      assigneeId: task?.assignee_id ?? "",
      parentId: task?.parent_id ?? "",
      startOn: dateOnly(task?.start_on),
      dueOn: dateOnly(task?.due_on),
      estimateHours: task?.estimate_hours?.toString() ?? "",
      milestoneId: task?.milestone_id ?? "",
      noteId: task?.note_id ?? "",
      labels: task?.labels.join(", ") ?? "",
      dependencies: task?.dependencies ?? [],
    }),
    action = useAction();
  const field = (key: string, value: unknown) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  return (
    <Dialog
      title={task ? uiText("Research task") : uiText("One clear next step")}
      subtitle={project.name}
      onClose={() => !action.busy && onClose()}
      wide
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            const body = {
              ...draft,
              assigneeId: draft.assigneeId || null,
              parentId: draft.parentId || null,
              startOn: draft.startOn || null,
              dueOn: draft.dueOn || null,
              estimateHours: draft.estimateHours
                ? Number(draft.estimateHours)
                : null,
              milestoneId: draft.milestoneId || null,
              noteId: draft.noteId || null,
              labels: draft.labels
                .split(",")
                .map((label) => label.trim())
                .filter(Boolean),
              ...(task ? { version: task.version } : {}),
            };
            await mutate(
              task ? `tasks/${task.id}` : `projects/${project.id}/tasks`,
              body,
              task ? "PATCH" : "POST",
            );
            onSaved();
          });
        }}
      >
        <fieldset disabled={!editable || action.busy} className="ws-fieldset">
          <label>
            <I18nText id="Title" />
            <TextInput
              autoFocus
              required
              maxLength={200}
              value={draft.title}
              onChange={(event) => field("title", event.target.value)}
            />
          </label>
          <label>
            <I18nText id="Details & acceptance criteria" />
            <TextArea
              rows={4}
              maxLength={100000}
              value={draft.body}
              onChange={(event) => field("body", event.target.value)}
              placeholder={uiText("What evidence will tell us this is done?")}
            />
          </label>
          <div className="ws-form-grid">
            <label>
              <I18nText id="Status" />
              <NativeSelect
                value={draft.status}
                onChange={(event) => field("status", event.target.value)}
              >
                {statuses.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Priority" />
              <NativeSelect
                value={draft.priority}
                onChange={(event) => field("priority", event.target.value)}
              >
                {["low", "normal", "high", "urgent"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Assignee" />
              <NativeSelect
                value={draft.assigneeId}
                onChange={(event) => field("assigneeId", event.target.value)}
              >
                <option value="">
                  <I18nText id="Unassigned" />
                </option>
                {members.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Estimate (hours)" />
              <TextInput
                type="number"
                min={0}
                max={10000}
                step="0.25"
                value={draft.estimateHours}
                onChange={(event) => field("estimateHours", event.target.value)}
              />
            </label>
            <label>
              <I18nText id="Start date" />
              <TextInput
                type="date"
                value={draft.startOn}
                onChange={(event) => field("startOn", event.target.value)}
              />
            </label>
            <label>
              <I18nText id="Due date" />
              <TextInput
                type="date"
                min={draft.startOn || undefined}
                value={draft.dueOn}
                onChange={(event) => field("dueOn", event.target.value)}
              />
            </label>
            <label>
              <I18nText id="Milestone" />
              <NativeSelect
                value={draft.milestoneId}
                onChange={(event) => field("milestoneId", event.target.value)}
              >
                <option value="">
                  <I18nText id="No milestone" />
                </option>
                {milestones.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Linked note" />
              <NativeSelect
                value={draft.noteId}
                onChange={(event) => field("noteId", event.target.value)}
              >
                <option value="">
                  <I18nText id="No linked note" />
                </option>
                {notes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Parent task" />
              <NativeSelect
                value={draft.parentId}
                onChange={(event) => field("parentId", event.target.value)}
              >
                <option value="">
                  <I18nText id="Top-level task" />
                </option>
                {tasks
                  .filter((item) => item.id !== task?.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Labels (comma-separated)" />
              <TextInput
                value={draft.labels}
                onChange={(event) => field("labels", event.target.value)}
              />
            </label>
          </div>
          <fieldset className="ws-dependencies">
            <legend>
              <I18nText id="Blocked by" />
            </legend>
            {tasks
              .filter((item) => item.id !== task?.id)
              .map((item) => (
                <label key={item.id}>
                  <Checkbox
                    checked={draft.dependencies.includes(item.id)}
                    onChange={(event) =>
                      field(
                        "dependencies",
                        event.target.checked
                          ? [...draft.dependencies, item.id]
                          : draft.dependencies.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {item.title}
                </label>
              ))}
            {!tasks.length && (
              <p className="muted">
                <I18nText id="Create another task to add a dependency." />
              </p>
            )}
          </fieldset>
        </fieldset>
        <ErrorNotice message={action.error} />
        <div className="dialog-footer">
          <Button
            type="button"
            className="button secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            {editable ? uiText("Cancel") : uiText("Close")}
          </Button>
          {editable && (
            <Button className="button primary" disabled={action.busy}>
              {action.busy
                ? uiText("Saving…")
                : task
                  ? "Save changes"
                  : "Create task"}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
function TaskCalendar({
  tasks,
  onOpen,
  timezone,
}: {
  tasks: Task[];
  onOpen: (task: Task) => void;
  timezone: string;
}) {
  useInterfaceLocale();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  });
  const days = useMemo(() => {
    const start = new Date(month);
    start.setUTCDate(1 - start.getUTCDay());
    return Array.from(
      { length: 42 },
      (_, index) => new Date(start.valueOf() + index * 86400000),
    );
  }, [month]);
  return (
    <section className="ws-calendar">
      <header>
        <IconButton
          className="icon-button"
          aria-label={uiText("Previous month")}
          onClick={() =>
            setMonth(
              new Date(
                Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1),
              ),
            )
          }
        >
          <ChevronLeft size={18} />
        </IconButton>
        <h2>
          {month.toLocaleDateString(currentLocale(), {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </h2>
        <IconButton
          className="icon-button"
          aria-label={uiText("Next month")}
          onClick={() =>
            setMonth(
              new Date(
                Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1),
              ),
            )
          }
        >
          <ChevronRight size={18} />
        </IconButton>
        <span>
          {timezone} <I18nText id="· Due dates" />
        </span>
      </header>
      <div className="ws-calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="ws-calendar-day-name">
            {day}
          </div>
        ))}
        {days.map((date) => (
          <div
            key={date.toISOString()}
            className={`ws-calendar-day ${date.getUTCMonth() !== month.getUTCMonth() ? "outside" : ""}`}
          >
            <time dateTime={date.toISOString().slice(0, 10)}>
              {date.getUTCDate()}
            </time>
            {tasks
              .filter(
                (task) =>
                  dateOnly(task.due_on) === date.toISOString().slice(0, 10),
              )
              .map((task) => (
                <button key={task.id} onClick={() => onOpen(task)}>
                  <span className="ws-status-dot" data-status={task.status} />
                  {task.title}
                </button>
              ))}
          </div>
        ))}
      </div>
      <p className="ws-small muted">
        {tasks.filter((task) => !task.due_on).length}{" "}
        <I18nText id="loaded tasks without due dates are available in Board or List view." />
      </p>
    </section>
  );
}
function Recurrences({
  project,
  rows,
  members,
  onClose,
  onChanged,
}: {
  project: any;
  rows: any[];
  members: any[];
  onClose: () => void;
  onChanged: () => void;
}) {
  useInterfaceLocale();
  const [title, setTitle] = useState(""),
    [frequency, setFrequency] = useState("weekly"),
    [interval, setInterval] = useState(1),
    [start, setStart] = useState(new Date().toISOString().slice(0, 10)),
    [until, setUntil] = useState(""),
    [assigneeId, setAssignee] = useState(""),
    action = useAction();
  return (
    <Dialog
      title={uiText("Recurring research tasks")}
      subtitle={`Calendar dates use ${project.timezone}. Each occurrence becomes an independent task.`}
      onClose={() => !action.busy && onClose()}
      wide
    >
      {rows.map((row) => (
        <div className="ws-setting-row" key={row.id}>
          <div>
            <strong>{row.template.title}</strong>
            <small>
              <I18nText id="Every" /> {row.rule.interval} {row.rule.frequency}{" "}
              <I18nText id="· From" /> {row.rule.start}
            </small>
          </div>
          <Button
            className="button secondary"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await mutate(
                  `projects/${project.id}/recurrences/${row.id}`,
                  { version: row.version, enabled: !row.enabled },
                  "PATCH",
                );
                onChanged();
              })
            }
          >
            {row.enabled ? uiText("Pause") : uiText("Resume")}
          </Button>
        </div>
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            await mutate(`projects/${project.id}/recurrences`, {
              rule: { frequency, interval, start, ...(until ? { until } : {}) },
              template: { title, assigneeId: assigneeId || null },
            });
            setTitle("");
            onChanged();
          });
        }}
      >
        <h3>
          <I18nText id="New recurring task" />
        </h3>
        <label>
          <I18nText id="Title" />
          <TextInput
            required
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={uiText("e.g. Weekly literature review")}
          />
        </label>
        <div className="ws-form-grid">
          <label>
            <I18nText id="Frequency" />
            <NativeSelect
              value={frequency}
              onChange={(event) => setFrequency(event.target.value)}
            >
              {["daily", "weekly", "monthly"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </NativeSelect>
          </label>
          <label>
            <I18nText id="Every (interval)" />
            <TextInput
              type="number"
              min={1}
              max={52}
              required
              value={interval}
              onChange={(event) => setInterval(Number(event.target.value))}
            />
          </label>
          <label>
            <I18nText id="Start" />
            <TextInput
              type="date"
              required
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            <I18nText id="Until (optional)" />
            <TextInput
              type="date"
              min={start}
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </label>
          <label>
            <I18nText id="Assignee" />
            <NativeSelect
              value={assigneeId}
              onChange={(event) => setAssignee(event.target.value)}
            >
              <option value="">
                <I18nText id="Unassigned" />
              </option>
              {members.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
        <ErrorNotice message={action.error} />
        <div className="dialog-footer">
          <Button
            type="button"
            className="button secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            <I18nText id="Close" />
          </Button>
          <Button className="button primary" disabled={action.busy}>
            <I18nText id="Add recurrence" />
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ProjectSection({
  project,
  section,
}: {
  project: any;
  section: string;
}) {
  useInterfaceLocale();
  const { revision, refresh } = useWorkspace(),
    data = useData<any[]>(`projects/${project.id}/${section}`, revision),
    members = useData<any[]>(`projects/${project.id}/members`, revision),
    [modal, setModal] = useState(false),
    [replyTo, setReplyTo] = useState<string | null>(null),
    [body, setBody] = useState(""),
    [mentions, setMentions] = useState<string[]>([]),
    action = useAction(),
    editable = project.role === "editor" && !project.archived_at;
  return (
    <>
      <ErrorNotice
        message={data.error || action.error}
        retry={data.error ? data.reload : undefined}
      />
      {section === "reviews" ? (
        <Reviews
          project={project}
          rows={data.data ?? []}
          members={members.data ?? []}
        />
      ) : section === "milestones" ? (
        <>
          <div className="ws-section-heading">
            <h2>
              <I18nText id="Research milestones" />
            </h2>
            {editable && (
              <Button className="button primary" onClick={() => setModal(true)}>
                <Plus size={16} />
                <I18nText id="Milestone" />
              </Button>
            )}
          </div>
          {!data.data?.length && !data.loading ? (
            <Empty icon={Flag} title={uiText("Mark the important outcomes")}>
              <I18nText id="Use milestones for submissions, baselines, replications, or project checkpoints." />
            </Empty>
          ) : (
            <div className="ws-milestones">
              {data.data?.map((item) => (
                <article className="ws-card" key={item.id}>
                  <div className="ws-section-heading">
                    <h3>{item.title}</h3>
                    {item.completed_at && (
                      <Badge tone="success">
                        <I18nText id="Complete" />
                      </Badge>
                    )}
                  </div>
                  <p className="muted">
                    {item.due_on
                      ? "Due " + dateOnly(item.due_on)
                      : uiText("No due date")}
                  </p>
                  <progress
                    value={Number(item.completed_tasks)}
                    max={Math.max(1, Number(item.tasks))}
                    aria-label={`${item.title} completed tasks`}
                  />
                  <p>
                    {item.completed_tasks} <I18nText id="of" /> {item.tasks}{" "}
                    <I18nText id="tasks complete" />
                  </p>
                  {editable && (
                    <Button
                      className="button secondary"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await mutate(`projects/${project.id}/milestones`, {
                            id: item.id,
                            version: item.version,
                            title: item.title,
                            dueOn: dateOnly(item.due_on) || null,
                            completed: !item.completed_at,
                          });
                          refresh();
                        })
                      }
                    >
                      {item.completed_at
                        ? uiText("Reopen milestone")
                        : uiText("Mark milestone complete")}
                    </Button>
                  )}
                </article>
              ))}
            </div>
          )}
          {modal && (
            <MilestoneDialog
              project={project}
              onClose={() => setModal(false)}
              onSaved={() => {
                setModal(false);
                refresh();
              }}
            />
          )}
        </>
      ) : section === "discussions" ? (
        <>
          <div className="ws-section-heading">
            <h2>
              <I18nText id="Think together" />
            </h2>
            <Badge>
              <I18nText id="Project discussion" />
            </Badge>
          </div>
          {project.role !== "viewer" && !project.archived_at && (
            <form
              className="ws-card ws-discussion-compose"
              onSubmit={(event) => {
                event.preventDefault();
                void action.run(async () => {
                  await mutate(`projects/${project.id}/discussions`, {
                    body,
                    parentId: replyTo,
                    mentions,
                  });
                  setBody("");
                  setReplyTo(null);
                  setMentions([]);
                  refresh();
                });
              }}
            >
              {replyTo && (
                <p>
                  <I18nText id="Replying to a discussion" />{" "}
                  <button
                    data-dialog-cancel
                    type="button"
                    className="text-button"
                    onClick={() => setReplyTo(null)}
                  >
                    <I18nText id="Cancel reply" />
                  </button>
                </p>
              )}
              <label>
                <I18nText id="Discussion" />
                <TextArea
                  required
                  rows={3}
                  value={body}
                  maxLength={20000}
                  placeholder={uiText(
                    "Share a result, pose a question, or record a decision…",
                  )}
                  onChange={(event) => setBody(event.target.value)}
                />
              </label>
              <details>
                <summary>
                  <I18nText id="Notify specific collaborators" />
                </summary>
                <div className="ws-checkboxes">
                  {members.data?.map((person) => (
                    <label key={person.id}>
                      <Checkbox
                        checked={mentions.includes(person.id)}
                        onChange={(event) =>
                          setMentions((previous) =>
                            event.target.checked
                              ? [...previous, person.id]
                              : previous.filter((id) => id !== person.id),
                          )
                        }
                      />
                      {person.name}
                    </label>
                  ))}
                </div>
              </details>
              <Button
                className="button primary"
                disabled={action.busy || !body.trim()}
              >
                <MessageSquare size={15} />
                <I18nText id="Post discussion" />
              </Button>
            </form>
          )}
          {data.data
            ?.filter((row) => !row.parent_id)
            .map((thread) => (
              <article className="ws-discussion" key={thread.id}>
                <header>
                  <strong>{thread.author_name}</strong>
                  <small>{timeAgo(thread.created_at)}</small>
                </header>
                <p className="ws-preserve-lines">{thread.body}</p>
                {data.data
                  ?.filter((reply) => reply.parent_id === thread.id)
                  .map((reply) => (
                    <div className="ws-discussion-reply" key={reply.id}>
                      <strong>{reply.author_name}</strong>
                      <small>{timeAgo(reply.created_at)}</small>
                      <p className="ws-preserve-lines">{reply.body}</p>
                    </div>
                  ))}
                {project.role !== "viewer" && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setReplyTo(thread.id);
                      document
                        .querySelector<HTMLTextAreaElement>(
                          ".ws-discussion-compose textarea",
                        )
                        ?.focus();
                    }}
                  >
                    <I18nText id="Reply" />
                  </button>
                )}
              </article>
            ))}
          {!data.data?.length && !data.loading && (
            <Empty
              icon={MessageSquare}
              title={uiText("A conversation waiting to happen")}
            >
              <I18nText id="Make space for questions and decisions that should outlast a chat message." />
            </Empty>
          )}
        </>
      ) : section === "workload" ? (
        <>
          <h2>
            <I18nText id="Workload at a glance" />
          </h2>
          <p className="muted">
            <I18nText id="Estimates below cover all open tasks in this project, not only the current week. Weekly capacity is a personal planning reference." />
          </p>
          <div className="ws-workload">
            {data.data?.map((person) => (
              <div className="ws-card" key={person.id}>
                <h3>{person.name}</h3>
                <dl className="ws-facts">
                  <div>
                    <dt>
                      <I18nText id="Open tasks" />
                    </dt>
                    <dd>{person.open_tasks}</dd>
                  </div>
                  <div>
                    <dt>
                      <I18nText id="Estimated open work" />
                    </dt>
                    <dd>{Number(person.estimated_hours)} h</dd>
                  </div>
                  <div>
                    <dt>
                      <I18nText id="Unestimated tasks" />
                    </dt>
                    <dd>{person.unestimated}</dd>
                  </div>
                  <div>
                    <dt>
                      <I18nText id="Weekly capacity" />
                    </dt>
                    <dd>{Number(person.weekly_capacity)} h</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </>
      ) : section === "activity" ? (
        <>
          <h2>
            <I18nText id="Project activity" />
          </h2>
          {data.data?.map((event) => (
            <div key={event.id} className="ws-activity">
              <p>{event.title}</p>
              <small>
                {event.actor_name || "Former member"} ·{" "}
                {timeAgo(event.created_at)}
              </small>
            </div>
          ))}
          {!data.data?.length && !data.loading && (
            <Empty icon={Circle} title={uiText("A fresh chapter")}>
              <I18nText id="Project changes and decisions will appear here." />
            </Empty>
          )}
        </>
      ) : (
        <Empty title={uiText("Section unavailable")}>
          <I18nText id="Choose a project section above." />
        </Empty>
      )}
      {data.loading && !data.data && <Loading />}
    </>
  );
}
function MilestoneDialog({
  project,
  onClose,
  onSaved,
}: {
  project: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  useInterfaceLocale();
  const [title, setTitle] = useState(""),
    [dueOn, setDue] = useState(""),
    action = useAction();
  return (
    <Dialog
      title={uiText("A meaningful checkpoint")}
      onClose={() => !action.busy && onClose()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            await mutate(`projects/${project.id}/milestones`, {
              title,
              dueOn: dueOn || null,
            });
            onSaved();
          });
        }}
      >
        <label>
          <I18nText id="Milestone title" />
          <TextInput
            required
            autoFocus
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          <I18nText id="Target date" />
          <TextInput
            type="date"
            value={dueOn}
            onChange={(event) => setDue(event.target.value)}
          />
        </label>
        <ErrorNotice message={action.error} />
        <div className="dialog-footer">
          <Button
            data-dialog-cancel
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={action.busy}
          >
            <I18nText id="Cancel" />
          </Button>
          <Button className="button primary" disabled={action.busy}>
            <I18nText id="Create milestone" />
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function Reviews({
  project,
  rows,
  members,
}: {
  project: any;
  rows: any[];
  members: any[];
}) {
  useInterfaceLocale();
  const { revision, refresh, session, open } = useWorkspace(),
    [create, setCreate] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [noteId, setNote] = useState(""),
    [reviewerId, setReviewer] = useState(""),
    [message, setMessage] = useState(""),
    [response, setResponse] = useState(""),
    action = useAction(),
    notes = useData<ResourcePage>(
      project.space_id && create
        ? `resources?spaceId=${project.space_id}&view=all&kind=note&limit=100`
        : null,
      revision,
    );
  const reply = (status: string) =>
    action.run(async () => {
      await mutate(
        `reviews/${selected.id}`,
        { version: selected.version, status, response },
        "PATCH",
      );
      setSelected(null);
      refresh();
    });
  return (
    <>
      <div className="ws-section-heading">
        <h2>
          <I18nText id="Review the evidence" />
        </h2>
        {project.role === "editor" && !project.archived_at && (
          <Button className="button primary" onClick={() => setCreate(true)}>
            <Plus size={16} />
            <I18nText id="Request review" />
          </Button>
        )}
      </div>
      <p className="muted">
        <I18nText id="Every review pins an immutable note snapshot. Later edits are clearly marked." />
      </p>
      {rows.map((review) => (
        <button
          className="ws-review-row"
          key={review.id}
          onClick={() => {
            setSelected(review);
            setResponse(review.response ?? "");
          }}
        >
          <CheckCircle2 size={20} />
          <div>
            <strong>{review.note_title}</strong>
            <small>
              {review.reviewer_name} · {timeAgo(review.created_at)}
            </small>
          </div>
          <Badge tone={review.status === "approved" ? "success" : "neutral"}>
            {review.status.replaceAll("_", " ")}
          </Badge>
          {review.outdated && (
            <Badge tone="warning">
              <I18nText id="Note has newer edits" />
            </Badge>
          )}
        </button>
      ))}
      {!rows.length && (
        <Empty icon={CheckCircle2} title={uiText("A second pair of eyes")}>
          <I18nText id="Request a review of a project note before relying on a result or sharing a conclusion." />
        </Empty>
      )}
      {create && (
        <Dialog
          title={uiText("Request a note review")}
          subtitle={uiText(
            "The server captures the current synchronized revision. Reviewers will read that specific snapshot.",
          )}
          onClose={() => !action.busy && setCreate(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                await mutate(`projects/${project.id}/reviews`, {
                  noteId,
                  reviewerId,
                  message,
                });
                setCreate(false);
                setMessage("");
                refresh();
              });
            }}
          >
            <label>
              <I18nText id="Project note" />
              <NativeSelect
                required
                value={noteId}
                onChange={(event) => setNote(event.target.value)}
              >
                <option value="">
                  <I18nText id="Choose a note" />
                </option>
                {notes.data?.items.map((note) => (
                  <option key={note.id} value={note.id}>
                    {note.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Reviewer" />
              <NativeSelect
                required
                value={reviewerId}
                onChange={(event) => setReviewer(event.target.value)}
              >
                <option value="">
                  <I18nText id="Choose a collaborator" />
                </option>
                {members
                  .filter((person) => person.role !== "viewer")
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
              </NativeSelect>
            </label>
            <label>
              <I18nText id="What should they check?" />
              <TextArea
                rows={3}
                value={message}
                maxLength={5000}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            <ErrorNotice message={action.error || notes.error} />
            <div className="dialog-footer">
              <Button
                data-dialog-cancel
                className="button secondary"
                type="button"
                onClick={() => setCreate(false)}
                disabled={action.busy}
              >
                <I18nText id="Cancel" />
              </Button>
              <Button
                className="button primary"
                disabled={action.busy || !noteId || !reviewerId}
              >
                <I18nText id="Request review" />
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {selected && (
        <Dialog
          title={selected.note_title}
          subtitle={`Review snapshot · ${selected.reviewer_name}`}
          wide
          onClose={() => !action.busy && setSelected(null)}
        >
          {selected.outdated && (
            <HelpText>
              <I18nText id="This is an older snapshot. Any decision applies only to this revision, not the newer live note." />
            </HelpText>
          )}
          {selected.message && (
            <blockquote className="ws-preserve-lines">
              {selected.message}
            </blockquote>
          )}
          <div className="ws-review-snapshot">
            <ReadingView
              parsed={parseMarkdown(selected.reviewed_body)}
              context={{ references: {}, resolveLink: () => undefined }}
              onLink={() => {}}
            />
          </div>
          <Button
            className="button secondary"
            onClick={() => {
              setSelected(null);
              open({ kind: "note", id: selected.note_id });
            }}
          >
            <I18nText id="Open live note" />
          </Button>
          <label>
            <I18nText id="Review response" />
            <TextArea
              rows={3}
              value={response}
              maxLength={10000}
              readOnly={selected.reviewer_id !== session.user.id}
              onChange={(event) => setResponse(event.target.value)}
            />
          </label>
          <ErrorNotice message={action.error} />
          <div className="dialog-footer">
            {selected.status === "pending" &&
              selected.reviewer_id === session.user.id && (
                <>
                  <Button
                    className="button secondary"
                    disabled={action.busy}
                    onClick={() => void reply("changes_requested")}
                  >
                    <I18nText id="Request changes" />
                  </Button>
                  <Button
                    className="button primary"
                    disabled={action.busy}
                    onClick={() => void reply("approved")}
                  >
                    <I18nText id="Approve this revision" />
                  </Button>
                </>
              )}
            {selected.status === "pending" &&
              (selected.requested_by === session.user.id ||
                project.can_manage) && (
                <Button
                  data-dialog-cancel
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() => void reply("cancelled")}
                >
                  <I18nText id="Cancel request" />
                </Button>
              )}
          </div>
        </Dialog>
      )}
    </>
  );
}
export function ProjectMembers({ project }: { project: any }) {
  useInterfaceLocale();
  const { revision, refresh } = useWorkspace(),
    data = useData<any[]>(`projects/${project.id}/members`, revision),
    people = useData<any[]>(
      project.can_manage ? `people?groupId=${project.group_id}` : null,
      revision,
    ),
    [adding, setAdding] = useState(false),
    [person, setPerson] = useState(""),
    [role, setRole] = useState("editor"),
    [lead, setLead] = useState(false),
    action = useAction();
  return (
    <>
      <div className="ws-section-heading">
        <h2>
          <I18nText id="Workspace collaborators" />
        </h2>
        {project.can_manage && (
          <Button className="button primary" onClick={() => setAdding(true)}>
            <Plus size={16} />
            <I18nText id="Add member" />
          </Button>
        )}
      </div>
      <p className="muted">
        {project.audience === "group"
          ? uiText(
              "The whole group can access this workspace. Removing an explicit role restores that person’s group content role; it does not remove access.",
            )
          : uiText(
              "Only explicitly invited workspace members can read this workspace. Group administrators manage access without automatic access to its contents.",
            )}{" "}
        <I18nText id="Leads manage membership; content roles determine reading, commenting, and editing." />
      </p>
      <ErrorNotice
        message={data.error || action.error}
        retry={data.error ? data.reload : undefined}
      />
      {data.data?.map((person) => (
        <div className="ws-member-row" key={person.id}>
          <Avatar person={person} />
          <div>
            <strong>{person.name}</strong>
            <small>
              {person.can_manage
                ? uiText("Workspace lead")
                : uiText("Collaborator")}
              {!person.explicit ? uiText(" · Group access") : ""}
            </small>
          </div>
          {project.can_manage ? (
            <>
              <NativeSelect
                aria-label={`Content role for ${person.name}`}
                value={person.role}
                disabled={action.busy}
                onChange={(event) =>
                  void action.run(async () => {
                    await mutate(`projects/${project.id}/members`, {
                      userId: person.id,
                      role: event.target.value,
                      canManage: person.can_manage,
                    });
                    refresh();
                  })
                }
              >
                {["viewer", "commenter", "editor"].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </NativeSelect>
              <Button
                className="button secondary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await mutate(`projects/${project.id}/members`, {
                      userId: person.id,
                      role: person.role,
                      canManage: !person.can_manage,
                    });
                    refresh();
                  })
                }
              >
                {person.can_manage
                  ? uiText("Remove lead role")
                  : uiText("Make lead")}
              </Button>
              {person.explicit && (
                <button
                  className="text-button danger-text"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await mutate(`projects/${project.id}/members`, {
                        userId: person.id,
                        remove: true,
                      });
                      refresh();
                    })
                  }
                >
                  <I18nText id="Remove" />
                </button>
              )}
            </>
          ) : (
            <Badge>{person.role}</Badge>
          )}
        </div>
      ))}
      {adding && (
        <Dialog
          title={uiText("Add a workspace collaborator")}
          subtitle={uiText(
            "Only existing group members can be invited to a workspace.",
          )}
          onClose={() => !action.busy && setAdding(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                await mutate(`projects/${project.id}/members`, {
                  userId: person,
                  role,
                  canManage: lead,
                });
                setAdding(false);
                refresh();
              });
            }}
          >
            <label>
              <I18nText id="Researcher" />
              <NativeSelect
                required
                value={person}
                onChange={(event) => setPerson(event.target.value)}
              >
                <option value="">
                  <I18nText id="Choose a group member" />
                </option>
                {people.data?.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Content role" />
              <NativeSelect
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                {["viewer", "commenter", "editor"].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </NativeSelect>
            </label>
            <label className="ws-checkbox">
              <Checkbox
                checked={lead}
                onChange={(event) => setLead(event.target.checked)}
              />
              <I18nText id="Can manage this workspace’s settings and members" />
            </label>
            <ErrorNotice message={action.error || people.error} />
            <div className="dialog-footer">
              <Button
                data-dialog-cancel
                type="button"
                className="button secondary"
                disabled={action.busy}
                onClick={() => setAdding(false)}
              >
                <I18nText id="Cancel" />
              </Button>
              <Button
                className="button primary"
                disabled={action.busy || !person}
              >
                <I18nText id="Add collaborator" />
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
export function ProjectSettings({ project }: { project: any }) {
  useInterfaceLocale();
  const { refresh } = useWorkspace(),
    [baseVersion, setBaseVersion] = useState(project.version),
    [name, setName] = useState(project.name),
    [description, setDescription] = useState(project.description),
    [color, setColor] = useState(project.color ?? "blue"),
    [timezone, setTimezone] = useState(project.timezone),
    [audience, setAudience] = useState(project.audience),
    [confirmed, setConfirmed] = useState(false),
    [archived, setArchived] = useState(!!project.archived_at),
    action = useAction(),
    [message, setMessage] = useState("");
  const draft = JSON.stringify({
    name,
    description,
    timezone,
    audience,
    color,
    archived,
  });
  const [baseline, setBaseline] = useState(draft),
    dirty = baseline !== draft;
  const reset = () => {
    setName(project.name);
    setDescription(project.description);
    setTimezone(project.timezone);
    setAudience(project.audience);
    setColor(project.color ?? "blue");
    setArchived(!!project.archived_at);
    setConfirmed(false);
    setBaseVersion(project.version);
    setBaseline(
      JSON.stringify({
        name: project.name,
        description: project.description,
        timezone: project.timezone,
        audience: project.audience,
        color: project.color ?? "blue",
        archived: !!project.archived_at,
      }),
    );
  };
  useEffect(() => {
    if (!dirty) reset();
  }, [project.version]);
  return (
    <form
      className="ws-settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(async () => {
          const saved = await mutate<{ version: number }>(
            `projects/${project.id}`,
            {
              version: baseVersion,
              name,
              description,
              color,
              timezone,
              audience,
              confirmAudience: confirmed,
              archived,
            },
            "PATCH",
          );
          setBaseVersion(saved.version);
          setBaseline(draft);
          setMessage("Project settings saved.");
          refresh();
        });
      }}
    >
      <label>
        <I18nText id="Project name" />
        <TextInput
          required
          maxLength={200}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        <I18nText id="Description" />
        <TextArea
          rows={4}
          maxLength={3000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label>
        <I18nText id="Calendar time zone" />
        <TimeZoneInput
          required
          aria-label={uiText("Calendar time zone")}
          value={timezone}
          onChange={setTimezone}
        />
      </label>
      <label>
        <I18nText id="Project color" />
        <NativeSelect
          aria-label={uiText("Project color")}
          value={color}
          onChange={(event) => setColor(event.target.value)}
        >
          {["blue", "green", "purple", "orange"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </NativeSelect>
      </label>
      <label>
        <I18nText id="Who can access this project?" />
        <NativeSelect
          value={audience}
          onChange={(event) => {
            setAudience(event.target.value);
            setConfirmed(false);
          }}
        >
          <option value="restricted">
            <I18nText id="Explicit project members" />
          </option>
          <option value="group">
            <I18nText id="Entire group" />
          </option>
        </NativeSelect>
      </label>
      {audience !== project.audience && (
        <label className="ws-checkbox">
          <Checkbox
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <I18nText id="I understand that this changes access to every note, file, task, discussion, and review in the project." />
        </label>
      )}
      <label className="ws-checkbox">
        <Checkbox
          checked={archived}
          onChange={(event) => setArchived(event.target.checked)}
        />
        <I18nText id="Archive this project (keep its contents)" />
      </label>
      <ErrorNotice message={action.error} />
      {message && <p role="status">{message}</p>}
      {dirty && baseVersion !== project.version && (
        <HelpText>
          <I18nText id="This project changed elsewhere. Your draft is preserved; saving will reject a stale revision. Cancel changes to load the latest version." />
        </HelpText>
      )}
      <ActionRow>
        <Button
          data-dialog-cancel
          type="button"
          className="button secondary"
          disabled={!dirty || action.busy}
          onClick={reset}
        >
          <I18nText id="Cancel changes" />
        </Button>
        <Button
          className="button primary"
          disabled={
            !dirty ||
            action.busy ||
            (audience !== project.audience && !confirmed)
          }
          pending={!!action.busy}
        >
          {uiText("Save project settings")}
        </Button>
      </ActionRow>
      <DraftGuard dirty={dirty} title={uiText("Unsaved project settings")} />
    </form>
  );
}
