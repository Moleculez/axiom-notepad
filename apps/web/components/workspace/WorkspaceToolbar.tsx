"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  BookOpen,
  ChevronDown,
  File,
  FileText,
  FolderOpen,
  Home,
  Image as ImageIcon,
  LayoutGrid,
  Pin,
  Search,
  Settings,
  Sigma,
  Users,
  Blocks,
  History,
  Trash2,
  Network,
  Braces,
  Music2,
  Film,
  Columns2,
  Cloud,
  CloudOff,
} from "lucide-react";
import { tabTitle } from "@axiom/shared/application-tabs";
import {
  locationResourceId,
  workspaceLocation,
} from "@axiom/shared/workspace-location";
import {
  useWorkSessions,
  publishSessionTitle,
} from "../../lib/workspace-sessions";
import { useData, useLocation, useWorkspace, WorkspaceLink } from "./ui";
import type { ResourceLocation, ResourcePage } from "@axiom/shared/workspace";
import { requestFileCreation } from "../../lib/file-creation";
import { fileRouteId } from "@axiom/shared/file-routes";
import {
  settingsCategories,
  settingsCategory,
} from "../../lib/settings-registry";

export const destinations = [
  ["/home", "Home", "Recent work and your day", Home],
  ["/explorer", "Explorer", "Notes, folders and files", FolderOpen],
  ["/research", "Research", "References and connections", BookOpen],
  ["/groups", "Groups", "Create, join and manage your groups", Users],
  [
    "/workspaces",
    "Workspaces",
    "Files, planning, milestones and collaboration",
    Blocks,
  ],
  ["/audit", "Audit", "Change history and operation progress", History],
  ["/trash", "Trash", "Recover files and workspaces", Trash2],
  ["/inbox", "Inbox", "Mentions and notifications", Bell],
  ["/people", "People", "Your collaborators", Users],
  ["/settings/appearance", "Settings", "Make the workspace yours", Settings],
] as const;
export const locationIcon = (path: string) => {
  const icons = {
    notes: FileText,
    files: File,
    image: ImageIcon,
    canvas: Network,
    text: Braces,
    math: Sigma,
    audio: Music2,
    video: Film,
    pdf: BookOpen,
    document: FileText,
  };
  const section = path.split(/[/?]/)[1];
  return (
    icons[section as keyof typeof icons] ??
    destinations.find(([route]) => route.split("/")[1] === section)?.[3] ??
    LayoutGrid
  );
};

export function WorkspaceLocation() {
  const sessions = useWorkSessions()!,
    { path, params } = useLocation(),
    { spaces, navigate, revision, session } = useWorkspace();
  const route = path + (params.size ? `?${params}` : ""),
    resourceId = locationResourceId(route),
    resourcePath = resourceId ? `resources/${resourceId}/location` : null;
  const space =
    spaces.find(
      (s) =>
        s.id ===
        (path.startsWith("/workspaces/")
          ? path.split("/")[2]
          : params.get("space")),
    ) ??
    (path === "/explorer" &&
    !params.has("space") &&
    !params.has("folder") &&
    (!params.has("view") || params.get("view") === "folder")
      ? spaces.find((s) => s.kind === "personal")
      : undefined);
  const data = useData<ResourceLocation>(resourcePath, revision);
  useEffect(() => {
    if (data.data?.resource.id === resourceId && fileRouteId(route))
      publishSessionTitle(route + location.hash, data.data.resource.name);
  }, [data.data, resourceId, route]);
  const { crumbs, up } = workspaceLocation({
    route,
    title: path.startsWith("/settings/")
      ? settingsCategories.find(
          (category) =>
            category.id ===
            settingsCategory(path.split("/")[2], params.get("section")),
        )?.label
      : sessions.active?.title,
    location: data.data,
    space,
    group: path.startsWith("/groups/")
      ? session.groups.find((g) => g.id === path.split("/")[2])
      : undefined,
  });
  const loading = !!resourceId && (data.loading || data.path !== resourcePath),
    trail = useRef<HTMLElement>(null),
    trailKey = JSON.stringify(crumbs);
  useEffect(() => {
    if (trail.current) trail.current.scrollLeft = trail.current.scrollWidth;
  }, [route, trailKey]);
  return (
    <div className="workspace-location">
      <div className="workspace-history" aria-label="Navigation history">
        <button
          className="icon-button"
          aria-label="Go back"
          title="Back"
          disabled={sessions.state.index <= 0}
          onClick={() => sessions.back(-1)}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Go forward"
          title="Forward"
          disabled={sessions.state.index >= sessions.state.history.length - 1}
          onClick={() => sessions.back(1)}
        >
          <ArrowRight size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Up one level"
          title="Parent folder"
          disabled={!up || loading}
          onClick={() => up && navigate(up)}
        >
          <ArrowUp size={16} />
        </button>
      </div>
      <nav
        ref={trail}
        aria-label="Current location"
        aria-busy={loading}
        aria-description={
          data.error
            ? "The folder path is unavailable. You can return to the collection."
            : undefined
        }
      >
        {crumbs.map((crumb, index) => (
          <Fragment key={`${index}:${crumb.to ?? "current"}`}>
            {index > 0 && <span aria-hidden="true">/</span>}
            {crumb.to ? (
              <WorkspaceLink to={crumb.to} title={crumb.label}>
                {crumb.label}
              </WorkspaceLink>
            ) : (
              <strong aria-current="page" title={crumb.label}>
                {crumb.label}
              </strong>
            )}
          </Fragment>
        ))}
      </nav>
      <RecentWork />
    </div>
  );
}

function RecentWork() {
  const sessions = useWorkSessions()!,
    { revision, open } = useWorkspace();
  const root = useRef<HTMLDetailsElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(false),
    [query, setQuery] = useState(""),
    [left, setLeft] = useState(0);
  const resources = useData<ResourcePage>(
    shown ? "resources?view=recent&limit=100" : null,
    revision,
  );
  const names = new Map(
    resources.data?.items.map((item) => [item.id, item.name]),
  );
  const title = (item: (typeof sessions.state.sessions)[number]) =>
    item.title ??
    names.get(fileRouteId(item.path) ?? "") ??
    tabTitle(item.path);
  const items = [...sessions.state.sessions]
    .reverse()
    .filter((item) =>
      `${title(item)} ${item.path}`.toLowerCase().includes(query.toLowerCase()),
    );
  const dismiss = (focus = false) => {
    if (root.current) root.current.open = false;
    if (focus) root.current?.querySelector("summary")?.focus();
  };
  useEffect(() => {
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        dismiss();
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape" && root.current?.open) {
        event.preventDefault();
        dismiss(true);
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.altKey &&
        event.code === "KeyR" &&
        !event.isComposing &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        if (root.current) root.current.open = !root.current.open;
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("keydown", keys);
    };
  }, []);
  return (
    <details
      ref={root}
      className="workspace-recent"
      name="workspace-toolbar-popover"
      onToggle={() => {
        const open = !!root.current?.open;
        setShown(open);
        if (open) {
          const rect = root.current!.getBoundingClientRect();
          const width = Math.min(420, window.innerWidth - 32);
          setLeft(
            Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)) -
              rect.left,
          );
          setQuery("");
          input.current?.focus();
        }
      }}
    >
      <summary
        role="button"
        className="icon-button"
        aria-label="Recent work"
        title="Recent work · ⌘/Ctrl Alt R"
        aria-expanded={shown}
      >
        <ChevronDown size={15} />
      </summary>
      <div
        className="workspace-recent-popover"
        style={{ left }}
        role="region"
        aria-label="Recent work switcher"
      >
        <header>
          <History size={16} />
          <strong>Recent work</strong>
          <small>On this device</small>
        </header>
        <label className="workspace-recent-search">
          <Search size={15} />
          <input
            ref={input}
            aria-label="Filter recent work"
            placeholder="Find a page or file…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                root.current
                  ?.querySelector<HTMLButtonElement>(".workspace-recent-open")
                  ?.focus();
              }
            }}
          />
        </label>
        <div className="workspace-recent-list">
          {[true, false].map((pinned) => {
            const group = items.filter((item) => !!item.pinned === pinned);
            return group.length ? (
              <section
                key={String(pinned)}
                aria-label={pinned ? "Pinned work" : "Recently visited"}
              >
                <h3>{pinned ? "Pinned" : "Recently visited"}</h3>
                {group.map((item) => {
                  const Icon = locationIcon(item.path),
                    name = title(item);
                  return (
                    <div
                      key={item.id}
                      className="workspace-recent-row"
                      data-active={item.id === sessions.state.active}
                    >
                      <button
                        className="workspace-recent-open"
                        aria-current={
                          item.id === sessions.state.active ? "page" : undefined
                        }
                        onClick={() => {
                          dismiss();
                          sessions.select(item.id);
                        }}
                      >
                        <Icon size={17} />
                        <span>
                          <strong>{name}</strong>
                          <small>
                            {tabTitle(item.path)}
                            {fileRouteId(item.path)
                              ? ` · ${fileRouteId(item.path)!.slice(0, 8)}`
                              : ""}
                          </small>
                        </span>
                      </button>
                      {fileRouteId(item.path) && (
                        <button
                          className="icon-button"
                          aria-label={`Open ${name} in split view`}
                          title="Open in split view"
                          onClick={() => {
                            dismiss();
                            open(
                              {
                                id: fileRouteId(item.path)!,
                                route: item.path,
                                name,
                                versionId:
                                  new URL(
                                    item.path,
                                    "http://workspace.local",
                                  ).searchParams.get("version") ?? undefined,
                                kind: item.path.startsWith("/notes/")
                                  ? "note"
                                  : "file",
                              },
                              true,
                            );
                          }}
                        >
                          <Columns2 size={15} />
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label={`${item.pinned ? "Unpin" : "Pin"} ${name}`}
                        title={item.pinned ? "Unpin" : "Pin for quick access"}
                        aria-pressed={!!item.pinned}
                        onClick={() =>
                          sessions.update(item.id, { pinned: !item.pinned })
                        }
                      >
                        <Pin size={14} />
                      </button>
                    </div>
                  );
                })}
              </section>
            ) : null;
          })}
          {!items.length && <p className="muted">No matching recent work.</p>}
        </div>
        <footer>
          Switch pages without closing your work. <kbd>⌘/Ctrl Alt R</kbd>
        </footer>
      </div>
    </details>
  );
}

export function WorkspaceStatus({ offline }: { offline: boolean }) {
  const { path } = useLocation(),
    id = fileRouteId(path);
  const [document, setDocument] = useState<{
    id: string;
    status: string;
  } | null>(null);
  useEffect(() => {
    const listener = (event: Event) =>
      setDocument(
        (event as CustomEvent<{ id: string; status: string }>).detail,
      );
    window.addEventListener("axiom:document-status", listener);
    return () => window.removeEventListener("axiom:document-status", listener);
  }, []);
  const message = document?.id === id ? document.status : null;
  const label = offline
    ? "Offline"
    : message?.includes("Saved on server")
      ? "Saved"
      : message
        ? "Sync"
        : "Online";
  return (
    <span
      className="workspace-connection"
      data-offline={offline}
      title={
        message ??
        (offline
          ? "Offline. Cached work remains available."
          : "Network available. Individual file save status appears in its editor.")
      }
      aria-label={message ?? label}
    >
      {offline ? <CloudOff size={15} /> : <Cloud size={15} />}
      <span>{label}</span>
    </span>
  );
}

/** Existing /new bookmarks remain useful, without reviving a tab lifecycle. */
export function WorkspaceLauncher() {
  const { navigate } = useWorkspace();
  return (
    <main className="ws-page application-launcher">
      <span className="ws-eyebrow">YOUR WORKSPACE</span>
      <h1>Room for your next idea.</h1>
      <p>Choose a page, or search your notes and research.</p>
      <section className="application-create-files" aria-label="Create a file">
        {(
          [
            ["markdown", "Markdown", FileText],
            ["canvas", "Canvas", Network],
            ["math", "Math", Sigma],
            ["image", "Drawing", ImageIcon],
            ["text", "Text", Braces],
          ] as const
        ).map(([type, label, Icon]) => (
          <button
            type="button"
            key={type}
            className="button secondary"
            onClick={() => requestFileCreation({ type })}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </section>
      <div className="application-destinations">
        {destinations.map(([path, title, description, Icon]) => (
          <button key={path} onClick={() => navigate(path)}>
            <Icon size={23} />
            <strong>{title}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
      <p className="ws-note">
        ⌘/Ctrl K · Search & commands &nbsp; · &nbsp; ⌘/Ctrl Alt R · Recent work
      </p>
    </main>
  );
}
