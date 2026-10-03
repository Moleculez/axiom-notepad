"use client";
import {
  Button,
  Checkbox,
  IconButton,
  NativeSelect,
  TextInput,
} from "../ui/controls";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Copy,
  Download,
  Folder,
  FolderPlus,
  GitMerge,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Save,
  SlidersHorizontal,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  LibraryReference,
  LibraryPage,
  ReferenceCollection,
} from "@axiom/shared/research-library";
import {
  readingStatuses,
  type ReadingData,
  type ReadingItem,
} from "@axiom/shared/research";
import { useResearch } from "../../lib/research-store";
import { openContextMenu } from "../../lib/context-menu";
import { confirmAction, promptValue } from "../../lib/app-prompt";
import {
  Empty,
  ErrorNotice,
  Loading,
  useAction,
  useData,
  useWorkspace,
  mutate,
} from "./ui";
import type { ResearchPanelProps } from "./ResearchWorkspace";
import ResearchSearch, { ResearchFilterInput } from "./ResearchSearch";
import Dialog, { DialogFooter } from "../Dialog";
import ReferenceInspector, { ReferenceForm } from "./ReferenceDetails";
import ReferenceWorkflow from "./ReferenceWorkflow";
export default function ResearchLibrary({
  space,
  params,
  onRoute,
  active,
}: ResearchPanelProps) {
  const { session, revision, refresh, notify } = useWorkspace(),
    scope = { spaceId: space.id };
  const research = useResearch(session.user.id, space.id, active),
    action = useAction();
  const [search, setSearch] = useState(params.get("q") ?? ""),
    [cursor, setCursor] = useState("0"),
    [selected, setSelected] = useState(new Map<string, LibraryReference>()),
    [rail, setRail] = useState(true),
    [filtersOpen, setFiltersOpen] = useState(false),
    [editing, setEditing] = useState<LibraryReference | null | undefined>(),
    [workflow, setWorkflow] = useState<"import" | "copy" | "merge" | null>(
      null,
    ),
    [organize, setOrganize] = useState(false),
    [tagDraft, setTagDraft] = useState("");
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [movingCollection, setMovingCollection] = useState<{
    collection: ReferenceCollection;
    parentId: string;
  } | null>(null);
  const selectAll = useRef<HTMLInputElement>(null),
    previousQuery = useRef("");
  const visibleRevision = useRef(revision);
  if (active) visibleRevision.current = revision;
  const query = new URLSearchParams({ spaceId: space.id });
  for (const k of [
    "q",
    "author",
    "year",
    "tag",
    "collection",
    "status",
    "filter",
    "sort",
    "direction",
  ])
    if (params.get(k)) query.set(k, params.get(k)!);
  const base = query.toString(),
    currentCursor = previousQuery.current === base ? cursor : "0";
  query.set("cursor", currentCursor);
  const data = useData<LibraryPage>(
      "research/library?" + query,
      visibleRevision.current,
    ),
    items = data.data?.items ?? [],
    collections = data.data?.collections ?? [],
    canEdit = data.data?.canEdit ?? false;
  const chosen = [...selected.values()],
    versions = Object.fromEntries(chosen.map((r) => [r.id, r.version]));
  const filterCount = ["author", "year", "tag", "status"].filter((key) => {
    const value = params.get(key);
    return value && value !== "all";
  }).length;
  const libraryTitle =
    params.get("filter") === "trash"
      ? "Library trash"
      : params.get("filter") === "duplicates"
        ? "Duplicates"
        : params.get("collection") === "unfiled"
          ? "Unfiled references"
          : (collections.find(
              (collection) => collection.id === params.get("collection"),
            )?.name ?? "All references");
  useEffect(() => {
    previousQuery.current = base;
    setCursor("0");
    setSelected(new Map());
  }, [base]);
  useEffect(() => setSearch(params.get("q") ?? ""), [params.get("q")]);
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate =
        items.some((r) => selected.has(r.id)) &&
        !items.every((r) => selected.has(r.id));
  }, [items, selected]);
  useEffect(() => {
    if (data.data)
      setSelected(
        (old) =>
          new Map(
            [...old].map(([id, r]) => [
              id,
              data.data!.items.find((n) => n.id === id) ?? r,
            ]),
          ),
      );
  }, [data.data]);
  const reload = () => {
    data.reload();
    refresh();
  };
  const batch = async (operation: string, extra: object = {}) => {
    await mutate("research/library/batch", {
      scope,
      ids: chosen.map((r) => r.id),
      versions,
      operation,
      ...extra,
    });
    setSelected(new Map());
    setOrganize(false);
    reload();
  };
  const exportFile = async (format: "bib" | "ris", selection = false) => {
    const response = await fetch(
      selection
        ? "/api/v1/research/library/batch"
        : "/api/v1/research/library?" +
            new URLSearchParams({ ...Object.fromEntries(query), format }),
      selection
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              scope,
              ids: chosen.map((r) => r.id),
              versions,
              operation: "export",
              format,
            }),
          }
        : {},
    );
    if (!response.ok)
      throw new Error((await response.json()).error ?? "Export failed.");
    const blob = await response.blob(),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `references.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const addCollection = async (parentId: string | null = null) => {
    const name = await promptValue("Collection name", {
      title: parentId ? "New subcollection" : "New collection",
    });
    if (name?.trim()) {
      await mutate("research/library/collections", {
        scope,
        name: name.trim(),
        parentId,
      });
      reload();
    }
  };
  const collectionMenu = (
    e: React.MouseEvent,
    collection: ReferenceCollection,
  ) => {
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    openContextMenu({
      owner: e.currentTarget as HTMLElement,
      x: e.type === "contextmenu" ? e.clientX : box.right,
      y: e.type === "contextmenu" ? e.clientY : box.bottom,
      label: "Collection actions",
      items: [
        {
          label: "New subcollection",
          icon: "folder",
          group: "Organize",
          disabled: !canEdit,
          action: () => void action.run(() => addCollection(collection.id)),
        },
        {
          label: "Rename collection",
          icon: "edit",
          disabled: !canEdit,
          action: () =>
            void action.run(async () => {
              const name = await promptValue("Collection name", {
                title: "Rename collection",
                defaultValue: collection.name,
              });
              if (name?.trim()) {
                await mutate(
                  "research/library/collections/" + collection.id,
                  { scope, name: name.trim(), version: collection.version },
                  "PATCH",
                );
                reload();
              }
            }),
        },
        {
          label: "Move collection…",
          icon: "folder",
          disabled: !canEdit,
          action: () =>
            setMovingCollection({
              collection,
              parentId: collection.parent_id ?? "",
            }),
        },
        {
          label: "Remove collection",
          icon: "trash",
          group: "Remove",
          tone: "danger",
          disabled: !canEdit,
          action: () =>
            void action.run(async () => {
              if (
                await confirmAction(
                  "Remove this collection and its subcollections? References will stay in the library.",
                  {
                    title: "Remove collection",
                    confirmLabel: "Remove collection",
                  },
                )
              ) {
                await mutate(
                  "research/library/collections/" + collection.id,
                  { scope, version: collection.version },
                  "DELETE",
                );
                if (params.get("collection") === collection.id)
                  onRoute({ collection: "" });
                reload();
              }
            }),
        },
      ],
    });
  };
  const saveFilter = async (existing?: ReadingItem, rename = false) => {
    const name = await promptValue(
      rename ? "New saved-search name" : "Name this personal saved search",
      {
        title: rename ? "Rename saved search" : "Save library search",
        defaultValue: existing?.data.label ?? "",
      },
    );
    if (!name?.trim()) return;
    const filters: ReadingData = {
      label: name.trim(),
      query: params.get("q") ?? "",
      author: params.get("author") ?? "",
      year: params.get("year") ?? "",
      tag: params.get("tag") ?? "",
      project: params.get("space") ?? "",
      filterStatus: (params.get("status") ??
        "all") as ReadingData["filterStatus"],
    };
    if (existing) {
      await research.saveReading(
        "filter",
        existing.target_type,
        existing.target_id,
        rename ? { ...existing.data, label: name.trim() } : filters,
        existing,
      );
    } else await research.saveReading("filter", "group", space.id, filters);
  };
  const filters = research.entries.filter(
    (e) =>
      e.kind === "reading" &&
      (e.value as ReadingItem).kind === "filter" &&
      !e.value.deleted,
  );
  const renderCollections = (
    parent: string | null,
    depth = 0,
  ): React.ReactNode =>
    collections
      .filter((c) => c.parent_id === parent)
      .map((c) => (
        <div key={c.id}>
          <div
            className="library-collection-row"
            style={{ paddingLeft: depth * 12 }}
            onContextMenu={(e) => collectionMenu(e, c)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (
                canEdit &&
                e.dataTransfer.getData("application/x-axiom-reference") &&
                chosen.length
              )
                void action.run(() =>
                  batch("collection-add", { collectionId: c.id }),
                );
            }}
          >
            {collections.some((child) => child.parent_id === c.id) && (
              <button
                className="library-collection-toggle"
                aria-label={`${collapsed.has(c.id) ? "Expand" : "Collapse"} ${c.name}`}
                aria-expanded={!collapsed.has(c.id)}
                onClick={() =>
                  setCollapsed((old) => {
                    const next = new Set(old);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  })
                }
              >
                {collapsed.has(c.id) ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
              </button>
            )}
            <button
              aria-current={
                params.get("collection") === c.id ? "page" : undefined
              }
              onClick={() =>
                onRoute({ collection: c.id, filter: "", reference: "" })
              }
            >
              <Folder size={14} />
              <span>{c.name}</span>
              <small>{c.count}</small>
            </button>
            <IconButton
              className="icon-button"
              aria-label={`Actions for ${c.name}`}
              onClick={(e) => collectionMenu(e, c)}
            >
              <MoreHorizontal size={13} />
            </IconButton>
          </div>
          {depth < 20 &&
            !collapsed.has(c.id) &&
            renderCollections(c.id, depth + 1)}
        </div>
      ));
  return (
    <div className="research-library">
      <div className="research-panel-toolbar">
        <IconButton
          className="icon-button"
          aria-label={
            rail ? "Hide library collections" : "Show library collections"
          }
          title={rail ? "Hide collections" : "Show collections"}
          onClick={() => setRail(!rail)}
        >
          {rail ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </IconButton>
        <ResearchSearch
          value={search}
          onChange={(v) => {
            setSearch(v);
            if (!v) onRoute({ q: "" });
          }}
          onSubmit={() => onRoute({ q: search.trim() })}
          label="Search reference library"
          placeholder="Title, author, DOI, citation key…"
        />
        <Button
          className="button ghost research-filter-toggle"
          aria-expanded={filtersOpen}
          aria-controls="library-filter-fields"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal size={15} /> Filters
          {!!filterCount && (
            <span className="research-filter-count">{filterCount}</span>
          )}
        </Button>
        <span className="tool-spacer" />
        <Button
          className="button primary"
          disabled={!canEdit}
          onClick={() => setEditing(null)}
        >
          <Plus size={15} />
          Add reference
        </Button>
        <IconButton
          className="icon-button"
          disabled={!canEdit}
          aria-label="Import references"
          title="Import BibTeX / RIS"
          onClick={() => setWorkflow("import")}
        >
          <Upload size={16} />
        </IconButton>
        <details className="research-export-menu">
          <summary aria-label="Export library">
            <Download size={16} />
          </summary>
          <div>
            <Button
              className="button ghost"
              onClick={() => void action.run(() => exportFile("bib"))}
            >
              BibTeX
            </Button>
            <Button
              className="button ghost"
              onClick={() => void action.run(() => exportFile("ris"))}
            >
              RIS
            </Button>
          </div>
        </details>
      </div>
      <ErrorNotice message={data.error || action.error} retry={data.reload} />
      <div className="library-layout">
        {rail && (
          <aside className="library-rail" aria-label="Library collections">
            <button
              className="library-nav-item"
              aria-current={
                !params.get("collection") && !params.get("filter")
                  ? "page"
                  : undefined
              }
              onClick={() =>
                onRoute({ collection: "", filter: "", reference: "" })
              }
            >
              <BookOpen size={15} />
              All references
            </button>
            <button
              className="library-nav-item"
              aria-current={
                params.get("collection") === "unfiled" ? "page" : undefined
              }
              onClick={() =>
                onRoute({ collection: "unfiled", filter: "", reference: "" })
              }
            >
              <Folder size={15} />
              Unfiled
            </button>
            <button
              className="library-nav-item"
              aria-current={
                params.get("filter") === "duplicates" ? "page" : undefined
              }
              onClick={() =>
                onRoute({ collection: "", filter: "duplicates", reference: "" })
              }
            >
              <Copy size={15} />
              Duplicates
            </button>
            <button
              className="library-nav-item"
              aria-current={
                params.get("filter") === "trash" ? "page" : undefined
              }
              onClick={() =>
                onRoute({ collection: "", filter: "trash", reference: "" })
              }
            >
              <Trash2 size={15} />
              Trash
            </button>
            <div className="library-rail-heading">
              <h2>Collections</h2>
              <IconButton
                className="icon-button"
                aria-label="New collection"
                title="New collection"
                disabled={!canEdit}
                onClick={() => void action.run(() => addCollection())}
              >
                <FolderPlus size={14} />
              </IconButton>
            </div>
            {renderCollections(null)}
            {!collections.length && (
              <p className="muted">Group papers without making copies.</p>
            )}
            <div className="library-rail-heading">
              <h2>Saved searches</h2>
              <IconButton
                className="icon-button"
                aria-label="Save library search"
                title="Save current search"
                onClick={() => void action.run(() => saveFilter())}
              >
                <Save size={14} />
              </IconButton>
            </div>
            {filters.map((entry) => {
              const r = entry.value as ReadingItem;
              return (
                <div className="library-collection-row" key={r.id}>
                  <button
                    onClick={() =>
                      onRoute({
                        q: r.data.query ?? "",
                        author: r.data.author ?? "",
                        year: r.data.year ?? "",
                        tag: r.data.tag ?? "",
                        status: r.data.filterStatus ?? "all",
                      })
                    }
                  >
                    {r.data.label}
                  </button>
                  <IconButton
                    className="icon-button"
                    aria-label={`Manage saved search ${r.data.label}`}
                    onClick={(e) => {
                      const box = e.currentTarget.getBoundingClientRect();
                      openContextMenu({
                        owner: e.currentTarget,
                        x: box.right,
                        y: box.bottom,
                        label: "Saved search",
                        items: [
                          {
                            label: "Rename",
                            icon: "edit",
                            group: "Edit",
                            action: () =>
                              void action.run(() => saveFilter(r, true)),
                          },
                          {
                            label: "Update with current filters",
                            icon: "restore",
                            action: () => void action.run(() => saveFilter(r)),
                          },
                          {
                            label: "Delete saved search",
                            icon: "trash",
                            group: "Remove",
                            tone: "danger",
                            action: () =>
                              void action.run(() => research.remove(entry)),
                          },
                        ],
                      });
                    }}
                  >
                    <MoreHorizontal size={13} />
                  </IconButton>
                </div>
              );
            })}
            <div className="library-rail-heading">
              <h2>Tags</h2>
              {params.get("tag") && (
                <IconButton
                  className="icon-button"
                  aria-label="Clear tag filter"
                  onClick={() => onRoute({ tag: "" })}
                >
                  <X size={13} />
                </IconButton>
              )}
            </div>
            <div className="research-tags">
              {data.data?.tags.map((tag) => (
                <button
                  key={tag}
                  aria-pressed={params.get("tag") === tag}
                  onClick={() =>
                    onRoute({ tag: params.get("tag") === tag ? "" : tag })
                  }
                >
                  {tag}
                </button>
              ))}
            </div>
          </aside>
        )}
        <section className="library-results" aria-label="References">
          <header className="library-results-heading">
            <h2>{libraryTitle}</h2>
            <span>
              {data.data?.total ?? items.length}{" "}
              {(data.data?.total ?? items.length) === 1
                ? "reference"
                : "references"}
            </span>
          </header>
          <div
            className="library-filters"
            id="library-filter-fields"
            hidden={!filtersOpen}
          >
            <ResearchFilterInput
              label="Filter reference author"
              placeholder="Author"
              value={params.get("author") ?? ""}
              onChange={(author) => onRoute({ author })}
            />
            <ResearchFilterInput
              label="Filter reference year"
              maxLength={20}
              placeholder="Year"
              value={params.get("year") ?? ""}
              onChange={(year) => onRoute({ year })}
            />
            <NativeSelect
              aria-label="Filter reading status"
              value={params.get("status") ?? "all"}
              onChange={(e) => onRoute({ status: e.target.value })}
            >
              <option value="all">All reading statuses</option>
              {Object.entries(readingStatuses).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
            <Button
              className="button ghost"
              onClick={() =>
                onRoute({
                  q: "",
                  author: "",
                  year: "",
                  tag: "",
                  status: "",
                  collection: "",
                  filter: "",
                })
              }
            >
              Reset filters
            </Button>
          </div>
          {!!chosen.length && (
            <div
              className="library-selection"
              aria-label="Selected reference actions"
            >
              <strong>{chosen.length} selected</strong>
              <NativeSelect
                aria-label="Set selected reading status"
                value=""
                disabled={action.busy}
                onChange={(e) =>
                  void action.run(() =>
                    batch("reading", { status: e.target.value }),
                  )
                }
              >
                <option value="" disabled>
                  Reading status…
                </option>
                {Object.entries(readingStatuses).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
              <IconButton
                className="icon-button"
                disabled={!canEdit}
                aria-label="Organize selected references"
                title="Tags & collections"
                onClick={() => setOrganize(!organize)}
              >
                <Tag size={15} />
              </IconButton>
              <IconButton
                className="icon-button"
                aria-label="Copy selected citations"
                title="Copy citations"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(chosen.map((r) => `[@${r.cite_key}]`).join(" "))
                    .then(
                      () => notify("Citations copied."),
                      () => notify("Clipboard unavailable."),
                    )
                }
              >
                <Copy size={15} />
              </IconButton>
              <IconButton
                className="icon-button"
                aria-label="Copy references to library"
                title="Copy to another library"
                onClick={() => setWorkflow("copy")}
              >
                <FolderPlus size={15} />
              </IconButton>
              <IconButton
                className="icon-button"
                disabled={
                  !canEdit ||
                  chosen.length < 2 ||
                  chosen.length > 20 ||
                  params.get("filter") === "trash"
                }
                aria-label="Merge selected references"
                title="Review duplicate merge"
                onClick={() => setWorkflow("merge")}
              >
                <GitMerge size={15} />
              </IconButton>
              <details className="research-export-menu">
                <summary aria-label="Export selected references">
                  <Download size={15} />
                </summary>
                <div>
                  {(["bib", "ris"] as const).map((f) => (
                    <Button
                      key={f}
                      className="button ghost"
                      onClick={() => void action.run(() => exportFile(f, true))}
                    >
                      {f.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </details>
              <IconButton
                className="icon-button"
                disabled={!canEdit}
                aria-label={
                  params.get("filter") === "trash"
                    ? "Restore references"
                    : "Trash references"
                }
                title={
                  params.get("filter") === "trash"
                    ? "Restore"
                    : "Move to library trash"
                }
                onClick={() =>
                  void action.run(async () => {
                    if (
                      params.get("filter") === "trash" ||
                      (await confirmAction(
                        "Move selected references to library Trash? Existing citations will continue to resolve.",
                        {
                          title: "Move references to trash",
                          confirmLabel: "Move to trash",
                        },
                      ))
                    )
                      await batch(
                        params.get("filter") === "trash" ? "restore" : "trash",
                      );
                  })
                }
              >
                <Trash2 size={15} />
              </IconButton>
              <IconButton
                className="icon-button"
                aria-label="Clear reference selection"
                onClick={() => setSelected(new Map())}
              >
                <X size={15} />
              </IconButton>
            </div>
          )}
          {organize && chosen.length > 0 && (
            <div className="library-organize">
              <label>
                Tags
                <TextInput
                  aria-label="Bulk reference tags"
                  value={tagDraft}
                  placeholder="Comma-separated tags"
                  onChange={(e) => setTagDraft(e.target.value)}
                />
              </label>
              <Button
                className="button secondary"
                disabled={!canEdit || !tagDraft.trim()}
                onClick={() =>
                  void action.run(() =>
                    batch("tag-add", {
                      tags: tagDraft
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    }),
                  )
                }
              >
                Add tags
              </Button>
              <Button
                className="button ghost"
                disabled={!canEdit || !tagDraft.trim()}
                onClick={() =>
                  void action.run(() =>
                    batch("tag-remove", {
                      tags: tagDraft
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    }),
                  )
                }
              >
                Remove tags
              </Button>
              <NativeSelect
                aria-label="Add selected references to collection"
                value=""
                onChange={(e) =>
                  void action.run(() =>
                    batch("collection-add", { collectionId: e.target.value }),
                  )
                }
              >
                <option value="" disabled>
                  Add to collection…
                </option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              {params.get("collection") &&
                params.get("collection") !== "unfiled" && (
                  <Button
                    className="button ghost"
                    onClick={() =>
                      void action.run(() =>
                        batch("collection-remove", {
                          collectionId: params.get("collection"),
                        }),
                      )
                    }
                  >
                    Remove from collection
                  </Button>
                )}
            </div>
          )}
          {data.loading && !data.data ? (
            <Loading label="Loading references…" />
          ) : items.length ? (
            <div className="library-table-scroll">
              <table className="library-table">
                <thead>
                  <tr>
                    <th>
                      <Checkbox
                        ref={selectAll}

                        aria-label="Select this page of references"
                        checked={
                          items.length > 0 &&
                          items.every((r) => selected.has(r.id))
                        }
                        onChange={(e) =>
                          setSelected((old) => {
                            const next = new Map(old);
                            for (const r of items) {
                              if (e.target.checked) next.set(r.id, r);
                              else next.delete(r.id);
                            }
                            return next;
                          })
                        }
                      />
                    </th>
                    {[
                      ["title", "Reference"],
                      ["year", "Year"],
                      ["venue", "Venue"],
                    ].map(([key, label]) => (
                      <th key={key}>
                        <button
                          onClick={() =>
                            onRoute({
                              sort: key,
                              direction:
                                params.get("sort") === key &&
                                params.get("direction") === "asc"
                                  ? "desc"
                                  : "asc",
                            })
                          }
                        >
                          {label}
                          {params.get("sort") === key
                            ? params.get("direction") === "asc"
                              ? " ↑"
                              : " ↓"
                            : ""}
                        </button>
                      </th>
                    ))}
                    <th>My status</th>
                    <th>PDFs</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr
                      key={r.id}
                      data-selected={selected.has(r.id) || undefined}
                      data-active={
                        params.get("reference") === r.id || undefined
                      }
                      draggable={selected.has(r.id)}
                      onDragStart={(e) =>
                        e.dataTransfer.setData(
                          "application/x-axiom-reference",
                          JSON.stringify(chosen.map((r) => r.id)),
                        )
                      }
                    >
                      <td>
                        <Checkbox
                          aria-label={`Select ${r.cite_key}`}
                          checked={selected.has(r.id)}
                          onChange={(e) =>
                            setSelected((old) => {
                              const next = new Map(old);
                              if (e.target.checked) next.set(r.id, r);
                              else next.delete(r.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="library-title"
                          onClick={() => onRoute({ reference: r.id })}
                        >
                          <strong>{r.title}</strong>
                          <span>{r.authors || "Unknown author"}</span>
                          <small>
                            {r.cite_key}
                            {r.tags.length
                              ? " · " + r.tags.slice(0, 3).join(", ")
                              : ""}
                          </small>
                        </button>
                      </td>
                      <td>{r.year || "—"}</td>
                      <td>{r.venue || "—"}</td>
                      <td>
                        <span className="library-reading-status">
                          {readingStatuses[r.status]}
                        </span>
                      </td>
                      <td>{r.pdf_count || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={
                params.get("filter") === "trash"
                  ? "Library trash is empty"
                  : "No matching references"
              }
            >
              Add a reference, import a bibliography, or clear your filters.
            </Empty>
          )}
          <footer className="library-pagination">
            <span>
              {data.data?.total ?? 0} references ·{" "}
              {space.kind !== "personal"
                ? "Shared metadata, private reading status"
                : "Private library"}
            </span>
            <span className="tool-spacer" />
            <IconButton
              className="icon-button"
              aria-label="Previous references"
              disabled={currentCursor === "0" || data.loading}
              onClick={() =>
                setCursor(String(Math.max(0, Number(currentCursor) - 50)))
              }
            >
              <ChevronLeft size={16} />
            </IconButton>
            <IconButton
              className="icon-button"
              aria-label="Next references"
              disabled={!data.data?.nextCursor || data.loading}
              onClick={() => setCursor(data.data!.nextCursor!)}
            >
              <ChevronRight size={16} />
            </IconButton>
          </footer>
        </section>
        {params.get("reference") && (
          <ReferenceInspector
            id={params.get("reference")!}
            scope={scope}
            canEdit={canEdit}
            onClose={() => onRoute({ reference: "" })}
            onEdit={setEditing}
            onRefresh={reload}
          />
        )}
      </div>
      {movingCollection && (
        <Dialog
          title="Move collection"
          onClose={() => setMovingCollection(null)}
        >
          <p className="muted">
            References keep their membership. The collection and its
            subcollections move together.
          </p>
          <label>
            Parent collection
            <NativeSelect
              aria-label="Parent collection"
              value={movingCollection.parentId}
              onChange={(e) =>
                setMovingCollection({
                  ...movingCollection,
                  parentId: e.target.value,
                })
              }
            >
              <option value="">Library root</option>
              {collections
                .filter((c) => {
                  let current: ReferenceCollection | undefined = c;
                  const visited = new Set<string>();
                  while (current && !visited.has(current.id)) {
                    if (current.id === movingCollection.collection.id)
                      return false;
                    visited.add(current.id);
                    current = collections.find(
                      (p) => p.id === current!.parent_id,
                    );
                  }
                  return true;
                })
                .map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
            </NativeSelect>
          </label>
          <ErrorNotice message={action.error} />
          <DialogFooter>
            <Button
              className="button secondary"
              onClick={() => setMovingCollection(null)}
            >
              Cancel
            </Button>
            <Button
              className="button primary"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await mutate(
                    "research/library/collections/" +
                      movingCollection.collection.id,
                    {
                      scope,
                      parentId: movingCollection.parentId || null,
                      version: movingCollection.collection.version,
                    },
                    "PATCH",
                  );
                  setMovingCollection(null);
                  reload();
                })
              }
            >
              Move collection
            </Button>
          </DialogFooter>
        </Dialog>
      )}
      {editing !== undefined && (
        <ReferenceForm
          reference={editing ?? undefined}
          scope={scope}
          onClose={() => setEditing(undefined)}
          onSaved={(id) => {
            setEditing(undefined);
            reload();
            onRoute({ reference: id });
          }}
        />
      )}
      {workflow && (
        <ReferenceWorkflow
          mode={workflow}
          scope={scope}
          selected={chosen}
          collectionId={
            params.get("collection") && params.get("collection") !== "unfiled"
              ? params.get("collection")!
              : undefined
          }
          onClose={() => setWorkflow(null)}
          onSaved={() => {
            setWorkflow(null);
            setSelected(new Map());
            reload();
          }}
        />
      )}
    </div>
  );
}
