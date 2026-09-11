"use client";
import { useEffect, useRef, useState } from "react";
import { Link2, Plus, Users, Mail } from "lucide-react";
import { invitationToken } from "@axiom/shared/invitation-input";
import { post } from "../../lib/client";
import { pendingInvitation } from "../../lib/pending-invitation";
import Dialog from "../Dialog";
import {
  Badge,
  Empty,
  ErrorNotice,
  Loading,
  PageHeading,
  useAction,
  useData,
  useWorkspace,
  WorkspaceLink,
} from "./ui";

type Invitation = {
  id: string;
  group_id: string;
  group_name: string;
  description: string;
  email: string;
  role: string;
  content_role: string;
  expires_at: string;
  already_joined: boolean;
};
export default function GroupsHub() {
  const { session, revision, refresh, refreshSession, navigate, notify } =
    useWorkspace();
  const invitations = useData<Invitation[]>("group-invitations", revision);
  const [creating, setCreating] = useState(false),
    [joining, setJoining] = useState(!!pendingInvitation());
  const [search, setSearch] = useState(""),
    [leave, setLeave] = useState<(typeof session.groups)[number] | null>(null),
    [confirmation, setConfirmation] = useState("");
  const action = useAction();
  const changed = async () => {
    if (refreshSession) await refreshSession();
    else window.dispatchEvent(new Event("axiom:session"));
    refresh();
    invitations.reload();
  };
  const respond = (invite: Invitation, decline: boolean) =>
    void action.run(async () => {
      if (!invite.already_joined || decline)
        await post(
          `group-invitations/${invite.id}/${decline ? "decline" : "accept"}`,
        );
      await changed();
      notify(
        decline
          ? "Invitation declined."
          : `You are a member of ${invite.group_name}.`,
      );
      if (!decline) navigate(`/people?groupId=${invite.group_id}`);
    });
  const groups = session.groups.filter((g) =>
    `${g.name} ${g.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <main className="ws-page groups-hub">
      <PageHeading eyebrow="RESEARCH COMMUNITY" title="Your groups">
        Private places for shared research. Your personal workspace always
        remains yours.
      </PageHeading>
      <div className="workspace-action-row">
        <input
          aria-label="Search your groups"
          placeholder="Find a group…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="button secondary" onClick={() => setJoining(true)}>
          <Link2 size={16} />
          Join with invitation
        </button>
        <button className="button primary" onClick={() => setCreating(true)}>
          <Plus size={16} />
          Create group
        </button>
      </div>
      <ErrorNotice
        message={action.error || invitations.error}
        retry={invitations.error ? invitations.reload : undefined}
      />
      {invitations.loading && !invitations.data && (
        <Loading label="Checking invitations…" />
      )}
      {!!invitations.data?.length && (
        <section
          className="group-invitations"
          aria-label="Pending group invitations"
        >
          <h2>
            <Mail size={18} />
            Invitations for you
          </h2>
          <p className="muted">
            Sent to {session.user.email}. Joining never shares your personal
            files.
          </p>
          {invitations.data.map((invite) => (
            <div className="group-invitation-row" key={invite.id}>
              <div>
                <strong>{invite.group_name}</strong>
                <p>{invite.description || "A private research group"}</p>
                <small>
                  {invite.content_role} access · expires{" "}
                  {new Date(invite.expires_at).toLocaleDateString()}
                </small>
              </div>
              <div className="ws-actions">
                <button
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() => respond(invite, true)}
                >
                  Decline
                </button>
                <button
                  className="button primary"
                  disabled={action.busy}
                  onClick={() => respond(invite, false)}
                >
                  {invite.already_joined ? "Open group" : "Accept invitation"}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      {!groups.length ? (
        <Empty
          icon={Users}
          title={search ? "No matching groups" : "A shared space starts here"}
        >
          {search
            ? "Try a different name."
            : "Create a group or accept an invitation to begin collaborating."}
        </Empty>
      ) : (
        <div className="group-card-grid">
          {groups.map((group) => (
            <section className="group-membership-card" key={group.id}>
              <div className="group-card-heading">
                <Users size={22} />
                <Badge>{group.role}</Badge>
              </div>
              <h2>{group.name}</h2>
              <p>
                {group.description ||
                  "A private home for your group’s research."}
              </p>
              <div className="group-card-actions">
                <WorkspaceLink
                  className="button secondary"
                  to={`/people?groupId=${group.id}`}
                >
                  Members
                </WorkspaceLink>
                {group.role !== "member" && (
                  <WorkspaceLink
                    className="button secondary"
                    to={`/admin/${group.id}/overview`}
                  >
                    Manage group
                  </WorkspaceLink>
                )}
                <button
                  className="text-button"
                  onClick={() => {
                    setLeave(group);
                    setConfirmation("");
                  }}
                >
                  Leave…
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
      {creating && (
        <CreateGroupDialog
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            await changed();
            setCreating(false);
            navigate(`/admin/${id}/overview`);
          }}
        />
      )}
      {joining && (
        <JoinGroupDialog
          onClose={() => {
            pendingInvitation("");
            setJoining(false);
          }}
          onJoined={async (id) => {
            pendingInvitation("");
            await changed();
            setJoining(false);
            navigate(`/people?groupId=${id}`);
            notify("Group membership is ready.");
          }}
        />
      )}
      {leave && (
        <Dialog
          title={`Leave ${leave.name}?`}
          onClose={() => !action.busy && setLeave(null)}
        >
          <p>
            Shared group and project access will end. Your personal workspace,
            notes, and account stay yours.
          </p>
          {leave.role === "owner" ? (
            <p className="ws-note">
              Transfer group ownership before leaving. The last project lead
              must also appoint a replacement.
            </p>
          ) : (
            <label>
              Type the group name
              <input
                aria-label="Confirm group departure"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
          )}
          <ErrorNotice message={action.error} />
          <div className="dialog-footer">
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={() => setLeave(null)}
            >
              Cancel
            </button>
            {leave.role === "owner" ? (
              <button
                className="button primary"
                onClick={() => navigate(`/admin/${leave.id}/members`)}
              >
                Transfer ownership
              </button>
            ) : (
              <button
                className="button danger"
                disabled={action.busy || confirmation !== leave.name}
                onClick={() =>
                  void action.run(async () => {
                    await post(`group-admin/${leave.id}/leave`);
                    await changed();
                    setLeave(null);
                  })
                }
              >
                Leave group
              </button>
            )}
          </div>
        </Dialog>
      )}
    </main>
  );
}

export function CreateGroupDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void> | void;
}) {
  const [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const identity = useRef({ key: "", id: "" });
  const action = useAction();
  return (
    <Dialog
      title="Create a research group"
      onClose={() => !action.busy && onClose()}
      size="compact"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const input = {
              name: name.trim(),
              description: description.trim(),
            };
            const key = JSON.stringify(input);
            if (identity.current.key !== key)
              identity.current = { key, id: crypto.randomUUID() };
            const group = await post("groups", {
              ...input,
              mutationId: identity.current.id,
            });
            await onCreated(group.id);
          });
        }}
      >
        <p className="muted">
          You will own this private group. Invite collaborators after creating
          it.
        </p>
        <label>
          Group name
          <input
            autoFocus
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Research group name"
          />
        </label>
        <label>
          Description <span className="muted">(optional)</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <ErrorNotice message={action.error} />
        <div className="dialog-footer">
          <button
            type="button"
            className="button secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={action.busy || !name.trim()}
          >
            {action.busy ? "Creating…" : "Create group"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function JoinGroupDialog({
  onClose,
  onJoined,
}: {
  onClose: () => void;
  onJoined: (id: string) => Promise<void>;
}) {
  const [value, setValue] = useState(pendingInvitation()),
    [invite, setInvite] = useState<Invitation | null>(null);
  const action = useAction();
  const inspect = async () => {
    const token = invitationToken(value, location.origin);
    if (!token)
      throw new Error(
        "Paste an invitation token or a link from this Axiom server.",
      );
    setInvite(await post("group-invitations/inspect", { token }));
  };
  useEffect(() => {
    if (pendingInvitation()) void action.run(inspect);
  }, []);
  return (
    <Dialog
      title="Join a research group"
      onClose={() => !action.busy && onClose()}
      size="compact"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(inspect);
        }}
      >
        <p className="muted">
          Invitations are private and tied to your account email. Preview the
          group before joining.
        </p>
        <label>
          Invitation link or token
          <input
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setInvite(null);
            }}
          />
        </label>
        <ErrorNotice message={action.error} />
        {invite && (
          <section className="group-invitation-preview">
            <h3>{invite.group_name}</h3>
            <p>{invite.description || "A private research workspace"}</p>
            <p>
              {invite.email} · {invite.content_role} access
            </p>
            <small>Your personal notes and files remain private.</small>
          </section>
        )}
        <div className="dialog-footer">
          <button
            type="button"
            className="button secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            Cancel
          </button>
          {invite ? (
            <button
              type="button"
              className="button primary"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  if (!invite.already_joined)
                    await post(`group-invitations/${invite.id}/accept`);
                  await onJoined(invite.group_id);
                })
              }
            >
              {invite.already_joined ? "Open group" : "Accept invitation"}
            </button>
          ) : (
            <button
              className="button primary"
              disabled={action.busy || !value.trim()}
            >
              {action.busy ? "Checking…" : "Preview invitation"}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
