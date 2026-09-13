"use client";
import { useEffect, useRef, useState } from "react";
import {
  moveShape,
  type VisualAnnotation,
  type VisualPoint,
  type VisualShape,
} from "@axiom/shared/visual-annotations";
import {
  screenToVisual,
  appendVisualPoint,
  zoomVisual,
  type VisualTransform,
} from "../../lib/visual-geometry";
import type { VisualMedia } from "../../lib/visual-media";
export type VisualTool =
  "pan" | "select" | "inspect" | "ruler" | VisualShape["kind"];
export function Shape({
  shape,
  width,
  height,
  selected = false,
  id,
  interactive = false,
}: {
  shape: VisualShape;
  width: number;
  height: number;
  selected?: boolean;
  id?: string;
  interactive?: boolean;
}) {
  const p = shape.points.map(([x, y]) => [x * width, y * height]),
    a = p[0],
    b = p.at(-1)!,
    stroke = shape.stroke * Math.max(1, Math.min(width, height) / 600);
  let d = "";
  if (shape.kind === "arrow" || shape.kind === "pen") {
    d = p.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
    if (shape.kind === "arrow") {
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]),
        s = stroke * 5;
      d += [-0.5, 0.5]
        .map(
          (v) =>
            ` M${b[0]} ${b[1]} L${b[0] - s * Math.cos(angle + v)} ${b[1] - s * Math.sin(angle + v)}`,
        )
        .join("");
    }
  }
  const content =
    shape.kind === "rectangle" ? (
      <rect
        x={Math.min(a[0], b[0])}
        y={Math.min(a[1], b[1])}
        width={Math.abs(b[0] - a[0])}
        height={Math.abs(b[1] - a[1])}
      />
    ) : shape.kind === "ellipse" ? (
      <ellipse
        cx={(a[0] + b[0]) / 2}
        cy={(a[1] + b[1]) / 2}
        rx={Math.abs(b[0] - a[0]) / 2}
        ry={Math.abs(b[1] - a[1]) / 2}
      />
    ) : shape.kind === "label" ? (
      <text
        x={a[0]}
        y={a[1]}
        fill={shape.color}
        stroke="none"
        fontSize={Math.max(14, Math.min(width, height) / 35)}
      >
        {shape.text || "Label"}
      </text>
    ) : shape.kind === "pin" ? (
      <circle cx={a[0]} cy={a[1]} r={stroke * 3} fill={shape.color} />
    ) : (
      <path d={d} />
    );
  return (
    <g
      data-shape-id={id}
      className={selected ? "visual-shape selected" : "visual-shape"}
      fill="transparent"
      stroke={shape.color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ pointerEvents: interactive ? "visiblePainted" : "none" }}
    >
      {content}
      {selected &&
        ["rectangle", "ellipse", "arrow"].includes(shape.kind) &&
        [a, b].map(([x, y], i) => (
          <circle
            key={i}
            data-shape-handle={i === 0 ? 0 : shape.points.length - 1}
            cx={x}
            cy={y}
            r={stroke * 3}
            fill="var(--paper)"
            stroke="var(--accent)"
          />
        ))}
    </g>
  );
}
export default function VisualStage({
  media,
  transform,
  onTransform,
  tool = "pan",
  color,
  stroke,
  marks,
  selected,
  onSelect,
  onShape,
  onSample,
  onMeasure,
  onSize,
  pixelated = false,
  background = "checker",
  userId,
  label = "Image viewport",
}: {
  media: VisualMedia | null;
  transform: VisualTransform;
  onTransform: (t: VisualTransform) => void;
  tool?: VisualTool;
  color: string;
  stroke: number;
  marks: VisualAnnotation[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onShape: (shape: VisualShape, id?: string) => void;
  onSample?: (point: VisualPoint) => void;
  onMeasure?: (distance: number) => void;
  onSize: (width: number, height: number) => void;
  pixelated?: boolean;
  background: string;
  userId: string;
  label?: string;
}) {
  const root = useRef<HTMLDivElement>(null),
    [draft, setDraft] = useState<VisualShape | null>(null),
    [space, setSpace] = useState(false);
  const current = useRef({ media, transform, onTransform, onSize });
  current.current = { media, transform, onTransform, onSize };
  const drag = useRef<{
    id: number;
    start: VisualPoint;
    point: VisualPoint;
    before: VisualTransform;
    shape?: VisualShape;
    markId?: string;
    handle?: number;
    tool: VisualTool;
  } | null>(null);
  const pointers = useRef(new Map<number, VisualPoint>()),
    pinch = useRef<{ distance: number; before: VisualTransform } | null>(null);
  useEffect(() => {
    const el = root.current!;
    const resize = new ResizeObserver(() =>
      current.current.onSize(el.clientWidth, el.clientHeight),
    );
    resize.observe(el);
    const wheel = (e: WheelEvent) => {
      if (!current.current.media) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(),
        point: VisualPoint = [
          e.clientX - r.left - r.width / 2,
          e.clientY - r.top - r.height / 2,
        ];
      current.current.onTransform(
        zoomVisual(
          current.current.transform,
          current.current.transform.zoom * Math.exp(-e.deltaY * 0.002),
          point,
        ),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      resize.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, []);
  const at = (x: number, y: number): VisualPoint => {
    const r = root.current!.getBoundingClientRect();
    return [x - r.left - r.width / 2, y - r.top - r.height / 2];
  };
  const cancel = () => {
    drag.current = null;
    pinch.current = null;
    pointers.current.clear();
    setDraft(null);
  };
  useEffect(() => {
    cancel();
  }, [media]);
  return (
    <div
      ref={root}
      className={`visual-stage visual-background-${background} tool-${space ? "pan" : tool}`}
      role="region"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.code === "Space") {
          e.preventDefault();
          setSpace(true);
        }
        if (e.key === "Escape" && drag.current) {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
      onKeyUp={(e) => {
        if (e.code === "Space") setSpace(false);
      }}
      onBlur={() => setSpace(false)}
      onPointerDown={(e) => {
        if (!media || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        const start = at(e.clientX, e.clientY);
        pointers.current.set(e.pointerId, start);
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          pinch.current = {
            distance: Math.hypot(a[0] - b[0], a[1] - b[1]),
            before: transform,
          };
          drag.current = null;
          setDraft(null);
          return;
        }
        const point = screenToVisual(
            start,
            media.width,
            media.height,
            transform,
          ),
          mode = space ? "pan" : tool;
        const id = (e.target as Element).closest<SVGGElement>("[data-shape-id]")
          ?.dataset.shapeId;
        const mark = marks.find((m) => m.id === id),
          handle = (e.target as Element).closest<SVGElement>(
            "[data-shape-handle]",
          )?.dataset.shapeHandle;
        if (mode === "select") {
          onSelect(id ?? null);
          if (!mark?.shape || mark.authorId !== userId) return;
          drag.current = {
            id: e.pointerId,
            start,
            point,
            before: transform,
            tool: mode,
            shape: mark.shape,
            markId: id,
            handle: handle === undefined ? undefined : Number(handle),
          };
          setDraft(mark.shape);
          return;
        }
        if (mode === "inspect") {
          onSample?.(point);
          return;
        }
        const shape: VisualShape | undefined =
          mode === "pan"
            ? undefined
            : {
                kind: mode === "ruler" ? "arrow" : mode,
                points: [
                  point,
                  ...(["pin", "label"].includes(mode) ? [] : [point]),
                ],
                color,
                stroke,
                text: mode === "label" ? "Label" : "",
              };
        drag.current = {
          id: e.pointerId,
          start,
          point,
          before: transform,
          tool: mode,
          shape,
        };
        if (shape) setDraft(shape);
      }}
      onPointerMove={(e) => {
        if (!media) return;
        const point = at(e.clientX, e.clientY);
        if (pointers.current.has(e.pointerId))
          pointers.current.set(e.pointerId, point);
        if (pinch.current && pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()],
            p = pinch.current;
          onTransform(
            zoomVisual(
              p.before,
              (p.before.zoom * Math.hypot(a[0] - b[0], a[1] - b[1])) /
                Math.max(1, p.distance),
              [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
            ),
          );
          return;
        }
        const v = screenToVisual(point, media.width, media.height, transform);
        if (tool === "inspect") onSample?.(v);
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        if (d.tool === "pan") {
          onTransform({
            ...d.before,
            x: d.before.x + point[0] - d.start[0],
            y: d.before.y + point[1] - d.start[1],
          });
          return;
        }
        if (!d.shape) return;
        if (d.markId) {
          setDraft(
            d.handle === undefined
              ? moveShape(d.shape, [v[0] - d.point[0], v[1] - d.point[1]])
              : {
                  ...d.shape,
                  points: d.shape.points.map((p, i) =>
                    i === d.handle ? v : p,
                  ),
                },
          );
        } else if (d.shape.kind === "pen")
          setDraft((old) =>
            old ? { ...old, points: appendVisualPoint(old.points, v) } : null,
          );
        else if (!["pin", "label"].includes(d.shape.kind))
          setDraft({ ...d.shape, points: [d.point, v] });
        if (d.tool === "ruler")
          onMeasure?.(
            Math.hypot(
              (v[0] - d.point[0]) * media.width,
              (v[1] - d.point[1]) * media.height,
            ),
          );
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        if (pinch.current) {
          if (pointers.current.size < 2) pinch.current = null;
          drag.current = null;
          setDraft(null);
          return;
        }
        const d = drag.current;
        if (d && d.id === e.pointerId && draft && d.tool !== "ruler") {
          const first = draft.points[0],
            last = draft.points.at(-1)!;
          if (
            ["pin", "label"].includes(draft.kind) ||
            (draft.kind === "pen" &&
              draft.points.some(
                (p) => Math.hypot(p[0] - first[0], p[1] - first[1]) > 0.001,
              )) ||
            d.markId ||
            Math.hypot(first[0] - last[0], first[1] - last[1]) > 0.001
          )
            onShape(draft, d.markId);
        }
        drag.current = null;
        if (d?.tool !== "ruler") setDraft(null);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (drag.current) cancel();
      }}
    >
      {media && (
        <div
          className="visual-sheet"
          style={{
            width: media.width,
            height: media.height,
            transform: `translate(-50%, -50%) translate(${transform.x}px,${transform.y}px) scale(${transform.zoom}) rotate(${transform.rotation}deg) scale(${transform.flipX ? -1 : 1},${transform.flipY ? -1 : 1})`,
          }}
        >
          <img
            src={media.url}
            alt=""
            draggable={false}
            style={{ imageRendering: pixelated ? "pixelated" : "auto" }}
          />
          <svg
            style={{ pointerEvents: "none" }}
            className="visual-markup-layer"
            viewBox={`0 0 ${media.width} ${media.height}`}
            aria-label="Image markup"
          >
            {marks
              .filter((m) => m.shape && m.id !== drag.current?.markId)
              .map((m) => (
                <Shape
                  key={m.id}
                  shape={m.shape!}
                  width={media.width}
                  height={media.height}
                  selected={selected === m.id}
                  id={m.id}
                  interactive={tool === "select"}
                />
              ))}
            {draft && (
              <Shape
                shape={draft}
                width={media.width}
                height={media.height}
                selected={!!drag.current?.markId}
              />
            )}
          </svg>
        </div>
      )}
    </div>
  );
}
