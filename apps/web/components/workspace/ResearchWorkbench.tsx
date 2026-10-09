"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  Button,
  Checkbox,
  IconButton,
  NativeSelect,
  TextInput,
  TextArea,
} from "../ui/controls";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ExternalLink, FileText, StickyNote } from "lucide-react";
import { parseMarkdown } from "@axiom/markdown";
import type {
  EvidenceItem,
  EvidencePage,
  SynthesisPreview,
} from "@axiom/shared/research-workbench";
import { readingStatuses, type ReadingItem } from "@axiom/shared/research";
import type { Space } from "@axiom/shared/workspace";
import { api, errorMessage, timeAgo } from "../../lib/client";
import { useResearch } from "../../lib/research-store";
import Dialog, { DialogFooter } from "../Dialog";
import ResearchSearch from "./ResearchSearch";
import ReadingView from "../ReadingView";
import { Empty, ErrorNotice, Loading, useData, useWorkspace } from "./ui";
const CanvasPreview = dynamic(() => import("../tools/CanvasPlayground"), {
  ssr: false,
  loading: () => <Loading label={uiText("Opening Canvas preview…")} />,
});

export default function ResearchWorkbench({
  space,
  active = true,
  embeddedParams,
  onRoute,
}: {
  space: Space;
  active?: boolean;
  embeddedParams: URLSearchParams;
  onRoute: (changes: Record<string, string>) => void;
}) {
  useInterfaceLocale();
  const params = embeddedParams;
  const groupId = space.group_id ?? "";
  const spaceId = space.id;
  const view = ["queue", "evidence"].includes(params.get("view") ?? "")
    ? params.get("view")!
    : "overview";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const route = onRoute;
  useEffect(() => setSearch(params.get("q") ?? ""), [params.toString()]);
  const endpoint = new URLSearchParams({
    view,
    ...(groupId ? { groupId } : {}),
    ...(spaceId ? { spaceId } : {}),
    q: params.get("q") ?? "",
    author: params.get("author") ?? "mine",
    status: params.get("status") ?? "all",
  });
  return (
    <div className="evidence-workbench embedded">
      <div className="evidence-discovery">
        {view === "evidence" && (
          <NativeSelect
            aria-label={uiText("Evidence visibility")}
            value={params.get("author") ?? "mine"}
            onChange={(e) => route({ author: e.target.value })}
          >
            <option value="mine">
              <I18nText id="My annotations & bookmarks" />
            </option>
            <option value="shared">
              <I18nText id="Shared annotations" />
            </option>
            <option value="all">
              <I18nText id="All accessible evidence" />
            </option>
          </NativeSelect>
        )}
        <ResearchSearch
          label={uiText("Search research")}
          placeholder={uiText("Find a paper, passage or bookmark…")}
          value={search}
          onChange={(value) => {
            setSearch(value);
            if (!value) route({ q: "" });
          }}
          onSubmit={() => route({ q: search.trim() })}
        />
        {view === "queue" && (
          <NativeSelect
            aria-label={uiText("Reading status filter")}
            value={params.get("status") ?? "all"}
            onChange={(e) => route({ status: e.target.value })}
          >
            <option value="all">
              <I18nText id="All statuses" />
            </option>
            {Object.entries(readingStatuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      {view === "overview" && (
        <div className="evidence-introduction">
          <BookOpen size={20} />
          <p>
            <strong>
              <I18nText id="Keep the source beside the thought." />
            </strong>{" "}
            <I18nText id="Your recent reading positions, PDF annotations and bookmarks appear alongside papers and references. Reading statuses are private; shared annotations keep their original audience." />
          </p>
        </div>
      )}
      {groupId || spaceId ? (
        <EvidenceList
          key={endpoint.toString()}
          endpoint={endpoint.toString()}
          groupId={groupId || null}
          spaceId={spaceId || null}
          active={active}
        />
      ) : (
        <Loading label={uiText("Opening your research context…")} />
      )}
    </div>
  );
}
function EvidenceList({
  active,
  endpoint,
  groupId,
  spaceId,
}: {
  active: boolean;
  endpoint: string;
  groupId: string | null;
  spaceId: string | null;
}) {
  useInterfaceLocale();
  const { session, revision, navigate, notify, refresh } = useWorkspace();
  const [cursor, setCursor] = useState<string | null>(null),
    [items, setItems] = useState<EvidenceItem[]>([]),
    [selected, setSelected] = useState(new Map<string, EvidenceItem>()),
    [synthesizing, setSynthesizing] = useState(false),
    [error, setError] = useState("");
  const path = `research/workbench?${endpoint}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const visibleRevision = useRef(revision);
  if (active) visibleRevision.current = revision;
  const result = useData<EvidencePage>(path, visibleRevision.current);
  const research = useResearch(session.user.id, spaceId ?? undefined, active);
  useEffect(() => {
    if (result.data && result.path === path)
      setItems((old) =>
        cursor
          ? [
              ...new Map(
                [...old, ...result.data!.items].map((item) => [item.key, item]),
              ).values(),
            ]
          : result.data!.items,
      );
  }, [result.data, result.path, path, cursor]);
  const status = async (item: EvidenceItem, value: string) => {
    setError("");
    try {
      const current = research.entries.find(
        (entry) =>
          entry.kind === "reading" && entry.value.id === item.reading?.id,
      )?.value as ReadingItem | undefined;
      await research.saveReading(
        "reading",
        item.kind === "reference" ? "reference" : "attachment",
        item.id,
        {
          label: item.title.slice(0, 300),
          status: value as ReadingItem["data"]["status"],
        },
        current ?? item.reading ?? undefined,
      );
      setItems((old) =>
        old.map((row) =>
          row.key === item.key ? { ...row, status: value } : row,
        ),
      );
      notify("Reading status saved on this device; synchronization is queued.");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      <ErrorNotice
        message={error || result.error}
        retry={result.error ? result.reload : undefined}
      />
      {!!selected.size && (
        <div
          className="evidence-selection"
          role="toolbar"
          aria-label={uiText("Selected evidence")}
        >
          <span>
            {selected.size} <I18nText id="selected" />
          </span>
          <Button
            className="button secondary"
            onClick={() => setSynthesizing(true)}
          >
            <FileText size={15} />
            <I18nText id="Create from evidence" />
          </Button>
          <Button
            className="button ghost"
            onClick={() => setSelected(new Map())}
          >
            <I18nText id="Clear selection" />
          </Button>
        </div>
      )}
      {!items.length && result.loading ? (
        <Loading label={uiText("Gathering evidence…")} />
      ) : !items.length ? (
        <Empty title={uiText("A little room for discovery")}>
          <I18nText id="Upload a PDF, bookmark a passage or add a reference to this workspace’s library. Try another filter if you expected to find something here." />
        </Empty>
      ) : (
        <div className="evidence-list">
          {items.map((item) => {
            const selectable = ["paper", "reference", "annotation"].includes(
              item.kind,
            );
            const local = research.entries.find(
              (entry) =>
                entry.kind === "reading" &&
                !(entry.value as ReadingItem).deleted &&
                (entry.value as ReadingItem).kind === "reading" &&
                (entry.value as ReadingItem).target_id === item.id &&
                (entry.value as ReadingItem).target_type ===
                  (item.kind === "reference" ? "reference" : "attachment"),
            )?.value as ReadingItem | undefined;
            return (
              <article
                className="evidence-row"
                key={item.key}
                data-selected={selected.has(item.key) || undefined}
              >
                {selectable ? (
                  <Checkbox
                    aria-label={`Select ${item.title}`}
                    checked={selected.has(item.key)}
                    disabled={!selected.has(item.key) && selected.size >= 50}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelected((old) => {
                        const next = new Map(old);
                        if (checked) next.set(item.key, item);
                        else next.delete(item.key);
                        return next;
                      });
                    }}
                  />
                ) : (
                  <StickyNote size={16} />
                )}
                <div className="evidence-row-content">
                  <div className="evidence-row-meta">
                    <span>
                      {item.kind === "progress"
                        ? uiText("Continue reading")
                        : item.kind}
                    </span>
                    {item.page && (
                      <span>
                        <I18nText id="Page" /> {item.page}
                      </span>
                    )}
                    {item.private && (
                      <span>
                        <I18nText id="Private" />
                      </span>
                    )}
                    <time>{timeAgo(item.updated_at)}</time>
                  </div>
                  <button
                    className="evidence-title"
                    onClick={() => navigate(item.route)}
                  >
                    {item.title}
                  </button>
                  {item.detail && (
                    <p className="evidence-detail">{item.detail}</p>
                  )}
                  {item.quote && <blockquote>{item.quote}</blockquote>}
                  {item.body.trim() && (
                    <p className="evidence-body">{item.body}</p>
                  )}
                  {item.kind === "progress" &&
                    item.reading?.data.fraction !== undefined && (
                      <progress
                        aria-label={uiText("Reading progress")}
                        max={1}
                        value={item.reading.data.fraction}
                      />
                    )}
                </div>
                <div className="evidence-row-actions">
                  {["paper", "reference"].includes(item.kind) && (
                    <NativeSelect
                      aria-label={`Reading status for ${item.title}`}
                      value={local?.data.status ?? item.status ?? "want"}
                      onChange={(e) => void status(item, e.target.value)}
                    >
                      {Object.entries(readingStatuses).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                  <IconButton
                    className="icon-button"
                    aria-label={`Open ${item.title}`}
                    title={uiText("Open source")}
                    onClick={() => navigate(item.route)}
                  >
                    <ExternalLink size={16} />
                  </IconButton>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {result.data?.next && (
        <Button
          className="button secondary evidence-more"
          disabled={result.loading}
          onClick={() => setCursor(result.data!.next)}
          pending={!!result.loading}
        >
          {uiText("Load more evidence")}
        </Button>
      )}
      {synthesizing && (
        <SynthesisDialog
          items={[...selected.values()]}
          groupId={groupId}
          spaceId={spaceId}
          onClose={() => setSynthesizing(false)}
          onCreated={() => {
            setSelected(new Map());
            refresh();
          }}
        />
      )}
    </>
  );
}
function SynthesisDialog({
  items,
  groupId,
  spaceId,
  onClose,
  onCreated,
}: {
  items: EvidenceItem[];
  groupId: string | null;
  spaceId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  useInterfaceLocale();
  const { spaces, navigate, appearance } = useWorkspace();
  const writable = spaces.filter(
    (s) => s.role === "editor" && s.effective_status === "active",
  );
  const [name, setName] = useState("Research synthesis"),
    [type, setType] = useState<"markdown" | "canvas">("markdown"),
    [destination, setDestination] = useState(
      writable.find((s) => s.id === spaceId)?.id ??
        writable.find((s) => s.kind === "personal")?.id ??
        writable[0]?.id ??
        "",
    );
  const [preview, setPreview] = useState<SynthesisPreview | null>(null),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const identity = useRef({
    id: crypto.randomUUID(),
    mutationId: crypto.randomUUID(),
  });
  const parsed = useMemo(
    () => parseMarkdown(type === "markdown" ? (preview?.source ?? "") : ""),
    [preview, type],
  );
  const context = useMemo(
    () => ({
      disableImages: true,
      theme: appearance.dark ? ("dark" as const) : ("light" as const),
    }),
    [appearance.dark],
  );
  useEffect(() => {
    setPreview(null);
    setAck(false);
    identity.current = {
      id: crypto.randomUUID(),
      mutationId: crypto.randomUUID(),
    };
  }, [name, type, destination]);
  const input = {
    selection: items.map((i) => ({ kind: i.kind, id: i.id })),
    groupId,
    spaceId,
    name,
    type,
    destination,
  };
  const perform = async (create: boolean) => {
    setBusy(true);
    setError("");
    try {
      if (!create)
        setPreview(
          await api<SynthesisPreview>("research/synthesis/preview", {
            method: "POST",
            body: JSON.stringify(input),
          }),
        );
      else {
        await api("research/synthesis/create", {
          method: "POST",
          body: JSON.stringify({
            ...input,
            ...identity.current,
            expectedHash: preview?.hash,
            acknowledgePrivate: ack,
          }),
        });
        onCreated();
        onClose();
        navigate(
          `/${type === "canvas" ? "canvas" : "notes"}/${identity.current.id}`,
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={uiText("Create from evidence")}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <p className="muted">
        <I18nText id="A structured starting point from" /> {items.length}{" "}
        <I18nText id="selected sources. No AI is used; review the evidence and add your own conclusions." />
      </p>
      <ErrorNotice message={error} />
      <fieldset disabled={busy} className="synthesis-fields">
        <label>
          <I18nText id="File name" />
          <TextInput
            aria-label={uiText("File name")}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <I18nText id="Format" />
          <NativeSelect
            aria-label={uiText("Format")}
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            <option value="markdown">
              <I18nText id="Research note" />
            </option>
            <option value="canvas">
              <I18nText id="Evidence Canvas" />
            </option>
          </NativeSelect>
        </label>
        <label>
          <I18nText id="Destination workspace" />
          <NativeSelect
            aria-label={uiText("Destination workspace")}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            {writable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.kind === "personal"
                  ? uiText(" · private")
                  : uiText(" · shared")}
              </option>
            ))}
          </NativeSelect>
        </label>
      </fieldset>
      {!writable.length && (
        <p role="status">
          <I18nText id="You need an editable workspace to create a synthesis." />
        </p>
      )}
      {preview && (
        <>
          <div
            className="synthesis-preview"
            aria-label={uiText("Synthesis preview")}
          >
            {type === "markdown" ? (
              <ReadingView
                source={preview.source}
                parsed={parsed}
                context={context}
                onLink={() => {}}
              />
            ) : (
              <CanvasPreview source={preview.source} title={name} readOnly />
            )}
          </div>
          <details>
            <summary>
              <I18nText id="Exact file source" />
            </summary>
            <TextArea
              className="synthesis-source"
              readOnly
              value={preview.source}
              aria-label={uiText("Exact synthesis source")}
            />
          </details>
          <p className="muted">
            <I18nText id="Source links keep their existing permissions. Creating this file does not grant its readers access to linked originals." />
          </p>
          {preview.sharedDestination && preview.privateCount > 0 && (
            <label className="synthesis-consent">
              <Checkbox
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              <I18nText id="I understand that text from" />{" "}
              {preview.privateCount}{" "}
              <I18nText id="private sources will be copied into this shared workspace." />
            </label>
          )}
        </>
      )}
      <DialogFooter>
        <Button
          data-dialog-cancel
          className="button ghost"
          disabled={busy}
          onClick={onClose}
        >
          <I18nText id="Cancel" />
        </Button>
        <Button
          className="button secondary"
          disabled={busy || !destination || !name.trim()}
          onClick={() => void perform(false)}
        >
          {busy
            ? uiText("Working…")
            : preview
              ? "Refresh preview"
              : "Preview draft"}
        </Button>
        {preview && (
          <Button
            className="button primary"
            disabled={
              busy ||
              (preview.sharedDestination && preview.privateCount > 0 && !ack)
            }
            onClick={() => void perform(true)}
          >
            <I18nText id="Create" />{" "}
            {type === "canvas" ? uiText("Canvas") : uiText("note")}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
