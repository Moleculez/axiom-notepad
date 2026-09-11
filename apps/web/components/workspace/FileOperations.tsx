"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Folder, History, Link2 } from "lucide-react";
import type { Resource, ResourcePage } from "@axiom/shared/workspace";
import {
  renameFiles,
  type FileOperation,
  type FileOperationInput,
} from "@axiom/shared/file-workflows";
import { post } from "../../lib/client";
import Dialog from "../Dialog";
import { ErrorNotice, mutate, useAction, useData, useWorkspace } from "./ui";

export type FolderTarget = { spaceId: string; parentId: string | null };
export function FolderDestination({
  value,
  onChange,
  exclude = [],
  sameSpace,
}: {
  value: FolderTarget;
  onChange: (value: FolderTarget) => void;
  exclude?: string[];
  sameSpace?: string;
}) {
  const { spaces, revision } = useWorkspace();
  const [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [previous, setPrevious] = useState<(string | null)[]>([]);
  useEffect(() => {
    setCursor(null);
    setPrevious([]);
  }, [value.spaceId, value.parentId, search]);
  const rows = useData<ResourcePage>(
    value.spaceId
      ? `resources?${new URLSearchParams({ spaceId: value.spaceId, view: search ? "all" : "folder", kind: "folder", limit: "100", ...(search ? { q: search } : value.parentId ? { parentId: value.parentId } : {}), ...(cursor ? { cursor } : {}) })}`
      : null,
    revision,
  );
  return (
    <div className="file-destination">
      <label>
        Workspace
        <select
          aria-label="Destination workspace"
          value={value.spaceId}
          onChange={(event) =>
            onChange({ spaceId: event.target.value, parentId: null })
          }
        >
          {spaces
            .filter(
              (s) =>
                s.role === "editor" &&
                s.effective_status === "active" &&
                (!sameSpace || s.id === sameSpace),
            )
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.kind === "personal" ? " · Only you" : ""}
              </option>
            ))}
        </select>
      </label>
      <label>
        Find a destination folder
        <input
          type="search"
          value={search}
          placeholder="Search folders in this workspace…"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <nav aria-label="Destination breadcrumbs">
        <button
          className="text-button"
          onClick={() => {
            setSearch("");
            onChange({ ...value, parentId: null });
          }}
        >
          Root
        </button>
        {rows.data?.breadcrumbs.map((r) => (
          <span key={r.id}>
            <ChevronRight size={12} />
            <button
              className="text-button"
              onClick={() => {
                setSearch("");
                onChange({ ...value, parentId: r.id });
              }}
            >
              {r.name}
            </button>
          </span>
        ))}
      </nav>
      <div className="file-destination-folders">
        {rows.data?.items
          .filter((r) => !exclude.includes(r.id))
          .map((r) => (
            <button
              key={r.id}
              className="button secondary"
              onClick={() => {
                setSearch("");
                onChange({ ...value, parentId: r.id });
              }}
            >
              <Folder size={17} />
              {r.name}
              <ChevronRight size={14} />
            </button>
          ))}
        {!rows.loading && !rows.data?.items.length && (
          <p className="ws-note">
            No subfolders. Use the current folder as the destination.
          </p>
        )}
      </div>
      <ErrorNotice message={rows.error} retry={rows.reload} />
      {(previous.length > 0 || rows.data?.nextCursor) && (
        <div className="ws-actions">
          <button
            className="button secondary"
            disabled={!previous.length || rows.loading}
            onClick={() => {
              setCursor(previous.at(-1) ?? null);
              setPrevious((items) => items.slice(0, -1));
            }}
          >
            Previous folders
          </button>
          <button
            className="button secondary"
            disabled={!rows.data?.nextCursor || rows.loading}
            onClick={() => {
              setPrevious((items) => [...items, cursor]);
              setCursor(rows.data!.nextCursor);
            }}
          >
            Next folders
          </button>
        </div>
      )}
    </div>
  );
}
export function FileOperationDialog({
  command,
  items,
  target,
  onClose,
  onQueued,
}: {
  command: FileOperationInput["command"];
  items: Resource[];
  target?: FolderTarget;
  onClose: () => void;
  onQueued: (id: string) => void;
}) {
  const { spaces } = useWorkspace(),
    action = useAction();
  const [destination, setDestination] = useState(
      target ?? { spaceId: items[0].space_id, parentId: items[0].parent_id },
    ),
    [confirmed, setConfirmed] = useState(false);
  const [rename, setRename] = useState<{
    mode: "replace" | "prefix" | "suffix" | "number";
    text: string;
    find: string;
    start: number;
  }>({ mode: "prefix", text: "", find: "", start: 1 });
  const crossing =
    ["move", "copy"].includes(command) &&
    items.some((r) => r.space_id !== destination.spaceId);
  const identity = useRef({ value: "", id: crypto.randomUUID() });
  let renamed: FileOperationInput["items"] = items.map(({ id, version }) => ({
      id,
      version,
    })),
    renameError = "";
  if (command === "rename")
    try {
      renamed = renameFiles(items, rename);
    } catch {
      renameError =
        "Every new name must contain 1–200 characters, without slashes or control characters.";
    }
  return (
    <Dialog
      title={`${command === "rename" ? "Rename" : command === "copy" ? "Copy" : command === "move" ? "Move" : command === "trash" ? "Move to trash" : "Restore"} ${items.length} item${items.length === 1 ? "" : "s"}`}
      onClose={() => !action.busy && onClose()}
    >
      {["move", "copy"].includes(command) && (
        <FolderDestination
          value={destination}
          onChange={(v) => {
            setDestination(v);
            setConfirmed(false);
          }}
          exclude={command === "move" ? items.map((r) => r.id) : []}
        />
      )}
      {command === "rename" && (
        <div className="bulk-rename-fields">
          <label>
            Rename method
            <select
              value={rename.mode}
              onChange={(e) =>
                setRename({
                  ...rename,
                  mode: e.target.value as typeof rename.mode,
                })
              }
            >
              <option value="prefix">Add prefix</option>
              <option value="suffix">Add suffix</option>
              <option value="replace">Find and replace</option>
              <option value="number">Number sequence</option>
            </select>
          </label>
          {rename.mode === "replace" && (
            <label>
              Find
              <input
                value={rename.find}
                onChange={(e) => setRename({ ...rename, find: e.target.value })}
              />
            </label>
          )}
          <label>
            {rename.mode === "number" ? "Base name" : "New text"}
            <input
              value={rename.text}
              onChange={(e) => setRename({ ...rename, text: e.target.value })}
            />
          </label>
          {rename.mode === "number" && (
            <label>
              Start number
              <input
                type="number"
                min={1}
                max={99999}
                value={rename.start}
                onChange={(e) =>
                  setRename({
                    ...rename,
                    start: Math.max(
                      1,
                      Math.min(99999, Number(e.target.value) || 1),
                    ),
                  })
                }
              />
            </label>
          )}
          <p className="ws-note">
            File extensions are preserved. Each rename is checked against the
            current revision.
          </p>
        </div>
      )}
      <ul className="ws-operation-items">
        {items.map((r, i) => (
          <li key={r.id}>
            <span>{r.name}</span>
            {command === "rename" && (
              <>
                <ChevronRight size={13} />
                <strong>{renamed[i]?.name || "Invalid name"}</strong>
              </>
            )}
          </li>
        ))}
      </ul>
      {command === "copy" && (
        <p className="ws-note">
          Copies include current content and linked evidence. Comments and
          version history remain with the originals.
        </p>
      )}
      {command === "trash" && (
        <p className="ws-note">
          Selected items and their children remain recoverable in Trash. This
          does not permanently delete anything.
        </p>
      )}
      {crossing && (
        <label className="ws-checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            I confirm that the destination uses{" "}
            <strong>
              {spaces.find((s) => s.id === destination.spaceId)?.name}
            </strong>
            ’s permissions.{" "}
            {command === "move"
              ? "Existing links will follow those permissions. Moving between workspaces requires management access to the source."
              : "Original permissions remain unchanged."}
          </span>
        </label>
      )}
      <ErrorNotice message={action.error || renameError} />
      <div className="dialog-footer">
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className={`button ${command === "trash" ? "danger" : "primary"}`}
          disabled={action.busy || !!renameError || (crossing && !confirmed)}
          onClick={() =>
            void action.run(async () => {
              const input = {
                command,
                items: renamed,
                ...(["move", "copy"].includes(command) ? { destination } : {}),
                confirmAudience: confirmed,
              };
              const value = JSON.stringify(input);
              if (value !== identity.current.value)
                identity.current = { value, id: crypto.randomUUID() };
              const result = await post("file-operations", {
                ...input,
                id: identity.current.id,
              });
              onQueued(result.id);
            })
          }
        >
          {action.busy
            ? "Preparing…"
            : command === "rename"
              ? "Rename items"
              : command === "copy"
                ? "Copy here"
                : command === "move"
                  ? "Move here"
                  : command === "trash"
                    ? "Move to trash"
                    : "Restore items"}
        </button>
      </div>
    </Dialog>
  );
}
export function FileOperationActivity({
  id,
  onClose,
  onOpen,
  embedded = false,
}: {
  id?: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  embedded?: boolean;
}) {
  const { refresh } = useWorkspace(),
    action = useAction(),
    [tick, setTick] = useState(0),
    running = useRef(false);
  const data = useData<FileOperation[]>(id ? null : "file-operations", tick),
    detail = useData<FileOperation>(id ? `file-operations/${id}` : null, tick),
    op = detail.data;
  const busy = op
    ? ["queued", "running"].includes(op.status)
    : data.data?.some((o) => ["queued", "running"].includes(o.status));
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((v) => v + 1);
      if (busy) refresh();
    }, 2500);
    return () => clearInterval(timer);
  }, [busy, refresh]);
  useEffect(() => {
    if (!op || !["queued", "running"].includes(op.status) || running.current)
      return;
    running.current = true;
    void post(`file-operations/${op.id}/run`, {})
      .catch(() => {})
      .finally(() => {
        running.current = false;
        setTick((v) => v + 1);
        refresh();
      });
  }, [op?.id, op?.status]);
  const content = (
    <>
      <ErrorNotice
        message={detail.error || data.error || action.error}
        retry={id ? detail.reload : data.reload}
      />
      {op ? (
        <>
          <button className="text-button" onClick={() => onOpen("")}>
            <ArrowLeft size={14} />
            All operations
          </button>
          <h3>
            {op.command} · {op.input.items.length} items
          </h3>
          <p role="status">
            {op.status} · {op.results.filter((r) => r.ok).length} completed ·{" "}
            {op.results.filter((r) => !r.ok).length} need attention
          </p>
          <ul className="file-operation-results">
            {op.input.items.map((item) => {
              const result = op.results.find((r) => r.id === item.id);
              return (
                <li key={item.id}>
                  <strong>{item.original.name}</strong>
                  <span>
                    {result?.ok
                      ? "Completed"
                      : result?.error ||
                        (op.status === "cancelled" ? "Cancelled" : "Waiting")}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="ws-actions">
            {["queued", "running"].includes(op.status) ? (
              <button
                className="button secondary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await post(`file-operations/${op.id}/cancel`, {});
                    setTick((v) => v + 1);
                  })
                }
              >
                Cancel remaining
              </button>
            ) : (
              (op.results.some((r) => !r.ok) ||
                op.results.length < op.input.items.length) && (
                <button
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await post(`file-operations/${op.id}/retry`, {});
                      setTick((v) => v + 1);
                    })
                  }
                >
                  Retry remaining
                </button>
              )
            )}
            {op.status === "completed" &&
              ["rename", "move", "trash"].includes(op.command) &&
              op.results.some((r) => r.ok && r.resource) && (
                <button
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      const successful = op.results.filter(
                        (r) => r.ok && r.resource,
                      );
                      const originals = successful.map((r) =>
                        op.input.items.find((i) => i.id === r.id)!,
                      );
                      if (
                        op.command === "move" &&
                        !originals.every(
                          (r) =>
                            r.original.space_id ===
                              originals[0].original.space_id &&
                            r.original.parent_id ===
                              originals[0].original.parent_id,
                        )
                      )
                        throw new Error(
                          "Undo moves from one original folder at a time. Use Move to return this mixed selection.",
                        );
                      const result = await post("file-operations", {
                        id: crypto.randomUUID(),
                        command:
                          op.command === "trash" ? "restore" : op.command,
                        items: successful.map((r, i) => ({
                          id: r.resource!.id,
                          version: r.resource!.version,
                          ...(op.command === "rename"
                            ? { name: originals[i].original.name }
                            : {}),
                        })),
                        ...(op.command === "move"
                          ? {
                              destination: {
                                spaceId: originals[0].original.space_id,
                                parentId: originals[0].original.parent_id,
                              },
                              confirmAudience: op.input.confirmAudience,
                            }
                          : {}),
                      });
                      onOpen(result.id);
                    })
                  }
                >
                  Undo unchanged items
                </button>
              )}
          </div>
          <p className="ws-note">
            Undo checks permissions and revisions again; it never overwrites
            later edits.
          </p>
        </>
      ) : (
        <div className="file-operation-results">
          {data.data?.map((r) => (
            <button
              key={r.id}
              className="button secondary"
              onClick={() => onOpen(r.id)}
            >
              <History size={16} />
              <span>
                {r.command} · {r.input.items.length} items
              </span>
              <small>{r.status}</small>
            </button>
          ))}
          {!data.loading && !data.data?.length && (
            <p>No file operations yet.</p>
          )}
        </div>
      )}
      {!embedded && (
        <div className="dialog-footer">
          <button className="button primary" onClick={onClose}>
            Continue working
          </button>
        </div>
      )}
    </>
  );
  return embedded ? (
    <section className="console-operation">{content}</section>
  ) : (
    <Dialog title="Operation details" onClose={onClose}>
      {content}
    </Dialog>
  );
}
export function ShortcutDialog({
  item,
  onClose,
}: {
  item: Resource;
  onClose: () => void;
}) {
  const [target, setTarget] = useState({
      spaceId: item.space_id,
      parentId: item.parent_id,
    }),
    id = useRef(crypto.randomUUID()),
    action = useAction(),
    { refresh } = useWorkspace();
  return (
    <Dialog title="Create shortcut" onClose={onClose}>
      <p>
        <Link2 size={16} />A shortcut points to {item.name}; it does not copy
        content or grant access.
      </p>
      <FolderDestination
        value={target}
        onChange={setTarget}
        sameSpace={item.space_id}
      />
      <ErrorNotice message={action.error} />
      <div className="dialog-footer">
        <button
          className="button primary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await mutate("shortcuts", {
                mutationId: id.current,
                targetId: item.id,
                parentId: target.parentId,
              });
              refresh();
              onClose();
            })
          }
        >
          Create shortcut here
        </button>
      </div>
    </Dialog>
  );
}
