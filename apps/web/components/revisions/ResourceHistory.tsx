"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  Button,
  Checkbox,
  IconButton,
  TextInput,
  NativeSelect,
  SearchField,
} from "../ui/controls";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookmarkPlus,
  CheckCheck,
  Copy,
  Download,
  History,
  Pencil,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import type {
  RevisionContent,
  RevisionPage,
  RevisionSummary,
} from "@axiom/shared/revisions";
import { api, download, timeAgo } from "../../lib/client";
import {
  ErrorNotice,
  Loading,
  mutate,
  useAction,
  useWorkspace,
  useData,
} from "../workspace/ui";
import Dialog from "../Dialog";
import RevisionDiff from "./RevisionDiff";
import RequestReview from "./RequestReview";
import ResearchTaskHandoff from "../workspace/ResearchTaskHandoff";
import { UserRoundCheck } from "lucide-react";

type Props = {
  previousVisit?: RevisionContent | null;
  imageActions?: {
    restore: (
      selected: RevisionContent,
      current: RevisionContent,
    ) => Promise<unknown>;
    copy: (selected: RevisionContent, name: string) => Promise<{ id: string }>;
  };
  initialBefore?: string;
  resourceId: string;
  canEdit: boolean;
  /** Capture once, not on each keystroke or collaboration event. */
  capture?: () => { body: string; settings?: Record<string, unknown> };
  flush: () => Promise<unknown>;
  onClose: () => void;
  onRestore: (result: any) => void;
};
const name = (v: RevisionSummary) =>
  v.label || (v.kind === "file" ? "Saved image" : "Automatic snapshot");
async function digest(source: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export default function ResourceHistory({
  previousVisit,
  imageActions,
  initialBefore,
  resourceId,
  canEdit,
  capture,
  flush,
  onClose,
  onRestore,
}: Props) {
  useInterfaceLocale();
  const { notify, open } = useWorkspace(),
    action = useAction();
  const [items, setItems] = useState<RevisionSummary[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [current, setCurrent] = useState<RevisionContent | null>(null),
    [seen, setSeen] = useState<RevisionContent | null>(null),
    [beforeId, setBeforeId] = useState(initialBefore ?? ""),
    [afterId, setAfterId] = useState("current"),
    [pair, setPair] = useState<[RevisionContent, RevisionContent] | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [named, setNamed] = useState(false),
    [dialog, setDialog] = useState<
      "milestone" | "rename" | "copy" | "restore" | null
    >(null),
    [label, setLabel] = useState(""),
    [revision, setRevision] = useState(0),
    [requestReview, setRequestReview] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const host = useRef<HTMLDivElement>(null),
    callbacks = useRef({ capture, previousVisit });
  callbacks.current = { capture, previousVisit };
  const reviewed = useRef<{
    resourceId: string;
    content: RevisionContent;
  } | null>(null);
  const base = "resources/" + resourceId + "/history";
  // This is an in-tab workspace, not a modal. Keep the document mounted behind
  // it, but inert: keyboard commands must not edit hidden content during review.
  useEffect(() => {
    const root = host.current,
      previous = document.activeElement as HTMLElement | null;
    const siblings = root?.parentElement
      ? ([...root.parentElement.children].filter(
          (n) => n !== root && n instanceof HTMLElement,
        ) as HTMLElement[])
      : [];
    const states = siblings.map((n) => n.inert);
    siblings.forEach((n) => (n.inert = true));
    root?.focus();
    return () => {
      siblings.forEach((n, i) => (n.inert = states[i]));
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController(),
      signal = controller.signal;
    setLoading(true);
    setError("");
    const local = callbacks.current.capture?.();
    void Promise.all([
      api<RevisionPage>(base, { signal }),
      api<RevisionContent>(base + "/current", { signal }),
      reviewed.current?.resourceId === resourceId
        ? Promise.resolve(reviewed.current.content)
        : callbacks.current.previousVisit !== undefined
          ? Promise.resolve(callbacks.current.previousVisit)
          : api<RevisionContent | null>(
              "resources/" + resourceId + "/review-baseline",
              { signal },
            ),
    ])
      .then(async ([page, saved, previous]) => {
        const value = local
          ? {
              ...saved,
              ...local,
              hash: await digest(local.body),
              label: "Captured current draft",
            }
          : saved;
        if (signal.aborted) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setCurrent(value);
        setSeen(previous);
        setBeforeId(
          (id) => id || page.items[0]?.id || (previous ? "seen" : "current"),
        );
        setLoading(false);
      })
      .catch((e) => {
        if (!signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [base, resourceId, revision]);
  useEffect(() => {
    if (!current || !beforeId) return;
    const controller = new AbortController();
    setPair(null);
    const read = (id: string) =>
      id === "current"
        ? Promise.resolve(current)
        : id === "seen" && seen
          ? Promise.resolve(seen)
          : api<RevisionContent>(base + "/" + encodeURIComponent(id), {
              signal: controller.signal,
            });
    void Promise.all([read(beforeId), read(afterId)])
      .then((value) => {
        if (!controller.signal.aborted) {
          setPair(value);
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [base, beforeId, afterId, current, seen, revision]);
  const selected = pair?.[0],
    choices = [
      ...new Map(
        [
          ...(current ? [current] : []),
          ...(seen ? [seen] : []),
          ...items,
          ...(pair ?? []),
        ].map((v) => [v.id, v]),
      ).values(),
    ];
  const refresh = () => setRevision((n) => n + 1);
  const exportRevision = (value: RevisionContent) => {
    if (value.download) {
      const a = document.createElement("a");
      a.href = value.download;
      a.click();
      return;
    }
    const extension =
      value.format === "latex"
        ? ".tex"
        : value.format === "markdown"
          ? ".md"
          : ".txt";
    download(
      value.title.replace(/\.(md|tex|txt)$/i, "") +
        "-" +
        (value.label ?? "revision") +
        extension,
      value.body ?? "",
      "text/plain",
    );
    if (value.settings)
      download(
        value.title + "-settings.json",
        JSON.stringify(value.settings, null, 2),
        "application/json",
      );
  };
  const submit = () =>
    action.run(async () => {
      if (!navigator.onLine)
        throw new Error(
          "Connect before changing revision history. Comparisons remain read-only.",
        );
      if (dialog === "milestone") {
        await flush();
        const saved = await mutate<{ id: string }>(base, {
          label,
          ...(current?.format !== "image" && current?.hash
            ? { expectedHash: current.hash }
            : {}),
        });
        setBeforeId(saved.id);
        refresh();
        notify("Milestone saved.");
      } else if (dialog === "rename" && selected) {
        await mutate(
          base + "/" + selected.id,
          { label, version: selected.metadataVersion },
          "PATCH",
        );
        refresh();
      } else if (dialog === "copy" && selected) {
        const result =
          selected.format === "image" && imageActions
            ? await imageActions.copy(selected, label)
            : await mutate<any>(base + "/" + selected.id + "/copy", {
                name: label,
              });
        notify("Revision opened as a separate copy.");
        open({
          id: result.id ?? result.resource?.id ?? result.resource_id,
          kind:
            selected.format === "image" || result.kind === "file"
              ? "file"
              : "note",
        });
      } else if (dialog === "restore" && selected && current) {
        await flush();
        const result =
          selected.format === "image" && imageActions
            ? await imageActions.restore(selected, current)
            : await mutate(base + "/" + selected.id + "/restore", {
                generation: current.generation,
                expectedHash: current.hash,
                expectedSettings: current.settings,
              });
        onRestore(result);
        notify(
          "Revision restored. Your previous document is retained in history.",
        );
        onClose();
      }
      setDialog(null);
    });
  return (
    <div
      ref={host}
      tabIndex={-1}
      className="revision-workspace"
      role="region"
      aria-label={uiText("Version history")}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !dialog) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="revision-header">
        <IconButton
          className="icon-button"
          aria-label={uiText("Back to document")}
          onClick={onClose}
        >
          <ArrowLeft size={18} />
        </IconButton>
        <div>
          <h2>
            <I18nText id="Version history" />
          </h2>
          <p>
            {current?.title ?? "Loading file"}{" "}
            <I18nText id="· comparisons do not change your document" />
          </p>
        </div>
        <IconButton
          className="icon-button"
          aria-label={uiText("Refresh comparison")}
          title={uiText("Capture latest draft and refresh history")}
          disabled={loading || action.busy}
          onClick={refresh}
        >
          <RefreshCw size={17} />
        </IconButton>
        {canEdit && current?.body !== null && (
          <Button
            className="button secondary"
            disabled={loading || action.busy}
            onClick={() => {
              setLabel("");
              setDialog("milestone");
            }}
          >
            <BookmarkPlus size={16} />
            <I18nText id="Name milestone" />
          </Button>
        )}
      </header>
      <ErrorNotice
        message={error || action.error}
        retry={error ? refresh : undefined}
      />
      <div className="revision-layout">
        <aside
          className="revision-timeline"
          aria-label={uiText("Revision timeline")}
        >
          <SearchField
            wrapperClassName="revision-search"
            aria-label={uiText("Filter revision history")}
            placeholder={uiText("Find a milestone or author")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="revision-filter">
            <Checkbox
              checked={named}
              onChange={(e) => setNamed(e.target.checked)}
            />
            <I18nText id="Named only" />
          </label>
          <div className="revision-timeline-scroll">
            {choices
              .filter(
                (v) =>
                  (!named || v.label) &&
                  (name(v) + " " + (v.author ?? ""))
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .map((v) => (
                <button
                  key={v.id}
                  className={
                    "revision-entry" + (beforeId === v.id ? " is-selected" : "")
                  }
                  aria-pressed={beforeId === v.id}
                  onClick={() => setBeforeId(v.id)}
                >
                  <History size={15} />
                  <span>
                    <strong>{name(v)}</strong>
                    <small>
                      {v.author ||
                        (v.kind === "current"
                          ? "This editing session"
                          : "Workspace")}{" "}
                      · {timeAgo(v.createdAt)}
                    </small>
                    {v.kind === "legacy" && (
                      <small>
                        <I18nText id="Source-only checkpoint" />
                      </small>
                    )}
                  </span>
                </button>
              ))}
            {loading && <Loading label={uiText("Loading revisions…")} />}
            {!loading && !items.length && (
              <p className="revision-notice">
                <I18nText id="No milestones yet. Save one to preserve a named moment." />
              </p>
            )}
            {cursor && (
              <Button
                className="button ghost"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const page = await api<RevisionPage>(
                      base + "?cursor=" + encodeURIComponent(cursor),
                    );
                    setItems((previous) => [
                      ...new Map(
                        [...previous, ...page.items].map((v) => [v.id, v]),
                      ).values(),
                    ]);
                    setCursor(page.nextCursor);
                  })
                }
              >
                <I18nText id="Load older revisions" />
              </Button>
            )}
          </div>
        </aside>
        <div className="revision-main">
          <div className="revision-selectors">
            <label>
              <I18nText id="Before" />
              <NativeSelect
                aria-label={uiText("Before revision")}
                value={beforeId}
                onChange={(e) => setBeforeId(e.target.value)}
              >
                {choices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {name(v)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <span aria-hidden="true">→</span>
            <label>
              <I18nText id="After" />
              <NativeSelect
                aria-label={uiText("After revision")}
                value={afterId}
                onChange={(e) => setAfterId(e.target.value)}
              >
                {choices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {name(v)}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>
          {pair ? (
            <RevisionDiff before={pair[0]} after={pair[1]} />
          ) : (
            !error && <Loading label={uiText("Preparing comparison…")} />
          )}
          <footer className="revision-actions">
            {canEdit &&
              selected?.kind === "snapshot" &&
              selected.format === "markdown" && (
                <Button variant="ghost" onClick={() => setHandoff(true)}>
                  <I18nText id="Follow-up task" />
                </Button>
              )}
            {canEdit &&
              selected &&
              ["snapshot", "file"].includes(selected.kind) && (
                <Button
                  className="button ghost"
                  onClick={() => setRequestReview(true)}
                >
                  <UserRoundCheck size={15} />
                  <I18nText id="Request review" />
                </Button>
              )}
            {selected && (
              <Button
                className="button ghost"
                onClick={() => exportRevision(selected)}
              >
                <Download size={15} />
                <I18nText id="Export before" />
              </Button>
            )}
            {canEdit &&
              selected &&
              !["current", "seen"].includes(selected.kind) && (
                <>
                  <Button
                    className="button ghost"
                    onClick={() => {
                      setLabel(selected.label ?? "");
                      setDialog("rename");
                    }}
                  >
                    <Pencil size={15} />
                    <I18nText id="Rename" />
                  </Button>
                  {(selected.body !== null || imageActions) && (
                    <Button
                      className="button ghost"
                      onClick={() => {
                        setLabel(selected.title + " — revision copy");
                        setDialog("copy");
                      }}
                    >
                      <Copy size={15} />
                      <I18nText id="Open as copy" />
                    </Button>
                  )}
                  {(selected.kind === "snapshot" ||
                    (selected.kind === "file" && imageActions)) && (
                    <Button
                      className="button secondary"
                      onClick={() => setDialog("restore")}
                    >
                      <RotateCcw size={15} />
                      <I18nText id="Restore before" />
                    </Button>
                  )}
                </>
              )}
            <Button
              className="button ghost"
              disabled={
                !pair ||
                action.busy ||
                afterId === "seen" ||
                !!pair[1].cloudRevision
              }
              title={
                pair?.[1].cloudRevision
                  ? uiText("Save an image milestone before marking it reviewed")
                  : uiText(
                      "Save the compared server revision as your next changes-since-visit baseline",
                    )
              }
              onClick={() =>
                void action.run(async () => {
                  // This is a personal read marker, not a document write. The
                  // API checks the captured hash/settings against durable server
                  // content; a transient editing-socket reconnect must not block it.
                  await api("resources/" + resourceId + "/review-baseline", {
                    method: "POST",
                    body: JSON.stringify({
                      reference: afterId,
                      expectedHash: pair?.[1].hash,
                      expectedSettings: pair?.[1].settings,
                    }),
                  });
                  const content = await api<RevisionContent>(
                    "resources/" + resourceId + "/review-baseline",
                  );
                  reviewed.current = { resourceId, content };
                  notify("Review baseline saved.");
                  refresh();
                })
              }
            >
              <CheckCheck size={15} />
              <I18nText id="Mark reviewed" />
            </Button>
          </footer>
        </div>
      </div>
      {dialog && (
        <Dialog
          title={
            dialog === "restore"
              ? uiText("Restore this revision?")
              : dialog === "copy"
                ? "Open revision as a copy"
                : dialog === "rename"
                  ? "Rename milestone"
                  : "Name a milestone"
          }
          onClose={() => !action.busy && setDialog(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {dialog === "restore" ? (
              <p>
                <I18nText id="The captured document is preserved as “Before restore”. If any edits arrived since comparison, restoration will stop and ask you to refresh. Historical revisions without settings leave current project settings unchanged." />
              </p>
            ) : (
              <label>
                <I18nText id="Name" />
                <TextInput
                  autoFocus
                  required
                  maxLength={dialog === "copy" ? 240 : 120}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={uiText("e.g. Model assumptions reviewed")}
                />
              </label>
            )}
            <ErrorNotice message={action.error} />
            <div className="dialog-footer">
              <Button
                data-dialog-cancel
                type="button"
                className="button secondary"
                disabled={action.busy}
                onClick={() => setDialog(null)}
              >
                <I18nText id="Cancel" />
              </Button>
              <Button className="button primary" disabled={action.busy}>
                {action.busy
                  ? uiText("Saving…")
                  : dialog === "restore"
                    ? "Restore revision"
                    : "Save"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      {requestReview && selected && (
        <RequestReview
          resourceId={resourceId}
          reference={selected.id}
          onClose={() => setRequestReview(false)}
          markdown={
            selected?.format === "markdown" && selected.kind === "snapshot"
          }
        />
      )}
      {handoff && selected && (
        <ManuscriptHandoff
          resourceId={resourceId}
          snapshotId={selected.id.split(":")[1]}
          title={selected.title}
          onClose={() => setHandoff(false)}
        />
      )}
    </div>
  );
}
function ManuscriptHandoff({
  resourceId,
  snapshotId,
  title,
  onClose,
}: {
  resourceId: string;
  snapshotId: string;
  title: string;
  onClose: () => void;
}) {
  useInterfaceLocale();
  const data = useData<{ space_id: string }>(`resources/${resourceId}`);
  return data.data ? (
    <ResearchTaskHandoff
      spaceId={data.data.space_id}
      endpoint={`resources/${resourceId}/research-tasks`}
      anchor={{ snapshotId }}
      title={title}
      onClose={onClose}
    />
  ) : (
    <Dialog title={uiText("Research follow-up")} onClose={onClose}>
      <Loading label={uiText("Finding the manuscript workspace…")} />
      <ErrorNotice message={data.error} retry={data.reload} />
    </Dialog>
  );
}
