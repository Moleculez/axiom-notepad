"use client";
import { useState } from "react";
import { Check, X, History, FilePenLine, ArrowUpRight } from "lucide-react";
import {
  ErrorNotice,
  Loading,
  mutate,
  useAction,
  useData,
  useWorkspace,
  WorkspaceLink,
} from "../workspace/ui";
import Dialog from "../Dialog";
import ResourceHistory from "./ResourceHistory";
import { timeAgo } from "../../lib/client";
export default function ReviewInbox({ spaceId }: { spaceId?: string } = {}) {
  const { session, revision, notify } = useWorkspace(),
    data = useData<{ requests: any[]; proposals: any[] }>(
      "reviews/inbox" + (spaceId ? `?spaceId=${spaceId}` : ""),
      revision,
    ),
    action = useAction();
  const [selected, setSelected] = useState<any>(null),
    [respond, setRespond] = useState<{
      value: any;
      status: "approved" | "changes_requested" | "cancelled";
    } | null>(null),
    [response, setResponse] = useState(""),
    [all, setAll] = useState(false);
  return (
    <div className="review-inbox">
      <div className="revision-compare-toolbar">
        <label>
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          Include completed reviews
        </label>
      </div>
      <ErrorNotice
        message={data.error || action.error}
        retry={data.error ? data.reload : undefined}
      />
      {data.loading && !data.data && <Loading label="Loading your reviews…" />}
      <h2>Assigned milestone reviews</h2>
      {!data.data?.requests.some((r) => all || r.status === "pending") && (
        <p className="revision-notice">
          No assigned reviews. Request one from a file’s version history.
        </p>
      )}
      {data.data?.requests
        .filter((r) => all || r.status === "pending")
        .map((r) => (
          <article className="suggestion-card" key={r.id}>
            <header>
              <strong>{r.title}</strong>
              <span>
                {r.status.replaceAll("_", " ")} · {timeAgo(r.created_at)}
              </span>
            </header>
            <p className="suggestion-explanation">
              {r.requester} → {r.reviewer} · {r.space}
            </p>
            <p className="suggestion-explanation">{r.message}</p>
            {r.response && (
              <p className="suggestion-explanation">Response: {r.response}</p>
            )}
            <div className="ws-actions">
              <button
                className="button secondary"
                onClick={() => setSelected(r)}
              >
                <History size={15} />
                Compare milestone
              </button>
              <WorkspaceLink
                className="button ghost"
                to={"/notes/" + r.resource_id}
              >
                <ArrowUpRight size={15} />
                Open file
              </WorkspaceLink>
              {r.reviewer_id === session.user.id && (
                <>
                  <button
                    className="button ghost"
                    onClick={() => {
                      setRespond({ value: r, status: "approved" });
                      setResponse(r.response);
                    }}
                  >
                    <Check size={15} />
                    Approve review
                  </button>
                  <button
                    className="button ghost"
                    onClick={() => {
                      setRespond({ value: r, status: "changes_requested" });
                      setResponse(r.response);
                    }}
                  >
                    <FilePenLine size={15} />
                    Request changes
                  </button>
                </>
              )}
              {r.requested_by === session.user.id && r.status === "pending" && (
                <button
                  className="button ghost"
                  onClick={() => {
                    setRespond({ value: r, status: "cancelled" });
                    setResponse("");
                  }}
                >
                  <X size={15} />
                  Cancel request
                </button>
              )}
            </div>
          </article>
        ))}
      <h2>Pending edit proposals</h2>
      {!data.data?.proposals.length && (
        <p className="revision-notice">No proposals waiting for you.</p>
      )}
      {data.data?.proposals.map((p) => (
        <article className="suggestion-card" key={p.id}>
          <header>
            <strong>{p.title}</strong>
            <span>
              {p.author} · {p.space}
            </span>
          </header>
          <p className="suggestion-explanation">
            {p.message || "Proposed changes to the accepted document."}
          </p>
          <WorkspaceLink
            className="button secondary"
            to={"/notes/" + p.resource_id + "?review=suggestions"}
          >
            <FilePenLine size={15} />
            Review in editor
          </WorkspaceLink>
        </article>
      ))}
      {selected && (
        <ResourceHistory
          resourceId={selected.resource_id}
          initialBefore={
            selected.snapshot_id
              ? "snapshot:" + selected.snapshot_id
              : "file:" + selected.file_version_id
          }
          canEdit={false}
          flush={async () => {}}
          onClose={() => setSelected(null)}
          onRestore={() => {}}
        />
      )}
      {respond && (
        <Dialog
          title={
            respond.status === "approved"
              ? "Approve this milestone review?"
              : respond.status === "cancelled"
                ? "Cancel review request?"
                : "Request changes"
          }
          onClose={() => !action.busy && setRespond(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                if (!navigator.onLine)
                  throw new Error("Connect to submit a review.");
                await mutate(
                  "reviews/" + respond.value.id,
                  {
                    version: respond.value.version,
                    status: respond.status,
                    response,
                  },
                  "PATCH",
                );
                setRespond(null);
                data.reload();
                notify(
                  "Review response saved. Accepted document content is unchanged.",
                );
              });
            }}
          >
            <p>
              Responses refer to the saved milestone, even if the working
              document has changed since then.
            </p>
            <label>
              Review notes
              <textarea
                maxLength={5000}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
              />
            </label>
            <ErrorNotice message={action.error} />
            <div className="dialog-footer">
              <button className="button primary" disabled={action.busy}>
                Submit response
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
