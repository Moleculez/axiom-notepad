"use client";
import { currentLocale } from "@axiom/i18n/client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  ActionRow,
  Button,
  HelpText,
  TextInput,
  TextArea,
} from "../ui/controls";
import { useEffect, useRef, useState } from "react";
import { Link2, Plus, Users, Mail } from "lucide-react";
import { invitationToken } from "@axiom/shared/invitation-input";
import { post } from "../../lib/client";
import { accessRoleLabel } from "../../lib/interface-labels";
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
export default function GroupsHub({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { t } = useInterfaceLocale();
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
          ? t("Invitation declined.")
          : t("You are a member of {group}.", { group: invite.group_name }),
      );
      if (!decline && !embedded) navigate(`/people?groupId=${invite.group_id}`);
    });
  const groups = session.groups.filter((g) =>
    `${g.name} ${g.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  const Container = embedded ? "section" : "main";
  return (
    <Container className={embedded ? "groups-hub" : "ws-page groups-hub"}>
      {!embedded && (
        <PageHeading eyebrow="RESEARCH COMMUNITY" title={uiText("Your groups")}>
          <I18nText id="Private places for shared research. Your personal workspace always remains yours." />
        </PageHeading>
      )}
      <ActionRow className="workspace-action-row" size="standard">
        <TextInput
          aria-label={uiText("Search your groups")}
          placeholder={uiText("Find a group…")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button className="button secondary" onClick={() => setJoining(true)}>
          <Link2 size={16} />
          <I18nText id="Join with invitation" />
        </Button>
        <Button className="button primary" onClick={() => setCreating(true)}>
          <Plus size={16} />
          <I18nText id="Create group" />
        </Button>
      </ActionRow>
      <ErrorNotice
        message={action.error || invitations.error}
        retry={invitations.error ? invitations.reload : undefined}
      />
      {invitations.loading && !invitations.data && (
        <Loading label={uiText("Checking invitations…")} />
      )}
      {!!invitations.data?.length && (
        <section
          className="group-invitations"
          aria-label={uiText("Pending group invitations")}
        >
          <h2>
            <Mail size={18} />
            <I18nText id="Invitations for you" />
          </h2>
          <p className="muted">
            <I18nText
              id="Sent to {email}. Joining never shares your personal files."
              slots={{ email: <bdi>{session.user.email}</bdi> }}
            />
          </p>
          {invitations.data.map((invite) => (
            <div className="group-invitation-row" key={invite.id}>
              <div>
                <strong>
                  <bdi>{invite.group_name}</bdi>
                </strong>
                <p>
                  {invite.description || uiText("A private research group")}
                </p>
                <small>
                  <I18nText
                    id="{role} access · expires {date}"
                    values={{ role: accessRoleLabel(invite.content_role) }}
                    slots={{
                      date: (
                        <time dateTime={invite.expires_at}>
                          {new Date(invite.expires_at).toLocaleDateString(
                            currentLocale(),
                          )}
                        </time>
                      ),
                    }}
                  />
                </small>
              </div>
              <ActionRow>
                <Button
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() => respond(invite, true)}
                >
                  <I18nText id="Decline" />
                </Button>
                <Button
                  className="button primary"
                  disabled={action.busy}
                  onClick={() => respond(invite, false)}
                >
                  {invite.already_joined
                    ? uiText("Open group")
                    : uiText("Accept invitation")}
                </Button>
              </ActionRow>
            </div>
          ))}
        </section>
      )}
      {!groups.length ? (
        <Empty
          icon={Users}
          title={
            search
              ? uiText("No matching groups")
              : uiText("A shared space starts here")
          }
        >
          {search
            ? uiText("Try a different name.")
            : uiText(
                "Create a group or accept an invitation to begin collaborating.",
              )}
        </Empty>
      ) : (
        <div className="group-card-grid">
          {groups.map((group) => (
            <section className="group-membership-card" key={group.id}>
              <div className="group-card-heading">
                <Users size={22} />
                <Badge>{accessRoleLabel(group.role)}</Badge>
              </div>
              <h2>
                <bdi>{group.name}</bdi>
              </h2>
              <p>
                {group.description ||
                  uiText("A private home for your group’s research.")}
              </p>
              <div className="group-card-actions">
                <WorkspaceLink
                  className="button secondary"
                  to={`/groups/${group.id}/planning`}
                >
                  <I18nText id="Planning" />
                </WorkspaceLink>
                <WorkspaceLink
                  className="button secondary"
                  to={`/people?groupId=${group.id}`}
                >
                  <I18nText id="Members" />
                </WorkspaceLink>
                {group.role !== "member" && (
                  <WorkspaceLink
                    className="button secondary"
                    to={`/admin/${group.id}/overview`}
                  >
                    <I18nText id="Manage group" />
                  </WorkspaceLink>
                )}
                <button
                  className="text-button"
                  onClick={() => {
                    setLeave(group);
                    setConfirmation("");
                  }}
                >
                  <I18nText id="Leave…" />
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
            if (embedded)
              notify(
                t(
                  "Group created. You can invite collaborators from Manage group.",
                ),
              );
            else navigate(`/admin/${id}/overview`);
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
            if (!embedded) navigate(`/people?groupId=${id}`);
            notify(t("Group membership is ready."));
          }}
        />
      )}
      {leave && (
        <Dialog
          title={t("Leave {group}?", { group: leave.name })}
          onClose={() => !action.busy && setLeave(null)}
        >
          <p>
            <I18nText id="Shared group and project access will end. Your personal workspace, notes, and account stay yours." />
          </p>
          {leave.role === "owner" ? (
            <HelpText>
              <I18nText id="Transfer group ownership before leaving. The last project lead must also appoint a replacement." />
            </HelpText>
          ) : (
            <label>
              <I18nText id="Type the group name" />
              <TextInput
                aria-label={uiText("Confirm group departure")}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
          )}
          <ErrorNotice message={action.error} />
          <div className="dialog-footer">
            <Button
              data-dialog-cancel
              className="button secondary"
              disabled={action.busy}
              onClick={() => setLeave(null)}
            >
              <I18nText id="Cancel" />
            </Button>
            {leave.role === "owner" ? (
              <Button
                className="button primary"
                onClick={() => navigate(`/admin/${leave.id}/members`)}
              >
                <I18nText id="Transfer ownership" />
              </Button>
            ) : (
              <Button
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
                <I18nText id="Leave group" />
              </Button>
            )}
          </div>
        </Dialog>
      )}
    </Container>
  );
}

export function CreateGroupDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void> | void;
}) {
  useInterfaceLocale();
  const [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const identity = useRef({ key: "", id: "" });
  const action = useAction();
  return (
    <Dialog
      title={uiText("Create a research group")}
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
          <I18nText id="You will own this private group. Invite collaborators after creating it." />
        </p>
        <label>
          <I18nText id="Group name" />
          <TextInput
            autoFocus
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={uiText("Research group name")}
          />
        </label>
        <label>
          <I18nText id="Description" />{" "}
          <span className="muted">
            <I18nText id="(optional)" />
          </span>
          <TextArea
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <ErrorNotice message={action.error} />
        <div className="dialog-footer">
          <Button
            data-dialog-cancel
            type="button"
            className="button secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            <I18nText id="Cancel" />
          </Button>
          <Button
            className="button primary"
            disabled={action.busy || !name.trim()}
            pending={!!action.busy}
          >
            {uiText("Create group")}
          </Button>
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
  useInterfaceLocale();
  const [value, setValue] = useState(pendingInvitation()),
    [invite, setInvite] = useState<Invitation | null>(null);
  const action = useAction();
  const inspect = async () => {
    const token = invitationToken(value, location.origin);
    if (!token)
      throw new Error(
        uiText("Paste an invitation token or a link from this Axiom server."),
      );
    setInvite(await post("group-invitations/inspect", { token }));
  };
  useEffect(() => {
    if (pendingInvitation()) void action.run(inspect);
  }, []);
  return (
    <Dialog
      title={uiText("Join a research group")}
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
          <I18nText id="Invitations are private and tied to your account email. Preview the group before joining." />
        </p>
        <label>
          <I18nText id="Invitation link or token" />
          <TextInput
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
            <h3>
              <bdi>{invite.group_name}</bdi>
            </h3>
            <p>
              {invite.description || uiText("A private research workspace")}
            </p>
            <p>
              <I18nText
                id="{email} · {role} access"
                values={{ role: accessRoleLabel(invite.content_role) }}
                slots={{ email: <bdi>{invite.email}</bdi> }}
              />
            </p>
            <small>
              <I18nText id="Your personal notes and files remain private." />
            </small>
          </section>
        )}
        <div className="dialog-footer">
          <Button
            data-dialog-cancel
            type="button"
            className="button secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            <I18nText id="Cancel" />
          </Button>
          {invite ? (
            <Button
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
              {invite.already_joined
                ? uiText("Open group")
                : uiText("Accept invitation")}
            </Button>
          ) : (
            <Button
              className="button primary"
              disabled={action.busy || !value.trim()}
              pending={!!action.busy}
            >
              {uiText("Preview invitation")}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
