"use client";
import { useRef, useState } from "react";
import {
  Check,
  X,
  Pencil,
  Undo2,
  MessageSquare,
  RefreshCw,
  ArrowLeft,
  FilePenLine,
  Download,
} from "lucide-react";
import type { Suggestion } from "@axiom/shared/revisions";
import {
  ErrorNotice,
  Loading,
  mutate,
  useAction,
  useData,
  useWorkspace,
} from "../workspace/ui";
import { timeAgo, download } from "../../lib/client";

export default function SuggestionReview({
  noteId,
  generation,
  canEdit,
  onCompose,
  onClose,
}: {
  noteId: string;
  generation: number;
  canEdit: boolean;
  onCompose: (proposal?: Suggestion) => void;
  onClose: () => void;
}) {
  const { session, revision, notify } = useWorkspace(),
    action = useAction();
  const base = "resources/" + noteId + "/suggestions",
    proposals = useData<Suggestion[]>(base, revision);
  const [selected, setSelected] = useState<string[]>([]),
    [showClosed, setShowClosed] = useState(false),
    [reply, setReply] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [undo, setUndo] = useState<{
      id: string;
      items: { id: string; version: number }[];
    } | null>(null);
  const requiredVersions = useRef(new Map<string, number>());
  const items = proposals.data ?? [];
  const reviewBusy =
    action.busy ||
    items.some((p) => p.version < (requiredVersions.current.get(p.id) ?? 0));
  const decide = (
    kind: "accept" | "reject" | "withdraw",
    values: Suggestion[],
  ) =>
    action.run(async () => {
      if (!navigator.onLine)
        throw new Error(
          "Connect before deciding proposals. Accepted documents are never modified offline by review actions.",
        );
      const result = await mutate<{ decisionId: string }>(base + "/decision", {
        generation,
        action: kind,
        items: values.map((v) => ({ id: v.id, version: v.version })),
      });
      const next = values.map((v) => ({ id: v.id, version: v.version + 1 }));
      next.forEach((v) => requiredVersions.current.set(v.id, v.version));
      setUndo({ id: result.decisionId, items: next });
      setSelected([]);
      proposals.reload();
      notify(
        values.length +
          (kind === "accept"
            ? " proposal(s) accepted."
            : kind === "reject"
              ? " proposal(s) rejected."
              : " proposal withdrawn."),
      );
    });
  return (
    <section className="suggestion-review" aria-label="Review suggestions">
      <header className="revision-header">
        <button
          className="icon-button"
          aria-label="Close suggestion review"
          onClick={onClose}
        >
          <ArrowLeft size={17} />
        </button>
        <div>
          <h2>Review suggestions</h2>
          <p>
            {items.filter((v) => v.status === "pending").length} pending ·
            editors may accept or reject
          </p>
        </div>
        <button className="button secondary" onClick={() => onCompose()}>
          <FilePenLine size={15} />
          Suggest edits
        </button>
        <button
          className="icon-button"
          aria-label="Refresh suggestions"
          onClick={proposals.reload}
        >
          <RefreshCw size={15} />
        </button>
      </header>
      <div className="revision-compare-toolbar">
        <label>
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
          Show decided proposals
        </label>
        {canEdit && selected.length > 0 && (
          <>
            <button
              className="button secondary"
              disabled={reviewBusy}
              onClick={() =>
                void decide(
                  "accept",
                  items.filter((v) => selected.includes(v.id)),
                )
              }
            >
              <Check size={15} />
              Accept selected ({selected.length})
            </button>
            <button
              className="button ghost"
              disabled={reviewBusy}
              onClick={() =>
                void decide(
                  "reject",
                  items.filter((v) => selected.includes(v.id)),
                )
              }
            >
              <X size={15} />
              Reject selected
            </button>
          </>
        )}
        {undo && canEdit && (
          <button
            className="button ghost"
            disabled={reviewBusy}
            onClick={() =>
              void action.run(async () => {
                if (!navigator.onLine)
                  throw new Error("Connect before undoing a review decision.");
                await mutate(base + "/undo", {
                  generation,
                  decisionId: undo.id,
                });
                undo.items.forEach((v) =>
                  requiredVersions.current.set(v.id, v.version + 1),
                );
                setUndo(null);
                proposals.reload();
              })
            }
          >
            <Undo2 size={15} />
            Undo last decision
          </button>
        )}
      </div>
      <ErrorNotice
        message={action.error || proposals.error}
        retry={proposals.error ? proposals.reload : undefined}
      />
      <div className="suggestion-review-scroll">
        {proposals.loading && !proposals.data && (
          <Loading label="Loading review…" />
        )}
        {!proposals.loading &&
          !items.some((v) => showClosed || v.status === "pending") && (
            <p className="revision-notice">
              No pending proposals. Suggest edits to discuss a change without
              changing the accepted document.
            </p>
          )}
        {items
          .filter((v) => showClosed || v.status === "pending")
          .map((p) => (
            <article className="suggestion-card" key={p.id}>
              <header>
                {canEdit && p.status === "pending" && (
                  <input
                    aria-label={"Select proposal by " + p.author}
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, p.id]
                          : ids.filter((id) => id !== p.id),
                      )
                    }
                  />
                )}
                <strong>{p.author}</strong>
                <span>
                  {timeAgo(p.createdAt)} · {p.status}
                </span>
              </header>
              {p.message && (
                <p className="suggestion-explanation">{p.message}</p>
              )}
              {p.conflicted && (
                <ErrorNotice message={"Needs attention: " + p.reason} />
              )}
              <div className="suggestion-hunks">
                {p.hunks.slice(0, 50).map((h, i) => (
                  <pre key={i}>
                    {h.before && (
                      <del>
                        {h.before.slice(0, 10000)}
                        {h.before.length > 10000 ? "…" : ""}
                      </del>
                    )}
                    {h.insert && (
                      <ins>
                        {h.insert.slice(0, 10000)}
                        {h.insert.length > 10000 ? "…" : ""}
                      </ins>
                    )}
                  </pre>
                ))}
              </div>
              {(p.hunks.length > 50 ||
                p.hunks.some(
                  (h) => h.before.length > 10000 || h.insert.length > 10000,
                )) && (
                <p className="ws-muted">
                  Large proposal: this preview is abbreviated. Export the full
                  proposal to inspect every change before deciding.
                </p>
              )}
              <div className="ws-actions">
                <button
                  className="button ghost"
                  onClick={() =>
                    download(
                      "proposal-" + p.id + ".json",
                      JSON.stringify(p, null, 2),
                      "application/json",
                    )
                  }
                >
                  <Download size={15} />
                  Export proposal
                </button>
                {p.status === "pending" && canEdit && (
                  <>
                    <button
                      className="button secondary"
                      disabled={reviewBusy || p.conflicted}
                      onClick={() => void decide("accept", [p])}
                    >
                      <Check size={15} />
                      Accept
                    </button>
                    <button
                      className="button ghost"
                      disabled={reviewBusy}
                      onClick={() => void decide("reject", [p])}
                    >
                      <X size={15} />
                      Reject
                    </button>
                  </>
                )}
                {p.status === "pending" && p.authorId === session.user.id && (
                  <>
                    <button
                      className="button ghost"
                      disabled={!!p.conflicted || reviewBusy}
                      onClick={() => onCompose(p)}
                    >
                      <Pencil size={15} />
                      Revise
                    </button>
                    <button
                      className="button ghost"
                      disabled={reviewBusy}
                      onClick={() => void decide("withdraw", [p])}
                    >
                      Withdraw
                    </button>
                  </>
                )}
                <button
                  className="button ghost"
                  onClick={() => {
                    setReply(reply === p.id ? null : p.id);
                    setMessage("");
                  }}
                >
                  <MessageSquare size={15} />
                  Reply ({p.replies.length})
                </button>
              </div>
              {p.replies.map((r) => (
                <div className="suggestion-reply" key={r.id}>
                  <strong>{r.author}</strong>
                  <p>{r.body}</p>
                </div>
              ))}
              {reply === p.id && (
                <form
                  className="suggestion-reply-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action.run(async () => {
                      if (!navigator.onLine)
                        throw new Error(
                          "Connect to send your reply. The text is kept here.",
                        );
                      await mutate(base + "/" + p.id + "/reply", {
                        id: crypto.randomUUID(),
                        body: message,
                      });
                      setMessage("");
                      setReply(null);
                      proposals.reload();
                    });
                  }}
                >
                  <textarea
                    aria-label="Reply to proposal"
                    required
                    maxLength={10000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <button className="button secondary" disabled={reviewBusy}>
                    Send reply
                  </button>
                </form>
              )}
            </article>
          ))}
      </div>
    </section>
  );
}
