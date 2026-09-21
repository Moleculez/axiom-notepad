"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BookOpen,
  Check,
  Copy,
  Download,
  History,
  LoaderCircle,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
  Square,
  Trash2,
  Undo2,
  X,
  Pencil,
} from "lucide-react";
import type {
  AssistantPrepared,
  AssistantSelection,
  AssistantTurn,
  AssistantProposalItem,
} from "@axiom/shared/assistant";
import { assistantSelectionSchema } from "@axiom/shared/assistant";
import type { AssistantIntent } from "../../lib/assistant";
import { api, post, download, SIGN_OUT_PENDING } from "../../lib/client";
import { confirmAction, promptValue } from "../../lib/app-prompt";
import { useData, useWorkspace, ErrorNotice } from "../workspace/ui";
import Dialog from "../Dialog";
import AssistantAnswer from "./AssistantAnswer";
import AssistantProposalReview from "./AssistantProposalReview";
import AssistantExcerpt from "./AssistantExcerpt";
import AssistantOfficeExcerpt from "./AssistantOfficeExcerpt";
type Provider = {
  id: string;
  name: string;
  model: string;
  version: number;
  group_name: string;
};
type SearchResult = {
  id: string;
  title: string;
  kind: "document" | "task" | "pdf" | "office";
  excerpt: string;
  format?: string;
  version_id?: string;
};
type Conversation = {
  id: string;
  title: string;
  version: number;
  spaceId: string;
  spaceIds: string[];
  turns: AssistantTurn[];
};
type Picked = AssistantSelection & { label?: string };
const stripLabel = ({ label: _label, ...v }: Picked) => v as AssistantSelection;
export default function AssistantPanel({
  intent,
  onClose,
  onWorkspace,
}: {
  intent: AssistantIntent & { spaceId: string; serial: number };
  onClose: () => void;
  onWorkspace: (id: string) => void;
}) {
  const { session, spaces, revision, navigate, notify, refresh } =
      useWorkspace(),
    spaceId = intent.spaceId;
  const providers = useData<Provider[]>(
      `spaces/${spaceId}/assistant/providers`,
      revision,
    ),
    history = useData<{ id: string; title: string; version: number }[]>(
      `spaces/${spaceId}/assistant/conversations`,
    );
  const [providerId, setProviderId] = useState(""),
    [conversationId, setConversationId] = useState(""),
    [conversation, setConversation] = useState<Conversation | null>(null);
  const [scopeIds, setScopeIds] = useState<string[]>(
    intent.spaceIds ?? [spaceId],
  );
  const [office, setOffice] = useState<SearchResult | null>(null);
  const scope = conversation?.spaceIds ?? scopeIds;
  const [prompt, setPrompt] = useState(""),
    [picked, setPicked] = useState<Picked[]>([]),
    [allowTasks, setAllowTasks] = useState(false),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [offset, setOffset] = useState(0);
  const [prepared, setPrepared] = useState<AssistantPrepared | null>(null),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [storageWarning, setStorageWarning] = useState(""),
    [historyOpen, setHistoryOpen] = useState(false),
    [review, setReview] = useState<{
      item: AssistantProposalItem;
      turn: AssistantTurn;
    } | null>(null),
    [tick, setTick] = useState(0);
  const [width, setWidth] = useState(420),
    [narrow, setNarrow] = useState(false),
    [draftLoaded, setDraftLoaded] = useState(false),
    [recovered, setRecovered] = useState(false);
  const [excerpt, setExcerpt] = useState<Extract<
    Picked,
    { kind: "document" }
  > | null>(null);
  const draftKey = `axiom:${session.user.id}:assistant:${spaceId}`,
    serial = useRef(0),
    submission = useRef(crypto.randomUUID()),
    creating = useRef<string | null>(null),
    promptRef = useRef<HTMLTextAreaElement>(null),
    lastIntent = useRef(-1),
    alive = useRef(true);
  // An async preview may finish after typing, changing providers or switching chats.
  // Only the exact still-current composition may open a consent dialog.
  const compositionKey = JSON.stringify([
    prompt,
    picked,
    providerId,
    allowTasks,
    scope,
    providers.data?.find((p) => p.id === providerId)?.version,
  ]);
  const composition = useRef(compositionKey);
  composition.current = compositionKey;
  const searchData = useData<{
    items: SearchResult[];
    nextOffset: number | null;
  }>(
    searchOpen
      ? `spaces/${spaceId}/assistant/search?q=${encodeURIComponent(query)}&offset=${offset}&spaceIds=${scope.join(",")}`
      : null,
  );
  const selectedProvider = providers.data?.find((p) => p.id === providerId),
    active = conversation?.turns.some((t) =>
      ["queued", "running"].includes(t.status),
    );
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 180);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!providerId && providers.data?.length)
      setProviderId(providers.data[0].id);
  }, [providers.data, providerId]);
  useEffect(() => {
    alive.current = true;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        setPrompt(typeof d.prompt === "string" ? d.prompt.slice(0, 10000) : "");
        setPicked(
          Array.isArray(d.selections)
            ? d.selections
                .flatMap((raw: unknown) => {
                  if (!raw || typeof raw !== "object") return [];
                  const { label, ...input } = raw as Record<string, unknown>;
                  const result = assistantSelectionSchema.safeParse(input);
                  if (!result.success || result.data.kind === "pdf") return [];
                  return [
                    {
                      ...result.data,
                      label:
                        typeof label === "string"
                          ? label.slice(0, 300)
                          : undefined,
                    },
                  ];
                })
                .slice(0, 20)
            : [],
        );
        setConversationId(
          typeof d.conversationId === "string" ? d.conversationId : "",
        );
        if (Array.isArray(d.spaceIds)) {
          const groupId = spaces.find((s) => s.id === spaceId)?.group_id;
          setScopeIds(
            [
              ...new Set([
                spaceId,
                ...d.spaceIds.filter(
                  (id: unknown) =>
                    typeof id === "string" &&
                    spaces.some(
                      (s) => s.id === id && !!groupId && s.group_id === groupId,
                    ),
                ),
              ]),
            ].slice(0, 20),
          );
        }
        setRecovered(true);
      }
    } catch {
      setStorageWarning(
        "Draft recovery is unavailable. Keep this panel open or export your prompt.",
      );
    }
    setDraftLoaded(true);
    const media = matchMedia("(max-width: 1279px)"),
      change = () => setNarrow(media.matches);
    change();
    media.addEventListener("change", change);
    const stop = () => {
      setConversation(null);
      setPrepared(null);
      setReview(null);
      onClose();
    };
    window.addEventListener("axiom:close-documents", stop);
    return () => {
      alive.current = false;
      serial.current++;
      media.removeEventListener("change", change);
      window.removeEventListener("axiom:close-documents", stop);
    };
  }, [draftKey]);
  useEffect(() => {
    if (lastIntent.current === intent.serial) return;
    lastIntent.current = intent.serial;
    if (intent.spaceIds) {
      setConversationId("");
      setConversation(null);
      setPicked([]);
      setScopeIds([...new Set([spaceId, ...intent.spaceIds])].slice(0, 20));
    }
    if (intent.selection)
      setPicked((old) =>
        [
          ...old.filter(
            (s) =>
              !(
                s.id === intent.selection!.id &&
                s.kind === intent.selection!.kind
              ),
          ),
          { ...intent.selection!, label: intent.selectionLabel },
        ].slice(0, 20),
      );
    if (intent.prompt) setPrompt(intent.prompt);
    requestAnimationFrame(() => promptRef.current?.focus());
  }, [intent]);
  useEffect(() => {
    if (!draftLoaded) return;
    try {
      if (localStorage.getItem(SIGN_OUT_PENDING)) return;
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          prompt,
          conversationId,
          spaceIds: scopeIds,
          selections: picked.filter((s) => s.kind !== "pdf"),
        }),
      );
    } catch {
      setStorageWarning(
        "The prompt could not be saved on this device. Export it before closing.",
      );
    }
  }, [prompt, picked, conversationId, draftKey, draftLoaded, scopeIds]);
  useEffect(() => {
    setPrepared(null);
    setConsent(false);
    submission.current = crypto.randomUUID();
  }, [
    prompt,
    picked,
    providerId,
    allowTasks,
    selectedProvider?.version,
    scopeIds,
  ]);
  useEffect(() => {
    if (!conversationId) {
      setConversation(null);
      return;
    }
    const controller = new AbortController(),
      sequence = ++serial.current;
    void api<Conversation>(`assistant/conversations/${conversationId}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (sequence === serial.current) {
          setConversation(value);
          setLoadError("");
          if (value.turns.some((t) => t.unavailable)) {
            setPrepared(null);
            setReview(null);
          }
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setConversation(null);
          setPrepared(null);
          setReview(null);
          setLoadError(e.message);
        }
      });
    return () => controller.abort();
  }, [conversationId, tick, revision]);
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (
          document.visibilityState === "visible" &&
          navigator.onLine &&
          conversationId
        )
          setTick((t) => t + 1);
      },
      active ? 1500 : 10000,
    );
    const visible = () => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [active, conversationId]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const reload = () => {
    setTick((t) => t + 1);
    history.reload();
  };
  const newConversation = () => {
    setConversationId("");
    setConversation(null);
    setPrepared(null);
    setReview(null);
    setLoadError("");
    setPrompt("");
    setPicked([]);
    setHistoryOpen(false);
    creating.current = null;
  };
  const prepare = () =>
    run(async () => {
      const expectedComposition = composition.current;
      const expectedConversation = conversationId;
      if (!navigator.onLine)
        throw new Error(
          "Connect before preparing a request. Your draft stays on this device.",
        );
      if (!selectedProvider)
        throw new Error("Choose an enabled assistant provider.");
      let id = conversationId;
      if (!id) {
        creating.current ??= crypto.randomUUID();
        id = creating.current;
        await post(`spaces/${spaceId}/assistant/conversations`, {
          id,
          spaceIds: scope,
          title:
            prompt.replace(/\s+/g, " ").slice(0, 80) || "Research conversation",
        });
        setConversationId(id);
        history.reload();
      }
      const value: AssistantPrepared = await post(
        `spaces/${spaceId}/assistant/contexts`,
        {
          conversationId: id,
          providerId: selectedProvider.id,
          providerVersion: selectedProvider.version,
          prompt,
          selections: picked.map(stripLabel),
          allowTaskCreate: allowTasks,
        },
      );
      if (
        !alive.current ||
        composition.current !== expectedComposition ||
        (expectedConversation && expectedConversation !== value.conversationId)
      )
        return;
      setPrepared(value);
      setConsent(false);
      submission.current = crypto.randomUUID();
    });
  const add = async (item: SearchResult) => {
    if (item.kind === "office") {
      setOffice(item);
      setSearchOpen(false);
      return;
    }
    if (picked.length >= 20)
      throw new Error("Select at most 20 evidence items.");
    if (item.kind === "pdf") {
      navigate(`/pdf/${item.id}?version=${item.version_id}`);
      notify(
        "Use Ask workspace assistant in the PDF reader to attach the current page, or select reviewed text in Batch OCR.",
      );
      setSearchOpen(false);
      return;
    }
    setPicked((old) =>
      old.some((s) => s.id === item.id && s.kind === item.kind)
        ? old
        : [
            ...old,
            {
              kind: item.kind as "document",
              id: item.id,
              editable: false,
              label: item.title,
            },
          ],
    );
  };
  const content = (
    <>
      <header className="assistant-header">
        <div>
          <MessageSquare size={18} />
          <h2>Research assistant</h2>
        </div>
        <div>
          <button
            className="icon-button"
            aria-label="Conversation history"
            title="Conversation history"
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            <History size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="New conversation"
            title="New conversation"
            disabled={busy}
            onClick={newConversation}
          >
            <Plus size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Close assistant"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="assistant-scope">
        <label>
          Workspace
          <select
            aria-label="Assistant workspace"
            disabled={busy}
            value={spaceId}
            onChange={(e) => onWorkspace(e.target.value)}
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Provider
          <select
            aria-label="Assistant provider"
            disabled={busy}
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
          >
            <option value="">Choose a provider</option>
            {providers.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.model}
              </option>
            ))}
          </select>
        </label>
      </div>
      {spaces.find((s) => s.id === spaceId)?.group_id && (
        <details className="assistant-group-scope">
          <summary>
            {scope.length === 1
              ? "One workspace"
              : `${scope.length} selected group workspaces`}
          </summary>
          <p className="ws-note">
            Only selected evidence is sent. Start a new conversation to change
            this boundary. New tasks are created in the primary workspace above.
          </p>
          {spaces
            .filter(
              (s) =>
                s.group_id === spaces.find((s) => s.id === spaceId)?.group_id,
            )
            .map((s) => (
              <label className="productivity-check" key={s.id}>
                <input
                  type="checkbox"
                  disabled={
                    !!conversationId ||
                    busy ||
                    s.id === spaceId ||
                    (!scope.includes(s.id) && scope.length >= 20)
                  }
                  checked={scope.includes(s.id)}
                  onChange={(e) => {
                    if (!e.target.checked) setPicked([]);
                    setScopeIds(
                      e.target.checked
                        ? [...scopeIds, s.id]
                        : scopeIds.filter((id) => id !== s.id),
                    );
                  }}
                />
                {s.name}
              </label>
            ))}
        </details>
      )}
      {historyOpen && (
        <section
          className="assistant-history"
          aria-label="Private conversation history"
        >
          <p>Private · retained for 30 days</p>
          {history.data?.map((c) => (
            <button
              key={c.id}
              disabled={busy}
              onClick={() => {
                setConversationId(c.id);
                setConversation(null);
                setPrepared(null);
                setReview(null);
                setHistoryOpen(false);
              }}
            >
              {c.title}
            </button>
          ))}
          {!history.data?.length && <p>No recent conversations.</p>}
        </section>
      )}
      <div className="assistant-scroll">
        <ErrorNotice message={error || loadError || providers.error} />
        {storageWarning && (
          <p className="form-error" role="alert">
            {storageWarning}{" "}
            <button onClick={() => download("assistant-prompt.txt", prompt)}>
              Export prompt
            </button>
          </p>
        )}
        {!providers.loading && !providers.data?.length && (
          <section className="assistant-empty">
            <ShieldCheck size={26} />
            <h3>Your research, your choice</h3>
            <p>
              A group administrator must enable the workspace assistant on a
              processing provider. No research is sent automatically.
            </p>
            <button
              className="button secondary"
              onClick={() => navigate("/settings/groups")}
            >
              Provider settings
            </button>
          </section>
        )}
        {!conversation?.turns.length && providers.data?.length ? (
          <section className="assistant-empty">
            <BookOpen size={27} />
            <h3>Keep the evidence close.</h3>
            <p>
              Choose excerpts, ask a question, then review what leaves your
              workspace.
            </p>
            <div>
              {[
                "Summarize the key findings and limitations.",
                "Compare the assumptions across these sources.",
                "Explain the mathematics step by step.",
                "Draft action items based on this evidence.",
              ].map((s) => (
                <button key={s} onClick={() => setPrompt(s)}>
                  {s}
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {conversation && (
          <div className="assistant-conversation-heading">
            <span title={conversation.title}>{conversation.title}</span>
            <div>
              <button
                className="icon-button"
                title="Rename conversation"
                aria-label="Rename conversation"
                onClick={() =>
                  void run(async () => {
                    const title = await promptValue("Conversation title", {
                      title: "Rename conversation",
                      defaultValue: conversation.title,
                    });
                    if (title) {
                      await api(`assistant/conversations/${conversation.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({
                          title,
                          version: conversation.version,
                        }),
                      });
                      reload();
                    }
                  })
                }
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-button"
                title="Export conversation"
                aria-label="Export conversation"
                onClick={() =>
                  void run(async () => {
                    const v = await api<{ title: string; markdown: string }>(
                      `assistant/conversations/${conversation.id}/export`,
                    );
                    download(
                      v.title.replace(/[^\p{L}\p{N} -]/gu, "").slice(0, 70) +
                        ".md",
                      v.markdown,
                    );
                  })
                }
              >
                <Download size={14} />
              </button>
              <button
                className="icon-button"
                title="Delete private conversation"
                aria-label="Delete private conversation"
                onClick={() =>
                  void run(async () => {
                    if (
                      await confirmAction(
                        "This clears private prompts, captured context, answers and unpublished proposals. Published suggestions and tasks remain.",
                        {
                          title: "Delete conversation?",
                          confirmLabel: "Delete",
                        },
                      )
                    ) {
                      await api(`assistant/conversations/${conversation.id}`, {
                        method: "DELETE",
                      });
                      newConversation();
                      history.reload();
                    }
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        )}
        {conversation?.turns.map((turn) => (
          <article className="assistant-turn" key={turn.id}>
            {turn.prompt && (
              <div className="assistant-question">{turn.prompt}</div>
            )}
            {turn.answer && (
              <>
                <AssistantAnswer
                  source={turn.answer}
                  evidence={turn.evidence ?? []}
                  spaceId={spaceId}
                />
                <button
                  className="assistant-copy"
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(turn.answer!);
                      notify(
                        "Answer copied. Verify it against the cited evidence.",
                      );
                    })
                  }
                >
                  <Copy size={13} /> Copy answer
                </button>
              </>
            )}
            {turn.warning && <p className="ws-note">{turn.warning}</p>}
            {turn.error && <p className="form-error">{turn.error}</p>}
            {["queued", "running"].includes(turn.status) ? (
              <div className="assistant-progress" role="status">
                <LoaderCircle size={15} />
                <span>
                  {turn.status === "queued"
                    ? "Queued"
                    : "Reading the reviewed context…"}
                </span>
                <button
                  onClick={() =>
                    void run(async () => {
                      await post(
                        `assistant/conversations/${conversationId}/turns/${turn.id}/cancel`,
                        {},
                      );
                      reload();
                    })
                  }
                >
                  <Square size={12} /> Cancel
                </button>
              </div>
            ) : !turn.answer && !turn.error ? (
              <p className="ws-note">
                {turn.status}. Nothing is automatically resubmitted.
              </p>
            ) : null}
            {turn.proposals?.map((item) => (
              <section key={item.id} className="assistant-proposal">
                <header>
                  <strong>
                    {item.data.kind === "schedule"
                      ? "Schedule proposal"
                      : item.data.kind === "document"
                        ? "Document suggestion"
                        : item.data.kind === "task-create"
                          ? "New task"
                          : "Task update"}
                  </strong>
                  <span>{item.state}</span>
                </header>
                <p>{item.data.explanation}</p>
                <div>
                  {item.state === "draft" && (
                    <>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => setReview({ item, turn })}
                      >
                        Review draft
                      </button>
                      <button
                        className="button ghost"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await post(
                              `assistant/proposals/${item.id}/dismiss`,
                              {},
                            );
                            reload();
                          })
                        }
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                  {item.state === "applied" && item.result && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await post(`assistant/proposals/${item.id}/undo`, {
                            receiptId: item.result!.receiptId,
                            fingerprint: item.result!.fingerprint,
                          });
                          refresh();
                          reload();
                        })
                      }
                    >
                      <Undo2 size={14} /> Undo task change
                    </button>
                  )}
                </div>
              </section>
            ))}
          </article>
        ))}
      </div>
      <form
        className="assistant-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void prepare();
        }}
      >
        <div className="assistant-context-heading">
          <button type="button" onClick={() => setSearchOpen(!searchOpen)}>
            <Plus size={14} /> Add evidence
          </button>
          <small>{picked.length}/20 · private until sent</small>
        </div>
        {searchOpen && (
          <div className="assistant-search">
            <label>
              <Search size={14} />
              <input
                aria-label="Search assistant evidence"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search selected workspaces…"
              />
            </label>
            <ErrorNotice message={searchData.error} />
            <div>
              {searchData.data?.items.map((item) => (
                <button
                  type="button"
                  key={item.kind + item.id}
                  onClick={() => void run(() => add(item))}
                >
                  <span>
                    {item.title}
                    <small>
                      {item.kind} · {item.excerpt || "Choose source"}
                    </small>
                  </span>
                  {picked.some((s) => s.id === item.id) ? (
                    <Check size={14} />
                  ) : (
                    <Plus size={14} />
                  )}
                </button>
              ))}
              {searchData.loading && <p>Searching…</p>}
              {!searchData.loading && !searchData.data?.items.length && (
                <p>No matching research sources.</p>
              )}
            </div>
            <nav>
              <button
                type="button"
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - 30))}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={searchData.data?.nextOffset == null}
                onClick={() => setOffset(searchData.data!.nextOffset!)}
              >
                Next
              </button>
            </nav>
          </div>
        )}
        {!!picked.length && (
          <ul className="assistant-picked">
            {picked.map((s, i) => (
              <li key={s.id + ":" + i}>
                <span>
                  {s.label ??
                    (s.kind === "pdf" || s.kind === "ocr"
                      ? `Page ${s.page}`
                      : `${s.kind} ${s.id.slice(0, 8)}`)}
                </span>
                {(s.kind === "document" || s.kind === "task") && (
                  <label>
                    <input
                      type="checkbox"
                      checked={s.editable}
                      onChange={(e) =>
                        setPicked((old) =>
                          old.map((v, j) =>
                            j === i ? { ...s, editable: e.target.checked } : v,
                          ),
                        )
                      }
                    />
                    Allow proposal
                  </label>
                )}
                {s.kind === "document" && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Choose excerpt ${i + 1}`}
                    title={
                      s.from !== undefined
                        ? "Edit selected excerpt"
                        : "Choose an excerpt"
                    }
                    onClick={() => setExcerpt(s)}
                  >
                    <Pencil size={13} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Remove evidence ${i + 1}`}
                  onClick={() =>
                    setPicked((old) => old.filter((_, j) => i !== j))
                  }
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="assistant-task-consent">
          <input
            type="checkbox"
            checked={allowTasks}
            onChange={(e) => setAllowTasks(e.target.checked)}
          />
          Allow private new-task drafts
        </label>
        <textarea
          ref={promptRef}
          aria-label="Assistant request"
          placeholder="Ask about your research…"
          rows={3}
          maxLength={10000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (!busy && !active) void prepare();
            }
          }}
        />
        <div className="assistant-compose-footer">
          <small>
            {recovered ? "Device draft recovered · " : ""}⌘/Ctrl Enter to review
          </small>
          <button
            className="button primary"
            disabled={busy || !!active || !prompt.trim() || !selectedProvider}
          >
            <ArrowUp size={15} />
            Review & send
          </button>
        </div>
      </form>
      {prepared && (
        <Dialog
          title="Review outgoing context"
          subtitle={`${prepared.provider.name} · ${prepared.provider.model} · managed by ${prepared.provider.group_name}`}
          onClose={() => setPrepared(null)}
        >
          <p>
            No content has been sent to the provider. This preview includes your
            request, instructions and the conversation history that will be
            transmitted.
          </p>
          <p className="ws-note">
            {prepared.characters.toLocaleString()} characters ·{" "}
            {prepared.evidence.length} current excerpts · expires{" "}
            {new Date(prepared.expiresAt).toLocaleTimeString()}
          </p>
          <div className="assistant-outgoing">
            {prepared.messages.map((message, i) => (
              <details key={i} open={i === prepared.messages.length - 1}>
                <summary>
                  {message.role === "system"
                    ? "Application instructions"
                    : message.role === "assistant"
                      ? "Previous answer"
                      : "Request and evidence"}
                </summary>
                <pre>{message.content}</pre>
              </details>
            ))}
          </div>
          <label className="assistant-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I approve sending this exact context to this provider. Its billing
            and retention policies apply.
          </label>
          <ErrorNotice message={error} />
          <div className="dialog-footer">
            <button
              className="button secondary"
              onClick={() => setPrepared(null)}
            >
              Back
            </button>
            <button
              className="button primary"
              disabled={
                busy ||
                !consent ||
                new Date(prepared.expiresAt).valueOf() <= Date.now()
              }
              onClick={() =>
                void run(async () => {
                  await post(
                    `assistant/conversations/${prepared.conversationId}/turns`,
                    {
                      contextId: prepared.id,
                      fingerprint: prepared.fingerprint,
                      consent: true,
                      mutationId: submission.current,
                    },
                  );
                  setPrepared(null);
                  setPrompt("");
                  reload();
                })
              }
            >
              Send approved context
            </button>
          </div>
        </Dialog>
      )}
      {review && (
        <AssistantProposalReview
          item={review.item}
          evidence={review.turn.evidence ?? []}
          spaceId={spaceId}
          onChange={reload}
          onClose={() => setReview(null)}
        />
      )}
      {office && (
        <AssistantOfficeExcerpt
          id={office.id}
          versionId={office.version_id!}
          format={office.format as "docx" | "pptx" | "xlsx"}
          onClose={() => setOffice(null)}
          onPick={(selection) =>
            setPicked((old) => [
              ...old.filter((s) => s.id !== selection.id),
              { ...selection, label: office.title },
            ])
          }
        />
      )}
      {excerpt && (
        <AssistantExcerpt
          selection={excerpt}
          onClose={() => setExcerpt(null)}
          onChoose={(selection, label) => {
            setPicked((old) =>
              old.map((s) =>
                s.kind === "document" && s.id === selection.id
                  ? { ...selection, label }
                  : s,
              ),
            );
            setExcerpt(null);
          }}
        />
      )}
    </>
  );
  return narrow ? (
    <Dialog
      title="Research assistant"
      className="assistant-dialog"
      onClose={onClose}
    >
      <div className="assistant-panel">{content}</div>
    </Dialog>
  ) : (
    <aside
      className="assistant-panel"
      aria-label="Workspace research assistant"
      style={{ width }}
    >
      <div
        role="separator"
        aria-label="Resize assistant"
        aria-orientation="vertical"
        aria-valuemin={360}
        aria-valuemax={640}
        aria-valuenow={width}
        tabIndex={0}
        className="assistant-resize"
        onKeyDown={(e) => {
          if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
            e.preventDefault();
            setWidth((w) =>
              Math.max(
                360,
                Math.min(640, w + (e.key === "ArrowLeft" ? 20 : -20)),
              ),
            );
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            setWidth(
              Math.max(360, Math.min(640, window.innerWidth - e.clientX)),
            );
        }}
      />
      {content}
    </aside>
  );
}
