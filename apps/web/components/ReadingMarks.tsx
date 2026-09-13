"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  Bookmark,
  BookmarkPlus,
  Download,
  Highlighter,
  LockKeyhole,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Pencil,
  Search,
  X,
} from "lucide-react";
import {
  parseMarkdown,
  type ParsedDocument,
  type RenderContext,
} from "@axiom/markdown";
import { blockLabel, type ReadingBlockRect } from "@axiom/editor/reading-marks";
import {
  annotationCategories,
  exportReadingMarks,
  type MarkAnchor,
  type NoteComment,
} from "@axiom/shared/note-comments";
import { unitFraction, type ReadingItem } from "@axiom/shared/research";
import type { ResearchController } from "../lib/research-store";
import {
  type AnnotationDraft,
  type NoteThreads,
} from "../lib/note-marks-store";
import { ApiError, download, errorMessage } from "../lib/client";
import { confirmAction } from "../lib/app-prompt";
import { openContextMenu, type ContextAction } from "../lib/context-menu";
import { editorOverlayActive, retainEditorCard } from "../lib/editor-popover";
import type { EditorHandle, EditorMode } from "./Editor";
import BookmarkManager from "./BookmarkManager";
import AnnotationEditor from "./AnnotationEditor";
import AnnotationCardActions from "./AnnotationCardActions";
import ReadingView from "./ReadingView";
import DocumentMinimap from "./DocumentMinimap";
import { useDocumentNavigation } from "../lib/document-navigation";
import { editorAppearanceKey } from "@axiom/shared/minimap";
import { useWorkspace } from "./workspace/ui";

type Mark = {
  id: string;
  label: string;
  kind: "bookmark" | "annotation";
  anchor?: MarkAnchor;
  item?: ReadingItem;
  comment?: NoteComment;
  from: number | null;
  color: string;
};
type Props = {
  active: boolean;
  editor: RefObject<EditorHandle | null>;
  scroller: RefObject<HTMLDivElement | null>;
  panelHost: HTMLDivElement | null;
  minimapHost: HTMLDivElement | null;
  openPanel: () => void;
  note: { id: string; title: string; generation: number };
  source: string;
  parsed: ParsedDocument;
  mode: EditorMode;
  research: ResearchController;
  threads: NoteThreads;
  canComment: boolean;
  context: RenderContext;
  openId?: string | null;
  onOpened?: () => void;
};
function Preview({
  body,
  context,
  plain = false,
}: {
  body: string;
  context: RenderContext;
  plain?: boolean;
}) {
  const parsed = useMemo(() => parseMarkdown(body), [body]);
  return plain ? (
    <p className="annotation-plain">{body}</p>
  ) : (
    <ReadingView
      parsed={parsed}
      context={{ ...context, disableImages: true }}
      onLink={(target) => {
        if (/^https?:\/\//.test(target))
          window.open(target, "_blank", "noopener,noreferrer");
      }}
    />
  );
}
function asDraft(
  noteId: string,
  entry?: NoteComment,
  anchor: MarkAnchor | null = null,
): AnnotationDraft {
  return {
    id: entry?.id ?? crypto.randomUUID(),
    noteId,
    base: entry,
    updatedAt: new Date().toISOString(),
    input: {
      body: entry?.body ?? "",
      parentId: entry?.parent_id ?? null,
      anchor: entry?.anchor ?? anchor,
      kind: entry?.kind ?? "annotation",
      visibility: entry?.visibility ?? "private",
      title: entry?.title ?? "",
      category: entry?.category ?? "note",
      tags: entry?.tags ?? [],
      bodyFormat: "markdown",
    },
  };
}
export default function ReadingMarks(props: Props) {
  const {
    session,
    appearance,
    notify,
    navigate: navigatePage,
  } = useWorkspace();
  const instanceId = useId();
  const current = useRef(props);
  current.current = props;
  const minimapActive =
    appearance.effective.minimap.enabled &&
    appearance.effective.minimap[props.mode];
  const minimapActiveRef = useRef(minimapActive);
  minimapActiveRef.current = minimapActive;
  const layer = useRef<HTMLDivElement>(null),
    targets = useRef<ReadingBlockRect[]>([]),
    hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const adapter = useMemo(
    () => ({
      geometry: () =>
        minimapActiveRef.current
          ? (current.current.editor.current?.navigationGeometry() ?? [])
          : (current.current.editor.current?.markGeometry() ?? []),
      snapshot: () =>
        current.current.editor.current?.navigationSnapshot() ?? null,
      position: (position: number) =>
        minimapActiveRef.current
          ? (current.current.editor.current?.navigationPosition(position) ??
            null)
          : null,
      focus: (position?: number) =>
        current.current.editor.current?.focus(position),
    }),
    [],
  );
  const navigation = useDocumentNavigation(
    props.scroller,
    adapter,
    `${props.note.id}:${props.note.generation}:${minimapActive}`,
    props.source,
    props.mode,
    props.active,
  );
  const layout = navigation;
  const geometry = useMemo(
    () =>
      navigation.blocks
        .filter((b) => b.type !== "sourceLine")
        .map((b) => ({
          ...b,
          left: b.left + layout.left,
          right: b.right + layout.left,
          top: b.top + layout.top - layout.scroll,
          bottom: b.bottom + layout.top - layout.scroll,
        })),
    [navigation.blocks, layout.left, layout.top, layout.scroll],
  );
  targets.current = geometry;
  const [hovered, setHovered] = useState<ReadingBlockRect | null>(null),
    [preview, setPreview] = useState<{
      mark: Mark;
      x: number;
      y: number;
    } | null>(null);
  const [tab, setTab] = useState("bookmarks"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [card, setCard] = useState<string | null>(null),
    [draft, setDraft] = useState<AnnotationDraft | null>(null),
    [position, setPosition] = useState<{ left: number; top: number } | null>(
      null,
    ),
    [reattach, setReattach] = useState<Mark | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [conflict, setConflict] = useState<NoteComment | null>(null),
    [editorRevision, setEditorRevision] = useState(0),
    [draftStatus, setDraftStatus] = useState("");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const draftStatusRef = useRef(draftStatus);
  draftStatusRef.current = draftStatus;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        draftRef.current &&
        draftStatusRef.current !== "Draft saved on this device"
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const getGeometry = useCallback(() => {
    const p = current.current,
      root = p.scroller.current;
    if (!root) return [];
    if (p.mode !== "read") return p.editor.current?.markGeometry() ?? [];
    const boxes = Array.from(
      root.querySelectorAll<HTMLElement>(
        ".read-mount:not(.print-only) [data-reading-from]",
      ),
    )
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          from: Number(el.dataset.readingFrom),
          to: Number(el.dataset.readingTo),
          type: el.dataset.readingType!,
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
        };
      })
      .filter((r) => r.bottom > r.top);
    if (!boxes.length && !p.source.trim()) {
      const paper = root
        .querySelector(".read-mount:not(.print-only) .prose")
        ?.getBoundingClientRect();
      if (paper)
        boxes.push({
          from: 0,
          to: 0,
          type: "paragraph",
          left: paper.left,
          right: paper.right,
          top: paper.top,
          bottom: paper.top + 28,
        });
    }
    return boxes;
  }, []);
  useEffect(() => {
    const root = props.scroller.current;
    if (!root || !props.active) return;
    const pointer = (event: PointerEvent) => {
      if (event.buttons || editorOverlayActive()) return;
      const candidates = targets.current
        .filter((b) => event.clientY >= b.top && event.clientY < b.bottom)
        .sort((a, b) => a.to - a.from - (b.to - b.from));
      const next = candidates[0] ?? null;
      setHovered((old) =>
        old?.from === next?.from && old?.type === next?.type ? old : next,
      );
    };
    const leave = (event: PointerEvent) => {
      if (
        !(event.relatedTarget instanceof Element) ||
        !event.relatedTarget.closest(".reading-mark-layer,.editor-context-menu")
      )
        setHovered(null);
    };
    root.addEventListener("pointermove", pointer);
    root.addEventListener("pointerleave", leave);
    return () => {
      root.removeEventListener("pointermove", pointer);
      root.removeEventListener("pointerleave", leave);
      clearTimeout(hoverTimer.current);
    };
  }, [props.note.id, props.mode, props.active]);
  useEffect(() => {
    if (!draft) return;
    let active = true;
    setDraftStatus("Saving draft…");
    // Each edit is transaction-committed, not deferred until a tooltip closes.
    void props.threads
      .saveDraft(draft)
      .then(() => {
        if (active) setDraftStatus("Draft saved on this device");
      })
      .catch((e) => {
        if (active) setDraftStatus(`Not stored: ${errorMessage(e)}`);
      });
    return () => {
      active = false;
    };
  }, [draft, props.threads.saveDraft]);
  const retainDraft = async () => {
    if (!draftRef.current) return true;
    try {
      await current.current.threads.saveDraft(draftRef.current);
      return true;
    } catch (e) {
      setDraftStatus(`Not stored: ${errorMessage(e)}`);
      setMessage(
        "Your draft could not be stored. Export it before leaving this card, or retry Save.",
      );
      return false;
    }
  };
  const close = async (discarded = false) => {
    if (!discarded && !(await retainDraft())) return;
    setCard(null);
    setDraft(null);
    draftRef.current = null;
    setPosition(null);
    setConflict(null);
  };
  useEffect(() => {
    if (!props.active) {
      setPreview(null);
      void close();
    }
  }, [props.active]);
  useEffect(() => {
    if (!card) return;
    const release = retainEditorCard();
    window.dispatchEvent(
      new CustomEvent("axiom:reading-card-open", { detail: instanceId }),
    );
    const otherCard = (event: Event) => {
      if ((event as CustomEvent).detail !== instanceId) void close();
    };
    window.addEventListener("axiom:reading-card-open", otherCard);
    setPreview(null);
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !(e.target as Element)?.closest(
          ".editor-context-menu,.editor-action-panel,.axiom-completions",
        )
      ) {
        e.preventDefault();
        void close();
        layer.current
          ?.querySelector<HTMLButtonElement>("button")
          ?.focus({ preventScroll: true });
      }
    };
    const resize = () => {
      if (position) {
        setPosition(null);
        current.current.openPanel();
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    return () => {
      release();
      window.removeEventListener("keydown", key);
      window.removeEventListener("axiom:reading-card-open", otherCard);
      window.removeEventListener("resize", resize);
    };
  }, [card, !!position]);
  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(errorMessage(e));
      if (e instanceof ApiError && e.status === 409 && e.data?.current)
        setConflict(e.data.current);
    } finally {
      setBusy(false);
    }
  };
  const marks: Mark[] = [
    ...props.research.entries
      .filter(
        (e) =>
          e.kind === "reading" &&
          (e.value as ReadingItem).kind === "bookmark" &&
          (e.value as ReadingItem).target_id === props.note.id &&
          !e.value.deleted,
      )
      .map((entry) => {
        const item = entry.value as ReadingItem,
          a = item.data.anchor;
        return {
          id: item.id,
          label: item.data.label || "Saved position",
          kind: "bookmark" as const,
          item,
          anchor: a,
          from: a
            ? (props.editor.current?.resolveMark(a)?.from ?? null)
            : (props.parsed.outline.find((h) => h.id === item.data.heading)
                ?.from ?? null),
          color: item.data.color ?? "neutral",
        };
      }),
    ...(props.threads.data ?? [])
      .filter((c) => !c.parent_id && !c.deleted && c.anchor && !c.resolved)
      .map((c) => ({
        id: c.id,
        label: c.title || c.anchor?.quote || "Annotation",
        kind: "annotation" as const,
        comment: c,
        anchor: c.anchor!,
        from: props.editor.current?.resolveMark(c.anchor!)?.from ?? null,
        color: c.visibility === "private" ? "neutral" : "blue",
      })),
  ];
  const boxFor = (from: number) =>
    geometry
      .filter(
        (g) =>
          from >= g.from &&
          (from < g.to || (g.from === g.to && from === g.from)),
      )
      .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
  const location = (item: ReadingItem) => {
    const mark = marks.find((m) => m.id === item.id),
      at = mark?.from;
    if (item.data.anchor && at == null)
      return { label: "Needs reattachment", position: Infinity, stale: true };
    if (at == null)
      return {
        label: item.data.heading
          ? "Legacy section position"
          : "Saved scroll position",
        position: item.data.fraction ?? 0,
      };
    const section = [...props.parsed.outline]
      .reverse()
      .find((h) => h.from <= at);
    return {
      label: `Line ${props.source.slice(0, at).split("\n").length}${section ? ` · ${section.text}` : ""}`,
      position: at,
    };
  };
  const navigate = (mark: Mark) => {
    const root = props.scroller.current;
    if (!root) return;
    if (mark.from === null) {
      if (mark.anchor) {
        setMessage(
          "The original content is unavailable. Choose Reattach to select its new location.",
        );
        props.openPanel();
        return;
      }
      root.scrollTop =
        unitFraction(mark.item?.data.fraction ?? 0) *
        (root.scrollHeight - root.clientHeight);
      return;
    }
    if (props.mode !== "read") props.editor.current?.focus(mark.from);
    requestAnimationFrame(() => {
      const box = getGeometry()
        .filter((b) => mark.from! >= b.from && mark.from! <= b.to)
        .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
      if (box)
        root.scrollTop += box.top - root.getBoundingClientRect().top - 64;
    });
  };
  const placeCard = (box?: DOMRect) => {
    const right = box?.right ?? Infinity;
    if (right + 356 <= innerWidth - 16)
      setPosition({
        left: right + 12,
        top: Math.max(16, Math.min(box!.top, innerHeight - 500)),
      });
    else {
      setPosition(null);
      props.openPanel();
    }
  };
  const openCard = async (id: string, box?: DOMRect) => {
    if (!(await retainDraft())) return;
    setCard(id);
    setDraft(null);
    draftRef.current = null;
    setMessage("");
    setConflict(null);
    setTab("annotations");
    placeCard(box);
  };
  const begin = async (anchor: MarkAnchor | null, box?: DOMRect) => {
    if (!(await retainDraft())) return;
    if (anchor && !props.editor.current?.resolveMark(anchor)) {
      setMessage(
        "This block changed while the menu was open. Choose its new location and try again.",
      );
      props.openPanel();
      return;
    }
    const d = asDraft(props.note.id, undefined, anchor);
    setDraft(d);
    setCard(d.id);
    setMessage("");
    setTab("annotations");
    placeCard(box);
  };
  useEffect(() => {
    if (props.openId) {
      openCard(props.openId);
      props.onOpened?.();
    }
  }, [props.openId]);
  const anchorFor = (block: ReadingBlockRect) =>
    props.editor.current?.markAnchor(
      block.from,
      block.to,
      "block",
      block.type,
    ) ?? null;
  const currentAnchor = () =>
    props.editor.current?.anchor() ??
    (() => {
      const from =
        props.mode === "read"
          ? props.editor.current?.visiblePosition(layout.top + 80)
          : props.editor.current?.position();
      const b =
        geometry
          .filter((b) => from != null && from >= b.from && from <= b.to)
          .sort((a, b) => a.to - a.from - (b.to - b.from))[0] ??
        geometry.find((b) => b.bottom > layout.top + 20);
      return b
        ? anchorFor(b)
        : (props.editor.current?.markAnchor(0, 0, "point") ?? null);
    })();
  const addBookmark = (anchor: MarkAnchor | null) =>
    work(async () => {
      if (!anchor)
        throw new Error("The editor is still connecting. Try again shortly.");
      if (!props.editor.current?.resolveMark(anchor))
        throw new Error(
          "This block is no longer available. Choose a new location.",
        );
      await props.research.saveReading("bookmark", "note", props.note.id, {
        label:
          anchor.quote
            .trim()
            .split("\n")[0]
            .replace(/^\s*(?:#+|>|[-*]|\d+\.)\s*/, "")
            .slice(0, 100) || props.note.title,
        anchor,
        quote: anchor.quote.slice(0, 500),
        fraction: unitFraction(
          layout.scroll / Math.max(1, layout.extent - layout.height),
        ),
      });
      notify("Bookmarked privately.");
    });
  const attach = (anchor: MarkAnchor | null) =>
    work(async () => {
      if (!reattach) return;
      if (!anchor || !props.editor.current?.resolveMark(anchor))
        throw new Error("This block is no longer available.");
      if (reattach.item)
        await props.research.saveReading(
          "bookmark",
          "note",
          props.note.id,
          { ...reattach.item.data, anchor, quote: anchor.quote.slice(0, 500) },
          reattach.item,
        );
      else if (reattach.comment)
        await props.threads.change(reattach.comment, { anchor });
      setReattach(null);
      notify("Location updated.");
    });
  const menu = (button: HTMLButtonElement, block: ReadingBlockRect) => {
    const box = button.getBoundingClientRect();
    const choose = (b: ReadingBlockRect): ContextAction[] => {
      // Capture identity now, not numeric offsets after a peer has edited.
      const anchor = anchorFor(b);
      return [
        ...(reattach
          ? [
              {
                label: "Attach here",
                icon: "link" as const,
                group: "attach",
                action: () => void attach(anchor),
              },
            ]
          : []),
        {
          label: "Bookmark block",
          icon: "bookmark",
          group: "create",
          action: () => void addBookmark(anchor),
        },
        {
          label: "Add annotation",
          icon: "comment",
          group: "create",
          action: () => void begin(anchor, box),
        },
        ...marks
          .filter(
            (m) =>
              m.from !== null && m.from >= b.from && m.from < b.to && m.comment,
          )
          .map((m) => ({
            label: m.label.slice(0, 70),
            icon: "comment" as const,
            group: "threads",
            action: () => openCard(m.id, box),
          })),
      ];
    };
    const parents = geometry.filter(
      (p) =>
        p.from <= block.from &&
        p.to >= block.to &&
        (p.from !== block.from || p.to !== block.to),
    );
    openContextMenu({
      owner: button,
      x: box.right,
      y: box.bottom,
      label: `${blockLabel(block.type)} reading actions`,
      items: [
        ...choose(block),
        ...(parents.length
          ? [
              {
                label: "Parent block",
                icon: "list" as const,
                group: "target",
                action: () => {},
                children: parents.map((p) => ({
                  label: blockLabel(p.type),
                  icon: "list" as const,
                  action: () => {},
                  children: choose(p),
                })),
              },
            ]
          : []),
      ],
    });
  };
  useEffect(() => {
    const root = props.scroller.current;
    if (!root) return;
    const key = (event: KeyboardEvent) => {
      if (
        !event.altKey ||
        !event.shiftKey ||
        (event.code !== "KeyR" && event.key.toLowerCase() !== "r") ||
        event.isComposing
      )
        return;
      event.preventDefault();
      if (!appearance.effective.readingMarkMargin) {
        props.openPanel();
        return;
      }
      const at = props.editor.current?.position();
      const block = geometry
        .filter((b) => at != null && at >= b.from && at <= b.to)
        .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
      if (!block) {
        props.openPanel();
        return;
      }
      setHovered(block);
      requestAnimationFrame(() => {
        const button = layer.current?.querySelector<HTMLButtonElement>(
          ".reading-block-menu",
        );
        if (button) menu(button, block);
      });
    };
    root.addEventListener("keydown", key);
    return () => root.removeEventListener("keydown", key);
  });
  const markGroups = new Map<number, Mark[]>();
  for (const m of marks) {
    const box = m.from !== null ? boxFor(m.from) : undefined;
    if (!box) continue;
    const y = Math.round((box.top - layout.top + 14) / 20) * 20;
    if (y < 0 || y > layout.height - 20) continue;
    markGroups.set(y, [...(markGroups.get(y) ?? []), m]);
  }
  const overview = new Map<number, Mark[]>();
  for (const mark of marks) {
    if (mark.anchor && mark.from === null) continue;
    const box = mark.from !== null ? boxFor(mark.from) : undefined;
    const f = box
      ? (box.top - layout.top + layout.scroll) / layout.extent
      : mark.from !== null
        ? mark.from / Math.max(1, props.source.length)
        : (mark.item?.data.fraction ?? 0);
    const y = Math.max(
      6,
      Math.min(
        layout.height - 18,
        Math.round((unitFraction(f) * (layout.height - 24)) / 10) * 10 + 6,
      ),
    );
    overview.set(y, [...(overview.get(y) ?? []), mark]);
  }
  const selectMarks = (button: HTMLButtonElement, items: Mark[]) => {
    const open = (mark: Mark) => {
      navigate(mark);
      if (mark.comment) openCard(mark.id, button.getBoundingClientRect());
      else {
        setTab("bookmarks");
        props.openPanel();
      }
    };
    if (items.length === 1) open(items[0]);
    else {
      const box = button.getBoundingClientRect();
      openContextMenu({
        owner: button,
        x: box.right,
        y: box.bottom,
        label: "Reading marks at this location",
        items: items.map((m) => ({
          label: m.label.slice(0, 80),
          icon: m.comment ? "comment" : "bookmark",
          action: () => open(m),
        })),
      });
    }
  };
  const showPreview = (button: HTMLButtonElement, mark: Mark) => {
    clearTimeout(hoverTimer.current);
    if (editorOverlayActive()) return;
    const box = button.getBoundingClientRect();
    hoverTimer.current = setTimeout(
      () =>
        setPreview({
          mark,
          x: Math.max(12, Math.min(box.left - 324, innerWidth - 336)),
          y: Math.max(12, Math.min(box.top, innerHeight - 290)),
        }),
      300,
    );
  };
  const annotations = (props.threads.data ?? [])
    .filter((c) => !c.parent_id && c.kind === "annotation" && !c.deleted)
    .filter((c) =>
      [c.title, c.body, ...c.tags]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .filter((c) =>
      filter === "all" || filter === "resolved"
        ? filter !== "resolved" || c.resolved
        : filter === "unattached"
          ? !!c.anchor && !props.editor.current?.resolveMark(c.anchor)
          : c.visibility === filter,
    );
  const active = (props.threads.data ?? []).find((c) => c.id === card);
  const replies = (props.threads.data ?? []).filter(
    (c) => c.parent_id === card,
  );
  const resume = props.threads.drafts.find((d) => d.id === card);
  const edit = (entry: NoteComment) =>
    setDraft(
      props.threads.drafts.find((d) => d.id === entry.id) ??
        asDraft(props.note.id, entry),
    );
  const renderCard = card && (
    <section
      className={`reading-annotation-card ${position ? "floating" : "docked"}`}
      role="dialog"
      aria-modal="false"
      aria-label="Annotation card"
      data-annotation-card
      style={position ?? undefined}
    >
      <header>
        <Highlighter size={16} />
        <strong>
          {draft
            ? draft.base
              ? "Edit annotation"
              : "New annotation"
            : active?.title || "Annotation"}
        </strong>
        <span className="annotation-visibility">
          {(draft?.input.visibility ?? active?.visibility) === "shared" ? (
            <MessageSquare size={13} />
          ) : (
            <LockKeyhole size={13} />
          )}
        </span>
        <button
          className="icon-button"
          aria-label="Close annotation card"
          title="Close · draft retained"
          onClick={() => void close()}
        >
          <X size={15} />
        </button>
      </header>
      {message && (
        <p className="reading-mark-error" role="alert">
          {message}
        </p>
      )}
      {conflict && draft && (
        <div className="annotation-conflict" role="status">
          <p>
            A newer version was saved elsewhere. Your draft has not been
            overwritten.
          </p>
          <button
            className="text-button"
            onClick={() => {
              setDraft(asDraft(props.note.id, conflict));
              setEditorRevision((v) => v + 1);
              setConflict(null);
              setMessage("");
            }}
          >
            Use server version
          </button>
          <button
            className="text-button"
            onClick={() => {
              setDraft({ ...draft, base: conflict });
              setConflict(null);
              setMessage(
                "Draft retained against the latest version. Review it, then Save.",
              );
            }}
          >
            Keep my draft
          </button>
        </div>
      )}
      {draft ? (
        <>
          <div className="annotation-fields">
            <input
              aria-label="Annotation title"
              placeholder="A short title (optional)"
              maxLength={200}
              value={draft.input.title}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  input: { ...draft.input, title: e.target.value },
                })
              }
            />
            <select
              aria-label="Annotation category"
              value={draft.input.category}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  input: {
                    ...draft.input,
                    category: e.target.value as typeof draft.input.category,
                  },
                })
              }
            >
              {annotationCategories.map((c) => (
                <option key={c} value={c}>
                  {blockLabel(c)}
                </option>
              ))}
            </select>
          </div>
          {draft.input.anchor?.quote && (
            <p className="annotation-source-excerpt">
              {draft.input.anchor.quote.slice(0, 200)}
            </p>
          )}
          <AnnotationEditor
            key={`${draft.id}:${editorRevision}`}
            value={draft.input.body}
            onChange={(body) =>
              setDraft((d) =>
                d
                  ? {
                      ...d,
                      input: { ...d.input, body },
                      updatedAt: new Date().toISOString(),
                    }
                  : d,
              )
            }
            onError={setMessage}
          />
          <label className="annotation-tags">
            Tags
            <input
              key={`${draft.id}:${editorRevision}`}
              aria-label="Annotation tags"
              defaultValue={draft.input.tags.join(", ")}
              placeholder="assumptions, reproduce"
              onChange={(e) =>
                setDraft({
                  ...draft,
                  input: {
                    ...draft.input,
                    tags: e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          </label>
          <footer>
            <small role="status">{draftStatus}</small>
            <button
              className="icon-button"
              aria-label="Export annotation draft"
              title="Export draft"
              onClick={() =>
                download(
                  "annotation-draft.md",
                  exportReadingMarks("Annotation draft", [
                    {
                      label: draft.input.title || "Untitled annotation",
                      body: draft.input.body,
                      tags: draft.input.tags,
                    },
                  ]),
                )
              }
            >
              <Download size={14} />
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  await props.threads.discard(draft.id);
                  setDraft(null);
                  draftRef.current = null;
                  if (!active) void close(true);
                })
              }
            >
              Discard
            </button>
            <button
              className="button secondary small"
              disabled={busy || !!conflict || !draft.input.body.trim()}
              onClick={() =>
                void work(async () => {
                  await props.threads.commit(draft);
                  setDraft(null);
                  draftRef.current = null;
                })
              }
            >
              Save
            </button>
          </footer>
        </>
      ) : active ? (
        <>
          <div className="annotation-card-body">
            <div className="annotation-byline">
              {active.author_name} ·{" "}
              {active.visibility === "private"
                ? "Only you"
                : "Shared with readers"}
              {active.resolved ? " · Resolved" : ""}
            </div>
            {active.anchor && (
              <button
                className="annotation-source-excerpt"
                onClick={() =>
                  navigate({
                    id: active.id,
                    label: active.title,
                    kind: "annotation",
                    anchor: active.anchor!,
                    comment: active,
                    from:
                      props.editor.current?.resolveMark(active.anchor!)?.from ??
                      null,
                    color: "neutral",
                  })
                }
              >
                {active.anchor.quote.slice(0, 240) || "Marked position"}
              </button>
            )}
            {active.deleted ? (
              <p className="muted">
                This entry was removed. Replies are retained.
              </p>
            ) : (
              <Preview
                body={active.body}
                context={props.context}
                plain={active.body_format === "plain"}
              />
            )}
            {replies.map((r) => (
              <article className="annotation-reply" key={r.id}>
                <small>{r.author_name}</small>
                {r.deleted ? (
                  <p className="muted">Reply removed.</p>
                ) : (
                  <Preview
                    body={r.body}
                    context={props.context}
                    plain={r.body_format === "plain"}
                  />
                )}{" "}
                {r.author_id === session.user.id && !r.deleted && (
                  <button className="text-button" onClick={() => edit(r)}>
                    Edit reply
                  </button>
                )}
              </article>
            ))}
            {resume && (
              <button className="text-button" onClick={() => setDraft(resume)}>
                Resume saved draft
              </button>
            )}
          </div>
          {!active.deleted && (
            <AnnotationCardActions
              entry={active}
              own={active.author_id === session.user.id}
              canComment={props.canComment}
              busy={busy}
              pending={props.threads.pending.some(
                (e) => e.value.optimistic.id === active.id,
              )}
              onEdit={() => edit(active)}
              onReattach={() => {
                setReattach({
                  id: active.id,
                  label: active.title,
                  kind: "annotation",
                  comment: active,
                  from: null,
                  color: "neutral",
                });
                close();
                notify(
                  "Choose the new block’s right-margin menu, then Attach here.",
                );
              }}
              onShare={() =>
                void work(async () => {
                  const sharing = active.visibility === "private";
                  if (
                    sharing &&
                    !(await confirmAction(
                      "This card will be visible to everyone who can read this document. They may reply or copy its contents.",
                      {
                        title: "Share annotation?",
                        confirmLabel: "Share with readers",
                      },
                    ))
                  )
                    return;
                  await props.threads.change(active, {
                    visibility: sharing ? "shared" : "private",
                  });
                })
              }
              onCopy={() => {
                const d = asDraft(props.note.id, undefined, active.anchor);
                d.input = {
                  ...d.input,
                  body: active.body,
                  title: active.title,
                  tags: active.tags,
                  category: active.category,
                };
                setCard(d.id);
                setDraft(d);
              }}
              onRemove={() =>
                void work(async () => {
                  if (
                    await confirmAction(
                      "Remove your entry? Other participants’ replies will be retained.",
                      {
                        title: "Remove annotation?",
                        confirmLabel: "Remove",
                        destructive: true,
                      },
                    )
                  ) {
                    await props.threads.change(active, { deleted: true });
                    close();
                  }
                })
              }
              onResolve={() =>
                void work(async () => {
                  await props.threads.change(active, {
                    resolved: !active.resolved,
                  });
                })
              }
              onReply={() => {
                const d = asDraft(props.note.id);
                d.input = {
                  ...d.input,
                  parentId: active.id,
                  visibility: "shared",
                };
                setDraft(d);
              }}
            />
          )}
        </>
      ) : (
        <p className="reading-mark-empty">
          This card is unavailable. Your drafts remain in Reading marks.
        </p>
      )}
    </section>
  );
  const panel = (
    <div className="reading-marks-panel">
      <header>
        <h2>Reading marks</h2>
        <div
          className="scratchpad-modes"
          role="group"
          aria-label="Reading marks view"
        >
          <button
            aria-pressed={tab === "bookmarks"}
            onClick={() => setTab("bookmarks")}
          >
            Bookmarks
          </button>
          <button
            aria-pressed={tab === "annotations"}
            onClick={() => setTab("annotations")}
          >
            Annotations
          </button>
        </div>
      </header>
      {message && !card && (
        <p className="reading-mark-error" role="alert">
          {message}
        </p>
      )}
      <div className="reading-mark-create">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void addBookmark(currentAnchor())}
        >
          <BookmarkPlus size={14} />
          Bookmark position
        </button>
        <button className="text-button" onClick={() => begin(currentAnchor())}>
          <Plus size={14} />
          Annotation
        </button>
      </div>
      {card && !position ? (
        renderCard
      ) : tab === "bookmarks" ? (
        <BookmarkManager
          research={{
            ...props.research,
            entries: props.research.entries.filter(
              (e) =>
                e.kind === "reading" &&
                (e.value as ReadingItem).target_id === props.note.id,
            ),
          }}
          userId={session.user.id}
          onOpen={(item) => {
            const m = marks.find((m) => m.id === item.id);
            if (m) navigate(m);
          }}
          onReattach={(item) => {
            setReattach(marks.find((m) => m.id === item.id) ?? null);
            notify(
              "Choose the right-margin menu of the new block, then Attach here.",
            );
          }}
          location={location}
        />
      ) : (
        <>
          <div className="reading-mark-search">
            <Search size={14} />
            <input
              aria-label="Search annotations"
              value={query}
              placeholder="Search notes or tags…"
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Filter annotations"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="private">Private</option>
              <option value="shared">Shared</option>
              <option value="resolved">Resolved</option>
              <option value="unattached">Needs reattachment</option>
            </select>
          </div>
          <div className="reading-mark-tools">
            <span>
              {annotations.length} annotation
              {annotations.length === 1 ? "" : "s"}
            </span>
            <button
              className="icon-button"
              aria-label="Export annotations"
              title="Export annotations"
              onClick={(event) =>
                openContextMenu({
                  owner: event.currentTarget,
                  x: event.clientX,
                  y: event.clientY,
                  label: "Annotation export",
                  items: [
                    {
                      label: "Export Markdown",
                      icon: "note",
                      action: () =>
                        download(
                          "annotations.md",
                          exportReadingMarks(
                            props.note.title,
                            annotations.map((c) => ({
                              label: c.title || blockLabel(c.category),
                              body: c.body,
                              location: c.anchor?.quote,
                              tags: c.tags,
                            })),
                          ),
                        ),
                    },
                    {
                      label: "Export JSON",
                      icon: "code",
                      action: () =>
                        download(
                          "annotations.json",
                          JSON.stringify(
                            {
                              format: "axiom-note-annotations",
                              version: 1,
                              noteId: props.note.id,
                              items: annotations,
                            },
                            null,
                            2,
                          ),
                          "application/json",
                        ),
                    },
                  ],
                })
              }
            >
              <Download size={14} />
            </button>
          </div>
          {props.threads.error && (
            <p role="alert" className="reading-mark-error">
              {props.threads.error}
              <button className="text-button" onClick={props.threads.reload}>
                Retry
              </button>
            </p>
          )}
          {props.threads.drafts.map((d) => (
            <button
              key={d.id}
              className="annotation-list-card is-draft"
              onClick={() => {
                setCard(d.id);
                setDraft(d);
                setPosition(null);
              }}
            >
              <Pencil size={14} />
              <span>
                {d.input.title || "Untitled draft"}
                <small>Draft · saved on this device</small>
              </span>
            </button>
          ))}
          {annotations.map((c) => (
            <button
              key={c.id}
              className="annotation-list-card"
              onClick={() => openCard(c.id)}
            >
              {c.visibility === "private" ? (
                <LockKeyhole size={14} />
              ) : (
                <MessageSquare size={14} />
              )}
              <span>
                {c.title || c.body.slice(0, 60)}
                <small>
                  {blockLabel(c.category)}
                  {c.resolved ? " · Resolved" : ""}
                  {c.anchor && !props.editor.current?.resolveMark(c.anchor)
                    ? " · Needs reattachment"
                    : ""}
                </small>
              </span>
            </button>
          ))}
          {!annotations.length && !props.threads.drafts.length && (
            <p className="reading-mark-empty">
              Keep questions, insights and follow-ups beside the content. New
              annotations are private.
            </p>
          )}
          {props.threads.pending.map((e) => (
            <div className="reading-mark-status" key={e.key}>
              <span>{e.error || "Annotation waiting to synchronize"}</span>
              {e.error && (
                <>
                  <button
                    className="text-button"
                    onClick={() =>
                      void work(() => props.threads.resolve(e, false))
                    }
                  >
                    Use server version
                  </button>
                  {e.conflict && (
                    <button
                      className="text-button"
                      onClick={() =>
                        void work(() => props.threads.resolve(e, true))
                      }
                    >
                      {e.conflict.visibility === "private"
                        ? "Keep my changes"
                        : "Recover private copy"}
                    </button>
                  )}
                  <button
                    className="text-button"
                    onClick={() =>
                      download(
                        "retained-annotation.json",
                        JSON.stringify(e.value, null, 2),
                        "application/json",
                      )
                    }
                  >
                    Export retained work
                  </button>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
  const right = Math.max(
    0,
    (props.scroller.current?.getBoundingClientRect().right ?? 0) -
      layout.left -
      20,
  );
  const paperRight = props.scroller.current
    ?.querySelector(
      ".axiom-prose,.cm-content,.read-mount:not(.print-only) .prose",
    )
    ?.getBoundingClientRect().right;
  const x = paperRight
    ? Math.min(right - 18, paperRight - layout.left + 10)
    : right - 24;
  if (!props.active) return null;
  const minimapEnabled =
    appearance.effective.minimap.enabled &&
    appearance.effective.minimap[props.mode];
  return (
    <>
      <div
        ref={layer}
        className="reading-mark-layer"
        aria-label="Document reading marks"
        style={{
          height: layout.height,
          width: layout.width,
          left: props.scroller.current?.offsetLeft ?? 0,
        }}
      >
        {(appearance.effective.readingMarkMargin || reattach) && (
          <>
            {(hovered || reattach) &&
              (() => {
                const b = hovered ?? geometry.find((g) => g.top >= layout.top);
                if (
                  !b ||
                  b.bottom < layout.top ||
                  b.top > layout.top + layout.height
                )
                  return null;
                return (
                  <button
                    className="reading-block-menu"
                    style={{
                      left: x,
                      top: Math.max(4, b.top - layout.top + 3),
                    }}
                    aria-label={`${blockLabel(b.type)} reading actions`}
                    title={`${blockLabel(b.type)} actions`}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={(e) => menu(e.currentTarget, b)}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                );
              })()}
            {[...markGroups].map(([y, items]) => (
              <button
                key={y}
                className="reading-margin-marker"
                data-mark-color={items[0].color}
                style={{ left: x + 24, top: y - 10 }}
                aria-label={`${items.length > 1 ? items.length + " marks: " : ""}${items[0].label}`}
                aria-describedby={
                  preview?.mark.id === items[0].id
                    ? `reading-mark-preview-${props.note.id}`
                    : undefined
                }
                title={
                  items[0].kind === "bookmark"
                    ? "Reading bookmark"
                    : "Annotation"
                }
                onPointerDown={(e) => e.preventDefault()}
                onClick={(e) => selectMarks(e.currentTarget, items)}
                onMouseEnter={(e) => showPreview(e.currentTarget, items[0])}
                onFocus={(e) => showPreview(e.currentTarget, items[0])}
                onBlur={() => {
                  clearTimeout(hoverTimer.current);
                  setPreview(null);
                }}
                onMouseLeave={() => {
                  clearTimeout(hoverTimer.current);
                  setPreview(null);
                }}
              >
                {items[0].kind === "bookmark" ? (
                  <Bookmark size={14} />
                ) : (
                  <MessageSquare size={14} />
                )}{" "}
                {items.length > 1 && <small>{items.length}</small>}
              </button>
            ))}
          </>
        )}
        {appearance.effective.readingMarkOverview && !minimapEnabled && (
          <nav
            className="reading-mark-overview"
            aria-label="Reading marks overview"
            style={{ left: right + 6 }}
          >
            {[...overview].map(([y, items]) => (
              <button
                key={y}
                style={{ top: y }}
                data-mark-color={items[0].color}
                aria-label={`Jump to ${items.length > 1 ? items.length + " reading marks" : items[0].label}`}
                title={items.map((m) => m.label).join(" · ")}
                onPointerDown={(e) => e.preventDefault()}
                onClick={(e) => selectMarks(e.currentTarget, items)}
              />
            ))}
          </nav>
        )}
        {reattach && (
          <div className="reading-reattach-banner" role="status">
            Choose a block menu → Attach here
            <button className="text-button" onClick={() => setReattach(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {props.minimapHost &&
        createPortal(
          <DocumentMinimap
            root={props.scroller}
            navigation={navigation}
            adapter={adapter}
            active={props.active}
            source={props.source}
            parsed={props.parsed}
            mode={props.mode}
            preferences={appearance.effective.minimap}
            themeKey={`${appearance.dark}:${editorAppearanceKey(appearance.effective)}`}
            markers={
              appearance.effective.readingMarkOverview
                ? marks.flatMap((mark) => {
                    if (mark.anchor && mark.from === null) return [];
                    const from =
                      mark.from ??
                      navigation.index.sourceAt(
                        (mark.item?.data.fraction ?? 0) * navigation.extent,
                      );
                    return [
                      {
                        id: mark.id,
                        kind: mark.kind,
                        from,
                        to: from,
                        label: mark.label,
                        color: mark.color,
                      },
                    ];
                  })
                : []
            }
            onChange={(minimap) =>
              appearance.apply(
                { ...appearance.preferences, minimap },
                appearance.device,
              )
            }
            onSettings={() => navigatePage("/settings/appearance-general")}
            onOpenMarker={(id, trigger) => {
              const mark = marks.find((m) => m.id === id);
              if (mark?.comment)
                openCard(mark.id, trigger.getBoundingClientRect());
              else {
                setTab("bookmarks");
                props.openPanel();
              }
            }}
          />,
          props.minimapHost,
        )}
      {props.panelHost && createPortal(panel, props.panelHost)}
      {position && renderCard && createPortal(renderCard, document.body)}
      {preview &&
        createPortal(
          <div
            className="reading-mark-tooltip"
            id={`reading-mark-preview-${props.note.id}`}
            role="tooltip"
            aria-label={`${preview.mark.label}: ${preview.mark.comment?.body ?? preview.mark.anchor?.quote ?? "Saved reading position"}`}
            style={{ left: preview.x, top: preview.y }}
          >
            <header>
              {preview.mark.kind === "bookmark" ? (
                <Bookmark size={14} />
              ) : (
                <Highlighter size={14} />
              )}
              <strong>{preview.mark.label.slice(0, 100)}</strong>
            </header>
            <div inert>
              {preview.mark.comment ? (
                <Preview
                  body={preview.mark.comment.body}
                  context={props.context}
                  plain={preview.mark.comment.body_format === "plain"}
                />
              ) : (
                <p>
                  {preview.mark.anchor?.quote ||
                    preview.mark.item?.data.quote ||
                    "Saved reading position"}
                </p>
              )}
            </div>
            <small>
              Click to open
              {preview.mark.comment?.visibility === "private"
                ? " · Only you"
                : ""}
            </small>
          </div>,
          document.body,
        )}
    </>
  );
}
