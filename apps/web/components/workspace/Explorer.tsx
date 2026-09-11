"use client";
import { beginExplorerMarquee } from "../../lib/explorer-marquee";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  ChevronRight,
  Clock3,
  Columns2,
  Download,
  FileText,
  Folder,
  FolderPlus,
  Grid2X2,
  Info,
  List,
  LockKeyhole,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  Upload,
  Copy,
  Pencil,
  FolderInput,
  X,
} from "lucide-react";
import type {
  Resource,
  ResourcePage,
  ResourceLocation,
  Space,
} from "@axiom/shared/workspace";
import { templates } from "@axiom/shared/templates";
import { post, timeAgo } from "../../lib/client";
import { selectFileRange } from "@axiom/shared/file-workflows";
import { publishTabTitle, useAppTabs } from "../../lib/application-tabs";
import { openContextMenu } from "../../lib/context-menu";
import FileQuickPreview from "./FileQuickPreview";
import Dialog from "../Dialog";
import TrashPage from "./TrashPage";
import { useManagement } from "./ManagementActions";
import {
  Badge,
  bytes,
  Empty,
  ErrorNotice,
  Loading,
  mutate,
  PageHeading,
  ResourceIcon,
  useAction,
  useData,
  useLocation,
  useWorkspace,
  WorkspaceLink,
} from "./ui";

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
export function ExplorerTree() {
  const management = useManagement();
  const { spaces, revision } = useWorkspace(),
    { params, path } = useLocation();
  const selected = params.get("space"),
    parent = params.get("folder");
  const views = [
    ["recent", Clock3, "Recent"],
    ["favorites", Star, "Favorites"],
    ["trash", Trash2, "Trash"],
  ] as const;
  return (
    <>
      <div className="ws-tree-section">
        <span className="ws-section-label">Quick access</span>
        {views.map(([view, Icon, label]) => (
          <WorkspaceLink
            className={`ws-side-link ${path === "/explorer" && params.get("view") === view ? "active" : ""}`}
            key={view}
            to={view === "trash" ? "/trash" : `/explorer?view=${view}`}
          >
            <Icon size={17} />
            {label}
          </WorkspaceLink>
        ))}
      </div>
      <div
        className="ws-tree-section"
        onContextMenu={(event) => {
          if (!(event.target as Element).closest(".ws-tree-row"))
            management.backgroundMenu(event);
        }}
      >
        <div className="ws-tree-section-heading">
          <span className="ws-section-label">Your spaces</span>
          <button
            className="icon-button"
            aria-label="Manage workspaces"
            onClick={management.manage}
          >
            <SlidersHorizontal size={14} />
          </button>
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
      <SavedViews />
    </>
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
  const active = folder
    ? selected === item.id
    : parts[0] === (item.kind === "note" ? "notes" : "files") &&
      parts[1] === item.id;
  const [expanded, setExpanded] = useState(folder && active);
  useEffect(() => {
    if (folder && active) setExpanded(true);
  }, [folder, active]);
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

export default function Explorer() {
  const { params } = useLocation();
  const tabs = useAppTabs();
  return params.get("view") === "trash" ? (
    <TrashPage />
  ) : (
    <ResourceExplorer key={tabs?.state.active} />
  );
}
function ResourceExplorer() {
  const management = useManagement();
  const tabs = useAppTabs(),
    tabId = tabs?.state.active;
  const { spaces, revision, navigate, open, upload, refresh } = useWorkspace(),
    { params } = useLocation();
  const view = params.get("view") ?? "folder",
    spaceId =
      params.get("space") ||
      (view === "folder" ? spaces.find((s) => s.kind === "personal")?.id : ""),
    parentId = params.get("folder");
  const space = spaces.find((s) => s.id === spaceId),
    [search, setSearch] = useState(params.get("q") ?? ""),
    [kind, setKind] = useState(params.get("kind") ?? ""),
    [sort, setSort] = useState(String(tabs?.active?.view?.sort ?? "name")),
    [direction, setDirection] = useState(
      String(tabs?.active?.view?.direction ?? "asc"),
    ),
    [layout, setLayout] = useState(
      String(tabs?.active?.view?.layout ?? "list"),
    ),
    [columns, setColumns] = useState<string[]>(
      (tabs?.active?.view?.columns as string[]) ?? ["updated", "size"],
    ),
    [filters, setFilters] = useState(false),
    [preview, setPreview] = useState<Resource | null>(null);
  const [cursor, setCursor] = useState<string | null>(null),
    [cursors, setCursors] = useState<(string | null)[]>([]),
    [selection, setSelection] = useState<string[]>(
      (tabs?.active?.view?.selection as string[]) ?? [],
    ),
    [inspector, setInspector] = useState<Resource | null>(null),
    [modal, setModal] = useState<"note" | "folder" | "save" | null>(null);
  const action = useAction(),
    fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    anchor = useRef<string | null>(null),
    endMarquee = useRef<(() => void) | null>(null),
    scrollRoot = useRef<HTMLElement>(null),
    query = new URLSearchParams({
      view,
      sort,
      direction,
      limit: "60",
      ...(spaceId ? { spaceId } : {}),
      ...(parentId ? { parentId } : {}),
      ...(params.get("q") ? { q: params.get("q")! } : {}),
      ...(kind ? { kind } : {}),
      ...(cursor ? { cursor } : {}),
      ...Object.fromEntries(
        ["mime", "tag", "after", "before", "minSize", "maxSize"].flatMap(
          (key) => (params.get(key) ? [[key, params.get(key)!]] : []),
        ),
      ),
    });
  const result = useData<ResourcePage>(
      spaceId || view !== "folder" ? `resources?${query}` : null,
      revision,
    ),
    rows = result.data?.items ?? [];
  useEffect(() => () => endMarquee.current?.(), []);
  useEffect(() => {
    if (inspector && selection.length === 1) {
      const next = rows.find((r) => r.id === selection[0]);
      if (next && next.id !== inspector.id) setInspector(next);
    }
  }, [selection.join(","), result.data]);
  const selected = rows.filter((item) => selection.includes(item.id)),
    canEdit = space?.role === "editor" && space.effective_status === "active",
    title =
      view === "recent"
        ? "Recent"
        : view === "favorites"
          ? "Favorites"
          : view === "trash"
            ? "Trash"
            : (result.data?.breadcrumbs.at(-1)?.name ??
              space?.name ??
              "Explorer");
  useEffect(() => {
    publishTabTitle(`/explorer?${params}`, title);
  }, [title, params.toString()]);
  const saved = useRef<{ id?: string; view?: Record<string, unknown> }>({});
  useEffect(() => {
    const value = tabs?.active?.view;
    if (value) {
      if (value.layout === "grid" || value.layout === "list")
        setLayout(value.layout);
      if (["name", "updated", "size"].includes(String(value.sort)))
        setSort(String(value.sort));
      if (value.direction === "asc" || value.direction === "desc")
        setDirection(value.direction);
      if (Array.isArray(value.selection))
        setSelection(value.selection as string[]);
      requestAnimationFrame(() => {
        if (scrollRoot.current)
          scrollRoot.current.scrollTop = Number(value.scroll) || 0;
      });
    }
    return () => {
      if (saved.current.id)
        tabs?.update(saved.current.id, { view: saved.current.view });
    };
  }, [tabId]);
  useEffect(() => {
    saved.current = {
      id: tabId,
      view: {
        layout,
        sort,
        direction,
        columns,
        selection,
        scroll: scrollRoot.current?.scrollTop ?? 0,
      },
    };
  }, [tabId, layout, sort, direction, selection, columns]);
  const choose = (item: Resource, extend = false, toggle = false) => {
    setSelection((previous) =>
      selectFileRange(
        rows.map((r) => r.id),
        previous,
        anchor.current,
        item.id,
        extend,
        toggle,
      ),
    );
    if (!extend) anchor.current = item.id;
  };
  const clearSelection = () => {
    setSelection([]);
    scrollRoot.current
      ?.querySelector<HTMLElement>(".ws-resource-container")
      ?.focus({ preventScroll: true });
  };
  const selectionLocation = useRef(
    `${spaceId}:${parentId}:${view}:${params.get("q")}:${kind}:${sort}:${direction}`,
  );
  useEffect(() => {
    const location = `${spaceId}:${parentId}:${view}:${params.get("q")}:${kind}:${sort}:${direction}`;
    if (selectionLocation.current === location) return;
    selectionLocation.current = location;
    setCursor(null);
    setCursors([]);
    setSelection([]);
    setInspector(null);
  }, [spaceId, parentId, view, params.get("q"), kind, sort, direction]);
  useEffect(() => {
    setSearch(params.get("q") ?? "");
    setKind(params.get("kind") ?? "");
  }, [params.get("q"), params.get("kind")]);
  const browse = (item: Resource, split = false) =>
    item.kind === "folder"
      ? navigate(folderLocation(item.space_id, item.id))
      : open(item, split);
  return (
    <div className="ws-explorer">
      <section
        className="ws-page ws-explorer-main"
        ref={scrollRoot}
        onContextMenu={(event) => {
          if (
            !(event.target as Element).closest(
              ".ws-resource-row,button,input,select,a,textarea",
            )
          )
            management.backgroundMenu(
              event,
              spaceId && view === "folder" ? { spaceId, parentId } : undefined,
            );
        }}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target as Element).closest(
              ".ws-resource-row,.ws-resource-head,header,button,input,select,a,textarea,label,nav",
            )
          )
            return;
          endMarquee.current?.();
          endMarquee.current = beginExplorerMarquee({
            owner: event.currentTarget,
            pointer: event.nativeEvent,
            initial: selection,
            additive: event.metaKey || event.ctrlKey || event.shiftKey,
            selection: setSelection,
            focus: event.currentTarget.querySelector<HTMLElement>(
              ".ws-resource-container",
            )!,
          });
        }}
        onScroll={() => {
          if (saved.current.view)
            saved.current.view.scroll = scrollRoot.current?.scrollTop ?? 0;
        }}
      >
        <PageHeading
          eyebrow="EXPLORER"
          title={title}
          actions={
            <>
              {space && (
                <WorkspaceLink
                  className="button secondary"
                  to={`/workspaces/${space.id}/storage`}
                >
                  <SlidersHorizontal size={16} />
                  Storage
                </WorkspaceLink>
              )}
              <button
                className="icon-button"
                aria-label="Audit and operation progress"
                title="Audit and operation progress"
                onClick={management.fileActivity}
              >
                <Clock3 size={17} />
              </button>
              {canEdit && view !== "trash" && (
                <>
                  <button
                    className="button secondary"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload size={16} />
                    Upload
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => folderInput.current?.click()}
                  >
                    <FolderPlus size={16} />
                    Upload folder
                  </button>
                  <details className="ws-menu">
                    <summary className="button primary">
                      <Plus size={16} />
                      New
                    </summary>
                    <div>
                      <button
                        onClick={(event) => {
                          event.currentTarget.closest("details")!.open = false;
                          setModal("note");
                        }}
                      >
                        <FileText size={16} />
                        Research note
                      </button>
                      <button
                        onClick={(event) => {
                          event.currentTarget.closest("details")!.open = false;
                          setModal("folder");
                        }}
                      >
                        <FolderPlus size={16} />
                        Folder
                      </button>
                    </div>
                  </details>
                </>
              )}
            </>
          }
        />
        <input
          ref={fileInput}
          hidden
          type="file"
          multiple
          onChange={(event) => {
            if (spaceId)
              upload(Array.from(event.target.files ?? []), spaceId, parentId);
            event.target.value = "";
          }}
        />
        <input
          ref={folderInput}
          hidden
          type="file"
          multiple
          {...{ webkitdirectory: "" }}
          onChange={(event) => {
            if (spaceId)
              upload(Array.from(event.target.files ?? []), spaceId, parentId);
            event.target.value = "";
          }}
        />
        {space && (
          <nav className="ws-breadcrumbs" aria-label="Folder breadcrumbs">
            <WorkspaceLink
              to={folderLocation(space.id)}
              onDragOver={(e) =>
                management.dragOver(e, { spaceId: space.id, parentId: null })
              }
              onDragLeave={management.dragLeave}
              onDrop={(e) =>
                management.drop(e, { spaceId: space.id, parentId: null })
              }
            >
              {space.name}
            </WorkspaceLink>
            {result.data?.breadcrumbs.map((item) => (
              <span key={item.id}>
                <ChevronRight size={12} />
                <WorkspaceLink
                  to={folderLocation(space.id, item.id)}
                  onDragOver={(e) =>
                    management.dragOver(e, {
                      spaceId: space.id,
                      parentId: item.id,
                    })
                  }
                  onDragLeave={management.dragLeave}
                  onDrop={(e) =>
                    management.drop(e, { spaceId: space.id, parentId: item.id })
                  }
                >
                  {item.name}
                </WorkspaceLink>
              </span>
            ))}
            <Badge>{space.kind === "personal" ? "Only you" : space.role}</Badge>
          </nav>
        )}
        {view === "trash" && (
          <p className="ws-note">
            Files and all their versions remain here until you explicitly remove
            them. Moving an item to trash does not break existing pinned file
            embeds.
          </p>
        )}
        <div
          className="explorer-toolbar-slot"
          data-has-selection={selected.length > 0}
        >
          <div
            className="ws-list-toolbar"
            aria-hidden={selected.length > 0}
            inert={selected.length > 0}
          >
            <form
              className="ws-search-field"
              onSubmit={(event) => {
                event.preventDefault();
                const next = new URLSearchParams(params);
                if (search) next.set("q", search);
                else next.delete("q");
                navigate(`/explorer?${next}`);
              }}
            >
              <Search size={17} />
              <input
                aria-label="Search files and notes"
                placeholder="Search name, content, or tags…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button className="text-button" type="submit">
                Search
              </button>
            </form>
            <label className="sr-only" htmlFor="explorer-kind">
              File type
            </label>
            <select
              id="explorer-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="">All types</option>
              <option value="note">Notes</option>
              <option value="folder">Folders</option>
              <option value="file">Files</option>
              <option value="shortcut">Shortcuts</option>
            </select>
            <button
              className="icon-button"
              aria-label="Advanced file filters"
              aria-expanded={filters}
              onClick={() => setFilters(!filters)}
            >
              <SlidersHorizontal size={17} />
            </button>
            <div className="ws-segmented" aria-label="Explorer layout">
              <button
                aria-label="List view"
                aria-pressed={layout === "list"}
                onClick={() => setLayout("list")}
              >
                <List size={17} />
              </button>
              <button
                aria-label="Grid view"
                aria-pressed={layout === "grid"}
                onClick={() => setLayout("grid")}
              >
                <Grid2X2 size={17} />
              </button>
            </div>
            {layout === "list" && (
              <button
                className="icon-button"
                aria-label="Choose file columns"
                title="Choose file columns"
                onClick={(event) => {
                  const owner = event.currentTarget,
                    box = owner.getBoundingClientRect();
                  openContextMenu({
                    owner,
                    x: box.right,
                    y: box.bottom,
                    label: "File columns",
                    items: [
                      ["updated", "Modified"],
                      ["size", "Size"],
                      ["kind", "Kind"],
                    ].map(([key, label]) => ({
                      icon:
                        key === "updated"
                          ? "calendar"
                          : key === "size"
                            ? "size"
                            : "kind",
                      label: `${columns.includes(key) ? "Hide" : "Show"} ${label.toLowerCase()} column`,
                      action: () =>
                        setColumns((values) =>
                          values.includes(key)
                            ? values.filter((v) => v !== key)
                            : [...values, key],
                        ),
                    })),
                  });
                }}
              >
                <Columns2 size={17} />
              </button>
            )}
            {params.get("q") && (
              <button
                className="icon-button"
                title="Save this search"
                aria-label="Save this search"
                onClick={() => setModal("save")}
              >
                <Star size={17} />
              </button>
            )}
          </div>
          {selected.length > 0 && (
            <div
              className="ws-selection-bar explorer-file-actions"
              role="region"
              aria-label="Selection actions"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  clearSelection();
                }
              }}
            >
              <strong>{selected.length} selected</strong>
              <button
                className="text-button"
                disabled={!selected.length}
                onClick={clearSelection}
              >
                Clear
              </button>
              <span className="ws-spacer" />
              <button
                className="button secondary"
                disabled={
                  !selected.length ||
                  selected.some((item) => item.role !== "editor")
                }
                onClick={() => management.execute("move", selected)}
              >
                Move
              </button>
              <button
                className="button secondary"
                disabled={!selected.length}
                onClick={() => management.execute("copyTo", selected)}
              >
                Copy
              </button>
              <button
                className="button secondary"
                disabled={
                  !selected.length ||
                  selected.some((item) => item.role !== "editor")
                }
                onClick={() => management.execute("rename", selected)}
              >
                Rename
              </button>
              {view !== "trash" && (
                <button
                  className="button secondary"
                  disabled={
                    action.busy ||
                    !selected.length ||
                    selected.some(
                      (item) => item.space_id !== selected[0].space_id,
                    )
                  }
                  onClick={() =>
                    void action.run(async () => {
                      await mutate("exports", {
                        spaceId: selected[0].space_id,
                        resourceIds: selected.map((item) => item.id),
                      });
                      navigate("/settings/exports");
                    })
                  }
                >
                  <Download size={15} />
                  Export selection
                </button>
              )}
              {
                <button
                  className="button secondary"
                  disabled={
                    action.busy ||
                    !selected.length ||
                    selected.some((item) => item.role !== "editor")
                  }
                  onClick={() =>
                    management.execute(
                      view === "trash" ? "restore" : "trash",
                      selected,
                      {
                        completed: (ids) =>
                          setSelection((previous) =>
                            previous.filter((id) => !ids.includes(id)),
                          ),
                      },
                    )
                  }
                >
                  <Trash2 size={15} />
                  {view === "trash" ? "Restore selected" : "Move to trash"}
                </button>
              }
            </div>
          )}
        </div>
        {filters && (
          <form
            className="explorer-advanced-filters"
            onSubmit={(event) => {
              event.preventDefault();
              const next = new URLSearchParams(params),
                values = new FormData(event.currentTarget);
              for (const key of [
                "mime",
                "tag",
                "after",
                "before",
                "minSize",
                "maxSize",
              ]) {
                const v = String(values.get(key) || "").trim();
                if (v) next.set(key, v);
                else next.delete(key);
              }
              navigate(`/explorer?${next}`);
            }}
          >
            <label>
              Content type
              <select name="mime" defaultValue={params.get("mime") || ""}>
                <option value="">All</option>
                <option value="image/">Images</option>
                <option value="application/pdf">PDF</option>
                <option value="text/">Text & code</option>
                <option value="audio/">Audio</option>
                <option value="video/">Video</option>
              </select>
            </label>
            <label>
              Tag
              <input
                name="tag"
                maxLength={40}
                defaultValue={params.get("tag") || ""}
              />
            </label>
            <label>
              Modified after
              <input
                type="date"
                name="after"
                defaultValue={params.get("after") || ""}
              />
            </label>
            <label>
              Modified before
              <input
                type="date"
                name="before"
                defaultValue={params.get("before") || ""}
              />
            </label>
            <label>
              Minimum bytes
              <input
                type="number"
                name="minSize"
                min={0}
                defaultValue={params.get("minSize") || ""}
              />
            </label>
            <label>
              Maximum bytes
              <input
                type="number"
                name="maxSize"
                min={0}
                defaultValue={params.get("maxSize") || ""}
              />
            </label>
            <button className="button secondary" type="submit">
              Apply filters
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                const next = new URLSearchParams(params);
                for (const k of [
                  "mime",
                  "tag",
                  "after",
                  "before",
                  "minSize",
                  "maxSize",
                ])
                  next.delete(k);
                navigate(`/explorer?${next}`);
              }}
            >
              Clear filters
            </button>
          </form>
        )}
        <ErrorNotice message={result.error} retry={result.reload} />
        <ErrorNotice message={action.error} />
        <div
          className="ws-resource-container"
          tabIndex={0}
          aria-label="Explorer items"
          onContextMenu={(event) => {
            if (!(event.target as Element).closest(".ws-resource-row"))
              management.backgroundMenu(
                event,
                spaceId && view === "folder"
                  ? { spaceId, parentId }
                  : undefined,
              );
          }}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === "a" &&
              !(event.target as Element).closest("input,textarea")
            ) {
              event.preventDefault();
              setSelection(rows.map((r) => r.id));
              return;
            }
            if (event.key === "Escape") {
              setSelection([]);
              return;
            }
            if (event.target === event.currentTarget)
              management.resourceKey(
                event,
                selected,
                {
                  properties: setInspector,
                  completed: (ids) =>
                    setSelection((previous) =>
                      previous.filter((id) => !ids.includes(id)),
                    ),
                },
                spaceId ? { spaceId, parentId } : undefined,
              );
          }}
          onDragOver={(event) => {
            if (spaceId && view === "folder")
              management.dragOver(event, { spaceId, parentId });
          }}
          onDragLeave={management.dragLeave}
          onDrop={(event) => {
            if (spaceId && view === "folder")
              management.drop(event, { spaceId, parentId });
          }}
        >
          {result.loading && !result.data ? (
            <Loading label="Loading files and notes…" />
          ) : !rows.length && !result.error ? (
            <Empty
              title={
                params.get("q")
                  ? "No matching work"
                  : view === "trash"
                    ? "Nothing in the trash"
                    : "A little room to think"
              }
            >
              {params.get("q")
                ? "Try a shorter search or another space."
                : canEdit
                  ? "Create a research note, organize a folder, or drop files here."
                  : "Shared notes, folders, and files will appear here."}
            </Empty>
          ) : (
            <div
              style={
                layout === "list"
                  ? ({
                      "--explorer-columns": `20px minmax(140px, 1fr) ${columns.includes("updated") ? "115px" : ""} ${columns.includes("size") ? "75px" : ""} ${columns.includes("kind") ? "80px" : ""} 35px`,
                    } as React.CSSProperties)
                  : undefined
              }
              className={
                layout === "grid" ? "ws-resource-grid" : "ws-resource-list"
              }
            >
              {layout === "list" && (
                <div className="ws-resource-head">
                  <input
                    type="checkbox"
                    aria-label="Select all items on this page"
                    checked={!!rows.length && selection.length === rows.length}
                    onChange={(event) =>
                      setSelection(
                        event.target.checked ? rows.map((item) => item.id) : [],
                      )
                    }
                  />
                  {[
                    ["name", "Name"],
                    ...(columns.includes("updated")
                      ? [["updated", "Modified"]]
                      : []),
                    ...(columns.includes("size") ? [["size", "Size"]] : []),
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => {
                        if (sort === value)
                          setDirection(direction === "asc" ? "desc" : "asc");
                        else {
                          setSort(value);
                          setDirection("asc");
                        }
                      }}
                    >
                      {label}
                      {sort === value &&
                        (direction === "asc" ? (
                          <ArrowUp size={12} />
                        ) : (
                          <ArrowDown size={12} />
                        ))}
                    </button>
                  ))}
                  {columns.includes("kind") && <span>Kind</span>}
                  <span />
                </div>
              )}
              {rows.map((item) => (
                <div
                  key={item.id}
                  className={`ws-resource-row ${selection.includes(item.id) ? "selected" : ""}`}
                  tabIndex={0}
                  data-resource-id={item.id}
                  data-folder-color={item.folder_color || undefined}
                  aria-selected={selection.includes(item.id)}
                  draggable={
                    !item.deleted_at &&
                    spaces.some((s) => s.id === item.space_id)
                  }
                  onDragStart={(event) => {
                    const targets = selection.includes(item.id)
                      ? selected
                      : [item];
                    if (!selection.includes(item.id)) setSelection([item.id]);
                    management.beginDrag(event, targets);
                  }}
                  onDragOver={(event) => {
                    if (item.kind === "folder")
                      management.dragOver(
                        event,
                        { spaceId: item.space_id, parentId: item.id },
                        () => navigate(folderLocation(item.space_id, item.id)),
                      );
                  }}
                  onDragLeave={management.dragLeave}
                  onDrop={(event) => {
                    if (item.kind === "folder")
                      management.drop(event, {
                        spaceId: item.space_id,
                        parentId: item.id,
                      });
                  }}
                  onClick={(event) => {
                    if (!(event.target as Element).closest("button,input"))
                      choose(
                        item,
                        event.shiftKey,
                        event.metaKey || event.ctrlKey,
                      );
                  }}
                  onDoubleClick={(event) => {
                    if (
                      !(event.target as Element).closest("input,.icon-button")
                    )
                      browse(item);
                  }}
                  onContextMenu={(event) => {
                    const targets = selection.includes(item.id)
                      ? selected
                      : [item];
                    if (!selection.includes(item.id)) setSelection([item.id]);
                    management.resourceMenu(event, targets, {
                      properties: setInspector,
                      completed: (ids) =>
                        setSelection((previous) =>
                          previous.filter((id) => !ids.includes(id)),
                        ),
                    });
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !(event.target as Element).matches("input")
                    ) {
                      event.preventDefault();
                      browse(item);
                      return;
                    }
                    if (
                      event.key === " " &&
                      !(event.target as Element).matches("input")
                    ) {
                      event.preventDefault();
                      setPreview(item);
                      return;
                    }
                    if (
                      ["ArrowDown", "ArrowUp"].includes(event.key) &&
                      !(event.target as Element).matches("input")
                    ) {
                      event.preventDefault();
                      const sibling =
                        event.key === "ArrowDown"
                          ? event.currentTarget.nextElementSibling
                          : event.currentTarget.previousElementSibling;
                      if (
                        sibling instanceof HTMLElement &&
                        sibling.dataset.resourceId
                      ) {
                        sibling.focus();
                        const next = rows.find(
                          (r) => r.id === sibling.dataset.resourceId,
                        );
                        if (next)
                          choose(
                            next,
                            event.shiftKey,
                            event.metaKey || event.ctrlKey,
                          );
                      }
                      return;
                    }
                    management.resourceKey(
                      event,
                      selection.includes(item.id) ? selected : [item],
                      {
                        properties: setInspector,
                        completed: (ids) =>
                          setSelection((previous) =>
                            previous.filter((id) => !ids.includes(id)),
                          ),
                      },
                      spaceId ? { spaceId, parentId } : undefined,
                    );
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.name}`}
                    checked={selection.includes(item.id)}
                    onChange={(event) =>
                      setSelection((previous) =>
                        event.target.checked
                          ? [...previous, item.id]
                          : previous.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <button
                    className="ws-resource-name"
                    draggable={
                      !item.deleted_at &&
                      spaces.some((s) => s.id === item.space_id)
                    }
                    onClick={(event) =>
                      choose(
                        item,
                        event.shiftKey,
                        event.metaKey || event.ctrlKey,
                      )
                    }
                    title="Double-click to open · Space to preview"
                  >
                    <span className={`ws-resource-glyph ${item.kind}`}>
                      <ResourceIcon
                        resource={item}
                        size={layout === "grid" ? 29 : 20}
                      />
                    </span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.kind === "note"
                          ? "Research note"
                          : item.kind === "folder"
                            ? "Folder"
                            : item.kind === "shortcut"
                              ? "Shortcut"
                              : (item.mime?.split("/").at(-1) ?? "File")}
                        {item.tags.length ? " · " + item.tags.join(", ") : ""}
                      </small>
                    </span>
                    {item.favorite && <Star size={13} className="ws-star" />}
                  </button>
                  {columns.includes("updated") && (
                    <span className="ws-resource-date">
                      {timeAgo(item.updated_at)}
                    </span>
                  )}
                  {columns.includes("size") && (
                    <span className="ws-resource-size">
                      {item.kind === "file" ? bytes(item.bytes) : "—"}
                    </span>
                  )}
                  {layout === "list" && columns.includes("kind") && (
                    <span className="ws-resource-kind">{item.kind}</span>
                  )}
                  <button
                    className="icon-button"
                    aria-label={`Details for ${item.name}`}
                    aria-pressed={inspector?.id === item.id}
                    onClick={() =>
                      setInspector(inspector?.id === item.id ? null : item)
                    }
                  >
                    <Info size={17} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <footer className="ws-list-footer">
          <span>
            {rows.length} items on this page{result.loading && " · Refreshing…"}
          </span>
          <div className="ws-actions">
            <button
              className="button secondary"
              disabled={!cursors.length || result.loading}
              onClick={() => {
                setCursor(cursors.at(-1) ?? null);
                setCursors((previous) => previous.slice(0, -1));
              }}
            >
              <ArrowLeft size={14} />
              Previous
            </button>
            <button
              className="button secondary"
              disabled={!result.data?.nextCursor || result.loading}
              onClick={() => {
                setCursors((previous) => [...previous, cursor]);
                setCursor(result.data!.nextCursor);
              }}
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
        </footer>
      </section>
      {preview && (
        <FileQuickPreview
          key={preview.id}
          resource={preview}
          onClose={() => setPreview(null)}
        />
      )}
      {inspector && selected.length > 1 ? (
        <SelectionInspector
          resources={selected}
          onClose={() => setInspector(null)}
        />
      ) : (
        inspector && (
          <ResourceInspector
            resource={inspector}
            onClose={() => setInspector(null)}
            onChanged={(resource) => {
              setInspector(resource);
              refresh();
            }}
          />
        )
      )}
      {(modal === "note" || modal === "folder") && space && (
        <CreateResource
          kind={modal}
          space={space}
          parentId={parentId}
          onClose={() => setModal(null)}
          onCreated={(item) => {
            setModal(null);
            refresh();
            if (item.kind === "note") open(item);
          }}
        />
      )}
      {modal === "save" && (
        <NameDialog
          title="Save this search"
          label="Search name"
          initial={search}
          onClose={() => setModal(null)}
          onSave={async (name) => {
            await post("saved-views", {
              name,
              filters: {
                q: search,
                ...(spaceId ? { spaceId } : {}),
                ...(kind ? { kind } : {}),
                view: "all",
              },
            });
            setModal(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

export function NameDialog({
  title,
  label,
  initial = "",
  onClose,
  onSave,
}: {
  title: string;
  label: string;
  initial?: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial),
    action = useAction();
  return (
    <Dialog
      title={title}
      onClose={() => !action.busy && onClose()}
      size="compact"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(() => onSave(name.trim()));
        }}
      >
        <label>
          {label}
          <input
            autoFocus
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <ErrorNotice message={action.error} />
        <div className="dialog-footer">
          <button
            className="button secondary"
            type="button"
            onClick={onClose}
            disabled={action.busy}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={action.busy || !name.trim()}
          >
            {action.busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function CreateResource({
  kind,
  space,
  parentId = null,
  onClose,
  onCreated,
}: {
  kind: "note" | "folder";
  space: Space;
  parentId?: string | null;
  onClose: () => void;
  onCreated: (item: Resource) => void;
}) {
  const [name, setName] = useState(""),
    [template, setTemplate] = useState("blank"),
    action = useAction();
  return (
    <Dialog
      title={
        kind === "folder" ? "A place for related work" : "Start a research note"
      }
      subtitle={`${space.name} · ${space.kind === "personal" ? "Visible only to you" : "Uses this space’s access permissions"}`}
      onClose={() => !action.busy && onClose()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () =>
            onCreated(
              await mutate("resources", {
                kind,
                name,
                spaceId: space.id,
                parentId,
                body:
                  kind === "note"
                    ? (templates.find((item) => item.id === template)?.body ??
                      "")
                    : "",
              }),
            ),
          );
        }}
      >
        <label>
          {kind === "folder" ? "Folder name" : "Note title"}
          <input
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            placeholder={
              kind === "folder"
                ? "e.g. Experiments"
                : "A question worth exploring"
            }
          />
        </label>
        {kind === "note" && (
          <label>
            Start with a template
            <select
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
            >
              {templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <ErrorNotice message={action.error} />
        <div className="dialog-footer">
          <button
            className="button secondary"
            type="button"
            onClick={onClose}
            disabled={action.busy}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={action.busy || !name.trim()}
          >
            {action.busy ? "Creating…" : "Create " + kind}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function useInspectorSizing() {
  const { session } = useWorkspace();
  const key = `axiom:${session.user.id}:inspector-width`;
  const [width, setWidth] = useState(340);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const resize = (value: number) =>
    setWidth(Math.max(280, Math.min(560, value)));
  useEffect(() => {
    const saved = Number(localStorage.getItem(key));
    if (saved >= 280 && saved <= 560) setWidth(saved);
  }, [key]);
  const persist = () => {
    localStorage.setItem(key, String(width));
    drag.current = null;
  };
  return {
    style: { "--inspector-width": `${width}px` } as CSSProperties,
    handle: (
      <div
        className="ws-inspector-resize"
        role="separator"
        aria-label="Resize details panel"
        aria-orientation="vertical"
        aria-valuemin={280}
        aria-valuemax={560}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          drag.current = { x: e.clientX, width };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            resize(drag.current.width + drag.current.x - e.clientX);
        }}
        onPointerUp={persist}
        onPointerCancel={persist}
        onLostPointerCapture={persist}
        onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            resize(
              e.key === "Home"
                ? 280
                : e.key === "End"
                  ? 560
                  : width + (e.key === "ArrowLeft" ? 10 : -10),
            );
          }
        }}
        onBlur={persist}
      />
    ),
  };
}
function SelectionInspector({
  resources,
  onClose,
}: {
  resources: Resource[];
  onClose: () => void;
}) {
  const sizing = useInspectorSizing(),
    management = useManagement();
  const counts = new Map<string, number>();
  resources.forEach((r) => {
    const type = r.document_type ?? r.kind;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  });
  return (
    <aside
      className="ws-inspector"
      aria-label="Selection details"
      style={sizing.style}
    >
      {sizing.handle}
      <header>
        <h2>{resources.length} selected</h2>
        <button
          className="icon-button"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="ws-inspector-selection-icons">
        {resources.slice(0, 5).map((r) => (
          <ResourceIcon key={r.id} resource={r} size={28} />
        ))}
      </div>
      <dl className="ws-facts">
        <div>
          <dt>Selection</dt>
          <dd>
            {[...counts].map(([kind, count]) => `${count} ${kind}`).join(" · ")}
          </dd>
        </div>
        <div>
          <dt>File size</dt>
          <dd>
            {bytes(resources.reduce((n, r) => n + Number(r.bytes ?? 0), 0))}
          </dd>
        </div>
      </dl>
      <div className="ws-inspector-command-list">
        <button onClick={() => management.execute("copyTo", resources)}>
          <Copy size={16} />
          Copy selection to…
        </button>
        {resources.every((r) => r.role === "editor") && (
          <>
            <button onClick={() => management.execute("move", resources)}>
              <FolderInput size={16} />
              Move selection to…
            </button>
            <button
              className="danger-text"
              onClick={() => management.execute("trash", resources)}
            >
              <Trash2 size={16} />
              Move selection to trash
            </button>
          </>
        )}
      </div>
      <ul className="ws-inspector-selection-list">
        {resources.map((r) => (
          <li key={r.id}>
            <ResourceIcon resource={r} />
            <span>{r.name}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function ResourceInspector({
  resource: initial,
  initialTab = "details",
  onClose,
  onChanged,
}: {
  resource: Resource;
  initialTab?: string;
  onClose: () => void;
  onChanged: (resource: Resource) => void;
}) {
  const management = useManagement();
  const { revision, spaces, open, upload, notify } = useWorkspace(),
    result = useData<Resource & { space: Space }>(
      `resources/${initial.id}`,
      revision,
    ),
    versions = useData<any[]>(
      initial.kind === "file" ? `files/${initial.id}/versions` : null,
      revision,
    ),
    activity = useData<any[]>(`resources/${initial.id}/activity`, revision),
    usage = useData<{
      references: number;
      annotations: number;
      reading: number;
      citations: number;
      sources: { id: string; name: string; snapshot: boolean }[];
    }>(initial.kind === "file" ? `files/${initial.id}/usage` : null, revision);
  const resource = result.data ?? initial,
    space = spaces.find((item) => item.id === resource.space_id),
    action = useAction(),
    [tab, setTab] = useState(initialTab),
    [modal, setModal] = useState<"metadata" | null>(null),
    [fileOperation, setFileOperation] = useState<{
      kind: "restore-version" | "purge-version";
      id: string;
      ordinal: number;
    } | null>(null),
    baseVersion = useRef(resource.version),
    versionUpload = useRef<HTMLInputElement>(null);
  const location = useData<ResourceLocation>(
    `resources/${initial.id}/location`,
    revision,
  );
  const sizing = useInspectorSizing();
  const openModal = (
    value:
      | "rename"
      | "move"
      | "trash"
      | "metadata"
      | "purge"
      | "copy"
      | "transfer"
      | null,
  ) => {
    if (
      value &&
      ["rename", "move", "trash", "purge", "copy", "transfer"].includes(value)
    ) {
      management.execute(
        value === "copy"
          ? "copyTo"
          : (value as "rename" | "move" | "trash" | "purge" | "transfer"),
        [resource],
      );
      return;
    }
    baseVersion.current = resource.version;
    setModal(value === "metadata" ? value : null);
  };
  const editable =
    (resource.role === "editor" || space?.role === "editor") &&
    (space?.effective_status ?? "active") === "active";
  useEffect(() => {
    setTab(initialTab);
    setModal(null);
    setFileOperation(null);
  }, [initial.id, initialTab]);
  return (
    <aside
      className="ws-inspector"
      aria-label="Item details"
      style={sizing.style}
    >
      {sizing.handle}
      <header>
        <h2>Details</h2>
        <button
          className="icon-button"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="ws-inspector-title">
        <span className="ws-resource-glyph">
          <ResourceIcon resource={resource} size={36} />
        </span>
        <h3>{resource.name}</h3>
        <p>
          {space?.name} · {resource.document_type ?? resource.kind}
        </p>
      </div>
      <div className="ws-inspector-actions">
        {!resource.deleted_at && resource.kind !== "folder" && (
          <button className="button primary" onClick={() => open(resource)}>
            <ArrowUpRight size={16} />
            Open
          </button>
        )}
        {resource.kind !== "folder" && !resource.deleted_at && (
          <button
            className="icon-button"
            title="Open beside"
            aria-label="Open beside"
            onClick={() => open(resource, true)}
          >
            <Columns2 size={17} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label={resource.favorite ? "Remove favorite" : "Add favorite"}
          aria-pressed={!!resource.favorite}
          onClick={() => management.execute("favorite", [resource])}
        >
          <Star size={17} />
        </button>
      </div>
      <div className="ws-segmented ws-inspector-tabs">
        {[
          "details",
          ...(resource.kind === "file" ? ["versions", "usage"] : []),
          "activity",
        ].map((value) => (
          <button
            key={value}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <ErrorNotice
        message={result.error || action.error}
        retry={result.error ? result.reload : undefined}
      />
      {tab === "details" && (
        <>
          {resource.kind === "file" &&
            resource.mime?.startsWith("image/") &&
            resource.current_version_id && (
              <div className="ws-inspector-preview">
                <img
                  alt={resource.name}
                  src={`/api/v1/attachments/${resource.current_version_id}`}
                />
              </div>
            )}
          {location.data && (
            <nav className="ws-inspector-path" aria-label="File location">
              <WorkspaceLink to={folderLocation(resource.space_id)}>
                {location.data.space.name}
              </WorkspaceLink>
              {location.data.ancestors.map((ancestor) => (
                <span key={ancestor.id}>
                  <ChevronRight size={12} />
                  <WorkspaceLink
                    to={folderLocation(resource.space_id, ancestor.id)}
                  >
                    {ancestor.name}
                  </WorkspaceLink>
                </span>
              ))}
            </nav>
          )}
          <dl className="ws-facts">
            <div>
              <dt>Type</dt>
              <dd>
                {resource.document_type ?? resource.mime ?? resource.kind}
              </dd>
            </div>
            <div>
              <dt>Visibility</dt>
              <dd>
                {space?.kind === "personal" ? "Only you" : "Space members"}
              </dd>
            </div>
            <div>
              <dt>Your access</dt>
              <dd>{resource.role ?? space?.role}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd title={new Date(resource.created_at).toLocaleString()}>
                {timeAgo(resource.created_at)}
              </dd>
            </div>
            <div>
              <dt>Modified</dt>
              <dd>{timeAgo(resource.updated_at)}</dd>
            </div>
            {resource.kind === "file" && (
              <div>
                <dt>Current version</dt>
                <dd>{bytes(resource.bytes)}</dd>
              </div>
            )}
            <div>
              <dt>Tags</dt>
              <dd>{resource.tags.join(", ") || "No tags"}</dd>
            </div>
          </dl>
          <p className="muted">
            {resource.description || "No description yet."}
          </p>
          {!resource.deleted_at && (
            <button
              className="button secondary"
              onClick={() => openModal("copy")}
            >
              Copy to a space…
            </button>
          )}
          {editable && !resource.deleted_at && (
            <div className="ws-inspector-command-list">
              <button onClick={() => openModal("rename")}>
                <Pencil size={15} />
                Rename
              </button>
              <button onClick={() => openModal("metadata")}>
                <Info size={15} />
                Edit description and tags
              </button>
              <button onClick={() => openModal("move")}>
                <FolderInput size={15} />
                Move to a folder
              </button>
              {space?.can_manage && (
                <button onClick={() => openModal("transfer")}>
                  <FolderInput size={15} />
                  Move to another space…
                </button>
              )}
              {resource.kind === "file" && (
                <>
                  <button onClick={() => versionUpload.current?.click()}>
                    <Upload size={15} />
                    Upload a new version
                  </button>
                  <input
                    ref={versionUpload}
                    type="file"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        upload(
                          [file],
                          resource.space_id,
                          resource.parent_id,
                          resource.id,
                        );
                      event.target.value = "";
                    }}
                  />
                </>
              )}
              <button
                className="danger-text"
                onClick={() => openModal("trash")}
              >
                <Trash2 size={15} />
                Move to trash
              </button>
            </div>
          )}
          {resource.deleted_at && editable && (
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={() => management.execute("restore", [resource])}
            >
              Restore item
            </button>
          )}
          {resource.deleted_at && space?.can_manage && (
            <button
              className="button danger"
              onClick={() => openModal("purge")}
            >
              Delete permanently…
            </button>
          )}
        </>
      )}
      {tab === "versions" && (
        <>
          <p className="ws-small muted">
            Versions are immutable. A copied embed always points to the selected
            version.
          </p>
          <ErrorNotice message={versions.error} retry={versions.reload} />
          {versions.data?.map((version) => (
            <div className="ws-version" key={version.id}>
              <strong>
                Version {version.ordinal}
                {version.id === resource.current_version_id && (
                  <Badge>Current</Badge>
                )}
              </strong>
              <small>
                {bytes(version.bytes)} · {timeAgo(version.created_at)}
              </small>
              <small>{version.created_by}</small>
              <div className="ws-actions">
                <a
                  className="button secondary"
                  href={`/api/v1/files/${resource.id}/download?version=${version.id}`}
                >
                  <Download size={14} />
                  Download
                </a>
                <button
                  className="button secondary"
                  onClick={() =>
                    void action.run(async () => {
                      await navigator.clipboard.writeText(
                        `${version.mime.startsWith("image/") ? "!" : ""}[${resource.name.replace(/[\[\]\\]/g, "\\$&")}](/api/v1/attachments/${version.id})`,
                      );
                      notify("Pinned Markdown link copied.");
                    })
                  }
                >
                  Copy embed
                </button>
                {editable &&
                  !resource.deleted_at &&
                  version.id !== resource.current_version_id && (
                    <button
                      className="button secondary"
                      onClick={() => {
                        baseVersion.current = resource.version;
                        setFileOperation({
                          kind: "restore-version",
                          id: version.id,
                          ordinal: version.ordinal,
                        });
                      }}
                    >
                      Restore as new version
                    </button>
                  )}
                {space?.can_manage &&
                  version.id !== resource.current_version_id && (
                    <button
                      className="button secondary danger-text"
                      onClick={() => {
                        baseVersion.current = resource.version;
                        setFileOperation({
                          kind: "purge-version",
                          id: version.id,
                          ordinal: version.ordinal,
                        });
                      }}
                    >
                      Remove unused version…
                    </button>
                  )}
              </div>
            </div>
          ))}
        </>
      )}
      {tab === "usage" && (
        <>
          <p className="ws-small muted">
            Pinned links keep their original version. Cleanup protects saved
            revisions and research records, including private records whose
            titles you cannot view.
          </p>
          <ErrorNotice message={usage.error} retry={usage.reload} />
          {usage.data && (
            <>
              <dl className="ws-facts">
                {[
                  ["Note and revision links", usage.data.references],
                  ["Annotations", usage.data.annotations],
                  ["Reading records", usage.data.reading],
                  ["Citation links", usage.data.citations],
                ].map(([label, count]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              </dl>
              {usage.data.sources.map((source) => (
                <button
                  className="ws-side-link"
                  key={source.id + source.snapshot}
                  onClick={() => open({ id: source.id, kind: "note" })}
                >
                  <FileText size={15} />
                  <span>
                    {source.name}
                    {source.snapshot ? " · saved revision" : ""}
                  </span>
                </button>
              ))}
            </>
          )}
        </>
      )}
      {tab === "activity" && (
        <>
          <ErrorNotice message={activity.error} retry={activity.reload} />
          {!activity.data?.length && (
            <p className="muted">No recorded changes yet.</p>
          )}
          {activity.data?.map((event) => (
            <div className="ws-activity" key={event.id}>
              <p>{event.title}</p>
              <small>
                {event.actor_name ?? "Former member"} ·{" "}
                {timeAgo(event.created_at)}
              </small>
            </div>
          ))}
        </>
      )}
      {modal === "metadata" && (
        <MetadataDialog
          resource={resource}
          onClose={() => setModal(null)}
          onSaved={(item) => {
            onChanged(item);
            setModal(null);
          }}
        />
      )}
      {fileOperation && (
        <FileSafetyDialog
          resource={{ ...resource, version: baseVersion.current }}
          operation={fileOperation}
          onClose={() => {
            setModal(null);
            setFileOperation(null);
          }}
          onDone={() => {
            setModal(null);
            setFileOperation(null);
            onChanged(resource);
            result.reload();
            versions.reload();
            usage.reload();
          }}
        />
      )}
    </aside>
  );
}
function MetadataDialog({
  resource,
  onClose,
  onSaved,
}: {
  resource: Resource;
  onClose: () => void;
  onSaved: (item: Resource) => void;
}) {
  const [base] = useState(resource.version),
    [description, setDescription] = useState(resource.description),
    [tags, setTags] = useState(resource.tags.join(", ")),
    action = useAction();
  return (
    <Dialog
      title="Describe this item"
      onClose={() => !action.busy && onClose()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () =>
            onSaved(
              await mutate(
                `resources/${resource.id}`,
                {
                  version: base,
                  description,
                  tags: tags
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                },
                "PATCH",
              ),
            ),
          );
        }}
      >
        <label>
          Description
          <textarea
            rows={5}
            maxLength={3000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          Tags
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="e.g. quantum, experiment, draft"
          />
        </label>
        <p className="ws-small muted">
          Separate tags with commas. Descriptions and tags are searchable in
          Explorer.
        </p>
        <ErrorNotice message={action.error} />
        <div className="dialog-footer">
          <button
            type="button"
            className="button secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button primary" disabled={action.busy}>
            Save details
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function FileSafetyDialog({
  resource,
  operation,
  onClose,
  onDone,
}: {
  resource: Resource;
  operation: {
    kind: "restore-version" | "purge-version";
    id: string;
    ordinal: number;
  } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [base] = useState(resource.version),
    [confirmation, setConfirmation] = useState(""),
    action = useAction();
  const restore = operation?.kind === "restore-version",
    phrase = operation ? "DELETE VERSION" : "DELETE FOREVER";
  return (
    <Dialog
      title={
        restore
          ? `Restore version ${operation.ordinal}?`
          : "Permanently remove stored data?"
      }
      onClose={() => !action.busy && onClose()}
    >
      <p>
        {restore
          ? "This creates a new current version from the selected file. Existing versions and pinned links will remain unchanged."
          : "This cannot be undone from the app. The server will refuse removal if a file is still used by a note, saved revision, annotation, citation or reading record. Folder cleanup includes all nested items."}
      </p>
      <p>
        <strong>{resource.name}</strong>
        {operation ? ` · version ${operation.ordinal}` : ""}
      </p>
      {!restore && (
        <label>
          Type {phrase} to confirm
          <input
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      )}
      <ErrorNotice message={action.error} />
      <div className="dialog-footer">
        <button
          className="button secondary"
          onClick={onClose}
          disabled={action.busy}
        >
          Cancel
        </button>
        <button
          className={`button ${restore ? "primary" : "danger"}`}
          disabled={action.busy || (!restore && confirmation !== phrase)}
          onClick={() =>
            void action.run(async () => {
              await mutate(
                operation
                  ? `files/${resource.id}/${operation.kind}`
                  : `resources/${resource.id}/purge`,
                {
                  version: base,
                  confirmation,
                  ...(operation ? { versionId: operation.id } : {}),
                },
              );
              onDone();
            })
          }
        >
          {action.busy
            ? "Checking…"
            : restore
              ? "Restore version"
              : "Delete permanently"}
        </button>
      </div>
    </Dialog>
  );
}
export function MoveResource({
  resource,
  onClose,
  onMoved,
}: {
  resource: Resource;
  onClose: () => void;
  onMoved: (item: Resource) => void;
}) {
  const [base] = useState(resource.version),
    [folder, setFolder] = useState<string | null>(null),
    data = useData<ResourcePage>(
      `resources?spaceId=${resource.space_id}&kind=folder&limit=100${folder ? "&parentId=" + folder : ""}`,
    ),
    action = useAction();
  return (
    <Dialog
      title="Move to a folder"
      subtitle="The audience stays the same. Moving does not change file or note links."
      onClose={() => !action.busy && onClose()}
    >
      <nav className="ws-breadcrumbs" aria-label="Destination">
        <button className="text-button" onClick={() => setFolder(null)}>
          Space root
        </button>
        {data.data?.breadcrumbs.map((item) => (
          <button
            key={item.id}
            className="text-button"
            onClick={() => setFolder(item.id)}
          >
            <ChevronRight size={12} />
            {item.name}
          </button>
        ))}
      </nav>
      <ErrorNotice
        message={data.error || action.error}
        retry={data.error ? data.reload : undefined}
      />
      <div className="ws-folder-picker">
        {data.data?.items
          .filter((item) => item.id !== resource.id)
          .map((item) => (
            <button key={item.id} onClick={() => setFolder(item.id)}>
              <Folder size={17} />
              {item.name}
              <ChevronRight size={15} />
            </button>
          ))}
        {!data.data?.items.length && (
          <p className="muted">No subfolders here.</p>
        )}
      </div>
      <div className="dialog-footer">
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="button primary"
          disabled={action.busy || folder === resource.parent_id}
          onClick={() =>
            void action.run(async () =>
              onMoved(
                await mutate(
                  `resources/${resource.id}`,
                  { version: base, parentId: folder },
                  "PATCH",
                ),
              ),
            )
          }
        >
          Move here
        </button>
      </div>
    </Dialog>
  );
}
export function TransferResource({
  resource,
  moving,
  onClose,
  onDone,
}: {
  resource: Resource;
  moving: boolean;
  onClose: () => void;
  onDone: (item: Resource) => void;
}) {
  const { spaces } = useWorkspace(),
    [base] = useState(resource.version),
    [spaceId, setSpaceId] = useState(moving ? "" : resource.space_id),
    [parentId, setParentId] = useState<string | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState("");
  const action = useAction(),
    destination = spaces.find((space) => space.id === spaceId),
    crossing = resource.space_id !== spaceId;
  const folders = useData<ResourcePage>(
    spaceId
      ? `resources?spaceId=${spaceId}&kind=folder&limit=50${parentId ? "&parentId=" + parentId : ""}${search ? "&view=all&q=" + encodeURIComponent(search) : ""}${cursor ? "&cursor=" + cursor : ""}`
      : null,
  );
  return (
    <Dialog
      title={moving ? "Move to another space" : "Copy to a space"}
      onClose={() => !action.busy && onClose()}
    >
      <p className="ws-small muted">
        {moving
          ? "Moves keep note/file identities, comments, and edit history. Notes linked to formal reviews or project tasks must be copied instead."
          : "Copies include current notes, folders, current files, and exact linked file versions. Comments, edit history, private reading records and annotations stay with the original."}
      </p>
      <label>
        Destination space
        <select
          value={spaceId}
          required
          onChange={(event) => {
            setSpaceId(event.target.value);
            setParentId(null);
            setConfirmed(false);
            setSearch("");
            setCursor("");
          }}
        >
          <option value="" disabled>
            Choose a space
          </option>
          {spaces
            .filter(
              (space) =>
                space.role === "editor" &&
                (!moving || space.id !== resource.space_id),
            )
            .map((space) => (
              <option value={space.id} key={space.id}>
                {space.name} ·{" "}
                {space.kind === "personal"
                  ? "Only you"
                  : space.kind === "project"
                    ? "Project members"
                    : "Group members"}
              </option>
            ))}
        </select>
      </label>
      {destination && (
        <>
          <nav className="ws-breadcrumbs" aria-label="Transfer destination">
            <button
              className="text-button"
              onClick={() => {
                setParentId(null);
                setCursor("");
                setSearch("");
              }}
            >
              {destination.name}
            </button>
            {folders.data?.breadcrumbs.map((folder) => (
              <button
                className="text-button"
                key={folder.id}
                onClick={() => {
                  setParentId(folder.id);
                  setCursor("");
                  setSearch("");
                }}
              >
                <ChevronRight size={12} />
                {folder.name}
              </button>
            ))}
          </nav>
          <input
            aria-label="Find destination folder"
            placeholder="Find a folder in this space…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setCursor("");
            }}
          />
          <div className="ws-folder-picker">
            {folders.data?.items
              .filter((item) => item.id !== resource.id)
              .map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => {
                    setParentId(folder.id);
                    setSearch("");
                    setCursor("");
                  }}
                >
                  <Folder size={17} />
                  {folder.name}
                  <ChevronRight size={14} />
                </button>
              ))}
            {folders.loading && <Loading />}
            {!folders.loading && !folders.data?.items.length && (
              <p className="muted">No subfolders here.</p>
            )}
          </div>
          <div className="ws-actions">
            {cursor && (
              <button className="text-button" onClick={() => setCursor("")}>
                First folders
              </button>
            )}
            {folders.data?.nextCursor && (
              <button
                className="text-button"
                onClick={() => setCursor(folders.data!.nextCursor!)}
              >
                More folders
              </button>
            )}
          </div>
        </>
      )}
      {crossing && destination && (
        <label className="ws-checkbox ws-note">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            {destination.kind === "personal"
              ? "I understand this destination is private to me."
              : `I understand the selected contents and linked evidence will be accessible to ${destination.kind === "project" ? "members of this project" : "members of this group"}.`}
            {moving
              ? " Existing links will follow the new permissions."
              : " The original permissions will not change."}
          </span>
        </label>
      )}
      <ErrorNotice
        message={action.error || folders.error}
        retry={folders.error ? folders.reload : undefined}
      />
      <div className="dialog-footer">
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="button primary"
          disabled={action.busy || !destination || (crossing && !confirmed)}
          onClick={() =>
            void action.run(async () =>
              onDone(
                await mutate(
                  `resources/${resource.id}/${moving ? "transfer" : "copy"}`,
                  {
                    version: base,
                    destinationSpaceId: spaceId,
                    parentId,
                    confirmAudience: confirmed,
                  },
                ),
              ),
            )
          }
        >
          {action.busy ? "Preparing…" : moving ? "Move here" : "Copy here"}
        </button>
      </div>
    </Dialog>
  );
}
