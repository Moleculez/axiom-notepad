"use client";
import TimeZoneInput from "../TimeZoneInput";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  Blocks,
  ChartGantt,
  CheckCheck,
  FileText,
  FolderOpen,
  History,
  MessageSquare,
  Plus,
  Settings2,
  Users,
} from "lucide-react";
import type { Space } from "@axiom/shared/workspace";
import type { PlanningCalendar, PlanningTask } from "@axiom/shared/planning";
import { calendarSchema } from "@axiom/shared/planning";
import { tabRoute } from "@axiom/shared/application-tabs";
import { publishSessionTitle } from "../../lib/workspace-sessions";
import Dialog from "../Dialog";
import DraftGuard from "./DraftGuard";
import { useManagement } from "./ManagementActions";
import {
  Badge,
  Empty,
  ErrorNotice,
  go,
  Loading,
  mutate,
  PageHeading,
  useAction,
  useData,
  useLocation,
  useWorkspace,
  WorkspaceLink,
} from "./ui";
const Explorer = dynamic(() => import("./Explorer"));
const Planning = dynamic(() => import("./WorkspacePlanning"));
const Discussion = dynamic(() =>
  import("./WorkspacePlanning").then((m) => m.WorkspaceDiscussion),
);
const ReviewInbox = dynamic(() => import("../revisions/ReviewInbox"));
const AuditPage = dynamic(() => import("./AuditPage"));
const StorageSettings = dynamic(() =>
  import("./Settings").then((m) => m.StorageSettings),
);
const ProjectMembers = dynamic(() =>
  import("./Projects").then((m) => m.ProjectMembers),
);
const Lifecycle = dynamic(() =>
  import("./WorkspacesPage").then((m) => m.WorkspaceLifecycle),
);
const ProviderSettings = dynamic(() => import("../tools/ProviderSettings"));
const sections = [
  ["overview", "Overview", Blocks],
  ["files", "Files", FolderOpen],
  ["planning", "Planning", ChartGantt],
  ["discussions", "Discussions", MessageSquare],
  ["reviews", "Reviews", CheckCheck],
] as const;
const settingsSections = [
  "general",
  "people",
  "storage",
  "integrations",
  "activity",
  "lifecycle",
];
import {
  workspaceResumeKey as resumeKey,
  workspaceDestination,
  workspaceSectionDestination as sectionDestination,
} from "../../lib/workspace-navigation";
export function LegacyProjectRedirect({
  id,
  section,
}: {
  id?: string;
  section?: string;
}) {
  const { spaces } = useWorkspace(),
    { params } = useLocation();
  useEffect(() => {
    if (!id) {
      go("/workspaces", true);
      return;
    }
    const space = spaces.find((s) => s.project_id === id);
    if (space) {
      const target =
        section === "settings"
          ? "settings/general"
          : section === "members"
            ? "settings/people"
            : section === "discussions"
              ? "discussions"
              : section === "reviews"
                ? "reviews"
                : section === "activity"
                  ? "settings/activity"
                  : "planning";
      const query = new URLSearchParams(params);
      if (section === "workload") query.set("view", "workload");
      go(
        `/workspaces/${space.id}/${target}${query.size ? "?" + query : ""}`,
        true,
      );
    }
  }, [id, section, spaces]);
  return id && !spaces.some((s) => s.project_id === id) ? (
    <Empty title="Workspace unavailable">
      This old project link no longer grants access.{" "}
      <WorkspaceLink to="/workspaces">Browse workspaces</WorkspaceLink>
    </Empty>
  ) : (
    <Loading label="Opening workspace…" />
  );
}
export default function UnifiedWorkspace({
  id,
  section,
  setting,
}: {
  id?: string;
  section?: string;
  setting?: string;
}) {
  const { session, revision } = useWorkspace(),
    { params, path } = useLocation(),
    management = useManagement();
  const detail = useData<{ space: Space }>(
      id ? `spaces/${id}` : null,
      revision,
    ),
    space = detail.data?.space;
  useEffect(() => {
    if (!id) return;
    if (!section) {
      go(workspaceDestination(session.user.id, id), true);
      return;
    }
    if (settingsSections.includes(section) || section === "invitations") {
      go(
        `/workspaces/${id}/settings/${section === "invitations" ? "people" : section}`,
        true,
      );
      return;
    }
    const query = new URLSearchParams(params);
    query.delete("task");
    query.delete("create");
    try {
      localStorage.setItem(
        resumeKey(session.user.id, id),
        tabRoute(
          `/workspaces/${id}/${section}${setting ? "/" + setting : ""}${query.size ? "?" + query : ""}`,
        ),
      );
      localStorage.setItem(
        resumeKey(session.user.id, id) + ":" + section,
        tabRoute(
          `/workspaces/${id}/${section}${setting ? "/" + setting : ""}${query.size ? "?" + query : ""}`,
        ),
      );
    } catch {}
  }, [session.user.id, id, section, setting, params.toString()]);
  useEffect(() => {
    if (space)
      publishSessionTitle(path + (params.size ? `?${params}` : ""), space.name);
  }, [space?.id, space?.name, path, params.toString()]);
  if (!id) return <WorkspaceDirectory />;
  if (!space)
    return (
      <div className="ws-page">
        <ErrorNotice message={detail.error} retry={detail.reload} />
        {detail.loading && <Loading label="Opening workspace…" />}
      </div>
    );
  const current = section ?? "overview";
  return (
    <section
      className="unified-workspace"
      aria-label={`${space.name} workspace`}
    >
      <header className="unified-workspace-header">
        <div className={`workspace-monogram color-${space.color ?? "blue"}`}>
          <Blocks size={23} />
        </div>
        <div className="unified-workspace-title">
          <div>
            <h1>{space.name}</h1>
            {space.effective_status !== "active" && (
              <Badge>{space.effective_status}</Badge>
            )}
          </div>
          <p>
            {space.group_name ?? "Personal workspace"}
            {space.audience === "restricted" ? " · Restricted access" : ""}
            {space.description ? ` · ${space.description}` : ""}
          </p>
        </div>
        <button
          className="icon-button"
          title="Workspace actions"
          aria-label="Workspace actions"
          onClick={(e) => management.workspaceMenu(e, space)}
        >
          <Settings2 size={19} />
        </button>
      </header>
      <nav className="unified-workspace-nav" aria-label="Workspace sections">
        {sections.map(([key, label, Icon]) => (
          <WorkspaceLink
            key={key}
            to={sectionDestination(session.user.id, id, key)}
            className={current === key ? "active" : ""}
            aria-current={current === key ? "page" : undefined}
          >
            <Icon size={16} />
            {label}
          </WorkspaceLink>
        ))}
        <span />
        <WorkspaceLink
          to={`/workspaces/${id}/settings/general`}
          className={current === "settings" ? "active" : ""}
          aria-current={current === "settings" ? "page" : undefined}
        >
          <Settings2 size={16} />
          Settings
        </WorkspaceLink>
      </nav>
      <div className={`unified-workspace-content section-${current}`}>
        {current === "settings" ? (
          <WorkspaceSettings
            key={space.id}
            space={space}
            section={setting ?? "general"}
          />
        ) : !space.role ? (
          <Empty title="Content access required">
            Administrative access does not grant permission to read this
            workspace. Use Settings to manage its lifecycle and access.
          </Empty>
        ) : current === "files" ? (
          <Explorer />
        ) : current === "planning" ? (
          <Planning key={space.id} space={space} />
        ) : current === "discussions" ? (
          <Discussion key={space.id} space={space} />
        ) : current === "reviews" ? (
          <ReviewInbox spaceId={space.id} />
        ) : (
          <WorkspaceOverview space={space} />
        )}
      </div>
    </section>
  );
}
function WorkspaceDirectory() {
  const { revision } = useWorkspace(),
    data = useData<Space[]>("spaces?manage=1&summary=1", revision),
    [search, setSearch] = useState(""),
    [creating, setCreating] = useState(false),
    [state, setState] = useState("active");
  return (
    <main className="ws-page workspace-directory-page">
      <PageHeading
        title="Workspaces"
        eyebrow="RESEARCH, TOGETHER"
        actions={
          <button className="button primary" onClick={() => setCreating(true)}>
            <Plus size={16} />
            New workspace
          </button>
        }
      >
        One home for your files, plans, evidence and conversations.
      </PageHeading>
      <div className="workspace-directory-filters">
        <input
          type="search"
          aria-label="Find a workspace"
          placeholder="Find a workspace…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Workspace state"
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="">All states</option>
        </select>
        <WorkspaceLink to="/groups" className="button secondary">
          <Users size={16} />
          Manage groups
        </WorkspaceLink>
      </div>
      <ErrorNotice message={data.error} retry={data.reload} />
      {data.loading && !data.data && <Loading />}
      <div className="unified-workspace-grid">
        {data.data
          ?.filter(
            (s) =>
              (!state || s.effective_status === state) &&
              `${s.name} ${s.group_name ?? ""} ${s.description ?? ""}`
                .toLowerCase()
                .includes(search.toLowerCase()),
          )
          .map((space) => (
            <WorkspaceDirectoryCard key={space.id} space={space} />
          ))}
      </div>
      {creating && <CreateWorkspace onClose={() => setCreating(false)} />}
    </main>
  );
}
function WorkspaceDirectoryCard({ space }: { space: Space }) {
  const { session } = useWorkspace(),
    management = useManagement();
  return (
    <article
      className="unified-workspace-card"
      onContextMenu={(e) => management.workspaceMenu(e, space)}
    >
      <div className={`workspace-monogram color-${space.color ?? "blue"}`}>
        <Blocks size={24} />
      </div>
      <WorkspaceLink
        to={
          space.role
            ? workspaceDestination(session.user.id, space.id)
            : `/workspaces/${space.id}/settings/lifecycle`
        }
      >
        <h2>{space.name}</h2>
        <ArrowUpRight size={17} />
      </WorkspaceLink>
      <p>
        {space.description ||
          "A place for research and the work that moves it forward."}
      </p>
      <footer>
        <span>{space.group_name ?? "Personal"}</span>
        <Badge>
          {space.effective_status !== "active"
            ? space.effective_status
            : (space.role ?? "Manager")}
        </Badge>
      </footer>
    </article>
  );
}
function CreateWorkspace({ onClose }: { onClose: () => void }) {
  const { session, refresh, navigate } = useWorkspace(),
    action = useAction(),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [group, setGroup] = useState(session.groups[0]?.id ?? ""),
    [audience, setAudience] = useState("restricted");
  return (
    <Dialog
      title="Create a workspace"
      subtitle="Connect files, research tasks, milestones and conversations. Personal planning is already available in your personal workspace."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const result = await mutate("spaces", {
              name,
              description,
              groupId: group,
              audience,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            refresh();
            onClose();
            navigate(`/workspaces/${result.space_id}/overview`);
          });
        }}
      >
        <label>
          Name
          <input
            autoFocus
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            rows={3}
            maxLength={3000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="planning-field-grid">
          <label>
            Group
            <select
              required
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              {session.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Access
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            >
              <option value="restricted">Invited workspace members</option>
              <option value="group">Everyone in the group</option>
            </select>
          </label>
        </div>
        {!session.groups.length && (
          <p>
            Create or join a group first.{" "}
            <WorkspaceLink to="/groups">Open groups</WorkspaceLink>
          </p>
        )}
        <ErrorNotice message={action.error} />
        <div className="dialog-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={action.busy || !name.trim() || !group}
          >
            Create workspace
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function WorkspaceOverview({ space }: { space: Space }) {
  const { revision } = useWorkspace(),
    data = useData<{
      recent: any[];
      tasks: PlanningTask[];
      milestones: any[];
      reviews: any[];
      activity: any[];
    }>(`spaces/${space.id}/overview`, revision);
  return (
    <div className="workspace-overview">
      <div className="workspace-overview-intro">
        <h2>Bring the work into focus.</h2>
        <p>
          Start with a question, keep the evidence close, and make the next step
          clear.
        </p>
        <div className="ws-actions">
          <WorkspaceLink
            className="button primary"
            to={`/workspaces/${space.id}/planning?task=new`}
          >
            <Plus size={16} />
            Plan a task
          </WorkspaceLink>
          <WorkspaceLink
            className="button secondary"
            to={`/workspaces/${space.id}/planning?view=gantt`}
          >
            <ChartGantt size={16} />
            Open timeline
          </WorkspaceLink>
        </div>
      </div>
      <ErrorNotice message={data.error} retry={data.reload} />
      {data.loading && !data.data ? (
        <Loading />
      ) : (
        data.data && (
          <div className="workspace-overview-grid">
            <OverviewSection
              title="Next steps"
              to={`/workspaces/${space.id}/planning`}
              empty={!data.data.tasks.length}
              message="No open tasks yet."
            >
              {data.data.tasks.map((t) => (
                <WorkspaceLink
                  key={t.id}
                  to={`/workspaces/${space.id}/planning?task=${t.id}`}
                >
                  <span className={`task-status-dot ${t.status}`} />
                  <strong>{t.title}</strong>
                  <small>{t.due_on ?? "Unscheduled"}</small>
                </WorkspaceLink>
              ))}
            </OverviewSection>
            <OverviewSection
              title="Recent files"
              to={`/workspaces/${space.id}/files`}
              empty={!data.data.recent.length}
              message="Add your first research note or file."
            >
              {data.data.recent.map((r) => (
                <WorkspaceLink
                  key={r.id}
                  to={
                    r.kind === "folder"
                      ? `/workspaces/${space.id}/files?folder=${r.id}`
                      : `/${r.kind === "file" ? "files" : "notes"}/${r.id}`
                  }
                >
                  <FileText size={16} />
                  <strong>{r.name}</strong>
                </WorkspaceLink>
              ))}
            </OverviewSection>
            <OverviewSection
              title="Upcoming milestones"
              to={`/workspaces/${space.id}/planning?view=gantt`}
              empty={!data.data.milestones.length}
              message="Milestones make review points visible."
            >
              {data.data.milestones.map((m) => (
                <div key={m.id}>
                  <strong>{m.title}</strong>
                  <small>{m.due_on?.slice(0, 10) ?? "No target date"}</small>
                </div>
              ))}
            </OverviewSection>
            <OverviewSection
              title="Reviews & decisions"
              to={`/workspaces/${space.id}/reviews`}
              empty={!data.data.reviews.length}
              message="No pending reviews. Request a review from a file’s version history."
            >
              {data.data.reviews.map((r) => (
                <WorkspaceLink
                  key={r.id}
                  to={`/notes/${r.resource_id ?? r.note_id}`}
                >
                  <CheckCheck size={16} />
                  <strong>{r.title}</strong>
                  <small>{r.status}</small>
                </WorkspaceLink>
              ))}
            </OverviewSection>
            <OverviewSection
              title="Recent activity"
              to={`/workspaces/${space.id}/settings/activity`}
              empty={!data.data.activity.length}
              message="Changes will appear here."
            >
              {data.data.activity.map((a) => (
                <div key={a.id}>
                  <History size={15} />
                  <strong>{a.title}</strong>
                  <small>{new Date(a.created_at).toLocaleDateString()}</small>
                </div>
              ))}
            </OverviewSection>
          </div>
        )
      )}
    </div>
  );
}
function OverviewSection({
  title,
  to,
  empty,
  message,
  children,
}: {
  title: string;
  to: string;
  empty: boolean;
  message: string;
  children: React.ReactNode;
}) {
  return (
    <section className="workspace-overview-card">
      <header>
        <h3>{title}</h3>
        <WorkspaceLink to={to} aria-label={`Open ${title}`}>
          <ArrowUpRight size={17} />
        </WorkspaceLink>
      </header>
      {empty ? (
        <p>{message}</p>
      ) : (
        <div className="workspace-overview-items">{children}</div>
      )}
    </section>
  );
}

function WorkspaceSettings({
  space,
  section,
}: {
  space: Space;
  section: string;
}) {
  const people = useData<any[]>(
    space.role ? `spaces/${space.id}/planning-members` : null,
  );
  return (
    <div className="workspace-settings-layout">
      <nav aria-label="Workspace settings">
        {settingsSections.map((key) => (
          <WorkspaceLink
            key={key}
            to={`/workspaces/${space.id}/settings/${key}`}
            className={section === key ? "active" : ""}
          >
            {key[0].toUpperCase() + key.slice(1)}
          </WorkspaceLink>
        ))}
        {space.group_id && (
          <WorkspaceLink to={`/admin/${space.group_id}/overview`}>
            <Users size={15} />
            Group administration ↗
          </WorkspaceLink>
        )}
      </nav>
      <div className="workspace-settings-body">
        {section === "general" ? (
          <>
            <WorkspaceMetadata key={space.id} space={space} />
            {space.role && <WorkspaceCalendar space={space} />}
          </>
        ) : section === "people" ? (
          space.project_id ? (
            <ProjectMembers
              project={{
                ...space,
                id: space.project_id,
                can_manage:
                  space.can_manage && space.effective_status === "active",
              }}
            />
          ) : (
            <section className="settings-card">
              <h2>People & access</h2>
              <p>
                {space.kind === "personal"
                  ? "Only you can access this workspace. Your personal tasks and files are never shared with a group."
                  : "This workspace inherits group membership. Manage invitations and roles in Group administration."}
              </p>
              <ErrorNotice message={people.error} />
              {people.data?.map((p) => (
                <div className="planning-workload-row" key={p.id}>
                  <strong>{p.name}</strong>
                  <Badge>{p.role}</Badge>
                </div>
              ))}
              {space.group_id && (
                <WorkspaceLink
                  className="button secondary"
                  to={`/admin/${space.group_id}/members`}
                >
                  <Users size={15} />
                  Manage group members
                </WorkspaceLink>
              )}
            </section>
          )
        ) : section === "storage" ? (
          <StorageSettings scopeId={space.id} />
        ) : section === "activity" ? (
          <AuditPage spaceId={space.id} embedded />
        ) : section === "lifecycle" ? (
          <Lifecycle space={space} parentId={null} />
        ) : section === "integrations" ? (
          space.group_id &&
          ["owner", "admin"].includes(space.group_role ?? "") ? (
            <ProviderSettings groupId={space.group_id} />
          ) : (
            <Empty title="Workspace connections">
              <WorkspaceLink to="/settings/connections">
                Manage your approved MCP connections
              </WorkspaceLink>
              . Group provider credentials require administrator access.
            </Empty>
          )
        ) : null}
      </div>
    </div>
  );
}
function WorkspaceMetadata({ space }: { space: Space }) {
  const { refresh, notify } = useWorkspace(),
    action = useAction(),
    [baseline, setBaseline] = useState(space),
    [name, setName] = useState(space.name),
    [description, setDescription] = useState(space.description ?? ""),
    [color, setColor] = useState(space.color ?? "blue"),
    [audience, setAudience] = useState(space.audience ?? "group");
  const dirty =
    name !== baseline.name ||
    description !== (baseline.description ?? "") ||
    color !== (baseline.color ?? "blue") ||
    audience !== (baseline.audience ?? "group");
  useEffect(() => {
    if (!dirty && space.version > baseline.version) {
      setBaseline(space);
      setName(space.name);
      setDescription(space.description ?? "");
      setColor(space.color ?? "blue");
      setAudience(space.audience ?? "group");
    }
  }, [space.version, dirty]);
  return (
    <section className="settings-card">
      <DraftGuard dirty={dirty} title="Unsaved workspace settings" />
      <h2>Workspace identity</h2>
      <p>
        Name, description and appearance belong to this workspace. Group
        identity and membership are managed separately.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const saved = await mutate(
              `spaces/${space.id}`,
              {
                version: baseline.version,
                name,
                description,
                color,
                ...(space.project_id ? { audience } : {}),
              },
              "PATCH",
            );
            setBaseline(saved);
            refresh();
            notify("Workspace settings saved.");
          });
        }}
      >
        <fieldset
          disabled={
            !space.can_manage ||
            space.effective_status !== "active" ||
            action.busy
          }
        >
          <label>
            Name
            <input
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              rows={3}
              maxLength={3000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="planning-field-grid">
            <label>
              Workspace color
              <select value={color} onChange={(e) => setColor(e.target.value)}>
                {["blue", "green", "purple", "orange"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {space.project_id && (
              <label>
                Audience
                <select
                  value={audience}
                  onChange={(e) =>
                    setAudience(e.target.value as "group" | "restricted")
                  }
                >
                  <option value="restricted">Invited workspace members</option>
                  <option value="group">Everyone in the group</option>
                </select>
              </label>
            )}
          </div>
          <button className="button primary" disabled={!dirty}>
            Save settings
          </button>
        </fieldset>
        <ErrorNotice message={action.error} />
      </form>
    </section>
  );
}
function WorkspaceCalendar({ space }: { space: Space }) {
  const { revision } = useWorkspace(),
    data = useData<{ calendar: PlanningCalendar; version: number }>(
      `spaces/${space.id}/planning-settings`,
      revision,
    );
  return (
    <>
      <ErrorNotice message={data.error} retry={data.reload} />
      {data.data && (
        <CalendarForm key={space.id} space={space} value={data.data} />
      )}
    </>
  );
}
function CalendarForm({
  space,
  value,
}: {
  space: Space;
  value: { calendar: PlanningCalendar; version: number };
}) {
  const { refresh, notify } = useWorkspace(),
    action = useAction(),
    [calendar, setCalendar] = useState(value.calendar),
    [baseline, setBaseline] = useState(value),
    [date, setDate] = useState("");
  const dirty = JSON.stringify(calendar) !== JSON.stringify(baseline.calendar);
  useEffect(() => {
    if (!dirty && value.version > baseline.version) {
      setBaseline(value);
      setCalendar(value.calendar);
    }
  }, [value.version, dirty]);
  return (
    <section className="settings-card">
      <h2>Working calendar</h2>
      <p>
        Used when previewing dependency rescheduling. Existing task dates are
        never rewritten by a calendar change.
      </p>
      <DraftGuard dirty={dirty} title="Unsaved working calendar" />
      <fieldset
        disabled={
          !space.can_manage ||
          space.effective_status !== "active" ||
          action.busy
        }
      >
        <label>
          Time zone
          <TimeZoneInput
            required
            value={calendar.timezone}
            onChange={(zone) => setCalendar({ ...calendar, timezone: zone })}
          />
        </label>
        <div
          className="planning-working-days"
          role="group"
          aria-label="Working days"
        >
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
            <button
              key={d}
              aria-pressed={calendar.workingDays.includes(i)}
              onClick={() =>
                setCalendar({
                  ...calendar,
                  workingDays: calendar.workingDays.includes(i)
                    ? calendar.workingDays.filter((day) => day !== i)
                    : [...calendar.workingDays, i],
                })
              }
            >
              {d}
            </button>
          ))}
        </div>
        <h3>Date exceptions</h3>
        <div className="planning-field-grid">
          <input
            type="date"
            aria-label="Exception date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <button
            className="button secondary"
            disabled={!date || calendar.exceptions.some((e) => e.date === date)}
            onClick={() => {
              setCalendar({
                ...calendar,
                exceptions: [...calendar.exceptions, { date, working: false }],
              });
              setDate("");
            }}
          >
            Add exception
          </button>
        </div>
        {calendar.exceptions.map((e) => (
          <div className="planning-calendar-exception" key={e.date}>
            <span>{e.date}</span>
            <select
              aria-label={`Working status on ${e.date}`}
              value={String(e.working)}
              onChange={(event) =>
                setCalendar({
                  ...calendar,
                  exceptions: calendar.exceptions.map((row) =>
                    row.date === e.date
                      ? { ...row, working: event.target.value === "true" }
                      : row,
                  ),
                })
              }
            >
              <option value="false">Non-working day</option>
              <option value="true">Working day</option>
            </select>
            <button
              className="text-button"
              onClick={() =>
                setCalendar({
                  ...calendar,
                  exceptions: calendar.exceptions.filter(
                    (row) => row.date !== e.date,
                  ),
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          className="button primary"
          onClick={() =>
            void action.run(async () => {
              const saved = await mutate(
                `spaces/${space.id}/planning-settings`,
                {
                  calendar: calendarSchema.parse(calendar),
                  version: baseline.version,
                },
                "PATCH",
              );
              setBaseline({ calendar, version: saved.version });
              refresh();
              notify("Calendar saved. Existing dates are unchanged.");
            })
          }
        >
          Save calendar
        </button>
      </fieldset>
      <ErrorNotice message={action.error} />
    </section>
  );
}
