"use client";
import { createContext, useContext, useEffect, useState } from "react";
import {
  Blocks,
  ClipboardCheck,
  ChevronRight,
  Clock3,
  Folder,
  History,
  LockKeyhole,
  Search,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import type {
  Resource,
  ResourcePage,
  ResourceLocation,
  Space,
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
const ActiveAncestors = createContext<readonly string[]>([]);

function folderLocation(spaceId: string, parentId?: string | null) {
  return `/explorer?space=${spaceId}${parentId ? "&folder=" + parentId : ""}`;
}
function isPlainClick(event: React.MouseEvent<HTMLElement>) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
function treeKey(
  event: React.KeyboardEvent<HTMLElement>,
  expanded: boolean,
  expand: (value: boolean) => void,
  expandable = true,
) {
  if (event.altKey || event.metaKey || event.ctrlKey) return false;
  const row = event.currentTarget;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    const rows = Array.from(
      row.closest(".ws-tree")?.querySelectorAll<HTMLElement>(".ws-tree-row") ??
        [],
    );
    const next = rows[rows.indexOf(row) + (event.key === "ArrowUp" ? -1 : 1)];
    next?.focus();
  } else if (event.key === "ArrowRight") {
    if (!expanded && expandable) expand(true);
    else
      row.parentElement
        ?.querySelector<HTMLElement>(":scope > ul .ws-tree-row")
        ?.focus();
  } else if (event.key === "ArrowLeft") {
    if (expanded) expand(false);
    else
      row.parentElement?.parentElement
        ?.closest("li")
        ?.querySelector<HTMLElement>(":scope > .ws-tree-row")
        ?.focus();
  } else if (event.key === "Enter" && event.target === row)
    row.querySelector<HTMLElement>("a, .ws-tree-resource")?.click();
  else return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}
export default function WorkspaceSidebar() {
  const management = useManagement();
  const { spaces, revision } = useWorkspace(),
    { params, path } = useLocation();
  const resourceId = fileRouteId(path);
  const location = useData<ResourceLocation>(
    resourceId ? `resources/${resourceId}/location` : null,
    revision,
  );
  const selected = params.get("space") ?? location.data?.space.id ?? null,
    parent = params.get("folder") ?? location.data?.resource.parent_id ?? null;
  const views = [
    ["recent", Clock3, "Recent"],
    ["favorites", Star, "Favorites"],
  ] as const;
  return (
    <ActiveAncestors.Provider
      value={location.data?.ancestors.map((item) => item.id) ?? []}
    >
      <div className="ws-tree-section">
        <span className="ws-section-label">Quick access</span>
        {views.map(([view, Icon, label]) => (
          <WorkspaceLink
            className={`ws-side-link ${path === "/explorer" && params.get("view") === view ? "active" : ""}`}
            key={view}
            to={`/explorer?view=${view}`}
          >
            <Icon size={17} />
            {label}
          </WorkspaceLink>
        ))}
      </div>
      <SavedViews />
      <WorkspaceLink
        className={"ws-side-link " + (path === "/inbox" ? "active" : "")}
        to="/inbox?view=reviews"
      >
        <ClipboardCheck size={17} />
        Review inbox
      </WorkspaceLink>
      <div
        className="ws-tree-section"
        onContextMenu={(event) => {
          if (!(event.target as Element).closest(".ws-tree-row"))
            management.backgroundMenu(event);
        }}
      >
        <div className="ws-tree-section-heading">
          <span className="ws-section-label">Your spaces</span>
        </div>
        <ul className="ws-tree" aria-label="Spaces and folders">
          {spaces
            .filter(
              (space) =>
                space.kind !== "project" && space.effective_status === "active",
            )
            .map((space) => (
              <SpaceBranch
                key={space.id}
                space={space}
                selected={selected}
                parent={parent}
                revision={revision}
                projects={spaces.filter(
                  (project) =>
                    project.kind === "project" &&
                    project.effective_status === "active" &&
                    project.group_id === space.group_id,
                )}
              />
            ))}
        </ul>
      </div>
      <nav
        className="ws-tree-section ws-administration"
        aria-label="Administration"
      >
        <span className="ws-section-label">Administration</span>
        {(
          [
            ["/workspaces", "Workspaces", Blocks],
            ["/groups", "Groups", Users],
            ["/audit", "Audit", History],
            ["/trash", "Trash", Trash2],
          ] as const
        ).map(([to, label, Icon]) => (
          <WorkspaceLink
            key={to}
            to={to}
            className={`ws-side-link ${path === to || path.startsWith(to + "/") ? "active" : ""}`}
            aria-current={
              path === to || path.startsWith(to + "/") ? "page" : undefined
            }
          >
            <Icon size={17} />
            <span>{label}</span>
          </WorkspaceLink>
        ))}
      </nav>
    </ActiveAncestors.Provider>
  );
}
function SpaceBranch({
  space,
  selected,
  parent,
  revision,
  projects = [],
}: {
  space: Space;
  selected: string | null;
  parent: string | null;
  revision: number;
  projects?: Space[];
}) {
  const management = useManagement();
  const activeBranch =
    selected === space.id ||
    projects.some((project) => project.id === selected);
  const [expanded, setExpanded] = useState(activeBranch);
  useEffect(() => {
    if (activeBranch) setExpanded(true);
  }, [selected, activeBranch]);
  const Icon =
    space.kind === "personal"
      ? LockKeyhole
      : space.kind === "project"
        ? Folder
        : Folder;
  return (
    <li>
      <div
        className={`ws-tree-row ${selected === space.id && !parent ? "active" : ""}`}
        onDragOver={(event) =>
          management.dragOver(
            event,
            { spaceId: space.id, parentId: null },
            () => setExpanded(true),
          )
        }
        onDragLeave={management.dragLeave}
        onDrop={(event) =>
          management.drop(event, { spaceId: space.id, parentId: null })
        }
        tabIndex={0}
        onContextMenu={(event) => management.workspaceMenu(event, space)}
        onKeyDown={(event) => {
          if (
            !treeKey(event, expanded, setExpanded) &&
            (event.key === "ContextMenu" ||
              (event.key === "F10" && event.shiftKey))
          )
            management.workspaceMenu(event, space);
        }}
      >
        <button
          type="button"
          className="ws-tree-toggle"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${space.name}`}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRight size={13} />
        </button>
        <WorkspaceLink
          to={folderLocation(space.id)}
          title={space.name}
          onClick={(event) => {
            if (isPlainClick(event)) setExpanded(true);
          }}
        >
          <Icon size={16} />
          <span>{space.name}</span>
        </WorkspaceLink>
      </div>
      {expanded && (
        <>
          <ResourceBranches
            space={space.id}
            parentId={null}
            selected={parent}
            revision={revision}
            ancestors={[]}
            showEmpty={!projects.length}
          />
          {projects.length > 0 && (
            <ul aria-label={`${space.name} projects`}>
              {projects.map((project) => (
                <SpaceBranch
                  key={project.id}
                  space={project}
                  selected={selected}
                  parent={parent}
                  revision={revision}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}
function ResourceBranches({
  space,
  parentId,
  selected,
  revision,
  ancestors,
  showEmpty = true,
}: {
  space: string;
  parentId: string | null;
  selected: string | null;
  revision: number;
  ancestors: string[];
  showEmpty?: boolean;
}) {
  const data = useData<ResourcePage>(
    `resources?spaceId=${space}&limit=40${parentId ? "&parentId=" + parentId : ""}`,
    revision,
  );
  return (
    <ul>
      {data.error && (
        <li className="ws-tree-message">
          <button type="button" onClick={data.reload}>
            Could not load items. Retry
          </button>
        </li>
      )}
      {data.loading && !data.data && (
        <li className="ws-tree-message">Loading…</li>
      )}
      {data.data?.items.map((item) => (
        <ResourceBranch
          key={item.id}
          item={item}
          selected={selected}
          revision={revision}
          ancestors={ancestors}
        />
      ))}
      {showEmpty && !data.loading && data.data?.items.length === 0 && (
        <li className="ws-tree-message">No items yet</li>
      )}
      {data.data?.nextCursor && (
        <li>
          <WorkspaceLink
            className="ws-side-link"
            to={folderLocation(space, parentId)}
          >
            Browse all items…
          </WorkspaceLink>
        </li>
      )}
    </ul>
  );
}
function ResourceBranch({
  item,
  selected,
  revision,
  ancestors,
}: {
  item: Resource;
  selected: string | null;
  revision: number;
  ancestors: string[];
}) {
  const management = useManagement();
  const { open } = useWorkspace();
  const { parts } = useLocation();
  const folder = item.kind === "folder";
  const expandable = folder || (item.kind === "note" && item.has_children);
  const activeAncestors = useContext(ActiveAncestors);
  const active = folder
    ? selected === item.id
    : fileRouteId("/" + parts.join("/")) === item.id;
  const reveal = folder && (active || activeAncestors.includes(item.id));
  const [expanded, setExpanded] = useState(reveal);
  useEffect(() => {
    if (reveal) setExpanded(true);
  }, [reveal]);
  if (ancestors.includes(item.id) || ancestors.length > 40) return null;
  return (
    <li>
      <div
        className={`ws-tree-row ${active ? "active" : ""}`}
        data-tree-resource={item.id}
        data-folder-color={item.folder_color || undefined}
        draggable={!item.deleted_at}
        onDragStart={(event) => {
          event.stopPropagation();
          management.beginDrag(event, [item]);
        }}
        onDragOver={(event) => {
          if (folder)
            management.dragOver(
              event,
              { spaceId: item.space_id, parentId: item.id },
              () => setExpanded(true),
            );
        }}
        onDragLeave={management.dragLeave}
        onDrop={(event) => {
          if (folder)
            management.drop(event, {
              spaceId: item.space_id,
              parentId: item.id,
            });
        }}
        tabIndex={0}
        onContextMenu={(event) => management.resourceMenu(event, [item])}
        onKeyDown={(event) => {
          if (!treeKey(event, expanded, setExpanded, expandable))
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
        {expandable ? (
          <button
            type="button"
            className="ws-tree-toggle"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${item.name}`}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronRight size={13} />
          </button>
        ) : (
          <span className="ws-tree-spacer" aria-hidden="true" />
        )}
        {folder ? (
          <WorkspaceLink
            to={folderLocation(item.space_id, item.id)}
            title={item.name}
            onClick={(event) => {
              if (isPlainClick(event)) setExpanded(true);
            }}
          >
            <Folder size={15} />
            <span>{item.name}</span>
          </WorkspaceLink>
        ) : (
          <button
            type="button"
            className="ws-tree-resource"
            title={item.name}
            onClick={() => open(item)}
          >
            <ResourceIcon resource={item} size={15} />
            <span>{item.name}</span>
          </button>
        )}
      </div>
      {expandable && expanded && (
        <ResourceBranches
          space={item.space_id}
          parentId={item.id}
          selected={selected}
          revision={revision}
          ancestors={[...ancestors, item.id]}
        />
      )}
    </li>
  );
}
function SavedViews() {
  const { revision } = useWorkspace(),
    data = useData<any[]>("saved-views", revision);
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
