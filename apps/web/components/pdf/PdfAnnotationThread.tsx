"use client";
import { useEffect, useRef, useState } from "react";
import type { Annotation } from "@axiom/shared/research";
import { api, post, SIGN_OUT_PENDING } from "../../lib/client";
import Dialog from "../Dialog";
import { confirmAction } from "../../lib/app-prompt";
type Reply = {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  version: number;
  updated_at: string;
};
type Thread = {
  version: number;
  resolved: boolean;
  shared: boolean;
  replies: Reply[];
};
export default function PdfAnnotationThread({
  annotation,
  userId,
  canManage,
  canComment,
  onClose,
}: {
  annotation: Annotation;
  userId: string;
  canManage: boolean;
  canComment: boolean;
  onClose: () => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null),
    [body, setBody] = useState(""),
    [editing, setEditing] = useState<Reply | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false),
    [draftNotice, setDraftNotice] = useState("");
  const draftKey = `axiom:${userId}:pdf-reply:${annotation.id}`;
  const restored = useRef(false);
  const identity = useRef({
    key: "",
    id: crypto.randomUUID(),
    mutationId: crypto.randomUUID(),
  });
  // Recover only after a fresh annotation/thread permission check. Reconnection
  // never publishes a draft automatically; the original edit fence is retained.
  useEffect(() => {
    if (!thread || restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(draftKey);
      const saved = raw ? JSON.parse(raw) : null;
      if (
        saved?.body &&
        typeof saved.body === "string" &&
        saved.body.length <= 12000
      ) {
        setBody(saved.body);
        if (
          saved.editing &&
          saved.editing.author_id === userId &&
          typeof saved.editing.id === "string" &&
          Number.isInteger(saved.editing.version)
        )
          setEditing(saved.editing);
        if (
          saved.identity &&
          typeof saved.identity.key === "string" &&
          /^[\da-f-]{36}$/i.test(saved.identity.id) &&
          /^[\da-f-]{36}$/i.test(saved.identity.mutationId)
        )
          identity.current = saved.identity;
        setDraftNotice(
          "Recovered an unsent reply from this device. Review it before sending.",
        );
      }
    } catch {
      setDraftNotice(
        "Draft recovery is unavailable. Keep this discussion open to preserve your reply.",
      );
    }
    setDraftLoaded(true);
  }, [thread, draftKey, userId]);
  useEffect(() => {
    if (!draftLoaded || localStorage.getItem(SIGN_OUT_PENDING)) return;
    try {
      const key = JSON.stringify({
        body,
        edit: editing?.id,
        version: editing?.version,
      });
      if (key !== identity.current.key)
        identity.current = {
          key,
          id: editing?.id ?? crypto.randomUUID(),
          mutationId: crypto.randomUUID(),
        };
      if (body)
        localStorage.setItem(
          draftKey,
          JSON.stringify({ body, editing, identity: identity.current }),
        );
      else localStorage.removeItem(draftKey);
    } catch {
      setDraftNotice(
        "This device could not save your draft. Keep the discussion open or copy the reply before leaving.",
      );
    }
  }, [body, editing, draftLoaded, draftKey]);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const value = await api<Thread>(`paper-threads/${annotation.id}`, {
          signal: controller.signal,
        });
        setThread(value);
        setError("");
        await api(`paper-threads/${annotation.id}`, {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ action: "read" }),
        });
      } catch (e) {
        if (!controller.signal.aborted) {
          setError((e as Error).message);
          setThread(null);
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [annotation.id]);
  const mutate = async (input: object, clear = false) => {
    setBusy(true);
    setError("");
    try {
      setThread(await post(`paper-threads/${annotation.id}`, input));
      if (clear) {
        setBody("");
        setEditing(null);
        setDraftNotice("");
        identity.current.key = "";
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Annotation discussion"
      subtitle={`Page ${annotation.data.page} · ${thread?.shared ? "Shared with paper readers" : "Private"}`}
      onClose={() => {
        if (!body) {
          onClose();
          return;
        }
        try {
          if (!localStorage.getItem(SIGN_OUT_PENDING))
            localStorage.setItem(
              draftKey,
              JSON.stringify({ body, editing, identity: identity.current }),
            );
          onClose();
        } catch {
          void confirmAction(
            "This device could not save your reply. Copy it before closing, or discard it.",
            {
              title: "Draft could not be saved",
              confirmLabel: "Discard and close",
            },
          ).then((ok) => {
            if (ok) onClose();
          });
        }
      }}
    >
      {annotation.data.quote && (
        <blockquote>{annotation.data.quote}</blockquote>
      )}
      {annotation.data.body && <p>{annotation.data.body}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {draftNotice && (
        <p className="ws-note" role="status">
          {draftNotice}
        </p>
      )}
      {!thread && body && (
        <p className="ws-note">
          Your unsent draft is kept on this device. Reconnect with access to
          this annotation to continue; nothing will be sent automatically.
        </p>
      )}
      {thread && (
        <>
          <div className="pdf-thread-status">
            <span>
              {thread.resolved ? "Resolved" : "Open"} · {thread.replies.length}{" "}
              replies
            </span>
            {(annotation.author_id === userId || canManage) && (
              <button
                disabled={busy || (!canComment && thread.shared)}
                onClick={() =>
                  void mutate({
                    action: "resolve",
                    resolved: !thread.resolved,
                    version: thread.version,
                    mutationId: crypto.randomUUID(),
                  })
                }
              >
                {thread.resolved ? "Reopen" : "Resolve"}
              </button>
            )}
          </div>
          <div className="pdf-thread-replies">
            {thread.replies.map((r) => (
              <article key={r.id}>
                <header>
                  <strong>{r.author_name}</strong>
                  <time dateTime={r.updated_at}>
                    {new Date(r.updated_at).toLocaleString()}
                  </time>
                </header>
                <p>{r.body}</p>
                <div>
                  {r.author_id === userId && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        setEditing(r);
                        setBody(r.body);
                      }}
                    >
                      Edit
                    </button>
                  )}
                  {(r.author_id === userId || (canManage && thread.shared)) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void mutate({
                          action: "reply",
                          id: r.id,
                          version: r.version,
                          body: r.body,
                          mutationId: crypto.randomUUID(),
                          deleted: true,
                        })
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {(canComment || !thread.shared) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const key = JSON.stringify({
                  body,
                  edit: editing?.id,
                  version: editing?.version,
                });
                if (key !== identity.current.key)
                  identity.current = {
                    key,
                    id: editing?.id ?? crypto.randomUUID(),
                    mutationId: crypto.randomUUID(),
                  };
                void mutate(
                  {
                    action: "reply",
                    id: identity.current.id,
                    mutationId: identity.current.mutationId,
                    version: editing?.version ?? 0,
                    body,
                  },
                  true,
                );
              }}
            >
              <label>
                {editing ? "Edit reply" : "Reply"}
                <textarea
                  aria-label={editing ? "Edit reply" : "Reply"}
                  disabled={busy}
                  value={body}
                  maxLength={12000}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                />
              </label>
              <div className="pdf-thread-status">
                {body && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setBody("");
                      setEditing(null);
                      setDraftNotice("");
                    }}
                  >
                    Discard draft
                  </button>
                )}
                {editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setBody("");
                    }}
                  >
                    Cancel edit
                  </button>
                )}
                <button
                  className="button primary"
                  disabled={busy || !body.trim()}
                >
                  {editing ? "Save changes" : "Add reply"}
                </button>
              </div>
              <p className="ws-note">
                Unsent replies stay on this device until sent, discarded, or you
                sign out. Sending always requires current access.
              </p>
            </form>
          )}
        </>
      )}
    </Dialog>
  );
}
