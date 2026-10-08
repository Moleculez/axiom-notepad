"use client";
import {
  ActionRow,
  Button,
  HelpText,
  IconButton,
  Notice,
} from "../ui/controls";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Network,
  RefreshCw,
  ShieldCheck,
  Unplug,
  X,
} from "lucide-react";
import type { McpServerStatus } from "@axiom/shared/mcp-diagnostics";
import { api, post } from "../../lib/client";
import { ErrorNotice, Loading, useData, useWorkspace, useLocation } from "./ui";
import ChangeSetReview from "../assistant/ChangeSetReview";
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
  const server = useData<McpServerStatus>("connections/mcp-status");
  const [checkedServer, setCheckedServer] = useState<McpServerStatus | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const checkController = useRef<AbortController | null>(null);
  const mcp = checkedServer ?? server.data;
  const { params } = useLocation();
  const [review, setReview] = useState<string | null>(params.get("review"));
  const changes = useData<
    { id: string; title: string; status: string; connection_id?: string }[]
  >("assistant/change-sets");
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
    const timer = setInterval(() => {
      data.revalidate();
      changes.revalidate();
    }, 10000);
    return () => clearInterval(timer);
  }, [data.revalidate, changes.revalidate]);
  useEffect(() => () => checkController.current?.abort(), []);
  const checkConnection = async () => {
    checkController.current?.abort();
    const controller = new AbortController();
    checkController.current = controller;
    setChecking(true);
    setCheckError("");
    try {
      const result = await api<McpServerStatus>(
        "connections/mcp-status?check=1",
        {
          signal: controller.signal,
        },
      );
      if (!controller.signal.aborted) setCheckedServer(result);
    } catch (e) {
      if (!controller.signal.aborted) setCheckError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  };
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
          <code>{mcp?.endpoint ?? "Loading canonical endpoint…"}</code>
          <IconButton
            className="icon-button"
            aria-label="Copy MCP server URL"
            title="Copy MCP server URL"
            disabled={!mcp?.endpoint}
            onClick={() =>
              void navigator.clipboard
                .writeText(mcp!.endpoint)
                .then(() => notify("MCP server URL copied."))
                .catch(() =>
                  setError(
                    "Clipboard is unavailable. Select and copy the address.",
                  ),
                )
            }
          >
            <Copy size={16} />
          </IconButton>
        </div>
        <HelpText>
          Choose a remote HTTP MCP server in your client, enter this address,
          then review the permission screen. A local server is only reachable
          from this computer unless you deploy it over HTTPS.
        </HelpText>
        {mcp && (
          <>
            <dl className="connection-capabilities">
              <div>
                <dt>Connection</dt>
                <dd>
                  {mcp.transport} · {mcp.authentication}
                </dd>
              </div>
              <div>
                <dt>Workspace permissions</dt>
                <dd>
                  Read, propose edits or manage—only within reviewed grants
                </dd>
              </div>
              <div>
                <dt>Changes</dt>
                <dd>
                  In-app review before every write · up to{" "}
                  {mcp.maxChangeSetActions} actions per proposal
                </dd>
              </div>
              <div>
                <dt>Discovery</dt>
                <dd>
                  {mcp.catalogActions} workspace operations, plus research
                  resources and study prompts
                </dd>
              </div>
            </dl>
            {typeof location !== "undefined" &&
              location.origin !== mcp.canonicalOrigin && (
                <HelpText>
                  You opened a different address. Use the canonical endpoint
                  above for OAuth; an alias does not change the token audience.
                </HelpText>
              )}
          </>
        )}
        <ActionRow align="between" size="standard">
          <HelpText as="span">
            Checks routing and the OAuth challenge without accessing files or
            changing permissions.
          </HelpText>
          <Button
            type="button"
            pending={checking}
            onClick={() => void checkConnection()}
          >
            <RefreshCw size={16} />
            Check connection
          </Button>
        </ActionRow>
        {(checkError || server.error) && (
          <ErrorNotice message={checkError || server.error} />
        )}
        {mcp?.check && (
          <Notice
            tone={mcp.check.healthy ? "success" : "warning"}
            role="status"
          >
            <strong>
              {mcp.check.healthy
                ? "Endpoint ready"
                : "Connection needs attention"}
            </strong>
            <p>{mcp.check.message}</p>
            <HelpText as="small">
              {mcp.check.code.replaceAll("_", " ")}
              {mcp.check.httpStatus ? ` · HTTP ${mcp.check.httpStatus}` : ""}
              {" · "}
              {new Date(mcp.check.checkedAt).toLocaleTimeString()}
            </HelpText>
          </Notice>
        )}
      </section>
      <ErrorNotice message={error || data.error} />
      {data.loading && !data.data ? (
        <Loading />
      ) : (
        <>
          <section className="settings-card">
            <h2>
              <ShieldCheck size={19} />
              Requests for approval
            </h2>
            {!data.data?.approvals.length &&
              !changes.data?.some((s) => s.connection_id) && (
                <HelpText>No requests are waiting for review.</HelpText>
              )}
            {changes.data
              ?.filter((s) => s.connection_id)
              .map((s) => (
                <article className="connection-approval" key={s.id}>
                  <header>
                    <strong>{s.title}</strong>
                    <span>
                      {data.data?.connections.find(
                        (c) => c.id === s.connection_id,
                      )?.name ?? "Connected app"}
                    </span>
                  </header>
                  <HelpText>{s.status} · all writes require review</HelpText>
                  <Button
                    className="button secondary"
                    onClick={() => setReview(s.id)}
                  >
                    Review changes
                  </Button>
                </article>
              ))}
            {data.data?.approvals.map((a) => (
              <article className="connection-approval" key={a.id}>
                <header>
                  <strong>{a.action.replaceAll("_", " ")}</strong>
                  <span>{a.client_name}</span>
                </header>
                <HelpText>
                  {a.status} · expires{" "}
                  {new Date(a.expires_at).toLocaleTimeString()}
                </HelpText>
                <details>
                  <summary>Review exact targets and changes</summary>
                  <pre>{JSON.stringify(a.arguments, null, 2)}</pre>
                </details>
                {a.error && <ErrorNotice message={a.error} />}
                <ActionRow>
                  {a.status === "pending" &&
                    new Date(a.expires_at).valueOf() > Date.now() && (
                      <>
                        <Button
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
                        </Button>
                        <Button
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
                        </Button>
                      </>
                    )}
                  {a.status === "approved" && (
                    <HelpText as="span">
                      Approved. The client can now retry this exact request.
                    </HelpText>
                  )}
                </ActionRow>
              </article>
            ))}
          </section>
          <section className="settings-card">
            <h2>Connected applications</h2>
            {!data.data?.connections.length && (
              <HelpText>No applications have been connected.</HelpText>
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
                  <Button
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
                  </Button>
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
      {review && (
        <ChangeSetReview
          id={review}
          onClose={() => setReview(null)}
          onChange={() => {
            changes.revalidate();
            data.revalidate();
          }}
        />
      )}
    </div>
  );
}
