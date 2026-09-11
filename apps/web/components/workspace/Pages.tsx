"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  FileText,
  FlaskConical,
  FolderOpen,
  LayoutTemplate,
  LockKeyhole,
  Plus,
  Search,
  Users,
} from "lucide-react";
import type { Resource, Space } from "@axiom/shared/workspace";
import { initials, post, timeAgo } from "../../lib/client";
import { templates } from "@axiom/shared/templates";
import {
  Badge,
  Empty,
  ErrorNotice,
  Loading,
  mutate,
  PageHeading,
  ResourceIcon,
  useAction,
  useData,
  useWorkspace,
  WorkspaceLink,
} from "./ui";
import Dialog from "../Dialog";
import { CreateResource } from "./Explorer";

export function HomePage() {
  const { session, spaces, revision, open, navigate } = useWorkspace(),
    result = useData("dashboard", revision),
    [create, setCreate] = useState<Space | null>(null);
  const personal = spaces.find((space) => space.kind === "personal"),
    dashboard = result.data;
  return (
    <main className="ws-page ws-home">
      <PageHeading
        eyebrow="YOUR WORKSPACE"
        title={`A little space for your next idea, ${session.user.name.split(" ")[0]}.`}
        actions={
          <button
            className="button primary"
            disabled={!personal}
            onClick={() => personal && setCreate(personal)}
          >
            <Plus size={17} />
            New note
          </button>
        }
      >
        Your notes, evidence, and collaborators. All in one place.
      </PageHeading>
      <ErrorNotice message={result.error} retry={result.reload} />
      {result.loading && !dashboard && <Loading />}
      <div className="ws-launchers">
        <WorkspaceLink
          to={personal ? `/explorer?space=${personal.id}` : "/explorer"}
        >
          <span>
            <LockKeyhole size={23} />
          </span>
          <div>
            <strong>Personal space</strong>
            <small>Private work that stays yours</small>
          </div>
          <ArrowUpRight size={17} />
        </WorkspaceLink>
        <WorkspaceLink to="/projects">
          <span>
            <FlaskConical size={23} />
          </span>
          <div>
            <strong>Research projects</strong>
            <small>Connect questions to outcomes</small>
          </div>
          <ArrowUpRight size={17} />
        </WorkspaceLink>
        <WorkspaceLink to="/research">
          <span>
            <BookOpen size={23} />
          </span>
          <div>
            <strong>Research library</strong>
            <small>Papers, references, and methods</small>
          </div>
          <ArrowUpRight size={17} />
        </WorkspaceLink>
      </div>
      <section className="ws-section">
        <div className="ws-section-heading">
          <h2>Pick up where you left off</h2>
          <WorkspaceLink to="/explorer?view=recent">
            View recent
            <ArrowUpRight size={14} />
          </WorkspaceLink>
        </div>
        {dashboard?.recent?.length ? (
          <div className="ws-recent-grid">
            {dashboard.recent.map((item: Resource) => (
              <button
                className="ws-recent-card"
                key={item.id}
                onClick={() =>
                  item.kind === "folder"
                    ? navigate(
                        `/explorer?space=${item.space_id}&folder=${item.id}`,
                      )
                    : open(item)
                }
              >
                <span className={`ws-resource-glyph ${item.kind}`}>
                  <ResourceIcon resource={item} size={24} />
                </span>
                <strong>{item.name}</strong>
                <small>
                  {spaces.find((space) => space.id === item.space_id)?.name}
                </small>
                <span className="ws-card-meta">
                  {item.kind === "note" ? "Research note" : item.kind} ·{" "}
                  {timeAgo(item.updated_at)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          !result.loading && (
            <Empty icon={FileText} title="Your working set starts here">
              Open a note or a file in Explorer to keep it close at hand.
            </Empty>
          )
        )}
      </section>
      <div className="ws-dashboard-columns">
        <section className="ws-card">
          <div className="ws-section-heading">
            <h2>My next steps</h2>
            <Badge>{dashboard?.tasks?.length ?? 0}</Badge>
          </div>
          {dashboard?.tasks?.length ? (
            dashboard.tasks.map((task: any) => (
              <WorkspaceLink
                className="ws-task-summary"
                key={task.id}
                to={`/projects/${task.project_id}/tasks?task=${task.id}`}
              >
                <span className="ws-task-check" />
                <div>
                  <strong>{task.title}</strong>
                  <small>{task.project_name}</small>
                </div>
                <span>
                  {task.due_on
                    ? new Date(task.due_on).toLocaleDateString()
                    : "No due date"}
                </span>
              </WorkspaceLink>
            ))
          ) : (
            <p className="muted">
              You have no open assigned tasks. A good moment for deep work.
            </p>
          )}
        </section>
        <section className="ws-card">
          <div className="ws-section-heading">
            <h2>Waiting for my review</h2>
            <Badge>{dashboard?.reviews?.length ?? 0}</Badge>
          </div>
          {dashboard?.reviews?.length ? (
            dashboard.reviews.map((review: any) => (
              <WorkspaceLink
                className="ws-task-summary"
                key={review.id}
                to={`/projects/${review.project_id}/reviews`}
              >
                <FileText size={18} />
                <div>
                  <strong>{review.note_title}</strong>
                  <small>Requested {timeAgo(review.created_at)}</small>
                </div>
                <ArrowUpRight size={15} />
              </WorkspaceLink>
            ))
          ) : (
            <p className="muted">
              No review requests right now. Project reviews preserve the exact
              revision you read.
            </p>
          )}
        </section>
      </div>
      <footer className="ws-home-footer">
        <span>
          {dashboard?.totals?.notes ?? 0} notes ·{" "}
          {dashboard?.totals?.files ?? 0} files across your authorized spaces
        </span>
        <span>Built for thoughtful, collaborative research.</span>
      </footer>
      {create && (
        <CreateResource
          kind="note"
          space={create}
          onClose={() => setCreate(null)}
          onCreated={(item) => {
            setCreate(null);
            open(item);
          }}
        />
      )}
    </main>
  );
}

export function InboxPage() {
  const { revision, refresh, spaces } = useWorkspace(),
    data = useData<any[]>("inbox", revision),
    action = useAction(),
    [filter, setFilter] = useState("unread");
  const entries =
    data.data?.filter((item) => filter === "all" || !item.read_at) ?? [];
  return (
    <main className="ws-page">
      <PageHeading
        eyebrow="INBOX"
        title="The things that need you"
        actions={
          <>
            <WorkspaceLink
              className="button secondary"
              to="/settings/notifications"
            >
              Preferences
            </WorkspaceLink>
            <button
              className="button secondary"
              disabled={
                action.busy || !data.data?.some((item) => !item.read_at)
              }
              onClick={() =>
                void action.run(async () => {
                  await post("inbox", { read: true });
                  refresh();
                })
              }
            >
              <CheckCheck size={16} />
              Mark all read
            </button>
          </>
        }
      >
        Assignments, mentions, review requests, and due-date reminders.
      </PageHeading>
      <div className="ws-segmented ws-inline-tabs">
        {["unread", "all"].map((value) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === "unread" ? "Unread" : "All activity"}
          </button>
        ))}
      </div>
      <ErrorNotice
        message={data.error || action.error}
        retry={data.error ? data.reload : undefined}
      />
      {data.loading && !data.data ? (
        <Loading />
      ) : !entries.length ? (
        <Empty icon={Bell} title="All caught up">
          When someone needs your input, you’ll find it here.
        </Empty>
      ) : (
        <div className="ws-inbox">
          {entries.map((event) => {
            const space = spaces.find((item) => item.id === event.space_id),
              to = event.resource_id
                ? `/notes/${event.resource_id}`
                : space?.project_id
                  ? `/projects/${space.project_id}/tasks${event.task_id ? "?task=" + event.task_id : ""}`
                  : `/explorer?space=${event.space_id}`;
            return (
              <article
                className={`ws-inbox-entry ${!event.read_at ? "unread" : ""}`}
                key={event.id}
              >
                <span className="ws-resource-glyph">
                  <Bell size={19} />
                </span>
                <WorkspaceLink to={to}>
                  <strong>{event.title}</strong>
                  <small>
                    {space?.name} · {timeAgo(event.created_at)}
                  </small>
                </WorkspaceLink>
                <Badge>{event.kind}</Badge>
                <button
                  className="icon-button"
                  aria-label={event.read_at ? "Mark unread" : "Mark read"}
                  onClick={() =>
                    void action.run(async () => {
                      await post("inbox", {
                        ids: [event.id],
                        read: !event.read_at,
                      });
                      refresh();
                    })
                  }
                >
                  <Check size={17} />
                </button>
              </article>
            );
          })}
        </div>
      )}
      <p className="ws-small muted">
        Only events from spaces you can currently access are shown. Showing the
        latest 100 events.
      </p>
    </main>
  );
}

export function PeoplePage() {
  const { revision, session } = useWorkspace(),
    [search, setSearch] = useState(""),
    [group, setGroup] = useState(""),
    [person, setPerson] = useState<any>(null),
    data = useData<any[]>(
      `people?q=${encodeURIComponent(search)}${group ? "&groupId=" + group : ""}`,
      revision,
    );
  return (
    <main className="ws-page">
      <PageHeading
        eyebrow="PEOPLE"
        title="A shared curiosity"
        actions={
          <WorkspaceLink className="button secondary" to="/settings/profile">
            Edit my profile
          </WorkspaceLink>
        }
      >
        Find expertise and familiar faces across your research groups.
      </PageHeading>
      <div className="ws-list-toolbar">
        <label className="ws-search-field">
          <Search size={17} />
          <input
            aria-label="Search researchers"
            placeholder="Name, affiliation, or research interests…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          aria-label="Filter people by group"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
        >
          <option value="">All my groups</option>
          {session.groups.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <ErrorNotice message={data.error} retry={data.reload} />
      {data.loading && !data.data ? (
        <Loading />
      ) : !data.data?.length ? (
        <Empty icon={Users} title="No matching researchers">
          Try another name or research topic.
        </Empty>
      ) : (
        <div className="ws-people-grid">
          {data.data.map((person) => (
            <button
              className="ws-person-card"
              key={person.id}
              onClick={() => setPerson(person)}
            >
              <Avatar person={person} />
              <strong>{person.name}</strong>
              <span>{person.affiliation || "Researcher"}</span>
              <p>{person.interests || "No research interests added yet."}</p>
              <small>
                View profile
                <ArrowUpRight size={12} />
              </small>
            </button>
          ))}
        </div>
      )}
      {person && (
        <Dialog
          title={person.name}
          subtitle={person.affiliation || "Researcher"}
          onClose={() => setPerson(null)}
        >
          <div className="ws-profile-preview">
            <Avatar person={person} />
            <h3>Research interests</h3>
            <p>{person.interests || "Not added yet."}</p>
            <h3>About</h3>
            <p className="ws-preserve-lines">
              {person.biography ||
                "This researcher hasn’t added a biography yet."}
            </p>
            {person.timezone && (
              <p className="muted">Time zone · {person.timezone}</p>
            )}
            {person.links?.map(
              (link: string) =>
                /^https?:\/\//i.test(link) && (
                  <a
                    key={link}
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ws-profile-link"
                  >
                    {link}
                    <ArrowUpRight size={14} />
                  </a>
                ),
            )}
          </div>
        </Dialog>
      )}
    </main>
  );
}
export function Avatar({
  person,
  className = "",
}: {
  person: { name: string; image?: string | null };
  className?: string;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null),
    image = person.image?.startsWith("/api/v1/people/") ? person.image : null;
  return (
    <span className={`ws-avatar ${className}`.trim()}>
      {image && image !== failedImage ? (
        <img
          key={image}
          src={image}
          alt=""
          onError={() => setFailedImage(image)}
          onLoad={() => setFailedImage(null)}
        />
      ) : (
        initials(person.name)
      )}
    </span>
  );
}

export function ResearchPage() {
  const { spaces, navigate, open, refresh } = useWorkspace(),
    [spaceId, setSpaceId] = useState(""),
    [selected, setSelected] = useState<(typeof templates)[number] | null>(null),
    [name, setName] = useState(""),
    action = useAction();
  return (
    <main className="ws-page">
      <PageHeading eyebrow="RESEARCH" title="Make room for deeper work">
        Keep evidence close, make assumptions visible, and leave a trail others
        can follow.
      </PageHeading>
      <div className="ws-launchers">
        <button onClick={() => navigate("/explorer?view=all&kind=file&q=.pdf")}>
          <span>
            <BookOpen size={23} />
          </span>
          <div>
            <strong>Papers & source files</strong>
            <small>Read, annotate, and cite evidence</small>
          </div>
          <ArrowUpRight size={17} />
        </button>
        <WorkspaceLink to="/research/references">
          <span>
            <FolderOpen size={23} />
          </span>
          <div>
            <strong>Reference library</strong>
            <small>BibTeX and linked literature</small>
          </div>
          <ArrowUpRight size={17} />
        </WorkspaceLink>
        <WorkspaceLink to="/settings/data">
          <span>
            <FileText size={23} />
          </span>
          <div>
            <strong>Offline research</strong>
            <small>Manage locally pinned papers</small>
          </div>
          <ArrowUpRight size={17} />
        </WorkspaceLink>
      </div>
      <section className="ws-section">
        <div className="ws-section-heading">
          <h2>Methods worth reusing</h2>
          <Badge>Research templates</Badge>
        </div>
        <div className="ws-template-grid">
          {templates
            .filter((item) => item.id !== "blank")
            .map((template) => (
              <button
                key={template.id}
                className="ws-template-card"
                onClick={() => {
                  setSelected(template);
                  setName(template.name);
                  setSpaceId(
                    spaces.find((space) => space.kind === "personal")?.id ?? "",
                  );
                }}
              >
                <LayoutTemplate size={24} strokeWidth={1.5} />
                <h3>{template.name}</h3>
                <p>{template.description}</p>
                <span>
                  Use template
                  <ArrowUpRight size={14} />
                </span>
              </button>
            ))}
        </div>
      </section>
      <section className="ws-card ws-research-guide">
        <WorkspaceLink className="button secondary" to="/research/graph">
          Explore the knowledge graph <ArrowUpRight size={14} />
        </WorkspaceLink>
        <h2>A few useful research habits</h2>
        <div>
          <p>
            <strong>Separate observation from interpretation.</strong> Keep
            source data and immutable file versions beside your experiment
            notes.
          </p>
          <p>
            <strong>Record the assumptions.</strong> Use theorem, proof, and
            definition callouts with labeled equations.
          </p>
          <p>
            <strong>Review a specific revision.</strong> Project reviews pin a
            note snapshot, so a later edit doesn’t change what someone approved.
          </p>
          <p>
            <strong>Protect the thinking space.</strong> Personal notes stay
            private. Share deliberately by working inside the right project.
          </p>
        </div>
      </section>
      {selected && (
        <Dialog
          title={`Use ${selected.name.toLowerCase()} template`}
          onClose={() => !action.busy && setSelected(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                const note = await mutate<Resource>("resources", {
                  kind: "note",
                  name,
                  body: selected.body,
                  spaceId,
                });
                setSelected(null);
                refresh();
                open(note);
              });
            }}
          >
            <label>
              Title
              <input
                autoFocus
                required
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Destination
              <select
                value={spaceId}
                required
                onChange={(event) => setSpaceId(event.target.value)}
              >
                {spaces
                  .filter((space) => space.role === "editor")
                  .map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                      {space.kind === "personal" ? " · Only you" : " · Shared"}
                    </option>
                  ))}
              </select>
            </label>
            <ErrorNotice message={action.error} />
            <div className="dialog-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setSelected(null)}
                disabled={action.busy}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={action.busy || !spaceId}
              >
                Create note
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </main>
  );
}
