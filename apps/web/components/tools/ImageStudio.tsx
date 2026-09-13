"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  MousePointer2,
  Hand,
  Brush,
  Eraser,
  Square,
  Type,
  ArrowUpRight,
  Crop,
  Scan,
  Stamp,
  Pipette,
  Undo2,
  Redo2,
  Plus,
  Eye,
  EyeOff,
  Lock,
  Layers,
  Download,
  Save,
  Upload,
  Trash2,
  Copy,
  FolderPlus,
  Scissors,
  SlidersHorizontal,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  ZoomIn,
  ZoomOut,
  Maximize,
  Circle,
  Paintbrush2,
} from "lucide-react";
import type { ImageEditLease, ToolProject } from "@axiom/shared/research-tools";
import {
  ImageDocument,
  imageCanvas,
  canvasBlob,
  layerMatrix,
  imageFonts,
  blendModes,
  type ImageLayer,
} from "../../lib/tools/image-engine";
import { imageDraft, type ImageDraft } from "../../lib/tools/image-drafts";
import { downloadBlob } from "../../lib/tools/download";
import { post, SIGN_OUT_PENDING } from "../../lib/client";
import { openContextMenu } from "../../lib/context-menu";
import Dialog from "../Dialog";
import ResourceDiscussion from "./ResourceDiscussion";
import ResourceSharing from "../workspace/ResourceSharing";
import {
  ErrorNotice,
  go,
  Loading,
  useWorkspace,
  WorkspaceLink,
} from "../workspace/ui";
type Tool =
  | "move"
  | "hand"
  | "brush"
  | "eraser"
  | "rectangle"
  | "ellipse"
  | "arrow"
  | "text"
  | "selection"
  | "ellipse-selection"
  | "lasso"
  | "clone"
  | "heal"
  | "eyedropper";
const tools = [
  { id: "move", label: "Move layer (V)", icon: MousePointer2 },
  { id: "hand", label: "Pan (H)", icon: Hand },
  { id: "selection", label: "Rectangular selection (M)", icon: Scan },
  { id: "ellipse-selection", label: "Elliptical selection", icon: Circle },
  { id: "lasso", label: "Lasso selection (L)", icon: Scissors },
  { id: "brush", label: "Brush (B)", icon: Brush },
  { id: "eraser", label: "Eraser (E)", icon: Eraser },
  { id: "clone", label: "Clone stamp (S) · Alt-click to sample", icon: Stamp },
  {
    id: "heal",
    label: "Sampled healing · Alt-click to sample",
    icon: Paintbrush2,
  },
  { id: "eyedropper", label: "Eyedropper (I)", icon: Pipette },
  { id: "text", label: "Text (T)", icon: Type },
  { id: "rectangle", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight },
] as const;
export default function ImageStudio({
  project,
  importFile,
  importVersion,
}: {
  project: ToolProject;
  importFile: string | null;
  importVersion: string | null;
}) {
  const { session, notify, refresh } = useWorkspace();
  const [doc, setDoc] = useState<ImageDocument | null>(null),
    [, repaint] = useState(0),
    [error, setError] = useState(""),
    [lease, setLease] = useState<ImageEditLease | null>(null),
    [status, setStatus] = useState("Opening project…"),
    [busy, setBusy] = useState(false),
    [tool, setTool] = useState<Tool>("move"),
    [color, setColor] = useState("#202124"),
    [brushSize, setBrushSize] = useState(18),
    [brushOpacity, setBrushOpacity] = useState(1),
    [zoom, setZoom] = useState(0.65),
    [baseVersion, setBaseVersion] = useState(
      project.current_version_id ?? null,
    ),
    [savedRevision, setSavedRevision] = useState(0),
    [draft, setDraft] = useState<ImageDraft | null>(null),
    [recoveryReady, setRecoveryReady] = useState(false),
    [leaving, setLeaving] = useState<(() => void) | null>(null),
    [dialog, setDialog] = useState<
      "export" | "resize" | "text" | "adjust" | "discussion" | null
    >(null),
    [warnings, setWarnings] = useState<string[]>([]),
    [text, setText] = useState("Research figure"),
    [fontSize, setFontSize] = useState(40),
    [fontFamily, setFontFamily] = useState<string>("Inter"),
    [width, setWidth] = useState(1200),
    [height, setHeight] = useState(800),
    [filter, setFilter] = useState("brightness"),
    [amount, setAmount] = useState(10),
    [feather, setFeather] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null),
    overlay = useRef<HTMLCanvasElement>(null),
    stage = useRef<HTMLDivElement>(null),
    upload = useRef<HTMLInputElement>(null),
    latest = useRef({ doc, lease, baseVersion, savedRevision, busy }),
    alive = useRef(true),
    draftQueue = useRef<Promise<unknown>>(Promise.resolve()),
    sample = useRef<{ x: number; y: number } | null>(null),
    pointer = useRef<{
      x: number;
      y: number;
      lastX: number;
      lastY: number;
      layer: ImageLayer;
      before: ImageData;
      layerX: number;
      layerY: number;
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      points: { x: number; y: number }[];
      clone?: HTMLCanvasElement;
      mask?: ImageData;
    } | null>(null),
    pendingText = useRef({ x: 100, y: 100 });
  const editingText = useRef<string | null>(null);
  latest.current = { doc, lease, baseVersion, savedRevision, busy };
  const editable =
    project.role === "editor" &&
    !!lease &&
    new Date(lease.expiresAt).valueOf() > Date.now() &&
    !busy;
  const active = doc?.active,
    dirty = !!doc && doc.revision !== savedRevision;
  const keepDraft = (
    d: ImageDocument,
    revision: number,
    version: string | null,
  ) => {
    const pending = draftQueue.current
      .catch(() => {})
      .then(async () => {
        if (latest.current.doc !== d || d.revision !== revision) return false;
        const blob = await d.bundle();
        if (latest.current.doc !== d || d.revision !== revision) return false;
        await imageDraft(session.user.id, project.resource_id, {
          blob,
          baseVersion: version,
          updatedAt: new Date().toISOString(),
        });
        return true;
      });
    draftQueue.current = pending;
    return pending;
  };
  const draw = () => {
    const d = latest.current.doc;
    if (!d || !canvas.current) return;
    d.render(canvas.current);
    if (overlay.current) {
      const o = overlay.current;
      if (o.width !== d.width) o.width = d.width;
      if (o.height !== d.height) o.height = d.height;
      const ctx = o.getContext("2d")!;
      ctx.clearRect(0, 0, o.width, o.height);
      const s = d.selection;
      if (s && s.points.length >= 2) {
        const [a, b] = s.points;
        ctx.strokeStyle = "#2674ef";
        ctx.lineWidth = 1.5 / zoom;
        ctx.setLineDash([6 / zoom, 4 / zoom]);
        ctx.beginPath();
        if (s.kind === "rectangle")
          ctx.rect(
            Math.min(a.x, b.x),
            Math.min(a.y, b.y),
            Math.abs(b.x - a.x),
            Math.abs(b.y - a.y),
          );
        else if (s.kind === "ellipse")
          ctx.ellipse(
            (a.x + b.x) / 2,
            (a.y + b.y) / 2,
            Math.abs(b.x - a.x) / 2,
            Math.abs(b.y - a.y) / 2,
            0,
            0,
            Math.PI * 2,
          );
        else {
          ctx.moveTo(a.x, a.y);
          s.points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
          ctx.closePath();
        }
        ctx.stroke();
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void (async () => {
      let d: ImageDocument;
      if (project.current_version_id) {
        const response = await fetch(
          `/api/v1/files/${project.resource_id}/content?version=${project.current_version_id}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error("Saved image project could not be loaded.");
        d = await ImageDocument.open(await response.arrayBuffer());
      } else if (importFile) {
        const response = await fetch(
          `/api/v1/files/${importFile}/content${importVersion ? `?version=${importVersion}` : ""}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Original image is unavailable.");
        const blob = await response.blob();
        if (blob.size > 50_000_000)
          throw new Error("Image import is limited to 50 MB.");
        if (/photoshop/i.test(blob.type)) {
          const imported = await (
            await import("../../lib/tools/image-psd")
          ).importPsd(await blob.arrayBuffer());
          d = imported.doc;
          setWarnings(imported.warnings);
        } else {
          const bitmap = await createImageBitmap(blob);
          d = new ImageDocument(bitmap.width, bitmap.height);
          d.addLayer("Original image", bitmap);
          bitmap.close();
        }
      } else {
        d = new ImageDocument();
        d.addLayer("Layer 1");
      }
      if (!alive.current) return;
      setDoc(d);
      setWidth(d.width);
      setHeight(d.height);
      setSavedRevision(project.current_version_id ? d.revision : -1);
      const recovery = await imageDraft(
        session.user.id,
        project.resource_id,
      ).catch(() => undefined);
      if (alive.current && recovery) setDraft(recovery);
      if (alive.current) setRecoveryReady(true);
      if (project.role === "editor") {
        const current = await post(`tools/${project.resource_id}/lease`, {});
        if (alive.current) {
          setLease(current);
          setStatus("Editing lease acquired · local recovery enabled");
        }
      } else setStatus("Read-only saved version");
    })().catch((e) => {
      if (alive.current) setError(e.message);
    });
    return () => {
      alive.current = false;
      controller.abort();
      const l = latest.current.lease;
      if (l)
        void fetch(`/api/v1/tools/${project.resource_id}/lease`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: l.token, release: true }),
          keepalive: true,
        }).catch(() => {});
    };
  }, [project.resource_id, session.user.id]);
  useEffect(() => {
    if (!doc) return;
    const un = doc.subscribe(() => {
      if (doc.revision !== latest.current.savedRevision)
        setStatus("Unsaved changes · preparing local recovery");
      repaint((n) => n + 1);
      draw();
    });
    draw();
    return un;
  }, [doc, zoom]);
  useEffect(() => {
    if (!lease) return;
    const interval = setInterval(() => {
      const l = latest.current.lease;
      if (!l) return;
      void post(`tools/${project.resource_id}/lease`, { token: l.token })
        .then((value) => {
          if (alive.current) setLease(value);
        })
        .catch((e) => {
          if (alive.current) {
            setLease(null);
            setError(
              e.message +
                " Your draft remains available for export or saving as a copy.",
            );
            setStatus("Editing paused · lease unavailable");
          }
        });
    }, 25000);
    return () => clearInterval(interval);
  }, [!!lease, project.resource_id]);
  useEffect(() => {
    if (!doc || !dirty || draft || busy || !recoveryReady) return;
    const version = doc.revision;
    const timeout = setTimeout(() => {
      void keepDraft(doc, version, baseVersion)
        .then((saved) => {
          if (
            saved &&
            alive.current &&
            latest.current.doc === doc &&
            doc.revision === version
          )
            setStatus("Draft saved on this device · Save publishes a version");
        })
        .catch((e) => {
          if (alive.current && doc.revision === version)
            setError(
              `Local recovery could not be saved: ${e.message}. Keep this tab open and export your project.`,
            );
        });
    }, 1500);
    return () => clearTimeout(timeout);
  }, [
    doc,
    doc?.revision,
    dirty,
    draft,
    recoveryReady,
    busy,
    baseVersion,
    session.user.id,
    project.resource_id,
  ]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      const s = latest.current;
      if (s.doc && (pointer.current || s.doc.revision !== s.savedRevision)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const signout = () => {
      setLease(null);
    };
    const storage = (e: StorageEvent) => {
      if (e.key === SIGN_OUT_PENDING && e.newValue) signout();
    };
    const pagehide = () => {
      const current = latest.current.lease;
      if (!current) return;
      // React cleanup does not run on a full page load or browser-tab close.
      // A keepalive release makes the saved project immediately available again.
      void fetch(`/api/v1/tools/${project.resource_id}/lease`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: current.token, release: true }),
        keepalive: true,
      }).catch(() => {});
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setLease(null);
        setStatus("Reacquire editing access after returning to this page.");
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("axiom:close-documents", signout);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("axiom:close-documents", signout);
      window.removeEventListener("storage", storage);
    };
  }, []);
  useEffect(() => {
    const before = (event: Event) => {
      const s = latest.current;
      if (
        !s.doc ||
        (!pointer.current && s.doc.revision === s.savedRevision && !s.busy)
      )
        return;
      event.preventDefault();
      setLeaving(
        () => (event as CustomEvent<{ proceed: () => void }>).detail.proceed,
      );
    };
    window.addEventListener("axiom:before-navigate", before);
    return () => window.removeEventListener("axiom:before-navigate", before);
  }, []);
  const safely = (fn: () => void) => {
    try {
      fn();
      setError("");
      draw();
      repaint((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = async (copy = false) => {
    const state = latest.current;
    if (!state.doc || state.busy) return;
    latest.current.busy = true;
    setBusy(true);
    setError("");
    setStatus(copy ? "Saving a project copy…" : "Saving a new cloud version…");
    try {
      const revision = state.doc.revision,
        blob = await state.doc.bundle();
      let target = project.resource_id,
        l = state.lease,
        expected = state.baseVersion;
      if (copy) {
        const created = await post("tools", {
          kind: "image",
          spaceId: project.space_id,
          name: project.name.replace(/\.axiom-image$/i, "") + " copy",
          mutationId: crypto.randomUUID(),
        });
        target = created.id;
        l = await post(`tools/${target}/lease`, {});
        expected = null;
      }
      if (!l)
        throw new Error(
          "Acquire editing access or save a copy before publishing.",
        );
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const result = await post(`tools/${target}/save`, {
        token: l.token,
        fence: l.fence,
        expectedVersion: expected,
        mutationId: crypto.randomUUID(),
        bundle: base64,
      });
      if (copy) {
        await post(`tools/${target}/lease`, { token: l.token, release: true });
        // The copy is committed; bypass only our unsaved-original guard here.
        go(`/image/${target}`, false, true);
      } else {
        latest.current.baseVersion = result.versionId;
        latest.current.savedRevision = revision;
        setBaseVersion(result.versionId);
        setSavedRevision(revision);
        const clear = draftQueue.current
          .catch(() => {})
          .then(() => imageDraft(session.user.id, project.resource_id, null));
        draftQueue.current = clear;
        await clear;
        setStatus("Saved as a new cloud version");
      }
      refresh();
      notify("Image project saved. Previous versions are unchanged.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      latest.current.busy = false;
    }
  };
  const importImage = async (file: File) => {
    if (!doc || !editable) return;
    setBusy(true);
    try {
      if (file.size > 50_000_000)
        throw new Error("Image import is limited to 50 MB.");
      if (/\.psd$/i.test(file.name)) {
        const imported = await (
          await import("../../lib/tools/image-psd")
        ).importPsd(await file.arrayBuffer());
        if (
          doc.layers.some((l) =>
            l.canvas
              .getContext("2d")!
              .getImageData(0, 0, l.canvas.width, l.canvas.height)
              .data.some((v, i) => i % 4 === 3 && v > 0),
          )
        )
          throw new Error(
            "Import PSD into a new empty project to keep your current layers intact.",
          );
        setDoc(imported.doc);
        setSavedRevision(-1);
        setWarnings(imported.warnings);
      } else {
        const bitmap = await createImageBitmap(file);
        try {
          if (bitmap.width * bitmap.height > 16_000_000)
            throw new Error("Image exceeds the 16 megapixel limit.");
          doc.addLayer(file.name, bitmap);
        } finally {
          bitmap.close();
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const point = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * doc!.width) / rect.width,
      y: ((e.clientY - rect.top) * doc!.height) / rect.height,
    };
  };
  const localPoint = (layer: ImageLayer, p: { x: number; y: number }) => {
    const matrix = layerMatrix(
      layer,
      doc?.layers.find((g) => g.id === layer.parent),
    ).inverse();
    return new DOMPoint(p.x, p.y).matrixTransform(matrix);
  };
  const stroke = (world: { x: number; y: number }) => {
    const p = pointer.current;
    if (!p || !doc) return;
    const pos = localPoint(p.layer, world),
      ctx = p.layer.canvas.getContext("2d")!,
      radius = brushSize / 2;
    ctx.save();
    ctx.globalAlpha = brushOpacity;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (tool === "eraser") ctx.globalCompositeOperation = "destination-out";
    if ((tool === "clone" || tool === "heal") && p.clone && sample.current) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.clip();
      if (tool === "heal") {
        ctx.filter = `blur(${Math.max(0.5, brushSize / 30)}px)`;
        ctx.globalAlpha *= 0.6;
      }
      const origin = localPoint(p.layer, sample.current);
      ctx.drawImage(p.clone, p.x - origin.x, p.y - origin.y);
    } else {
      ctx.beginPath();
      ctx.moveTo(p.lastX, p.lastY);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
    ctx.restore();
    if (doc.selection) {
      p.mask ??= doc
        .selectionMask(p.layer)
        .getContext("2d")!
        .getImageData(0, 0, doc.width, doc.height);
      const x = Math.max(0, Math.floor(Math.min(p.lastX, pos.x) - radius - 2)),
        y = Math.max(0, Math.floor(Math.min(p.lastY, pos.y) - radius - 2));
      const w = Math.min(
          doc.width - x,
          Math.ceil(Math.abs(p.lastX - pos.x) + 2 * radius + 4),
        ),
        h = Math.min(
          doc.height - y,
          Math.ceil(Math.abs(p.lastY - pos.y) + 2 * radius + 4),
        );
      if (w > 0 && h > 0) {
        const current = ctx.getImageData(x, y, w, h);
        for (let row = 0; row < h; row++)
          for (let col = 0; col < w; col++) {
            const i = (row * w + col) * 4,
              j = ((row + y) * doc.width + col + x) * 4,
              alpha = p.mask.data[j + 3] / 255;
            for (let c = 0; c < 4; c++)
              current.data[i + c] =
                p.before.data[j + c] * (1 - alpha) +
                current.data[i + c] * alpha;
          }
        ctx.putImageData(current, x, y);
      }
    }
    p.lastX = pos.x;
    p.lastY = pos.y;
    p.minX = Math.min(p.minX, pos.x - radius);
    p.minY = Math.min(p.minY, pos.y - radius);
    p.maxX = Math.max(p.maxX, pos.x + radius);
    p.maxY = Math.max(p.maxY, pos.y + radius);
    draw();
  };
  const finish = () => {
    const p = pointer.current;
    if (!p || !doc) return;
    pointer.current = null;
    if (tool === "move") {
      const x = p.layer.x,
        y = p.layer.y;
      p.layer.x = p.layerX;
      p.layer.y = p.layerY;
      doc.updateLayer(p.layer.id, { x, y });
    } else if (
      !["hand", "selection", "ellipse-selection", "lasso"].includes(tool)
    )
      doc.commitPixels(
        p.layer,
        p.before,
        {
          x: Math.floor(p.minX - 2),
          y: Math.floor(p.minY - 2),
          width: p.maxX - p.minX + 4,
          height: p.maxY - p.minY + 4,
        },
        tool,
      );
    draw();
    repaint((n) => n + 1);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.isComposing ||
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true],dialog",
        )
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save(e.shiftKey);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (editable) safely(() => (e.shiftKey ? doc?.redo() : doc?.undo()));
        return;
      }
      if (e.key === "Escape") {
        if (doc) {
          doc.selection = null;
          draw();
          repaint((n) => n + 1);
        }
        return;
      }
      const shortcut: Record<string, Tool> = {
        v: "move",
        h: "hand",
        m: "selection",
        l: "lasso",
        b: "brush",
        e: "eraser",
        s: "clone",
        i: "eyedropper",
        t: "text",
      };
      if (shortcut[e.key.toLowerCase()] && !e.metaKey && !e.ctrlKey)
        setTool(shortcut[e.key.toLowerCase()]);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [doc, editable, busy, baseVersion]);
  return (
    <main className="research-studio image-studio">
      <header className="studio-header">
        <WorkspaceLink
          to={`/explorer?space=${project.space_id}${project.parent_id ? `&folder=${project.parent_id}` : ""}`}
          className="icon-button"
          aria-label="Back to folder"
        >
          <ArrowLeft size={18} />
        </WorkspaceLink>
        <div className="studio-title">
          <span>Image Studio</span>
          <h1>{project.name.replace(/\.axiom-image$/i, "")}</h1>
        </div>
        <span className="tool-spacer" />
        <ResourceSharing resourceId={project.resource_id} />
        <input
          type="file"
          ref={upload}
          hidden
          accept="image/*,.psd"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importImage(f);
            e.target.value = "";
          }}
        />
        <button
          className="icon-button"
          title="Import image as layer"
          aria-label="Import image as layer"
          disabled={!editable}
          onClick={() => upload.current?.click()}
        >
          <Upload size={17} />
        </button>
        <button
          className="button secondary"
          onClick={() => setDialog("export")}
          disabled={!doc}
        >
          <Download size={15} />
          Export
        </button>
        <button
          className="button secondary"
          disabled={!baseVersion}
          onClick={() => setDialog("discussion")}
        >
          Discussion
        </button>
        <button
          className="button secondary"
          disabled={!doc || busy || project.role !== "editor"}
          onClick={() => void save(true)}
        >
          <Copy size={15} />
          Save copy
        </button>
        <button
          className="button primary"
          disabled={!editable || !dirty}
          onClick={() => void save()}
        >
          <Save size={15} />
          {busy ? "Processing…" : "Save version"}
        </button>
      </header>
      <ErrorNotice message={error} />
      {!lease && doc && project.role === "editor" && !busy && (
        <div className="tool-controls">
          <span>Saved preview and local draft remain available.</span>
          <button
            className="button secondary"
            onClick={() =>
              void post(`tools/${project.resource_id}/lease`, {})
                .then(setLease)
                .catch((e) => setError(e.message))
            }
          >
            Acquire editing access
          </button>
        </div>
      )}
      {warnings.length > 0 && (
        <details className="image-import-warnings">
          <summary>PSD compatibility notes ({warnings.length})</summary>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="tool-controls image-options">
        <strong>
          {tools.find((t) => t.id === tool)?.label.split(" (")[0]}
        </strong>
        <span className="tool-separator" />
        <label>
          Color
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label>
          Size
          <input
            aria-label="Brush size"
            type="range"
            min={1}
            max={160}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
          />
          <span>{brushSize}</span>
        </label>
        <label>
          Opacity
          <input
            aria-label="Brush opacity"
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={brushOpacity}
            onChange={(e) => setBrushOpacity(Number(e.target.value))}
          />
        </label>
        <span className="tool-spacer" />
        <button
          className="icon-button"
          title="Undo"
          aria-label="Undo"
          disabled={!editable || !doc?.canUndo}
          onClick={() => safely(() => doc?.undo())}
        >
          <Undo2 size={16} />
        </button>
        <button
          className="icon-button"
          title="Redo"
          aria-label="Redo"
          disabled={!editable || !doc?.canRedo}
          onClick={() => safely(() => doc?.redo())}
        >
          <Redo2 size={16} />
        </button>
        <button
          className="button ghost"
          disabled={!editable}
          onClick={() => setDialog("resize")}
        >
          <Maximize size={15} />
          Resize
        </button>
        <button
          className="button ghost"
          disabled={
            !editable || !active || active.locked || active.kind === "group"
          }
          onClick={() => setDialog("adjust")}
        >
          <SlidersHorizontal size={15} />
          Adjust
        </button>
      </div>
      <div className="studio-body image-body">
        <nav className="image-tool-rail" aria-label="Image editing tools">
          {tools.map(({ id, label, icon: Icon }) => (
            <button
              className="icon-button"
              aria-label={label}
              title={label}
              aria-pressed={tool === id}
              key={id}
              onClick={() => setTool(id)}
            >
              <Icon size={19} strokeWidth={1.6} />
            </button>
          ))}
        </nav>
        <div
          className="image-stage"
          ref={stage}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void importImage(file);
          }}
        >
          {!doc ? (
            <Loading label="Opening image project…" />
          ) : (
            <div
              className="image-artboard transparency-grid"
              style={{ width: doc.width * zoom, height: doc.height * zoom }}
            >
              <canvas
                ref={canvas}
                aria-label="Image canvas"
                style={{ width: "100%", height: "100%" }}
              />
              <canvas
                ref={overlay}
                className="image-overlay"
                style={{
                  cursor:
                    tool === "hand"
                      ? "grab"
                      : tool === "move"
                        ? "move"
                        : "crosshair",
                  width: "100%",
                  height: "100%",
                }}
                onPointerDown={(e) =>
                  safely(() => {
                    if (e.button !== 0 || !doc || busy) return;
                    const p = point(e);
                    if (tool === "eyedropper") {
                      const pixel = canvas
                        .current!.getContext("2d")!
                        .getImageData(
                          Math.max(0, Math.min(doc.width - 1, Math.floor(p.x))),
                          Math.max(
                            0,
                            Math.min(doc.height - 1, Math.floor(p.y)),
                          ),
                          1,
                          1,
                        ).data;
                      setColor(
                        "#" +
                          [...pixel.slice(0, 3)]
                            .map((v) => v.toString(16).padStart(2, "0"))
                            .join(""),
                      );
                      return;
                    }
                    if (!editable && tool !== "hand") return;
                    if (e.altKey && ["clone", "heal"].includes(tool)) {
                      sample.current = p;
                      notify("Sample point set. Paint to apply it.");
                      return;
                    }
                    if (tool === "text") {
                      editingText.current = null;
                      pendingText.current = p;
                      setDialog("text");
                      return;
                    }
                    if (!doc.active) {
                      if (tool === "hand") return;
                      doc.addLayer();
                    }
                    const layer = doc.active!;
                    if (
                      layer.locked &&
                      ![
                        "hand",
                        "selection",
                        "ellipse-selection",
                        "lasso",
                      ].includes(tool)
                    )
                      throw new Error("Unlock this layer before editing it.");
                    if (
                      layer.kind === "group" &&
                      !tool.includes("selection") &&
                      tool !== "move" &&
                      tool !== "hand"
                    )
                      throw new Error(
                        "Choose a raster layer inside the group before painting.",
                      );
                    const local = localPoint(layer, p);
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const state = {
                      x: local.x,
                      y: local.y,
                      lastX: local.x,
                      lastY: local.y,
                      layer,
                      before: layer.canvas
                        .getContext("2d")!
                        .getImageData(
                          0,
                          0,
                          layer.canvas.width,
                          layer.canvas.height,
                        ),
                      layerX: layer.x,
                      layerY: layer.y,
                      minX: local.x - brushSize,
                      minY: local.y - brushSize,
                      maxX: local.x + brushSize,
                      maxY: local.y + brushSize,
                      points: [p],
                    };
                    pointer.current = state;
                    if (
                      ["selection", "ellipse-selection", "lasso"].includes(tool)
                    ) {
                      doc.selection = {
                        kind:
                          tool === "selection"
                            ? "rectangle"
                            : tool === "ellipse-selection"
                              ? "ellipse"
                              : "lasso",
                        points: [p, p],
                        invert: false,
                        feather,
                      };
                    } else if (tool === "clone" || tool === "heal") {
                      if (!sample.current) {
                        pointer.current = null;
                        throw new Error(
                          "Alt-click a source point before using the clone or healing brush.",
                        );
                      }
                      pointer.current.clone = imageCanvas(
                        doc.width,
                        doc.height,
                      );
                      pointer.current.clone
                        .getContext("2d")!
                        .putImageData(state.before, 0, 0);
                      stroke(p);
                    } else if (tool === "brush" || tool === "eraser")
                      stroke({ x: p.x + 0.01, y: p.y + 0.01 });
                    draw();
                  })
                }
                onPointerMove={(e) =>
                  safely(() => {
                    const p = pointer.current;
                    if (!p || !doc) return;
                    const at = point(e),
                      local = localPoint(p.layer, at);
                    if (tool === "hand") {
                      if (stage.current) {
                        stage.current.scrollLeft -= e.movementX;
                        stage.current.scrollTop -= e.movementY;
                      }
                      return;
                    }
                    if (tool === "move") {
                      p.layer.x = p.layerX + (at.x - p.points[0].x);
                      p.layer.y = p.layerY + (at.y - p.points[0].y);
                    } else if (
                      ["selection", "ellipse-selection", "lasso"].includes(tool)
                    ) {
                      if (doc.selection) {
                        if (tool === "lasso") doc.selection.points.push(at);
                        else doc.selection.points[1] = at;
                      }
                    } else if (
                      ["rectangle", "ellipse", "arrow"].includes(tool)
                    ) {
                      const ctx = p.layer.canvas.getContext("2d")!;
                      ctx.putImageData(p.before, 0, 0);
                      ctx.strokeStyle = color;
                      ctx.fillStyle = color;
                      ctx.lineWidth = brushSize;
                      ctx.globalAlpha = brushOpacity;
                      ctx.beginPath();
                      if (tool === "rectangle")
                        ctx.strokeRect(p.x, p.y, local.x - p.x, local.y - p.y);
                      else if (tool === "ellipse") {
                        ctx.ellipse(
                          (p.x + local.x) / 2,
                          (p.y + local.y) / 2,
                          Math.abs(local.x - p.x) / 2,
                          Math.abs(local.y - p.y) / 2,
                          0,
                          0,
                          Math.PI * 2,
                        );
                        ctx.stroke();
                      } else {
                        const angle = Math.atan2(local.y - p.y, local.x - p.x),
                          size = Math.max(12, brushSize * 3);
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(local.x, local.y);
                        ctx.moveTo(
                          local.x - Math.cos(angle - 0.5) * size,
                          local.y - Math.sin(angle - 0.5) * size,
                        );
                        ctx.lineTo(local.x, local.y);
                        ctx.lineTo(
                          local.x - Math.cos(angle + 0.5) * size,
                          local.y - Math.sin(angle + 0.5) * size,
                        );
                        ctx.stroke();
                      }
                      ctx.globalAlpha = 1;
                      p.minX = Math.min(p.x, local.x) - brushSize * 4;
                      p.minY = Math.min(p.y, local.y) - brushSize * 4;
                      p.maxX = Math.max(p.x, local.x) + brushSize * 4;
                      p.maxY = Math.max(p.y, local.y) + brushSize * 4;
                    } else stroke(at);
                    draw();
                  })
                }
                onPointerUp={() => safely(finish)}
                onPointerCancel={() => safely(finish)}
              />
            </div>
          )}
        </div>
        <aside className="image-layer-panel">
          <header>
            <Layers size={16} />
            <strong>Layers</strong>
            <span className="tool-spacer" />
            <button
              className="icon-button"
              title="Add layer"
              aria-label="Add layer"
              disabled={!editable}
              onClick={() => safely(() => doc?.addLayer())}
            >
              <Plus size={16} />
            </button>
            <button
              className="icon-button"
              title="Add group"
              aria-label="Add group"
              disabled={!editable}
              onClick={() =>
                safely(() => doc?.addLayer("Group", undefined, "group"))
              }
            >
              <FolderPlus size={16} />
            </button>
          </header>
          {active && (
            <div className="image-layer-properties">
              <select
                aria-label="Layer blend mode"
                value={active.blend}
                disabled={!editable}
                onChange={(e) =>
                  safely(() =>
                    doc?.updateLayer(active.id, {
                      blend: e.target.value as ImageLayer["blend"],
                    }),
                  )
                }
              >
                {blendModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode === "source-over"
                      ? "Normal"
                      : mode.replace(/-/g, " ")}
                  </option>
                ))}
              </select>
              <label>
                Opacity
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={active.opacity}
                  disabled={!editable}
                  onChange={(e) =>
                    safely(() =>
                      doc?.updateLayer(active.id, {
                        opacity: Number(e.target.value),
                      }),
                    )
                  }
                />
              </label>
            </div>
          )}
          <div className="image-layers">
            {doc &&
              [...doc.layers].reverse().map((layer) => (
                <div
                  key={layer.id}
                  className={`image-layer ${layer.id === doc.selected ? "selected" : ""}`}
                  style={{ paddingLeft: layer.parent ? 24 : 8 }}
                  draggable={editable}
                  onDragStart={(e) =>
                    e.dataTransfer.setData(
                      "application/x-axiom-layer",
                      layer.id,
                    )
                  }
                  onDragOver={(e) => {
                    if (editable) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (editable)
                      safely(() =>
                        doc.moveLayer(
                          e.dataTransfer.getData("application/x-axiom-layer"),
                          layer.id,
                        ),
                      );
                  }}
                  onClick={() => {
                    doc.select(layer.id);
                    repaint((n) => n + 1);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    doc.select(layer.id);
                    openContextMenu({
                      owner: e.currentTarget,
                      x: e.clientX,
                      y: e.clientY,
                      label: "Layer actions",
                      items: [
                        ...(layer.kind === "text"
                          ? [
                              {
                                label: "Edit text",
                                icon: "edit" as const,
                                disabled: !editable || layer.locked,
                                action: () => {
                                  editingText.current = layer.id;
                                  pendingText.current = layer.textOrigin ?? {
                                    x: 0,
                                    y: 0,
                                  };
                                  setText(layer.text ?? "");
                                  setFontSize(layer.fontSize ?? 40);
                                  setFontFamily(layer.fontFamily ?? "Inter");
                                  setColor(layer.color ?? "#202124");
                                  setDialog("text");
                                },
                              },
                            ]
                          : []),
                        {
                          label: "Duplicate layer",
                          icon: "duplicate",
                          disabled: !editable || layer.kind === "group",
                          action: () => safely(() => doc.duplicate()),
                        },
                        {
                          label: layer.locked ? "Unlock layer" : "Lock layer",
                          icon: layer.locked ? "unlock" : "lock",
                          disabled: !editable,
                          action: () =>
                            safely(() =>
                              doc.updateLayer(layer.id, {
                                locked: !layer.locked,
                              }),
                            ),
                        },
                        {
                          label: layer.mask
                            ? "Remove layer mask"
                            : "Add selection as mask",
                          icon: "image",
                          group: "mask",
                          disabled:
                            !editable || layer.kind === "group" || layer.locked,
                          action: () =>
                            safely(() =>
                              layer.mask ? doc.removeMask() : doc.addMask(),
                            ),
                        },
                        {
                          label:
                            layer.kind === "group"
                              ? "Ungroup layers"
                              : "Delete layer",
                          icon: "trash",
                          group: "danger",
                          tone: "danger",
                          disabled: !editable || layer.locked,
                          action: () => safely(() => doc.removeLayer(layer.id)),
                        },
                      ],
                    });
                  }}
                >
                  <button
                    className="icon-button"
                    aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
                    disabled={!editable}
                    onClick={(e) => {
                      e.stopPropagation();
                      safely(() =>
                        doc.updateLayer(layer.id, { visible: !layer.visible }),
                      );
                    }}
                  >
                    {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <span className="layer-thumbnail">
                    {layer.kind === "group" ? (
                      <FolderPlus size={20} />
                    ) : layer.kind === "text" ? (
                      <Type size={20} />
                    ) : (
                      <Layers size={20} />
                    )}
                  </span>
                  <span className="image-layer-name">
                    {layer.name}
                    {layer.mask && <small>Masked</small>}
                  </span>
                  {layer.locked && <Lock size={12} />}
                </div>
              ))}
          </div>
          {active && (
            <div className="image-inspector">
              <label>
                Name
                <input
                  value={active.name}
                  disabled={!editable}
                  onChange={(e) =>
                    safely(() =>
                      doc?.updateLayer(active.id, {
                        name: e.target.value.slice(0, 160),
                      }),
                    )
                  }
                />
              </label>
              <label>
                Group
                <select
                  disabled={!editable || active.kind === "group"}
                  value={active.parent ?? ""}
                  onChange={(e) =>
                    safely(() =>
                      doc?.updateLayer(active.id, {
                        parent: e.target.value || undefined,
                      }),
                    )
                  }
                >
                  <option value="">Ungrouped</option>
                  {doc?.layers
                    .filter((l) => l.kind === "group")
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="image-transform-controls">
                {[
                  [
                    "Rotate 90°",
                    RotateCw,
                    () =>
                      doc?.updateLayer(active.id, {
                        rotation: active.rotation + 90,
                      }),
                  ],
                  [
                    "Flip horizontal",
                    FlipHorizontal,
                    () =>
                      doc?.updateLayer(active.id, { scaleX: -active.scaleX }),
                  ],
                  [
                    "Flip vertical",
                    FlipVertical,
                    () =>
                      doc?.updateLayer(active.id, { scaleY: -active.scaleY }),
                  ],
                ].map(([label, Icon, run]) => {
                  const Glyph = Icon as typeof RotateCw;
                  return (
                    <button
                      className="icon-button"
                      key={String(label)}
                      aria-label={String(label)}
                      title={String(label)}
                      disabled={
                        !editable || active.locked || active.kind === "group"
                      }
                      onClick={() => safely(run as () => void)}
                    >
                      <Glyph size={16} />
                    </button>
                  );
                })}
                <button
                  className="icon-button"
                  title="Delete layer"
                  aria-label="Delete layer"
                  disabled={!editable}
                  onClick={() => safely(() => doc?.removeLayer())}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <button
                className="button secondary"
                disabled={!editable || active.locked || active.kind === "group"}
                onClick={() => safely(() => doc?.addMask())}
              >
                Selection → mask
              </button>
              <button
                className="button ghost"
                disabled={!editable}
                onClick={() => safely(() => doc?.mergeVisible())}
              >
                Merge visible layers
              </button>
            </div>
          )}
          {doc?.selection && (
            <div className="image-inspector">
              <h3>Selection</h3>
              <label>
                Feather
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={feather}
                  onChange={(e) => {
                    setFeather(Number(e.target.value));
                    doc.selection!.feather = Number(e.target.value);
                  }}
                />
              </label>
              <button
                className="button secondary"
                onClick={() => {
                  doc.selection!.invert = !doc.selection!.invert;
                  draw();
                  repaint((n) => n + 1);
                }}
              >
                Invert selection
              </button>
              <button
                className="button secondary"
                disabled={!editable || doc.selection.kind !== "rectangle"}
                onClick={() =>
                  safely(() => {
                    const [a, b] = doc.selection!.points;
                    doc.resize(
                      Math.max(1, Math.round(Math.abs(b.x - a.x))),
                      Math.max(1, Math.round(Math.abs(b.y - a.y))),
                      { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
                    );
                  })
                }
              >
                <Crop size={14} />
                Crop to selection
              </button>
              <button
                className="button ghost"
                onClick={() => {
                  doc.selection = null;
                  draw();
                  repaint((n) => n + 1);
                }}
              >
                Deselect
              </button>
            </div>
          )}
        </aside>
      </div>
      <footer className="studio-status">
        <span>{status}</span>
        <span className="tool-spacer" />
        <span>
          {doc
            ? `${doc.width} × ${doc.height} · ${doc.layers.length} layers`
            : ""}
        </span>
        <button
          className="icon-button"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => setZoom(Math.max(0.1, zoom / 1.2))}
        >
          <ZoomOut size={14} />
        </button>
        <button className="button ghost" onClick={() => setZoom(0.65)}>
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="icon-button"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => setZoom(Math.min(4, zoom * 1.2))}
        >
          <ZoomIn size={14} />
        </button>
      </footer>
      {leaving && (
        <Dialog
          title="Keep your image draft before leaving"
          onClose={() => !busy && setLeaving(null)}
        >
          <p>
            Your latest edits have not been published as a cloud version. Keep a
            recovery copy on this device before switching pages. Use Save
            version to share the changes with collaborators.
          </p>
          <ErrorNotice message={error} />
          <div className="dialog-footer">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setLeaving(null)}
            >
              Stay here
            </button>
            <button
              className="button primary"
              disabled={busy || !doc}
              onClick={() => {
                if (!doc || latest.current.busy) return;
                safely(finish);
                const proceed = leaving;
                latest.current.busy = true;
                setBusy(true);
                setError("");
                void keepDraft(doc, doc.revision, baseVersion)
                  .then((saved) => {
                    if (!saved)
                      throw new Error(
                        "The image changed while saving its draft. Please try again.",
                      );
                    setLeaving(null);
                    proceed();
                  })
                  .catch((e) =>
                    setError(
                      `Could not retain your draft: ${e.message}. Stay here and export a copy.`,
                    ),
                  )
                  .finally(() => {
                    latest.current.busy = false;
                    if (alive.current) setBusy(false);
                  });
              }}
            >
              Keep draft &amp; leave
            </button>
          </div>
        </Dialog>
      )}
      {draft && (
        <Dialog
          title="Restore local image draft?"
          onClose={() => setDraft(null)}
        >
          <p>
            A recovery draft from {new Date(draft.updatedAt).toLocaleString()}{" "}
            is available on this device.{" "}
            {draft.baseVersion !== baseVersion
              ? "The cloud version has changed; restore for review and Save copy to preserve both versions."
              : "Restore it to continue where you left off."}
          </p>
          <div className="dialog-footer">
            <button
              className="button secondary"
              onClick={() => downloadBlob(draft.blob, "recovered.axiom-image")}
            >
              Download draft
            </button>
            <button className="button secondary" onClick={() => setDraft(null)}>
              Use saved version
            </button>
            <button
              className="button primary"
              onClick={() => {
                const pending = draft;
                void pending.blob
                  .arrayBuffer()
                  .then(ImageDocument.open)
                  .then((d) => {
                    setDoc(d);
                    setSavedRevision(-1);
                    setBaseVersion(pending.baseVersion);
                    setDraft(null);
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              Restore draft
            </button>
          </div>
        </Dialog>
      )}
      {dialog && (
        <Dialog
          title={
            dialog === "export"
              ? "Export image"
              : dialog === "resize"
                ? "Resize canvas"
                : dialog === "text"
                  ? editingText.current
                    ? "Edit text layer"
                    : "Add text layer"
                  : dialog === "discussion"
                    ? "Saved-version discussion"
                    : "Image adjustments"
          }
          onClose={() => setDialog(null)}
        >
          {dialog === "discussion" ? (
            <ResourceDiscussion
              resourceId={project.resource_id}
              versionId={baseVersion}
              canComment={project.role !== "viewer"}
              kinds={["whole", "image"]}
            />
          ) : dialog === "export" ? (
            <>
              <p>
                Exports are copies. PSD export preserves common raster layers,
                masks and transforms as raster appearance; advanced Photoshop
                features are not recreated.
              </p>
              <div className="tool-export-grid">
                {["png", "jpeg", "webp", "axiom-image", "psd"].map((format) => (
                  <button
                    className="button secondary"
                    key={format}
                    disabled={busy}
                    onClick={() => {
                      if (!doc) return;
                      setBusy(true);
                      void (async () => {
                        const blob =
                          format === "axiom-image"
                            ? await doc.bundle()
                            : format === "psd"
                              ? await (
                                  await import("../../lib/tools/image-psd")
                                ).exportPsd(doc)
                              : await canvasBlob(
                                  doc.render(
                                    imageCanvas(doc.width, doc.height),
                                  ),
                                  `image/${format}`,
                                );
                        downloadBlob(
                          blob,
                          project.name.replace(/\.axiom-image$/i, "") +
                            "." +
                            format,
                        );
                      })()
                        .catch((e) => setError(e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    <Download size={15} />
                    {format.toUpperCase()}
                  </button>
                ))}
              </div>
            </>
          ) : dialog === "resize" ? (
            <div className="tool-settings-fields">
              <label>
                Width
                <input
                  type="number"
                  min={1}
                  max={8192}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                />
              </label>
              <label>
                Height
                <input
                  type="number"
                  min={1}
                  max={8192}
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                />
              </label>
              <p>
                Resampling affects all layers. This operation can be undone.
              </p>
              <button
                className="button primary"
                disabled={!editable}
                onClick={() =>
                  safely(() => {
                    doc?.resize(width, height);
                    setDialog(null);
                  })
                }
              >
                Resize image
              </button>
            </div>
          ) : dialog === "text" ? (
            <div className="tool-settings-fields">
              <label className="tool-setting-stack">
                Text
                <textarea
                  maxLength={10000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <label>
                Font
                <select
                  aria-label="Text layer font"
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                >
                  {imageFonts.map((font) => (
                    <option key={font}>{font}</option>
                  ))}
                </select>
              </label>
              <label>
                Font size
                <input
                  type="number"
                  min={8}
                  max={500}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                />
              </label>
              <button
                className="button primary"
                disabled={!editable}
                onClick={() =>
                  safely(() => {
                    if (!doc) return;
                    doc.setText(
                      doc.layers.find((l) => l.id === editingText.current),
                      text,
                      fontSize,
                      color,
                      fontFamily,
                      pendingText.current,
                    );
                    setDialog(null);
                  })
                }
              >
                {editingText.current ? "Update text" : "Add text"}
              </button>
            </div>
          ) : (
            <div className="tool-settings-fields">
              <label>
                Adjustment
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  {[
                    "brightness",
                    "contrast",
                    "exposure",
                    "saturation",
                    "levels",
                    "curves",
                    "blur",
                    "sharpen",
                    "grayscale",
                    "invert",
                  ].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label>
                Amount
                <input
                  type="range"
                  min={
                    filter === "blur" ||
                    filter === "levels" ||
                    filter === "sharpen"
                      ? 0
                      : -100
                  }
                  max={filter === "blur" ? 12 : 100}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
                <span>{amount}</span>
              </label>
              <p>
                Applies to the active layer or selection. Processing runs in a
                worker and is undoable. Curves adjusts midtone gamma; Levels
                trims black/white points.
              </p>
              <button
                className="button primary"
                disabled={!editable}
                onClick={() => {
                  if (!doc) return;
                  setBusy(true);
                  void doc
                    .filter(filter, amount)
                    .then(() => setDialog(null))
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                Apply adjustment
              </button>
            </div>
          )}
          <ErrorNotice message={error} />
        </Dialog>
      )}
    </main>
  );
}
