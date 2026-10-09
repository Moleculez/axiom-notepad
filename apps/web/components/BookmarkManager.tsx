"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  Button,
  Checkbox,
  IconButton,
  TextInput,
  NativeSelect,
  SearchField,
} from "./ui/controls";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Download,
  MoreHorizontal,
  Pencil,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { ReadingItem } from "@axiom/shared/research";
import { markColors, exportReadingMarks } from "@axiom/shared/note-comments";
import {
  researchEntries,
  type ResearchController,
  type ResearchEntry,
} from "../lib/research-store";
import { confirmAction } from "../lib/app-prompt";
import { download, errorMessage } from "../lib/client";
import { openContextMenu } from "../lib/context-menu";

export default function BookmarkManager({
  research,
  userId,
  onOpen,
  onReattach,
  location,
}: {
  research: ResearchController;
  userId: string;
  onOpen: (item: ReadingItem) => void;
  onReattach?: (item: ReadingItem) => void;
  location?: (item: ReadingItem) => {
    label: string;
    position: number;
    stale?: boolean;
  };
}) {
  useInterfaceLocale();
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("document"),
    [currentId, setCurrentId] = useState<string | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [editing, setEditing] = useState<ReadingItem | null>(null),
    [removed, setRemoved] = useState<ResearchEntry[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const entries = research.entries.filter(
    (e) =>
      e.kind === "reading" &&
      (e.value as ReadingItem).kind === "bookmark" &&
      !e.value.deleted,
  );
  const matches = entries
    .filter((e) => {
      const d = (e.value as ReadingItem).data;
      return [d.label, d.heading, d.quote, ...(d.tags ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase());
    })
    .sort((a, b) =>
      sort === "recent"
        ? String(b.value.updated_at ?? "").localeCompare(
            String(a.value.updated_at ?? ""),
          )
        : (location?.(a.value as ReadingItem).position ??
            (a.value as ReadingItem).data.fraction ??
            0) -
          (location?.(b.value as ReadingItem).position ??
            (b.value as ReadingItem).data.fraction ??
            0),
    );
  const work = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const open = (item: ReadingItem) => {
    setCurrentId(item.id);
    onOpen(item);
  };
  const step = (direction: number) => {
    if (!matches.length) return;
    const index = matches.findIndex((e) => e.value.id === currentId);
    const next =
      index < 0
        ? direction > 0
          ? 0
          : matches.length - 1
        : (index + direction + matches.length) % matches.length;
    open(matches[next].value as ReadingItem);
  };
  const erase = async (targets: ResearchEntry[]) => {
    if (
      targets.length > 1 &&
      !(await confirmAction(`Remove these ${targets.length} bookmarks?`, {
        title: "Remove selected bookmarks?",
        confirmLabel: "Remove bookmarks",
        destructive: true,
      }))
    )
      return;
    const done: ResearchEntry[] = [];
    try {
      for (const entry of targets) {
        await research.remove(entry);
        done.push(entry);
      }
    } finally {
      setRemoved(done);
      setSelected([]);
    }
  };
  const undo = async () => {
    const latest = await researchEntries(userId, "reading");
    for (const entry of removed) {
      const value = entry.value as ReadingItem;
      const current = latest.find((r) => r.key === entry.key) as
        ResearchEntry | undefined;
      if (current?.conflict || (current && !current.value.deleted)) continue;
      await research.saveReading(
        "bookmark",
        value.target_type,
        value.target_id,
        value.data,
        (current?.value as ReadingItem | undefined) ?? value,
      );
    }
    setRemoved([]);
  };
  return (
    <div className="reading-mark-manager">
      <div className="reading-mark-search">
        <SearchField
          aria-label={uiText("Search bookmarks")}
          placeholder={uiText("Search labels or tags…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          clearLabel={uiText("Clear bookmark search")}
        />
        <NativeSelect
          aria-label={uiText("Sort bookmarks")}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="document">
            <I18nText id="Location" />
          </option>
          <option value="recent">
            <I18nText id="Recent" />
          </option>
        </NativeSelect>
      </div>
      <div className="reading-mark-tools">
        <span>
          {matches.length} <I18nText id="bookmark" />
          {matches.length === 1 ? "" : "s"}
        </span>
        <IconButton
          className="icon-button"
          title={uiText("Previous bookmark")}
          aria-label={uiText("Previous bookmark")}
          disabled={!matches.length}
          onClick={() => step(-1)}
        >
          <ArrowUp size={14} />
        </IconButton>
        <IconButton
          className="icon-button"
          title={uiText("Next bookmark")}
          aria-label={uiText("Next bookmark")}
          disabled={!matches.length}
          onClick={() => step(1)}
        >
          <ArrowDown size={14} />
        </IconButton>
        <IconButton
          className="icon-button"
          title={uiText("Export bookmarks")}
          aria-label={uiText("Export bookmarks")}
          onClick={(event) =>
            openContextMenu({
              owner: event.currentTarget,
              x: event.clientX,
              y: event.clientY,
              label: "Bookmark export",
              items: [
                {
                  label: "Export Markdown",
                  icon: "note",
                  action: () =>
                    download(
                      "reading-bookmarks.md",
                      exportReadingMarks(
                        "Reading bookmarks",
                        matches.map((e) => {
                          const v = e.value as ReadingItem;
                          return {
                            label: v.data.label || "Saved position",
                            location: location?.(v).label ?? v.data.heading,
                            tags: v.data.tags,
                            body: v.data.quote,
                          };
                        }),
                      ),
                    ),
                },
                {
                  label: "Export JSON",
                  icon: "code",
                  action: () =>
                    download(
                      "reading-bookmarks.json",
                      JSON.stringify(
                        {
                          format: "axiom-reading-bookmarks",
                          version: 1,
                          items: matches.map((e) => e.value),
                        },
                        null,
                        2,
                      ),
                      "application/json",
                    ),
                },
              ],
            })
          }
        >
          <Download size={14} />
        </IconButton>
      </div>
      {error && (
        <p className="reading-mark-error" role="alert">
          {error}
        </p>
      )}
      {!!removed.length && (
        <div className="reading-mark-status" role="status">
          {removed.length} <I18nText id="removed" />{" "}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void work(undo)}
          >
            <Undo2 size={13} />
            <I18nText id="Undo" />
          </button>
        </div>
      )}
      {!!selected.length && (
        <div className="reading-mark-status">
          <span>
            {selected.length} <I18nText id="selected" />
          </span>
          <IconButton
            className="icon-button"
            aria-label={uiText("Delete selected bookmarks")}
            title={uiText("Delete selected bookmarks")}
            disabled={busy}
            onClick={() =>
              void work(() =>
                erase(entries.filter((e) => selected.includes(e.key))),
              )
            }
          >
            <Trash2 size={14} />
          </IconButton>
          <IconButton
            className="icon-button"
            aria-label={uiText("Clear bookmark selection")}
            onClick={() => setSelected([])}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
      {!matches.length && (
        <p className="reading-mark-empty">
          {query
            ? uiText("No matching bookmarks.")
            : uiText("Bookmark a block or passage to return to it later.")}
        </p>
      )}
      {matches.map((entry) => {
        const item = entry.value as ReadingItem,
          info = location?.(item);
        return (
          <article
            className="reading-bookmark-row"
            key={entry.key}
            data-mark-color={item.data.color ?? "neutral"}
          >
            <Checkbox
              aria-label={`Select bookmark ${item.data.label || "Saved position"}`}
              checked={selected.includes(entry.key)}
              onChange={(e) =>
                setSelected((old) =>
                  e.target.checked
                    ? [...old, entry.key]
                    : old.filter((v) => v !== entry.key),
                )
              }
            />
            <button
              className="reading-bookmark-open"
              onClick={() => open(item)}
            >
              <span>
                <Bookmark size={14} />
                {item.data.label || "Saved position"}
              </span>
              <small>
                {info?.label ??
                  (item.data.page
                    ? `Page ${item.data.page}`
                    : (item.data.heading ?? "Saved position"))}
              </small>
              {item.data.quote && (
                <small className="reading-mark-excerpt">
                  {item.data.quote}
                </small>
              )}
              {!!item.data.tags?.length && (
                <small>
                  {item.data.tags.map((tag) => `#${tag}`).join(" ")}
                </small>
              )}
              {entry.pending && (
                <small>
                  {entry.error
                    ? uiText("Needs attention")
                    : uiText("Waiting to sync")}
                </small>
              )}
            </button>
            <IconButton
              className="icon-button"
              title={uiText("Bookmark actions")}
              aria-label={`Actions for bookmark ${item.data.label || "Saved position"}`}
              onClick={(event) =>
                openContextMenu({
                  owner: event.currentTarget,
                  x: event.clientX,
                  y: event.clientY,
                  label: "Bookmark actions",
                  items: [
                    {
                      label: "Edit bookmark",
                      icon: "rename",
                      group: "edit",
                      action: () => setEditing(item),
                    },
                    {
                      label: "Reattach to a block",
                      icon: "link",
                      group: "edit",
                      disabled: !onReattach,
                      disabledReason:
                        "Open its document to choose a new block.",
                      action: () => onReattach?.(item),
                    },
                    {
                      label: "Delete bookmark",
                      icon: "trash",
                      group: "remove",
                      tone: "danger",
                      action: () => void work(() => erase([entry])),
                    },
                  ],
                })
              }
            >
              <MoreHorizontal size={15} />
            </IconButton>
            {editing?.id === item.id && (
              <form
                className="reading-mark-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  void work(async () => {
                    await research.saveReading(
                      "bookmark",
                      item.target_type,
                      item.target_id,
                      editing.data,
                      item,
                    );
                    setEditing(null);
                  });
                }}
              >
                <label>
                  <I18nText id="Label" />
                  <TextInput
                    autoFocus
                    aria-label={uiText("Bookmark label")}
                    value={editing.data.label}
                    maxLength={300}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        data: { ...editing.data, label: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  <I18nText id="Tags" />
                  <TextInput
                    aria-label={uiText("Bookmark tags")}
                    defaultValue={editing.data.tags?.join(", ") ?? ""}
                    placeholder={uiText("theory, review")}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        data: {
                          ...editing.data,
                          tags: e.target.value
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                  />
                </label>
                <div
                  className="reading-mark-colors"
                  role="group"
                  aria-label={uiText("Bookmark color")}
                >
                  {markColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      data-mark-color={color}
                      aria-label={`${color} bookmark`}
                      aria-pressed={(editing.data.color ?? "neutral") === color}
                      title={color}
                      onClick={() =>
                        setEditing({
                          ...editing,
                          data: { ...editing.data, color },
                        })
                      }
                    >
                      <Bookmark size={15} />
                    </button>
                  ))}
                </div>
                <div className="reading-mark-form-actions">
                  <button
                    data-dialog-cancel
                    type="button"
                    className="text-button"
                    onClick={() => setEditing(null)}
                  >
                    <I18nText id="Cancel" />
                  </button>
                  <Button className="button secondary small" disabled={busy}>
                    <Pencil size={13} />
                    <I18nText id="Save bookmark" />
                  </Button>
                </div>
              </form>
            )}
            {(entry.error || entry.conflict) && (
              <div className="reading-mark-edit">
                <p role="alert">
                  {entry.error || "This bookmark changed on another device."}
                </p>
                <button
                  className="text-button"
                  onClick={() =>
                    void work(() => research.resolve(entry, false))
                  }
                >
                  <I18nText id="Use server version" />
                </button>
                <button
                  data-dialog-cancel
                  className="text-button"
                  onClick={() => void work(() => research.resolve(entry, true))}
                >
                  <I18nText id="Keep my changes" />
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
