"use client";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  Minimize,
  Info,
  MessageSquare,
  Download,
  Copy,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  Grid2X2,
  Scan,
  MousePointer2,
  Hand,
  MoveUpRight,
  Square,
  Circle,
  Pencil,
  Type,
  MapPin,
  Undo2,
  Redo2,
  Trash2,
  Check,
  Eye,
  EyeOff,
  Link2,
  Ruler,
  Columns2,
  ImagePlus,
  RefreshCw,
} from "lucide-react";
import { roleAllows, type Resource, type Space } from "@axiom/shared/workspace";
import {
  samePlacement,
  sameVisualSource,
  type VisualAnnotation,
  type VisualPoint,
  type VisualShape,
  type VisualWrite,
} from "@axiom/shared/visual-annotations";
import Dialog from "../Dialog";
import AnnotationEditor from "../AnnotationEditor";
import { useWorkspace, bytes } from "../workspace/ui";
import { api, ApiError } from "../../lib/client";
import { useVisualMarks } from "../../lib/visual-mark-store";
import {
  fitVisual,
  initialVisualTransform,
  zoomVisual,
  type VisualTransform,
} from "../../lib/visual-geometry";
import {
  loadVisualMedia,
  visualCanvas,
  exportVisual,
  downloadVisual,
  type VisualMedia,
} from "../../lib/visual-media";
import type { VisualAsset, VisualRequest } from "../../lib/visual-assets";
import VisualStage, { type VisualTool } from "./VisualStage";
import {
  Information,
  Histogram,
  Replies,
  VisualNote,
  ComparePicker,
} from "./VisualInspectorPanels";
import { requestFileCreation } from "../../lib/file-creation";
import { useVisualFullscreen } from "./useVisualFullscreen";

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;
function Tool({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button${active ? " active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={17} />
    </button>
  );
}
function useMedia(
  asset: VisualAsset | null,
  host: React.RefObject<HTMLDivElement | null>,
) {
  const [value, setValue] = useState<{
      asset: VisualAsset;
      media: VisualMedia;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setValue(null);
    setError("");
    if (!asset || !host.current) return;
    const abort = new AbortController();
    let media: VisualMedia | undefined;
    void loadVisualMedia(asset, host.current, abort.signal)
      .then((v) => {
        media = v;
        if (abort.signal.aborted) v.dispose();
        else setValue({ asset, media: v });
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => {
      abort.abort();
      media?.dispose();
    };
  }, [asset, host]);
  return { media: value?.asset === asset ? value.media : null, error };
}
function input(record: VisualAnnotation): VisualWrite {
  const {
    authorId: _a,
    authorName: _b,
    createdAt: _c,
    updatedAt: _d,
    ...v
  } = record;
  return { ...v, mutationId: crypto.randomUUID() };
}
export default function VisualViewer({
  request,
  onClose,
}: {
  request: VisualRequest;
  onClose: () => void;
}) {
  const { session, notify, revision, open } = useWorkspace();
  const [items, setItems] = useState(request.items),
    [index, setIndex] = useState(request.index),
    [panel, setPanel] = useState<
      "info" | "markup" | "inspect" | "export" | null
    >(request.initialPanel ?? null);
  const asset = items[index],
    host = useRef<HTMLDivElement>(null),
    { media, error: loadError } = useMedia(asset, host);
  const [compare, setCompare] = useState<VisualAsset | null>(null),
    { media: second, error: compareError } = useMedia(compare, host),
    [linked, setLinked] = useState(true),
    [picker, setPicker] = useState(false);
  const store = useVisualMarks(session.user, asset.placement?.resourceId),
    otherStore = useVisualMarks(session.user, compare?.placement?.resourceId);
  const [t, setT] = useState(initialVisualTransform),
    [otherT, setOtherT] = useState(initialVisualTransform),
    [size, setSize] = useState({ w: 0, h: 0 }),
    [otherSize, setOtherSize] = useState({ w: 0, h: 0 }),
    [fit, setFit] = useState<"contain" | "width" | null>("contain");
  const [tool, setTool] = useState<VisualTool>("pan"),
    [color, setColor] = useState("#d14b59"),
    [stroke, setStroke] = useState(2),
    [pixelated, setPixelated] = useState(false),
    [background, setBackground] = useState("checker"),
    [filmstrip, setFilmstrip] = useState(false),
    [showMarks, setShowMarks] = useState(true),
    [selected, setSelected] = useState<string | null>(null);
  const fullscreen = useVisualFullscreen();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [changed, setChanged] = useState(false),
    [sample, setSample] = useState("Move over the image to inspect a pixel."),
    [distance, setDistance] = useState<number | null>(null);
  const [scopeEntry, setScope] = useState<{
    resourceId: string;
    space: Space;
  } | null>(null);
  const scope =
    scopeEntry?.resourceId === asset.placement?.resourceId
      ? scopeEntry?.space
      : null;
  const [format, setFormat] = useState<"png" | "jpeg" | "webp" | "svg">("png"),
    [scale, setScale] = useState(1),
    [includeMarks, setIncludeMarks] = useState(false),
    [opaque, setOpaque] = useState(false);
  const past = useRef<
      { before: VisualAnnotation | null; after: VisualAnnotation }[]
    >([]),
    future = useRef<
      { before: VisualAnnotation | null; after: VisualAnnotation }[]
    >([]),
    [history, setHistory] = useState(0);
  const canvas = useRef<HTMLCanvasElement | null>(null),
    current = useRef({ asset, media, store });
  current.current = { asset, media, store };
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const abort = new AbortController();
    let running = false;
    const check = async () => {
      if (running || !navigator.onLine) return;
      running = true;
      try {
        for (const item of [asset, compare]) {
          if (!item?.placement) continue;
          const result = await api<Resource & { space: Space }>(
            `resources/${item.placement.resourceId}`,
            { signal: abort.signal },
          );
          if (
            result.deleted_at ||
            ["trashed", "purging"].includes(result.space.effective_status)
          )
            throw new ApiError(
              "This visual's document is no longer available.",
              404,
            );
          if (item.placement.versionId) {
            const ref = await api<{ resource_id: string }>(
              `attachments/${item.placement.versionId}/meta`,
              { signal: abort.signal },
            );
            const reference = await api<Resource & { space: Space }>(
              `resources/${ref.resource_id}`,
              { signal: abort.signal },
            );
            if (
              reference.deleted_at ||
              ["trashed", "purging"].includes(reference.space.effective_status)
            )
              throw new ApiError(
                "The referenced image is no longer available.",
                404,
              );
          }
          if (item === asset && !abort.signal.aborted)
            setScope({
              resourceId: item.placement.resourceId,
              space: result.space,
            });
        }
      } catch (e) {
        if (
          !abort.signal.aborted &&
          e instanceof ApiError &&
          [401, 403, 404].includes(e.status)
        ) {
          notify("Visual closed because access changed.");
          closeRef.current();
        }
      } finally {
        running = false;
      }
    };
    const tick = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    const timer = setInterval(tick, 10000);
    window.addEventListener("focus", tick);
    window.addEventListener("online", tick);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      window.removeEventListener("online", tick);
    };
  }, [asset, compare, revision]);
  const canShare =
    !!scope &&
    scope.kind !== "personal" &&
    scope.effective_status === "active" &&
    roleAllows(scope.role, "comment");
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      await action();
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "This action could not be completed.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const forPlacement = store.rows.filter(
    (r) =>
      !r.parentId &&
      asset.placement &&
      samePlacement(r.placement, asset.placement),
  );
  const matching = forPlacement.filter(
    (r) => !r.deleted && media && sameVisualSource(r.source, media.identity),
  );
  const outdated = forPlacement.filter(
    (r) => !r.deleted && media && !sameVisualSource(r.source, media.identity),
  );
  const unplaced = store.rows.filter(
    (r) =>
      !r.deleted &&
      !r.parentId &&
      !items.some(
        (i) => i.placement && samePlacement(i.placement, r.placement),
      ),
  );
  const selectedMark = matching.find((r) => r.id === selected),
    canEdit = selectedMark?.authorId === session.user.id;
  useEffect(() => {
    setT(initialVisualTransform());
    setFit("contain");
    setSelected(null);
    setTool("pan");
    setChanged(false);
    setError("");
    past.current = [];
    future.current = [];
    setHistory((v) => v + 1);
    canvas.current = null;
  }, [asset]);
  useEffect(() => {
    if (media && fit && size.w && size.h)
      setT((v) => ({
        ...v,
        zoom: fitVisual(
          media.width,
          media.height,
          size.w,
          size.h,
          v.rotation,
          fit === "width",
        ),
        x: 0,
        y: 0,
      }));
  }, [media, size.w, size.h, fit]);
  useEffect(() => {
    if (second && otherSize.w && otherSize.h)
      setOtherT({
        ...initialVisualTransform(),
        zoom: fitVisual(second.width, second.height, otherSize.w, otherSize.h),
      });
  }, [second, otherSize.w, otherSize.h]);
  useEffect(() => {
    // Linking also applies when the second image first decodes, when Fit is
    // selected, or when the panes resize, not only after the next drag.
    if (linked && media && second)
      setOtherT({
        ...t,
        x: (t.x / media.width) * second.width,
        y: (t.y / media.height) * second.height,
      });
  }, [linked, media, second, t, otherSize.w, otherSize.h]);
  useEffect(() => {
    canvas.current = null;
  }, [media]);
  useEffect(() => {
    if (panel !== "markup" && panel !== "inspect") setTool("pan");
  }, [panel]);
  useEffect(() => {
    void store.reload();
  }, [revision]);
  useEffect(() => {
    const check = () => {
      const next = request.current?.();
      if (!next) return;
      const candidate = next.find((i) =>
        asset.placement
          ? !!i.placement && samePlacement(i.placement, asset.placement)
          : i.id === asset.id,
      );
      setChanged(
        !candidate ||
          candidate.url !== asset.url ||
          candidate.source !== asset.source,
      );
    };
    const timer = setInterval(check, 1500);
    return () => clearInterval(timer);
  }, [asset, request]);
  const changeTransform = (next: VisualTransform) => {
    setFit(null);
    setT(next);
  };
  const save = async (
    record: VisualWrite,
    before: VisualAnnotation | null = null,
    historyEntry = true,
  ) => {
    const saved = await store.save(record);
    if (historyEntry) {
      past.current.push({ before, after: saved });
      if (past.current.length > 100) past.current.shift();
      future.current = [];
      setHistory((v) => v + 1);
    }
    return saved;
  };
  const modify = (
    mark: VisualAnnotation,
    patch: Partial<VisualWrite>,
    recordHistory = true,
  ) => run(() => save({ ...input(mark), ...patch }, mark, recordHistory));
  const create = (shape: VisualShape, id?: string) =>
    void run(async () => {
      if (changed)
        throw new Error(
          "The source changed. Refresh the preview before adding markup.",
        );
      if (!media || !asset.placement)
        throw new Error(
          "Open the saved document to retain markup for this placement.",
        );
      if (!media.identity.verified)
        throw new Error(
          "Import an authorized copy before annotating this unverified remote image.",
        );
      const previous = id ? matching.find((m) => m.id === id) : null;
      const value: VisualWrite = previous
        ? { ...input(previous), shape }
        : {
            id: crypto.randomUUID(),
            version: 0,
            mutationId: crypto.randomUUID(),
            placement: asset.placement,
            source: media.identity,
            shape,
            body: "",
            parentId: null,
            visibility: "private",
            resolved: false,
            deleted: false,
          };
      const record = await save(value, previous ?? null);
      setSelected(record.id);
      setPanel("markup");
      setTool("select");
    });
  const undo = () =>
    void run(async () => {
      const entry = past.current.at(-1);
      if (!entry) return;
      const live =
        store.rows.find((r) => r.id === entry.after.id) ?? entry.after;
      await store.save({
        ...input(entry.before ?? live),
        id: live.id,
        version: live.version,
        deleted: entry.before?.deleted ?? true,
      });
      past.current.pop();
      future.current.push(entry);
      setHistory((v) => v + 1);
    });
  const redo = () =>
    void run(async () => {
      const entry = future.current.at(-1);
      if (!entry) return;
      const live =
        store.rows.find((r) => r.id === entry.after.id) ?? entry.after;
      await store.save({ ...input(entry.after), version: live.version });
      future.current.pop();
      past.current.push(entry);
      setHistory((v) => v + 1);
    });
  const shapes = showMarks ? matching.filter((m) => !m.resolved) : [];
  const exportBlob = (type = format) => {
    if (!media) throw new Error("Wait for the image to load.");
    return exportVisual(
      media,
      type,
      scale,
      opaque ? "#ffffff" : undefined,
      includeMarks ? shapes.flatMap((m) => (m.shape ? [m.shape] : [])) : [],
    );
  };
  const download = () =>
    void run(async () =>
      downloadVisual(
        await exportBlob(),
        `${asset.name}.${format === "jpeg" ? "jpg" : format}`,
      ),
    );
  const copy = () =>
    void run(async () => {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
        throw new Error(
          "Image clipboard is unavailable. Download the image instead.",
        );
      const blob = exportBlob("png");
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      notify("Image copied as PNG.");
    });
  const original = () =>
    void run(async () => {
      if (asset.kind === "mermaid") {
        downloadVisual(
          new Blob([asset.source ?? ""], { type: "text/plain" }),
          "diagram.mmd",
        );
        return;
      }
      if (media?.blob) {
        downloadVisual(
          media.blob,
          asset.name.includes(".")
            ? asset.name
            : `${asset.name}.${media.blob.type.split("/")[1]?.replace("jpeg", "jpg") || "image"}`,
        );
        return;
      }
      if (asset.url) window.open(asset.url, "_blank", "noopener,noreferrer");
    });
  const samplePixel = (point: VisualPoint) => {
    if (!media) return;
    try {
      canvas.current ??= visualCanvas(media);
      const x = Math.min(media.width - 1, Math.floor(point[0] * media.width)),
        y = Math.min(media.height - 1, Math.floor(point[1] * media.height)),
        rgba = canvas.current.getContext("2d")!.getImageData(x, y, 1, 1).data;
      setSample(
        `(${x}, ${y}) · #${[...rgba.slice(0, 3)].map((n) => n.toString(16).padStart(2, "0")).join("")} · RGB ${rgba[0]}, ${rgba[1]}, ${rgba[2]} · α ${(rgba[3] / 255).toFixed(2)}`,
      );
    } catch (e) {
      setSample((e as Error).message);
    }
  };
  const escape = () => {
    if (fullscreen.active) void run(fullscreen.exit);
    else onClose();
  };
  const go = (delta: number) => {
    if (busy) return;
    setIndex((v) => Math.max(0, Math.min(items.length - 1, v + delta)));
  };
  const editTools: [VisualTool, Icon, string][] = [
    ["select", MousePointer2, "Select or move markup"],
    ["pan", Hand, "Pan image"],
    ["arrow", MoveUpRight, "Draw arrow"],
    ["rectangle", Square, "Draw rectangle"],
    ["ellipse", Circle, "Draw ellipse"],
    ["pen", Pencil, "Freehand pen"],
    ["label", Type, "Add text label"],
    ["pin", MapPin, "Add region note"],
  ];
  return (
    <Dialog
      title={asset.name}
      subtitle={`${asset.kind === "mermaid" ? "Mermaid diagram" : "Image"} · ${index + 1} of ${items.length} · Original unchanged`}
      size="visual"
      onClose={onClose}
      onEscape={escape}
      surfaceRef={fullscreen.surface}
      expanded={fullscreen.expanded}
    >
      <div
        className="visual-viewer"
        ref={host}
        onKeyDown={(e) => {
          if (e.key !== "Tab") e.stopPropagation();
          if (
            e.defaultPrevented ||
            e.nativeEvent.isComposing ||
            (e.target as Element).closest(
              "input,textarea,select,[contenteditable=true]",
            )
          )
            return;
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
            return;
          }
          if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            changeTransform(zoomVisual(t, t.zoom * 1.25));
          }
          if (e.key === "-") {
            e.preventDefault();
            changeTransform(zoomVisual(t, t.zoom / 1.25));
          }
          if (e.key === "0") {
            e.preventDefault();
            setFit("contain");
            setT((v) => ({ ...v, x: 0, y: 0 }));
          }
          if (e.key === "1") {
            e.preventDefault();
            changeTransform({ ...t, zoom: 1, x: 0, y: 0 });
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            go(-1);
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            go(1);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            if (picker) setPicker(false);
            else escape();
          }
        }}
      >
        <div
          className="visual-toolbar"
          role="toolbar"
          aria-label="Viewer controls"
        >
          <Tool
            icon={ZoomOut}
            label="Zoom out (-)"
            disabled={!media}
            onClick={() => changeTransform(zoomVisual(t, t.zoom / 1.25))}
          />
          <label className="visual-zoom">
            <input
              aria-label="Zoom percentage"
              type="number"
              min={1}
              max={3200}
              value={Math.round(t.zoom * 100)}
              onChange={(e) =>
                changeTransform(zoomVisual(t, Number(e.target.value) / 100))
              }
            />
            <span>%</span>
          </label>
          <Tool
            icon={ZoomIn}
            label="Zoom in (+)"
            disabled={!media}
            onClick={() => changeTransform(zoomVisual(t, t.zoom * 1.25))}
          />
          <button
            type="button"
            className="button ghost"
            onClick={() => {
              setFit("contain");
              if (media)
                setT((v) => ({
                  ...v,
                  zoom: fitVisual(
                    media.width,
                    media.height,
                    size.w,
                    size.h,
                    v.rotation,
                  ),
                  x: 0,
                  y: 0,
                }));
            }}
          >
            Fit
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => {
              setFit("width");
              if (media)
                setT((v) => ({
                  ...v,
                  zoom: fitVisual(
                    media.width,
                    media.height,
                    size.w,
                    size.h,
                    v.rotation,
                    true,
                  ),
                  x: 0,
                  y: 0,
                }));
            }}
          >
            Width
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => changeTransform({ ...t, zoom: 1, x: 0, y: 0 })}
          >
            1:1
          </button>
          <span className="visual-separator" />
          <Tool
            icon={RotateCw}
            label="Rotate view 90°"
            onClick={() =>
              changeTransform({ ...t, rotation: (t.rotation + 90) % 360 })
            }
          />
          <Tool
            icon={FlipHorizontal2}
            label="Flip view horizontally"
            active={t.flipX}
            onClick={() => changeTransform({ ...t, flipX: !t.flipX })}
          />
          <Tool
            icon={FlipVertical2}
            label="Flip view vertically"
            active={t.flipY}
            onClick={() => changeTransform({ ...t, flipY: !t.flipY })}
          />
          <Tool
            icon={RefreshCw}
            label="Reset view"
            onClick={() => {
              setT(initialVisualTransform());
              setFit("contain");
              setPixelated(false);
            }}
          />
          <select
            aria-label="Viewer background"
            value={background}
            onChange={(e) => setBackground(e.target.value)}
          >
            <option value="checker">Transparency</option>
            <option value="paper">Theme paper</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <span className="visual-spacer" />
          <Tool
            icon={Columns2}
            label={compare ? "Close comparison" : "Compare images or diagrams"}
            active={!!compare}
            onClick={() => (compare ? setCompare(null) : setPicker((v) => !v))}
          />
          <Tool
            icon={Grid2X2}
            label="Toggle thumbnail strip"
            active={filmstrip}
            disabled={items.length < 2}
            onClick={() => setFilmstrip((v) => !v)}
          />
          <Tool
            icon={Info}
            label="Image or diagram information"
            active={panel === "info"}
            onClick={() => setPanel((p) => (p === "info" ? null : "info"))}
          />
          <Tool
            icon={Scan}
            label="Pixel inspection and ruler"
            active={panel === "inspect"}
            onClick={() => {
              setPanel((p) => (p === "inspect" ? null : "inspect"));
              setTool("inspect");
            }}
          />
          <Tool
            icon={MessageSquare}
            label="Annotations and markup"
            active={panel === "markup"}
            onClick={() => {
              setPanel((p) => (p === "markup" ? null : "markup"));
              setTool("select");
            }}
          />
          <Tool
            icon={Download}
            label="Export image"
            active={panel === "export"}
            onClick={() => setPanel((p) => (p === "export" ? null : "export"))}
          />
          <Tool
            icon={fullscreen.active ? Minimize : Maximize}
            label={
              fullscreen.expanded
                ? "Exit expanded view"
                : fullscreen.active
                  ? "Exit fullscreen"
                  : "Enter fullscreen"
            }
            active={fullscreen.active}
            disabled={busy}
            onClick={() => void run(fullscreen.toggle)}
          />
        </div>
        {panel === "markup" && (
          <div
            className="visual-toolbar visual-drawing-tools"
            role="toolbar"
            aria-label="Markup tools"
          >
            {editTools.map(([value, icon, label]) => (
              <Tool
                key={value}
                icon={icon}
                label={label}
                active={tool === value}
                disabled={
                  !media ||
                  ((!asset.placement || !media.identity.verified || changed) &&
                    !["pan", "select"].includes(value))
                }
                onClick={() => setTool(value)}
              />
            ))}
            <label className="visual-color" title="Markup color">
              <input
                type="color"
                aria-label="Markup color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  if (selectedMark && canEdit && selectedMark.shape)
                    void modify(selectedMark, {
                      shape: { ...selectedMark.shape, color: e.target.value },
                    });
                }}
              />
            </label>
            <select
              aria-label="Markup line width"
              value={stroke}
              onChange={(e) => {
                setStroke(Number(e.target.value));
                if (selectedMark && canEdit && selectedMark.shape)
                  void modify(selectedMark, {
                    shape: {
                      ...selectedMark.shape,
                      stroke: Number(e.target.value),
                    },
                  });
              }}
            >
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n} px
                </option>
              ))}
            </select>
            <span className="visual-separator" />
            <Tool
              icon={Undo2}
              label="Undo markup"
              disabled={!past.current.length || busy}
              onClick={undo}
            />
            <Tool
              icon={Redo2}
              label="Redo markup"
              disabled={!future.current.length || busy}
              onClick={redo}
            />
            <Tool
              icon={showMarks ? Eye : EyeOff}
              label="Toggle markup visibility"
              active={showMarks}
              onClick={() => setShowMarks((v) => !v)}
            />
            <span className="visual-spacer" />
            <span className="visual-caption">
              Private until shared · this placement only
            </span>
          </div>
        )}
        {(error || loadError || store.error) && (
          <div className="visual-notice is-error" role="alert">
            {error || loadError || store.error}
            <button className="text-button" onClick={() => void store.reload()}>
              Retry
            </button>
          </div>
        )}
        {media?.notice && (
          <div className="visual-notice" role="status">
            {media.notice}
          </div>
        )}
        {changed && (
          <div className="visual-notice" role="status">
            This placement changed in its document. You are viewing a snapshot.
            <button
              className="text-button"
              onClick={() => {
                const next = request.current?.();
                if (next?.length) {
                  setItems(next);
                  setIndex(Math.min(index, next.length - 1));
                  setChanged(false);
                }
              }}
            >
              Refresh snapshot
            </button>
          </div>
        )}
        {picker && (
          <ComparePicker
            items={items}
            selected={asset.id}
            onClose={() => setPicker(false)}
            onSelect={(value) => {
              setCompare(value);
              setPicker(false);
            }}
          />
        )}
        <div className="visual-workspace">
          <div className={`visual-stages${compare ? " is-comparing" : ""}`}>
            <div className="visual-stage-pane">
              {compare && (
                <div className="visual-pane-label">
                  A · {asset.name}
                  <button
                    className="text-button"
                    onClick={() => setLinked((v) => !v)}
                  >
                    <Link2 size={13} />
                    {linked ? "Linked views" : "Independent views"}
                  </button>
                </div>
              )}
              {!media && (
                <div className="visual-loading" role="status">
                  {loadError ? "Preview unavailable" : "Opening visual…"}
                </div>
              )}
              <VisualStage
                media={media}
                transform={t}
                onTransform={changeTransform}
                tool={tool}
                color={color}
                stroke={stroke}
                marks={shapes}
                selected={selected}
                onSelect={(id) => {
                  setSelected(id);
                  if (id) setPanel("markup");
                }}
                onShape={create}
                onSample={samplePixel}
                onMeasure={setDistance}
                onSize={(w, h) => setSize({ w, h })}
                pixelated={pixelated}
                background={background}
                userId={session.user.id}
              />
            </div>
            {compare && (
              <div className="visual-stage-pane">
                <div className="visual-pane-label">
                  B · {compare.name}
                  <button
                    className="text-button"
                    onClick={() => setPicker(true)}
                  >
                    Change
                  </button>
                </div>
                {compareError && (
                  <p className="visual-notice">{compareError}</p>
                )}
                <VisualStage
                  media={second}
                  transform={otherT}
                  onTransform={(next) => {
                    setOtherT(next);
                    if (linked && media && second) {
                      setFit(null);
                      setT({
                        ...next,
                        x: (next.x / second.width) * media.width,
                        y: (next.y / second.height) * media.height,
                      });
                    }
                  }}
                  color={color}
                  stroke={stroke}
                  marks={otherStore.rows.filter(
                    (r) =>
                      !r.deleted &&
                      !r.parentId &&
                      !r.resolved &&
                      compare.placement &&
                      samePlacement(r.placement, compare.placement) &&
                      second &&
                      sameVisualSource(r.source, second.identity),
                  )}
                  selected={null}
                  onSelect={() => {}}
                  onShape={() => {}}
                  onSize={(w, h) => setOtherSize({ w, h })}
                  background={background}
                  pixelated={pixelated}
                  userId={session.user.id}
                  label="Comparison viewport"
                />
              </div>
            )}
          </div>
          {panel && (
            <aside className="visual-inspector" aria-label="Visual inspector">
              {panel === "info" && <Information asset={asset} media={media} />}
              {panel === "inspect" && (
                <section>
                  <h3>Inspect pixels</h3>
                  <p className="visual-caption">
                    Displayed-image pixels, not calibrated scientific
                    measurements.
                  </p>
                  <div className="visual-toolbar">
                    <Tool
                      icon={Scan}
                      label="Sample pixel color"
                      active={tool === "inspect"}
                      onClick={() => setTool("inspect")}
                    />
                    <Tool
                      icon={Ruler}
                      label="Measure pixel distance"
                      active={tool === "ruler"}
                      onClick={() => setTool("ruler")}
                    />
                    <Tool
                      icon={Grid2X2}
                      label="Pixelated rendering"
                      active={pixelated}
                      onClick={() => setPixelated((v) => !v)}
                    />
                  </div>
                  <output className="visual-sample">
                    {tool === "ruler"
                      ? distance === null
                        ? "Drag between two points."
                        : `${distance.toFixed(2)} px`
                      : sample}
                  </output>
                  {media && <Histogram media={media} />}
                </section>
              )}
              {panel === "export" && (
                <section>
                  <h3>Export a copy</h3>
                  <p className="visual-caption">
                    Viewing rotations and flips are temporary. Exports retain
                    original orientation; markup is included only when selected.
                  </p>
                  <label>
                    Format
                    <select
                      aria-label="Format"
                      value={format}
                      onChange={(e) =>
                        setFormat(e.target.value as typeof format)
                      }
                    >
                      <option value="png">PNG · lossless</option>
                      <option value="jpeg">JPG · opaque</option>
                      <option value="webp">WebP</option>
                      {asset.kind === "mermaid" && (
                        <option value="svg">SVG · vector</option>
                      )}
                    </select>
                  </label>
                  <label>
                    Scale
                    <select
                      aria-label="Export scale"
                      value={scale}
                      onChange={(e) => setScale(Number(e.target.value))}
                    >
                      {[0.25, 0.5, 1, 2, 4].map((n) => (
                        <option key={n} value={n}>
                          {n}×
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="visual-check">
                    <input
                      type="checkbox"
                      checked={opaque}
                      onChange={(e) => setOpaque(e.target.checked)}
                    />
                    White background
                  </label>
                  <label className="visual-check">
                    <input
                      type="checkbox"
                      checked={includeMarks}
                      onChange={(e) => setIncludeMarks(e.target.checked)}
                    />
                    Include visible markup
                  </label>
                  <div className="visual-action-grid">
                    <button
                      className="button primary"
                      disabled={!media || busy}
                      onClick={download}
                    >
                      <Download size={15} />
                      Download copy
                    </button>
                    <button
                      className="button secondary"
                      disabled={!media || busy}
                      onClick={copy}
                    >
                      <Copy size={15} />
                      Copy PNG
                    </button>
                  </div>
                  <hr />
                  <button className="button secondary" onClick={original}>
                    <Download size={15} />
                    {asset.kind === "mermaid"
                      ? "Download Mermaid source"
                      : "Download original"}
                  </button>
                  {asset.kind === "image" && asset.placement?.versionId && (
                    <>
                      <button
                        className="button secondary"
                        onClick={() =>
                          void run(async () => {
                            const file = await api<{ resource_id: string }>(
                              `attachments/${asset.placement!.versionId}/meta`,
                            );
                            onClose();
                            requestAnimationFrame(() =>
                              requestFileCreation({
                                type: "image",
                                importFile: file.resource_id,
                                importVersion: asset.placement!.versionId,
                              }),
                            );
                          })
                        }
                      >
                        <ImagePlus size={15} />
                        Edit a copy in Image Studio
                      </button>
                      <button
                        className="button ghost"
                        onClick={() =>
                          void run(async () => {
                            const file = await api<{ resource_id: string }>(
                              `attachments/${asset.placement!.versionId}/meta`,
                            );
                            onClose();
                            open({ id: file.resource_id, kind: "file" });
                          })
                        }
                      >
                        Open original file
                      </button>
                    </>
                  )}
                  <button
                    className="button ghost"
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(
                          asset.kind === "mermaid"
                            ? (asset.source ?? "")
                            : asset.markdown ||
                                `![${asset.name}](${asset.url})`,
                        );
                        notify("Source copied.");
                      })
                    }
                  >
                    <Copy size={15} />
                    Copy{" "}
                    {asset.kind === "mermaid"
                      ? "Mermaid source"
                      : "image Markdown"}
                  </button>
                  {asset.url && (
                    <button
                      className="button ghost"
                      onClick={() =>
                        void run(() =>
                          navigator.clipboard.writeText(asset.url!),
                        )
                      }
                    >
                      <Link2 size={15} />
                      Copy image address
                    </button>
                  )}
                  <button
                    className="button ghost"
                    onClick={() =>
                      downloadVisual(
                        new Blob(
                          [
                            JSON.stringify(
                              {
                                format: "axiom-visual-markup",
                                version: 1,
                                placement: asset.placement,
                                source: media?.identity,
                                annotations: matching,
                              },
                              null,
                              2,
                            ),
                          ],
                          { type: "application/json" },
                        ),
                        "visual-markup.json",
                      )
                    }
                  >
                    <Download size={15} />
                    Export editable markup JSON
                  </button>
                  <p className="visual-caption">
                    Raster export of an animated image captures one frame. SVG
                    preserves Mermaid vectors; no raster-to-vector conversion is
                    implied.
                  </p>
                </section>
              )}
              {panel === "markup" && (
                <section>
                  <h3>
                    Annotations <span className="muted">{matching.length}</span>
                  </h3>
                  <p className="visual-caption">
                    Original content is unchanged. Draw a region or pin to add a
                    note.
                  </p>
                  {!asset.placement && (
                    <p className="visual-notice">
                      This preview has no saved document placement. Open the
                      original document to save markup.
                    </p>
                  )}
                  {store.pending.length > 0 && (
                    <p className="visual-caption" role="status">
                      {store.pending.some((p) => p.error)
                        ? "Draft needs attention"
                        : "Saved locally · awaiting server"}
                    </p>
                  )}
                  {store.pending
                    .filter((p) => p.error)
                    .map((p) => (
                      <div className="visual-notice is-error" key={p.id}>
                        <p>{p.error}</p>
                        <button
                          className="text-button"
                          onClick={() =>
                            void run(() => store.resolve(p.id, true))
                          }
                        >
                          Reapply my draft
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            void run(() => store.resolve(p.id, false))
                          }
                        >
                          Use server version
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            downloadVisual(
                              new Blob([JSON.stringify(p.record, null, 2)], {
                                type: "application/json",
                              }),
                              "retained-markup.json",
                            )
                          }
                        >
                          Export draft
                        </button>
                      </div>
                    ))}
                  <div className="visual-mark-list">
                    {matching.map((mark) => (
                      <button
                        key={mark.id}
                        type="button"
                        className={selected === mark.id ? "selected" : ""}
                        onClick={() => {
                          setSelected(mark.id);
                          setTool("select");
                        }}
                      >
                        <span
                          className="visual-mark-dot"
                          style={{
                            background: mark.shape?.color ?? "var(--accent)",
                          }}
                        />
                        <span>
                          <strong>
                            {mark.shape?.text || mark.shape?.kind || "Note"}
                            {mark.resolved ? " · resolved" : ""}
                          </strong>
                          <small>
                            {mark.authorName} · {mark.visibility}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                  {selectedMark && (
                    <div className="visual-mark-details">
                      <h4>{selectedMark.shape?.kind ?? "Annotation"}</h4>
                      {canEdit && selectedMark.shape?.kind === "label" && (
                        <label>
                          Label
                          <input
                            aria-label="Annotation label"
                            maxLength={500}
                            value={selectedMark.shape.text}
                            onChange={(e) =>
                              void modify(
                                selectedMark,
                                {
                                  shape: {
                                    ...selectedMark.shape!,
                                    text: e.target.value,
                                  },
                                },
                                false,
                              )
                            }
                          />
                        </label>
                      )}
                      {canEdit ? (
                        <AnnotationEditor
                          key={`body:${selectedMark.id}`}
                          value={selectedMark.body}
                          onChange={(body) =>
                            void modify(selectedMark, { body }, false)
                          }
                          onError={setError}
                        />
                      ) : (
                        <VisualNote
                          body={selectedMark.body || "No text note."}
                        />
                      )}
                      {canEdit && (
                        <div className="visual-action-grid">
                          <button
                            className="button secondary"
                            disabled={
                              !canShare ||
                              busy ||
                              changed ||
                              store.pending.some((p) => !!p.error)
                            }
                            title={
                              canShare
                                ? "Shared with people who can read this document"
                                : "Sharing requires comment access in an active group workspace"
                            }
                            onClick={() =>
                              void modify(selectedMark, {
                                visibility:
                                  selectedMark.visibility === "private"
                                    ? "shared"
                                    : "private",
                              })
                            }
                          >
                            {selectedMark.visibility === "private"
                              ? "Share annotation"
                              : "Make private"}
                          </button>
                          <button
                            className="button secondary"
                            onClick={() =>
                              void modify(selectedMark, {
                                resolved: !selectedMark.resolved,
                              })
                            }
                          >
                            <Check size={14} />
                            {selectedMark.resolved ? "Reopen" : "Resolve"}
                          </button>
                          <button
                            className="button ghost danger"
                            onClick={() =>
                              void modify(selectedMark, { deleted: true })
                            }
                          >
                            <Trash2 size={14} />
                            Remove
                          </button>
                        </div>
                      )}
                      {!canEdit &&
                        scope?.can_manage &&
                        selectedMark.visibility === "shared" && (
                          <button
                            className="button ghost danger"
                            onClick={() =>
                              void modify(selectedMark, { deleted: true })
                            }
                          >
                            <Trash2 size={14} />
                            Remove shared annotation
                          </button>
                        )}
                      {selectedMark.visibility === "shared" && (
                        <Replies
                          key={`replies:${selectedMark.id}`}
                          canReply={canShare}
                          userId={session.user.id}
                          canManage={!!scope?.can_manage}
                          onRemove={(r) => modify(r, { deleted: true })}
                          rows={store.rows.filter(
                            (r) => !r.deleted && r.parentId === selectedMark.id,
                          )}
                          onReply={(body) =>
                            run(() =>
                              store.save({
                                ...input(selectedMark),
                                id: crypto.randomUUID(),
                                version: 0,
                                parentId: selectedMark.id,
                                shape: null,
                                body,
                                resolved: false,
                                deleted: false,
                              }),
                            )
                          }
                        />
                      )}
                    </div>
                  )}
                  {(outdated.length > 0 || unplaced.length > 0) && (
                    <details className="visual-outdated">
                      <summary>
                        Outdated / unplaced ({outdated.length + unplaced.length}
                        )
                      </summary>
                      <p className="visual-caption">
                        Review these regions before applying them to changed
                        content.
                      </p>
                      {[...outdated, ...unplaced].map((mark) => (
                        <div key={mark.id}>
                          <p>
                            {mark.source.label} · {mark.authorName}
                          </p>
                          {mark.authorId === session.user.id && (
                            <>
                              <button
                                className="text-button"
                                disabled={!media || !asset.placement}
                                onClick={() =>
                                  void modify(mark, {
                                    placement: asset.placement!,
                                    source: media!.identity,
                                  })
                                }
                              >
                                Attach here after review
                              </button>
                              <button
                                className="text-button"
                                onClick={() =>
                                  void modify(mark, { deleted: true })
                                }
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </details>
                  )}
                </section>
              )}
            </aside>
          )}
        </div>
        {filmstrip && (
          <div className="visual-filmstrip" aria-label="Document visuals">
            {items.map((item, i) => (
              <button
                key={item.id}
                className={index === i ? "active" : ""}
                onClick={() => setIndex(i)}
                aria-label={`View ${i + 1}: ${item.name}`}
              >
                {item.kind === "image" ? (
                  <img src={item.url} alt="" loading="lazy" draggable={false} />
                ) : (
                  <Columns2 size={24} />
                )}
                <span>
                  {i + 1} · {item.name}
                </span>
              </button>
            ))}
          </div>
        )}
        <footer className="visual-footer">
          <Tool
            icon={ArrowLeft}
            label="Previous visual (←)"
            disabled={index === 0}
            onClick={() => go(-1)}
          />
          <span>
            {index + 1} / {items.length}
          </span>
          <Tool
            icon={ArrowRight}
            label="Next visual (→)"
            disabled={index === items.length - 1}
            onClick={() => go(1)}
          />
          <span className="visual-spacer" />
          <span>
            {media
              ? `${media.width.toLocaleString()} × ${media.height.toLocaleString()} px${media.blob ? ` · ${bytes(media.blob.size)}` : ""}`
              : ""}
          </span>
          <span className="visual-caption">
            Scroll to zoom · drag to pan · 0 fit · 1 actual size · Esc{" "}
            {fullscreen.expanded
              ? "restore viewer"
              : fullscreen.active
                ? "leave fullscreen"
                : "close"}
          </span>
          <span hidden>{history}</span>
        </footer>
      </div>
    </Dialog>
  );
}
