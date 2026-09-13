"use client";
import { useEffect, useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  Blocks,
  FolderOpen,
  HardDrive,
  History,
  Info,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
  Workflow,
} from "lucide-react";
import type { Space, SpaceLifecycleAction } from "@axiom/shared/workspace";
import { GroupContent } from "./GroupAdministration";
import { ProjectMembers, ProjectSettings } from "./Projects";
import { StorageSettings } from "./Settings";
import ProviderSettings from "../tools/ProviderSettings";
import AuditPage from "./AuditPage";
import { LifecycleDialog, useManagement } from "./ManagementActions";
import {
  Badge,
  bytes,
  Empty,
  ErrorNotice,
  go,
  Loading,
  PageHeading,
  useData,
  useWorkspace,
  WorkspaceLink,
} from "./ui";

export const workspaceSections = [
  ["overview", "Overview", Info],
  ["general", "General", Settings2],
  ["people", "People & access", Users],
  ["invitations", "Invitations", Plus],
  ["storage", "Storage", HardDrive],
  ["integrations", "Integrations", Workflow],
  ["activity", "Activity", History],
  ["lifecycle", "Lifecycle", Archive],
] as const;
type Details = {
  space: Space;
  counts: {
    resources: number;
    notes: number;
    files: number;
    folders: number;
    trash: number;
    bytes: number;
  };
  parentId: string | null;
  capabilities: {
    readContent: boolean;
    editSettings: boolean;
    managePeople: boolean;
    integrations: boolean;
    lifecycle: SpaceLifecycleAction[];
  };
};

export function LegacyAdministrationRedirect({
  groupId,
  section,
}: {
  groupId?: string;
  section?: string;
}) {
  const { revision } = useWorkspace(),
    data = useData<Space[]>("spaces?manage=1", revision);
  useEffect(() => {
    if (!data.data) return;
    const space = data.data.find(
      (s) =>
        s.kind === "team" &&
        (!groupId || s.group_id === groupId) &&
        s.can_manage,
    );
    const target =
      (
        {
          members: "people",
          settings: "general",
          providers: "integrations",
        } as Record<string, string>
      )[section ?? ""] ??
      section ??
      "overview";
    go(space ? `/workspaces/${space.id}/${target}` : "/workspaces", true);
  }, [data.data, groupId, section]);
  return (
    <>
      <Loading />
      <ErrorNotice message={data.error} retry={data.reload} />
    </>
  );
}

export default function WorkspacesPage({
  id,
  section = "overview",
}: {
  id?: string;
  section?: string;
}) {
  const { revision, navigate } = useWorkspace(),
    management = useManagement();
  const data = useData<Space[]>("spaces?manage=1&summary=1", revision),
    detail = useData<Details>(id ? `spaces/${id}` : null, revision);
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [kind, setKind] = useState(""),
    [role, setRole] = useState(""),
    [group, setGroup] = useState(""),
    [sort, setSort] = useState("name");
  const space = detail.data?.space;
  useEffect(() => {
    if (!space) return;
    window.dispatchEvent(
      new CustomEvent("axiom:tab-title", {
        detail: {
          path: `/workspaces/${space.id}/${section}`,
          title: `${space.name} · ${workspaceSections.find((s) => s[0] === section)?.[1] ?? "Overview"}`,
        },
      }),
    );
  }, [space?.name, space?.id, section]);
  const rows = (data.data ?? [])
    .filter(
      (s) =>
        (!search ||
          `${s.name} ${s.description ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (!status || s.effective_status === status) &&
        (!kind || s.kind === kind) &&
        (!role || (role === "manage" ? s.can_manage : s.role === role)) &&
        (!group || s.group_id === group),
    )
    .sort((a, b) =>
      sort === "storage"
        ? Number(b.stored_bytes ?? 0) - Number(a.stored_bytes ?? 0)
        : a.name.localeCompare(b.name),
    );
  if (!id)
    return (
      <main className="ws-page console-page">
        <PageHeading eyebrow="YOUR ORGANIZATION" title="Workspaces">
          One place for shared libraries, project access, storage and lifecycle.
          Personal research stays account-owned.
        </PageHeading>
        <div className="console-toolbar">
          <label className="console-search">
            Find a workspace
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or description…"
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All states</option>
              {["active", "archived", "trashed", "purging"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All workspaces</option>
              {["personal", "team", "project"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Access
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">All roles</option>
              <option value="manage">Can manage</option>
              {["editor", "commenter", "viewer"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Group
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">All groups</option>
              {data.data
                ?.filter((s) => s.kind === "team")
                .map((s) => (
                  <option key={s.id} value={s.group_id!}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="name">Name A–Z</option>
              <option value="storage">Largest storage first</option>
            </select>
          </label>
          <WorkspaceLink className="button primary" to="/groups">
            <Plus size={16} />
            Create or join
          </WorkspaceLink>
        </div>
        <ErrorNotice message={data.error} retry={data.reload} />
        {data.loading && !data.data ? (
          <Loading />
        ) : rows.length ? (
          <div className="console-directory">
            {rows.map((s) => (
              <article
                key={s.id}
                className="console-workspace-card"
                onContextMenu={(e) => management.workspaceMenu(e, s)}
              >
                <div className="ws-section-heading">
                  <span className={`console-space-icon ${s.kind}`}>
                    <Blocks size={22} />
                  </span>
                  <Badge>{s.effective_status}</Badge>
                  <button
                    className="icon-button"
                    title={`Actions for ${s.name}`}
                    aria-label={`Actions for ${s.name}`}
                    onClick={(e) => management.workspaceMenu(e, s)}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                </div>
                <WorkspaceLink
                  className="console-workspace-title"
                  to={`/workspaces/${s.id}/overview`}
                >
                  {s.name}
                  <ArrowUpRight size={16} />
                </WorkspaceLink>
                <p>
                  {s.description ||
                    (s.kind === "personal"
                      ? "Your private library, protected from group deletion."
                      : "A shared home for research and collaboration.")}
                </p>
                <div className="console-card-meta">
                  <span>{bytes(s.stored_bytes ?? 0)} stored</span>
                  <span>
                    {s.kind}
                    {s.group_name && s.kind === "project"
                      ? ` · ${s.group_name}`
                      : ""}
                  </span>
                  <span>
                    {s.can_manage ? "Manager" : s.role || "No content access"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No matching workspaces" icon={Blocks}>
            Adjust your filters, or create or join a group to start
            collaborating.
          </Empty>
        )}
      </main>
    );
  return (
    <main className="ws-page console-page">
      <WorkspaceLink className="text-button" to="/workspaces">
        <ArrowLeft size={15} />
        All workspaces
      </WorkspaceLink>
      <ErrorNotice message={detail.error} retry={detail.reload} />
      {!space ? (
        detail.loading ? (
          <Loading />
        ) : (
          <Empty title="Workspace unavailable">
            Your access may have changed.
          </Empty>
        )
      ) : (
        <>
          <PageHeading
            eyebrow={`${space.kind.toUpperCase()} WORKSPACE · ${space.effective_status.toUpperCase()}`}
            title={space.name}
          >
            {space.description ||
              "Workspace administration and research resources."}
          </PageHeading>
          <div className="console-toolbar">
            <Badge>
              {space.can_manage ? "Management access" : `${space.role} access`}
            </Badge>
            {!space.role && (
              <span className="ws-note">
                Management access does not grant access to private contents.
              </span>
            )}
            {space.role && (
              <WorkspaceLink
                className="button secondary"
                to={`/explorer?space=${space.id}`}
              >
                <FolderOpen size={16} />
                Open files
              </WorkspaceLink>
            )}
            {detail.data?.parentId && (
              <WorkspaceLink
                className="text-button"
                to={`/workspaces/${detail.data.parentId}/overview`}
              >
                Parent group: {space.group_name}
              </WorkspaceLink>
            )}
            <button
              className="icon-button"
              title="Workspace actions"
              aria-label="Workspace actions"
              onClick={(e) => management.workspaceMenu(e, space)}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
          <nav
            className="page-section-navigation"
            aria-label="Workspace sections"
          >
            {workspaceSections.map(([key, label, Icon]) => (
              <WorkspaceLink
                key={key}
                to={`/workspaces/${space.id}/${key}`}
                className={`page-section-link ${section === key ? "active" : ""}`}
                aria-current={section === key ? "page" : undefined}
              >
                <Icon size={15} />
                {label}
              </WorkspaceLink>
            ))}
          </nav>
          <h2 className="console-section-title">
            {workspaceSections.find((s) => s[0] === section)?.[1] ?? "Overview"}
          </h2>
          {section === "activity" ? (
            <AuditPage key={space.id} spaceId={space.id} embedded />
          ) : section === "storage" ? (
            <StorageSettings scopeId={space.id} />
          ) : section === "lifecycle" ? (
            <WorkspaceLifecycle
              space={space}
              parentId={detail.data?.parentId ?? null}
            />
          ) : section === "integrations" ? (
            detail.data?.capabilities.integrations && space.group_id ? (
              <ProviderSettings groupId={space.group_id} />
            ) : (
              <Empty
                title="Group administrator access required"
                icon={ShieldCheck}
              >
                Provider settings are shared at group level. Credentials are
                never included in Audit.
              </Empty>
            )
          ) : ["people", "invitations", "general"].includes(section) ? (
            space.kind === "personal" ? (
              <Empty title="Your personal workspace" icon={ShieldCheck}>
                Only you can access this library. Manage your identity in
                account settings.
              </Empty>
            ) : space.kind === "team" ? (
              space.can_manage ? (
                <GroupContent
                  key={space.id}
                  id={space.group_id!}
                  section={
                    section === "people"
                      ? "members"
                      : section === "general"
                        ? "settings"
                        : "invitations"
                  }
                  spaces={
                    data.data?.filter((s) => s.group_id === space.group_id) ??
                    []
                  }
                />
              ) : (
                <Empty title="Administrator access required">
                  Ask the group owner to update membership or settings.
                </Empty>
              )
            ) : section === "general" ? (
              detail.data?.capabilities.editSettings ? (
                <ProjectSettings
                  key={space.id}
                  project={{
                    ...space,
                    id: space.project_id,
                    version: space.project_version,
                  }}
                />
              ) : (
                <Empty title="Settings are read-only">
                  Restore this workspace and use a manager account to make
                  changes.
                </Empty>
              )
            ) : section === "invitations" ? (
              <div className="settings-card">
                <h3>Invite through the parent group</h3>
                <p>
                  People must first join {space.group_name}, then receive
                  explicit project access when its audience is restricted.
                </p>
                <WorkspaceLink
                  className="button secondary"
                  to={`/workspaces/${detail.data?.parentId}/invitations`}
                >
                  <Users size={16} />
                  Group invitations
                </WorkspaceLink>
              </div>
            ) : (
              <ProjectMembers
                project={{
                  ...space,
                  id: space.project_id,
                  can_manage:
                    space.can_manage && space.effective_status === "active",
                }}
              />
            )
          ) : (
            <>
              <div className="console-metrics">
                {Object.entries(detail.data!.counts).map(([key, value]) => (
                  <div key={key}>
                    <span>
                      {key === "bytes" ? "Stored files & versions" : key}
                    </span>
                    <strong>
                      {key === "bytes" ? bytes(value) : value.toLocaleString()}
                    </strong>
                  </div>
                ))}
              </div>
              <div className="console-directory">
                <section className="settings-card">
                  <ShieldCheck size={22} />
                  <h3>Access & ownership</h3>
                  <p>
                    {space.kind === "personal"
                      ? "Personal space cannot be archived, transferred or removed with a group."
                      : space.audience === "restricted"
                        ? "Only explicitly invited project members can read content. Group managers can administer without reading."
                        : "Membership determines access. Changes take effect across files, notes and live collaboration."}
                  </p>
                  <button
                    className="text-button"
                    onClick={() => navigate(`/workspaces/${space.id}/people`)}
                  >
                    Review people and access
                    <ArrowUpRight size={14} />
                  </button>
                </section>
                <section className="settings-card">
                  <History size={22} />
                  <h3>History & recovery</h3>
                  <p>
                    Audit records metadata changes permanently. Trash has no
                    automatic expiry. Permanent removal is protected by
                    reference checks.
                  </p>
                  <WorkspaceLink
                    className="text-button"
                    to={`/workspaces/${space.id}/activity`}
                  >
                    Review activity
                    <ArrowUpRight size={14} />
                  </WorkspaceLink>
                </section>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}

export function WorkspaceLifecycle({
  space,
  parentId,
}: {
  space: Space;
  parentId: string | null;
}) {
  const { revision, refresh, notify } = useWorkspace(),
    [operation, setOperation] = useState<SpaceLifecycleAction | null>(null);
  const data = useData<{
    counts: Record<string, number>;
    blockers: { label: string; count: number }[];
    job: { status: string; error?: string } | null;
  }>(space.can_manage ? `spaces/${space.id}/lifecycle` : null, revision);
  useEffect(() => {
    if (space.status !== "purging") return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [space.status, refresh]);
  const labels: Record<SpaceLifecycleAction, string> = {
    archive: "Archive workspace",
    unarchive: "Unarchive workspace",
    trash: "Move workspace to Trash",
    restore:
      space.status === "purging"
        ? "Cancel permanent deletion"
        : "Restore workspace",
    purge: "Delete workspace permanently",
  };
  return (
    <section className="console-lifecycle">
      <p className="ws-note">
        {space.kind === "personal"
          ? "Personal space is protected and cannot be archived or deleted."
          : "Archive for read-only access. Trash is recoverable indefinitely. Permanent deletion is owner-only, checks retained research references, and has a 30-second cancellation window."}
      </p>
      {parentId && space.parent_status !== "active" && (
        <div className="settings-card">
          <h3>State inherited from the parent group</h3>
          <p>
            Restore the parent workspace before managing this project. Its own
            archived or active state is preserved.
          </p>
          <WorkspaceLink
            className="button secondary"
            to={`/workspaces/${parentId}/lifecycle`}
          >
            Manage parent workspace
          </WorkspaceLink>
        </div>
      )}
      <ErrorNotice message={data.error} retry={data.reload} />
      {data.data?.job && (
        <p role="status">
          Removal job: {data.data.job.status}
          {data.data.job.error ? ` · ${data.data.job.error}` : ""}
        </p>
      )}
      {!!data.data?.blockers.length && (
        <div className="settings-card">
          <h3>Protected research & unfinished work</h3>
          <p>
            These references must be resolved before permanent removal. They do
            not prevent recovery.
          </p>
          <ul>
            {data.data.blockers.map((b) => (
              <li key={b.label}>
                {b.label}: {b.count}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="console-lifecycle-actions">
        {space.lifecycle_actions.map((a) => (
          <div className="console-lifecycle-row" key={a}>
            <div>
              <h3>{labels[a]}</h3>
              <p>
                {a === "purge"
                  ? "Removes owned content and eligible versions. Audit metadata remains."
                  : a === "trash"
                    ? "Hide this workspace and its included projects from everyday navigation."
                    : a === "archive"
                      ? "Keep reading and exporting. Pause editing, uploads and invitations."
                      : "Preserve existing permissions and independently archived or trashed items."}
              </p>
            </div>
            <button
              className={`button ${["trash", "purge"].includes(a) ? "danger" : "secondary"}`}
              disabled={
                a === "purge" && (!data.data || !!data.data.blockers.length)
              }
              onClick={() => setOperation(a)}
            >
              {a === "restore" ? (
                <RotateCcw size={16} />
              ) : a === "trash" || a === "purge" ? (
                <Trash2 size={16} />
              ) : (
                <Archive size={16} />
              )}
              {labels[a]}
            </button>
          </div>
        ))}
      </div>
      {operation && (
        <LifecycleDialog
          space={space}
          operation={operation}
          onClose={() => setOperation(null)}
          onDone={() => {
            setOperation(null);
            refresh();
            notify(
              "Workspace updated. Progress is available in Audit and Lifecycle.",
            );
          }}
        />
      )}
    </section>
  );
}
