"use client";
import { useMemo } from "react";
import type { Resource } from "@axiom/shared/workspace";
import { parseMarkdown } from "@axiom/markdown";
import Dialog from "../Dialog";
import ReadingView from "../ReadingView";
import FilePreviewSurface from "../tools/FilePreviewSurface";
import { ErrorNotice, Loading, useData, useWorkspace } from "./ui";
export default function FileQuickPreview({
  resource,
  onClose,
}: {
  resource: Resource;
  onClose: () => void;
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
      size="wide"
    >
      <ErrorNotice message={note.error} />
      <div className="file-quick-preview">
        {resource.kind === "note" ? (
          note.loading ? (
            <Loading />
          ) : (
            <ReadingView parsed={parsed} context={{}} onLink={() => {}} />
          )
        ) : resource.kind === "folder" || resource.kind === "shortcut" ? (
          <p>Open this {resource.kind} to explore its contents.</p>
        ) : (
          <FilePreviewSurface resourceId={resource.id} versionId={resource.current_version_id} compact />
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
