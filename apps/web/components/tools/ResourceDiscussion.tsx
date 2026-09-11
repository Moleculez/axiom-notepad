"use client";
import { useState } from "react";
import { MessageSquare, Send, Check, Trash2, RotateCcw } from "lucide-react";
import { api, post } from "../../lib/client";
import { ErrorNotice, Loading, useData, useWorkspace } from "../workspace/ui";
type Comment = {
  id: string;
  author_id: string;
  author: string;
  body: string;
  resolved: boolean;
  created_at: string;
  anchor: { kind: string; [key: string]: string | number };
};
export default function ResourceDiscussion({
  resourceId,
  versionId,
  canComment,
  kinds = ["whole"],
  fixedAnchor,
  anchorLabel,
  onAnchor,
}: {
  resourceId: string;
  versionId?: string | null;
  canComment: boolean;
  kinds?: string[];
  fixedAnchor?: Comment["anchor"];
  anchorLabel?: (anchor: Comment["anchor"]) => string;
  onAnchor?: (anchor: Comment["anchor"]) => void;
}) {
  const { session } = useWorkspace(),
    data = useData<Comment[]>(
      `resource-comments/${resourceId}${versionId ? `?version=${versionId}` : ""}`,
    );
  const [body, setBody] = useState(""),
    [kind, setKind] = useState("whole"),
    [location, setLocation] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showResolved, setShowResolved] = useState(false);
  const anchor = () => {
    if (fixedAnchor) return fixedAnchor;
    if (kind === "time") return { kind, seconds: Number(location) };
    if (kind === "line") return { kind, line: Number(location) };
    if (kind === "page") return { kind, page: Number(location) };
    if (kind === "image") {
      const [x, y] = location.split(",").map(Number);
      return { kind, x: x / 100, y: y / 100 };
    }
    if (kind === "cell") {
      const [sheet, cell] = location.includes("!")
        ? location.split("!")
        : ["", location];
      return { kind, sheet, cell: cell.toUpperCase() };
    }
    return { kind: "whole" };
  };
  const label = (a: Comment["anchor"]) =>
    anchorLabel
      ? anchorLabel(a)
      : a.kind === "time"
        ? `${a.seconds}s`
        : a.kind === "line"
          ? `Line ${a.line}`
          : a.kind === "page"
            ? `Page ${a.page}`
            : a.kind === "image"
              ? `${Math.round(Number(a.x) * 100)}%, ${Math.round(Number(a.y) * 100)}%`
              : a.kind === "cell"
                ? `${a.sheet}!${a.cell}`
                : "Whole resource";
  return (
    <section className="resource-discussion">
      <header>
        <MessageSquare size={17} />
        <h2>Discussion</h2>
        <span className="tool-spacer" />
        <label>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          Resolved
        </label>
      </header>
      <p className="ws-note">
        {versionId
          ? "Comments stay attached to this exact file version."
          : "Shared with everyone who can read this project."}
      </p>
      <ErrorNotice message={error || data.error} />
      {data.loading ? (
        <Loading />
      ) : (
        <div className="resource-comment-list">
          {data.data
            ?.filter((c) => showResolved || !c.resolved)
            .filter(
              (c) =>
                !fixedAnchor ||
                (c.anchor.kind === fixedAnchor.kind &&
                  c.anchor.nodeId === fixedAnchor.nodeId),
            )
            .map((c) => (
              <article key={c.id}>
                <div className="resource-comment-meta">
                  <strong>{c.author}</strong>
                  <time>{new Date(c.created_at).toLocaleDateString()}</time>
                  {onAnchor && c.anchor.kind === "canvas-node" ? (
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => onAnchor(c.anchor)}
                    >
                      {label(c.anchor)}
                    </button>
                  ) : (
                    <span>{label(c.anchor)}</span>
                  )}
                </div>
                <p>{c.body}</p>
                {c.author_id === session.user.id && canComment && (
                  <div className="resource-comment-actions">
                    <button
                      className="button ghost"
                      onClick={() =>
                        void api(`resource-comments/${resourceId}/${c.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ resolved: !c.resolved }),
                        })
                          .then(data.reload)
                          .catch((e) => setError(e.message))
                      }
                    >
                      {c.resolved ? (
                        <RotateCcw size={13} />
                      ) : (
                        <Check size={13} />
                      )}{" "}
                      {c.resolved ? "Reopen" : "Resolve"}
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Delete my comment"
                      title="Delete my comment"
                      onClick={() =>
                        void api(`resource-comments/${resourceId}/${c.id}`, {
                          method: "DELETE",
                          body: "{}",
                        })
                          .then(data.reload)
                          .catch((e) => setError(e.message))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </article>
            ))}
        </div>
      )}
      {canComment && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            void post(`resource-comments/${resourceId}`, {
              body,
              versionId: versionId ?? null,
              anchor: anchor(),
            })
              .then(() => {
                setBody("");
                data.reload();
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {kinds.length > 1 && (
            <div className="discussion-anchor">
              <select
                aria-label="Comment anchor type"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {k === "whole" ? "Whole file" : k}
                  </option>
                ))}
              </select>
              {kind !== "whole" && (
                <input
                  aria-label="Comment location"
                  required
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={
                    kind === "image"
                      ? "x%, y%"
                      : kind === "cell"
                        ? "Sheet!A1"
                        : kind === "time"
                          ? "Seconds"
                          : "Number"
                  }
                />
              )}
            </div>
          )}
          <textarea
            aria-label="Write a comment"
            required
            rows={3}
            maxLength={20000}
            placeholder="Discuss a detail, ask a question, or leave a review…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button className="button primary" disabled={busy || !body.trim()}>
            <Send size={14} />
            {busy ? "Posting…" : "Comment"}
          </button>
        </form>
      )}
    </section>
  );
}
