"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  Expand,
  FileText,
  Grid2X2,
  Highlighter,
  Link as LinkIcon,
  List,
  LoaderCircle,
  Minus,
  PanelLeft,
  Plus,
  RotateCw,
  Search,
  Settings2,
  SquareDashed,
  Sparkles,
  StickyNote,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  annotationMarkdown,
  type Annotation,
  type AnnotationData,
  type ReadingItem,
} from "@axiom/shared/research";
import {
  pdfTextMatches,
  type PdfMatch,
  type PdfTheme,
  type PdfView,
} from "@axiom/shared/pdf-reader";
import { api, download } from "../../lib/client";
import { confirmAction } from "../../lib/app-prompt";
import {
  openPaperSource,
  pinPaper,
  removeResearch,
  type PaperMeta,
  type ResearchController,
  type ResearchEntry,
} from "../../lib/research-store";
import PdfPages from "./PdfPages";
import PdfOrganizer from "./PdfOrganizer";
import PdfOutline from "./PdfOutline";
import PdfAnnotationTransfer from "./PdfAnnotationTransfer";
import PdfAnnotationThread from "./PdfAnnotationThread";
import PdfCompare from "./PdfCompare";
import PdfOcrPanel from "./PdfOcrPanel";
import PdfBulkActions from "./PdfBulkActions";
import type { PdfDrawingTool, PdfSelectionData } from "./PdfDrawingLayer";
import PaperAssistant from "./PaperAssistant";
import PdfSelectionActions, { type PdfSelection } from "./PdfSelectionActions";
import Dialog from "../Dialog";
import { useAppearance } from "../../lib/appearance";
import { pdfRuntimeOptions } from "../../lib/pdf-runtime";
type Panel = "annotations" | "outline" | "thumbnails" | "search" | "bookmarks";
export type PdfReaderProps = {
  attachment: { id: string; name: string; page?: number; annotation?: string };
  userId: string;
  research: ResearchController;
  onInsert: (value: string, privateMaterial?: boolean) => void;
  onClose: () => void;
  citeKey?: string;
};
export default function PdfReader({
  attachment,
  userId,
  research,
  onInsert,
  onClose,
  citeKey,
}: PdfReaderProps) {
  const root = useRef<HTMLElement>(null),
    current = useRef(research),
    progressRef = useRef<ReadingItem | undefined>(undefined),
    searchToken = useRef(0);
  current.current = research;
  const appearance = useAppearance(userId),
    defaults = appearance.effective.pdfReader;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [meta, setMeta] = useState<PaperMeta | null>(null);
  const [page, setPage] = useState(1),
    [offset, setOffset] = useState(0),
    [resumeOffset, setResumeOffset] = useState(0),
    [jump, setJump] = useState(0),
    [pageInput, setPageInput] = useState("1"),
    [labels, setLabels] = useState<string[]>([]);
  const [scale, setScale] = useState<number | "fit" | "page">("fit"),
    [rotation, setRotation] = useState(0),
    [view, setView] = useState<PdfView>("continuous"),
    [theme, setTheme] = useState<PdfTheme>("original");
  const [panel, setPanel] = useState<Panel | null>("annotations"),
    [navWidth, setNavWidth] = useState(260),
    [split, setSplit] = useState(false),
    [secondPage, setSecondPage] = useState(1);
  const [outline, setOutline] = useState<
    { title: string; dest: unknown; depth: number }[]
  >([]);
  const [query, setQuery] = useState(""),
    [hits, setHits] = useState<PdfMatch[]>([]),
    [searchStatus, setSearchStatus] = useState(""),
    [matchCase, setMatchCase] = useState(false),
    [wholeWord, setWholeWord] = useState(false),
    [hitIndex, setHitIndex] = useState(-1);
  const [filter, setFilter] = useState(""),
    [scope, setScope] = useState("all"),
    [colorFilter, setColorFilter] = useState("");
  const [selected, setSelected] = useState<AnnotationData | null>(null),
    [selection, setSelection] = useState<PdfSelection | null>(null),
    [editing, setEditing] = useState<Annotation | undefined>(),
    [body, setBody] = useState(""),
    [tags, setTags] = useState(""),
    [color, setColor] = useState<AnnotationData["color"]>("yellow"),
    [selectedId, setSelectedId] = useState(attachment.annotation ?? ""),
    [area, setArea] = useState(false);
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [organizer, setOrganizer] = useState(false),
    [assistant, setAssistant] = useState(false),
    [help, setHelp] = useState(false),
    [options, setOptions] = useState(false);
  const [transfer, setTransfer] = useState<"import" | "export" | null>(null);
  const [thread, setThread] = useState<Annotation | null>(null);
  const [compare, setCompare] = useState(false);
  const [ocr, setOcr] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [drawingTool, setDrawingTool] = useState<PdfDrawingTool | undefined>();
  const [undo, setUndo] = useState<ResearchEntry | null>(null),
    [history, setHistory] = useState<number[]>([]),
    [future, setFuture] = useState<number[]>([]);
  const [drawingUndo, setDrawingUndo] = useState<{
    before?: Annotation;
    after: Annotation;
  } | null>(null);
  const [password, setPassword] = useState(""),
    [passwordRequest, setPasswordRequest] = useState<{
      retry: boolean;
      update: (password: string) => void;
    } | null>(null);
  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const go = (value: number, record = true) => {
    if (!pdf || !Number.isFinite(value)) return;
    const n = Math.max(1, Math.min(pdf.numPages, Math.floor(value)));
    if (record && n !== page) {
      setHistory((old) => [...old.slice(-99), page]);
      setFuture([]);
    }
    setPage(n);
    setOffset(0);
    setResumeOffset(0);
    setJump((n) => n + 1);
  };
  const entries = useMemo(
    () =>
      research.entries.filter(
        (e) =>
          e.kind === "annotation" &&
          (e.value as Annotation).attachment_id === attachment.id &&
          !e.value.deleted,
      ),
    [research.entries, attachment.id],
  );
  const annotations = useMemo(
    () =>
      entries
        .map((e) => e.value as Annotation)
        .sort(
          (a, b) =>
            a.data.page - b.data.page ||
            a.updated_at.localeCompare(b.updated_at),
        ),
    [entries],
  );
  const visibleAnnotations = annotations.filter(
    (a) =>
      (scope !== "mine" || a.author_id === userId) &&
      (scope !== "shared" || a.shared) &&
      (!colorFilter || a.data.color === colorFilter) &&
      `${a.data.quote} ${a.data.body} ${a.author_name ?? ""} ${a.data.tags?.join(" ") ?? ""}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const bookmarks = research.entries.filter(
    (e) =>
      e.kind === "reading" &&
      (e.value as ReadingItem).kind === "bookmark" &&
      (e.value as ReadingItem).target_id === attachment.id &&
      !e.value.deleted,
  );
  const pinned = research.papers.some((p) => p.meta.id === attachment.id);
  useEffect(() => {
    setView(defaults.layout);
    setTheme(defaults.theme);
    setNavWidth(defaults.navigatorWidth);
    setPanel(defaults.navigator ? "annotations" : null);
  }, [
    defaults.layout,
    defaults.theme,
    defaults.navigator,
    defaults.navigatorWidth,
  ]);
  const dirty =
    !!selected &&
    (body !== (editing?.data.body ?? "") ||
      tags !== (editing?.data.tags ?? []).join(", ") ||
      color !== (editing?.data.color ?? "yellow"));
  const abandon = async () =>
    !dirty ||
    (await confirmAction("Your unsaved annotation text will be discarded.", {
      title: "Discard annotation draft?",
      confirmLabel: "Discard",
    }));
  const choose = async (data: AnnotationData, existing?: Annotation) => {
    if (!(await abandon())) return;
    setAssistant(false);
    setSelected(data);
    setEditing(existing);
    setBody(data.body);
    setTags((data.tags ?? []).join(", "));
    setColor(data.color);
    setArea(false);
    setSelectedId(existing?.id ?? "");
  };
  const capture = (data: PdfSelectionData) => {
    if (!meta) return;
    const value = { ...data, sha256: meta.sha256, body: "", color };
    if (data.kind === "ink" || data.kind === "arrow") {
      void work(async () => {
        const mark = await research.saveAnnotation(attachment.id, value, false);
        setDrawingUndo({ after: mark });
        setUndo(null);
        setSelectedId(mark.id);
      });
      return;
    }
    if (data.kind === "highlight") {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const box = selection.getRangeAt(0).getBoundingClientRect();
      setSelection({
        data: value,
        anchor: {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        },
      });
    } else void choose(value);
  };
  useEffect(() => {
    let alive = true,
      task:
        ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    setPdf(null);
    setMeta(null);
    setError("");
    setSelected(null);
    setSelection(null);
    setEditing(undefined);
    setBody("");
    setHistory([]);
    setFuture([]);
    setHits([]);
    searchToken.current++;
    void Promise.all([
      openPaperSource(userId, attachment.id),
      import("pdfjs-dist"),
    ])
      .then(async ([paper, lib]) => {
        if (!alive) return;
        setMeta(paper.meta);
        lib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        task = lib.getDocument({
          ...pdfRuntimeOptions,
          ...(paper.bytes
            ? { data: paper.bytes.slice() }
            : { url: paper.url, disableAutoFetch: true, disableStream: true }),
        });
        task.onPassword = (update: (value: string) => void, reason: number) => {
          if (alive) setPasswordRequest({ update, retry: reason === 2 });
        };
        const doc = await task.promise;
        if (!alive) return;
        let progress = current.current.entries.find(
          (e) =>
            e.kind === "reading" &&
            (e.value as ReadingItem).kind === "progress" &&
            (e.value as ReadingItem).target_id === attachment.id,
        )?.value as ReadingItem | undefined;
        if (!progress && navigator.onLine)
          try {
            progress = (
              await api<ReadingItem[]>(
                `me/reading?groupId=${paper.meta.group_id}`,
              )
            ).find(
              (r) =>
                r.kind === "progress" &&
                r.target_id === attachment.id &&
                !r.deleted,
            );
          } catch {
            /* Local/offline resume remains available. */
          }
        if (!alive) return;
        progressRef.current = progress;
        const savedView = progress?.data.pdfView;
        setOffset(attachment.page ? 0 : (savedView?.offset ?? 0));
        setResumeOffset(attachment.page ? 0 : (savedView?.offset ?? 0));
        if (savedView) {
          setScale(savedView.scale);
          setRotation(savedView.rotation);
          setView(savedView.layout);
        }
        setPage(
          Math.max(
            1,
            Math.min(doc.numPages, attachment.page ?? progress?.data.page ?? 1),
          ),
        );
        setJump((n) => n + 1);
        setPdf(doc);
        const [tree, pageLabels] = await Promise.all([
          doc.getOutline(),
          doc.getPageLabels(),
        ]);
        if (!alive) return;
        const flat: { title: string; dest: unknown; depth: number }[] = [];
        const walk = (items: NonNullable<typeof tree>, depth = 0) => {
          for (const item of items) {
            if (flat.length >= 2000) break;
            flat.push({ title: item.title, dest: item.dest, depth });
            if (depth < 12) walk(item.items ?? [], depth + 1);
          }
        };
        walk(tree ?? []);
        setOutline(flat);
        setLabels(pageLabels ?? []);
      })
      .catch((e) => {
        if (alive) setError(e.message || "Unable to load this PDF.");
      });
    const unavailable = (event: Event) => {
      if ((event as CustomEvent).detail === attachment.id) {
        setPdf(null);
        setMeta(null);
        setError(
          "Access changed. Unsynchronized personal work is retained in reading data for export.",
        );
        void task?.destroy();
      }
    };
    window.addEventListener("axiom-paper-unavailable", unavailable);
    return () => {
      alive = false;
      searchToken.current++;
      window.removeEventListener("axiom-paper-unavailable", unavailable);
      void task?.destroy();
    };
  }, [attachment.id, userId]);
  useEffect(() => {
    return research.subscribePaper(attachment.id);
  }, [attachment.id, research.subscribePaper]);
  useEffect(() => {
    if (attachment.page && pdf) go(attachment.page);
  }, [attachment.page]);
  useEffect(() => {
    setSelectedId(attachment.annotation ?? "");
  }, [attachment.annotation]);
  useEffect(() => {
    setPageInput(labels[page - 1] ?? String(page));
  }, [page, labels]);
  useEffect(() => {
    if (!pdf || !meta) return;
    const timer = setTimeout(() => {
      void current.current
        .saveReading(
          "progress",
          "attachment",
          meta.id,
          {
            label: meta.name,
            page,
            fraction: page / pdf.numPages,
            pdfView: {
              offset,
              scale,
              rotation: rotation as 0 | 90 | 180 | 270,
              layout: view,
            },
          },
          progressRef.current,
        )
        .then((value) => {
          progressRef.current = value;
        })
        .catch((e) => setMessage(e.message));
    }, 800);
    return () => clearTimeout(timer);
  }, [pdf, meta, page, offset, scale, rotation, view]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const search = async () => {
    if (!pdf || !query.trim()) return;
    const token = ++searchToken.current;
    setPanel("search");
    setHits([]);
    setHitIndex(-1);
    const found: PdfMatch[] = [];
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        if (token !== searchToken.current) return;
        const p = await pdf.getPage(n),
          content = await p.getTextContent();
        if (token !== searchToken.current) return;
        found.push(
          ...pdfTextMatches(
            content.items.flatMap((i) => ("str" in i ? [i.str] : [])).join(" "),
            query,
            n,
            matchCase,
            wholeWord,
          ).slice(0, 2000 - found.length),
        );
        if (n % 5 === 0 || n === pdf.numPages || found.length >= 2000) {
          setHits([...found]);
          setSearchStatus(
            `Searching ${n} / ${pdf.numPages} · ${found.length} results`,
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (found.length >= 2000) break;
      }
      if (token === searchToken.current) {
        setSearchStatus(
          found.length >= 2000
            ? "First 2,000 results. Refine the search."
            : `${found.length} results`,
        );
        setHits(found);
        if (found.length) {
          setHitIndex(0);
          go(found[0].page);
        }
      }
    } catch {
      if (token === searchToken.current)
        setSearchStatus(
          "Search stopped: a page could not be read. Results so far are retained.",
        );
    }
  };
  const save = async (insert = false) => {
    if (!selected) return;
    await work(async () => {
      const parsedTags = [
        ...new Set(
          tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      ];
      if (parsedTags.length > 12 || parsedTags.some((tag) => tag.length > 40))
        throw new Error("Use up to 12 tags, with at most 40 characters each.");
      const saved = await research.saveAnnotation(
        attachment.id,
        { ...selected, body, color, tags: parsedTags },
        editing?.shared ?? false,
        editing,
      );
      if (["ink", "arrow", "textbox"].includes(saved.data.kind)) {
        setDrawingUndo({ before: editing, after: saved });
        setUndo(null);
      }
      setSelectedId(saved.id);
      setSelected(null);
      setEditing(undefined);
      setBody("");
      window.getSelection()?.removeAllRanges();
      setPanel("annotations");
      if (insert)
        onInsert(
          annotationMarkdown(saved, attachment.name, citeKey),
          !saved.shared || meta?.visibility === "private",
        );
    });
  };
  const original = async () => {
    if (!pdf) return;
    await work(async () => {
      const bytes = await pdf.getData();
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });
  };
  const toggleOffline = () =>
    work(async () => {
      if (!meta || !pdf) return;
      if (pinned) {
        await removeResearch(userId, `pdf:${attachment.id}`);
        await research.refresh();
        setMessage("Offline PDF removed. Annotations were kept.");
      } else {
        if (
          meta.bytes > 100 * 1024 * 1024 &&
          !(await confirmAction(
            "Keeping this large paper offline downloads the complete PDF and uses browser storage.",
            { title: "Keep large paper offline?", confirmLabel: "Download" },
          ))
        )
          return;
        await pinPaper(userId, meta, await pdf.getData());
        await research.refresh();
        setMessage(
          "Paper kept on this device. Sign-out clears this browser’s copy.",
        );
      }
    });
  const remove = (entry: ResearchEntry) =>
    work(async () => {
      setDrawingUndo(null);
      await research.remove(entry);
      setUndo(
        entry.kind === "annotation" &&
          (entry.value as Annotation).author_id !== userId
          ? null
          : entry,
      );
      if (selectedId === entry.value.id) {
        setSelected(null);
        setEditing(undefined);
      }
    });
  const restore = () =>
    work(async () => {
      if (drawingUndo) {
        const latest = current.current.entries.find(
          (e) => e.kind === "annotation" && e.value.id === drawingUndo.after.id,
        );
        if (
          !latest ||
          latest.conflict ||
          latest.error ||
          latest.value.deleted ||
          latest.value.mutation_id !== drawingUndo.after.mutation_id
        )
          throw new Error(
            "This annotation changed since your drawing action. Undo was not applied.",
          );
        if (drawingUndo.before) {
          const before = drawingUndo.before;
          await research.saveAnnotation(
            before.attachment_id,
            before.data,
            before.shared,
            latest.value as Annotation,
          );
        } else await research.remove(latest);
        setDrawingUndo(null);
        return;
      }
      if (!undo) return;
      const latest = current.current.entries.find(
        (e) => e.value.id === undo.value.id,
      );
      if (latest?.conflict || latest?.error)
        throw new Error(
          "Resolve the synchronization conflict in reading data before undoing this removal.",
        );
      if (undo.kind === "annotation") {
        const a = undo.value as Annotation;
        await research.saveAnnotation(
          a.attachment_id,
          a.data,
          a.shared,
          (latest?.value as Annotation | undefined) ?? a,
        );
      } else {
        const r = undo.value as ReadingItem;
        await research.saveReading(
          r.kind,
          r.target_type,
          r.target_id,
          r.data,
          (latest?.value as ReadingItem | undefined) ?? r,
        );
      }
      setUndo(null);
    });
  return (
    <section
      ref={root}
      className={`pdf-viewer pdf-workbench ${panel ? "has-navigator" : ""} ${selected || assistant ? "has-composer" : ""}`}
      data-pdf-theme={theme}
      style={{ "--pdf-nav-width": `${navWidth}px` } as React.CSSProperties}
      aria-label="Paper reader"
      onKeyDown={(e) => {
        if (e.defaultPrevented) return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
          e.preventDefault();
          setPanel("search");
          requestAnimationFrame(() =>
            root.current
              ?.querySelector<HTMLInputElement>(
                '[aria-label="Search PDF text"]',
              )
              ?.focus(),
          );
          return;
        }
        if (
          (e.target as Element).closest(
            "input,textarea,[contenteditable=true],select",
          )
        )
          return;
        if (e.key === "Escape") {
          setArea(false);
          setDrawingTool(undefined);
          setOptions(false);
        }
        if (e.key === "ArrowRight" || e.key === "PageDown") {
          e.preventDefault();
          go(page + 1);
        }
        if (e.key === "ArrowLeft" || e.key === "PageUp") {
          e.preventDefault();
          go(page - 1);
        }
        if (
          (e.metaKey || e.ctrlKey) &&
          e.key.toLowerCase() === "z" &&
          (undo || drawingUndo)
        ) {
          e.preventDefault();
          void restore();
        }
      }}
    >
      {selection && (
        <PdfSelectionActions
          selection={selection}
          busy={busy}
          onClose={() => setSelection(null)}
          onCopy={() =>
            void work(async () => {
              await navigator.clipboard.writeText(selection.data.quote);
              setSelection(null);
              setMessage("Selected text copied.");
            })
          }
          onNote={() => {
            void choose(selection.data);
            setSelection(null);
          }}
          onHighlight={(picked) =>
            void work(async () => {
              const saved = await research.saveAnnotation(
                attachment.id,
                { ...selection.data, color: picked },
                false,
              );
              setSelectedId(saved.id);
              setSelection(null);
              window.getSelection()?.removeAllRanges();
              setMessage("Highlight saved privately.");
            })
          }
          onMarkup={(kind) =>
            void work(async () => {
              const saved = await research.saveAnnotation(
                attachment.id,
                { ...selection.data, kind },
                false,
              );
              setSelectedId(saved.id);
              setSelection(null);
              window.getSelection()?.removeAllRanges();
              setMessage(
                `${kind === "underline" ? "Underline" : "Strikeout"} saved privately.`,
              );
            })
          }
          onQuote={() => {
            onInsert(
              `${selection.data.quote
                .replace(/([\\`*_{}\[\]<>])/g, "\\$1")
                .split("\n")
                .map((line) => `> ${line}`)
                .join(
                  "\n",
                )}\n\n[${attachment.name.replace(/[\[\]\\\r\n]/g, " ")} · p. ${selection.data.page}](/api/v1/attachments/${attachment.id}#page=${selection.data.page})\n`,
              meta?.visibility === "private",
            );
            setSelection(null);
          }}
        />
      )}
      <header className="paper-heading">
        <BookOpen size={17} />
        <strong title={attachment.name}>{attachment.name}</strong>
        <Tool
          label="Close paper reader"
          onClick={() =>
            void abandon().then((ok) => {
              if (ok) onClose();
            })
          }
        >
          <X size={16} />
        </Tool>
      </header>
      <div className="pdf-toolbar" role="toolbar" aria-label="PDF tools">
        <Tool
          label="Toggle reading navigator"
          pressed={!!panel}
          onClick={() => setPanel(panel ? null : "annotations")}
        >
          <PanelLeft size={17} />
        </Tool>
        <Tool
          label="Back in reading history"
          disabled={!history.length}
          onClick={() => {
            const n = history.at(-1)!;
            setHistory(history.slice(0, -1));
            setFuture([...future, page]);
            go(n, false);
          }}
        >
          <ArrowLeft size={16} />
        </Tool>
        <Tool
          label="Forward in reading history"
          disabled={!future.length}
          onClick={() => {
            const n = future.at(-1)!;
            setFuture(future.slice(0, -1));
            setHistory([...history, page]);
            go(n, false);
          }}
        >
          <ArrowRight size={16} />
        </Tool>
        <span className="pdf-tool-divider" />
        <Tool
          label="Previous PDF page"
          disabled={!pdf || page <= 1}
          onClick={() => go(page - 1)}
        >
          <ChevronLeft size={17} />
        </Tool>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const index = labels.indexOf(pageInput);
            go(index >= 0 ? index + 1 : Number(pageInput));
          }}
        >
          <input
            aria-label="Go to PDF page"
            className="pdf-page-input"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={() => setPageInput(labels[page - 1] ?? String(page))}
          />
        </form>
        <span className="pdf-page-count">/ {pdf?.numPages ?? "…"}</span>
        <span className="sr-only">
          {page} / {pdf?.numPages ?? "…"}
        </span>
        <Tool
          label="Next PDF page"
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => go(page + 1)}
        >
          <ChevronRight size={17} />
        </Tool>
        <span className="pdf-tool-divider" />
        <Tool
          label="Zoom out"
          onClick={() =>
            setScale(
              Math.max(0.25, (typeof scale === "number" ? scale : 1) - 0.2),
            )
          }
        >
          <Minus size={16} />
        </Tool>
        <select
          aria-label="PDF zoom"
          value={typeof scale === "number" ? String(scale) : scale}
          onChange={(e) =>
            setScale(
              e.target.value === "fit" || e.target.value === "page"
                ? e.target.value
                : Number(e.target.value),
            )
          }
        >
          <option value="fit">Fit width</option>
          <option value="page">Fit page</option>
          {[
            ...new Set([
              0.5,
              0.75,
              1,
              1.25,
              1.5,
              2,
              3,
              4,
              ...(typeof scale === "number" ? [scale] : []),
            ]),
          ]
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n}>
                {Math.round(n * 100)}%
              </option>
            ))}
        </select>
        <Tool
          label="Zoom in"
          onClick={() =>
            setScale(Math.min(4, (typeof scale === "number" ? scale : 1) + 0.2))
          }
        >
          <Plus size={16} />
        </Tool>
        <span className="pdf-tool-divider" />
        <Tool
          label="Find in paper"
          pressed={panel === "search"}
          onClick={() => setPanel("search")}
        >
          <Search size={16} />
        </Tool>
        <Tool
          label="Area annotation"
          disabled={!pdf}
          pressed={area}
          onClick={() => {
            setArea(!area);
            setDrawingTool(undefined);
          }}
        >
          <SquareDashed size={17} />
        </Tool>
        <select
          aria-label="Drawing tool"
          value={drawingTool ?? ""}
          disabled={!pdf}
          onChange={(e) => {
            setDrawingTool(
              (e.target.value || undefined) as PdfDrawingTool | undefined,
            );
            setArea(false);
          }}
        >
          <option value="">Select text</option>
          <option value="ink">Pen</option>
          <option value="arrow">Arrow</option>
          <option value="textbox">Text box</option>
        </select>
        <Tool
          label="Page note"
          disabled={!meta}
          onClick={() =>
            meta &&
            void choose({
              kind: "note",
              page,
              sha256: meta.sha256,
              rects: [],
              quote: "",
              body: "",
              color,
            })
          }
        >
          <StickyNote size={17} />
        </Tool>
        <Tool
          label="Bookmark"
          disabled={!pdf}
          onClick={() =>
            void work(async () => {
              await research.saveReading(
                "bookmark",
                "attachment",
                attachment.id,
                {
                  label: `${attachment.name} · p. ${labels[page - 1] ?? page}`,
                  page,
                },
              );
              setPanel("bookmarks");
            })
          }
        >
          <BookmarkPlus size={17} />
        </Tool>
        <span className="toolbar-spacer" />
        <Tool
          label="Paper assistant"
          pressed={assistant}
          disabled={!pdf || !meta?.resource_id}
          onClick={() => setAssistant(!assistant)}
        >
          <Sparkles size={17} />
        </Tool>
        <Tool
          label="Split reading view"
          pressed={split}
          onClick={() => {
            setSplit(!split);
            setSecondPage(page);
          }}
        >
          <Columns2 size={17} />
        </Tool>
        <Tool
          label="Reader view and file actions"
          pressed={options}
          onClick={() => setOptions(!options)}
        >
          <Settings2 size={17} />
        </Tool>
      </div>
      {options && (
        <div
          className="pdf-view-options"
          aria-label="Reader view and file actions"
        >
          <label>
            Layout
            <select
              aria-label="PDF page layout"
              value={view}
              onChange={(e) => setView(e.target.value as PdfView)}
            >
              <option value="continuous">Continuous</option>
              <option value="single">Single page</option>
              <option value="facing">Facing pages</option>
            </select>
          </label>
          <label>
            Paper
            <select
              aria-label="PDF paper appearance"
              value={theme}
              onChange={(e) => setTheme(e.target.value as PdfTheme)}
            >
              <option value="original">Original</option>
              <option value="warm">Warm paper</option>
              <option value="graphite">Graphite surround</option>
              <option value="contrast">High contrast surround</option>
            </select>
          </label>
          <Tool
            label="Rotate PDF clockwise"
            onClick={() => setRotation((r) => (r + 90) % 360)}
          >
            <RotateCw size={16} />
          </Tool>
          <Tool
            label="Fullscreen reader"
            onClick={() =>
              void work(async () => {
                if (document.fullscreenElement) await document.exitFullscreen();
                else if (root.current?.requestFullscreen)
                  await root.current.requestFullscreen();
                else
                  setMessage(
                    "Fullscreen is unavailable. Use the browser’s fullscreen command.",
                  );
              })
            }
          >
            <Expand size={16} />
          </Tool>
          <span className="pdf-tool-divider" />
          <button disabled={!pdf || busy} onClick={() => void toggleOffline()}>
            <Download size={15} />
            {pinned ? "Remove offline copy" : "Keep offline"}
          </button>
          <button disabled={!pdf || busy} onClick={() => void original()}>
            <Download size={15} />
            Download PDF
          </button>
          <button
            disabled={!pdf}
            onClick={() => {
              setOptions(false);
              setOrganizer(true);
            }}
          >
            <Grid2X2 size={15} />
            Organize pages
          </button>
          <button
            disabled={!pdf || !meta?.resource_id}
            onClick={() => {
              setOptions(false);
              setCompare(true);
            }}
          >
            <Columns2 size={15} />
            Compare PDFs…
          </button>
          <button
            disabled={!pdf || !meta?.resource_id}
            onClick={() => {
              setOptions(false);
              setOcr(true);
            }}
          >
            <FileText size={15} />
            Batch OCR…
          </button>
          <button
            disabled={!pdf}
            onClick={() =>
              onInsert(
                `[${attachment.name.replace(/[\[\]\\\r\n]/g, " ")}, p. ${page}](/api/v1/attachments/${attachment.id}#page=${page})\n`,
                meta?.visibility === "private",
              )
            }
          >
            <LinkIcon size={15} />
            Link this page
          </button>
          <button onClick={() => setHelp(true)}>Shortcuts</button>
        </div>
      )}
      {(error || message) && (
        <div className="paper-message" role={error ? "alert" : "status"}>
          {error || message}
          <Tool
            label="Dismiss reader message"
            onClick={() => {
              setError("");
              setMessage("");
            }}
          >
            <X size={14} />
          </Tool>
        </div>
      )}
      <div className="pdf-reader-body">
        {panel && (
          <>
            <aside
              className="paper-inspector pdf-navigator"
              aria-label={`Paper ${panel}`}
            >
              <nav
                className="pdf-navigator-tabs"
                aria-label="Reading navigator"
              >
                {(
                  [
                    ["annotations", Highlighter, "Annotations"],
                    ["outline", List, "Outline"],
                    ["thumbnails", Grid2X2, "Pages"],
                    ["bookmarks", BookmarkPlus, "Bookmarks"],
                    ["search", Search, "Search"],
                  ] as const
                ).map(([id, Icon, label]) => (
                  <Tool
                    key={id}
                    label={label}
                    pressed={panel === id}
                    onClick={() => setPanel(id)}
                  >
                    <Icon size={17} />
                  </Tool>
                ))}
                <Tool label="Close paper panel" onClick={() => setPanel(null)}>
                  <X size={14} />
                </Tool>
              </nav>
              <div className="pdf-navigator-content">
                {panel === "search" && (
                  <>
                    <h3>Find in paper</h3>
                    <form
                      className="paper-search"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void search();
                      }}
                    >
                      <input
                        aria-label="Search PDF text"
                        value={query}
                        onChange={(e) => {
                          searchToken.current++;
                          setQuery(e.target.value);
                        }}
                        placeholder="Find a phrase…"
                      />
                      <button
                        className="icon-button"
                        aria-label="Find"
                        disabled={!pdf || !query.trim()}
                      >
                        <Search size={17} />
                      </button>
                    </form>
                    <div className="pdf-filter-row">
                      <label>
                        <input
                          type="checkbox"
                          checked={matchCase}
                          onChange={(e) => {
                            searchToken.current++;
                            setMatchCase(e.target.checked);
                          }}
                        />
                        Case
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={wholeWord}
                          onChange={(e) => {
                            searchToken.current++;
                            setWholeWord(e.target.checked);
                          }}
                        />
                        Whole word
                      </label>
                    </div>
                    <div className="pdf-filter-row">
                      <span role="status">
                        {searchStatus || "Search selectable PDF text."}
                      </span>
                      <Tool
                        label="Previous search result"
                        disabled={!hits.length}
                        onClick={() => {
                          const n = (hitIndex - 1 + hits.length) % hits.length;
                          setHitIndex(n);
                          go(hits[n].page);
                        }}
                      >
                        <ChevronLeft size={15} />
                      </Tool>
                      <Tool
                        label="Next search result"
                        disabled={!hits.length}
                        onClick={() => {
                          const n = (hitIndex + 1) % hits.length;
                          setHitIndex(n);
                          go(hits[n].page);
                        }}
                      >
                        <ChevronRight size={15} />
                      </Tool>
                    </div>
                    {hits.map((hit, index) => (
                      <button
                        key={`${hit.page}:${hit.start}`}
                        className={`paper-search-hit ${hitIndex === index ? "selected" : ""}`}
                        onClick={() => {
                          setHitIndex(index);
                          go(hit.page);
                        }}
                      >
                        <strong>Page {labels[hit.page - 1] ?? hit.page}</strong>
                        <span>{hit.text}</span>
                      </button>
                    ))}
                  </>
                )}
                {panel === "outline" && (
                  <PdfOutline
                    key={attachment.id}
                    pdf={pdf}
                    items={outline}
                    page={page}
                    labels={labels}
                    onPage={go}
                  />
                )}
                {panel === "thumbnails" && pdf && (
                  <>
                    <h3>Pages</h3>
                    <div className="paper-thumbnails">
                      {Array.from({ length: pdf.numPages }, (_, index) => (
                        <Thumbnail
                          key={index}
                          pdf={pdf}
                          page={index + 1}
                          label={labels[index]}
                          selected={page === index + 1}
                          onClick={() => go(index + 1)}
                        />
                      ))}
                    </div>
                  </>
                )}
                {panel === "bookmarks" && (
                  <>
                    <h3>Reading bookmarks</h3>
                    <p className="muted">Private to your account.</p>
                    {!bookmarks.length && (
                      <p className="muted">
                        Bookmark a page to return to it later.
                      </p>
                    )}
                    {bookmarks.map((entry) => {
                      const value = entry.value as ReadingItem;
                      return (
                        <article className="pdf-bookmark" key={value.id}>
                          <button
                            className="text-button"
                            onClick={() => go(value.data.page ?? 1)}
                          >
                            Page {value.data.page}
                          </button>
                          <input
                            aria-label={`Bookmark label for page ${value.data.page}`}
                            key={value.id}
                            defaultValue={value.data.label}
                            maxLength={300}
                            onBlur={(e) => {
                              if (e.target.value !== value.data.label)
                                void work(async () => {
                                  await research.saveReading(
                                    value.kind,
                                    value.target_type,
                                    value.target_id,
                                    { ...value.data, label: e.target.value },
                                    value,
                                  );
                                });
                            }}
                          />
                          <Tool
                            label={`Remove bookmark on page ${value.data.page}`}
                            disabled={busy}
                            onClick={() => void remove(entry)}
                          >
                            <Trash2 size={14} />
                          </Tool>
                        </article>
                      );
                    })}
                  </>
                )}
                {panel === "annotations" && (
                  <>
                    <div className="pdf-panel-heading">
                      <h3>Annotations</h3>
                      <span>{annotations.length}</span>
                    </div>
                    <input
                      aria-label="Filter annotations"
                      placeholder="Search notes and quotations…"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                    <div className="pdf-filter-row">
                      <select
                        aria-label="Annotation visibility filter"
                        value={scope}
                        onChange={(e) => setScope(e.target.value)}
                      >
                        <option value="all">All accessible</option>
                        <option value="mine">My annotations</option>
                        <option value="shared">Shared</option>
                      </select>
                      <select
                        aria-label="Annotation color filter"
                        value={colorFilter}
                        onChange={(e) => setColorFilter(e.target.value)}
                      >
                        <option value="">All colors</option>
                        {["yellow", "green", "blue", "pink"].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    {!visibleAnnotations.length && (
                      <div className="pdf-empty">
                        <Highlighter size={25} />
                        <strong>
                          {annotations.length
                            ? "No matching annotations"
                            : "Read. Mark. Connect."}
                        </strong>
                        <p>
                          Select text, mark a figure, or add a page note. New
                          annotations are private.
                        </p>
                      </div>
                    )}
                    {!!visibleAnnotations.length && (
                      <label className="pdf-bulk-select">
                        <input
                          type="checkbox"
                          aria-label="Select visible annotations"
                          checked={
                            visibleAnnotations.length > 0 &&
                            visibleAnnotations.every((a) => checked.has(a.id))
                          }
                          onChange={(e) =>
                            setChecked(
                              e.target.checked
                                ? new Set(
                                    visibleAnnotations
                                      .filter(
                                        (a) =>
                                          a.author_id === userId &&
                                          !entries.find(
                                            (e) => e.value.id === a.id,
                                          )?.pending,
                                      )
                                      .slice(0, 100)
                                      .map((a) => a.id),
                                  )
                                : new Set(),
                            )
                          }
                        />
                        Select up to 100
                      </label>
                    )}
                    <PdfBulkActions
                      marks={annotations.filter((a) => checked.has(a.id))}
                      onClear={() => setChecked(new Set())}
                      onRefresh={() => void research.sync()}
                    />
                    {visibleAnnotations.map((a) => {
                      const entry = entries.find((e) => e.value.id === a.id)!;
                      return (
                        <article
                          className={`annotation-card ${selectedId === a.id ? "selected" : ""}`}
                          data-color={a.data.color}
                          key={a.id}
                        >
                          <label className="pdf-bulk-select">
                            <input
                              type="checkbox"
                              aria-label={`Select annotation on page ${a.data.page}`}
                              disabled={entry.pending || a.author_id !== userId}
                              checked={checked.has(a.id)}
                              onChange={(e) =>
                                setChecked((old) => {
                                  const next = new Set(old);
                                  if (e.target.checked && next.size < 100)
                                    next.add(a.id);
                                  else next.delete(a.id);
                                  return next;
                                })
                              }
                            />
                            Select
                          </label>
                          <button
                            className="pdf-annotation-location"
                            onClick={() => {
                              go(a.data.page);
                              setSelectedId(a.id);
                            }}
                          >
                            <span>
                              Page {labels[a.data.page - 1] ?? a.data.page}
                            </span>
                            <span>{a.shared ? "Shared" : "Private"}</span>
                          </button>
                          <small>
                            {a.author_id === userId
                              ? "You"
                              : (a.author_name ?? "Researcher")}
                          </small>
                          {a.data.quote && (
                            <blockquote>{a.data.quote}</blockquote>
                          )}
                          {a.data.body && (
                            <p className="pdf-annotation-body">{a.data.body}</p>
                          )}
                          {!!a.data.tags?.length && (
                            <div className="pdf-annotation-tags">
                              {a.data.tags.map((tag) => (
                                <span key={tag}>{tag}</span>
                              ))}
                            </div>
                          )}
                          <small
                            className={entry.error ? "danger-text" : "muted"}
                          >
                            {entry.error ??
                              (entry.pending
                                ? "Saved locally · awaiting sync"
                                : "Synced")}
                          </small>
                          <div className="pdf-annotation-actions">
                            <button
                              disabled={entry.pending}
                              onClick={() => setThread(a)}
                            >
                              Discuss
                              {a.reply_count ? ` (${a.reply_count})` : ""}
                              {a.unread_replies ? " · New" : ""}
                              {a.resolved ? " · Resolved" : ""}
                            </button>
                            <Tool
                              label="Insert into note"
                              onClick={() =>
                                onInsert(
                                  annotationMarkdown(
                                    a,
                                    attachment.name,
                                    citeKey,
                                  ),
                                  !a.shared || meta?.visibility === "private",
                                )
                              }
                            >
                              <FileText size={14} />
                            </Tool>
                            {a.author_id === userId && (
                              <>
                                <button
                                  onClick={() => {
                                    go(a.data.page);
                                    void choose(a.data, a);
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  disabled={
                                    busy ||
                                    !navigator.onLine ||
                                    meta?.visibility !== "shared" ||
                                    meta.content_role === "viewer"
                                  }
                                  onClick={() =>
                                    void work(async () => {
                                      if (
                                        !a.shared &&
                                        !(await confirmAction(
                                          "Everyone with access to this paper will be able to read this annotation.",
                                          {
                                            title: "Share annotation?",
                                            confirmLabel: "Share",
                                          },
                                        ))
                                      )
                                        return;
                                      await research.saveAnnotation(
                                        attachment.id,
                                        a.data,
                                        !a.shared,
                                        a,
                                      );
                                    })
                                  }
                                >
                                  {a.shared
                                    ? "Make private"
                                    : "Share with readers"}
                                </button>
                              </>
                            )}
                            {(a.author_id === userId ||
                              (a.shared && meta?.role === "admin")) && (
                              <Tool
                                label="Remove annotation"
                                disabled={busy}
                                onClick={() => void remove(entry)}
                              >
                                <Trash2 size={14} />
                              </Tool>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    <div className="pdf-export-actions">
                      <button
                        disabled={!pdf || busy}
                        onClick={() => setTransfer("import")}
                      >
                        Import embedded annotations…
                      </button>
                      <button
                        disabled={!pdf || !visibleAnnotations.length || busy}
                        onClick={() => setTransfer("export")}
                      >
                        Export annotated PDF…
                      </button>
                      <button
                        disabled={!annotations.length}
                        onClick={() =>
                          download(
                            "paper-annotations.md",
                            visibleAnnotations
                              .map((a) =>
                                annotationMarkdown(a, attachment.name, citeKey),
                              )
                              .join("\n---\n\n"),
                          )
                        }
                      >
                        <Download size={14} />
                        Export Markdown
                      </button>
                      <button
                        disabled={!annotations.length}
                        onClick={() =>
                          download(
                            "paper-annotations.json",
                            JSON.stringify(
                              {
                                format: "axiom-annotations",
                                version: 1,
                                paper: {
                                  id: attachment.id,
                                  sha256: meta?.sha256,
                                  name: attachment.name,
                                },
                                annotations: visibleAnnotations,
                              },
                              null,
                              2,
                            ),
                            "application/json",
                          )
                        }
                      >
                        Export JSON
                      </button>
                    </div>
                  </>
                )}
              </div>
            </aside>
            <div
              className="pdf-pane-divider"
              role="separator"
              aria-label="Resize reading navigator"
              aria-orientation="vertical"
              aria-valuenow={navWidth}
              aria-valuemin={200}
              aria-valuemax={440}
              tabIndex={0}
              onKeyDown={(e) => {
                if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                  e.preventDefault();
                  setNavWidth((v) =>
                    Math.max(
                      200,
                      Math.min(440, v + (e.key === "ArrowLeft" ? -10 : 10)),
                    ),
                  );
                }
              }}
              onPointerDown={(e) =>
                e.currentTarget.setPointerCapture(e.pointerId)
              }
              onPointerMove={(e) => {
                if (
                  e.currentTarget.hasPointerCapture(e.pointerId) &&
                  root.current
                )
                  setNavWidth(
                    Math.max(
                      200,
                      Math.min(
                        440,
                        e.clientX - root.current.getBoundingClientRect().left,
                      ),
                    ),
                  );
              }}
              onPointerUp={(e) =>
                e.currentTarget.releasePointerCapture(e.pointerId)
              }
            />
          </>
        )}
        <div className={`pdf-reading-surfaces ${split ? "is-split" : ""}`}>
          {pdf ? (
            <PdfPages
              pdf={pdf}
              page={page}
              jump={jump}
              resumeOffset={resumeOffset}
              onPosition={setOffset}
              scale={scale}
              rotation={rotation}
              view={view}
              labels={labels}
              annotations={annotations}
              drawingTool={drawingTool}
              editableAnnotation={
                annotations.find(
                  (a) => a.id === selectedId && a.author_id === userId,
                )?.id
              }
              onUpdateAnnotation={(a, data) =>
                void work(async () => {
                  const after = await research.saveAnnotation(
                    attachment.id,
                    data,
                    a.shared,
                    a,
                  );
                  setDrawingUndo({ before: a, after });
                  setUndo(null);
                })
              }
              selected={selectedId}
              query={query}
              matchCase={matchCase}
              wholeWord={wholeWord}
              activeHit={hits[hitIndex]}
              area={area}
              onPage={setPage}
              onSelect={capture}
              onAnnotation={(a) => {
                setSelectedId(a.id);
                setPanel("annotations");
                if (a.author_id === userId) void choose(a.data, a);
              }}
            />
          ) : (
            !error && (
              <div className="paper-loading">
                <LoaderCircle className="spin" size={20} />
                Opening paper…
              </div>
            )
          )}
          {split && pdf && (
            <div className="pdf-secondary-surface">
              <div className="pdf-secondary-toolbar">
                <span>Reference view</span>
                <Tool
                  label="Previous reference page"
                  disabled={secondPage <= 1}
                  onClick={() => setSecondPage((p) => p - 1)}
                >
                  <ChevronLeft size={15} />
                </Tool>
                <span>
                  {secondPage} / {pdf.numPages}
                </span>
                <Tool
                  label="Next reference page"
                  disabled={secondPage >= pdf.numPages}
                  onClick={() => setSecondPage((p) => p + 1)}
                >
                  <ChevronRight size={15} />
                </Tool>
                <Tool label="Close split view" onClick={() => setSplit(false)}>
                  <X size={15} />
                </Tool>
              </div>
              <PdfPages
                pdf={pdf}
                page={secondPage}
                jump={secondPage}
                scale="fit"
                rotation={rotation}
                view="single"
                labels={labels}
                annotations={annotations}
                selected={selectedId}
                query={query}
                area={false}
                onPage={setSecondPage}
                onSelect={capture}
                onAnnotation={(a) => {
                  setPanel("annotations");
                  setSelectedId(a.id);
                }}
              />
            </div>
          )}
        </div>
        {assistant && pdf && meta?.resource_id && (
          <PaperAssistant
            key={attachment.id}
            pdf={pdf}
            resourceId={meta.resource_id}
            versionId={attachment.id}
            page={page}
            onPage={go}
            onClose={() => setAssistant(false)}
            onInsert={onInsert}
          />
        )}
        {selected && !assistant && (
          <section
            className="annotation-composer pdf-composer"
            aria-label="Annotation editor"
          >
            <header>
              <strong>
                {editing
                  ? "Edit annotation"
                  : selected.kind === "area"
                    ? "Area highlight"
                    : selected.kind === "note"
                      ? "Private page note"
                      : "Selected quotation"}
              </strong>
              <Tool
                label="Cancel annotation"
                onClick={() =>
                  void abandon().then((ok) => {
                    if (ok) {
                      setSelected(null);
                      setEditing(undefined);
                      setBody("");
                    }
                  })
                }
              >
                <X size={15} />
              </Tool>
            </header>
            <small>
              Page {labels[selected.page - 1] ?? selected.page} ·{" "}
              {editing?.shared ? "Shared" : "Only you"}
            </small>
            {selected.quote && <blockquote>{selected.quote}</blockquote>}
            <label>
              Annotation note
              <textarea
                aria-label="Annotation note"
                value={body}
                rows={8}
                onChange={(e) => setBody(e.target.value)}
                maxLength={12000}
                placeholder="A question, connection, or caveat…"
              />
            </label>
            <div className="annotation-colors">
              {(["yellow", "green", "blue", "pink"] as const).map((c) => (
                <button
                  key={c}
                  className={`highlight-color ${c}`}
                  aria-label={`${c} highlight`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                >
                  {color === c && <Check size={14} />}
                </button>
              ))}
            </div>
            <label>
              Tags
              <input
                aria-label="Annotation tags"
                value={tags}
                maxLength={500}
                onChange={(e) => setTags(e.target.value)}
                placeholder="method, limitation, follow-up"
              />
            </label>
            {selected.imported && (
              <small>
                Imported author: {selected.imported.author || "Unspecified"}.
                This private copy belongs to you.
              </small>
            )}
            <div className="button-row">
              <button
                className="button primary small"
                disabled={busy || (selected.kind === "note" && !body.trim())}
                onClick={() => void save()}
              >
                {editing ? "Save changes" : "Save privately"}
              </button>
              <button
                className="button secondary small"
                disabled={busy || (selected.kind === "note" && !body.trim())}
                onClick={() => void save(true)}
              >
                Insert quotation
              </button>
            </div>
          </section>
        )}
      </div>
      <footer className="pdf-statusbar">
        <span>
          {pdf
            ? `Page ${labels[page - 1] ?? page} of ${pdf.numPages}`
            : "Opening document"}
        </span>
        <span>
          {annotations.length} annotations{pinned ? " · Available offline" : ""}
        </span>
        {(undo || drawingUndo) && (
          <button disabled={busy} onClick={() => void restore()}>
            <Undo2 size={13} />
            {drawingUndo ? "Undo drawing" : "Undo removal"}
          </button>
        )}
        <span className="toolbar-spacer" />
        <span title={research.status}>{research.status}</span>
      </footer>
      {passwordRequest && (
        <Dialog
          title={
            passwordRequest.retry ? "Incorrect PDF password" : "Unlock PDF"
          }
          onClose={() => {
            setPasswordRequest(null);
            onClose();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              passwordRequest.update(password);
              setPassword("");
              setPasswordRequest(null);
            }}
          >
            <p>
              The password is used only in this reader session and is not saved.
            </p>
            <label>
              Password
              <input
                autoFocus
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <div className="dialog-footer">
              <button className="button primary" disabled={!password}>
                Unlock
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {help && (
        <Dialog title="PDF reader shortcuts" onClose={() => setHelp(false)}>
          <dl className="pdf-shortcuts">
            <dt>⌘ / Ctrl F</dt>
            <dd>Find in paper</dd>
            <dt>Page Up / Left</dt>
            <dd>Previous page</dd>
            <dt>Page Down / Right</dt>
            <dd>Next page</dd>
            <dt>⌘ / Ctrl Z</dt>
            <dd>Undo last removal outside text fields</dd>
            <dt>Escape</dt>
            <dd>Exit area selection and view options</dd>
            <dt>Navigator divider + arrow keys</dt>
            <dd>Resize the reading navigator</dd>
          </dl>
        </Dialog>
      )}
      {organizer && pdf && (
        <PdfOrganizer
          pdf={pdf}
          name={attachment.name}
          bytes={meta?.bytes ?? 0}
          meta={meta ?? undefined}
          annotations={visibleAnnotations}
          returnFocus={() =>
            root.current?.querySelector<HTMLButtonElement>(
              'button[aria-label="Reader view and file actions"]',
            ) ?? null
          }
          onClose={() => setOrganizer(false)}
        />
      )}
      {thread && (
        <PdfAnnotationThread
          annotation={thread}
          userId={userId}
          canManage={meta?.role === "admin"}
          canComment={meta?.content_role !== "viewer"}
          onClose={() => setThread(null)}
        />
      )}
      {compare && pdf && meta && (
        <PdfCompare
          pdf={pdf}
          meta={meta}
          userId={userId}
          onClose={() => setCompare(false)}
          returnFocus={() =>
            root.current?.querySelector<HTMLButtonElement>(
              'button[aria-label="Reader view and file actions"]',
            ) ?? null
          }
        />
      )}
      {ocr && pdf && meta && (
        <PdfOcrPanel
          pdf={pdf}
          meta={meta}
          onClose={() => setOcr(false)}
          returnFocus={() =>
            root.current?.querySelector<HTMLButtonElement>(
              'button[aria-label="Reader view and file actions"]',
            ) ?? null
          }
          onInsert={onInsert}
        />
      )}
      {transfer && pdf && meta && (
        <PdfAnnotationTransfer
          mode={transfer}
          pdf={pdf}
          annotations={
            transfer === "export"
              ? visibleAnnotations
              : annotations.filter((a) => a.author_id === userId)
          }
          sha256={meta.sha256}
          name={attachment.name}
          onClose={() => setTransfer(null)}
          onImport={async (items, signal) => {
            for (const data of items) {
              if (signal.aborted) return;
              const known = current.current.entries.some(
                (entry) =>
                  entry.kind === "annotation" &&
                  (entry.value as Annotation).attachment_id === attachment.id &&
                  (entry.value as Annotation).author_id === userId &&
                  (entry.value as Annotation).data.imported?.sourceId ===
                    data.imported?.sourceId &&
                  !entry.value.deleted,
              );
              if (!known)
                await current.current.saveAnnotation(
                  attachment.id,
                  data,
                  false,
                );
            }
            setPanel("annotations");
            setMessage("Embedded annotations imported as private copies.");
          }}
        />
      )}
    </section>
  );
}
export function Tool({
  label,
  children,
  onClick,
  pressed,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Thumbnail({
  pdf,
  page,
  label,
  selected,
  onClick,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  label?: string;
  selected: boolean;
  onClick: () => void;
}) {
  const root = useRef<HTMLButtonElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true,
      task: { cancel: () => void } | undefined,
      visible = false;
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (!visible) {
          task?.cancel();
          if (canvas.current) canvas.current.width = canvas.current.height = 0;
          return;
        }
        void pdf
          .getPage(page)
          .then(async (p) => {
            if (!alive || !visible || !canvas.current) return;
            const viewport = p.getViewport({
              scale: 120 / p.getViewport({ scale: 1 }).width,
            });
            canvas.current.width = Math.ceil(viewport.width);
            canvas.current.height = Math.ceil(viewport.height);
            const render = p.render({ canvas: canvas.current, viewport });
            task = render;
            await render.promise;
          })
          .catch(() => {});
      },
      { rootMargin: "100px" },
    );
    if (root.current) observer.observe(root.current);
    return () => {
      alive = false;
      observer.disconnect();
      task?.cancel();
    };
  }, [pdf, page]);
  return (
    <button
      ref={root}
      className={selected ? "selected" : ""}
      aria-label={`Open PDF page ${label ?? page}`}
      aria-current={selected ? "page" : undefined}
      onClick={onClick}
    >
      <canvas ref={canvas} />
      <span>{label ?? page}</span>
    </button>
  );
}
