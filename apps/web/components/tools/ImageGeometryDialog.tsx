"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  Crop,
  Maximize,
  LockKeyhole,
  LockKeyholeOpen,
  RotateCcw,
} from "lucide-react";
import Dialog, { DialogFooter } from "../Dialog";
import type { ImageDocument } from "../../lib/tools/image-engine";
import {
  cropError,
  cropFromPoints,
  cropWithRatio,
  dragCrop,
  imageSizeError,
  keepsEditableText,
  proportionalSize,
  type CropHandle,
  type CropRect,
  type ImageSampling,
} from "../../lib/tools/image-geometry";

const handles: { id: CropHandle; label: string }[] = [
  { id: "nw", label: "top left" },
  { id: "ne", label: "top right" },
  { id: "sw", label: "bottom left" },
  { id: "se", label: "bottom right" },
];
const directions: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
const strings = (r: CropRect) => ({
  x: String(r.x),
  y: String(r.y),
  width: String(r.width),
  height: String(r.height),
});
export type ImageGeometrySource = Pick<
  ImageDocument,
  "width" | "height" | "layers" | "selection" | "render"
>;
export default function ImageGeometryDialog({
  doc,
  mode,
  editable,
  onClose,
  onApply,
  avatar = false,
}: {
  doc: ImageGeometrySource;
  mode: "crop" | "resize";
  editable: boolean;
  onClose: () => void;
  onApply: (rect: CropRect, sampling: ImageSampling) => void | Promise<void>;
  avatar?: boolean;
}) {
  const full = { x: 0, y: 0, width: doc.width, height: doc.height };
  const [initial] = useState(() =>
    avatar
      ? cropWithRatio(full, 1)
      : mode === "crop" && doc.selection?.kind === "rectangle"
        ? cropFromPoints(doc.selection.points[0], doc.selection.points[1], doc)
        : full,
  );
  const [fields, setFields] = useState(() => strings(initial));
  const [locked, setLocked] = useState(true);
  const [ratioKey, setRatioKey] = useState("free");
  const [sampling, setSampling] = useState<ImageSampling>("smooth");
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const pending = useRef(false),
    alive = useRef(true),
    round = useRef<HTMLCanvasElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    rect: CropRect;
    handle: CropHandle | "draw";
    start: { x: number; y: number };
  } | null>(null);
  const rect = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, v.trim() ? Number(v) : NaN]),
  ) as CropRect;
  const validation =
    imageSizeError(rect.width, rect.height, doc.layers.length) ||
    (mode === "crop" ? cropError(rect, doc) : "");
  const visibleRect = validation ? initial : rect;
  const ratios: Record<string, number | null> = {
    free: null,
    original: doc.width / doc.height,
    square: 1,
    landscape: 4 / 3,
    photo: 3 / 2,
    wide: 16 / 9,
    portrait: 3 / 4,
    tall: 9 / 16,
  };
  const ratio = avatar ? 1 : ratios[ratioKey];
  const aspect =
    mode === "crop"
      ? doc.width / doc.height
      : visibleRect.width / visibleRect.height;
  const sx = mode === "crop" ? 1 : rect.width / doc.width,
    sy = mode === "crop" ? 1 : rect.height / doc.height;
  const rasterized = doc.layers.filter(
    (l) => l.kind === "text" && !keepsEditableText(l, sx, sy),
  ).length;
  const changed =
    avatar ||
    rect.width !== doc.width ||
    rect.height !== doc.height ||
    (mode === "crop" && (rect.x !== 0 || rect.y !== 0));
  const update = (next: CropRect) => {
    setFields(strings(next));
    setError("");
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      if (canvas.current) doc.render(canvas.current);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [doc]);
  useEffect(() => {
    if (!avatar || validation || !canvas.current || !round.current) return;
    const ctx = round.current.getContext("2d")!;
    ctx.clearRect(0, 0, 128, 128);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      canvas.current,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      128,
      128,
    );
  }, [avatar, doc, validation, rect.x, rect.y, rect.width, rect.height]);
  const at = (event: PointerEvent) => {
    const bounds = surface.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.x) * doc.width) / bounds.width,
      y: ((event.clientY - bounds.y) * doc.height) / bounds.height,
    };
  };
  const begin = (event: PointerEvent, handle: CropHandle | "draw") => {
    if (event.button !== 0 || !editable || pending.current) return;
    event.preventDefault();
    event.stopPropagation();
    const start = at(event);
    drag.current = { rect: { ...visibleRect }, handle, start };
    surface.current!.setPointerCapture(event.pointerId);
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
  };
  const field = (key: keyof CropRect, value: string) => {
    setError("");
    setFields((current) => {
      const next = { ...current, [key]: value },
        n = value.trim() ? Number(value) : NaN;
      if (
        (key === "width" || key === "height") &&
        n > 0 &&
        Number.isFinite(n)
      ) {
        const link =
          mode === "resize" ? (locked ? doc.width / doc.height : null) : ratio;
        if (link)
          next[key === "width" ? "height" : "width"] = String(
            Math.max(1, Math.round(key === "width" ? n / link : n * link)),
          );
      }
      return next;
    });
  };
  const apply = async () => {
    if (validation || !editable || !changed || pending.current) return;
    pending.current = true;
    setApplying(true);
    setError("");
    try {
      await onApply(rect, sampling);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      pending.current = false;
      if (alive.current) setApplying(false);
    }
  };
  return (
    <Dialog
      size="wide"
      title={
        avatar
          ? "Crop profile picture"
          : mode === "crop"
            ? "Crop image"
            : "Resize image"
      }
      subtitle={
        avatar
          ? "Position your photo and preview how collaborators will see it."
          : mode === "crop"
            ? "Choose the part of the image to keep."
            : "Change image dimensions without changing the original file."
      }
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void apply();
          }
        }}
      >
        <fieldset className="image-geometry-layout" disabled={applying}>
          <div className="image-geometry-preview">
            <div className="image-geometry-stage">
              <div
                ref={surface}
                className={`image-geometry-surface transparency-grid ${mode === "crop" ? "is-cropping" : ""}`}
                style={{
                  width: Math.min(520, 360 * aspect),
                  aspectRatio: aspect,
                }}
                onPointerDown={
                  mode === "crop" ? (e) => begin(e, "draw") : undefined
                }
                onPointerMove={(e) => {
                  const active = drag.current;
                  if (!active || !editable || pending.current) return;
                  const point = at(e);
                  update(
                    active.handle === "draw"
                      ? cropWithRatio(
                          cropFromPoints(active.start, point, doc),
                          ratio,
                        )
                      : dragCrop(
                          active.rect,
                          active.handle,
                          point.x - active.start.x,
                          point.y - active.start.y,
                          doc,
                          ratio,
                        ),
                  );
                }}
                onPointerUp={(e) => {
                  drag.current = null;
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={() => {
                  if (drag.current) update(drag.current.rect);
                  drag.current = null;
                }}
                onLostPointerCapture={() => {
                  drag.current = null;
                }}
              >
                <canvas
                  ref={canvas}
                  aria-label={
                    mode === "crop" ? "Crop preview" : "Resize preview"
                  }
                  style={{
                    imageRendering:
                      sampling === "pixelated" ? "pixelated" : "auto",
                  }}
                />
                {mode === "crop" && (
                  <div
                    className="image-crop-frame"
                    role="group"
                    aria-label="Crop selection"
                    style={{
                      left: `${(visibleRect.x / doc.width) * 100}%`,
                      top: `${(visibleRect.y / doc.height) * 100}%`,
                      width: `${(visibleRect.width / doc.width) * 100}%`,
                      height: `${(visibleRect.height / doc.height) * 100}%`,
                    }}
                  >
                    {[
                      {
                        id: "move" as CropHandle,
                        label: "Move crop selection",
                      },
                      ...handles.map((h) => ({
                        ...h,
                        label: `Resize crop from ${h.label}`,
                      })),
                    ].map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        className={`image-crop-handle handle-${id}`}
                        aria-label={label}
                        title={`${label} · Arrow keys, Shift for 10 px`}
                        disabled={!editable}
                        onPointerDown={(e) => begin(e, id)}
                        onKeyDown={(e) => {
                          const delta = directions[e.key];
                          if (!delta) return;
                          e.preventDefault();
                          e.stopPropagation();
                          const step = e.shiftKey ? 10 : 1;
                          update(
                            dragCrop(
                              visibleRect,
                              id,
                              delta[0] * step,
                              delta[1] * step,
                              doc,
                              ratio,
                            ),
                          );
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="image-geometry-hint">
              {mode === "crop"
                ? "Drag the corners to crop; drag inside to move. Arrow keys adjust by 1 px, Shift by 10 px."
                : "The preview shows the new proportions. Dimensions are in pixels."}
            </p>
          </div>
          <div className="image-geometry-fields">
            <div className="image-geometry-original">
              <span>{avatar ? "Working preview" : "Current image"}</span>
              <strong>
                {doc.width.toLocaleString()} × {doc.height.toLocaleString()}{" "}
                <small>px</small>
              </strong>
            </div>
            {avatar ? (
              <div className="image-avatar-preview">
                <canvas
                  ref={round}
                  width={128}
                  height={128}
                  aria-label="Round profile picture preview"
                />
                <span>Square crop · round avatar</span>
              </div>
            ) : mode === "crop" ? (
              <label>
                Aspect ratio
                <select
                  aria-label="Crop aspect ratio"
                  value={ratioKey}
                  disabled={!editable}
                  onChange={(e) => {
                    setRatioKey(e.target.value);
                    update(cropWithRatio(visibleRect, ratios[e.target.value]));
                  }}
                >
                  <option value="free">Freeform</option>
                  <option value="original">Original proportions</option>
                  <option value="square">1:1 · Square</option>
                  <option value="landscape">4:3 · Landscape</option>
                  <option value="photo">3:2 · Photograph</option>
                  <option value="wide">16:9 · Widescreen</option>
                  <option value="portrait">3:4 · Portrait</option>
                  <option value="tall">9:16 · Tall</option>
                </select>
              </label>
            ) : (
              <button
                type="button"
                className="button secondary image-geometry-lock"
                aria-pressed={locked}
                disabled={!editable}
                onClick={() => {
                  if (!locked && !validation)
                    update({
                      ...rect,
                      ...proportionalSize(doc, "width", rect.width),
                    });
                  setLocked(!locked);
                }}
              >
                {locked ? (
                  <LockKeyhole size={15} />
                ) : (
                  <LockKeyholeOpen size={15} />
                )}
                Keep proportions
              </button>
            )}
            <div className="image-geometry-dimensions">
              {(mode === "crop"
                ? (["x", "y", "width", "height"] as const)
                : (["width", "height"] as const)
              ).map((key) => (
                <label key={key}>
                  {
                    { x: "Left", y: "Top", width: "Width", height: "Height" }[
                      key
                    ]
                  }
                  <input
                    aria-label={
                      key === "x"
                        ? "Crop left"
                        : key === "y"
                          ? "Crop top"
                          : key === "width"
                            ? "Width"
                            : "Height"
                    }
                    type="number"
                    step={1}
                    min={key === "x" || key === "y" ? 0 : 1}
                    max={8192}
                    value={fields[key]}
                    disabled={!editable}
                    onChange={(e) => field(key, e.target.value)}
                  />
                </label>
              ))}
            </div>
            {mode === "resize" && (
              <>
                <div
                  className="image-geometry-presets"
                  role="group"
                  aria-label="Resize scale presets"
                >
                  {[0.25, 0.5, 1, 2].map((scale) => (
                    <button
                      key={scale}
                      type="button"
                      className="button ghost"
                      disabled={!editable}
                      onClick={() =>
                        update({
                          ...full,
                          width: Math.max(1, Math.round(doc.width * scale)),
                          height: Math.max(1, Math.round(doc.height * scale)),
                        })
                      }
                    >
                      {scale * 100}%
                    </button>
                  ))}
                </div>
                <label>
                  Resampling
                  <select
                    aria-label="Resampling"
                    value={sampling}
                    disabled={!editable}
                    onChange={(e) =>
                      setSampling(e.target.value as ImageSampling)
                    }
                  >
                    <option value="smooth">Smooth · photos and figures</option>
                    <option value="pixelated">
                      Nearest neighbor · pixel art
                    </option>
                  </select>
                </label>
              </>
            )}
            <p className="image-geometry-summary" aria-live="polite">
              {validation
                ? "Check the dimensions below."
                : `${rect.width.toLocaleString()} × ${rect.height.toLocaleString()} px · ${((rect.width * rect.height) / 1_000_000).toFixed(2)} MP`}
            </p>
            <p className="image-geometry-hint">
              {avatar
                ? "Only the selected area is uploaded. Photos are saved at 256 × 256 px with image metadata removed."
                : "All layers, including hidden and locked layers, are affected. Undo restores the previous image."}
            </p>
            {!validation && rasterized > 0 && (
              <p className="image-geometry-warning">
                {rasterized} transformed or rescaled text{" "}
                {rasterized === 1 ? "layer will" : "layers will"} become pixels
                to preserve appearance. Undo restores editable text.
              </p>
            )}
            {(validation || error) && (
              <p className="image-geometry-error" role="alert">
                {validation || error}
              </p>
            )}
            {!editable && (
              <p className="image-geometry-error" role="alert">
                Editing access is required to apply changes.
              </p>
            )}
          </div>
        </fieldset>
        <DialogFooter>
          <button
            type="button"
            className="button ghost image-geometry-reset"
            disabled={applying}
            onClick={() =>
              update(mode === "crop" ? cropWithRatio(full, ratio) : full)
            }
          >
            <RotateCcw size={15} />
            Reset
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={applying}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={!!validation || !editable || !changed || applying}
          >
            {mode === "crop" ? <Crop size={15} /> : <Maximize size={15} />}
            {applying
              ? "Saving…"
              : avatar
                ? "Save photo"
                : mode === "crop"
                  ? "Apply crop"
                  : "Resize image"}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
