"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Ellipsis,
  Folder,
  FolderOpen,
  History,
  House,
  LockKeyhole,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type {
  Resource,
  ResourcePage,
  ResourceLocation,
} from "@axiom/shared/workspace";
import { fileRouteId } from "@axiom/shared/file-routes";
import { useManagement } from "./ManagementActions";
import {
  ResourceIcon,
  useData,
  useLocation,
  useWorkspace,
  WorkspaceLink,
} from "./ui";

function folderLocation(spaceId: string, parentId?: string | null) {
  return `/workspaces/${spaceId}/files${parentId ? "?folder=" + parentId : ""}`;
}

/** A directory, not a nested tree: keyboard navigation stays in this level. */
function directoryKey(event: React.KeyboardEvent<HTMLElement>, up: () => void) {
  if (event.key === "ArrowLeft" || (event.altKey && event.key === "ArrowUp")) {
    event.preventDefault();
    up();
    return true;
  }
  if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey)
    return false;
  const row = event.currentTarget;
  if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
    const rows = Array.from(
      row
        .closest(".sidebar-directory-list")
        ?.querySelectorAll<HTMLElement>(".sidebar-directory-row") ?? [],
    );
    const index = rows.indexOf(row);
    const next =
      event.key === "Home"
        ? rows[0]
        : event.key === "End"
          ? rows.at(-1)
          : rows[
              Math.max(
                0,
                Math.min(
                  rows.length - 1,
                  index + (event.key === "ArrowUp" ? -1 : 1),
                ),
              )
            ];
    next?.focus();
  } else if (event.key === "Enter" && event.target === row) {
    row.querySelector<HTMLElement>(".sidebar-directory-open")?.click();
  } else if (event.key === "ArrowRight" && event.target === row) {
    row.querySelector<HTMLElement>("[data-enter-directory]")?.click();
  } else return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export default function WorkspaceSidebar() {
  const { revision } = useWorkspace();
  const { params, path } = useLocation();
  const resourceId = fileRouteId(path);
  const location = useData<ResourceLocation>(
    resourceId ? `resources/${resourceId}/location` : null,
    revision,
  );
  const spaceId =
    (path.startsWith("/workspaces/") ? path.split("/")[2] : null) ??
    params.get("space") ??
    location.data?.space.id ??
    null;
  const parentId =
    params.get("folder") ?? location.data?.resource.parent_id ?? null;
  const views = [
    ["/explorer?view=recent", Clock3, "Recent"],
    ["/explorer?view=favorites", Star, "Favorites"],
    ["/inbox?view=reviews", ClipboardCheck, "Review inbox"],
    ["/audit", History, "Audit"],
    ["/trash", Trash2, "Trash"],
  ] as const;
  return (
    <>
      <nav
        className="ws-tree-section sidebar-quick-access"
        aria-label="Quick access"
      >
        <span className="ws-section-label">Quick access</span>
        {views.map(([to, Icon, label]) => {
          const [target, query] = to.split("?");
          const active =
            path === target &&
            (!query ||
              params.get("view") === new URLSearchParams(query).get("view"));
          return (
            <WorkspaceLink
              key={to}
              to={to}
              className={`ws-side-link ${active ? "active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={16} />
              <span>{label}</span>
            </WorkspaceLink>
          );
        })}
      </nav>
      <SavedViews />
      {resourceId && !location.data ? (
        <section className="sidebar-directory" aria-label="Files">
          <WorkspaceLink className="ws-section-label" to="/workspaces">
            All workspaces
          </WorkspaceLink>
          <p className="sidebar-directory-message">
            {location.error ? (
              <button onClick={location.reload}>
                Could not locate this file. Retry
              </button>
            ) : (
              "Locating file…"
            )}
          </p>
        </section>
      ) : (
        <Directory
          key={`${spaceId}:${parentId}`}
          spaceId={spaceId}
          parentId={parentId}
          activeId={resourceId}
        />
      )}
    </>
  );
}

function Directory({
  spaceId,
  parentId,
  activeId,
}: {
  spaceId: string | null;
  parentId: string | null;
  activeId: string | null;
}) {
  const { spaces, revision, navigate } = useWorkspace();
  const management = useManagement();
  const space = spaces.find((s) => s.id === spaceId);
  const [filter, setFilter] = useState("");
  const [debounced, setDebounced] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(filter.trim());
      setCursors([]);
    }, 180);
    return () => clearTimeout(timer);
  }, [filter]);
  const query = new URLSearchParams({
    spaceId: spaceId ?? "",
    limit: "40",
    ...(parentId ? { parentId } : {}),
    ...(debounced ? { name: debounced } : {}),
    ...(cursors.length ? { cursor: cursors.at(-1)! } : {}),
  });
  const data = useData<ResourcePage>(
    spaceId ? `resources?${query}` : null,
    revision,
  );
  const [retainedTrail, setRetainedTrail] = useState<
    ResourcePage["breadcrumbs"]
  >([]);
  useEffect(() => {
    if (data.data) setRetainedTrail(data.data.breadcrumbs);
    else if (data.error) setRetainedTrail([]);
  }, [data.data, data.error]);
  // Filtering/paging does not change the physical location. Keep its path and
  // Up target stable, but clear it if an authoritative response denies access.
  const trail = data.data?.breadcrumbs ?? (data.error ? [] : retainedTrail);
  const parent = parentId ? trail.at(-2)?.id : null;
  const upTo = parentId ? folderLocation(spaceId!, parent) : "/workspaces";
  const up = () => {
    if (spaceId && (!parentId || trail.length)) navigate(upTo);
  };
  const title = trail.at(-1)?.name ?? space?.name ?? "All workspaces";
  const visibleSpaces = spaces.filter(
    (s) =>
      s.effective_status === "active" &&
      `${s.name} ${s.group_name ?? ""}`
        .toLocaleLowerCase()
        .includes(filter.trim().toLocaleLowerCase()),
  );
  const target = spaceId ? { spaceId, parentId } : undefined;
  const breadcrumbs = [
    { to: "/workspaces", name: "All workspaces" },
    ...(spaceId
      ? [{ to: folderLocation(spaceId), name: space?.name ?? "Workspace" }]
      : []),
    ...trail.map((item) => ({
      to: folderLocation(spaceId!, item.id),
      name: item.name,
    })),
  ];
  return (
    <section
      className="sidebar-directory"
      aria-label="Files"
      onContextMenu={(event) => {
        if (
          !(event.target as Element).closest(
            ".sidebar-directory-row, .sidebar-directory-breadcrumbs",
          )
        )
          management.backgroundMenu(event, target);
      }}
      onDragOver={(event) => {
        if (target) management.dragOver(event, target);
      }}
      onDragLeave={management.dragLeave}
      onDrop={(event) => {
        if (target) management.drop(event, target);
      }}
    >
      <div className="sidebar-directory-heading">
        <span className="ws-section-label">Files</span>
        <div>
          <WorkspaceLink
            className="icon-button"
            to="/workspaces"
            aria-label="All workspaces"
            title="All workspaces"
          >
            <House size={15} />
          </WorkspaceLink>
          <button
            className="icon-button"
            type="button"
            disabled={!spaceId || (!!parentId && !trail.length)}
            aria-label="Up one level"
            title="Up one level · Alt+↑"
            onClick={up}
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
      <nav
        className="sidebar-directory-breadcrumbs"
        aria-label="Sidebar directory path"
      >
        {breadcrumbs.map((crumb, index) => (
          <span key={crumb.to}>
            {index > 0 && <ChevronRight size={11} aria-hidden="true" />}
            <WorkspaceLink
              to={crumb.to}
              title={crumb.name}
              aria-current={
                index === breadcrumbs.length - 1 ? "location" : undefined
              }
            >
              {crumb.name}
            </WorkspaceLink>
          </span>
        ))}
      </nav>
      <div className="sidebar-directory-filter">
        <Search size={14} />
        <input
          ref={input}
          aria-label={
            spaceId ? "Filter files in this folder" : "Filter workspaces"
          }
          placeholder={spaceId ? "Filter this folder…" : "Find a workspace…"}
          value={filter}
          maxLength={200}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && filter) {
              event.preventDefault();
              event.stopPropagation();
              setFilter("");
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              list.current
                ?.querySelector<HTMLElement>(".sidebar-directory-row")
                ?.focus();
            }
          }}
        />
        {filter && (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear sidebar filter"
            onClick={() => {
              setFilter("");
              input.current?.focus();
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
      <ul
        ref={list}
        className="sidebar-directory-list"
        aria-label={spaceId ? `Files in ${title}` : "Workspaces"}
      >
        {!spaceId
          ? visibleSpaces.map((item) => (
              <li key={item.id}>
                <div
                  className="sidebar-directory-row sidebar-workspace-row"
                  tabIndex={0}
                  aria-label={item.name}
                  onKeyDown={(event) => {
                    if (
                      !directoryKey(event, up) &&
                      (event.key === "ContextMenu" ||
                        (event.shiftKey && event.key === "F10"))
                    )
                      management.workspaceMenu(event, item);
                  }}
                  onContextMenu={(event) =>
                    management.workspaceMenu(event, item)
                  }
                  onDragOver={(event) =>
                    management.dragOver(event, {
                      spaceId: item.id,
                      parentId: null,
                    })
                  }
                  onDragLeave={management.dragLeave}
                  onDrop={(event) =>
                    management.drop(event, { spaceId: item.id, parentId: null })
                  }
                >
                  <WorkspaceLink
                    className="sidebar-directory-open"
                    data-enter-directory
                    to={folderLocation(item.id)}
                    tabIndex={-1}
                    title={item.name}
                  >
                    {item.kind === "personal" ? (
                      <LockKeyhole size={17} />
                    ) : (
                      <FolderOpen size={17} />
                    )}
                    <span>
                      <span>{item.name}</span>
                      <small>
                        {item.kind === "personal"
                          ? "Personal"
                          : (item.group_name ?? "Shared workspace")}
                      </small>
                    </span>
                    <ChevronRight className="sidebar-enter-hint" size={13} />
                  </WorkspaceLink>
                  <button
                    type="button"
                    className="icon-button sidebar-row-more"
                    aria-label={`Workspace actions for ${item.name}`}
                    onClick={(event) => management.workspaceMenu(event, item)}
                  >
                    <Ellipsis size={15} />
                  </button>
                </div>
              </li>
            ))
          : data.data?.items.map((item) => (
              <DirectoryRow
                key={item.id}
                item={item}
                active={item.id === activeId}
                up={up}
              />
            ))}
      </ul>
      {spaceId && data.error && (
        <p className="sidebar-directory-message">
          <button type="button" onClick={data.reload}>
            {data.data
              ? "Could not refresh items. Retry"
              : "Could not load items. Retry"}
          </button>
        </p>
      )}
      {spaceId && data.loading && !data.data && (
        <p className="sidebar-directory-message" role="status">
          Loading files…
        </p>
      )}
      {((!spaceId && !visibleSpaces.length) ||
        (spaceId && data.data?.items.length === 0)) && (
        <p className="sidebar-directory-message" role="status">
          {filter
            ? `No matching ${spaceId ? "files" : "workspaces"}.`
            : spaceId
              ? "No items yet"
              : "Your workspaces will appear here."}
        </p>
      )}
      {spaceId && (cursors.length > 0 || data.data?.nextCursor) && (
        <nav
          className="sidebar-directory-pagination"
          aria-label="Directory pages"
        >
          <button
            type="button"
            className="icon-button"
            aria-label="Previous files"
            disabled={!cursors.length || data.loading}
            onClick={() => setCursors((value) => value.slice(0, -1))}
          >
            <ChevronLeft size={15} />
          </button>
          <span>Page {cursors.length + 1}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Next files"
            disabled={!data.data?.nextCursor || data.loading}
            onClick={() =>
              setCursors((value) => [...value, data.data!.nextCursor!])
            }
          >
            <ChevronRight size={15} />
          </button>
        </nav>
      )}
    </section>
  );
}

function DirectoryRow({
  item,
  active,
  up,
}: {
  item: Resource;
  active: boolean;
  up: () => void;
}) {
  const management = useManagement();
  const { open } = useWorkspace();
  const folder = item.kind === "folder";
  const destination = folderLocation(item.space_id, item.id);
  return (
    <li>
      <div
        className={`sidebar-directory-row ${active ? "active" : ""}`}
        data-directory-resource={item.id}
        data-folder-color={item.folder_color || undefined}
        tabIndex={0}
        aria-label={item.name}
        draggable={!item.deleted_at}
        onDragStart={(event) => {
          event.stopPropagation();
          management.beginDrag(event, [item]);
        }}
        onDragOver={(event) => {
          if (folder)
            management.dragOver(event, {
              spaceId: item.space_id,
              parentId: item.id,
            });
        }}
        onDragLeave={management.dragLeave}
        onDrop={(event) => {
          if (folder)
            management.drop(event, {
              spaceId: item.space_id,
              parentId: item.id,
            });
        }}
        onContextMenu={(event) => management.resourceMenu(event, [item])}
        onKeyDown={(event) => {
          if (!directoryKey(event, up))
            management.resourceKey(
              event,
              [item],
              {},
              {
                spaceId: item.space_id,
                parentId: folder ? item.id : item.parent_id,
              },
            );
        }}
      >
        {folder ? (
          <WorkspaceLink
            className="sidebar-directory-open"
            data-enter-directory
            to={destination}
            title={item.name}
            tabIndex={-1}
          >
            <Folder size={16} />
            <span>{item.name}</span>
            <ChevronRight className="sidebar-enter-hint" size={13} />
          </WorkspaceLink>
        ) : (
          <button
            type="button"
            className="sidebar-directory-open"
            title={item.name}
            tabIndex={-1}
            aria-current={active ? "page" : undefined}
            onClick={() => open(item)}
          >
            <ResourceIcon resource={item} size={16} />
            <span>{item.name}</span>
          </button>
        )}
        {!folder && item.has_children && (
          <WorkspaceLink
            className="icon-button sidebar-row-children"
            data-enter-directory
            to={destination}
            aria-label={`Browse contents of ${item.name}`}
            title="Browse attached files and child notes"
          >
            <FolderOpen size={14} />
          </WorkspaceLink>
        )}
        <button
          type="button"
          className="icon-button sidebar-row-more"
          aria-label={`Actions for ${item.name}`}
          title="File actions"
          onClick={(event) => management.resourceMenu(event, [item])}
        >
          <Ellipsis size={15} />
        </button>
      </div>
    </li>
  );
}

function SavedViews() {
  const { revision } = useWorkspace(),
    data = useData<
      { id: string; name: string; filters: Record<string, string> }[]
    >("saved-views", revision);
  if (!data.data?.length) return null;
  return (
    <div className="ws-tree-section">
      <span className="ws-section-label">Saved searches</span>
      {data.data.map((view) => {
        const query = new URLSearchParams({
          ...view.filters,
          space: view.filters.spaceId ?? "",
        });
        query.delete("spaceId");
        return (
          <WorkspaceLink
            key={view.id}
            className="ws-side-link"
            to={`/explorer?${query}`}
          >
            <Search size={15} />
            <span>{view.name}</span>
          </WorkspaceLink>
        );
      })}
    </div>
  );
}
