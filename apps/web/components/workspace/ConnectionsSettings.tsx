"use client";
import { useEffect, useState } from "react";
import { Check, Copy, Network, ShieldCheck, Unplug, X } from "lucide-react";
import { api, post } from "../../lib/client";
import { ErrorNotice, Loading, useData, useWorkspace } from "./ui";
type Connection = {
  id: string;
  name: string;
  client_id: string;
  scopes: string[];
  space_ids: string[];
  revoked_at: string | null;
};
type Approval = {
  id: string;
  action: string;
  client_name: string;
  arguments: Record<string, unknown>;
  status: string;
  expires_at: string;
  error?: string;
};
export default function ConnectionsSettings() {
  const { spaces, notify } = useWorkspace(),
    data = useData<{
      connections: Connection[];
      approvals: Approval[];
      activity: {
        id: string;
        action: string;
        outcome: string;
        created_at: string;
        client_name: string;
      }[];
    }>("connections"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  useEffect(() => {
    const timer = setInterval(data.reload, 10000);
    return () => clearInterval(timer);
  }, []);
  const run = async (id: string, work: () => Promise<unknown>) => {
    setBusy(id);
    setError("");
    try {
      await work();
      data.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="connections-settings">
      <section className="settings-card">
        <h2>
          <Network size={19} />
          MCP server
        </h2>
        <p>
          Connect an MCP-compatible assistant to your research workspace.
          Authentication uses OAuth with PKCE; no account password or long-lived
          API key is shared.
        </p>
        <div className="connection-endpoint">
          <code>
            {typeof location !== "undefined" ? location.origin : ""}/mcp
          </code>
          <button
            className="icon-button"
            aria-label="Copy MCP server URL"
            title="Copy MCP server URL"
            onClick={() =>
              void navigator.clipboard
                .writeText(location.origin + "/mcp")
                .then(() => notify("MCP server URL copied."))
                .catch(() =>
                  setError(
                    "Clipboard is unavailable. Select and copy the address.",
                  ),
                )
            }
          >
            <Copy size={16} />
          </button>
        </div>
        <p className="ws-note">
          Choose a remote HTTP MCP server in your client, enter this address,
          then review the permission screen. A local server is only reachable
          from this computer unless you deploy it over HTTPS.
        </p>
      </section>
      <ErrorNotice message={error || data.error} />
      {data.loading ? (
        <Loading />
      ) : (
        <>
          <section className="settings-card">
            <h2>
              <ShieldCheck size={19} />
              Requests for approval
            </h2>
            {!data.data?.approvals.length && (
              <p className="ws-note">No requests are waiting for review.</p>
            )}
            {data.data?.approvals.map((a) => (
              <article className="connection-approval" key={a.id}>
                <header>
                  <strong>{a.action.replaceAll("_", " ")}</strong>
                  <span>{a.client_name}</span>
                </header>
                <p className="ws-note">
                  {a.status} · expires{" "}
                  {new Date(a.expires_at).toLocaleTimeString()}
                </p>
                <details>
                  <summary>Review exact targets and changes</summary>
                  <pre>{JSON.stringify(a.arguments, null, 2)}</pre>
                </details>
                {a.error && <ErrorNotice message={a.error} />}
                <div className="ws-actions">
                  {a.status === "pending" &&
                    new Date(a.expires_at).valueOf() > Date.now() && (
                      <>
                        <button
                          className="button secondary"
                          disabled={!!busy}
                          onClick={() =>
                            void run(a.id, () =>
                              post(`connections/approvals/${a.id}`, {
                                decision: "reject",
                              }),
                            )
                          }
                        >
                          <X size={15} />
                          Reject
                        </button>
                        <button
                          className="button primary"
                          disabled={!!busy}
                          onClick={() =>
                            void run(a.id, () =>
                              post(`connections/approvals/${a.id}`, {
                                decision: "approve",
                              }),
                            )
                          }
                        >
                          <Check size={15} />
                          Approve exact action
                        </button>
                      </>
                    )}
                  {a.status === "approved" && (
                    <span className="ws-note">
                      Approved. The client can now retry this exact request.
                    </span>
                  )}
                </div>
              </article>
            ))}
          </section>
          <section className="settings-card">
            <h2>Connected applications</h2>
            {!data.data?.connections.length && (
              <p className="ws-note">No applications have been connected.</p>
            )}
            {data.data?.connections.map((c) => (
              <article className="connection-entry" key={c.id}>
                <div>
                  <strong>{c.name}</strong>
                  <p>{c.revoked_at ? "Revoked" : c.scopes.join(" · ")}</p>
                  <small>
                    {c.space_ids
                      .map(
                        (id) =>
                          spaces.find((s) => s.id === id)?.name ??
                          "Unavailable workspace",
                      )
                      .join(", ")}
                  </small>
                </div>
                {!c.revoked_at && (
                  <button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void run(c.id, () =>
                        api(`connections/${c.id}`, { method: "DELETE" }),
                      )
                    }
                  >
                    <Unplug size={15} />
                    Revoke
                  </button>
                )}
              </article>
            ))}
          </section>
          <section className="settings-card">
            <h2>Recent connection activity</h2>
            {data.data?.activity.map((a) => (
              <div key={a.id} className="connection-log">
                <span>
                  {a.client_name} · {a.action}
                </span>
                <span>{a.outcome}</span>
                <time>{new Date(a.created_at).toLocaleString()}</time>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
