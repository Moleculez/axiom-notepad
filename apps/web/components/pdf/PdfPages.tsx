"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
import type { Annotation, AnnotationData } from "@axiom/shared/research";
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
  onPage: (page: number) => void;
  onSelect: (
    data: Pick<AnnotationData, "kind" | "page" | "rects" | "quote">,
  ) => void;
  onAnnotation: (annotation: Annotation) => void;
};
export default function PdfPages(props: Props) {
  const root = useRef<HTMLDivElement>(null),
    current = useRef(props),
    layoutFrame = useRef(0);
  current.current = props;
  const [size, setSize] = useState({ width: 600, height: 800 }),
    [near, setNear] = useState(props.page);
  // Preserve the visible anchor when an estimated neighboring page acquires its
  // real (possibly mixed-size) dimensions. Never counteract intervening scrolling.
  const preserveLayout = () => {
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
  useEffect(() => () => cancelAnimationFrame(layoutFrame.current), []);
  useEffect(() => {
    cancelAnimationFrame(layoutFrame.current);
    layoutFrame.current = 0;
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: Math.max(160, entry.contentRect.width - 40),
        height: Math.max(200, entry.contentRect.height - 40),
      }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (props.view === "single") return;
    cancelAnimationFrame(layoutFrame.current);
    layoutFrame.current = 0;
    const node = root.current?.querySelector<HTMLElement>(
      `[data-pdf-page="${props.page}"]`,
    );
    if (node && root.current)
      root.current.scrollTo({ top: node.offsetTop - 20 });
    setNear(props.page);
  }, [props.jump, props.view, props.pdf]);
  useEffect(() => {
    const node = root.current;
    if (!node || props.view === "single") return;
    let frame = 0;
    const scroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const middle = node.scrollTop + Math.min(180, node.clientHeight / 3);
        const pages = [
          ...node.querySelectorAll<HTMLElement>("[data-pdf-page]"),
        ];
        const active =
          pages.find(
            (p) =>
              p.offsetTop <= middle && p.offsetTop + p.offsetHeight > middle,
          ) ?? pages[0];
        if (active) {
          const n = Number(active.dataset.pdfPage);
          setNear(n);
          if (n !== current.current.page) current.current.onPage(n);
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
      : Array.from({ length: props.pdf.numPages }, (_, i) => i + 1);
  return (
    <div
      ref={root}
      className={`pdf-canvas pdf-pages pdf-pages-${props.view}`}
      tabIndex={0}
      aria-label="PDF page viewport"
    >
      {pages.map((page) => (
        <Page
          key={page}
          {...props}
          page={page}
          container={root}
          width={props.view === "facing" ? (size.width - 16) / 2 : size.width}
          height={size.height}
          active={props.view === "single" || Math.abs(page - near) <= 2}
          preserveLayout={preserveLayout}
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
    preserveLayout: () => void;
    container: React.RefObject<HTMLDivElement | null>;
  },
) {
  const root = useRef<HTMLDivElement>(null),
    layer = useRef<HTMLDivElement>(null),
    image = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null),
    [dimensions, setDimensions] = useState({ width: 612, height: 792 });
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
    if (props.area || !viewport || !root.current || !layer.current) return;
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
    props.onPage(page);
    props.container.current
      ?.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`)
      ?.scrollIntoView({ block: "start" });
  };
  return (
    <div
      className="pdf-page-slot"
      data-pdf-page={props.page}
      style={{
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
              .filter((a) => a.data.page === props.page)
              .flatMap((a) =>
                a.data.rects.map((rect, i) => {
                  const [left, top, width, height] = fromPdfRect(
                    viewport,
                    rect,
                  );
                  return (
                    <button
                      key={`${a.id}:${i}`}
                      className={`pdf-highlight ${a.data.color} ${props.selected === a.id ? "selected" : ""}`}
                      style={{ left, top, width, height }}
                      title={a.data.body || a.data.quote || "Area annotation"}
                      aria-label={`Open annotation: ${(a.data.body || a.data.quote || "Area annotation").slice(0, 100)}`}
                      onClick={() => props.onAnnotation(a)}
                    />
                  );
                }),
              )}
        </div>
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
