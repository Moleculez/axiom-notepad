"use client";
import { useMemo } from "react";
import type { Resource } from "@axiom/shared/workspace";
import { parseMarkdown } from "@axiom/markdown";
import { fileVisuals } from "../../lib/visual-assets";
import Dialog from "../Dialog";
import ReadingView from "../ReadingView";
import FilePreviewSurface from "../tools/FilePreviewSurface";
import { ErrorNotice, Loading, useData, useWorkspace } from "./ui";
export default function FileQuickPreview({
  resource,
  onClose,
  gallery = [],
}: {
  resource: Resource;
  onClose: () => void;
  gallery?: Resource[];
}) {
  const { open } = useWorkspace();
  const note = useData<{ body: string }>(
    resource.kind === "note" ? `notes/${resource.id}` : null,
  );
  const parsed = useMemo(
    () => parseMarkdown(note.data?.body || ""),
    [note.data?.body],
  );
  return (
    <Dialog
      title={resource.name}
      subtitle="Quick preview · originals and permissions remain unchanged"
      onClose={onClose}
      returnFocus={() =>
        document.querySelector<HTMLElement>(
          `.ws-resource-row[data-resource-id="${CSS.escape(resource.id)}"]`,
        )
      }
      size="wide"
    >
      <ErrorNotice message={note.error} />
      <div className="file-quick-preview">
        {resource.kind === "note" ? (
          note.loading && !note.data ? (
            <Loading />
          ) : (
            <ReadingView
              source={note.data?.body || ""}
              parsed={parsed}
              context={{}}
              onLink={() => {}}
            />
          )
        ) : resource.kind === "folder" || resource.kind === "shortcut" ? (
          <p>Open this {resource.kind} to explore its contents.</p>
        ) : (
          <FilePreviewSurface
            resourceId={resource.id}
            versionId={resource.current_version_id}
            visualGallery={fileVisuals(gallery)}
            compact
          />
        )}
      </div>
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Close preview
        </button>
        <button
          className="button primary"
          onClick={() => {
            onClose();
            open(resource);
          }}
        >
          Open item
        </button>
      </div>
    </Dialog>
  );
}
