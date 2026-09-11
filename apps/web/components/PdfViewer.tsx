"use client";
import { useEffect, useRef, useState } from "react";
import {
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  Highlighter,
  Link as LinkIcon,
  List,
  LoaderCircle,
  Minus,
  Plus,
  RotateCw,
  Search,
  SquareDashed,
  StickyNote,
  X,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
import {
  annotationMarkdown,
  type Annotation,
  type AnnotationData,
  type ReadingItem,
} from "@axiom/shared/research";
import { api, download } from "../lib/client";
import {
  loadPaper,
  pinPaper,
  removeResearch,
  type PaperMeta,
  type ResearchController,
} from "../lib/research-store";
type Rect = [number, number, number, number];
function normalizedRect(v: PageViewport, rect: Rect): Rect {
  const a = v.convertToPdfPoint(rect[0], rect[1]),
    b = v.convertToPdfPoint(rect[0] + rect[2], rect[1] + rect[3]);
  const [x, y, right, top] = v.viewBox,
    w = right - x,
    h = top - y;
  const left = Math.max(0, Math.min(1, (Math.min(a[0], b[0]) - x) / w)),
    bottom = Math.max(0, Math.min(1, (Math.min(a[1], b[1]) - y) / h));
  return [
    left,
    bottom,
    Math.min(1 - left, Math.abs(b[0] - a[0]) / w),
    Math.min(1 - bottom, Math.abs(b[1] - a[1]) / h),
  ];
}
function displayRect(v: PageViewport, rect: Rect): Rect {
  const [x, y, right, top] = v.viewBox,
    w = right - x,
    h = top - y;
  const a = v.convertToViewportPoint(x + rect[0] * w, y + rect[1] * h),
    b = v.convertToViewportPoint(
      x + (rect[0] + rect[2]) * w,
      y + (rect[1] + rect[3]) * h,
    );
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
  ];
}
export default function PdfViewer({
  attachment,
  userId,
  research,
  onInsert,
  onClose,
  citeKey,
}: {
  attachment: { id: string; name: string; page?: number; annotation?: string };
  userId: string;
  research: ResearchController;
  onInsert: (value: string, privateMaterial?: boolean) => void;
  onClose: () => void;
  citeKey?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    textLayer = useRef<HTMLDivElement>(null),
    pageRoot = useRef<HTMLDivElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    library = useRef<typeof import("pdfjs-dist") | null>(null),
    bytes = useRef<Uint8Array | null>(null),
    searchId = useRef(0),
    current = useRef(research),
    progressRef = useRef<ReadingItem | undefined>(undefined);
  current.current = research;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [meta, setMeta] = useState<PaperMeta | null>(null),
    [page, setPage] = useState(1),
    [scale, setScale] = useState<number | "fit">("fit"),
    [rotation, setRotation] = useState(0),
    [width, setWidth] = useState(600),
    [viewport, setViewport] = useState<PageViewport | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [panel, setPanel] = useState<
      "annotations" | "outline" | "thumbnails" | "search" | null
    >(null),
    [outline, setOutline] = useState<
      { title: string; dest: any; depth: number }[]
    >([]),
    [query, setQuery] = useState(""),
    [hits, setHits] = useState<{ page: number; text: string }[]>([]),
    [searchProgress, setSearchProgress] = useState(""),
    [selected, setSelected] = useState<AnnotationData | null>(null),
    [editing, setEditing] = useState<Annotation | undefined>(undefined),
    [body, setBody] = useState(""),
    [color, setColor] = useState<AnnotationData["color"]>("yellow"),
    [area, setArea] = useState(false),
    [drag, setDrag] = useState<Rect | null>(null),
    [selectedAnnotation, setSelectedAnnotation] = useState(
      attachment.annotation ?? "",
    ),
    [rendered, setRendered] = useState(false);
  const pinned = research.papers.some((p) => p.meta.id === attachment.id);
  const annotations = research.entries.filter(
    (e) =>
      e.kind === "annotation" &&
      (e.value as Annotation).attachment_id === attachment.id &&
      !e.value.deleted,
  );
  const go = (n: number) => {
    if (!pdf) return;
    setPage(Math.max(1, Math.min(pdf.numPages, n)));
    setSelected(null);
    setEditing(undefined);
    setBody("");
    scroller.current?.scrollTo({ top: 0, left: 0 });
  };
  useEffect(() => {
    let alive = true;
    let task:
      ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    setPdf(null);
    setMeta(null);
    setError("");
    setSelected(null);
    setRotation(0);
    setScale("fit");
    setRendered(false);
    bytes.current = null;
    searchId.current++;
    void Promise.all([loadPaper(userId, attachment.id), import("pdfjs-dist")])
      .then(async ([paper, lib]) => {
        if (!alive) return;
        library.current = lib;
        bytes.current = paper.bytes;
        setMeta(paper.meta);
        lib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        task = lib.getDocument({ data: paper.bytes.slice() });
        const document = await task.promise;
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
            /* Resume local state. */
          }
        if (!alive) return;
        progressRef.current = progress;
        setPage(
          Math.max(
            1,
            Math.min(
              document.numPages,
              attachment.page ?? progress?.data.page ?? 1,
            ),
          ),
        );
        setPdf(document);
        const tree = await document.getOutline();
        if (!alive) return;
        const flat: { title: string; dest: any; depth: number }[] = [];
        const walk = (items: any[], depth = 0) => {
          for (const item of items) {
            flat.push({ title: item.title, dest: item.dest, depth });
            if (depth < 8) walk(item.items ?? [], depth + 1);
          }
        };
        walk(tree ?? []);
        setOutline(flat.slice(0, 2000));
      })
      .catch((e) => {
        if (alive)
          setError(
            e?.name === "PasswordException"
              ? "This PDF is password protected. Unlock it locally before attaching an unlocked copy."
              : e.message || "Unable to load this PDF.",
          );
      });
    const unavailable = (e: Event) => {
      if ((e as CustomEvent).detail === attachment.id) {
        bytes.current = null;
        setPdf(null);
        setMeta(null);
        setError(
          "Access changed. The offline paper was removed; unsynced personal annotations remain in reading data for export.",
        );
        void task?.destroy();
      }
    };
    window.addEventListener("axiom-paper-unavailable", unavailable);
    return () => {
      alive = false;
      bytes.current = null;
      searchId.current++;
      window.removeEventListener("axiom-paper-unavailable", unavailable);
      void task?.destroy();
    };
  }, [attachment.id, userId]);
  useEffect(() => {
    research.watchPaper(attachment.id);
    return () => research.watchPaper(null);
  }, [attachment.id, research.groupId, research.watchPaper]);
  useEffect(() => {
    if (attachment.page && pdf) go(attachment.page);
  }, [attachment.page]);
  useEffect(() => {
    setSelectedAnnotation(attachment.annotation ?? "");
  }, [attachment.annotation, attachment.id]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(180, entries[0].contentRect.width - 32)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !canvas.current || !textLayer.current) return;
    let alive = true,
      render: { cancel: () => void } | undefined,
      text:
        InstanceType<(typeof import("pdfjs-dist"))["TextLayer"]> | undefined;
    setRendered(false);
    const layer = textLayer.current;
    layer.replaceChildren();
    void pdf
      .getPage(page)
      .then(async (p) => {
        if (!alive || !canvas.current || !library.current) return;
        const rotate = (p.rotate + rotation) % 360,
          base = p.getViewport({ scale: 1, rotation: rotate }),
          v = p.getViewport({
            scale: scale === "fit" ? width / base.width : scale,
            rotation: rotate,
          });
        setViewport(v);
        const target = canvas.current,
          ratio = Math.min(
            window.devicePixelRatio || 1,
            2,
            Math.sqrt(16_000_000 / (v.width * v.height)),
          );
        target.width = Math.floor(v.width * ratio);
        target.height = Math.floor(v.height * ratio);
        target.style.width = v.width + "px";
        target.style.height = v.height + "px";
        const rendering = p.render({
          canvas: target,
          viewport: v,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        render = rendering;
        await rendering.promise;
        if (!alive) return;
        const content = await p.getTextContent();
        if (!alive) return;
        text = new library.current.TextLayer({
          textContentSource: content,
          container: layer,
          viewport: v,
        });
        await text.render();
        if (!alive) return;
        setRendered(true);
        setMessage(
          content.items.length
            ? ""
            : "This page has no searchable text. Area highlights and page notes still work; OCR is not included.",
        );
      })
      .catch((e) => {
        if (
          alive &&
          !["RenderingCancelledException", "AbortException"].includes(e.name)
        )
          setError(e.message);
      });
    return () => {
      alive = false;
      render?.cancel();
      text?.cancel();
    };
  }, [pdf, page, scale, rotation, width]);
  useEffect(() => {
    if (!pdf || !meta) return;
    const timer = setTimeout(() => {
      void current.current
        .saveReading(
          "progress",
          "attachment",
          meta.id,
          { label: meta.name, page, fraction: page / pdf.numPages },
          progressRef.current,
        )
        .then((r) => {
          progressRef.current = r;
        })
        .catch((e) => setMessage(e.message));
    }, 800);
    return () => clearTimeout(timer);
  }, [pdf, meta, page]);
  useEffect(() => {
    if (!rendered || !textLayer.current) return;
    for (const span of textLayer.current.querySelectorAll("span"))
      span.classList.toggle(
        "pdf-search-match",
        query.trim().length >= 2 &&
          (span.textContent ?? "")
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      );
  }, [query, rendered]);
  const capture = () => {
    if (!viewport || !meta || area) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!textLayer.current?.contains(range.commonAncestorContainer)) return;
    const bounds = pageRoot.current!.getBoundingClientRect();
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1)
      .slice(0, 200)
      .map((r) =>
        normalizedRect(viewport, [
          r.left - bounds.left,
          r.top - bounds.top,
          r.width,
          r.height,
        ]),
      )
      .filter((r) => r[2] > 0 && r[3] > 0);
    if (!rects.length) return;
    setSelected({
      kind: "highlight",
      page,
      sha256: meta.sha256,
      rects,
      quote: selection.toString().slice(0, 12000),
      body: "",
      color,
    });
    setEditing(undefined);
    setBody("");
  };
  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const startNote = () => {
    if (!meta) return;
    setSelected({
      kind: "note",
      page,
      sha256: meta.sha256,
      rects: [],
      quote: "",
      body: "",
      color,
    });
    setBody("");
    setEditing(undefined);
    setPanel("annotations");
  };
  const find = async () => {
    if (!pdf || query.trim().length < 2) return;
    const token = ++searchId.current,
      term = query.trim().toLowerCase();
    setHits([]);
    setPanel("search");
    const found: { page: number; text: string }[] = [];
    let textPages = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      if (searchId.current !== token) return;
      try {
        const p = await pdf.getPage(n),
          content = await p.getTextContent();
        if (searchId.current !== token) return;
        const text = content.items
          .map((i) => ("str" in i ? i.str : ""))
          .join(" ")
          .replace(/\s+/g, " ");
        if (text.trim()) textPages++;
        const index = text.toLowerCase().indexOf(term);
        if (index >= 0)
          found.push({
            page: n,
            text: text.slice(
              Math.max(0, index - 60),
              index + term.length + 100,
            ),
          });
        if (n % 10 === 0 || index >= 0 || n === pdf.numPages) {
          setHits([...found]);
          setSearchProgress(`Searched ${n} / ${pdf.numPages} pages`);
        }
        if (found.length >= 500) break;
      } catch {
        if (searchId.current === token)
          setSearchProgress("A page could not be read; search stopped.");
        return;
      }
    }
    if (searchId.current === token)
      setSearchProgress(
        textPages
          ? `${found.length} matching pages${found.length >= 500 ? " (first 500)" : ""}`
          : "This PDF has no searchable text. OCR is not included.",
      );
  };
  const paperName = meta?.name ?? attachment.name;
  const insert = (a: Annotation) =>
    onInsert(
      annotationMarkdown(a, paperName, citeKey),
      !a.shared || meta?.visibility === "private",
    );
  return (
    <section className="pdf-viewer" aria-label="Paper reader">
      <header className="paper-heading">
        <div>
          <span className="eyebrow">PAPER WORKSPACE</span>
          <strong>{paperName}</strong>
        </div>
        <button
          className="icon-button"
          aria-label="Close paper reader"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="pdf-toolbar">
        <button
          className="icon-button"
          aria-label="Previous PDF page"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <span>
          {page} / {pdf?.numPages ?? "…"}
        </span>
        <button
          className="icon-button"
          aria-label="Next PDF page"
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => go(page + 1)}
        >
          <ChevronRight size={17} />
        </button>
        <input
          className="pdf-page-input"
          aria-label="Go to PDF page"
          type="number"
          min={1}
          max={pdf?.numPages}
          value={page}
          onChange={(e) => {
            if (e.target.value) go(Number(e.target.value));
          }}
        />
        <div className="toolbar-spacer" />
        <button
          className="icon-button"
          aria-label="Zoom out"
          onClick={() =>
            setScale(
              Math.max(
                0.25,
                (scale === "fit" ? (viewport?.scale ?? 1) : scale) - 0.2,
              ),
            )
          }
        >
          <Minus size={16} />
        </button>
        <button
          className="text-button"
          onClick={() => setScale("fit")}
          title="Fit paper to width"
        >
          {scale === "fit" ? "Fit width" : `${Math.round(scale * 100)}%`}
        </button>
        <button
          className="icon-button"
          aria-label="Zoom in"
          onClick={() =>
            setScale(
              Math.min(
                4,
                (scale === "fit" ? (viewport?.scale ?? 1) : scale) + 0.2,
              ),
            )
          }
        >
          <Plus size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Rotate PDF clockwise"
          onClick={() => setRotation((r) => (r + 90) % 360)}
        >
          <RotateCw size={16} />
        </button>
      </div>
      <form
        className="paper-search"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <Search size={15} />
        <input
          aria-label="Search PDF text"
          placeholder="Find in this paper…"
          value={query}
          onChange={(e) => {
            searchId.current++;
            setQuery(e.target.value);
          }}
        />
        <button
          className="button secondary small"
          disabled={!pdf || query.trim().length < 2}
        >
          Find
        </button>
      </form>
      <div className="paper-tools">
        <button
          className={panel === "outline" ? "active" : ""}
          onClick={() => setPanel(panel === "outline" ? null : "outline")}
        >
          <List size={15} />
          Outline
        </button>
        <button
          className={panel === "thumbnails" ? "active" : ""}
          onClick={() => setPanel(panel === "thumbnails" ? null : "thumbnails")}
        >
          Pages
        </button>
        <button
          className={panel === "annotations" ? "active" : ""}
          onClick={() =>
            setPanel(panel === "annotations" ? null : "annotations")
          }
        >
          <Highlighter size={15} />
          {annotations.length} annotations
        </button>
        <button onClick={startNote} disabled={!meta}>
          <StickyNote size={15} />
          Page note
        </button>
        <button
          className={area ? "active" : ""}
          onClick={() => {
            setArea(!area);
            setSelected(null);
          }}
          disabled={!meta}
        >
          <SquareDashed size={15} />
          Area
        </button>
        <button
          disabled={!meta}
          onClick={() =>
            void work(async () => {
              await research.saveReading(
                "bookmark",
                "attachment",
                attachment.id,
                { label: attachment.name, page },
              );
              setMessage("Page bookmarked privately.");
            })
          }
        >
          <BookmarkPlus size={15} />
          Bookmark
        </button>
      </div>
      <div className="paper-tools">
        <button
          disabled={!meta || busy}
          onClick={() =>
            void work(async () => {
              if (pinned) {
                await removeResearch(userId, "pdf:" + attachment.id);
                setMessage("Offline PDF removed. Your annotations were kept.");
              } else if (meta && bytes.current) {
                await pinPaper(userId, meta, bytes.current);
                await research.refresh();
                setMessage(
                  "PDF kept on this device. Offline copies cannot be remotely recalled; sign-out clears this browser’s copy.",
                );
              }
            })
          }
        >
          <Download size={15} />
          {pinned ? "Remove offline copy" : "Keep offline"}
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
        <button
          disabled={!bytes.current}
          onClick={() => {
            if (!bytes.current) return;
            const url = URL.createObjectURL(
                new Blob([new Uint8Array(bytes.current)], {
                  type: "application/pdf",
                }),
              ),
              a = document.createElement("a");
            a.href = url;
            a.download = attachment.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download PDF
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="paper-message" role="status">
          {message}
        </p>
      )}
      {panel && (
        <aside className="paper-inspector" aria-label={`Paper ${panel}`}>
          <button
            className="icon-button inspector-close"
            aria-label="Close paper panel"
            onClick={() => setPanel(null)}
          >
            <X size={15} />
          </button>
          {panel === "outline" && (
            <>
              <h4>Document outline</h4>
              {!outline.length && (
                <p className="muted">This paper does not contain an outline.</p>
              )}
              {outline.map((item, i) => (
                <button
                  className="outline-entry"
                  style={{ paddingLeft: 12 + item.depth * 14 }}
                  key={i}
                  onClick={() =>
                    void work(async () => {
                      const dest =
                        typeof item.dest === "string"
                          ? await pdf?.getDestination(item.dest)
                          : item.dest;
                      if (!dest || !pdf) return;
                      go(
                        typeof dest[0] === "number"
                          ? dest[0] + 1
                          : (await pdf.getPageIndex(dest[0])) + 1,
                      );
                      setPanel(null);
                    })
                  }
                >
                  {item.title}
                </button>
              ))}
            </>
          )}
          {panel === "thumbnails" && pdf && (
            <>
              <h4>Pages</h4>
              <div className="paper-thumbnails">
                {Array.from(
                  { length: Math.min(pdf.numPages, 10000) },
                  (_, i) => (
                    <Thumbnail
                      key={i}
                      pdf={pdf}
                      page={i + 1}
                      selected={page === i + 1}
                      onClick={() => {
                        go(i + 1);
                        setPanel(null);
                      }}
                    />
                  ),
                )}
              </div>
            </>
          )}
          {panel === "search" && (
            <>
              <h4>Find in paper</h4>
              <p role="status">
                {searchProgress ||
                  "Enter at least two characters and press Find."}
              </p>
              {hits.map((hit) => (
                <button
                  className="paper-search-hit"
                  key={hit.page}
                  onClick={() => {
                    go(hit.page);
                    setPanel(null);
                  }}
                >
                  <strong>Page {hit.page}</strong>
                  <span>{hit.text}</span>
                </button>
              ))}
            </>
          )}
          {panel === "annotations" && (
            <>
              <h4>Highlights & notes</h4>
              <p className="muted">
                Private unless explicitly shared. Shared annotations follow
                access to this paper.
              </p>
              <div className="button-row">
                <button
                  className="button secondary small"
                  onClick={() =>
                    download(
                      "paper-annotations.md",
                      annotations
                        .map((e) =>
                          annotationMarkdown(
                            e.value as Annotation,
                            attachment.name,
                            citeKey,
                          ),
                        )
                        .join("\n---\n\n"),
                    )
                  }
                >
                  Export Markdown
                </button>
                <button
                  className="button secondary small"
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
                          annotations: annotations.map((e) => e.value),
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
              {!annotations.length && (
                <p className="muted">
                  Select text to highlight it, draw an area, or add a page note.
                </p>
              )}
              {annotations.map((entry) => {
                const a = entry.value as Annotation;
                return (
                  <article
                    className={`annotation-card ${selectedAnnotation === a.id ? "selected" : ""}`}
                    key={a.id}
                  >
                    <button
                      className="text-button"
                      onClick={() => {
                        go(a.data.page);
                        setSelectedAnnotation(a.id);
                        setPanel(null);
                      }}
                    >
                      Page {a.data.page} · {a.shared ? "Shared" : "Private"} ·{" "}
                      {a.author_id === userId
                        ? "You"
                        : (a.author_name ?? "Researcher")}
                    </button>
                    {a.data.quote && <blockquote>{a.data.quote}</blockquote>}
                    {a.data.body && <p>{a.data.body}</p>}
                    <small>
                      {entry.error ??
                        (entry.pending
                          ? "Saved locally · awaiting sync"
                          : "Synced")}
                    </small>
                    <div className="button-row">
                      <button className="text-button" onClick={() => insert(a)}>
                        Insert into note
                      </button>
                      {a.author_id === userId && (
                        <>
                          <button
                            className="text-button"
                            onClick={() => {
                              go(a.data.page);
                              setSelected(a.data);
                              setEditing(a);
                              setBody(a.data.body);
                              setColor(a.data.color);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="text-button"
                            disabled={
                              !navigator.onLine || meta?.visibility !== "shared"
                            }
                            onClick={() =>
                              void work(async () => {
                                await research.saveAnnotation(
                                  attachment.id,
                                  a.data,
                                  !a.shared,
                                  a,
                                );
                              })
                            }
                          >
                            {a.shared ? "Make private" : "Share with readers"}
                          </button>
                        </>
                      )}
                      {(a.author_id === userId ||
                        (meta?.role !== "member" && a.shared)) && (
                        <button
                          className="text-button danger-text"
                          onClick={() => {
                            if (confirm("Remove this annotation?"))
                              void work(async () => {
                                await research.remove(entry);
                              });
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </>
          )}
        </aside>
      )}
      {selected && (
        <section className="annotation-composer" aria-label="Annotation editor">
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
            <button
              className="icon-button"
              aria-label="Cancel annotation"
              onClick={() => {
                setSelected(null);
                setEditing(undefined);
              }}
            >
              <X size={15} />
            </button>
          </header>
          {selected.quote && <blockquote>{selected.quote}</blockquote>}
          <label>
            Annotation note
            <textarea
              aria-label="Annotation note"
              value={body}
              rows={3}
              onChange={(e) => setBody(e.target.value)}
              maxLength={12000}
              placeholder="A question, connection, or caveat…"
            />
          </label>
          <div className="annotation-colors">
            {(["yellow", "green", "blue", "pink"] as const).map((c) => (
              <button
                className={`highlight-color ${c}`}
                aria-label={`${c} highlight`}
                aria-pressed={color === c}
                key={c}
                onClick={() => setColor(c)}
              >
                {color === c ? "✓" : ""}
              </button>
            ))}
          </div>
          <div className="button-row">
            <button
              className="button primary small"
              disabled={busy || (selected.kind === "note" && !body.trim())}
              onClick={() =>
                void work(async () => {
                  await research.saveAnnotation(
                    attachment.id,
                    { ...selected, body, color },
                    editing?.shared ?? false,
                    editing,
                  );
                  setSelected(null);
                  setEditing(undefined);
                  window.getSelection()?.removeAllRanges();
                  setPanel("annotations");
                })
              }
            >
              {editing ? "Save changes" : "Save privately"}
            </button>
            <button
              className="button secondary small"
              disabled={busy || (selected.kind === "note" && !body.trim())}
              onClick={() =>
                void work(async () => {
                  const saved = await research.saveAnnotation(
                    attachment.id,
                    { ...selected, body, color },
                    editing?.shared ?? false,
                    editing,
                  );
                  insert(saved);
                  setSelected(null);
                  setEditing(undefined);
                  window.getSelection()?.removeAllRanges();
                  setPanel("annotations");
                })
              }
            >
              Insert quotation
            </button>
          </div>
        </section>
      )}
      <div
        className="pdf-canvas"
        ref={scroller}
        tabIndex={0}
        aria-label="PDF page viewport"
        onKeyDown={(e) => {
          if ((e.target as Element).closest("input,textarea,button")) return;
          if (e.key === "PageDown" || e.key === "ArrowRight") {
            e.preventDefault();
            go(page + 1);
          }
          if (e.key === "PageUp" || e.key === "ArrowLeft") {
            e.preventDefault();
            go(page - 1);
          }
        }}
      >
        {!pdf && !error && (
          <div className="paper-loading">
            <LoaderCircle className="spin" size={20} />
            Opening paper…
          </div>
        )}
        <div
          className={`paper-page ${area ? "area-selecting" : ""}`}
          data-rendered={rendered}
          ref={pageRoot}
          style={
            {
              width: viewport?.width ?? 0,
              height: viewport?.height ?? 0,
              "--total-scale-factor": viewport
                ? viewport.scale * viewport.userUnit
                : 1,
            } as React.CSSProperties
          }
        >
          <canvas ref={canvas} aria-label={`PDF page ${page}`} />
          <div
            ref={textLayer}
            className="textLayer"
            onMouseUp={capture}
            onTouchEnd={() => setTimeout(capture, 100)}
          />
          <div className="paper-highlights" aria-hidden="true">
            {viewport &&
              annotations
                .filter((e) => (e.value as Annotation).data.page === page)
                .flatMap((e) => {
                  const a = e.value as Annotation;
                  return a.data.rects.map((r, i) => {
                    const [left, top, w, h] = displayRect(viewport, r);
                    return (
                      <span
                        key={a.id + ":" + i}
                        className={`pdf-highlight ${a.data.color} ${selectedAnnotation === a.id ? "selected" : ""}`}
                        style={{ left, top, width: w, height: h }}
                      />
                    );
                  });
                })}
          </div>
          {area && (
            <div
              className="paper-area-capture"
              onPointerDown={(e) => {
                if (!viewport) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                const b = e.currentTarget.getBoundingClientRect();
                setDrag([e.clientX - b.left, e.clientY - b.top, 0, 0]);
              }}
              onPointerMove={(e) => {
                if (!drag) return;
                const b = e.currentTarget.getBoundingClientRect();
                setDrag([
                  drag[0],
                  drag[1],
                  e.clientX - b.left - drag[0],
                  e.clientY - b.top - drag[1],
                ]);
              }}
              onPointerUp={() => {
                if (
                  drag &&
                  viewport &&
                  meta &&
                  Math.abs(drag[2]) > 4 &&
                  Math.abs(drag[3]) > 4
                ) {
                  setSelected({
                    kind: "area",
                    page,
                    sha256: meta.sha256,
                    rects: [normalizedRect(viewport, drag)],
                    quote: "",
                    body: "",
                    color,
                  });
                  setEditing(undefined);
                  setBody("");
                }
                setDrag(null);
                setArea(false);
              }}
            >
              {drag && (
                <span
                  className="area-draft"
                  style={{
                    left: Math.min(drag[0], drag[0] + drag[2]),
                    top: Math.min(drag[1], drag[1] + drag[3]),
                    width: Math.abs(drag[2]),
                    height: Math.abs(drag[3]),
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
function Thumbnail({
  pdf,
  page,
  selected,
  onClick,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  selected: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true,
      task: { cancel: () => void } | undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      void pdf
        .getPage(page)
        .then(async (p) => {
          if (!alive || !canvas.current) return;
          const v = p.getViewport({
            scale: 100 / p.getViewport({ scale: 1 }).width,
          });
          canvas.current.width = v.width;
          canvas.current.height = v.height;
          const r = p.render({ canvas: canvas.current, viewport: v });
          task = r;
          await r.promise;
        })
        .catch(() => {});
    });
    if (ref.current) observer.observe(ref.current);
    return () => {
      alive = false;
      observer.disconnect();
      task?.cancel();
    };
  }, [pdf, page]);
  return (
    <button
      ref={ref}
      className={selected ? "selected" : ""}
      onClick={onClick}
      aria-label={`Open PDF page ${page}`}
    >
      <canvas ref={canvas} />
      <span>{page}</span>
    </button>
  );
}
