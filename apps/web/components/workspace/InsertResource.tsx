"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  ActionRow,
  Button,
  Checkbox,
  IconButton,
  TextInput,
  NativeSelect,
  SearchField,
} from "../ui/controls";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Check,
  ChevronRight,
  Folder,
  Upload,
  Link2,
  Library,
  X,
} from "lucide-react";
import type { Note } from "@axiom/shared/access";
import type { Resource, ResourcePage, Space } from "@axiom/shared/workspace";
import type { UploadBatch } from "@axiom/shared/editor-media";
import { api } from "../../lib/client";
import { parseMarkdown } from "@axiom/markdown";
import {
  defaultMediaOptions,
  insertMediaMarkdown,
} from "../../lib/media-insertion";
import Dialog, { DialogFooter } from "../Dialog";
import MediaOptions from "../media/MediaOptions";
import FileIdentity from "../media/FileIdentity";
import ResearchInsert from "../media/ResearchInsert";
import {
  bytes,
  ErrorNotice,
  Loading,
  ResourceIcon,
  useData,
  useWorkspace,
} from "./ui";
const Preview = dynamic(() => import("../tools/FilePreviewSurface"), {
  loading: () => <Loading label={uiText("Opening preview…")} />,
});
const Reading = dynamic(() => import("../ReadingView"), { ssr: false });
export type MediaFilter = "all" | "image" | "pdf" | "audio" | "video";
export default function InsertResource({
  kind,
  note,
  space,
  initialFilter = "all",
  selection,
  onClose,
  onInsert,
}: {
  kind: "file" | "note";
  note: Pick<Note, "id" | "visibility"> & { parent_id?: string | null };
  space?: Space;
  initialFilter?: MediaFilter;
  selection?: { spaceIds: string[]; onChoose: (resource: Resource) => void };
  onClose: () => void;
  onInsert: (value: string) => boolean | void;
}) {
  useInterfaceLocale();
  const {
    spaces,
    revision,
    uploadBatch,
    transfers = [],
    showUploads,
  } = useWorkspace();
  const [tab, setTab] = useState<"library" | "upload" | "url">("library");
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [scope, setScope] = useState(space?.id ?? selection?.spaceIds[0] ?? ""),
    [folder, setFolder] = useState<string | null>(null);
  const [view, setView] = useState("all"),
    [filter, setFilter] = useState<MediaFilter>(initialFilter),
    [sort, setSort] = useState("updated");
  const [cursor, setCursor] = useState(""),
    [pages, setPages] = useState<Resource[]>([]);
  const [selected, setSelected] = useState<Resource[]>([]),
    [active, setActive] = useState<Resource | null>(null);
  const [options, setOptions] = useState(defaultMediaOptions),
    [error, setError] = useState("");
  const [localFiles, setLocalFiles] = useState<File[]>([]),
    [batch, setBatch] = useState<UploadBatch | null>(null),
    [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(""),
    [previewUrl, setPreviewUrl] = useState("");
  const input = useRef<HTMLInputElement>(null),
    alive = useRef(true),
    queryKey = useRef("");
  const [localPreviews, setLocalPreviews] = useState<Map<File, string>>(
    new Map(),
  );
  useEffect(() => {
    const previews = new Map(
      localFiles
        .filter(
          (file) => file.type.startsWith("image/") && file.size <= 20_000_000,
        )
        .map((file) => [file, URL.createObjectURL(file)]),
    );
    setLocalPreviews(previews);
    return () => previews.forEach((url) => URL.revokeObjectURL(url));
  }, [localFiles]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 180);
    return () => clearTimeout(timer);
  }, [search]);
  const mime =
    filter === "all" ? "" : filter === "pdf" ? "application/pdf" : filter + "/";
  const key = JSON.stringify([kind, query, scope, folder, view, filter, sort]);
  const pageCursor = queryKey.current === key ? cursor : "";
  const params = new URLSearchParams({
    pickKind: kind,
    view,
    limit: "60",
    q: query,
    sort,
    direction: sort === "updated" ? "desc" : "asc",
  });
  if (scope) params.set("spaceId", scope);
  if (folder) params.set("parentId", folder);
  if (mime) params.set("mime", mime);
  if (pageCursor) params.set("cursor", pageCursor);
  const data = useData<ResourcePage>(
    tab === "library" && (!selection || !!scope) ? "resources?" + params : null,
    revision,
  );
  useEffect(() => {
    queryKey.current = key;
    setCursor("");
    setPages([]);
  }, [key]);
  useEffect(() => {
    if (!data.data) return;
    setPages((previous) =>
      pageCursor
        ? [
            ...new Map(
              [...previous, ...data.data!.items].map((item) => [item.id, item]),
            ).values(),
          ]
        : data.data!.items,
    );
  }, [data.data, pageCursor]);
  const choose = (item: Resource) => {
    setActive(item);
    setError("");
    setOptions({
      ...defaultMediaOptions,
      display: item.mime?.startsWith("image/") ? "image" : "card",
      label: "fig-" + crypto.randomUUID().slice(0, 8),
    });
    setSelected((items) =>
      selection
        ? [item]
        : items.length <= 1
          ? [item]
          : items.some((entry) => entry.id === item.id)
            ? items
            : [...items, item],
    );
  };
  const scopeSpace = spaces.find((entry) => entry.id === scope);
  const canUpload =
    kind === "file" &&
    scopeSpace?.role === "editor" &&
    scopeSpace.effective_status === "active";
  const finish = (value: string) => {
    try {
      if (onInsert(value) !== false) onClose();
      else
        setError(
          "The insertion location changed. Close this dialog and choose a new cursor location; uploaded files remain in the library.",
        );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const startUpload = async () => {
    if (!uploadBatch || !localFiles.length || !canUpload) return;
    setBusy(true);
    setError("");
    try {
      const destination =
        view === "folder"
          ? folder
          : scope === space?.id
            ? (await api<Resource>("resources/" + note.id)).parent_id
            : null;
      if (!alive.current) return;
      const pending = uploadBatch(localFiles, scope, destination);
      setBatch(pending);
      const results = await pending.ready;
      if (!alive.current) return;
      const items = await Promise.all(
        results.map(async (result) => ({
          ...(await api<Resource>("resources/" + result.resourceId)),
          current_version_id: result.versionId,
          mime: result.mime,
          bytes: result.bytes,
        })),
      );
      if (!alive.current) return;
      if (items[0]) choose(items[0]);
      setSelected(items);
      setLocalFiles([]);
      setTab("library");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) {
        setBusy(false);
        setBatch(null);
      }
    }
  };
  const insert = () => {
    if (selection) {
      if (active) selection.onChoose(active);
      return;
    }
    if (tab === "url") {
      try {
        const parsed = new URL(url);
        if (
          !["https:", "http:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password
        )
          throw new Error(
            "Use an HTTP(S) address without embedded credentials.",
          );
        finish(
          insertMediaMarkdown(
            decodeURIComponent(
              parsed.pathname.split("/").at(-1) || "Attachment",
            ),
            parsed.href,
            filter === "image" ? "image/png" : "",
            {
              ...options,
              display:
                filter === "image"
                  ? options.display === "card"
                    ? "image"
                    : options.display
                  : "link",
            },
          ),
        );
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }
    try {
      finish(
        selected
          .map((item) =>
            kind === "note"
              ? "[[" + item.id + "|" + item.name.replace(/[\[\]|]/g, "") + "]]"
              : insertMediaMarkdown(
                  item.name,
                  "/api/v1/attachments/" + item.current_version_id,
                  item.mime ?? "",
                  selected.length === 1
                    ? options
                    : {
                        ...defaultMediaOptions,
                        display: item.mime?.startsWith("image/")
                          ? "image"
                          : "card",
                      },
                ),
          )
          .join("\n\n"),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const enterFolder = (id: string | null) => {
    setFolder(id);
    setView("folder");
    setSearch("");
  };
  const tabs: readonly ("library" | "upload" | "url")[] =
    kind === "file" && !selection
      ? (["library", "upload", "url"] as const)
      : (["library"] as const);
  const icons = { library: Library, upload: Upload, url: Link2 };
  return (
    <Dialog
      title={
        selection
          ? uiText("Link a source from your workspace")
          : kind === "note"
            ? "Link a research note"
            : filter === "image"
              ? "Insert an image"
              : "Insert an attachment"
      }
      subtitle={uiText(
        "Preview first · references retain their selected version",
      )}
      onClose={onClose}
      size="wide"
      className="media-insert-dialog"
    >
      <div
        className="media-insert-tabs"
        role="tablist"
        aria-label={uiText("File source")}
      >
        {tabs.map((id) => {
          const Icon = icons[id];
          return (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onKeyDown={(event) => {
                if (
                  !["ArrowRight", "ArrowLeft", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const index = tabs.indexOf(id);
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          tabs.length) %
                        tabs.length;
                setTab(tabs[next]);
                (
                  event.currentTarget.parentElement?.children[
                    next
                  ] as HTMLButtonElement
                )?.focus();
              }}
              onClick={() => {
                setTab(id);
                setError("");
              }}
            >
              <Icon size={16} />
              {id === "url"
                ? uiText("URL")
                : id === "upload"
                  ? "Upload"
                  : "Library"}
            </button>
          );
        })}
      </div>
      <ErrorNotice message={error} />
      <div className="media-insert-split">
        <section className="media-library" aria-label={uiText("Browse files")}>
          <div className="media-library-controls">
            <SearchField
              wrapperClassName="ws-search-field"
              autoFocus
              aria-label={uiText("Search files or reference codes")}
              placeholder={uiText("Search names, tags, or file codes…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="media-filter-row">
              <NativeSelect
                aria-label={uiText("Workspace")}
                value={scope}
                disabled={!selection && note.visibility === "shared"}
                onChange={(e) => {
                  setScope(e.target.value);
                  setFolder(null);
                  setSelected([]);
                  setActive(null);
                }}
              >
                {spaces
                  .filter((s) =>
                    selection
                      ? selection.spaceIds.includes(s.id)
                      : note.visibility !== "shared" || s.id === space?.id,
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </NativeSelect>
              {kind === "file" && (
                <NativeSelect
                  aria-label={uiText("File type")}
                  value={filter}
                  disabled={!!selection}
                  onChange={(e) => {
                    setFilter(e.target.value as MediaFilter);
                    setActive(null);
                    setSelected([]);
                  }}
                >
                  {["all", "image", "pdf", "audio", "video"].map((type) => (
                    <option key={type} value={type}>
                      {type === "all"
                        ? uiText("All files")
                        : type.toUpperCase()}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </div>
            {tab === "library" && (
              <div className="media-filter-row">
                <NativeSelect
                  aria-label={uiText("Library view")}
                  value={view}
                  onChange={(e) => {
                    setView(e.target.value);
                    setFolder(null);
                  }}
                >
                  <option value="all">
                    <I18nText id="All files" />
                  </option>
                  <option value="folder">
                    <I18nText id="Folders" />
                  </option>
                  <option value="recent">
                    <I18nText id="Recent" />
                  </option>
                  <option value="favorites">
                    <I18nText id="Favorites" />
                  </option>
                </NativeSelect>
                <NativeSelect
                  aria-label={uiText("Sort files")}
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="updated">
                    <I18nText id="Recently modified" />
                  </option>
                  <option value="name">
                    <I18nText id="Name" />
                  </option>
                  <option value="size">
                    <I18nText id="Size" />
                  </option>
                </NativeSelect>
              </div>
            )}
            {folder && (
              <nav
                className="media-breadcrumbs"
                aria-label={uiText("Folder path")}
              >
                <button onClick={() => enterFolder(null)}>
                  <Folder size={14} />
                  <I18nText id="Root" />
                </button>
                {data.data?.breadcrumbs.map((part) => (
                  <span key={part.id}>
                    <ChevronRight size={12} />
                    <button onClick={() => enterFolder(part.id)}>
                      {part.name}
                    </button>
                  </span>
                ))}
              </nav>
            )}
          </div>
          {tab === "library" && (
            <div
              className="media-results"
              role="list"
              aria-label={uiText("Available files")}
            >
              <ErrorNotice message={data.error} retry={data.reload} />
              {data.loading && !pages.length ? (
                <Loading />
              ) : !pages.length ? (
                <p className="media-empty">
                  <I18nText id="No matching files. Try another search or upload a file." />
                </p>
              ) : (
                pages
                  .filter((item) => item.id !== note.id)
                  .map((item) => (
                    <div
                      key={item.id}
                      className={
                        "media-result" +
                        (active?.id === item.id ? " is-active" : "")
                      }
                      role="listitem"
                    >
                      {item.kind !== "folder" && !selection && (
                        <Checkbox
                          aria-label={"Select " + item.name}
                          checked={selected.some(
                            (entry) => entry.id === item.id,
                          )}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSelected((items) =>
                              checked
                                ? [
                                    ...items.filter(
                                      (entry) => entry.id !== item.id,
                                    ),
                                    item,
                                  ]
                                : items.filter((entry) => entry.id !== item.id),
                            );
                            if (checked && !active) {
                              setActive(item);
                              setOptions({
                                ...defaultMediaOptions,
                                display: item.mime?.startsWith("image/")
                                  ? "image"
                                  : "card",
                              });
                            }
                          }}
                        />
                      )}
                      <button
                        aria-label={"Preview " + item.name}
                        onClick={() =>
                          item.kind === "folder"
                            ? enterFolder(item.id)
                            : choose(item)
                        }
                      >
                        {item.mime?.startsWith("image/") &&
                        item.current_version_id ? (
                          <img
                            loading="lazy"
                            alt=""
                            src={
                              "/api/v1/attachments/" + item.current_version_id
                            }
                          />
                        ) : (
                          <ResourceIcon resource={item} />
                        )}
                        <span>
                          <strong>{item.name}</strong>
                          <small>
                            {item.kind === "folder"
                              ? uiText("Folder")
                              : (item.reference_code ?? "") +
                                (item.bytes ? " · " + bytes(item.bytes) : "")}
                          </small>
                        </span>
                        {item.kind === "folder" && <ChevronRight size={14} />}
                      </button>
                    </div>
                  ))
              )}
              {data.data?.nextCursor && (
                <Button
                  className="button secondary"
                  disabled={data.loading}
                  onClick={() => setCursor(data.data!.nextCursor!)}
                >
                  <I18nText id="Load more files" />
                </Button>
              )}
            </div>
          )}
          {tab === "upload" && (
            <div
              className="media-upload-area"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy) setLocalFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <Upload size={30} />
              <h3>
                <I18nText id="Drop files here" />
              </h3>
              <p>
                <I18nText id="Stored privately in the selected workspace. Maximum 1 GB per file." />
              </p>
              <Button
                className="button secondary"
                disabled={!canUpload || busy}
                onClick={() => input.current?.click()}
              >
                <I18nText id="Choose files" />
              </Button>
              <input
                ref={input}
                type="file"
                hidden
                multiple
                accept={filter === "image" ? "image/*" : undefined}
                onChange={(e) => {
                  setLocalFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              {!canUpload && (
                <p>
                  <I18nText id="Choose an active workspace where you can edit." />
                </p>
              )}
              {localFiles.map((file, index) => (
                <div
                  className="media-upload-file"
                  key={file.name + ":" + index}
                >
                  {localPreviews.get(file) && (
                    <img src={localPreviews.get(file)} alt={file.name} />
                  )}
                  <span>
                    {file.name}
                    <small>{bytes(file.size)}</small>
                  </span>
                  {!busy && (
                    <IconButton
                      className="icon-button"
                      aria-label={"Remove " + file.name}
                      onClick={() =>
                        setLocalFiles((items) =>
                          items.filter((_, at) => at !== index),
                        )
                      }
                    >
                      <X size={14} />
                    </IconButton>
                  )}
                </div>
              ))}
              {batch &&
                transfers
                  .filter((item) => batch.ids.includes(item.id))
                  .map((item) => (
                    <div className="media-upload-file" key={item.id}>
                      <span>
                        {item.name}
                        <small>
                          {item.status}
                          {item.error ? " · " + item.error : ""}
                        </small>
                        <progress
                          max={item.bytes || 1}
                          value={Math.min(item.bytes, item.received)}
                        />
                      </span>
                    </div>
                  ))}
              {busy && (
                <ActionRow>
                  <Button className="button secondary" onClick={showUploads}>
                    <I18nText id="Manage / retry uploads" />
                  </Button>
                  <Button
                    data-dialog-cancel
                    className="button secondary"
                    onClick={() =>
                      void batch?.cancel().catch((e) => setError(e.message))
                    }
                  >
                    <I18nText id="Cancel insertion" />
                  </Button>
                </ActionRow>
              )}
            </div>
          )}
          {tab === "url" && (
            <div className="media-url">
              <Link2 size={28} />
              <label>
                <I18nText id="Image or file URL" />
                <TextInput
                  type="url"
                  placeholder="https://…"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setPreviewUrl("");
                  }}
                />
              </label>
              <p className="ws-small muted">
                <I18nText id="External links stay external. Loading a preview contacts that host; access and availability may change." />
              </p>
              {filter === "image" && (
                <Button
                  className="button secondary"
                  onClick={() => {
                    try {
                      const target = new URL(url);
                      if (
                        !/^https?:$/.test(target.protocol) ||
                        target.username ||
                        target.password
                      )
                        throw new Error(
                          "Use an HTTP(S) URL without credentials.",
                        );
                      setPreviewUrl(target.href);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <I18nText id="Load image preview" />
                </Button>
              )}
            </div>
          )}
        </section>
        <aside
          className="media-preview-panel"
          aria-label={uiText("Selected file preview")}
        >
          {tab === "url" ? (
            <>
              {previewUrl && (
                <img
                  className="media-url-preview"
                  src={previewUrl}
                  alt="External image preview"
                  onError={() =>
                    setError("The host did not provide an accessible image.")
                  }
                />
              )}
              <MediaOptions
                value={options}
                onChange={setOptions}
                mime={filter === "image" ? "image/png" : ""}
              />
            </>
          ) : active ? (
            <>
              <header>
                <h3>{active.name}</h3>
                <small>{active.reference_code}</small>
              </header>
              {kind === "file" ? (
                <>
                  <div className="media-picker-preview">
                    {active.mime?.startsWith("image/") ? (
                      <img
                        className="media-selected-image"
                        src={"/api/v1/attachments/" + active.current_version_id}
                        alt={active.name}
                      />
                    ) : (
                      <Preview
                        key={active.id + ":" + active.current_version_id}
                        resourceId={active.id}
                        versionId={active.current_version_id}
                        compact
                      />
                    )}
                  </div>
                  <FileIdentity
                    resource={active}
                    onVersion={(versionId, type) => {
                      const next = {
                        ...active,
                        current_version_id: versionId,
                        mime: type,
                      };
                      setActive(next);
                      setSelected((items) =>
                        items.map((item) =>
                          item.id === next.id ? next : item,
                        ),
                      );
                    }}
                  />
                  {!selection && (
                    <>
                      <MediaOptions
                        value={options}
                        onChange={setOptions}
                        mime={active.mime ?? ""}
                      />
                      <ResearchInsert
                        resource={active}
                        onInsert={finish}
                        shared={note.visibility === "shared"}
                      />
                    </>
                  )}
                </>
              ) : (
                <NotePreview id={active.id} />
              )}
            </>
          ) : (
            <div className="media-empty">
              <Library size={28} />
              <h3>
                <I18nText id="Choose a file to preview" />
              </h3>
              <p>
                <I18nText id="Inspect its contents before adding it to your research." />
              </p>
            </div>
          )}
        </aside>
      </div>
      <DialogFooter>
        <span className="media-insert-summary">
          {selected.length ? (
            <>
              <Check size={14} />
              {selected.length} <I18nText id="selected · pinned version" />
            </>
          ) : (
            "No source changes until insertion"
          )}
        </span>
        <Button
          data-dialog-cancel
          className="button secondary"
          onClick={onClose}
        >
          <I18nText id="Cancel" />
        </Button>
        {tab === "upload" ? (
          <Button
            className="button primary"
            disabled={busy || !localFiles.length || !canUpload}
            onClick={() => void startUpload()}
          >
            <I18nText id="Upload & review" />
          </Button>
        ) : (
          <Button
            className="button primary"
            disabled={busy || (tab === "url" ? !url.trim() : !selected.length)}
            onClick={insert}
          >
            {selection ? uiText("Link selected source") : uiText("Insert")}
            {selected.length > 1 && tab !== "url"
              ? " " + selected.length + " files"
              : ""}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
function NotePreview({ id }: { id: string }) {
  const data = useData<{ body: string }>("notes/" + id);
  const parsed = useMemo(
    () => parseMarkdown(data.data?.body ?? ""),
    [data.data?.body],
  );
  return (
    <div className="media-note-preview">
      <ErrorNotice message={data.error} />
      {data.data ? (
        <Reading
          source={data.data.body}
          parsed={parsed}
          context={{}}
          onLink={() => {}}
        />
      ) : (
        <Loading />
      )}
    </div>
  );
}
