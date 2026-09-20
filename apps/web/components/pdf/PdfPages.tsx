"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  pdfPageLayout,
  pdfPageAtOffset,
  type PdfPageSize,
} from "@axiom/shared/pdf-layout";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
import type { Annotation, AnnotationData } from "@axiom/shared/research";
import { annotationSegments } from "@axiom/shared/pdf-annotations";
import PdfDrawingLayer, {
  type PdfDrawingTool,
  type PdfSelectionData,
} from "./PdfDrawingLayer";
import {
  pdfSafeLink,
  pdfTextMatches,
  type PdfMatch,
  type PdfView,
  type PdfRect,
} from "@axiom/shared/pdf-reader";

export function toPdfRect(v: PageViewport, rect: PdfRect): PdfRect {
  const a = v.convertToPdfPoint(rect[0], rect[1]),
    b = v.convertToPdfPoint(rect[0] + rect[2], rect[1] + rect[3]);
  const [x, y, right, top] = v.viewBox,
    w = right - x,
    h = top - y;
  const left = Math.max(0, Math.min(1, (Math.min(a[0], b[0]) - x) / w));
  const bottom = Math.max(0, Math.min(1, (Math.min(a[1], b[1]) - y) / h));
  return [
    left,
    bottom,
    Math.min(1 - left, Math.abs(b[0] - a[0]) / w),
    Math.min(1 - bottom, Math.abs(b[1] - a[1]) / h),
  ];
}
export function fromPdfRect(v: PageViewport, rect: PdfRect): PdfRect {
  const [x, y, right, top] = v.viewBox,
    w = right - x,
    h = top - y;
  const a = v.convertToViewportPoint(x + rect[0] * w, y + rect[1] * h);
  const b = v.convertToViewportPoint(
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
type Props = {
  pdf: PDFDocumentProxy;
  page: number;
  jump: number;
  scale: number | "fit" | "page";
  rotation: number;
  view: PdfView;
  labels: string[];
  annotations: Annotation[];
  selected: string;
  query: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  activeHit?: PdfMatch;
  area: boolean;
  drawingTool?: PdfDrawingTool;
  editableAnnotation?: string;
  onUpdateAnnotation?: (annotation: Annotation, data: AnnotationData) => void;
  resumeOffset?: number;
  onPosition?: (offset: number) => void;
  scrollFraction?: number;
  onScrollFraction?: (fraction: number) => void;
  onPage: (page: number) => void;
  onSelect: (data: PdfSelectionData) => void;
  onAnnotation: (annotation: Annotation) => void;
};
export default function PdfPages(props: Props) {
  const root = useRef<HTMLDivElement>(null),
    current = useRef(props),
    layoutFrame = useRef(0),
    jumpFrame = useRef(0),
    measured = useRef(false),
    pendingJump = useRef<{ page: number; offset: number } | null>({
      page: props.page,
      offset: props.resumeOffset ?? 0,
    }),
    viewports = useRef(new Map<number, PageViewport>());
  current.current = props;
  const [size, setSize] = useState({ width: 600, height: 800 }),
    [near, setNear] = useState(props.page);
  const sizes = useMemo(
    () => new Map<number, PdfPageSize>(),
    [props.pdf, props.rotation],
  );
  const [measurement, setMeasurement] = useState(0),
    [selectionStart, setSelectionStart] = useState<number | null>(null);
  const layout = useMemo(
    () =>
      pdfPageLayout(
        props.pdf.numPages,
        sizes,
        size.width,
        size.height,
        props.scale,
        props.view,
      ),
    [props.pdf, sizes, size, props.scale, props.view, measurement],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    const clear = () => {
      if (window.getSelection()?.isCollapsed) setSelectionStart(null);
    };
    document.addEventListener("selectionchange", clear);
    return () => document.removeEventListener("selectionchange", clear);
  }, []);
  // Page sizes arrive asynchronously. Keep the logical jump anchor until every
  // nearby rendered page agrees with its measured shell; otherwise a resize can
  // turn a saved page-four position into a page-three scroll event.
  const restoreJump = () => {
    if (jumpFrame.current || !pendingJump.current) return;
    jumpFrame.current = requestAnimationFrame(() => {
      jumpFrame.current = 0;
      const target = pendingJump.current,
        scroller = root.current;
      if (!target || !scroller) return;
      const node = scroller.querySelector<HTMLElement>(
        `[data-pdf-page="${target.page}"]`,
      );
      if (!node) return;
      scroller.scrollTop =
        node.offsetTop - 20 + target.offset * node.offsetHeight;
      const needed =
        current.current.view === "single"
          ? [target.page]
          : Array.from(
              {
                length:
                  Math.min(current.current.pdf.numPages, target.page + 2) -
                  Math.max(1, target.page - 2) +
                  1,
              },
              (_, i) => Math.max(1, target.page - 2) + i,
            );
      const stable =
        measured.current &&
        needed.every((page) => {
          const viewport = viewports.current.get(page),
            shell = scroller.querySelector<HTMLElement>(
              `[data-pdf-page="${page}"]`,
            );
          return (
            viewport &&
            shell &&
            Math.abs(viewport.width - shell.offsetWidth) < 2 &&
            Math.abs(viewport.height - shell.offsetHeight) < 2
          );
        });
      if (stable) pendingJump.current = null;
    });
  };
  const cancelJump = () => {
    pendingJump.current = null;
    cancelAnimationFrame(jumpFrame.current);
    jumpFrame.current = 0;
  };
  // Preserve the visible anchor when an estimated neighboring page acquires its
  // real (possibly mixed-size) dimensions. Never counteract intervening scrolling.
  const preserveLayout = () => {
    if (pendingJump.current) {
      restoreJump();
      return;
    }
    if (layoutFrame.current || current.current.view === "single") return;
    const scroller = root.current;
    const anchor = scroller?.querySelector<HTMLElement>(
      `[data-pdf-page="${current.current.page}"]`,
    );
    if (!scroller || !anchor) return;
    const before = scroller.scrollTop,
      offset = anchor.offsetTop - before;
    layoutFrame.current = requestAnimationFrame(() => {
      layoutFrame.current = 0;
      if (anchor.isConnected && Math.abs(scroller.scrollTop - before) < 2)
        scroller.scrollTop = anchor.offsetTop - offset;
    });
  };
  useEffect(
    () => () => {
      cancelAnimationFrame(layoutFrame.current);
      cancelAnimationFrame(jumpFrame.current);
      layoutFrame.current = 0;
      jumpFrame.current = 0;
    },
    [],
  );
  useEffect(() => {
    cancelAnimationFrame(layoutFrame.current);
    layoutFrame.current = 0;
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      measured.current = true;
      setSize({
        width: Math.max(160, entry.contentRect.width - 40),
        height: Math.max(200, entry.contentRect.height - 40),
      });
      restoreJump();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    cancelAnimationFrame(layoutFrame.current);
    layoutFrame.current = 0;
    pendingJump.current = { page: props.page, offset: props.resumeOffset ?? 0 };
    restoreJump();
    setNear(props.page);
  }, [props.jump, props.view, props.pdf]);
  useEffect(() => {
    const node = root.current;
    if (node && props.scrollFraction !== undefined) {
      const top =
        props.scrollFraction *
        Math.max(0, node.scrollHeight - node.clientHeight);
      if (Math.abs(node.scrollTop - top) > 1) node.scrollTop = top;
    }
  }, [props.scrollFraction]);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let frame = 0;
    const scroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (pendingJump.current) return;
        current.current.onScrollFraction?.(
          node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight),
        );
        const middle = node.scrollTop + Math.min(180, node.clientHeight / 3);
        const slot =
          current.current.view === "single"
            ? null
            : pdfPageAtOffset(layoutRef.current, middle);
        const active =
          slot ?? node.querySelector<HTMLElement>("[data-pdf-page]");
        if (active) {
          const n =
            "page" in active ? active.page : Number(active.dataset.pdfPage);
          setNear(n);
          if (n !== current.current.page) current.current.onPage(n);
          current.current.onPosition?.(
            Math.max(
              0,
              Math.min(
                1,
                (node.scrollTop -
                  ("top" in active ? active.top : active.offsetTop) +
                  20) /
                  ("height" in active ? active.height : active.offsetHeight),
              ),
            ),
          );
        }
      });
    };
    node.addEventListener("scroll", scroll, { passive: true });
    return () => {
      node.removeEventListener("scroll", scroll);
      cancelAnimationFrame(frame);
    };
  }, [props.view, props.pdf]);
  const pages =
    props.view === "single"
      ? [props.page]
      : layout.pages
          .filter((p) => {
            const center = layout.pages[near - 1]?.top ?? 0;
            const visible =
              p.top + p.height >= center - size.height * 2 &&
              p.top <= center + size.height * 3;
            const selected =
              selectionStart !== null &&
              p.page >= Math.min(selectionStart, near) &&
              p.page <= Math.max(selectionStart, near) &&
              Math.abs(p.page - selectionStart) < 20;
            return visible || Math.abs(p.page - near) <= 2 || selected;
          })
          .map((p) => p.page);
  return (
    <div
      ref={root}
      className={`pdf-canvas pdf-pages pdf-pages-${props.view}`}
      tabIndex={0}
      aria-label="PDF page viewport"
      onWheelCapture={cancelJump}
      onPointerDownCapture={(e) => {
        cancelJump();
        const target = e.target as HTMLElement;
        setSelectionStart(
          target.closest(".textLayer")
            ? Number(
                target.closest<HTMLElement>("[data-pdf-page]")?.dataset.pdfPage,
              )
            : null,
        );
      }}
      onKeyDownCapture={cancelJump}
      onMouseUp={() => {
        const selection = window.getSelection();
        if (
          !selection?.rangeCount ||
          selection.isCollapsed ||
          props.area ||
          props.drawingTool
        )
          return;
        const range = selection.getRangeAt(0);
        if (!root.current?.contains(range.commonAncestorContainer)) return;
        const segments: NonNullable<AnnotationData["segments"]> = [];
        for (const node of root.current.querySelectorAll<HTMLElement>(
          "[data-pdf-page]",
        )) {
          const n = Number(node.dataset.pdfPage),
            viewport = viewports.current.get(n),
            layer = node.querySelector(".textLayer");
          if (!viewport || !layer || !range.intersectsNode(layer)) continue;
          const local = range.cloneRange();
          if (!layer.contains(range.startContainer)) local.setStart(layer, 0);
          if (!layer.contains(range.endContainer))
            local.setEnd(layer, layer.childNodes.length);
          const box = layer.getBoundingClientRect();
          const rects = [...local.getClientRects()]
            .filter(
              (r) =>
                r.width > 1 &&
                r.height > 1 &&
                r.left >= box.left - 1 &&
                r.right <= box.right + 1,
            )
            .slice(0, 200)
            .map((r) =>
              toPdfRect(viewport, [
                r.left - box.left,
                r.top - box.top,
                r.width,
                r.height,
              ]),
            )
            .filter((r) => r[2] > 0 && r[3] > 0);
          if (rects.length) segments.push({ page: n, rects });
        }
        if (
          segments.length > 1 &&
          segments.length <= 20 &&
          segments.reduce((n, s) => n + s.rects.length, 0) <= 200
        )
          props.onSelect({
            kind: "highlight",
            page: segments[0].page,
            rects: segments[0].rects,
            quote: selection.toString().slice(0, 12000),
            segments,
          });
      }}
    >
      {props.view !== "single" && (
        <div
          className="pdf-virtual-spacer"
          aria-hidden="true"
          style={{
            height: layout.height - 40,
            width: layout.width - 40,
            pointerEvents: "none",
          }}
        />
      )}
      {pages.map((page) => (
        <Page
          key={page}
          {...props}
          onNavigate={(page) => {
            if (
              !Number.isInteger(page) ||
              page < 1 ||
              page > props.pdf.numPages
            )
              return;
            pendingJump.current = { page, offset: 0 };
            setNear(page);
            props.onPage(page);
            restoreJump();
          }}
          page={page}
          container={root}
          width={props.view === "facing" ? (size.width - 16) / 2 : size.width}
          height={size.height}
          active={true}
          position={
            props.view === "single" ? undefined : layout.pages[page - 1]
          }
          initialDimensions={sizes.get(page)}
          onDimensions={(value) => {
            const old = sizes.get(page);
            if (old?.width !== value.width || old?.height !== value.height) {
              preserveLayout();
              sizes.set(page, value);
              setMeasurement((n) => n + 1);
            }
          }}
          preserveLayout={preserveLayout}
          onViewport={(viewport) => {
            if (viewport) viewports.current.set(page, viewport);
            else viewports.current.delete(page);
            restoreJump();
          }}
        />
      ))}
    </div>
  );
}
function Page(
  props: Props & {
    width: number;
    height: number;
    active: boolean;
    position?: { top: number; left: number };
    initialDimensions?: PdfPageSize;
    onDimensions: (value: PdfPageSize) => void;
    preserveLayout: () => void;
    container: React.RefObject<HTMLDivElement | null>;
    onViewport: (viewport: PageViewport | null) => void;
    onNavigate: (page: number) => void;
  },
) {
  const root = useRef<HTMLDivElement>(null),
    layer = useRef<HTMLDivElement>(null),
    image = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null),
    [dimensions, setDimensions] = useState(
      props.initialDimensions ?? { width: 612, height: 792 },
    );
  const [rendered, setRendered] = useState(false),
    [renderRevision, setRenderRevision] = useState(0),
    [error, setError] = useState(""),
    [drag, setDrag] = useState<PdfRect | null>(null);
  const textSpans = useRef<
    { element: HTMLElement; start: number; text: string }[]
  >([]);
  const [searchRects, setSearchRects] = useState<
    { rect: PdfRect; active: boolean }[]
  >([]);
  const [links, setLinks] = useState<
    { id: string; rect: number[]; url?: string; dest?: unknown }[]
  >([]);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    latest.current.onViewport(viewport);
    return () => latest.current.onViewport(null);
  }, [viewport]);
  useEffect(() => {
    let alive = true;
    if (props.active)
      void props.pdf
        .getPage(props.page)
        .then((page) => {
          if (alive) {
            const v = page.getViewport({
              scale: 1,
              rotation: (page.rotate + props.rotation) % 360,
            });
            latest.current.onDimensions({ width: v.width, height: v.height });
            if (
              dimensions.width !== v.width ||
              dimensions.height !== v.height
            ) {
              props.preserveLayout();
              setDimensions({ width: v.width, height: v.height });
            }
          }
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [props.pdf, props.page, props.rotation, props.active]);
  const scale =
    props.scale === "fit"
      ? props.width / dimensions.width
      : props.scale === "page"
        ? Math.min(
            props.width / dimensions.width,
            props.height / dimensions.height,
          )
        : props.scale;
  useEffect(() => {
    if (!props.active) {
      if (image.current) {
        image.current.width = 0;
        image.current.height = 0;
      }
      layer.current?.replaceChildren();
      textSpans.current = [];
      setSearchRects([]);
      setRendered(false);
      return;
    }
    let alive = true,
      rendering: { cancel: () => void } | undefined,
      text: { cancel: () => void } | undefined;
    const target = image.current,
      textHost = layer.current;
    setError("");
    void Promise.all([props.pdf.getPage(props.page), import("pdfjs-dist")])
      .then(async ([page, lib]) => {
        if (!alive || !target || !textHost) return;
        const v = page.getViewport({
          scale,
          rotation: (page.rotate + props.rotation) % 360,
        });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(8_000_000 / (v.width * v.height)),
        );
        const buffer = document.createElement("canvas");
        buffer.width = Math.ceil(v.width * ratio);
        buffer.height = Math.ceil(v.height * ratio);
        const task = page.render({
          canvas: buffer,
          viewport: v,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        rendering = task;
        await task.promise;
        if (!alive) return;
        // Swap only after rasterization completes; keep the preceding image visible during zoom.
        target.width = buffer.width;
        target.height = buffer.height;
        target.getContext("2d")?.drawImage(buffer, 0, 0);
        buffer.width = buffer.height = 0;
        setViewport(v);
        const content = await page.getTextContent();
        if (!alive) return;
        textHost.replaceChildren();
        const tl = new lib.TextLayer({
          textContentSource: content,
          container: textHost,
          viewport: v,
        });
        text = tl;
        await tl.render();
        if (!alive) return;
        let offset = 0;
        textSpans.current = tl.textDivs.map((element, index) => {
          const text = tl.textContentItemsStr[index];
          const item = { element, start: offset, text };
          offset += text.length + 1;
          return item;
        });
        setRenderRevision((n) => n + 1);
        setRendered(true);
        const annotations = await page.getAnnotations();
        if (alive)
          setLinks(
            annotations
              .filter((a) => a.subtype === "Link" && (a.url || a.dest))
              .map((a) => ({
                id: a.id,
                rect: a.rect,
                url: a.url,
                dest: a.dest,
              })),
          );
      })
      .catch((e) => {
        if (
          alive &&
          !["RenderingCancelledException", "AbortException"].includes(e.name)
        )
          setError(
            "This page could not be rendered. Try another page or download the original.",
          );
      });
    return () => {
      alive = false;
      rendering?.cancel();
      text?.cancel();
    };
  }, [props.pdf, props.page, props.rotation, props.active, scale]);
  useEffect(() => {
    if (!root.current || !props.active) return;
    const text = textSpans.current.map((s) => s.text).join(" ");
    const matches = pdfTextMatches(
      text,
      props.query,
      props.page,
      props.matchCase,
      props.wholeWord,
    );
    const box = root.current.getBoundingClientRect();
    const rects: { rect: PdfRect; active: boolean }[] = [];
    for (const match of matches) {
      const active =
        props.activeHit?.page === props.page &&
        props.activeHit.start === match.start;
      for (const span of textSpans.current) {
        const start = Math.max(0, match.start - span.start),
          end = Math.min(span.text.length, match.end - span.start);
        if (
          end <= start ||
          !span.element.firstChild ||
          !span.element.isConnected
        )
          continue;
        const range = document.createRange();
        range.setStart(span.element.firstChild, start);
        range.setEnd(span.element.firstChild, end);
        for (const r of range.getClientRects())
          if (r.width && r.height)
            rects.push({
              rect: [r.left - box.left, r.top - box.top, r.width, r.height],
              active,
            });
      }
    }
    setSearchRects(rects);
    const target = rects.find((r) => r.active),
      scroller = props.container.current;
    if (target && scroller)
      scroller.scrollTo({
        top:
          scroller.scrollTop +
          box.top -
          scroller.getBoundingClientRect().top +
          target.rect[1] -
          scroller.clientHeight / 3,
      });
  }, [
    props.query,
    props.matchCase,
    props.wholeWord,
    props.activeHit,
    props.active,
    renderRevision,
  ]);
  const capture = () => {
    if (
      props.area ||
      props.drawingTool ||
      !viewport ||
      !root.current ||
      !layer.current
    )
      return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!layer.current.contains(range.commonAncestorContainer)) return;
    const box = root.current.getBoundingClientRect();
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1)
      .slice(0, 200)
      .map((r) =>
        toPdfRect(viewport, [
          r.left - box.left,
          r.top - box.top,
          r.width,
          r.height,
        ]),
      )
      .filter((r) => r[2] > 0 && r[3] > 0);
    if (rects.length)
      props.onSelect({
        kind: "highlight",
        page: props.page,
        rects,
        quote: selection.toString().slice(0, 12000),
      });
  };
  const jumpLink = async (dest: unknown) => {
    const target =
      typeof dest === "string" ? await props.pdf.getDestination(dest) : dest;
    if (!Array.isArray(target)) return;
    const page =
      typeof target[0] === "number"
        ? target[0] + 1
        : (await props.pdf.getPageIndex(target[0])) + 1;
    props.onNavigate(page);
  };
  return (
    <div
      className="pdf-page-slot"
      data-pdf-page={props.page}
      style={{
        ...(props.position
          ? {
              position: "absolute",
              top: props.position.top,
              left: props.position.left,
            }
          : {}),
        width: dimensions.width * scale,
        height: dimensions.height * scale,
      }}
    >
      <div
        className={`paper-page ${props.area ? "area-selecting" : ""}`}
        ref={root}
        data-rendered={rendered}
        style={
          {
            width: "100%",
            height: "100%",
            "--total-scale-factor": viewport
              ? viewport.scale * viewport.userUnit
              : scale,
          } as React.CSSProperties
        }
      >
        <canvas
          ref={image}
          aria-label={`PDF page ${props.labels[props.page - 1] ?? props.page}`}
          style={{ width: "100%", height: "100%" }}
        />
        {!rendered && !error && (
          <span className="pdf-page-placeholder">
            Page {props.labels[props.page - 1] ?? props.page}
          </span>
        )}
        {error && (
          <p className="pdf-page-placeholder" role="alert">
            {error}
          </p>
        )}
        <div
          ref={layer}
          className="textLayer"
          onMouseUp={capture}
          onKeyUp={(e) => {
            if (e.shiftKey && e.key.startsWith("Arrow")) capture();
          }}
        />
        <div className="pdf-search-overlays" aria-hidden="true">
          {searchRects.map(
            ({ rect: [left, top, width, height], active }, index) => (
              <span
                key={index}
                className={active ? "is-current" : ""}
                style={{ left, top, width, height }}
              />
            ),
          )}
        </div>
        {viewport &&
          rendered &&
          links.map((link) => {
            const [x1, y1] = viewport.convertToViewportPoint(
              link.rect[0],
              link.rect[1],
            );
            const [x2, y2] = viewport.convertToViewportPoint(
              link.rect[2],
              link.rect[3],
            );
            const style = {
              left: Math.min(x1, x2),
              top: Math.min(y1, y2),
              width: Math.abs(x2 - x1),
              height: Math.abs(y2 - y1),
            };
            const href = link.url ? pdfSafeLink(link.url) : null;
            return href ? (
              <a
                key={link.id}
                className="pdf-page-link"
                style={style}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${href}`}
              />
            ) : link.dest ? (
              <button
                key={link.id}
                className="pdf-page-link"
                style={style}
                aria-label="Go to linked section"
                onClick={() =>
                  void jumpLink(link.dest).catch(() =>
                    setError("This document link is unavailable."),
                  )
                }
              />
            ) : null;
          })}
        <div className="paper-highlights">
          {viewport &&
            props.annotations
              .filter((a) => !["ink", "arrow", "textbox"].includes(a.data.kind))
              .flatMap((a) =>
                annotationSegments(a.data)
                  .filter((segment) => segment.page === props.page)
                  .flatMap((segment) =>
                    segment.rects.map((rect, i) => {
                      const [left, top, width, height] = fromPdfRect(
                        viewport,
                        rect,
                      );
                      return (
                        <button
                          key={`${a.id}:${i}`}
                          className={`pdf-highlight ${a.data.color} ${props.selected === a.id ? "selected" : ""}`}
                          data-kind={a.data.kind}
                          style={{ left, top, width, height }}
                          title={
                            a.data.body || a.data.quote || "Area annotation"
                          }
                          aria-label={`Open annotation: ${(a.data.body || a.data.quote || "Area annotation").slice(0, 100)}`}
                          onClick={() => props.onAnnotation(a)}
                        />
                      );
                    }),
                  ),
              )}
        </div>
        {viewport && rendered && (
          <PdfDrawingLayer
            viewport={viewport}
            page={props.page}
            tool={props.drawingTool}
            annotations={props.annotations}
            selected={props.selected}
            editable={props.editableAnnotation}
            onSelect={props.onSelect}
            onAnnotation={props.onAnnotation}
            onUpdate={props.onUpdateAnnotation}
          />
        )}
        {props.area && viewport && (
          <div
            className="paper-area-capture"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              const r = e.currentTarget.getBoundingClientRect();
              setDrag([e.clientX - r.left, e.clientY - r.top, 0, 0]);
            }}
            onPointerMove={(e) => {
              if (!drag || !e.currentTarget.hasPointerCapture(e.pointerId))
                return;
              const r = e.currentTarget.getBoundingClientRect();
              setDrag([
                drag[0],
                drag[1],
                Math.max(0, Math.min(r.width, e.clientX - r.left)) - drag[0],
                Math.max(0, Math.min(r.height, e.clientY - r.top)) - drag[1],
              ]);
            }}
            onPointerCancel={() => setDrag(null)}
            onPointerUp={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
              if (drag && Math.abs(drag[2]) > 4 && Math.abs(drag[3]) > 4)
                props.onSelect({
                  kind: "area",
                  page: props.page,
                  rects: [
                    toPdfRect(viewport, [
                      Math.min(drag[0], drag[0] + drag[2]),
                      Math.min(drag[1], drag[1] + drag[3]),
                      Math.abs(drag[2]),
                      Math.abs(drag[3]),
                    ]),
                  ],
                  quote: "",
                });
              setDrag(null);
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
  );
}
