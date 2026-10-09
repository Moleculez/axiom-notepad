"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  ActionRow,
  Button,
  Checkbox,
  IconButton,
  TextArea,
} from "../ui/controls";
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
  useInterfaceLocale();
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
    <section
      className="suggestion-review"
      aria-label={uiText("Review suggestions")}
    >
      <header className="revision-header">
        <IconButton
          className="icon-button"
          aria-label={uiText("Close suggestion review")}
          onClick={onClose}
        >
          <ArrowLeft size={17} />
        </IconButton>
        <div>
          <h2>
            <I18nText id="Review suggestions" />
          </h2>
          <p>
            {items.filter((v) => v.status === "pending").length}{" "}
            <I18nText id="pending · editors may accept or reject" />
          </p>
        </div>
        <Button className="button secondary" onClick={() => onCompose()}>
          <FilePenLine size={15} />
          <I18nText id="Suggest edits" />
        </Button>
        <IconButton
          className="icon-button"
          aria-label={uiText("Refresh suggestions")}
          onClick={proposals.reload}
        >
          <RefreshCw size={15} />
        </IconButton>
      </header>
      <div className="revision-compare-toolbar">
        <label>
          <Checkbox
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
          <I18nText id="Show decided proposals" />
        </label>
        {canEdit && selected.length > 0 && (
          <>
            <Button
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
              <I18nText id="Accept selected (" />
              {selected.length})
            </Button>
            <Button
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
              <I18nText id="Reject selected" />
            </Button>
          </>
        )}
        {undo && canEdit && (
          <Button
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
            <I18nText id="Undo last decision" />
          </Button>
        )}
      </div>
      <ErrorNotice
        message={action.error || proposals.error}
        retry={proposals.error ? proposals.reload : undefined}
      />
      <div className="suggestion-review-scroll">
        {proposals.loading && !proposals.data && (
          <Loading label={uiText("Loading review…")} />
        )}
        {!proposals.loading &&
          !items.some((v) => showClosed || v.status === "pending") && (
            <p className="revision-notice">
              <I18nText id="No pending proposals. Suggest edits to discuss a change without changing the accepted document." />
            </p>
          )}
        {items
          .filter((v) => showClosed || v.status === "pending")
          .map((p) => (
            <article className="suggestion-card" key={p.id}>
              <header>
                {canEdit && p.status === "pending" && (
                  <Checkbox
                    aria-label={"Select proposal by " + p.author}

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
                  <I18nText id="Large proposal: this preview is abbreviated. Export the full proposal to inspect every change before deciding." />
                </p>
              )}
              <ActionRow>
                <Button
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
                  <I18nText id="Export proposal" />
                </Button>
                {p.status === "pending" && canEdit && (
                  <>
                    <Button
                      className="button secondary"
                      disabled={reviewBusy || p.conflicted}
                      onClick={() => void decide("accept", [p])}
                    >
                      <Check size={15} />
                      <I18nText id="Accept" />
                    </Button>
                    <Button
                      className="button ghost"
                      disabled={reviewBusy}
                      onClick={() => void decide("reject", [p])}
                    >
                      <X size={15} />
                      <I18nText id="Reject" />
                    </Button>
                  </>
                )}
                {p.status === "pending" && p.authorId === session.user.id && (
                  <>
                    <Button
                      className="button ghost"
                      disabled={!!p.conflicted || reviewBusy}
                      onClick={() => onCompose(p)}
                    >
                      <Pencil size={15} />
                      <I18nText id="Revise" />
                    </Button>
                    <Button
                      className="button ghost"
                      disabled={reviewBusy}
                      onClick={() => void decide("withdraw", [p])}
                    >
                      <I18nText id="Withdraw" />
                    </Button>
                  </>
                )}
                <Button
                  className="button ghost"
                  onClick={() => {
                    setReply(reply === p.id ? null : p.id);
                    setMessage("");
                  }}
                >
                  <MessageSquare size={15} />
                  <I18nText id="Reply (" />
                  {p.replies.length})
                </Button>
              </ActionRow>
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
                  <TextArea
                    aria-label={uiText("Reply to proposal")}
                    required
                    maxLength={10000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <Button className="button secondary" disabled={reviewBusy}>
                    <I18nText id="Send reply" />
                  </Button>
                </form>
              )}
            </article>
          ))}
      </div>
    </section>
  );
}
