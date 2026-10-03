"use client";
import {
  Button,
  Checkbox,
  TextInput,
  NativeSelect,
  TextArea,
} from "../ui/controls";
import { useEffect, useMemo, useState } from "react";
import { Copy, Plus, Archive, RotateCcw } from "lucide-react";
import { parseMarkdown } from "@axiom/markdown";
import { templates } from "@axiom/shared/templates";
import type { EditorSnippet } from "@axiom/shared/editor-media";
import { api, post } from "../../lib/client";
import Dialog, { DialogFooter } from "../Dialog";
import ReadingView from "../ReadingView";
import { ErrorNotice, useData, useWorkspace } from "../workspace/ui";
export default function SnippetLibrary({
  spaceId,
  selection,
  creating = false,
  onClose,
  onInsert,
}: {
  spaceId?: string;
  selection: string;
  creating?: boolean;
  onClose: () => void;
  onInsert: (value: string) => boolean | void;
}) {
  const { spaces } = useWorkspace();
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [shareCopy, setShareCopy] = useState(false),
    [archived, setArchived] = useState(false),
    [selected, setSelected] = useState<EditorSnippet | null>(null),
    [name, setName] = useState(creating ? "New research snippet" : ""),
    [body, setBody] = useState(creating ? selection : ""),
    [tags, setTags] = useState(""),
    [scope, setScope] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0);
  const data = useData<{ items: EditorSnippet[]; nextOffset: number | null }>(
    `editor-snippets?${new URLSearchParams({ ...(spaceId ? { spaceId } : {}), archived: String(archived), offset: String(page), q: query })}`,
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 180);
    return () => clearTimeout(timer);
  }, [search]);
  const sharingPersonal =
    !!selected &&
    !selected.space_id &&
    spaces.some((space) => space.id === spaceId && space.kind !== "personal");
  const parsed = useMemo(() => parseMarkdown(body), [body]);
  const select = (item: EditorSnippet) => {
    setSelected(item);
    setName(item.name);
    setBody(item.body);
    setTags(item.tags.join(", "));
    setScope(item.space_id ?? "");
    setError("");
    setShareCopy(false);
  };
  const save = async (archive?: boolean) => {
    setBusy(true);
    setError("");
    try {
      const input = {
        name,
        body,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        spaceId: scope || null,
        ...(selected
          ? {
              version: selected.version,
              ...(archive !== undefined ? { archived: archive } : {}),
            }
          : {}),
      };
      const item = selected
        ? await api<EditorSnippet>(`editor-snippets/${selected.id}`, {
            method: "PATCH",
            body: JSON.stringify(input),
          })
        : await post<EditorSnippet>("editor-snippets", input);
      select(item);
      data.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Research snippets"
      subtitle="Reusable Markdown · personal by default · insertions are independent copies"
      onClose={onClose}
      className="media-insert-dialog"
      size="wide"
    >
      <ErrorNotice message={error || data.error} />
      <div className="media-insert-split">
        <section className="media-library">
          <div className="media-library-controls">
            <TextInput
              aria-label="Search snippets"
              placeholder="Search saved snippets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="media-filter-row">
              <Button
                className="button secondary"
                onClick={() => {
                  setSelected(null);
                  setName("New research snippet");
                  setBody(selection);
                  setScope("");
                  setTags("");
                }}
              >
                <Plus size={15} />
                New
              </Button>
              <label className="media-check-label">
                <Checkbox
                  checked={archived}
                  onChange={(e) => {
                    setArchived(e.target.checked);
                    setPage(0);
                  }}
                />
                Archived
              </label>
            </div>
          </div>
          <div className="media-results">
            {!archived && (
              <>
                <h4>Built-in templates</h4>
                {templates
                  .filter(
                    (item) =>
                      item.body &&
                      item.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((item) => (
                    <button
                      className="snippet-item"
                      key={item.id}
                      onClick={() => {
                        setSelected(null);
                        setName(item.name + " copy");
                        setBody(item.body);
                        setScope("");
                        setTags("");
                      }}
                    >
                      <strong>{item.name}</strong>
                      <small>{item.description}</small>
                    </button>
                  ))}
              </>
            )}
            <h4>Your library</h4>
            {data.data?.items
              .filter((item) =>
                (item.name + " " + item.tags.join(" "))
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((item) => (
                <button
                  className="snippet-item"
                  key={item.id}
                  onClick={() => select(item)}
                >
                  <strong>{item.name}</strong>
                  <small>
                    {item.space_id ? "Workspace" : "Personal"} · revision{" "}
                    {item.version}
                    {item.archived ? " · archived" : ""}
                  </small>
                </button>
              ))}
            {data.data?.nextOffset !== null &&
              data.data?.nextOffset !== undefined && (
                <button onClick={() => setPage(data.data!.nextOffset!)}>
                  Next page
                </button>
              )}
            {page > 0 && (
              <button onClick={() => setPage(Math.max(0, page - 50))}>
                Previous page
              </button>
            )}
          </div>
        </section>
        <section className="media-preview-panel">
          <div className="media-options">
            <label>
              Name
              <TextInput
                value={name}
                maxLength={160}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="media-options-pair">
              <label>
                Visibility
                <NativeSelect
                  value={scope}
                  disabled={!!selected}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="">Only me</option>
                  {spaces
                    .filter((s) => s.id === spaceId && s.role === "editor")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </NativeSelect>
              </label>
              <label>
                Tags
                <TextInput
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="Comma-separated"
                />
              </label>
            </div>
            {scope && (
              <p className="ws-small muted">
                Saving here shares this content with workspace readers.
                Attachments must belong to this workspace.
              </p>
            )}
            <label>
              Markdown
              <TextArea
                aria-label="Markdown"
                className="snippet-source"
                rows={10}
                maxLength={100000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
          </div>
          <details className="media-research" open>
            <summary>Preview</summary>
            <ReadingView
              source={body}
              parsed={parsed}
              context={{ disableImages: true }}
              onLink={() => {}}
            />
          </details>
        </section>
      </div>
      <DialogFooter>
        {selected && (
          <>
            <Button
              className="button secondary"
              onClick={() => {
                setSelected(null);
                setName(name + " copy");
                setScope("");
              }}
            >
              <Copy size={14} />
              Duplicate
            </Button>
            <Button
              className="button secondary"
              disabled={busy}
              onClick={() => void save(!selected.archived)}
            >
              {selected.archived ? (
                <RotateCcw size={14} />
              ) : (
                <Archive size={14} />
              )}
              {selected.archived ? "Restore" : "Archive"}
            </Button>
          </>
        )}
        <span className="tool-spacer" />
        {sharingPersonal && (
          <label className="media-check-label">
            <Checkbox
              checked={shareCopy}
              onChange={(event) => setShareCopy(event.target.checked)}
            />
            Share a copy in this workspace
          </label>
        )}
        <Button
          className="button secondary"
          disabled={busy || !name.trim() || !body.trim()}
          onClick={() => void save()}
        >
          Save snippet
        </Button>
        <Button
          className="button primary"
          disabled={
            !body ||
            busy ||
            !!selected?.archived ||
            (sharingPersonal && !shareCopy)
          }
          onClick={() => {
            if (onInsert(body) !== false) onClose();
            else
              setError(
                "The insertion position changed. Reopen the snippet library at a new cursor location.",
              );
          }}
        >
          Insert copy
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
