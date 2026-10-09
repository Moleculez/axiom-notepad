"use client";
import { currentLocale } from "@axiom/i18n/client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  Button,
  Checkbox,
  HelpText,
  IconButton,
  Notice,
  NativeSelect,
  TextArea,
  SearchField,
  Field,
  TextInput,
} from "../ui/controls";
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
import ChangeSetReview from "./ChangeSetReview";
import AssistantWorkflows from "./AssistantWorkflows";
import AssistantContextReview from "./AssistantContextReview";
import { assistantRunBudgetSchema } from "@axiom/shared/assistant-grounding";
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
  useInterfaceLocale();
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
  const [assistantMode, setAssistantMode] = useState<
      "ask" | "prepare" | "suggest"
    >("ask"),
    [discover, setDiscover] = useState(false),
    [maxRounds, setMaxRounds] = useState("8"),
    [maxOutputTokens, setMaxOutputTokens] = useState("4096"),
    [batchReview, setBatchReview] = useState<AssistantTurn | null>(null),
    [changeSet, setChangeSet] = useState<string | null>(null);
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
    recoveryReceipts = useRef(new Map<string, string>()),
    creating = useRef<string | null>(null),
    promptRef = useRef<HTMLTextAreaElement>(null),
    lastIntent = useRef(-1),
    alive = useRef(true);
  // An async preview may finish after typing, changing providers or switching chats.
  // Only the exact still-current composition may open a consent dialog.
  const compositionKey = JSON.stringify([
    prompt,
    assistantMode,
    discover,
    maxRounds,
    maxOutputTokens,
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
    dispatching = conversation?.turns.some((t) =>
      ["queued", "running"].includes(t.status),
    ),
    active = conversation?.turns.some((t) =>
      ["queued", "running", "awaiting-review"].includes(t.status),
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
        if (["ask", "prepare", "suggest"].includes(d.mode))
          setAssistantMode(d.mode);
        setDiscover(d.discover === true);
        const budget = assistantRunBudgetSchema.safeParse(d.budget);
        if (budget.success) {
          setMaxRounds(String(budget.data.maxRounds));
          setMaxOutputTokens(String(budget.data.maxOutputTokens));
        }
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
    if (intent.conversationId) setConversationId(intent.conversationId);
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
          mode: assistantMode,
          discover,
          budget: {
            maxRounds: Number(maxRounds),
            maxOutputTokens: Number(maxOutputTokens),
          },
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
  }, [
    prompt,
    picked,
    conversationId,
    draftKey,
    draftLoaded,
    scopeIds,
    assistantMode,
    discover,
    maxRounds,
    maxOutputTokens,
  ]);
  useEffect(() => {
    setPrepared(null);
    setConsent(false);
    submission.current = crypto.randomUUID();
  }, [
    prompt,
    assistantMode,
    discover,
    maxRounds,
    maxOutputTokens,
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
            setBatchReview(null);
          }
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setConversation(null);
          setPrepared(null);
          setReview(null);
          setLoadError(e.message);
          setBatchReview(null);
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
      dispatching ? 1500 : 10000,
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
  }, [dispatching, conversationId]);
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
    setBatchReview(null);
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
      const budget = assistantRunBudgetSchema.safeParse({
        maxRounds: maxRounds.trim() ? Number(maxRounds) : NaN,
        maxOutputTokens: maxOutputTokens.trim() ? Number(maxOutputTokens) : NaN,
      });
      if (assistantMode !== "suggest" && !budget.success)
        throw new Error(
          "Choose 1–8 model calls and 128–4,096 output tokens per call.",
        );
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
          ...(assistantMode !== "suggest"
            ? { agent: { mode: assistantMode, discover, budget: budget.data } }
            : {}),
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
    if (item.format === "canvas") {
      navigate(`/notes/${item.id}`);
      notify(
        "Select the Canvas cards you want to share, then choose Ask workspace assistant.",
      );
      setSearchOpen(false);
      return;
    }
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
          <h2>
            <I18nText id="Research assistant" />
          </h2>
        </div>
        <div>
          <IconButton
            className="icon-button"
            aria-label={uiText("Conversation history")}
            title={uiText("Conversation history")}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            <History size={16} />
          </IconButton>
          <IconButton
            className="icon-button"
            aria-label={uiText("New conversation")}
            title={uiText("New conversation")}
            disabled={busy}
            onClick={newConversation}
          >
            <Plus size={17} />
          </IconButton>
          <IconButton
            className="icon-button"
            aria-label={uiText("Close assistant")}
            onClick={onClose}
          >
            <X size={17} />
          </IconButton>
        </div>
      </header>
      <div className="assistant-mode-bar">
        <label>
          <I18nText id="Mode" />
          <NativeSelect
            aria-label={uiText("Assistant mode")}
            value={assistantMode}
            disabled={busy || !!active}
            onChange={(e) =>
              setAssistantMode(e.target.value as typeof assistantMode)
            }
          >
            <option value="ask">
              <I18nText id="Ask" />
            </option>
            <option value="prepare">
              <I18nText id="Prepare changes" />
            </option>
            <option value="suggest">
              <I18nText id="Suggest edits" />
            </option>
          </NativeSelect>
        </label>
        <AssistantWorkflows
          spaceId={spaceId}
          prompt={prompt}
          onPick={(text) => {
            setPrompt(text);
            setAssistantMode("prepare");
          }}
          onReview={setChangeSet}
        />
      </div>
      <div className="assistant-scope">
        <label>
          <I18nText id="Workspace" />
          <NativeSelect
            aria-label={uiText("Assistant workspace")}
            disabled={busy}
            value={spaceId}
            onChange={(e) => onWorkspace(e.target.value)}
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          <I18nText id="Provider" />
          <NativeSelect
            aria-label={uiText("Assistant provider")}
            disabled={busy}
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
          >
            <option value="">
              <I18nText id="Choose a provider" />
            </option>
            {providers.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.model}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      {spaces.find((s) => s.id === spaceId)?.group_id && (
        <details className="assistant-group-scope">
          <summary>
            {scope.length === 1
              ? uiText("One workspace")
              : `${scope.length} selected group workspaces`}
          </summary>
          <HelpText>
            {discover
              ? uiText(
                  "Excerpts may be retrieved locally from these workspaces. Review each exact batch before it is sent.",
                )
              : uiText("Only selected evidence is sent.")}{" "}
            <I18nText id="Start a new conversation to change this boundary." />
          </HelpText>
          {spaces
            .filter(
              (s) =>
                s.group_id === spaces.find((s) => s.id === spaceId)?.group_id,
            )
            .map((s) => (
              <label className="productivity-check" key={s.id}>
                <Checkbox
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
          aria-label={uiText("Private conversation history")}
        >
          <p>
            <I18nText id="Private · retained for 30 days" />
          </p>
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
          {!history.data?.length && (
            <p>
              <I18nText id="No recent conversations." />
            </p>
          )}
        </section>
      )}
      <div className="assistant-scroll">
        <ErrorNotice message={error || loadError || providers.error} />
        {storageWarning && (
          <p className="form-error" role="alert">
            {storageWarning}{" "}
            <button onClick={() => download("assistant-prompt.txt", prompt)}>
              <I18nText id="Export prompt" />
            </button>
          </p>
        )}
        {!providers.loading && !providers.data?.length && (
          <section className="assistant-empty">
            <ShieldCheck size={26} />
            <h3>
              <I18nText id="Your research, your choice" />
            </h3>
            <p>
              <I18nText id="A group administrator must enable the workspace assistant on a processing provider. No research is sent automatically." />
            </p>
            <Button
              className="button secondary"
              onClick={() => navigate("/settings/groups")}
            >
              <I18nText id="Provider settings" />
            </Button>
          </section>
        )}
        {!conversation?.turns.length && providers.data?.length ? (
          <section className="assistant-empty">
            <BookOpen size={27} />
            <h3>
              <I18nText id="Keep the evidence close." />
            </h3>
            <p>
              <I18nText id="Choose excerpts, ask a question, then review what leaves your workspace." />
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
              <IconButton
                className="icon-button"
                title={uiText("Rename conversation")}
                aria-label={uiText("Rename conversation")}
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
              </IconButton>
              <IconButton
                className="icon-button"
                title={uiText("Export conversation")}
                aria-label={uiText("Export conversation")}
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
              </IconButton>
              <IconButton
                className="icon-button"
                title={uiText("Delete private conversation")}
                aria-label={uiText("Delete private conversation")}
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
              </IconButton>
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
                  conversationId={conversation.id}
                  turnId={turn.id}
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
                  <Copy size={13} /> <I18nText id="Copy answer" />
                </button>
              </>
            )}
            {turn.warning && <Notice tone="warning">{turn.warning}</Notice>}
            {turn.usage && (
              <HelpText>
                {turn.usage.requests} <I18nText id="request(s) · input" />{" "}
                {turn.usage.inputTokens ?? "unknown"}
                <I18nText id=", output" />{" "}
                {turn.usage.outputTokens ?? "unknown"} <I18nText id="tokens" />
                {turn.usage.missingUsage
                  ? uiText(" · Some usage was not reported")
                  : ""}
              </HelpText>
            )}
            {turn.status === "failed" && turn.recoveryFingerprint && (
              <section
                className="assistant-awaiting"
                aria-label={uiText("Local response recovery")}
              >
                <HelpText>
                  <I18nText id="The provider response is saved. Finish local processing without another provider call." />
                </HelpText>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const key = turn.id + turn.recoveryFingerprint;
                      const mutationId =
                        recoveryReceipts.current.get(key) ??
                        crypto.randomUUID();
                      recoveryReceipts.current.set(key, mutationId);
                      await post(`assistant/runs/${turn.id}/review/recover`, {
                        fingerprint: turn.recoveryFingerprint,
                        mutationId,
                      });
                      reload();
                    })
                  }
                >
                  <I18nText id="Finish saved response" />
                </Button>
              </section>
            )}
            {turn.status === "awaiting-review" && (
              <section
                className="assistant-awaiting"
                aria-label={uiText("Awaiting context approval")}
              >
                <HelpText>
                  <I18nText id="New context is held locally. Review it before the next model call." />
                </HelpText>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setBatchReview(turn)}
                >
                  <I18nText id="Review next batch" />
                </Button>
                <Button
                  type="button"
                  disabled={busy}
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
                  <I18nText id="Stop this run" />
                </Button>
              </section>
            )}
            {!!turn.activity?.length && (
              <details className="assistant-activity">
                <summary>
                  {turn.activity.at(-1)?.message} · {turn.round}/
                  {turn.budget?.maxRounds ?? 8} <I18nText id="rounds" />
                </summary>
                <ol>
                  {turn.activity.map((item, i) => (
                    <li key={i}>{item.message}</li>
                  ))}
                </ol>
              </details>
            )}
            {turn.changeSetId && (
              <section className="assistant-proposal">
                <header>
                  <strong>
                    <I18nText id="Workspace changes" />
                  </strong>
                  <span>
                    <I18nText id="Review required" />
                  </span>
                </header>
                <p>
                  <I18nText id="Review files, diffs, destinations and planning impact before applying." />
                </p>
                <Button
                  className="button secondary"
                  onClick={() => setChangeSet(turn.changeSetId!)}
                >
                  <I18nText id="Review changes" />
                </Button>
              </section>
            )}
            {turn.error && turn.status !== "awaiting-review" && (
              <p className="form-error">{turn.error}</p>
            )}
            {["queued", "running"].includes(turn.status) ? (
              <div className="assistant-progress" role="status">
                <LoaderCircle size={15} />
                <span>
                  {turn.status === "queued"
                    ? uiText("Queued")
                    : uiText("Reading the reviewed context…")}
                </span>
                <button
                  data-dialog-cancel
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
                  <Square size={12} /> <I18nText id="Cancel" />
                </button>
              </div>
            ) : turn.status !== "awaiting-review" &&
              !turn.answer &&
              !turn.error ? (
              <HelpText>
                {turn.status.replaceAll("-", " ")}
                <I18nText id=". Nothing is automatically resubmitted." />
              </HelpText>
            ) : null}
            {turn.proposals?.map((item) => (
              <section key={item.id} className="assistant-proposal">
                <header>
                  <strong>
                    {item.data.kind === "schedule"
                      ? uiText("Schedule proposal")
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
                      <Button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => setReview({ item, turn })}
                      >
                        <I18nText id="Review draft" />
                      </Button>
                      <Button
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
                        <I18nText id="Dismiss" />
                      </Button>
                    </>
                  )}
                  {item.state === "applied" && item.result && (
                    <Button
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
                      <Undo2 size={14} /> <I18nText id="Undo task change" />
                    </Button>
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
            <Plus size={14} /> <I18nText id="Add evidence" />
          </button>
          <small>{picked.length}/20 · private until sent</small>
        </div>
        {searchOpen && (
          <div className="assistant-search">
            <label>
              <SearchField
                aria-label={uiText("Search assistant evidence")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={uiText("Search selected workspaces…")}
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
              {searchData.loading && (
                <p>
                  <I18nText id="Searching…" />
                </p>
              )}
              {!searchData.loading && !searchData.data?.items.length && (
                <p>
                  <I18nText id="No matching research sources." />
                </p>
              )}
            </div>
            <nav>
              <button
                type="button"
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - 30))}
              >
                <I18nText id="Previous" />
              </button>
              <button
                type="button"
                disabled={searchData.data?.nextOffset == null}
                onClick={() => setOffset(searchData.data!.nextOffset!)}
              >
                <I18nText id="Next" />
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
                    <Checkbox
                      checked={s.editable}
                      onChange={(e) => {
                        if (e.target.checked) setAssistantMode("suggest");
                        setPicked((old) =>
                          old.map((v, j) =>
                            j === i ? { ...s, editable: e.target.checked } : v,
                          ),
                        );
                      }}
                    />
                    <I18nText id="Allow proposal" />
                  </label>
                )}
                {s.kind === "document" && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Choose excerpt ${i + 1}`}
                    title={
                      s.from !== undefined
                        ? uiText("Edit selected excerpt")
                        : uiText("Choose an excerpt")
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
        {assistantMode === "suggest" ? (
          <label className="assistant-task-consent">
            <Checkbox
              checked={allowTasks}
              onChange={(e) => setAllowTasks(e.target.checked)}
            />
            <I18nText id="Allow private new-task drafts" />
          </label>
        ) : (
          <label className="assistant-task-consent">
            <Checkbox
              checked={discover}
              onChange={(e) => setDiscover(e.target.checked)}
            />
            <I18nText id="Search and read within selected workspaces" />
          </label>
        )}
        <TextArea
          ref={promptRef}
          aria-label={uiText("Assistant request")}
          placeholder={uiText("Ask about your research…")}
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
        {assistantMode !== "suggest" && (
          <details className="assistant-run-limits">
            <summary>
              <I18nText id="Run limits" />
            </summary>
            <div className="assistant-review-range">
              <Field label={uiText("Maximum model calls")}>
                <TextInput
                  type="number"
                  min={1}
                  max={8}
                  step={1}
                  value={maxRounds}
                  onChange={(e) => setMaxRounds(e.target.value)}
                />
              </Field>
              <Field label={uiText("Output tokens per call")}>
                <TextInput
                  type="number"
                  min={128}
                  max={4096}
                  step={1}
                  value={maxOutputTokens}
                  onChange={(e) => setMaxOutputTokens(e.target.value)}
                />
              </Field>
            </div>
            <HelpText>
              <I18nText id="Each additional call requires exact-content review. These limits do not guarantee provider billing." />
            </HelpText>
          </details>
        )}
        <div className="assistant-compose-footer">
          <small>
            {recovered ? uiText("Device draft recovered · ") : ""}
            <I18nText id="⌘/Ctrl Enter to review" />
          </small>
          <Button
            className="button primary"
            disabled={busy || !!active || !prompt.trim() || !selectedProvider}
          >
            <ArrowUp size={15} />
            <I18nText id="Review & send" />
          </Button>
        </div>
      </form>
      {prepared && (
        <Dialog
          title={uiText("Review outgoing context")}
          subtitle={`${prepared.provider.name} · ${prepared.provider.model} · managed by ${prepared.provider.group_name}`}
          onClose={() => setPrepared(null)}
        >
          <p>
            <I18nText id="No content has been sent to the provider. This preview includes your request, instructions and the conversation history that will be transmitted." />
          </p>
          <HelpText>
            {prepared.characters.toLocaleString(currentLocale())}{" "}
            <I18nText id="characters ·" /> {prepared.evidence.length}{" "}
            <I18nText id="current excerpts · expires" />{" "}
            {new Date(prepared.expiresAt).toLocaleTimeString(currentLocale())}
          </HelpText>
          <HelpText>
            <I18nText id="Output ceiling:" />{" "}
            {prepared.budget?.maxOutputTokens ?? 4096}{" "}
            <I18nText id="tokens per call." />{" "}
            {prepared.agent
              ? `${prepared.budget?.maxRounds ?? 8} calls maximum; every additional batch needs review.`
              : uiText("One model call.")}{" "}
            <I18nText id="Monetary cost is not configured." />
          </HelpText>
          {prepared.agent?.discover && (
            <p className="assistant-scope-consent">
              <I18nText id="This run may search and capture relevant excerpts locally from the" />{" "}
              {scope.length} <I18nText id="selected workspace" />
              {scope.length === 1 ? "" : "s"}{" "}
              <I18nText id=". Each additional outgoing batch pauses for exact-content review. Nothing is sent under blanket discovery consent. Workspace changes require separate review." />
            </p>
          )}
          <div className="assistant-outgoing">
            {prepared.messages.map((message, i) => (
              <details key={i} open={i === prepared.messages.length - 1}>
                <summary>
                  {message.role === "system"
                    ? uiText("Application instructions")
                    : message.role === "assistant"
                      ? "Previous answer"
                      : "Request and evidence"}
                </summary>
                <pre>{message.content}</pre>
              </details>
            ))}
          </div>
          <label className="assistant-consent">
            <Checkbox
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {prepared.agent?.discover
              ? uiText(
                  "I approve this exact context and local retrieval in the selected scope, not future model calls. The provider's billing and retention policies apply.",
                )
              : uiText(
                  "I approve sending this exact context to this provider. Its billing and retention policies apply.",
                )}
          </label>
          <ErrorNotice message={error} />
          <div className="dialog-footer">
            <Button
              data-dialog-cancel
              className="button secondary"
              onClick={() => setPrepared(null)}
            >
              <I18nText id="Back" />
            </Button>
            <Button
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
              <I18nText id="Send approved context" />
            </Button>
          </div>
        </Dialog>
      )}
      {batchReview && (
        <AssistantContextReview
          runId={batchReview.id}
          legacyFingerprint={batchReview.legacyFingerprint}
          onClose={() => setBatchReview(null)}
          onChange={reload}
        />
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
      {changeSet && (
        <ChangeSetReview
          id={changeSet}
          onClose={() => setChangeSet(null)}
          onChange={reload}
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
      title={uiText("Research assistant")}
      className="assistant-dialog"
      onClose={onClose}
    >
      <div className="assistant-panel">{content}</div>
    </Dialog>
  ) : (
    <aside
      className="assistant-panel"
      aria-label={uiText("Workspace research assistant")}
      style={{ width }}
    >
      <div
        role="separator"
        aria-label={uiText("Resize assistant")}
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
