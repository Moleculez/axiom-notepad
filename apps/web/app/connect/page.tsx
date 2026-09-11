"use client";
import { useEffect, useState } from "react";
import { ShieldCheck, Network } from "lucide-react";
import Auth from "../../components/Auth";
import { api, post, authRequest } from "../../lib/client";
import {
  ErrorNotice,
  Loading,
  type Session,
} from "../../components/workspace/ui";
import type { Space } from "@axiom/shared/workspace";
export default function ConnectPage() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [spaces, setSpaces] = useState<Space[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [scopes, setScopes] = useState<string[]>(["workspace:read"]),
    [client, setClient] = useState<{
      name: string;
      client_id: string;
      uri?: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
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
      setScopes(
        (params.get("scope") ?? "workspace:read")
          .split(" ")
          .filter((s) => s.startsWith("workspace:")),
      );
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
    setBusy(true);
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
          ...(new URLSearchParams(location.search)
            .get("scope")
            ?.split(" ")
            .includes("openid")
            ? ["openid"]
            : []),
          ...(new URLSearchParams(location.search)
            .get("scope")
            ?.split(" ")
            .includes("offline_access")
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
      setBusy(false);
    }
  };
  return (
    <main className="connection-consent">
      <section>
        <Network size={32} />
        <h1>Connect {client?.name ?? "an application"}</h1>
        <p>
          Signed in as {session.user.email}. Only connect applications you
          trust: selected content will be sent to that client.
        </p>
        <ErrorNotice message={error} />
        <dl>
          <dt>Client identity</dt>
          <dd>{client?.client_id}</dd>
          {client?.uri && (
            <>
              <dt>Application website</dt>
              <dd>{client.uri}</dd>
            </>
          )}
        </dl>
        <fieldset>
          <legend>Allowed workspaces</legend>
          <input
            type="search"
            aria-label="Find a workspace to share"
            placeholder="Find a workspace…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="connection-space-list">
            {spaces
              .filter(
                (s) =>
                  s.role &&
                  s.name.toLowerCase().includes(search.trim().toLowerCase()),
              )
              .map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, s.id]
                          : ids.filter((id) => id !== s.id),
                      )
                    }
                  />
                  <span>
                    {s.name}
                    <small>
                      {s.role} · {s.kind}
                    </small>
                  </span>
                </label>
              ))}
          </div>
          <small>{selected.length} workspaces selected</small>
        </fieldset>
        <fieldset>
          <legend>Permissions</legend>
          {["workspace:read", "workspace:write", "workspace:manage"]
            .filter((s) =>
              (
                new URLSearchParams(location.search).get("scope") ??
                "workspace:read"
              )
                .split(" ")
                .includes(s),
            )
            .map((scope) => (
              <label key={scope}>
                <input
                  type="checkbox"
                  disabled={scope === "workspace:read"}
                  checked={scopes.includes(scope)}
                  onChange={(e) =>
                    setScopes((all) =>
                      e.target.checked
                        ? [...all, scope]
                        : all.filter((s) => s !== scope),
                    )
                  }
                />
                <span>
                  {scope === "workspace:read"
                    ? "Read selected files and research"
                    : scope === "workspace:write"
                      ? "Create and edit content"
                      : "Manage groups and workspaces"}
                </span>
              </label>
            ))}
        </fieldset>
        <p className="connection-safeguard">
          <ShieldCheck size={20} />
          Deletion, transfers, invitations, and permission changes still require
          approval in Axiom. Revoke this connection at any time in Settings →
          Connected apps.
        </p>
        <div className="dialog-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void decide(false)}
          >
            Deny
          </button>
          <button
            className="button primary"
            disabled={busy || !client || !selected.length}
            onClick={() => void decide(true)}
          >
            {busy ? "Connecting…" : "Allow connection"}
          </button>
        </div>
      </section>
    </main>
  );
}
