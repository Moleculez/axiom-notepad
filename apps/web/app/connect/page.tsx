"use client";
import { useEffect, useState } from "react";
import {
  ShieldCheck,
  Folders,
  KeyRound,
  UserRound,
  Clock3,
} from "lucide-react";
import Auth from "../../components/Auth";
import BrandMark from "../../components/BrandMark";
import { api, post, authRequest } from "../../lib/client";
import {
  ErrorNotice,
  Loading,
  type Session,
} from "../../components/workspace/ui";
import type { Space } from "@axiom/shared/workspace";
import {
  ActionRow,
  Button,
  Checkbox,
  HelpText,
  Notice,
  SearchField,
} from "../../components/ui/controls";

const permissions = [
  {
    scope: "workspace:read",
    title: "Read files and research",
    description:
      "Read notes, files, references, and research in selected workspaces.",
  },
  {
    scope: "workspace:write",
    title: "Create and edit content",
    description:
      "Request new files and content changes in selected workspaces.",
  },
  {
    scope: "workspace:manage",
    title: "Manage groups and workspaces",
    description: "Request workspace, group, and access-management operations.",
  },
] as const;

const roleLabels = {
  viewer: "Can view",
  commenter: "Can comment",
  editor: "Can edit",
};
const kindLabels = {
  personal: "Personal workspace",
  team: "Team workspace",
  project: "Project workspace",
};

export default function ConnectPage() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [spaces, setSpaces] = useState<Space[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [scopes, setScopes] = useState<string[]>(["workspace:read"]),
    [requestedScopes, setRequestedScopes] = useState<string[]>([]),
    [client, setClient] = useState<{
      name: string;
      client_id: string;
      uri?: string;
    } | null>(null),
    [error, setError] = useState(""),
    [decision, setDecision] = useState<"allow" | "deny" | null>(null);
  const busy = decision !== null;
  const load = async () => {
    setLoading(true);
    try {
      const session = await api<Session>("me");
      setSession(session);
      setSpaces(await api<Space[]>("spaces"));
      const params = new URLSearchParams(location.search);
      setClient(
        await api(
          `connections/client?id=${encodeURIComponent(params.get("client_id") ?? "")}`,
        ),
      );
      const requested = (params.get("scope") ?? "workspace:read")
        .split(" ")
        .filter(Boolean);
      setRequestedScopes(requested);
      setScopes(requested.filter((s) => s.startsWith("workspace:")));
    } catch (e) {
      if ((e as { status?: number }).status !== 401)
        setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  if (loading) return <Loading label="Checking connection request…" />;
  if (!session) return <Auth onSignedIn={() => void load()} />;
  const decide = async (accept: boolean) => {
    if (busy) return;
    setDecision(accept ? "allow" : "deny");
    setError("");
    try {
      if (accept) {
        if (!client || !selected.length)
          throw new Error("Choose at least one workspace.");
        await post("connections/consent", {
          clientId: client.client_id,
          spaceIds: selected,
          scopes,
        });
      }
      const result = await authRequest("oauth2/consent", {
        accept,
        scope: [
          ...scopes,
          ...(requestedScopes.includes("openid") ? ["openid"] : []),
          ...(requestedScopes.includes("offline_access")
            ? ["offline_access"]
            : []),
        ].join(" "),
        oauth_query: location.search.slice(1),
      });
      if (result.url) location.assign(result.url);
      else
        throw new Error(
          "Authorization could not continue. Restart the connection from your client.",
        );
    } catch (e) {
      setError((e as Error).message);
      setDecision(null);
    }
  };
  const availableSpaces = spaces.filter((space) => space.role);
  const visibleSpaces = availableSpaces.filter((space) =>
    space.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <main className="connection-consent interface-style-scope">
      <section
        className="connection-consent-panel interface-overlay"
        aria-labelledby="connection-title"
      >
        <header className="connection-consent-header interface-panel-band">
          <div className="connection-consent-brand">
            <BrandMark />
            <strong>Axiom</strong>
            <span>Application access</span>
          </div>
          <h1 id="connection-title">
            Connect {client?.name ?? "an application"}
          </h1>
          <HelpText>Choose what this application can access.</HelpText>
        </header>
        <div
          className="connection-consent-body"
          role="region"
          aria-label="Connection access details"
          tabIndex={0}
        >
          <dl className="connection-client-details">
            <div>
              <dt>Signed in as</dt>
              <dd>{session.user.email}</dd>
            </div>
            <div>
              <dt>Client identity</dt>
              <dd>
                <code>{client?.client_id ?? "Unavailable"}</code>
              </dd>
            </div>
            {client?.uri && (
              <div>
                <dt>Application website</dt>
                <dd>{client.uri}</dd>
              </div>
            )}
          </dl>
          <div className="connection-consent-grid">
            <fieldset className="connection-workspaces">
              <legend>
                <Folders aria-hidden="true" />
                Allowed workspaces
              </legend>
              <HelpText id="connection-workspace-help">
                Only the workspaces you select will be shared.
              </HelpText>
              <SearchField
                aria-label="Find a workspace to share"
                placeholder="Find a workspace…"
                value={search}
                disabled={busy}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch("")}
                clearLabel="Clear workspace search"
              />
              <div
                className="connection-space-list"
                role="region"
                aria-label="Available workspaces"
                tabIndex={0}
              >
                {visibleSpaces.map((space) => (
                  <label className="connection-choice" key={space.id}>
                    <Checkbox
                      aria-labelledby={`connection-space-${space.id}`}
                      aria-describedby={`connection-space-detail-${space.id}`}
                      disabled={busy}
                      checked={selected.includes(space.id)}
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, space.id]
                            : ids.filter((id) => id !== space.id),
                        )
                      }
                    />
                    <span className="connection-choice-copy">
                      <strong id={`connection-space-${space.id}`}>
                        {space.name}
                      </strong>
                      <small id={`connection-space-detail-${space.id}`}>
                        {kindLabels[space.kind]} · {roleLabels[space.role]}
                      </small>
                    </span>
                  </label>
                ))}
                {!visibleSpaces.length && (
                  <HelpText className="connection-space-empty" role="status">
                    {availableSpaces.length
                      ? "No matching workspaces. Try another search."
                      : "No accessible workspaces are available for this account."}
                  </HelpText>
                )}
              </div>
              <HelpText
                className="connection-selected-count"
                role="status"
                aria-live="polite"
              >
                {selected.length}{" "}
                {selected.length === 1 ? "workspace" : "workspaces"} selected
              </HelpText>
            </fieldset>
            <fieldset className="connection-permissions">
              <legend>
                <KeyRound aria-hidden="true" />
                Permissions
              </legend>
              <HelpText>Limit access to what you need.</HelpText>
              <div className="connection-permission-list">
                {permissions
                  .filter(({ scope }) => requestedScopes.includes(scope))
                  .map(({ scope, title, description }) => (
                    <label className="connection-choice" key={scope}>
                      <Checkbox
                        aria-labelledby={`connection-${scope}-title`}
                        aria-describedby={`connection-${scope}-help`}
                        disabled={busy || scope === "workspace:read"}
                        checked={scopes.includes(scope)}
                        onChange={(e) =>
                          setScopes((all) =>
                            e.target.checked
                              ? [...all, scope]
                              : all.filter((s) => s !== scope),
                          )
                        }
                      />
                      <span className="connection-choice-copy">
                        <span className="connection-choice-title">
                          <strong id={`connection-${scope}-title`}>
                            {title}
                          </strong>
                          {scope === "workspace:read" && (
                            <span className="connection-required">
                              Required
                            </span>
                          )}
                        </span>
                        <small id={`connection-${scope}-help`}>
                          {description}
                        </small>
                      </span>
                    </label>
                  ))}
              </div>
              {(requestedScopes.includes("openid") ||
                requestedScopes.includes("offline_access")) && (
                <ul
                  className="connection-session-access"
                  aria-label="Session access"
                >
                  {requestedScopes.includes("openid") && (
                    <li>
                      <UserRound aria-hidden="true" />
                      <span>Use your account identity to sign in.</span>
                    </li>
                  )}
                  {requestedScopes.includes("offline_access") && (
                    <li>
                      <Clock3 aria-hidden="true" />
                      <span>
                        Keep the connection available between sessions, until
                        you revoke it.
                      </span>
                    </li>
                  )}
                </ul>
              )}
            </fieldset>
          </div>
          <div className="connection-safeguard">
            <ShieldCheck aria-hidden="true" />
            <HelpText>
              Deletion, transfers, invitations, and permission changes still
              require approval in Axiom.
            </HelpText>
          </div>
        </div>
        <footer className="connection-consent-footer interface-panel-band">
          <Notice tone="warning">
            Only connect applications you trust. Selected content will be sent
            to this application.
          </Notice>
          <ErrorNotice message={error} />
          <div className="connection-consent-decision">
            <HelpText>
              Revoke access anytime in Settings → Connected apps.
            </HelpText>
            <ActionRow align="end" size="standard">
              <Button
                variant="secondary"
                disabled={busy}
                pending={decision === "deny"}
                onClick={() => void decide(false)}
              >
                Deny
              </Button>
              <Button
                variant="primary"
                disabled={busy || !client || !selected.length}
                pending={decision === "allow"}
                onClick={() => void decide(true)}
              >
                Allow connection
              </Button>
            </ActionRow>
          </div>
        </footer>
      </section>
    </main>
  );
}
