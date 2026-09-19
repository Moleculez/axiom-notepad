"use client";
import FilePreviewSurface from "../tools/FilePreviewSurface";
import ResourceDiscussion from "../tools/ResourceDiscussion";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Suggestion } from "@axiom/shared/revisions";
const SuggestionEditor = dynamic(
  () => import("../revisions/SuggestionEditor"),
  { ssr: false },
);
const SuggestionReview = dynamic(
  () => import("../revisions/SuggestionReview"),
  { ssr: false },
);
const ResourceHistory = dynamic(() => import("../revisions/ResourceHistory"), {
  ssr: false,
});
import {
  ArrowUpRight,
  Bold,
  BookOpen,
  BookmarkPlus,
  Code2,
  Download,
  FileText,
  FilePenLine,
  History,
  ImagePlus,
  Italic,
  List,
  ListChecks,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Quote,
  Search,
  Sigma,
  Table2,
  X,
} from "lucide-react";
import {
  parseMarkdown,
  documentIndex,
  nodeAt,
  slug,
  type ParsedDocument,
  type RenderContext,
} from "@axiom/markdown";
import type { Note } from "@axiom/shared/access";
import type { Resource, Space } from "@axiom/shared/workspace";
import { fileRoute } from "@axiom/shared/file-routes";
import { tabRoute } from "@axiom/shared/application-tabs";
import {
  editorCommands,
  eventBinding,
  keysFor,
  shortcutPlatform,
  type EditorCommandId,
} from "@axiom/shared/editor";
import { scrollFraction, type ReadingItem } from "@axiom/shared/research";
import {
  api,
  cacheAvailable,
  download,
  post,
  SIGN_OUT_PENDING,
  timeAgo,
} from "../../lib/client";
import { useResearch } from "../../lib/research-store";
import { useNoteThreads } from "../../lib/note-marks-store";
import ReadingMarks from "../ReadingMarks";
import { publishTabTitle, useAppTabs } from "../../lib/application-tabs";
import {
  recoveryDrafts,
  retainDraft,
  type RecoveryDraft,
} from "../../lib/editor-recovery";
import { openExternalEditorLink } from "../../lib/editor-links";
import { sectionAtPosition, type OutlineHeading } from "../../lib/outline";
import type { EditorHandle, EditorMode, CommentAnchor } from "../Editor";
import Dialog from "../Dialog";
import TableOfContents from "../TableOfContents";
import NoteTitle from "../NoteTitle";
import DocumentStatistics from "../DocumentStatistics";
import ResourceSharing from "./ResourceSharing";
import InsertResource from "./InsertResource";
import { useRevisionVisit } from "../../lib/revision-visit";
import ReadingView from "../ReadingView";
import EquationInspector from "../EquationInspector";
import { literalBody, literalPrefix } from "@axiom/editor/literal";
import {
  pendingMathBridge,
  storeMathBridge,
  mathBridgeReplacement,
  type MathNoteBridge,
} from "../../lib/tools/math-note-bridge";
import CommandPalette from "../CommandPalette";
import TablePicker from "../TablePicker";
import { ResourceInspector } from "./Explorer";
import {
  Badge,
  bytes,
  Empty,
  ErrorNotice,
  Loading,
  mutate,
  ResourceIcon,
  useAction,
  useData,
  useLocation,
  useWorkspace,
  go,
} from "./ui";
const StudioFile = dynamic(() => import("./StudioFile"), {
  ssr: false,
  loading: () => <Loading label="Opening file editor…" />,
});

const Editor = dynamic(() => import("../Editor"), {
  ssr: false,
  loading: () => <Loading label="Opening research editor…" />,
});
const PdfViewer = dynamic(() => import("../PdfViewer"), {
  ssr: false,
  loading: () => <Loading label="Opening PDF reader…" />,
});
type Tab = Pick<Resource, "id" | "kind"> & {
  name?: string;
  versionId?: string;
  viewId?: string;
  route?: string;
  document_type?: Resource["document_type"];
  mime?: string | null;
};
const tabPath = (tab: Tab) => tab.route ?? fileRoute(tab, tab.versionId);
type ViewState = {
  mode: EditorMode;
  scroll: number;
  panel: string | null;
  collapsed: string[];
};
const documentViews = new Map<string, ViewState>();
type NoteContext = {
  space: Space;
  notes: Pick<Note, "id" | "title">[];
  references: any[];
  members: any[];
  links: any[];
};

export default function Workbench({
  resource,
  splitTarget,
  onSplitHandled,
}: {
  resource: Tab;
  splitTarget: Tab | null;
  onSplitHandled: () => void;
}) {
  const [secondary, setSecondary] = useState<Tab | null>(null),
    [active, setActive] = useState<"primary" | "secondary">("primary"),
    [ratio, setRatio] = useState(50);
  const panes = useRef<HTMLDivElement>(null);
  const primary = resource;
  useEffect(() => {
    if (!splitTarget) return;
    if (tabPath(splitTarget) !== tabPath(resource)) {
      setSecondary(splitTarget);
      setActive("secondary");
    }
    onSplitHandled();
  }, [splitTarget]);
  useEffect(() => {
    if (secondary && tabPath(secondary) === tabPath(resource))
      setSecondary(null);
    setActive("primary");
  }, [resource.id, resource.versionId]);
  const name = (id: string, title: string) => {
    if (id === resource.id) publishTabTitle(tabPath(resource), title);
  };
  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const separator = event.currentTarget;
    separator.setPointerCapture(event.pointerId);
    const move = (event: PointerEvent) => {
      const rect = panes.current?.getBoundingClientRect();
      if (rect)
        setRatio(
          Math.max(
            30,
            Math.min(70, ((event.clientX - rect.left) / rect.width) * 100),
          ),
        );
    };
    const done = () => {
      separator.removeEventListener("pointermove", move);
      separator.removeEventListener("pointerup", done);
      separator.removeEventListener("pointercancel", done);
    };
    separator.addEventListener("pointermove", move);
    separator.addEventListener("pointerup", done);
    separator.addEventListener("pointercancel", done);
  };
  return (
    <section className="ws-workbench">
      {secondary && (
        <div className="ws-pane-switcher">
          <button
            aria-pressed={active === "primary"}
            onClick={() => setActive("primary")}
          >
            Left pane
          </button>
          <button
            aria-pressed={active === "secondary"}
            onClick={() => setActive("secondary")}
          >
            Right pane
          </button>
          <span className="ws-spacer" />
          <button
            className="icon-button"
            aria-label="Close split view"
            onClick={() => {
              setSecondary(null);
              setActive("primary");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div
        ref={panes}
        className={`ws-document-panes ${secondary ? "split" : ""}`}
        style={
          secondary
            ? { gridTemplateColumns: `${ratio}fr 5px ${100 - ratio}fr` }
            : undefined
        }
      >
        <div
          className={`ws-document-pane ${active === "primary" ? "active" : ""}`}
          onFocusCapture={() => setActive("primary")}
          onPointerDownCapture={() => setActive("primary")}
        >
          <ResourcePane
            key={`${primary.viewId ?? "primary"}:${primary.id}:${primary.versionId ?? "current"}`}
            tab={primary}
            active={active === "primary"}
            onName={name}
          />
        </div>
        {secondary && (
          <>
            <div
              className="ws-pane-divider"
              role="separator"
              aria-label="Resize document panes"
              aria-orientation="vertical"
              aria-valuenow={Math.round(ratio)}
              aria-valuemin={30}
              aria-valuemax={70}
              tabIndex={0}
              onPointerDown={drag}
              onKeyDown={(event) => {
                if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) {
                  event.preventDefault();
                  setRatio((value) =>
                    event.key === "Home"
                      ? 50
                      : Math.max(
                          30,
                          Math.min(
                            70,
                            value + (event.key === "ArrowLeft" ? -5 : 5),
                          ),
                        ),
                  );
                }
              }}
            />
            <div
              className={`ws-document-pane ${active === "secondary" ? "active" : ""}`}
              onFocusCapture={() => setActive("secondary")}
              onPointerDownCapture={() => setActive("secondary")}
            >
              <ResourcePane
                key={secondary.viewId ?? tabPath(secondary)}
                tab={secondary}
                active={active === "secondary"}
                onName={name}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
function useCachedData<T>(path: string, account: string, revision: number) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(),
      key = `axiom:document:${account}:${path}`;
    void api<T>(path, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted || localStorage.getItem(SIGN_OUT_PENDING))
          return;
        setData(value);
        setError("");
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* Yjs journal has its own durable save status. */
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (cacheAvailable(error) && !localStorage.getItem(SIGN_OUT_PENDING)) {
          try {
            const cached = JSON.parse(localStorage.getItem(key) ?? "null");
            if (cached) {
              setData(cached);
              setError("");
              return;
            }
          } catch {
            /* Reconnect to fetch a valid copy. */
          }
        }
        setData(null);
        setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, account, revision, retry]);
  return { data, error, loading, reload: () => setRetry((value) => value + 1) };
}
function ResourcePane({
  tab,
  active,
  onName,
}: {
  tab: Tab;
  active: boolean;
  onName: (id: string, name: string) => void;
}) {
  const { session, revision } = useWorkspace(),
    data = useCachedData<Resource>(
      `resources/${tab.id}`,
      session.user.id,
      revision,
    );
  useEffect(() => {
    if (data.data) onName(tab.id, data.data.name);
  }, [data.data, tab.id]);
  useEffect(() => {
    if (navigator.onLine)
      void post(`resources/${tab.id}/opened`).catch(() => {});
  }, [tab.id]);
  useEffect(() => {
    if (!data.data || !tab.route) return;
    const current = new URL(tab.route, "http://workspace.local");
    const canonical = new URL(fileRoute(data.data), current);
    canonical.search = current.search;
    canonical.hash = current.hash;
    const destination = canonical.pathname + canonical.search + canonical.hash;
    if (
      tabRoute(destination) !== tabRoute(tab.route) &&
      location.pathname + location.search + location.hash ===
        "/workbench" + tab.route
    ) {
      window.dispatchEvent(
        new CustomEvent("axiom:canonical-file", {
          detail: { from: tab.route, to: destination },
        }),
      );
      go(destination, true, true);
    }
  }, [data.data, tab.route]);
  return data.data ? (
    data.data.document_type &&
    data.data.document_type !== "markdown" &&
    !(
      data.data.kind === "file" &&
      tab.versionId &&
      !new URL(tab.route ?? "/", "http://workspace.local").searchParams.has(
        "file",
      )
    ) ? (
      <StudioFile resource={data.data} route={tab.route} />
    ) : data.data.kind === "note" ? (
      <MarkdownFile tab={tab} active={active} />
    ) : (
      <FilePane resource={data.data} requestedVersion={tab.versionId} />
    )
  ) : (
    <>
      <ErrorNotice message={data.error} retry={data.reload} />
      {data.loading && <Loading label={`Opening ${tab.kind}…`} />}
    </>
  );
}

function MarkdownFile({ tab, active }: { tab: Tab; active: boolean }) {
  const { session, revision } = useWorkspace();
  const data = useCachedData<Note>(
    `notes/${tab.id}`,
    session.user.id,
    revision,
  );
  return data.data ? (
    <DocumentPane
      metadata={data.data}
      viewId={tab.viewId}
      active={active}
      reload={data.reload}
    />
  ) : (
    <>
      <ErrorNotice message={data.error} retry={data.reload} />
      {data.loading && <Loading label="Opening note…" />}
    </>
  );
}

function DocumentPane({
  metadata,
  viewId,
  active,
  reload,
}: {
  metadata: Note;
  viewId?: string;
  active: boolean;
  reload: () => void;
}) {
  const tabs = useAppTabs();
  const stored = tabs?.state.tabs.find((tab) => tab.id === viewId)?.view;
  const {
      session,
      appearance,
      editorSettings,
      revision,
      refresh,
      navigate,
      open,
      notify,
      upload,
    } = useWorkspace(),
    key = `${session.user.id}:${metadata.id}:${viewId ?? "default"}`,
    savedView =
      documentViews.get(key) ??
      (stored
        ? {
            mode:
              (stored.mode as EditorMode | undefined) ??
              (metadata.role === "editor" ? "write" : "read"),
            scroll: Number(stored.scroll) || 0,
            panel:
              stored.panel === null ? null : String(stored.panel ?? "outline"),
            collapsed: [],
          }
        : undefined);
  const [note, setNote] = useState(metadata),
    [mode, setMode] = useState<EditorMode>(
      savedView?.mode ?? (metadata.role === "editor" ? "write" : "read"),
    ),
    [source, setSource] = useState(metadata.body),
    [parsed, setParsed] = useState<ParsedDocument>(() =>
      parseMarkdown(metadata.body),
    ),
    [status, setStatus] = useState("Connecting…"),
    [presence, setPresence] = useState<any[]>([]),
    [panel, setPanel] = useState<string | null>(
      savedView ? savedView.panel : "outline",
    ),
    [collapsed, setCollapsed] = useState<string[]>(savedView?.collapsed ?? []),
    [section, setSection] = useState<string | null>(null),
    [error, setError] = useState(""),
    [readingWarning, setReadingWarning] = useState(""),
    [modal, setModal] = useState<
      "commands" | "insert" | "table" | "files" | "links" | "history" | null
    >(null),
    [review, setReview] = useState(false),
    [proposal, setProposal] = useState<Suggestion | "new" | null>(null),
    [recovered, setRecovered] = useState(""),
    [recoveries, setRecoveries] = useState<RecoveryDraft[]>([]),
    [comment, setComment] = useState(""),
    [reply, setReply] = useState<string | null>(null),
    [anchor, setAnchor] = useState<CommentAnchor | null>(null),
    [marksHost, setMarksHost] = useState<HTMLDivElement | null>(null),
    [minimapHost, setMinimapHost] = useState<HTMLDivElement | null>(null),
    [markOpen, setMarkOpen] = useState<string | null>(null),
    [unresolvedComments, setUnresolvedComments] = useState<string[]>([]),
    [activeDiscussion, setActiveDiscussion] = useState<string | null>(null);
  const reviewLocation = useLocation(),
    requestedReview = reviewLocation.params.get("review");
  const previousVisit = useRevisionVisit(session.user.id, note.id, active);
  useEffect(() => {
    if (
      active &&
      requestedReview === "suggestions" &&
      reviewLocation.path.endsWith("/" + note.id)
    )
      setReview(true);
  }, [active, requestedReview, reviewLocation.path, note.id]);
  const context = useCachedData<NoteContext>(
      `notes/${note.id}/context`,
      session.user.id,
      revision,
    ),
    comments = useNoteThreads(session.user, note.id, revision, active),
    action = useAction();
  const research = useResearch(
    session.user.id,
    context.data?.space.kind === "personal"
      ? context.data.space.id
      : (context.data?.space.group_id ?? undefined),
  );
  const editor = useRef<EditorHandle>(null),
    scroller = useRef<HTMLDivElement>(null),
    commandRef = useRef<
      (id: EditorCommandId, insertionPrepared?: boolean) => void
    >(() => {}),
    viewRef = useRef<ViewState>({
      mode,
      scroll: savedView?.scroll ?? 0,
      panel,
      collapsed,
    }),
    touched = useRef(false),
    progressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    initializedScroll = useRef(false),
    resumedProgress = useRef(false);
  viewRef.current = { ...viewRef.current, mode, panel, collapsed };
  const readonly = metadata.role !== "editor" || !!metadata.deleted_at,
    canComment = metadata.role === "editor" || metadata.role === "commenter",
    remoteVersion = metadata.generation !== note.generation;
  const [mathReturn, setMathReturn] = useState<MathNoteBridge | null>(null),
    [mathReturnError, setMathReturnError] = useState("");
  const openingMath = useRef(false);
  useEffect(() => {
    if (!active) return;
    try {
      setMathReturn(pendingMathBridge(session.user.id, note.id));
    } catch {
      /* The source project still has its complete equation. */
    }
  }, [note.id, session.user.id, active]);
  const dismissMathReturn = () => {
    try {
      if (mathReturn)
        storeMathBridge(session.user.id, { ...mathReturn, result: undefined });
      setMathReturn(null);
      setMathReturnError("");
    } catch {
      setMathReturnError(
        "Device storage is unavailable. Your complete equation remains in Math Studio.",
      );
    }
  };
  useEffect(() => {
    const narrow = matchMedia("(max-width: 850px)");
    const collapse = () => {
      if (narrow.matches) setPanel(null);
    };
    collapse();
    narrow.addEventListener("change", collapse);
    return () => narrow.removeEventListener("change", collapse);
  }, []);
  useEffect(() => {
    try {
      const drafts = recoveryDrafts(session.user.id, note.id);
      setRecoveries(drafts);
      if (drafts[0]) setRecovered(drafts[0].source);
    } catch {
      /* Existing in-memory recovery remains available. */
    }
  }, [session.user.id, note.id]);
  useEffect(() => {
    if (metadata.generation === note.generation) setNote(metadata);
  }, [metadata]);
  useEffect(
    () => () => {
      documentViews.set(key, viewRef.current);
      if (viewId)
        tabs?.update(viewId, {
          view: {
            mode: viewRef.current.mode,
            panel: viewRef.current.panel,
            scroll: viewRef.current.scroll,
          },
        });
      clearTimeout(progressTimer.current);
    },
    [key],
  );
  useEffect(() => {
    if (
      !initializedScroll.current &&
      status !== "Connecting…" &&
      scroller.current
    ) {
      scroller.current.scrollTop = savedView?.scroll ?? 0;
      initializedScroll.current = true;
    }
  }, [status]);
  useEffect(() => {
    if (
      savedView ||
      touched.current ||
      resumedProgress.current ||
      location.hash ||
      status === "Connecting…"
    )
      return;
    const progress = research.entries.find(
      (entry) =>
        entry.kind === "reading" &&
        !entry.value.deleted &&
        (entry.value as ReadingItem).kind === "progress" &&
        (entry.value as ReadingItem).target_id === note.id,
    )?.value as ReadingItem | undefined;
    const fraction = progress?.data.fraction;
    if (typeof fraction !== "number" || !Number.isFinite(fraction)) return;
    const frame = requestAnimationFrame(() => {
      const node = scroller.current;
      if (!node || touched.current) return;
      node.scrollTop =
        Math.max(0, Math.min(1, fraction)) *
        Math.max(0, node.scrollHeight - node.clientHeight);
      viewRef.current.scroll = node.scrollTop;
      resumedProgress.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [research.entries, status, source, note.id]);
  useEffect(() => {
    const warning = (event: BeforeUnloadEvent) => {
      if (
        status.includes("storage unavailable") ||
        status.includes("Saving on device")
      )
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warning);
    return () => window.removeEventListener("beforeunload", warning);
  }, [status]);
  const renderContext = useMemo<RenderContext>(
    () => ({
      theme: appearance.dark ? "dark" : "light",
      references: Object.fromEntries(
        (context.data?.references ?? []).map((reference) => [
          reference.cite_key,
          reference,
        ]),
      ),
      resolveLink: (target) => {
        const [identity, heading] = target.split("#"),
          matches =
            context.data?.notes.filter(
              (item) =>
                item.id === identity ||
                item.title.toLowerCase() === identity.toLowerCase(),
            ) ?? [];
        return matches.length === 1
          ? {
              href: `/workbench/notes/${matches[0].id}${heading ? "#" + encodeURIComponent(slug(heading)) : ""}`,
              title: matches[0].title,
            }
          : undefined;
      },
    }),
    [context.data, appearance.dark],
  );
  const navigateSection = (heading: OutlineHeading) => {
    setSection(heading.id);
    if (mode === "read")
      scroller.current
        ?.querySelector(
          `.read-mount:not(.print-only) [id="${CSS.escape(heading.id)}"]`,
        )
        ?.scrollIntoView({ block: "start", behavior: "instant" });
    else editor.current?.focus(heading.from);
  };
  const openLink = async (target: string) => {
    if (openExternalEditorLink(target)) return;
    if (target.startsWith("#")) {
      const heading = parsed.outline.find(
        (item) =>
          item.id === target.slice(1) || item.id === slug(target.slice(1)),
      );
      if (heading) navigateSection(heading);
      return;
    }
    const attachment = /^\/api\/v1\/attachments\/([\da-f-]{36})/.exec(target);
    if (attachment) {
      try {
        const result = await api(`attachments/${attachment[1]}/resource`);
        open({ kind: "file", id: result.id, versionId: attachment[1] }, true);
      } catch (error) {
        setError((error as Error).message);
      }
      return;
    }
    const identity = target.split("#")[0],
      local =
        context.data?.notes.filter(
          (item) =>
            item.id === identity ||
            item.title.toLowerCase() === identity.toLowerCase(),
        ) ?? [];
    if (local.length === 1) {
      navigate(
        `/notes/${local[0].id}${target.includes("#") ? "#" + encodeURIComponent(slug(target.split("#")[1])) : ""}`,
      );
      return;
    }
    if (/^[\da-f-]{36}$/.test(identity)) {
      navigate(`/notes/${identity}`);
      return;
    }
    navigate(`/explorer?view=all&kind=note&q=${encodeURIComponent(identity)}`);
  };
  commandRef.current = (id: EditorCommandId, insertionPrepared = false) => {
    if (id === "source") {
      setMode((current) => (current === "source" ? "write" : "source"));
      requestAnimationFrame(() => editor.current?.focus());
    } else if (id === "comment") {
      if (!canComment) {
        setError("Commenter or editor access is required to add a discussion.");
        return;
      }
      setAnchor(editor.current?.anchor() ?? null);
      setPanel("comments");
    } else if (id === "outline")
      setPanel((value) => (value === "outline" ? null : "outline"));
    else if (id === "minimap" || id === "focusMinimap") {
      const minimap = appearance.preferences.minimap;
      appearance.apply(
        {
          ...appearance.preferences,
          minimap: {
            ...minimap,
            enabled: id === "focusMinimap" || !minimap.enabled,
            ...(id === "focusMinimap" ? { [mode]: true } : {}),
          },
        },
        appearance.device,
      );
      if (id === "focusMinimap")
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            scroller.current?.dispatchEvent(
              new CustomEvent("axiom:minimap-command", { detail: "focus" }),
            ),
          ),
        );
    } else if (id === "returnToCursor") {
      scroller.current?.dispatchEvent(
        new CustomEvent("axiom:minimap-command", { detail: "return" }),
      );
    } else if (id === "focusMode")
      appearance.apply(
        {
          ...appearance.preferences,
          focusMode: !appearance.preferences.focusMode,
        },
        appearance.device,
      );
    else if (id === "shortcuts")
      navigate("/settings/appearance?section=Keyboard%20shortcuts");
    else if (id === "searchNotes") {
      window.dispatchEvent(new Event("axiom:search"));
    } else if (id === "commands") {
      editor.current?.prepareInsert();
      setModal("commands");
    } else if (id === "attachment") {
      if (!readonly) {
        // Engine commands already bookmarked the slash query, which need not
        // equal the visible selection. Toolbar commands still prepare here.
        if (!insertionPrepared) editor.current?.prepareInsert();
        setModal("files");
      }
    } else if (id === "table") {
      if (!readonly) setModal("table");
    } else {
      if (readonly && !["find", "copyMarkdown", "copyCode"].includes(id)) {
        setError("Editor access is required to change this note.");
        return;
      }
      if (mode === "read") setMode("write");
      editor.current?.execute(id);
    }
  };
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.getModifierState("AltGraph") ||
        document.querySelector("dialog[open]") ||
        (event.target as Element)?.closest(
          "input,textarea,select,[contenteditable=true]:not(.native-content)",
        )
      )
        return;
      const binding = eventBinding(event, shortcutPlatform());
      const command = editorCommands.find(
        (item) =>
          item.scope === "workspace" &&
          keysFor(
            item.id,
            editorSettings.effective,
            shortcutPlatform(),
          ).includes(binding),
      );
      if (command) {
        event.preventDefault();
        commandRef.current(command.id);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [active, editorSettings.effective]);
  useEffect(() => {
    if (!active || !location.hash || status === "Connecting…") return;
    try {
      const hash = decodeURIComponent(location.hash.slice(1)),
        heading = parsed.outline.find((item) => item.id === hash);
      if (heading) navigateSection(heading);
    } catch {
      /* Ignore malformed fragments. */
    }
  }, [note.id, status === "Connecting…"]);
  const closeModal = () => {
    editor.current?.cancelInsert();
    setModal(null);
  };
  const change = (body: string, parsed: ParsedDocument) => {
    setSource(body);
    setParsed(parsed);
  };
  const scroll = () => {
    const node = scroller.current;
    if (!node) return;
    viewRef.current.scroll = node.scrollTop;
    const top = node.getBoundingClientRect().top + 50;
    if (mode !== "read") {
      const position = editor.current?.visiblePosition(top);
      if (position != null)
        setSection(sectionAtPosition(parsed.outline, position));
    } else {
      let selected = parsed.outline[0]?.id ?? null;
      for (const heading of node.querySelectorAll<HTMLElement>(
        ".read-mount:not(.print-only) :is(h1,h2,h3,h4,h5,h6)[id]",
      )) {
        if (heading.getBoundingClientRect().top > top) break;
        selected = heading.id;
      }
      setSection(selected);
    }
    if (!touched.current || !context.data) return;
    clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      void research
        .saveReading("progress", "note", note.id, {
          label: note.title,
          fraction: scrollFraction(node),
        })
        .then(() => setReadingWarning(""))
        .catch(() =>
          setReadingWarning(
            "Reading position could not be saved. Your document saves separately.",
          ),
        );
    }, 700);
  };
  return (
    <section
      className={`ws-document ${appearance.effective.focusMode ? "focus-mode" : ""}`}
      aria-label={`Document ${note.title}`}
    >
      {mathReturn && (
        <Dialog
          title="Review equation from Math Studio"
          onClose={dismissMathReturn}
        >
          <p>
            Apply this result only if the original equation is unchanged. Edits
            elsewhere in the note are preserved; a changed equation or restored
            note generation will not be overwritten.
          </p>
          <pre className="tool-submission-source">{mathReturn.result}</pre>
          <ErrorNotice message={mathReturnError} />
          <div className="dialog-footer">
            <button className="button secondary" onClick={dismissMathReturn}>
              Keep note unchanged
            </button>
            <button
              className="button secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(mathReturn.result ?? "")
                  .then(() => notify("LaTeX copied."))
                  .catch(() =>
                    setMathReturnError(
                      "Clipboard unavailable. Select and copy the source above.",
                    ),
                  )
              }
            >
              Copy LaTeX
            </button>
            <button
              className="button primary"
              disabled={
                readonly ||
                mode === "read" ||
                !status.includes("Saved on server")
              }
              onClick={() => {
                if (
                  !editor.current?.replaceSourceRange(
                    mathReturn.anchor,
                    mathBridgeReplacement(mathReturn),
                  )
                ) {
                  setMathReturnError(
                    "The original equation or its access changed. Nothing was overwritten. Copy the LaTeX and choose a new insertion point.",
                  );
                  return;
                }
                dismissMathReturn();
                notify(
                  "Equation applied. Undo is available in the note editor.",
                );
              }}
            >
              Apply to original equation
            </button>
          </div>
        </Dialog>
      )}
      <header className="ws-document-toolbar">
        <div className="ws-segmented" aria-label="Editor mode">
          {[
            ["write", "Write"],
            ["source", "Source"],
            ["read", "Read"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={mode === value}
              onClick={() => setMode(value as EditorMode)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ws-document-status" role="status">
          {status}
        </span>
        <div className="ws-presence" aria-label="Collaborators online">
          {presence.map((person) => (
            <button
              key={person.clientId ?? person.id}
              title={`Jump to ${person.name}`}
              aria-label={`Jump to ${person.name}`}
              onClick={() => {
                if (
                  person.clientId === undefined ||
                  !editor.current?.jumpToCollaborator(person.clientId)
                )
                  notify("This collaborator has not placed a cursor yet.");
              }}
            >
              {person.name
                .split(" ")
                .map((word: string) => word[0])
                .slice(0, 2)
                .join("")}
            </button>
          ))}
        </div>
        <ResourceSharing resourceId={note.id} />
        {canComment && (
          <button
            className="icon-button"
            aria-label="Review suggestions"
            title="Review and suggest edits"
            onClick={() => setReview(true)}
          >
            <FilePenLine size={17} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Document history"
          onClick={() => setModal("history")}
        >
          <History size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="Toggle document panel"
          aria-expanded={!!panel}
          onClick={() => setPanel(panel ? null : "outline")}
        >
          {panel ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
        </button>
      </header>
      {!readonly &&
        mode !== "read" &&
        editorSettings.effective.formattingBar && (
          <div
            className="ws-format-toolbar"
            role="toolbar"
            aria-label="Format note"
          >
            {(
              [
                ["bold", Bold],
                ["italic", Italic],
                ["heading2", FileText],
                ["task", ListChecks],
                ["quote", Quote],
                ["mathBlock", Sigma],
                ["codeBlock", Code2],
                ["table", Table2],
                ["attachment", ImagePlus],
              ] as const
            ).map(([id, Icon]) => (
              <button
                key={id}
                className="icon-button"
                title={
                  editorCommands.find((command) => command.id === id)?.label ??
                  id
                }
                aria-label={
                  editorCommands.find((command) => command.id === id)?.label ??
                  id
                }
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commandRef.current(id)}
              >
                <Icon size={16} />
              </button>
            ))}
            <span className="ws-format-divider" />
            <button
              className="button secondary"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                editor.current?.prepareInsert();
                setModal("insert");
              }}
            >
              <Plus size={14} />
              Insert
            </button>
            <button
              className="icon-button"
              aria-label="Editor commands"
              title="Editor commands"
              onClick={() => commandRef.current("commands")}
            >
              <Search size={16} />
            </button>
            {canComment && (
              <button
                className="icon-button"
                aria-label="Comment on selection"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setAnchor(editor.current?.anchor() ?? null);
                  setPanel("comments");
                }}
              >
                <MessageSquare size={16} />
              </button>
            )}
          </div>
        )}
      <ErrorNotice
        message={error || action.error}
        retry={error ? () => setError("") : undefined}
      />
      {readingWarning && (
        <div className="ws-note" role="status">
          {readingWarning}{" "}
          <button className="text-button" onClick={scroll}>
            Retry reading position
          </button>
        </div>
      )}
      {remoteVersion && (
        <div className="ws-note">
          A restored revision is available. Your current draft is retained.
          <div className="ws-actions">
            <button
              className="button secondary"
              onClick={() =>
                download(
                  note.title + "-local.md",
                  editor.current?.text() ?? source,
                )
              }
            >
              Export local draft
            </button>
            <button
              className="button primary"
              onClick={() => {
                setRecovered(editor.current?.text() ?? source);
                setNote(metadata);
                setSource(metadata.body);
                setParsed(parseMarkdown(metadata.body));
              }}
            >
              Open restored revision
            </button>
          </div>
        </div>
      )}
      {readonly && (
        <div className="ws-document-access">
          <Badge>{metadata.role ?? "viewer"}</Badge>
          <span>
            {canComment
              ? "You can read and comment. Editing requires editor access."
              : "Read-only access. Ask a project lead to change your role."}
          </span>
        </div>
      )}
      <div className="ws-document-body">
        <div className="ws-document-main">
          <div className="document-navigation-row">
            <div
              ref={scroller}
              id={`document-scroll-${viewId ?? note.id}`}
              tabIndex={-1}
              className="ws-document-scroll document-scroll"
              onScroll={scroll}
              onWheel={() => {
                touched.current = true;
              }}
              onTouchMove={() => {
                touched.current = true;
              }}
              onKeyDown={() => {
                touched.current = true;
              }}
            >
              <div className="ws-paper document-content">
                <div className="ws-note-meta">
                  <span>{context.data?.space.name}</span>
                  <Badge>
                    {note.visibility === "private" ? "Only you" : "Shared"}
                  </Badge>
                  <span>{parsed.outline.length} sections</span>
                </div>
                {readonly ? (
                  <h1 className="document-title">{note.title}</h1>
                ) : (
                  <NoteTitle
                    value={note.title}
                    typography={appearance.effective}
                    onContinue={() => editor.current?.focus()}
                    onSave={(title) =>
                      void action.run(async () => {
                        const resource = await api<Resource>(
                          `resources/${note.id}`,
                        );
                        await mutate(
                          `resources/${note.id}`,
                          { version: resource.version, name: title },
                          "PATCH",
                        );
                        setNote((current) => ({ ...current, title }));
                        refresh();
                      })
                    }
                  />
                )}
                <div
                  className={`editor-mount ${mode === "read" ? "hidden" : ""}`}
                >
                  <Editor
                    key={note.generation}
                    ref={editor}
                    note={note}
                    user={session.user}
                    mode={mode}
                    appearance={appearance.effective}
                    preferences={editorSettings.effective}
                    readOnly={
                      readonly || review || modal === "history" || !!proposal
                    }
                    retainSession
                    renderContext={renderContext}
                    notes={context.data?.notes ?? []}
                    annotations={comments.data ?? undefined}
                    onUnresolvedAnnotations={setUnresolvedComments}
                    onAnnotation={(id) => {
                      if (
                        comments.data?.find((c) => c.id === id)?.kind ===
                        "annotation"
                      ) {
                        setMarkOpen(id);
                        return;
                      }
                      setActiveDiscussion(id);
                      setPanel("comments");
                      requestAnimationFrame(() =>
                        document
                          .querySelector(
                            `[data-discussion-thread="${CSS.escape(id)}"]`,
                          )
                          ?.scrollIntoView({ block: "nearest" }),
                      );
                    }}
                    onCommand={(id) => commandRef.current(id, true)}
                    onRecover={(value) => {
                      setRecovered(value);
                      try {
                        retainDraft(session.user.id, note.id, value);
                        setRecoveries(recoveryDrafts(session.user.id, note.id));
                        return true;
                      } catch {
                        setError(
                          "Recovered text is in memory only. Download it before closing.",
                        );
                        return false;
                      }
                    }}
                    onChange={change}
                    onNavigation={(position) =>
                      setSection(sectionAtPosition(parsed.outline, position))
                    }
                    onStatus={setStatus}
                    onPresence={setPresence}
                    onRefresh={() => {
                      reload();
                      refresh();
                    }}
                    onError={setError}
                    onLink={(target) => void openLink(target)}
                    onFiles={(files) => {
                      if (!context.data?.space || readonly) return;
                      upload(files, context.data.space.id);
                      setModal("files");
                    }}
                  />
                </div>
                <div
                  className={`read-mount ${mode !== "read" ? "print-only" : ""}`}
                >
                  <ReadingView
                    blockMarks
                    active={mode === "read"}
                    parsed={parsed}
                    context={renderContext}
                    onLink={(target) => void openLink(target)}
                    personalPrint={appearance.effective.exportTypography}
                  />
                </div>
              </div>
            </div>
            <div className="minimap-slot" ref={setMinimapHost} />
          </div>
          <footer className="ws-note-footer">
            <DocumentStatistics source={source} parsed={parsed} />
            <span>
              {mode === "source"
                ? "Source"
                : mode === "write"
                  ? "Live preview"
                  : "Reading"}
            </span>
          </footer>
          <ReadingMarks
            active={active}
            editor={editor}
            scroller={scroller}
            panelHost={marksHost}
            minimapHost={minimapHost}
            openPanel={() => setPanel("bookmarks")}
            note={note}
            source={source}
            parsed={parsed}
            mode={mode}
            research={research}
            threads={comments}
            canComment={canComment}
            context={renderContext}
            openId={markOpen}
            onOpened={() => setMarkOpen(null)}
          />
        </div>
        {panel && (
          <aside className="ws-document-context">
            <nav className="ws-context-tabs" aria-label="Document panel">
              {[
                ["outline", List],
                ["comments", MessageSquare],
                ["references", BookOpen],
                ["equations", Sigma],
                ["bookmarks", BookmarkPlus],
              ].map(([value, Icon]) => (
                <button
                  key={value as string}
                  className="icon-button"
                  aria-label={`${value} panel`}
                  aria-pressed={panel === value}
                  onClick={() => setPanel(value as string)}
                >
                  {typeof Icon !== "string" && <Icon size={16} />}
                </button>
              ))}
              <button
                className="icon-button"
                aria-label="Close document panel"
                onClick={() => setPanel(null)}
              >
                <X size={15} />
              </button>
            </nav>
            {panel === "equations" && (
              <EquationInspector
                parsed={parsed}
                openStudio={
                  !readonly && context.data
                    ? (equation) => {
                        if (openingMath.current) return;
                        const current = editor.current?.text();
                        if (current === undefined || !editor.current) {
                          setError(
                            "Switch to Write or Source before opening an equation in Math Studio.",
                          );
                          return;
                        }
                        const node = nodeAt(current, equation.from, [
                          "mathBlock",
                        ]);
                        if (
                          !node ||
                          node.from !== equation.from ||
                          node.text !== equation.tex
                        ) {
                          setError(
                            "The equation changed. Select it again from the updated equation list.",
                          );
                          return;
                        }
                        const body = literalBody(current, node),
                          anchor = editor.current.captureSourceRange(
                            node.from,
                            node.to,
                          );
                        if (!anchor) return;
                        openingMath.current = true;
                        void post("tools", {
                          kind: "math",
                          spaceId: context.data!.space.id,
                          name: `${note.title.slice(0, 100)} · Equation ${equation.number}`,
                          source: body.text,
                          mutationId: crypto.randomUUID(),
                        })
                          .then(async (created) => {
                            const macros =
                              documentIndex(parsed).macros.join("\n");
                            if (macros && macros.length <= 15000)
                              await api(`tools/${created.id}/settings`, {
                                method: "PATCH",
                                body: JSON.stringify({
                                  version: 1,
                                  settings: { macros },
                                }),
                              });
                            storeMathBridge(session.user.id, {
                              projectId: created.id,
                              noteId: note.id,
                              noteTitle: note.title,
                              anchor,
                              before: current.slice(node.from, body.offsets[0]),
                              after: current.slice(
                                body.offsets.at(-1)!,
                                node.to,
                              ),
                              prefix: literalPrefix(current, node),
                              ending: current.includes("\r\n") ? "\r\n" : "\n",
                            });
                            refresh();
                            navigate(`/math/${created.id}`);
                          })
                          .catch((e) => setError(e.message))
                          .finally(() => {
                            openingMath.current = false;
                          });
                      }
                    : undefined
                }
                navigate={(position) => {
                  if (mode === "read") setMode("write");
                  requestAnimationFrame(() => editor.current?.focus(position));
                }}
              />
            )}
            {panel === "outline" && (
              <>
                <TableOfContents
                  headings={parsed.outline}
                  activeId={section}
                  collapsed={collapsed}
                  onCollapsedChange={setCollapsed}
                  onNavigate={navigateSection}
                  reveal={0}
                />
                {!parsed.outline.length && (
                  <p className="muted ws-small">
                    Add headings to build an outline. Nested sections follow
                    your heading hierarchy.
                  </p>
                )}
                <div className="ws-backlinks">
                  <h3>Linked thinking</h3>
                  {context.data?.links
                    .filter((link) => link.target_id === note.id)
                    .map((link) => (
                      <button
                        className="text-button"
                        key={link.source_id + link.target}
                        onClick={() =>
                          open({ kind: "note", id: link.source_id })
                        }
                      >
                        {link.source_title}
                        <ArrowUpRight size={12} />
                      </button>
                    ))}
                  {!context.data?.links.some(
                    (link) => link.target_id === note.id,
                  ) && (
                    <p className="muted ws-small">
                      No incoming note links yet.
                    </p>
                  )}
                </div>
              </>
            )}
            {panel === "comments" && (
              <>
                <h2>Discussion</h2>
                <ErrorNotice message={comments.error} retry={comments.reload} />
                {comments.data
                  ?.filter(
                    (item) => !item.parent_id && item.visibility !== "private",
                  )
                  .map((item) => (
                    <article
                      className={`ws-note-comment ${item.resolved ? "resolved" : ""} ${activeDiscussion === item.id ? "active-discussion" : ""}`}
                      key={item.id}
                      data-discussion-thread={item.id}
                    >
                      <header>
                        <strong>{item.author_name}</strong>
                        <small>{timeAgo(item.created_at)}</small>
                      </header>
                      {item.anchor && (
                        <button
                          className="ws-comment-anchor"
                          onClick={() => {
                            if (mode === "read") setMode("write");
                            setActiveDiscussion(item.id);
                            if (!editor.current?.locate(item.anchor!))
                              setError(
                                "The original selection is no longer available in this revision.",
                              );
                          }}
                        >
                          {item.anchor.quote}
                          {(unresolvedComments.includes(item.id) ||
                            (editor.current &&
                              !editor.current.resolveMark(item.anchor)) ||
                            item.anchor.generation !== note.generation) && (
                            <small>
                              Original text unavailable · discussion retained
                            </small>
                          )}
                        </button>
                      )}
                      {item.kind === "annotation" ? (
                        <button
                          className="annotation-list-card"
                          onClick={() => setMarkOpen(item.id)}
                        >
                          <MessageSquare size={14} />
                          <span>
                            {item.deleted
                              ? "Removed annotation · replies retained"
                              : item.title || item.body.slice(0, 100)}
                            <small>Open annotation card</small>
                          </span>
                        </button>
                      ) : (
                        <p>
                          {item.deleted ? "This entry was removed." : item.body}
                        </p>
                      )}
                      {comments.data
                        ?.filter((reply) => reply.parent_id === item.id)
                        .map((reply) => (
                          <div className="ws-note-reply" key={reply.id}>
                            <strong>{reply.author_name}</strong>
                            <p>
                              {reply.deleted ? "Reply removed." : reply.body}
                            </p>
                          </div>
                        ))}
                      {canComment && (
                        <div className="ws-actions">
                          <button
                            className="text-button"
                            onClick={() => {
                              setReply(item.id);
                              setAnchor(null);
                            }}
                          >
                            Reply
                          </button>
                          <button
                            className="text-button"
                            onClick={() =>
                              void action.run(async () => {
                                await mutate(
                                  `comments/${item.id}`,
                                  { resolved: !item.resolved },
                                  "PATCH",
                                );
                                comments.reload();
                              })
                            }
                          >
                            {item.resolved ? "Reopen" : "Resolve"}
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                {canComment && (
                  <form
                    className="ws-comment-compose"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void action.run(async () => {
                        await post(`notes/${note.id}/comments`, {
                          body: comment,
                          parentId: reply,
                          anchor,
                        });
                        setComment("");
                        setReply(null);
                        setAnchor(null);
                        comments.reload();
                        refresh();
                      });
                    }}
                  >
                    {reply && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setReply(null)}
                      >
                        Cancel reply
                      </button>
                    )}
                    {anchor && (
                      <blockquote>
                        {anchor.quote}
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setAnchor(null)}
                        >
                          Remove anchor
                        </button>
                      </blockquote>
                    )}
                    <label>
                      {reply ? "Reply" : "Comment"}
                      <textarea
                        rows={3}
                        required
                        maxLength={10000}
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                        placeholder="Ask a question or share a thought…"
                      />
                    </label>
                    <button
                      className="button primary"
                      disabled={action.busy || !comment.trim()}
                    >
                      Post comment
                    </button>
                  </form>
                )}
              </>
            )}
            {panel === "references" && (
              <>
                <h2>Citation context</h2>
                <ErrorNotice message={context.error} retry={context.reload} />
                {context.data?.references.map((reference) => (
                  <div className="ws-citation" key={reference.cite_key}>
                    <code>@{reference.cite_key}</code>
                    <strong>{reference.title}</strong>
                    <small>
                      {reference.authors} · {reference.year}
                    </small>
                    {!readonly && (
                      <button
                        className="text-button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() =>
                          editor.current?.insert(`[@${reference.cite_key}]`)
                        }
                      >
                        Insert citation
                        <Plus size={12} />
                      </button>
                    )}
                  </div>
                ))}
                {!context.data?.references.length && (
                  <p className="muted ws-small">
                    No references in this note’s citation context yet.
                  </p>
                )}
              </>
            )}
            {panel === "bookmarks" && <div ref={setMarksHost} />}
          </aside>
        )}
      </div>
      {recovered && (
        <div className="ws-recovered">
          <span>Recovered draft retained</span>
          {recoveries.length > 1 && (
            <select
              aria-label="Recovered drafts"
              value={
                recoveries.find((draft) => draft.source === recovered)?.key ??
                ""
              }
              onChange={(event) =>
                setRecovered(
                  recoveries.find((draft) => draft.key === event.target.value)
                    ?.source ?? recovered,
                )
              }
            >
              {recoveries.map((draft, index) => (
                <option key={draft.key} value={draft.key}>
                  Draft {recoveries.length - index} · {draft.label}
                </option>
              ))}
            </select>
          )}
          <button
            className="button secondary"
            onClick={() => download(note.title + "-recovered.md", recovered)}
          >
            Download recovered text
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss recovered draft notice"
            onClick={() => setRecovered("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {(modal === "commands" || modal === "insert") && (
        <Dialog
          title={modal === "insert" ? "Insert a block" : "Editor commands"}
          onClose={closeModal}
          wide
        >
          <CommandPalette
            preferences={editorSettings.effective}
            hasNote
            offline={!navigator.onLine}
            insertOnly={modal === "insert"}
            tableActive={editor.current?.tableActive()}
            onExecute={(id) => {
              setModal(null);
              requestAnimationFrame(() => commandRef.current(id));
            }}
          />
        </Dialog>
      )}
      {modal === "table" && (
        <Dialog title="Insert table" onClose={closeModal}>
          <TablePicker
            onInsert={(rows, columns) => {
              editor.current?.execute("table", { rows, columns });
              closeModal();
            }}
          />
        </Dialog>
      )}
      {(modal === "files" || modal === "links") && (
        <InsertResource
          kind={modal === "files" ? "file" : "note"}
          note={note}
          space={context.data?.space}
          onClose={closeModal}
          onInsert={(value) => {
            editor.current?.insert(value);
            closeModal();
          }}
        />
      )}
      {modal === "history" && (
        <ResourceHistory
          previousVisit={previousVisit}
          resourceId={note.id}
          canEdit={!readonly}
          capture={() => ({ body: editor.current?.text() ?? source })}
          flush={async () => {
            await editor.current?.flush();
          }}
          onClose={closeModal}
          onRestore={(restored) => {
            setNote({ ...note, ...restored });
            setSource(restored.body);
            setParsed(parseMarkdown(restored.body));
            refresh();
          }}
        />
      )}
      {review && (
        <SuggestionReview
          noteId={note.id}
          generation={note.generation}
          canEdit={!readonly}
          onClose={() => setReview(false)}
          onCompose={(value) => {
            if (!editor.current?.reviewBinding()) {
              notify("Wait for the editor to connect before suggesting edits.");
              return;
            }
            setProposal(value ?? "new");
          }}
        />
      )}
      {proposal && editor.current?.reviewBinding() && (
        <SuggestionEditor
          noteId={note.id}
          generation={note.generation}
          title={note.title}
          accepted={editor.current.reviewBinding()!}
          proposal={proposal === "new" ? undefined : proposal}
          context={renderContext}
          insertScope={{ note, space: context.data?.space }}
          onClose={() => setProposal(null)}
        />
      )}
    </section>
  );
}

function FilePane({
  resource,
  requestedVersion,
}: {
  resource: Resource;
  requestedVersion?: string;
}) {
  const { session, refresh, notify, navigate } = useWorkspace(),
    [details, setDetails] = useState(false),
    [discussion, setDiscussion] = useState(false),
    [version, setVersion] = useState(
      requestedVersion ?? resource.current_version_id,
    ),
    [error, setError] = useState(""),
    [permission, setPermission] = useState(false);
  const data = useData<any[]>(`files/${resource.id}/versions`),
    current = data.data?.find((item) => item.id === version),
    space = useData<{ space: Space }>(`spaces/${resource.space_id}`),
    research = useResearch(
      session.user.id,
      space.data?.space.kind === "personal"
        ? resource.space_id
        : (space.data?.space.group_id ?? undefined),
    );
  useEffect(() => {
    if (requestedVersion) setVersion(requestedVersion);
  }, [requestedVersion]);
  return (
    <section className="ws-file-pane">
      <header className="ws-file-toolbar">
        <ResourceIcon resource={resource} />
        <h1>{resource.name}</h1>
        <ResourceSharing resourceId={resource.id} />
        <select
          aria-label="File version"
          value={version ?? ""}
          onChange={(event) => {
            setVersion(event.target.value);
            setPermission(false);
            navigate(fileRoute(resource, event.target.value));
          }}
        >
          {data.data?.map((item) => (
            <option key={item.id} value={item.id}>
              Version {item.ordinal}
              {item.id === resource.current_version_id ? " · Current" : ""}
            </option>
          ))}
        </select>
        <a
          className="button secondary"
          href={`/api/v1/files/${resource.id}/download?version=${version}`}
        >
          <Download size={15} />
          Download
        </a>
        <button
          className="icon-button"
          aria-label="File details"
          onClick={() => setDetails(!details)}
        >
          <PanelRightOpen size={17} />
        </button>
        <button
          className="button secondary"
          onClick={() => {
            setDiscussion(!discussion);
            setDetails(false);
          }}
        >
          Discussion
        </button>
      </header>
      <ErrorNotice
        message={error || data.error}
        retry={data.error ? data.reload : undefined}
      />
      <div className="ws-file-body">
        <div className="ws-file-preview">
          {resource.deleted_at && (
            <p className="ws-note">
              This file is in the trash. Existing pinned versions remain
              readable until manual cleanup.
            </p>
          )}
          <FilePreviewSurface
            resourceId={resource.id}
            creationTarget={{
              spaceId: resource.space_id,
              parentId: resource.parent_id,
            }}
            versionId={version}
            pdf={
              Number(current?.bytes ?? resource.bytes) > 100_000_000 &&
              !permission ? (
                <Empty
                  icon={BookOpen}
                  title="Large research paper"
                  action={
                    <button
                      className="button secondary"
                      onClick={() => setPermission(true)}
                    >
                      Open in research reader
                    </button>
                  }
                >
                  This PDF is {bytes(current?.bytes ?? resource.bytes)}. The
                  reader loads pages on demand; complex pages may still be
                  expensive on a smaller device.
                </Empty>
              ) : version && space.data ? (
                <PdfViewer
                  key={version}
                  attachment={{ id: version, name: resource.name }}
                  userId={session.user.id}
                  research={research}
                  onClose={() =>
                    navigate(`/explorer?space=${resource.space_id}`)
                  }
                  onInsert={(value, privateMaterial) => {
                    if (privateMaterial)
                      notify(
                        "This excerpt contains private annotation material. Paste it only into an appropriate private note.",
                      );
                    void navigator.clipboard.writeText(value).then(
                      () =>
                        notify(
                          "Research excerpt copied as Markdown. Paste it into the intended note.",
                        ),
                      () => setError("Clipboard access was denied."),
                    );
                  }}
                />
              ) : (
                <Loading label="Opening paper…" />
              )
            }
          />
        </div>
        {details && (
          <ResourceInspector
            resource={resource}
            onClose={() => setDetails(false)}
            onChanged={() => {
              refresh();
              data.reload();
            }}
          />
        )}
        {discussion && version && (
          <aside className="file-discussion-panel">
            <ResourceDiscussion
              resourceId={resource.id}
              versionId={version}
              canComment={resource.role !== "viewer" && !resource.deleted_at}
              kinds={["whole", "time", "image", "line", "page", "cell"]}
            />
          </aside>
        )}
      </div>
    </section>
  );
}
