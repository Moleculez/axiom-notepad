"use client";
import { useState } from "react";
import { Copy, LockKeyhole, Users } from "lucide-react";
import type { Space } from "@axiom/shared/workspace";
import Dialog from "../Dialog";
import { Badge, useWorkspace } from "./ui";

export type NoteMember = {
  id: string;
  name: string;
  role: "editor" | "commenter" | "viewer";
  group_role?: string;
};
export default function NoteSharing({
  noteId,
  space,
  members,
}: {
  noteId: string;
  space?: Space;
  members: NoteMember[];
}) {
  const [open, setOpen] = useState(false),
    [status, setStatus] = useState("");
  const { navigate, session } = useWorkspace();
  const personal = space?.kind === "personal";
  return (
    <>
      <button
        className="button secondary ws-share-button"
        onClick={() => {
          setOpen(true);
          setStatus("");
        }}
      >
        <Users size={15} />
        Share
      </button>
      {open && (
        <Dialog
          title="Sharing & collaboration"
          subtitle="Access follows the space containing this note."
          onClose={() => setOpen(false)}
        >
          <div className="ws-sharing-summary">
            {personal ? <LockKeyhole size={22} /> : <Users size={22} />}
            <div>
              <strong>
                {personal ? "Only you" : (space?.name ?? "Loading access…")}
              </strong>
              <p>
                {personal
                  ? "This is a private note. Copying its link does not grant anyone access."
                  : "Authorized members can open this link after signing in. Their space role determines whether they can edit, comment, or read."}
              </p>
            </div>
          </div>
          {!personal && (
            <ul className="ws-sharing-members" aria-label="People with access">
              {members.map((member) => (
                <li key={member.id}>
                  <span>
                    {member.name}
                    {member.id === session.user.id ? " (you)" : ""}
                  </span>
                  <Badge>{member.role}</Badge>
                </li>
              ))}
            </ul>
          )}
          {!personal && members.length === 200 && (
            <p className="muted">
              Showing the first 200 members. Manage the space to view its full
              membership.
            </p>
          )}
          <p className="ws-note">
            Live editing, presence and comments use the same permissions. A link
            never makes this note public.
          </p>
          <div className="dialog-footer">
            {space?.can_manage && !personal && (
              <button
                className="button secondary"
                onClick={() => {
                  setOpen(false);
                  navigate(
                    space.project_id
                      ? `/projects/${space.project_id}/members`
                      : `/admin/${space.group_id}`,
                  );
                }}
              >
                Manage {space.project_id ? "project" : "group"} access
              </button>
            )}
            <button
              className="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(`${location.origin}/workbench/notes/${noteId}`)
                  .then(
                    () =>
                      setStatus("Link copied. Existing access is unchanged."),
                    () =>
                      setStatus(
                        "Clipboard permission was denied. Copy the address from your browser.",
                      ),
                  );
              }}
            >
              <Copy size={15} />
              Copy note link
            </button>
          </div>
          <p role="status" className="muted">
            {status}
          </p>
        </Dialog>
      )}
    </>
  );
}
