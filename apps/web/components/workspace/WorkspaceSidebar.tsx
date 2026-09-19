"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ClipboardCheck,
  ChevronRight,
  Clock3,
  Folder,
  FolderOpen,
  ChevronsDownUp,
  Ellipsis,
  X,
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
import { workspaceDestination } from "../../lib/workspace-navigation";
import { useManagement } from "./ManagementActions";
import {
  ResourceIcon,
  useData,
  useLocation,
  useWorkspace,
  WorkspaceLink,
} from "./ui";
const ActiveAncestors = createContext<readonly string[]>([]);
const TreeExpansion = createContext<{
  expanded: Set<string>;
  toggle: (id: string, value: boolean) => void;
}>({ expanded: new Set(), toggle: () => {} });
function useBranchExpansion(id: string, reveal: boolean) {
  const { expanded, toggle } = useContext(TreeExpansion);
  useEffect(() => {
    if (reveal) toggle(id, true);
  }, [id, reveal, toggle]);
  return [expanded.has(id), (value: boolean) => toggle(id, value)] as const;
}

function folderLocation(spaceId: string, parentId?: string | null) {
  return `/workspaces/${spaceId}/files${parentId ? "?folder=" + parentId : ""}`;
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
  if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
    const rows = Array.from(
      row.closest(".ws-tree")?.querySelectorAll<HTMLElement>(".ws-tree-row") ??
        [],
    );
    const next =
      event.key === "Home"
        ? rows[0]
        : event.key === "End"
          ? rows.at(-1)
          : rows[rows.indexOf(row) + (event.key === "ArrowUp" ? -1 : 1)];
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
  const { spaces, revision, session } = useWorkspace(),
    { params, path } = useLocation();
  const [filter, setFilter] = useState("");
  const filterInput = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const stored: unknown = JSON.parse(
        localStorage.getItem(`axiom:sidebar-expanded:${session.user.id}`) ??
          "[]",
      );
      return new Set(
        Array.isArray(stored)
          ? stored
              .filter(
                (id): id is string =>
                  typeof id === "string" && /^[sr]:[\da-f-]{36}$/i.test(id),
              )
              .slice(-300)
          : [],
      );
    } catch {
      return new Set();
    }
  });
  const toggle = useCallback(
    (id: string, value: boolean) =>
      setExpanded((previous) => {
        if (previous.has(id) === value) return previous;
        const next = new Set(previous);
        if (value) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  useEffect(() => {
    try {
      localStorage.setItem(
        `axiom:sidebar-expanded:${session.user.id}`,
        JSON.stringify([...expanded].slice(-300)),
      );
    } catch {
      /* Presentation only; navigation remains usable without storage. */
    }
  }, [expanded, session.user.id]);
  const visibleSpaces = spaces.filter(
    (space) =>
      space.effective_status === "active" &&
      `${space.name} ${space.group_name ?? ""}`
        .toLocaleLowerCase()
        .includes(filter.trim().toLocaleLowerCase()),
  );
  const resourceId = fileRouteId(path) ?? params.get("folder");
  useEffect(() => {
    setFilter("");
  }, [path, params.get("folder"), params.get("space")]);
  const location = useData<ResourceLocation>(
    resourceId ? `resources/${resourceId}/location` : null,
    revision,
  );
  const selected =
      (path.startsWith("/workspaces/") ? path.split("/")[2] : null) ??
      params.get("space") ??
      location.data?.space.id ??
      null,
    parent = params.get("folder") ?? location.data?.resource.parent_id ?? null;
  const views = [
    ["recent", Clock3, "Recent"],
    ["favorites", Star, "Favorites"],
  ] as const;
  return (
    <TreeExpansion.Provider value={{ expanded, toggle }}>
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
          className="ws-tree-section ws-explorer-tree-section"
          onContextMenu={(event) => {
            if (!(event.target as Element).closest(".ws-tree-row"))
              management.backgroundMenu(event);
          }}
        >
          <div className="ws-tree-section-heading">
            <WorkspaceLink to="/workspaces" className="ws-section-label">
              Your workspaces
            </WorkspaceLink>
            <button
              type="button"
              className="icon-button"
              aria-label="Collapse all folders"
              title="Collapse all folders"
              disabled={!expanded.size}
              onClick={() => setExpanded(new Set())}
            >
              <ChevronsDownUp size={14} />
            </button>
          </div>
          <div className="sidebar-tree-filter">
            <Search size={14} />
            <input
              ref={filterInput}
              aria-label="Filter workspaces"
              placeholder="Filter workspaces…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && filter) {
                  event.preventDefault();
                  event.stopPropagation();
                  setFilter("");
                }
              }}
            />
            {filter && (
              <button
                type="button"
                className="icon-button"
                aria-label="Clear workspace filter"
                onClick={() => {
                  setFilter("");
                  filterInput.current?.focus();
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <ul className="ws-tree" aria-label="Spaces and folders">
            {[
              ...new Set(visibleSpaces.map((s) => s.group_id ?? "personal")),
            ].map((groupId) => (
              <li key={groupId} className="workspace-tree-group">
                <span className="workspace-tree-group-label">
                  {groupId === "personal"
                    ? "Your account"
                    : (spaces.find((s) => s.group_id === groupId)?.group_name ??
                      "Shared work")}
                </span>
                <ul>
                  {visibleSpaces
                    .filter(
                      (s) =>
                        (s.group_id ?? "personal") === groupId &&
                        s.effective_status === "active",
                    )
                    .map((space) => (
                      <SpaceBranch
                        key={space.id}
                        space={space}
                        selected={selected}
                        parent={parent}
                        revision={revision}
                      />
                    ))}
                </ul>
              </li>
            ))}
          </ul>
          {!visibleSpaces.length && (
            <p className="sidebar-tree-empty" role="status">
              {filter
                ? "No matching workspaces."
                : "Your workspaces will appear here."}
            </p>
          )}
        </div>
        <nav
          className="ws-tree-section ws-administration"
          aria-label="Administration"
        >
          <span className="ws-section-label">Administration</span>
          {(
            [
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
    </TreeExpansion.Provider>
  );
}
function SpaceBranch({
  space,
  selected,
  parent,
  revision,
}: {
  space: Space;
  selected: string | null;
  parent: string | null;
  revision: number;
}) {
  const management = useManagement();
  const { session } = useWorkspace();
  const { path } = useLocation();
  const activeBranch = selected === space.id;
  const [expanded, setExpanded] = useBranchExpansion(
    `s:${space.id}`,
    activeBranch,
  );
  const active = selected === space.id && !parent && !fileRouteId(path);
  const Icon =
    space.kind === "personal" ? LockKeyhole : expanded ? FolderOpen : Folder;
  return (
    <li>
      <div
        className={`ws-tree-row ws-tree-space ${active ? "active" : ""}`}
        aria-label={space.name}
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
          tabIndex={-1}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${space.name}`}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight size={13} />
        </button>
        <WorkspaceLink
          to={workspaceDestination(session.user.id, space.id)}
          title={space.name}
          tabIndex={-1}
          aria-current={active ? "page" : undefined}
          onClick={(event) => {
            if (isPlainClick(event)) setExpanded(true);
          }}
        >
          <Icon size={16} />
          <span>{space.name}</span>
        </WorkspaceLink>
        <button
          type="button"
          className="ws-tree-more icon-button"
          tabIndex={-1}
          aria-label={`Workspace actions for ${space.name}`}
          title="Workspace actions"
          onClick={(event) => management.workspaceMenu(event, space)}
        >
          <Ellipsis size={15} />
        </button>
      </div>
      {expanded && (
        <>
          <ResourceBranches
            space={space.id}
            parentId={null}
            selected={parent}
            revision={revision}
            ancestors={[]}
            showEmpty
          />
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
  const expandable = folder || (item.kind === "note" && !!item.has_children);
  const activeAncestors = useContext(ActiveAncestors);
  const active = folder
    ? selected === item.id
    : fileRouteId("/" + parts.join("/")) === item.id;
  const reveal = expandable && (active || activeAncestors.includes(item.id));
  const [expanded, setExpanded] = useBranchExpansion(`r:${item.id}`, reveal);
  if (ancestors.includes(item.id) || ancestors.length > 40) return null;
  return (
    <li>
      <div
        className={`ws-tree-row ${active ? "active" : ""}`}
        aria-label={item.name}
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
            tabIndex={-1}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${item.name}`}
            onClick={() => setExpanded(!expanded)}
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
            tabIndex={-1}
            aria-current={active ? "page" : undefined}
            onClick={(event) => {
              if (isPlainClick(event)) setExpanded(true);
            }}
          >
            {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
            <span>{item.name}</span>
          </WorkspaceLink>
        ) : (
          <button
            type="button"
            className="ws-tree-resource"
            title={item.name}
            tabIndex={-1}
            aria-current={active ? "page" : undefined}
            onClick={() => open(item)}
          >
            <ResourceIcon resource={item} size={15} />
            <span>{item.name}</span>
          </button>
        )}
        <button
          type="button"
          className="ws-tree-more icon-button"
          tabIndex={-1}
          aria-label={`Actions for ${item.name}`}
          title="File actions"
          onClick={(event) => management.resourceMenu(event, [item])}
        >
          <Ellipsis size={15} />
        </button>
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
