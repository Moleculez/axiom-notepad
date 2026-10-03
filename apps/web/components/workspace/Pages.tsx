"use client";
import { Button, IconButton, NativeSelect, SearchField } from "../ui/controls";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  FileText,
  FlaskConical,
  LockKeyhole,
  Plus,
  Users,
} from "lucide-react";
import type { Resource, Space } from "@axiom/shared/workspace";
import { post, timeAgo } from "../../lib/client";
import Avatar from "./Avatar";
import { useManagement } from "./ManagementActions";
import {
  Badge,
  Empty,
  ErrorNotice,
  Loading,
  PageHeading,
  ResourceIcon,
  useAction,
  useData,
  useLocation,
  useWorkspace,
  WorkspaceLink,
} from "./ui";
import Dialog from "../Dialog";
const ReviewInbox = dynamic(() => import("../revisions/ReviewInbox"), {
  ssr: false,
});
const CreateResource = dynamic(() =>
  import("./Explorer").then((module) => module.CreateResource),
);

export function HomePage() {
  const management = useManagement();
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
          <Button
            className="button primary"
            disabled={!personal}
            onClick={(event) =>
              personal &&
              management.createMenu(event, {
                spaceId: personal.id,
                parentId: null,
              })
            }
          >
            <Plus size={17} />
            New file
          </Button>
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
        <WorkspaceLink to="/workspaces">
          <span>
            <FlaskConical size={23} />
          </span>
          <div>
            <strong>Workspaces</strong>
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
                to={`/workspaces/${task.space_id}/planning?task=${task.id}`}
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
                to={`/workspaces/${review.space_id}/reviews`}
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
              No review requests right now. Workspace reviews preserve the exact
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
  const { params } = useLocation(),
    requestedView = params.get("view");
  const { revision, refresh, spaces } = useWorkspace(),
    [filter, setFilter] = useState(
      requestedView === "reviews" ? "reviews" : "unread",
    ),
    data = useData<any[]>(filter === "reviews" ? null : "inbox", revision),
    action = useAction();
  useEffect(
    () => setFilter(requestedView === "reviews" ? "reviews" : "unread"),
    [requestedView],
  );
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
            <Button
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
            </Button>
          </>
        }
      >
        Assignments, mentions, review requests, and due-date reminders.
      </PageHeading>
      <div className="ws-segmented ws-inline-tabs">
        {["unread", "all", "reviews"].map((value) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === "unread"
              ? "Unread"
              : value === "reviews"
                ? "Reviews"
                : "All activity"}
          </button>
        ))}
      </div>
      <ErrorNotice
        message={data.error || action.error}
        retry={data.error ? data.reload : undefined}
      />
      {filter === "reviews" ? (
        <ReviewInbox />
      ) : data.loading && !data.data ? (
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
                : event.task_id
                  ? `/workspaces/${event.space_id}/planning?task=${event.task_id}`
                  : `/workspaces/${event.space_id}/overview`;
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
                <IconButton
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
                </IconButton>
              </article>
            );
          })}
        </div>
      )}
      <p className="ws-small muted">
        {filter === "reviews"
          ? "Showing up to 200 assigned reviews and 200 pending proposals from accessible workspaces."
          : "Only events from spaces you can currently access are shown. Showing the latest 100 events."}
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
        <SearchField
          wrapperClassName="ws-search-field"
          aria-label="Search researchers"
          placeholder="Name, affiliation, or research interests…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <NativeSelect
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
        </NativeSelect>
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
export { default as Avatar } from "./Avatar";
