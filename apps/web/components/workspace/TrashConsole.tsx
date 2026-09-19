"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  Blocks,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  History,
  MoreHorizontal,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import type { Resource, Space } from "@axiom/shared/workspace";
import { selectFileRange } from "@axiom/shared/file-workflows";
import { post } from "../../lib/client";
import { openContextMenu } from "../../lib/context-menu";
import { FolderDestination } from "./FileOperations";
import { TrashOperationDialog } from "./TrashPage";
import {
  Badge,
  bytes,
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

type TrashRow = Resource & {
  original_path: string;
  deleted_path: string | null;
  deleted_by_name: string | null;
  has_children: boolean;
  can_restore: boolean;
  can_purge: boolean;
};
type TrashRows = {
  items: TrashRow[];
  total: number;
  nextOffset: number | null;
};
type WorkspaceRow = Space & {
  parent_id: string | null;
  resources: number;
  bytes: number;
};

export default function TrashConsole() {
  const { params } = useLocation(),
    workspaces = params.get("view") === "workspaces";
  return (
    <main className="ws-page console-page">
      <PageHeading eyebrow="RECOVERY & CLEANUP" title="Trash">
        Recover work you still need. Review the exact scope before removing
        anything permanently.
      </PageHeading>
      <nav className="productivity-tabs" aria-label="Trash views">
        <WorkspaceLink
          className={!workspaces ? "active" : ""}
          to={`/trash${params.get("space") ? `?space=${params.get("space")}` : ""}`}
        >
          <FolderOpen size={16} />
          Files & folders
        </WorkspaceLink>
        <WorkspaceLink
          className={workspaces ? "active" : ""}
          to="/trash?view=workspaces"
        >
          <Blocks size={16} />
          Workspaces
        </WorkspaceLink>
        <span className="ws-spacer" />
        <WorkspaceLink to="/audit?view=operations">
          <History size={16} />
          Operation progress
        </WorkspaceLink>
      </nav>
      {workspaces ? <WorkspaceTrash /> : <FileTrash />}
    </main>
  );
}

function FileTrash() {
  const { spaces, revision, refresh, navigate, notify } = useWorkspace(),
    { params } = useLocation();
  const scope =
    params.get("space") ||
    spaces.find((s) => s.kind === "personal")?.id ||
    spaces[0]?.id ||
    "";
  const scopes =
    scope === "managed"
      ? spaces.filter(
          (s) => s.can_manage && s.role && s.effective_status === "active",
        )
      : spaces.filter((s) => s.id === scope);
  const scopeIds = scopes.map((s) => s.id),
    canRestore = scopes.some(
      (s) => s.role === "editor" && s.effective_status === "active",
    ),
    canPurge = scopes.some(
      (s) => s.can_manage && s.effective_status === "active",
    );
  const [search, setSearch] = useState(""),
    [kind, setKind] = useState(""),
    [after, setAfter] = useState(""),
    [before, setBefore] = useState(""),
    [sort, setSort] = useState("deleted"),
    [direction, setDirection] = useState("desc"),
    [offset, setOffset] = useState(0),
    [selection, setSelection] = useState<string[]>([]),
    [allMatching, setAllMatching] = useState(false),
    [operation, setOperation] = useState<string | null>(null),
    [restorePolicy, setRestorePolicy] = useState<"retain" | "root">("retain"),
    [conflict, setConflict] = useState<"keep-both" | "skip">("keep-both"),
    [destination, setDestination] = useState<string | null>(null),
    [chooseDestination, setChooseDestination] = useState(false),
    [options, setOptions] = useState(false);
  const anchor = useRef<string | null>(null),
    action = useAction();
  const filters = new URLSearchParams({
    spaces: scopeIds.join(","),
    q: search,
    kind,
    sort,
    direction,
    tree: "1",
    ...(after ? { after } : {}),
    ...(before ? { before } : {}),
  });
  const data = useData<TrashRows>(
      scopeIds.length ? `trash/items?${filters}&offset=${offset}` : null,
      revision,
    ),
    rows = data.data?.items ?? [];
  const resetKey = JSON.stringify([
    scope,
    search,
    kind,
    after,
    before,
    sort,
    direction,
  ]);
  useEffect(() => {
    setSelection([]);
    setAllMatching(false);
    setOffset(0);
    anchor.current = null;
  }, [resetKey]);
  useEffect(() => {
    setDestination(null);
    setChooseDestination(false);
  }, [scope]);
  useEffect(() => {
    if (!data.loading && data.data && offset >= data.data.total && offset > 0)
      setOffset(Math.floor(Math.max(0, data.data.total - 1) / 50) * 50);
  }, [data.data, data.loading, offset]);
  const preview = (
    command: "restore" | "purge",
    all = allMatching,
    ids = selection,
  ) =>
    void action.run(async () => {
      const result = await post("trash/preview", {
        mutationId: crypto.randomUUID(),
        target: "files",
        action: command,
        spaceIds: scopeIds,
        allMatching: all,
        ids: all ? [] : ids,
        q: search,
        kind,
        ...(after ? { after } : {}),
        ...(before ? { before } : {}),
        restorePolicy,
        destinationId: chooseDestination ? destination : null,
        conflictPolicy: conflict,
      });
      setOperation(result.operation.id);
    });
  const select = (item: TrashRow, shift = false, toggle = false) => {
    setAllMatching(false);
    setSelection((previous) =>
      selectFileRange(
        Array.from(
          document.querySelectorAll<HTMLElement>(
            ".console-trash-table tr[data-trash-id]",
          ),
        ).map((row) => row.dataset.trashId!),
        previous,
        anchor.current,
        item.id,
        shift,
        toggle,
      ),
    );
    if (!shift) anchor.current = item.id;
  };
  const menu = (
    event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
    item: TrashRow,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const ids = selection.includes(item.id) ? selection : [item.id];
    setSelection(ids);
    setAllMatching(false);
    const box = event.currentTarget.getBoundingClientRect();
    openContextMenu({
      owner: event.currentTarget,
      x: "clientX" in event ? event.clientX : box.left + 20,
      y: "clientY" in event ? event.clientY : box.bottom,
      label: "Trash actions",
      items: [
        {
          label: `Restore ${ids.length} selected`,
          icon: "restore",
          group: "Recovery",
          disabled: !canRestore || action.busy,
          action: () => preview("restore", false, ids),
        },
        {
          label: "Restore options…",
          icon: "settings",
          group: "Recovery",
          action: () => setOptions(true),
        },
        {
          label: `Delete ${ids.length} permanently…`,
          icon: "purge",
          group: "Permanent removal",
          tone: "danger",
          disabled: !canPurge || action.busy,
          action: () => preview("purge", false, ids),
        },
      ],
    });
  };
  const selectedCount = allMatching
    ? (data.data?.total ?? 0)
    : selection.length;
  return (
    <>
      <div className="console-toolbar">
        <label className="console-search">
          Search Trash
          <input
            aria-label="Search Trash"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Note, folder or filename…"
          />
        </label>
        <label>
          Workspace
          <select
            aria-label="Trash workspace"
            value={scope}
            onChange={(e) => navigate(`/trash?space=${e.target.value}`)}
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.effective_status !== "active"
                  ? ` · ${s.effective_status}`
                  : ""}
              </option>
            ))}
            <option value="managed">All managed workspaces</option>
          </select>
        </label>
        <label>
          Kind
          <select
            aria-label="Trash item kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">All items</option>
            {["note", "folder", "file", "shortcut"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select
            value={`${sort}:${direction}`}
            onChange={(e) => {
              const [s, d] = e.target.value.split(":");
              setSort(s);
              setDirection(d);
            }}
          >
            <option value="deleted:desc">Newest deleted</option>
            <option value="deleted:asc">Oldest deleted</option>
            <option value="name:asc">Name A–Z</option>
            <option value="size:desc">Largest first</option>
          </select>
        </label>
        <button
          className="button secondary"
          aria-expanded={options}
          onClick={() => setOptions((v) => !v)}
        >
          <SlidersHorizontal size={16} />
          Options
        </button>
      </div>
      {options && (
        <section
          className="console-options"
          aria-label="Trash filters and restore options"
        >
          <div className="console-toolbar">
            <label>
              Deleted from
              <input
                type="date"
                value={after}
                onChange={(e) => setAfter(e.target.value)}
              />
            </label>
            <label>
              Through
              <input
                type="date"
                value={before}
                onChange={(e) => setBefore(e.target.value)}
              />
            </label>
            <label>
              If the original folder is unavailable
              <select
                value={restorePolicy}
                onChange={(e) =>
                  setRestorePolicy(e.target.value as "retain" | "root")
                }
              >
                <option value="retain">
                  Keep in Trash; restore parent first
                </option>
                <option value="root">Restore to workspace root</option>
              </select>
            </label>
            <label>
              Name conflicts
              <select
                value={conflict}
                onChange={(e) =>
                  setConflict(e.target.value as "keep-both" | "skip")
                }
              >
                <option value="keep-both">Keep both (add a suffix)</option>
                <option value="skip">Skip existing names</option>
              </select>
            </label>
          </div>
          <label className="ws-checkbox">
            <input
              type="checkbox"
              checked={chooseDestination}
              disabled={scopeIds.length !== 1 || !canRestore}
              onChange={(e) => setChooseDestination(e.target.checked)}
            />
            Restore top-level selections to another folder in this workspace
          </label>
          {chooseDestination && scopeIds.length === 1 && (
            <>
              <FolderDestination
                sameSpace={scopeIds[0]}
                value={{ spaceId: scopeIds[0], parentId: destination }}
                onChange={(value) => setDestination(value.parentId)}
                exclude={selection}
              />
              <p className="ws-note">
                Choose a folder. With no folder selected, the original location
                policy applies.
              </p>
            </>
          )}
          <p className="ws-note">
            Folders include their trashed descendants exactly once. Restore does
            not overwrite active items. File cleanup never removes a workspace.
          </p>
        </section>
      )}
      <div className="console-toolbar console-scope-actions">
        <span className="ws-note">
          {data.data?.total ?? 0} matching entries ·{" "}
          {scope === "managed"
            ? `${scopeIds.length} managed workspaces`
            : (scopes[0]?.name ?? "Choose a workspace")}
        </span>
        <span className="ws-spacer" />
        <button
          className="text-button"
          disabled={!data.data?.total || !canRestore || action.busy}
          onClick={() => preview("restore", true)}
        >
          <RotateCcw size={15} />
          Restore all matching
        </button>
        <button
          className="text-button danger-text"
          disabled={!data.data?.total || !canPurge || action.busy}
          onClick={() => preview("purge", true)}
        >
          <Trash2 size={15} />
          {search || kind || after || before
            ? "Delete all matching…"
            : "Empty Trash in this scope…"}
        </button>
      </div>
      {!canRestore && (
        <p className="ws-note">
          Restore the workspace first, or ask an editor for help. Permanent file
          deletion requires manager access in an active workspace.
        </p>
      )}
      <ErrorNotice message={data.error || action.error} retry={data.reload} />
      {!!selectedCount && (
        <div
          className="ws-selection-bar"
          role="region"
          aria-label="Trash selection actions"
        >
          <strong>
            {allMatching
              ? "All matching entries"
              : `${selectedCount} selected across pages`}
          </strong>
          {!allMatching && (
            <button
              className="text-button"
              onClick={() => setAllMatching(true)}
            >
              Select all {data.data?.total} matching
            </button>
          )}
          <button
            className="text-button"
            onClick={() => {
              setSelection([]);
              setAllMatching(false);
            }}
          >
            Clear selection
          </button>
          <span className="ws-spacer" />
          <button
            className="button secondary"
            disabled={!canRestore || action.busy}
            onClick={() => preview("restore")}
          >
            <RotateCcw size={15} />
            Restore selected
          </button>
          <button
            className="button secondary danger-text"
            disabled={!canPurge || action.busy}
            onClick={() => preview("purge")}
          >
            <Trash2 size={15} />
            Delete selected permanently
          </button>
        </div>
      )}
      {data.loading && !data.data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title="No matching items in Trash" icon={Trash2}>
          Try another workspace or clear your filters. Workspaces have a
          separate Trash view.
        </Empty>
      ) : (
        <div className="productivity-table-wrap">
          <table className="productivity-table console-trash-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select this page of Trash"
                    checked={
                      !!rows.length &&
                      (allMatching ||
                        rows.every((r) => selection.includes(r.id)))
                    }
                    onChange={(e) => {
                      setAllMatching(false);
                      setSelection((old) =>
                        e.target.checked
                          ? [...new Set([...old, ...rows.map((r) => r.id)])]
                          : old.filter((id) => !rows.some((r) => r.id === id)),
                      );
                    }}
                  />
                </th>
                <th>Name</th>
                <th>Original location</th>
                <th>Deleted</th>
                <th>Stored size</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <TrashTreeRow
                  key={item.id}
                  item={item}
                  depth={0}
                  selected={selection}
                  allMatching={allMatching}
                  select={select}
                  menu={menu}
                  filters={filters.toString()}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="console-pagination">
        <span className="ws-note">
          {data.data?.total
            ? `${offset + 1}–${offset + rows.length} of ${data.data.total} entries`
            : "0 entries"}
        </span>
        <span className="ws-spacer" />
        <button
          className="button secondary"
          disabled={!offset || data.loading}
          onClick={() => setOffset((n) => Math.max(0, n - 50))}
        >
          Previous
        </button>
        <button
          className="button secondary"
          disabled={data.data?.nextOffset == null || data.loading}
          onClick={() => setOffset(data.data!.nextOffset!)}
        >
          Next
        </button>
      </div>
      <p className="ws-note">
        No automatic expiry. A preview shows unique targets, protected items and
        total stored size before you confirm.
      </p>
      {operation && (
        <TrashOperationDialog
          key={operation}
          id={operation}
          onClose={() => {
            setOperation(null);
            refresh();
          }}
          onComplete={(op) => {
            setSelection([]);
            setAllMatching(false);
            refresh();
            notify(
              `${op.done} ${op.action === "restore" ? "restored" : "removed"} · ${op.total - op.done} retained. Details are in Audit.`,
            );
          }}
        />
      )}
    </>
  );
}

function TrashTreeRow({
  item,
  depth,
  selected,
  allMatching,
  select,
  menu,
  filters,
}: {
  item: TrashRow;
  depth: number;
  selected: string[];
  allMatching: boolean;
  select: (item: TrashRow, shift?: boolean, toggle?: boolean) => void;
  menu: (
    event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>,
    item: TrashRow,
  ) => void;
  filters: string;
}) {
  const [expanded, setExpanded] = useState(false),
    [offset, setOffset] = useState(0),
    { revision, spaces } = useWorkspace();
  const childFilters = new URLSearchParams(filters);
  childFilters.set("q", "");
  childFilters.set("kind", "");
  childFilters.delete("after");
  childFilters.delete("before");
  const children = useData<TrashRows>(
    expanded
      ? `trash/items?${childFilters}&parent=${item.id}&offset=${offset}`
      : null,
    revision,
  );
  return (
    <>
      <tr
        data-trash-id={item.id}
        data-selected={allMatching || selected.includes(item.id)}
        tabIndex={0}
        onClick={(e) => {
          if (!(e.target as Element).closest("button,input,a"))
            select(item, e.shiftKey, e.metaKey || e.ctrlKey);
        }}
        onContextMenu={(e) => menu(e, item)}
        onKeyDown={(e) => {
          if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))
            menu(e, item);
          else if (e.key === " " && e.target === e.currentTarget) {
            e.preventDefault();
            select(item, e.shiftKey, true);
          } else if (
            e.target === e.currentTarget &&
            [
              "ArrowDown",
              "ArrowUp",
              "ArrowRight",
              "ArrowLeft",
              "Home",
              "End",
            ].includes(e.key)
          ) {
            e.preventDefault();
            if (e.key === "ArrowRight" && item.has_children) setExpanded(true);
            else if (e.key === "ArrowLeft") setExpanded(false);
            else {
              const visible = Array.from(
                document.querySelectorAll<HTMLElement>(
                  ".console-trash-table tr[data-trash-id]",
                ),
              );
              const at = visible.indexOf(e.currentTarget);
              visible[
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? visible.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          visible.length - 1,
                          at + (e.key === "ArrowDown" ? 1 : -1),
                        ),
                      )
              ]?.focus();
            }
          }
        }}
      >
        <td>
          <input
            type="checkbox"
            aria-label={`Select ${item.name}`}
            checked={allMatching || selected.includes(item.id)}
            onChange={() => select(item, false, true)}
          />
        </td>
        <td>
          <span
            className="resource-cell"
            style={{ paddingInlineStart: `${depth * 1.25}em` }}
          >
            {item.has_children ? (
              <button
                className="icon-button"
                aria-label={`${expanded ? "Collapse" : "Expand"} ${item.name}`}
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
            ) : (
              <span className="console-tree-spacer" />
            )}
            <ResourceIcon resource={item} />
            <strong>{item.name}</strong>
          </span>
          {item.has_children && <small>Includes trashed descendants</small>}
        </td>
        <td>
          {spaces.find((s) => s.id === item.space_id)?.name}
          <small>{item.original_path}</small>
          {item.deleted_path == null && (
            <small title="This older deletion predates saved location history. The path is reconstructed from the remaining folders.">
              Reconstructed location
            </small>
          )}
        </td>
        <td>
          <time dateTime={item.deleted_at!}>
            {new Date(item.deleted_at!).toLocaleString()}
          </time>
          <small>{item.deleted_by_name || "Deletion actor not recorded"}</small>
        </td>
        <td>{bytes(Number(item.bytes ?? 0))}</td>
        <td>
          <button
            className="icon-button"
            title={`Actions for ${item.name}`}
            aria-label={`Actions for ${item.name}`}
            onClick={(e) => menu(e, item)}
          >
            <MoreHorizontal size={16} />
          </button>
        </td>
      </tr>
      {expanded && (
        <>
          {children.data?.items.map((child) => (
            <TrashTreeRow
              key={child.id}
              item={child}
              depth={depth + 1}
              selected={selected}
              allMatching={allMatching}
              select={select}
              menu={menu}
              filters={filters}
            />
          ))}
          {children.error && (
            <tr>
              <td colSpan={6}>
                <ErrorNotice message={children.error} retry={children.reload} />
              </td>
            </tr>
          )}
          {(offset > 0 || children.data?.nextOffset != null) && (
            <tr>
              <td colSpan={6}>
                <div className="ws-actions">
                  <button
                    className="text-button"
                    disabled={!offset}
                    onClick={() => setOffset((n) => Math.max(0, n - 50))}
                  >
                    Previous children
                  </button>
                  <button
                    className="text-button"
                    disabled={children.data?.nextOffset == null}
                    onClick={() => setOffset(children.data!.nextOffset!)}
                  >
                    More children
                  </button>
                </div>
              </td>
            </tr>
          )}
        </>
      )}
    </>
  );
}

function WorkspaceTrash() {
  const { revision, refresh, navigate, notify } = useWorkspace(),
    data = useData<WorkspaceRow[]>("trash/workspaces", revision);
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [operation, setOperation] = useState<string | null>(null),
    action = useAction();
  const anchor = useRef<string | null>(null);
  useEffect(() => {
    if (!data.data?.some((s) => s.effective_status === "purging")) return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [data.data, refresh]);
  useEffect(() => {
    setSelected([]);
  }, [search]);
  const rows = (data.data ?? []).filter(
    (s) =>
      !search ||
      `${s.name} ${s.group_name ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const preview = (command: "restore" | "purge", ids = selected) =>
    void action.run(async () => {
      const result = await post("trash/preview", {
        mutationId: crypto.randomUUID(),
        target: "workspaces",
        action: command,
        spaceIds: ids,
        ids,
      });
      setOperation(result.operation.id);
    });
  const menu = (event: React.MouseEvent<HTMLElement>, row: WorkspaceRow) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu({
      owner: event.currentTarget,
      x: event.type === "contextmenu" ? event.clientX : rect.left,
      y: event.type === "contextmenu" ? event.clientY : rect.bottom,
      label: "Workspace Trash actions",
      items: [
        {
          label:
            row.status === "purging"
              ? "Cancel permanent deletion…"
              : "Restore workspace…",
          icon: "restore",
          group: "Recovery",
          disabled: !row.lifecycle_actions.includes("restore"),
          action: () => preview("restore", [row.id]),
        },
        {
          label: "Review lifecycle and blockers",
          icon: "info",
          group: "Recovery",
          action: () => navigate(`/workspaces/${row.id}/settings/lifecycle`),
        },
        {
          label: "Delete permanently…",
          icon: "purge",
          group: "Permanent removal",
          tone: "danger",
          disabled: !row.lifecycle_actions.includes("purge"),
          disabledReason:
            row.kind === "team"
              ? "The group's default workspace is protected from permanent deletion."
              : "Only the group owner can purge an independently trashed workspace.",
          action: () => preview("purge", [row.id]),
        },
      ],
    });
  };
  return (
    <>
      <div className="console-toolbar">
        <label className="console-search">
          Search workspaces
          <input
            type="search"
            value={search}
            placeholder="Workspace or group name…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="ws-spacer" />
        <button
          className="button secondary"
          disabled={!rows.length || action.busy}
          onClick={() =>
            preview(
              "restore",
              rows.map((s) => s.id),
            )
          }
        >
          <RotateCcw size={16} />
          Restore all matching
        </button>
      </div>
      <p className="ws-note">
        Each workspace is restored independently, including its previous
        archived state. Restore a trashed group in Group administration first.
        Personal and default group workspaces are protected from permanent
        deletion. Emptying file Trash never deletes a workspace.
      </p>
      <ErrorNotice message={data.error || action.error} retry={data.reload} />
      {!!selected.length && (
        <div
          className="ws-selection-bar"
          role="region"
          aria-label="Workspace Trash selection actions"
        >
          <strong>{selected.length} selected</strong>
          <button className="text-button" onClick={() => setSelected([])}>
            Clear selection
          </button>
          <span className="ws-spacer" />
          <button
            className="button secondary"
            disabled={action.busy}
            onClick={() => preview("restore")}
          >
            <RotateCcw size={15} />
            Restore selected
          </button>
          <button
            className="button secondary danger-text"
            disabled={action.busy}
            onClick={() => preview("purge")}
          >
            <Trash2 size={15} />
            Delete selected permanently
          </button>
        </div>
      )}
      {data.loading && !data.data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title="No workspaces in Trash" icon={Blocks}>
          Archived workspaces stay in the directory. Trashed workspaces remain
          recoverable without a deadline.
        </Empty>
      ) : (
        <div className="productivity-table-wrap">
          <table className="productivity-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select matching workspaces"
                    checked={
                      !!rows.length &&
                      rows.every((s) => selected.includes(s.id))
                    }
                    onChange={(e) =>
                      setSelected(e.target.checked ? rows.map((s) => s.id) : [])
                    }
                  />
                </th>
                <th>Workspace</th>
                <th>State</th>
                <th>Contents</th>
                <th>Stored size</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <Fragment key={s.id}>
                  <tr
                    data-selected={selected.includes(s.id)}
                    onContextMenu={(e) => menu(e, s)}
                    onClick={(e) => {
                      if ((e.target as Element).closest("button,input,a"))
                        return;
                      setSelected((old) =>
                        selectFileRange(
                          rows.map((s) => s.id),
                          old,
                          anchor.current,
                          s.id,
                          e.shiftKey,
                          e.metaKey || e.ctrlKey,
                        ),
                      );
                      if (!e.shiftKey) anchor.current = s.id;
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${s.name}`}
                        checked={selected.includes(s.id)}
                        onChange={(e) =>
                          setSelected((old) =>
                            e.target.checked
                              ? [...old, s.id]
                              : old.filter((id) => id !== s.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <WorkspaceLink
                        to={`/workspaces/${s.id}/settings/lifecycle`}
                      >
                        {s.name}
                      </WorkspaceLink>
                      <small>{s.group_name}</small>
                    </td>
                    <td>
                      <Badge>{s.effective_status}</Badge>
                      <small>
                        {s.effective_status !== s.status
                          ? "Inherited · restore group first"
                          : s.deleted_at
                            ? new Date(s.deleted_at).toLocaleString()
                            : ""}
                      </small>
                    </td>
                    <td>{s.resources} resources</td>
                    <td>{bytes(s.bytes)}</td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Actions for ${s.name}`}
                        onClick={(e) => menu(e, s)}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {operation && (
        <TrashOperationDialog
          id={operation}
          onClose={() => {
            setOperation(null);
            refresh();
          }}
          onComplete={(op) => {
            setSelected([]);
            refresh();
            notify(
              op.action === "purge"
                ? "Workspace deletion requests processed. Check Lifecycle for progress or cancellation."
                : `${op.done} workspaces restored; ${op.total - op.done} retained.`,
            );
          }}
        />
      )}
    </>
  );
}
