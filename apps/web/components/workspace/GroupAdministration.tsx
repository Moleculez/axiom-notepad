"use client";
import { useEffect, useState } from "react";
import {
  MoreHorizontal,
  Plus,
  Users,
  Mail,
  Folder,
  Settings2,
} from "lucide-react";
import type { Space } from "@axiom/shared/workspace";
import { api, post } from "../../lib/client";
import Dialog from "../Dialog";
import ProviderSettings from "../tools/ProviderSettings";
import { useManagement } from "./ManagementActions";
import {
  Badge,
  Empty,
  ErrorNotice,
  Loading,
  PageHeading,
  useAction,
  useData,
  useWorkspace,
  WorkspaceLink,
} from "./ui";

type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  content_role: string;
  version: number;
};
type Invitation = {
  id: string;
  email: string;
  role: string;
  content_role: string;
  status: string;
  version: number;
  expires_at: string;
};
type Page<T> = { items: T[]; total: number; nextOffset: number | null };
type Overview = {
  id: string;
  name: string;
  description: string;
  space_id: string;
  version: number;
  status: string;
  members: number;
  projects: number;
  invitations: number;
  role: string;
};
type Result = {
  id?: string;
  email?: string;
  ok: boolean;
  error?: string;
  link?: string;
  delivery?: string;
};
const sections = [
  "overview",
  "members",
  "invitations",
  "activity",
  "settings",
  "providers",
];
const title = (s: string) => s[0].toUpperCase() + s.slice(1);
export default function GroupAdministration({
  groupId,
  section = "overview",
}: {
  groupId?: string;
  section?: string;
}) {
  const { session, spaces, navigate, revision } = useWorkspace();
  const managedSpaces = useData<Space[]>("spaces?manage=1", revision);
  const groups = session.groups.filter((g) =>
    ["owner", "admin"].includes(g.role),
  );
  const id = groupId || groups[0]?.id;
  return (
    <main className="ws-page productivity-page">
      <PageHeading
        eyebrow="GROUP ADMINISTRATION"
        title={groups.find((g) => g.id === id)?.name || "Group administration"}
      >
        People, access and research workspaces. Personal notes remain private
        and account-owned.
      </PageHeading>
      <div className="productivity-filters">
        <label>
          Administer group
          <select
            aria-label="Administer group"
            value={id ?? ""}
            onChange={(e) => navigate(`/admin/${e.target.value}/${section}`)}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <WorkspaceLink className="button secondary" to="/groups">
          <Plus size={16} />
          Create or join a group
        </WorkspaceLink>
      </div>
      {!id ? (
        <Empty title="No groups to administer" icon={Users}>
          Group owners and administrators can manage membership here.
        </Empty>
      ) : (
        <>
          <nav
            className="productivity-tabs"
            aria-label="Group administration sections"
          >
            {sections.map((s) => (
              <WorkspaceLink
                key={s}
                className={section === s ? "active" : ""}
                aria-current={section === s ? "page" : undefined}
                to={`/admin/${id}/${s}`}
              >
                {title(s)}
              </WorkspaceLink>
            ))}
          </nav>
          {section === "providers" ? (
            <ProviderSettings key={id} groupId={id} />
          ) : (
            <GroupContent
              key={id}
              id={id}
              section={sections.includes(section) ? section : "overview"}
              spaces={(managedSpaces.data ?? spaces).filter(
                (s) => s.group_id === id,
              )}
            />
          )}
        </>
      )}
    </main>
  );
}
export function GroupContent({
  id,
  section,
  spaces,
}: {
  id: string;
  section: string;
  spaces: Space[];
}) {
  const { revision, refresh, session } = useWorkspace();
  const overview = useData<Overview>(`group-admin/${id}/overview`, revision);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<Member[] | Invitation[]>([]),
    [invite, setInvite] = useState(false),
    [bulkRole, setBulkRole] = useState("editor"),
    [results, setResults] = useState<Result[]>([]),
    [remove, setRemove] = useState<Member[] | null>(null),
    [transfer, setTransfer] = useState<Member | null>(null),
    [confirmation, setConfirmation] = useState("");
  const action = useAction();
  useEffect(() => {
    setSearch("");
    setFilter("all");
    setOffset(0);
    setSelected([]);
    setResults([]);
  }, [section]);
  const collection = ["members", "invitations", "activity"].includes(section);
  const query = new URLSearchParams({
    q: search,
    filter,
    offset: String(offset),
  });
  const data = useData<Page<any>>(
    collection ? `group-admin/${id}/${section}?${query}` : null,
    revision,
  );
  const group = overview.data,
    active = group?.status === "active",
    owner = group?.role === "owner";
  useEffect(() => {
    if (!data.loading && data.data && offset >= data.data.total && offset > 0)
      setOffset(Math.floor(Math.max(0, data.data.total - 1) / 30) * 30);
  }, [data.data, data.loading, offset]);
  const changed = () => {
    setSelected([]);
    data.reload();
    overview.reload();
    refresh();
  };
  const memberChange = (items: Member[], change: Record<string, unknown>) =>
    void action.run(async () => {
      const response = await api(`group-admin/${id}/members`, {
        method: "PATCH",
        body: JSON.stringify({
          mutationId: crypto.randomUUID(),
          items: items.map((m) => ({ id: m.id, version: m.version })),
          ...change,
        }),
      });
      setResults(response.results);
      setRemove(null);
      changed();
    });
  const invitationChange = (items: Invitation[], operation: string) =>
    void action.run(async () => {
      const response = await post(
        `group-admin/${id}/invitations/${operation}`,
        {
          mutationId: crypto.randomUUID(),
          items: items.map((m) => ({ id: m.id, version: m.version })),
        },
      );
      setResults(response.results);
      changed();
    });
  const canChange = (m: Member) =>
    active &&
    m.id !== session.user.id &&
    m.role !== "owner" &&
    (owner || m.role !== "admin");
  if (overview.loading && !group) return <Loading />;
  return (
    <>
      <ErrorNotice
        message={overview.error || data.error || action.error}
        retry={
          overview.error
            ? overview.reload
            : data.error
              ? data.reload
              : undefined
        }
      />
      {group && (
        <>
          {!active && (
            <p className="ws-note">
              This group is {group.status}. Membership and new invitations are
              read-only. Lifecycle controls remain in Settings.
            </p>
          )}
          {section === "overview" && (
            <>
              <div className="admin-summary-grid">
                {[
                  [Users, group.members, "Members", "members"],
                  [
                    Mail,
                    group.invitations,
                    "Pending invitations",
                    "invitations",
                  ],
                  [Folder, group.projects, "Projects", "settings"],
                ].map(([Icon, count, label, destination]) => {
                  const Component = Icon as typeof Users;
                  return (
                    <WorkspaceLink
                      className="admin-summary-card"
                      key={String(label)}
                      to={`/admin/${id}/${destination}`}
                    >
                      <Component size={20} />
                      <strong>{String(count)}</strong>
                      <span>{String(label)}</span>
                    </WorkspaceLink>
                  );
                })}
              </div>
              <section className="settings-card">
                <h2>
                  About this group <Badge>{group.status}</Badge>
                </h2>
                <p>
                  {group.description ||
                    "Add a description in Settings to help researchers understand this group's purpose."}
                </p>
                <p className="muted">
                  Administrators manage membership. Content roles control
                  reading, commenting and editing. Restricted project access is
                  managed separately and is never granted implicitly.
                </p>
              </section>
              <section className="settings-card">
                <h2>Research workspaces</h2>
                {spaces.map((s) => (
                  <div className="operation-history-row" key={s.id}>
                    <span>
                      <strong>{s.name}</strong>
                      <small>
                        {s.kind} · {s.effective_status}
                      </small>
                    </span>
                    <WorkspaceLink
                      className="button secondary small"
                      to={
                        s.project_id
                          ? `/projects/${s.project_id}/overview`
                          : `/explorer?space=${s.id}`
                      }
                    >
                      Open workspace
                    </WorkspaceLink>
                    {s.project_id && (
                      <WorkspaceLink
                        className="text-button"
                        to={`/projects/${s.project_id}/settings`}
                      >
                        Project settings
                      </WorkspaceLink>
                    )}
                  </div>
                ))}
              </section>
            </>
          )}
          {collection && (
            <>
              <div className="productivity-filters">
                <label>
                  Search
                  <input
                    aria-label={`Search ${section}`}
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setOffset(0);
                    }}
                    placeholder={
                      section === "members"
                        ? "Name or email"
                        : section === "invitations"
                          ? "Email address"
                          : "Activity description"
                    }
                  />
                </label>
                <label>
                  Filter
                  <select
                    aria-label={`Filter ${section}`}
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setOffset(0);
                    }}
                  >
                    {(section === "members"
                      ? [
                          "all",
                          "owner",
                          "admin",
                          "member",
                          "viewer",
                          "commenter",
                          "editor",
                        ]
                      : section === "invitations"
                        ? ["all", "pending", "accepted", "expired", "revoked"]
                        : ["all", "access", "invitation", "workspace"]
                    ).map((f) => (
                      <option key={f} value={f}>
                        {title(f)}
                      </option>
                    ))}
                  </select>
                </label>
                {section === "invitations" && (
                  <button
                    className="button primary"
                    disabled={!active}
                    onClick={() => setInvite(true)}
                  >
                    <Plus size={16} />
                    Invite researchers
                  </button>
                )}
              </div>
              {section === "members" && (
                <p className="muted">
                  Group role governs administration; default content role
                  governs shared documents. Selection is retained across pages.
                  Only the owner can change an administrator.
                </p>
              )}
              {!!selected.length && (
                <div className="ws-selection-bar">
                  <strong>{selected.length} selected across pages</strong>
                  <button
                    className="text-button"
                    onClick={() => setSelected([])}
                  >
                    Clear
                  </button>
                  <span className="ws-spacer" />
                  {section === "members" ? (
                    <>
                      <select
                        aria-label="Bulk content role"
                        value={bulkRole}
                        onChange={(e) => setBulkRole(e.target.value)}
                      >
                        {["viewer", "commenter", "editor"].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                      <button
                        className="button secondary"
                        disabled={!active || action.busy}
                        onClick={() =>
                          memberChange(selected as Member[], {
                            contentRole: bulkRole,
                          })
                        }
                      >
                        Apply content role
                      </button>
                      <button
                        className="button secondary danger-text"
                        disabled={!active || action.busy}
                        onClick={() => setRemove(selected as Member[])}
                      >
                        Remove selected
                      </button>
                    </>
                  ) : (
                    <button
                      className="button secondary"
                      disabled={action.busy}
                      onClick={() =>
                        invitationChange(selected as Invitation[], "revoke")
                      }
                    >
                      Revoke selected invitations
                    </button>
                  )}
                </div>
              )}
              {data.loading ? (
                <Loading />
              ) : !data.data?.items.length ? (
                <Empty title={`No matching ${section}`}>
                  <p>Try another filter or clear the search.</p>
                </Empty>
              ) : (
                <div className="productivity-table-wrap">
                  <table className="productivity-table">
                    <thead>
                      <tr>
                        {section !== "activity" && (
                          <th>
                            <input
                              type="checkbox"
                              aria-label={`Select this page of ${section}`}
                              checked={
                                data.data.items.some((m) =>
                                  section === "members"
                                    ? canChange(m)
                                    : m.status !== "accepted",
                                ) &&
                                data.data.items
                                  .filter((m) =>
                                    section === "members"
                                      ? canChange(m)
                                      : m.status !== "accepted",
                                  )
                                  .every((m) =>
                                    selected.some((s) => s.id === m.id),
                                  )
                              }
                              onChange={(e) =>
                                setSelected((old) =>
                                  e.target.checked
                                    ? [
                                        ...new Map(
                                          [
                                            ...old,
                                            ...data.data!.items.filter((m) =>
                                              section === "members"
                                                ? canChange(m)
                                                : m.status !== "accepted",
                                            ),
                                          ].map((m) => [m.id, m]),
                                        ).values(),
                                      ]
                                    : old.filter(
                                        (m) =>
                                          !data.data!.items.some(
                                            (r) => r.id === m.id,
                                          ),
                                      ),
                                )
                              }
                            />
                          </th>
                        )}
                        {(section === "members"
                          ? [
                              "Researcher",
                              "Group role",
                              "Default content role",
                              "Actions",
                            ]
                          : section === "invitations"
                            ? ["Email", "Access", "Status / expires", "Actions"]
                            : ["Activity", "Actor", "Date"]
                        ).map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.items.map((item) => (
                        <tr key={item.id}>
                          {section !== "activity" && (
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${item.name ?? item.email}`}
                                disabled={
                                  section === "members"
                                    ? !canChange(item)
                                    : item.status === "accepted"
                                }
                                checked={selected.some((s) => s.id === item.id)}
                                onChange={(e) =>
                                  setSelected((old) =>
                                    e.target.checked
                                      ? [...old, item]
                                      : old.filter((s) => s.id !== item.id),
                                  )
                                }
                              />
                            </td>
                          )}
                          {section === "members" ? (
                            <>
                              <td>
                                <strong>{item.name}</strong>
                                <small>{item.email}</small>
                              </td>
                              <td>
                                {canChange(item) && owner ? (
                                  <select
                                    aria-label={`Group role for ${item.name}`}
                                    value={item.role}
                                    disabled={action.busy}
                                    onChange={(e) =>
                                      memberChange([item], {
                                        role: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="member">Member</option>
                                    <option value="admin">Administrator</option>
                                  </select>
                                ) : (
                                  <Badge>{item.role}</Badge>
                                )}
                              </td>
                              <td>
                                {canChange(item) ? (
                                  <select
                                    aria-label={`Default content role for ${item.name}`}
                                    value={item.content_role}
                                    disabled={action.busy}
                                    onChange={(e) =>
                                      memberChange([item], {
                                        contentRole: e.target.value,
                                      })
                                    }
                                  >
                                    {["viewer", "commenter", "editor"].map(
                                      (r) => (
                                        <option key={r}>{r}</option>
                                      ),
                                    )}
                                  </select>
                                ) : (
                                  item.content_role
                                )}
                              </td>
                              <td>
                                <div className="ws-actions">
                                  {canChange(item) && (
                                    <button
                                      className="text-button danger-text"
                                      disabled={action.busy}
                                      onClick={() => setRemove([item])}
                                    >
                                      Remove
                                    </button>
                                  )}
                                  {owner &&
                                    active &&
                                    item.id !== session.user.id && (
                                      <button
                                        className="text-button"
                                        onClick={() => {
                                          setTransfer(item);
                                          setConfirmation("");
                                        }}
                                      >
                                        Transfer ownership
                                      </button>
                                    )}
                                </div>
                              </td>
                            </>
                          ) : section === "invitations" ? (
                            <>
                              <td>
                                <strong>{item.email}</strong>
                              </td>
                              <td>
                                {item.role}
                                <small>{item.content_role}</small>
                              </td>
                              <td>
                                <Badge>{item.status}</Badge>
                                <small>
                                  {new Date(item.expires_at).toLocaleString()}
                                </small>
                              </td>
                              <td>
                                <div className="ws-actions">
                                  {item.status !== "accepted" &&
                                    (owner || item.role !== "admin") && (
                                      <>
                                        <button
                                          className="text-button"
                                          disabled={!active || action.busy}
                                          onClick={() =>
                                            invitationChange([item], "reissue")
                                          }
                                        >
                                          Reissue link
                                        </button>
                                        {item.status !== "revoked" && (
                                          <button
                                            className="text-button danger-text"
                                            disabled={action.busy}
                                            onClick={() =>
                                              invitationChange([item], "revoke")
                                            }
                                          >
                                            Revoke
                                          </button>
                                        )}
                                      </>
                                    )}
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>
                                <strong>{item.title}</strong>
                                <small>{item.kind}</small>
                              </td>
                              <td>{item.actor_name || "Former researcher"}</td>
                              <td>
                                {new Date(item.created_at).toLocaleString()}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="productivity-pagination">
                <span>
                  {data.data?.total ?? 0} results · Page{" "}
                  {Math.floor(offset / 30) + 1}
                </span>
                <button
                  className="button secondary small"
                  disabled={!offset || data.loading}
                  onClick={() => setOffset(Math.max(0, offset - 30))}
                >
                  Previous
                </button>
                <button
                  className="button secondary small"
                  disabled={data.data?.nextOffset == null || data.loading}
                  onClick={() => setOffset(data.data!.nextOffset!)}
                >
                  Next
                </button>
              </div>
            </>
          )}
          {section === "settings" && (
            <GroupSettings
              group={group}
              space={spaces.find((s) => s.id === group.space_id)}
              onSaved={() => {
                overview.reload();
                refresh();
              }}
            />
          )}
        </>
      )}
      {!!results.length && (
        <section className="settings-card" aria-label="Administration results">
          <div className="productivity-action-bar">
            <h3>Operation results</h3>
            <button className="text-button" onClick={() => setResults([])}>
              Dismiss
            </button>
          </div>
          {results.map((r, i) => (
            <div className="admin-operation-result" key={r.id ?? i}>
              <strong>
                {r.email ||
                  (data.data?.items.find((m) => m.id === r.id)?.name ??
                    "Membership change")}
              </strong>
              <span>
                {r.ok
                  ? r.delivery === "sent"
                    ? "Email sent"
                    : r.delivery === "copy-link"
                      ? "Email unavailable or delivery failed. Copy this link to share privately."
                      : r.delivery === "not-issued"
                        ? "Already processed. Reissue to obtain a new link."
                        : "Completed"
                  : r.error}
              </span>
              {r.link && (
                <input
                  readOnly
                  aria-label={`Invitation link for ${r.email}`}
                  value={r.link}
                  onFocus={(e) => e.target.select()}
                />
              )}
            </div>
          ))}
        </section>
      )}
      {invite && (
        <InvitationDialog
          groupId={id}
          owner={owner}
          onClose={() => setInvite(false)}
          onCreated={(items) => {
            setResults(items);
            setInvite(false);
            changed();
          }}
        />
      )}
      {remove && (
        <Dialog
          title={`Remove ${remove.length} researcher${remove.length === 1 ? "" : "s"}?`}
          onClose={() => setRemove(null)}
        >
          <p>
            This removes group and project access, but preserves personal work.
            Owners and the last lead of a project cannot be removed here.
          </p>
          <ul>
            {remove.map((m) => (
              <li key={m.id}>
                {m.name} · {m.email}
              </li>
            ))}
          </ul>
          <ErrorNotice message={action.error} />
          <div className="ws-actions">
            <button
              className="button secondary"
              onClick={() => setRemove(null)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={action.busy}
              onClick={() => memberChange(remove, { remove: true })}
            >
              Remove from group
            </button>
          </div>
        </Dialog>
      )}
      {transfer && (
        <Dialog
          title="Transfer group ownership"
          onClose={() => setTransfer(null)}
        >
          <p>
            {transfer.name} will become the owner. You will become an
            administrator. This does not grant access to private personal
            workspaces.
          </p>
          <label>
            Type TRANSFER
            <input
              aria-label="Confirm ownership transfer"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <ErrorNotice message={action.error} />
          <button
            className="button primary"
            disabled={confirmation !== "TRANSFER" || action.busy}
            onClick={() =>
              void action.run(async () => {
                await post(`group-admin/${id}/transfer`, {
                  userId: transfer.id,
                  version: transfer.version,
                  confirmation,
                });
                setTransfer(null);
                changed();
              })
            }
          >
            Transfer ownership
          </button>
        </Dialog>
      )}
    </>
  );
}
function InvitationDialog({
  groupId,
  owner,
  onClose,
  onCreated,
}: {
  groupId: string;
  owner: boolean;
  onClose: () => void;
  onCreated: (items: Result[]) => void;
}) {
  const [emails, setEmails] = useState(""),
    [role, setRole] = useState("member"),
    [contentRole, setContentRole] = useState("editor");
  const action = useAction(),
    addresses = [
      ...new Set(
        emails
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
  return (
    <Dialog title="Invite researchers" onClose={onClose}>
      <p>
        One invitation per email, valid for seven days. Duplicate addresses are
        combined; existing members and pending invitations are reported
        individually.
      </p>
      <label>
        Email addresses
        <textarea
          aria-label="Invitation email addresses"
          rows={5}
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          placeholder="researcher@university.edu"
        />
      </label>
      <p className="muted">{addresses.length} unique addresses · maximum 100</p>
      <div className="productivity-filters">
        <label>
          Group role
          <select
            aria-label="Invitation group role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="member">Member</option>
            {owner && <option value="admin">Administrator</option>}
          </select>
        </label>
        <label>
          Default content role
          <select
            aria-label="Invitation content role"
            value={contentRole}
            onChange={(e) => setContentRole(e.target.value)}
          >
            {["viewer", "commenter", "editor"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <ErrorNotice message={action.error} />
      <div className="ws-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!addresses.length || addresses.length > 100 || action.busy}
          onClick={() =>
            void action.run(async () => {
              const result = await post(`group-admin/${groupId}/invitations`, {
                emails: addresses,
                role,
                contentRole,
                mutationId: crypto.randomUUID(),
              });
              onCreated(result.results);
            })
          }
        >
          Create invitations
        </button>
      </div>
    </Dialog>
  );
}
export function GroupSettings({
  group,
  space,
  onSaved,
}: {
  group: Overview;
  space?: Space;
  onSaved: () => void;
}) {
  const [name, setName] = useState(group.name),
    [description, setDescription] = useState(group.description),
    [version, setVersion] = useState(group.version);
  const [baseline, setBaseline] = useState({
    name: group.name,
    description: group.description,
  });
  const dirty = name !== baseline.name || description !== baseline.description;
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const before = (event: Event) => {
      event.preventDefault();
      const navigation = event as CustomEvent<{ proceed: () => void }>;
      setLeaving(() => navigation.detail.proceed);
    };
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("axiom:before-navigate", before);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("axiom:before-navigate", before);
      window.removeEventListener("beforeunload", unload);
    };
  }, [dirty]);
  const management = useManagement(),
    action = useAction();
  useEffect(() => {
    if (!dirty) {
      setName(group.name);
      setDescription(group.description);
      setBaseline({ name: group.name, description: group.description });
      setVersion(group.version);
    }
  }, [group.version]);
  return (
    <>
      <section className="settings-card">
        <h2>Group identity</h2>
        <label>
          Group name
          <input
            aria-label="Group name"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            disabled={group.status !== "active"}
          />
        </label>
        <label>
          Description
          <textarea
            aria-label="Group description"
            value={description}
            maxLength={2000}
            rows={4}
            onChange={(e) => setDescription(e.target.value)}
            disabled={group.status !== "active"}
          />
        </label>
        <ErrorNotice message={action.error} />
        <div className="productivity-action-bar">
          <span className="muted">
            {dirty ? "Unsaved changes" : "Saved group settings"}
            {dirty && version !== group.version
              ? " · Updated elsewhere; reload before saving"
              : ""}
          </span>
          <button
            className="button secondary"
            disabled={!dirty}
            onClick={() => {
              setName(group.name);
              setDescription(group.description);
              setVersion(group.version);
              setBaseline({ name: group.name, description: group.description });
            }}
          >
            Cancel changes
          </button>
          <button
            className="button primary"
            disabled={
              !dirty || !name.trim() || action.busy || group.status !== "active"
            }
            onClick={() =>
              void action.run(async () => {
                await api(`spaces/${group.space_id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    mutationId: crypto.randomUUID(),
                    version,
                    name: name.trim(),
                    description,
                  }),
                });
                setBaseline({ name, description });
                onSaved();
              })
            }
          >
            Save group settings
          </button>
        </div>
      </section>
      <section className="settings-card">
        <h2>Storage & lifecycle</h2>
        <p className="muted">
          Archiving makes a workspace read-only. Moving a group to Trash
          includes its projects. Permanent group deletion is owner-only and has
          a separate safety review.
        </p>
        <div className="ws-actions">
          <WorkspaceLink
            className="button secondary"
            to={`/workspaces/${group.space_id}/storage`}
          >
            <Settings2 size={16} />
            Storage & file versions
          </WorkspaceLink>
          {space && (
            <button
              className="button secondary"
              onClick={(e) => management.workspaceMenu(e, space)}
            >
              <MoreHorizontal size={16} />
              Manage workspace lifecycle
            </button>
          )}
        </div>
      </section>
      {leaving && (
        <Dialog title="Unsaved group settings" onClose={() => setLeaving(null)}>
          <p>Your group name or description has not been saved.</p>
          <div className="ws-actions">
            <button
              className="button secondary"
              onClick={() => setLeaving(null)}
            >
              Keep editing
            </button>
            <button
              className="button primary"
              onClick={() => {
                const proceed = leaving;
                setLeaving(null);
                proceed();
              }}
            >
              Discard and leave
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
