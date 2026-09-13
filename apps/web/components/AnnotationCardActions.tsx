"use client";
import { Check, MoreHorizontal, Pencil, Share2 } from "lucide-react";
import type { NoteComment } from "@axiom/shared/note-comments";
import { openContextMenu } from "../lib/context-menu";

/** Keep the frequently used actions visible; location, copying and removal
 * belong in a keyboard-accessible menu rather than a second row of icons. */
export default function AnnotationCardActions({
  entry,
  own,
  canComment,
  pending,
  busy,
  onEdit,
  onShare,
  onResolve,
  onReattach,
  onCopy,
  onRemove,
  onReply,
}: {
  entry: NoteComment;
  own: boolean;
  canComment: boolean;
  pending: boolean;
  busy: boolean;
  onEdit: () => void;
  onShare: () => void;
  onResolve: () => void;
  onReattach: () => void;
  onCopy: () => void;
  onRemove: () => void;
  onReply: () => void;
}) {
  return (
    <footer className="annotation-actions">
      {own && (
        <>
          <button
            className="icon-button"
            aria-label="Edit annotation"
            title="Edit annotation"
            disabled={busy}
            onClick={onEdit}
          >
            <Pencil size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={
              entry.visibility === "private"
                ? "Share annotation"
                : "Make annotation private"
            }
            title={
              entry.visibility === "private"
                ? "Share with document readers"
                : "Make private (before others reply)"
            }
            disabled={busy || !canComment || pending}
            onClick={onShare}
          >
            <Share2 size={15} />
          </button>
        </>
      )}
      {(entry.visibility === "private" || canComment) && (
        <button
          className="icon-button"
          aria-label={
            entry.resolved ? "Reopen annotation" : "Resolve annotation"
          }
          title={entry.resolved ? "Reopen" : "Resolve"}
          disabled={busy}
          onClick={onResolve}
        >
          <Check size={15} />
        </button>
      )}
      <button
        className="icon-button"
        aria-label="More annotation actions"
        title="More actions"
        disabled={busy}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          openContextMenu({
            owner: event.currentTarget,
            x: box.right,
            y: box.bottom,
            label: "Annotation actions",
            items: [
              ...(own
                ? [
                    {
                      label: "Reattach annotation",
                      icon: "link" as const,
                      group: "location",
                      action: onReattach,
                    },
                  ]
                : []),
              {
                label: "Copy annotation privately",
                icon: "copy",
                group: "copy",
                action: onCopy,
              },
              ...(own
                ? [
                    {
                      label: "Delete annotation",
                      icon: "trash" as const,
                      group: "remove",
                      tone: "danger" as const,
                      action: onRemove,
                    },
                  ]
                : []),
            ],
          });
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      {entry.visibility === "shared" && canComment && (
        <button
          className="text-button annotation-reply-action"
          disabled={busy}
          onClick={onReply}
        >
          Reply
        </button>
      )}
    </footer>
  );
}
