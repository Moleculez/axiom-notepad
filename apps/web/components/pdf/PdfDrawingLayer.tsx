"use client";
import { useRef, useState } from "react";
import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
import type { Annotation, AnnotationData } from "@axiom/shared/research";
type Point = [number, number];
export type PdfDrawingTool = "ink" | "arrow" | "textbox";
export type PdfSelectionData = Pick<
  AnnotationData,
  "kind" | "page" | "rects" | "quote" | "segments" | "paths" | "strokeWidth"
>;
const palette = {
  yellow: "#967000",
  green: "#23724a",
  blue: "#2868b4",
  pink: "#a4386c",
};
function normalized(v: PageViewport, x: number, y: number): Point {
  const p = v.convertToPdfPoint(x, y),
    b = v.viewBox;
  return [
    Math.max(0, Math.min(1, (p[0] - b[0]) / (b[2] - b[0]))),
    Math.max(0, Math.min(1, (p[1] - b[1]) / (b[3] - b[1]))),
  ];
}
function screen(v: PageViewport, p: Point): Point {
  const b = v.viewBox;
  return v.convertToViewportPoint(
    b[0] + p[0] * (b[2] - b[0]),
    b[1] + p[1] * (b[3] - b[1]),
  ) as Point;
}
export default function PdfDrawingLayer({
  viewport: v,
  tool,
  page,
  annotations,
  selected,
  editable,
  onSelect,
  onAnnotation,
  onUpdate,
}: {
  viewport: PageViewport;
  tool?: PdfDrawingTool;
  page: number;
  annotations: Annotation[];
  selected: string;
  editable?: string;
  onSelect: (data: PdfSelectionData) => void;
  onAnnotation: (a: Annotation) => void;
  onUpdate?: (a: Annotation, data: AnnotationData) => void;
}) {
  const points = useRef<Point[]>([]),
    suppressClick = useRef(false),
    [draft, setDraft] = useState<Point[]>([]);
  const edit = useRef<{
      annotation: Annotation;
      start: Point;
      resize: boolean;
    } | null>(null),
    [edited, setEdited] = useState<AnnotationData | null>(null);
  const local = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return normalized(v, e.clientX - box.left, e.clientY - box.top);
  };
  const visible = annotations.filter(
    (a) =>
      ["ink", "arrow", "textbox"].includes(a.data.kind) && a.data.page === page,
  );
  const geometry = (data: AnnotationData) => {
    const r = data.rects[0],
      a = screen(v, [r[0], r[1]]),
      b = screen(v, [r[0] + r[2], r[1] + r[3]]);
    return {
      x: Math.min(a[0], b[0]),
      y: Math.min(a[1], b[1]),
      width: Math.abs(a[0] - b[0]),
      height: Math.abs(a[1] - b[1]),
    };
  };
  const draw = (data: AnnotationData, key: string) =>
    data.kind === "textbox" ? (
      <foreignObject {...geometry(data)}>
        <div
          className="pdf-textbox-content"
          style={{ color: palette[data.color] }}
        >
          {data.body}
        </div>
      </foreignObject>
    ) : (
      data.paths?.map((path, i) => {
        const xy = path.map((p) => screen(v, p)),
          end = xy.at(-1)!,
          start = xy[0],
          angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
        return (
          <g
            key={`${key}:${i}`}
            fill="none"
            stroke={palette[data.color]}
            strokeWidth={(data.strokeWidth ?? 2) * v.scale}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points={xy.map((p) => p.join(",")).join(" ")} />
            {data.kind === "arrow" && (
              <polyline
                points={[
                  [
                    end[0] - 10 * Math.cos(angle - 0.5),
                    end[1] - 10 * Math.sin(angle - 0.5),
                  ],
                  end,
                  [
                    end[0] - 10 * Math.cos(angle + 0.5),
                    end[1] - 10 * Math.sin(angle + 0.5),
                  ],
                ]
                  .map((p) => p.join(","))
                  .join(" ")}
              />
            )}
          </g>
        );
      })
    );
  return (
    <svg
      className={`pdf-drawing-layer ${tool ? "is-drawing" : ""}`}
      width={v.width}
      height={v.height}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          points.current = [];
          setDraft([]);
          edit.current = null;
          setEdited(null);
        }
      }}
      onPointerDown={(e) => {
        if (!tool || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        points.current = [local(e)];
        setDraft([...points.current]);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const p = local(e);
        if (edit.current) {
          const { annotation, start, resize } = edit.current,
            r = annotation.data.rects[0],
            dx = p[0] - start[0],
            dy = p[1] - start[1];
          const next: typeof r = resize
            ? [
                r[0],
                r[1],
                Math.min(1 - r[0], Math.max(0.0001, r[2] + dx)),
                Math.min(1 - r[1], Math.max(0.0001, r[3] + dy)),
              ]
            : [
                Math.max(0, Math.min(1 - r[2], r[0] + dx)),
                Math.max(0, Math.min(1 - r[3], r[1] + dy)),
                r[2],
                r[3],
              ];
          setEdited({
            ...annotation.data,
            rects: [next],
            paths: annotation.data.paths?.map((path) =>
              path.map(([x, y]) => [
                Math.max(
                  0,
                  Math.min(1, next[0] + ((x - r[0]) * next[2]) / r[2]),
                ),
                Math.max(
                  0,
                  Math.min(1, next[1] + ((y - r[1]) * next[3]) / r[3]),
                ),
              ]),
            ),
          });
          return;
        }
        if (!points.current.length) return;
        if (tool === "ink") {
          if (points.current.length < 2048) points.current.push(p);
        } else points.current = [points.current[0], p];
        setDraft([...points.current]);
      }}
      onPointerCancel={() => {
        points.current = [];
        setDraft([]);
        edit.current = null;
        setEdited(null);
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        if (edit.current) {
          if (edited) {
            suppressClick.current = true;
            onUpdate?.(edit.current.annotation, edited);
          }
          edit.current = null;
          setEdited(null);
          return;
        }
        const path = points.current;
        if (tool && path.length > 1) {
          const xs = path.map((p) => p[0]),
            ys = path.map((p) => p[1]),
            x = Math.min(...xs),
            y = Math.min(...ys),
            w = Math.max(...xs) - x,
            h = Math.max(...ys) - y;
          if (Math.max(w, h) > 0.004 && x < 1 && y < 1)
            onSelect({
              kind: tool,
              page,
              rects: [
                [
                  x,
                  y,
                  Math.min(1 - x, Math.max(0.0001, w)),
                  Math.min(1 - y, Math.max(0.0001, h)),
                ],
              ],
              quote: "",
              ...(tool !== "textbox" ? { paths: [path], strokeWidth: 2 } : {}),
            });
        }
        points.current = [];
        setDraft([]);
      }}
    >
      {visible.map((a) => {
        const data =
            edit.current?.annotation.id === a.id && edited ? edited : a.data,
          bounds = geometry(data),
          handle = screen(v, [
            data.rects[0][0] + data.rects[0][2],
            data.rects[0][1] + data.rects[0][3],
          ]);
        return (
          <g
            key={a.id}
            className="pdf-drawing-mark"
            tabIndex={0}
            role="button"
            aria-label={`Open ${data.kind} annotation`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onAnnotation(a);
              }
            }}
            onClick={(e) => {
              if (suppressClick.current) {
                suppressClick.current = false;
                e.stopPropagation();
                return;
              }
              if (!tool) {
                e.stopPropagation();
                onAnnotation(a);
              }
            }}
          >
            {draw(data, a.id)}
            <rect
              {...bounds}
              fill="transparent"
              stroke={a.id === selected ? "var(--accent)" : "none"}
              strokeDasharray="4 3"
              onPointerDown={(e) => {
                suppressClick.current = false;
                if (e.button !== 0 || tool || a.id !== editable || !onUpdate)
                  return;
                e.stopPropagation();
                const svg = e.currentTarget.ownerSVGElement!,
                  box = svg.getBoundingClientRect();
                svg.setPointerCapture(e.pointerId);
                edit.current = {
                  annotation: a,
                  start: normalized(
                    v,
                    e.clientX - box.left,
                    e.clientY - box.top,
                  ),
                  resize: false,
                };
              }}
            />
            {a.id === editable && onUpdate && (
              <circle
                cx={handle[0]}
                cy={handle[1]}
                r={5}
                fill="var(--accent)"
                onPointerDown={(e) => {
                  if (e.button !== 0 || tool) return;
                  suppressClick.current = false;
                  e.stopPropagation();
                  const svg = e.currentTarget.ownerSVGElement!,
                    box = svg.getBoundingClientRect();
                  svg.setPointerCapture(e.pointerId);
                  edit.current = {
                    annotation: a,
                    start: normalized(
                      v,
                      e.clientX - box.left,
                      e.clientY - box.top,
                    ),
                    resize: true,
                  };
                }}
              />
            )}
          </g>
        );
      })}
      {draft.length > 1 && (
        <polyline
          points={draft.map((p) => screen(v, p).join(",")).join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
