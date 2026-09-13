"use client";
import { useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { Note } from "@axiom/shared/access";
import type { ResourcePage, Space } from "@axiom/shared/workspace";
import Dialog from "../Dialog";
import { bytes, ErrorNotice, ResourceIcon, useData, useWorkspace } from "./ui";
export default function InsertResource({
  kind,
  note,
  space,
  onClose,
  onInsert,
}: {
  kind: "file" | "note";
  note: Pick<Note, "id" | "visibility">;
  space?: Space;
  onClose: () => void;
  onInsert: (value: string) => void;
}) {
  const { revision, upload, refresh } = useWorkspace(),
    [search, setSearch] = useState(""),
    data = useData<ResourcePage>(
      `resources?kind=${kind}&view=all&limit=60&q=${encodeURIComponent(search)}${note.visibility === "shared" && space ? "&spaceId=" + space.id : ""}`,
      revision,
    ),
    input = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      title={
        kind === "file"
          ? "Insert a file from Explorer"
          : "Link another research note"
      }
      onClose={onClose}
      wide
    >
      <label className="ws-search-field">
        <Search size={17} />
        <input
          autoFocus
          aria-label={`Find ${kind}`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${kind === "file" ? "files" : "notes"}…`}
        />
      </label>
      <p className="ws-small muted">
        {kind === "file"
          ? "File embeds pin the current immutable version. Uploading a later version won’t silently change this note."
          : "Note links use stable identifiers, so renaming a note keeps the connection intact."}
        {note.visibility === "shared" &&
          " Only this shared space is offered to avoid linking inaccessible personal work."}
      </p>
      <ErrorNotice message={data.error} retry={data.reload} />
      <div className="ws-search-results">
        {data.data?.items
          .filter((item) => item.id !== note.id)
          .map((item) => (
            <button
              key={item.id}
              onClick={() =>
                onInsert(
                  kind === "note"
                    ? `[[${item.id}|${item.name.replace(/[\[\]|]/g, "")}]]`
                    : `${item.mime?.startsWith("image/") ? "!" : ""}[${item.name.replace(/[\[\]\\]/g, "\\$&")}](/api/v1/attachments/${item.current_version_id})`,
                )
              }
            >
              <ResourceIcon resource={item} />
              <span>
                <strong>{item.name}</strong>
                <small>
                  {kind === "file" ? bytes(item.bytes) : "Research note"}
                </small>
              </span>
              <Plus size={15} />
            </button>
          ))}
      </div>
      {kind === "file" && space?.role === "editor" && (
        <div className="ws-actions">
          <button
            className="button secondary"
            onClick={() => input.current?.click()}
          >
            Upload to this space
          </button>
          <button
            className="button secondary"
            onClick={() => {
              data.reload();
              refresh();
            }}
          >
            Refresh ready files
          </button>
          <input
            ref={input}
            hidden
            type="file"
            multiple
            onChange={(event) => {
              upload(Array.from(event.target.files ?? []), space.id);
              event.target.value = "";
            }}
          />
        </div>
      )}
    </Dialog>
  );
}
