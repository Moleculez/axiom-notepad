import JSZip from "jszip";
import {
  imageProjectManifest,
  isProjectPng,
} from "@axiom/shared/research-tools";
import {
  cropError,
  imageGeometryLimits,
  imageSizeError,
  keepsEditableText,
  type ImageSampling,
} from "./image-geometry";
export const blendModes = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export type ImageLayer = {
  id: string;
  name: string;
  kind: "raster" | "text" | "group";
  canvas: HTMLCanvasElement;
  mask?: HTMLCanvasElement;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  blend: (typeof blendModes)[number];
  visible: boolean;
  locked: boolean;
  parent?: string;
  text?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  textOrigin?: { x: number; y: number };
};
export type ImageSelection = {
  kind: "rectangle" | "ellipse" | "lasso";
  points: { x: number; y: number }[];
  invert: boolean;
  feather: number;
};
type Entry = {
  label: string;
  undo: () => void;
  redo: () => void;
  bytes: number;
};
export const imageLimits = {
  pixels: imageGeometryLimits.pixels,
  side: imageGeometryLimits.side,
  layers: 100,
  history: 128_000_000,
};
export const imageFonts = [
  "Inter",
  "Source Serif 4",
  "JetBrains Mono",
] as const;
export function imageCanvas(width: number, height: number) {
  const error = imageSizeError(width, height);
  if (error) throw new Error(error);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
export function canvasBlob(canvas: HTMLCanvasElement, type = "image/png") {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("Image could not be encoded.")),
      type,
      0.95,
    ),
  );
}
/** Canvas-local coordinates to artboard coordinates, including the parent group. */
export function layerMatrix(layer: ImageLayer, parent?: ImageLayer) {
  return new DOMMatrix()
    .translate(
      (parent?.x ?? 0) + layer.x + layer.canvas.width / 2,
      (parent?.y ?? 0) + layer.y + layer.canvas.height / 2,
    )
    .rotate(layer.rotation)
    .scale(layer.scaleX, layer.scaleY)
    .translate(-layer.canvas.width / 2, -layer.canvas.height / 2);
}
function layerData(layer: ImageLayer) {
  const { canvas: _canvas, mask: _mask, ...metadata } = layer;
  return metadata;
}
export class ImageDocument {
  width: number;
  height: number;
  layers: ImageLayer[] = [];
  selected = "";
  selection: ImageSelection | null = null;
  revision = 0;
  private past: Entry[] = [];
  private future: Entry[] = [];
  private listeners = new Set<() => void>();
  private encoded = new WeakMap<
    HTMLCanvasElement,
    Promise<{ blob: Blob; hash: string; path: string }>
  >();
  private previewCache: {
    revision: number;
    value: Promise<{ blob: Blob; hash: string; path: string }>;
  } | null = null;
  private png(canvas: HTMLCanvasElement) {
    let value = this.encoded.get(canvas);
    if (!value) {
      value = (async () => {
        const blob = await canvasBlob(canvas);
        const digest = await crypto.subtle.digest(
          "SHA-256",
          await blob.arrayBuffer(),
        );
        const hash = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        return { blob, hash, path: "layers/" + crypto.randomUUID() + ".png" };
      })();
      this.encoded.set(canvas, value);
      void value.catch(() => this.encoded.delete(canvas));
    }
    return value;
  }
  constructor(width = 1200, height = 800) {
    this.width = width;
    this.height = height;
    imageCanvas(width, height);
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  /** External canvas mutations must call changed(); owned operations invalidate
   * individual canvases and pass false to retain other layers' encodings. */
  changed(invalidatePixels = true) {
    if (invalidatePixels) {
      this.encoded = new WeakMap();
      this.previewCache = null;
    }
    this.revision++;
    this.listeners.forEach((fn) => fn());
  }
  get active() {
    return this.layers.find((l) => l.id === this.selected);
  }
  get canUndo() {
    return !!this.past.length;
  }
  get canRedo() {
    return !!this.future.length;
  }
  private remember(entry: Entry) {
    this.past.push(entry);
    this.future = [];
    let size = this.past.reduce((n, e) => n + e.bytes, 0);
    while (size > imageLimits.history && this.past.length > 1)
      size -= this.past.shift()!.bytes;
    this.changed(false);
  }
  undo() {
    const entry = this.past.pop();
    if (entry) {
      entry.undo();
      this.future.push(entry);
      this.changed(false);
    }
  }
  redo() {
    const entry = this.future.pop();
    if (entry) {
      entry.redo();
      this.past.push(entry);
      this.changed(false);
    }
  }
  select(id: string) {
    this.selected = id;
    this.listeners.forEach((fn) => fn());
  }
  addLayer(
    name = "New layer",
    source?: CanvasImageSource,
    kind: ImageLayer["kind"] = "raster",
  ) {
    if (this.layers.length >= imageLimits.layers)
      throw new Error("This project has reached its 100-layer limit.");
    // A bounded total pixel budget prevents a small PSD from allocating unlimited layers.
    if ((this.layers.length + 1) * this.width * this.height > 64_000_000)
      throw new Error(
        "The project has reached its 64 megapixel layer budget. Merge layers or reduce the image size.",
      );
    const canvas = imageCanvas(this.width, this.height);
    if (source) canvas.getContext("2d")!.drawImage(source, 0, 0);
    const layer: ImageLayer = {
      id: crypto.randomUUID(),
      name,
      kind,
      canvas,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      blend: "source-over",
      visible: true,
      locked: false,
    };
    const previous = this.selected;
    this.layers.push(layer);
    this.selected = layer.id;
    this.remember({
      label: "Add layer",
      bytes: canvas.width * canvas.height * 4,
      undo: () => {
        this.layers = this.layers.filter((l) => l !== layer);
        this.selected = previous;
      },
      redo: () => {
        this.layers.push(layer);
        this.selected = layer.id;
      },
    });
    return layer;
  }
  removeLayer(id = this.selected) {
    const index = this.layers.findIndex((l) => l.id === id),
      layer = this.layers[index];
    if (!layer || layer.locked) return;
    const children = this.layers.filter((l) => l.parent === id);
    this.layers.splice(index, 1);
    children.forEach((l) => delete l.parent);
    this.selected = this.layers[Math.max(0, index - 1)]?.id ?? "";
    this.remember({
      label: "Delete layer",
      bytes: layer.canvas.width * layer.canvas.height * 4,
      undo: () => {
        this.layers.splice(index, 0, layer);
        children.forEach((l) => (l.parent = id));
        this.selected = id;
      },
      redo: () => {
        this.layers = this.layers.filter((l) => l !== layer);
        children.forEach((l) => delete l.parent);
      },
    });
  }
  updateLayer(
    id: string,
    values: Partial<Omit<ImageLayer, "id" | "canvas" | "mask">>,
  ) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    for (const key of [
      "x",
      "y",
      "rotation",
      "scaleX",
      "scaleY",
      "opacity",
      "fontSize",
    ] as const) {
      const value = values[key];
      if (
        value !== undefined &&
        (!Number.isFinite(value) || Math.abs(value) > 1_000_000)
      )
        throw new Error("Layer properties must be finite numbers.");
    }
    if (
      [values.scaleX, values.scaleY].some(
        (v) => v !== undefined && (Math.abs(v) < 0.01 || Math.abs(v) > 64),
      )
    )
      throw new Error("Layer scale must be between 1% and 6,400%.");
    if (
      values.opacity !== undefined &&
      (values.opacity < 0 || values.opacity > 1)
    )
      throw new Error("Opacity must be between 0 and 1.");
    if (
      layer.kind === "group" &&
      (values.rotation ||
        values.scaleX !== undefined ||
        values.scaleY !== undefined)
    )
      throw new Error(
        "Transform layers inside a group individually. Group rotation and scaling are not supported yet.",
      );
    const before = layerData(layer);
    Object.assign(layer, values);
    this.remember({
      label: "Layer properties",
      bytes: 1024,
      undo: () => {
        Object.assign(layer, before);
      },
      redo: () => {
        Object.assign(layer, values);
      },
    });
  }
  moveLayer(id: string, target: string) {
    const before = [...this.layers],
      from = this.layers.findIndex((l) => l.id === id),
      to = this.layers.findIndex((l) => l.id === target);
    if (from < 0 || to < 0 || from === to) return;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(to, 0, layer);
    const after = [...this.layers];
    this.remember({
      label: "Reorder layer",
      bytes: 256,
      undo: () => {
        this.layers = [...before];
      },
      redo: () => {
        this.layers = [...after];
      },
    });
  }
  duplicate() {
    const layer = this.active;
    if (!layer) return;
    const next = this.addLayer(layer.name + " copy", layer.canvas, layer.kind);
    Object.assign(next, layerData(layer), {
      id: next.id,
      name: layer.name + " copy",
    });
    if (layer.mask) {
      next.mask = imageCanvas(layer.mask.width, layer.mask.height);
      next.mask.getContext("2d")!.drawImage(layer.mask, 0, 0);
    }
    this.changed(false);
  }
  setText(
    layer: ImageLayer | undefined,
    text: string,
    size: number,
    color: string,
    family: string,
    origin: { x: number; y: number },
  ) {
    if (
      text.length > 10000 ||
      !Number.isFinite(size) ||
      size < 8 ||
      size > 500 ||
      !imageFonts.includes(family as (typeof imageFonts)[number]) ||
      !/^#[\da-f]{6}$/i.test(color) ||
      !Number.isFinite(origin.x) ||
      !Number.isFinite(origin.y)
    )
      throw new Error(
        "Use a supported font, 8–500 px text, and a valid color.",
      );
    if (layer && (layer.kind !== "text" || layer.locked))
      throw new Error("Select an unlocked text layer.");
    const canvas = imageCanvas(this.width, this.height),
      ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.font = `${size}px "${family}"`;
    ctx.textBaseline = "top";
    text
      .split("\n")
      .forEach((line, i) =>
        ctx.fillText(line, origin.x, origin.y + i * size * 1.3),
      );
    const values = {
      canvas,
      text,
      fontSize: size,
      color,
      fontFamily: family,
      textOrigin: { ...origin },
    };
    if (!layer) {
      const created = this.addLayer(
        text.slice(0, 24) || "Text",
        canvas,
        "text",
      );
      Object.assign(created, values);
      this.listeners.forEach((fn) => fn());
      return;
    }
    const before = {
      canvas: layer.canvas,
      text: layer.text,
      fontSize: layer.fontSize,
      color: layer.color,
      fontFamily: layer.fontFamily,
      textOrigin: layer.textOrigin,
    };
    Object.assign(layer, values);
    this.remember({
      label: "Edit text",
      bytes: this.width * this.height * 8,
      undo: () => Object.assign(layer, before),
      redo: () => Object.assign(layer, values),
    });
  }
  private drawLayer(ctx: CanvasRenderingContext2D, layer: ImageLayer) {
    if (!layer.visible || layer.kind === "group") return;
    ctx.save();
    ctx.translate(layer.x, layer.y);
    ctx.translate(layer.canvas.width / 2, layer.canvas.height / 2);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.scale(layer.scaleX, layer.scaleY);
    ctx.translate(-layer.canvas.width / 2, -layer.canvas.height / 2);
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend;
    let source = layer.canvas;
    if (layer.mask) {
      source = imageCanvas(layer.canvas.width, layer.canvas.height);
      const masked = source.getContext("2d")!;
      masked.drawImage(layer.canvas, 0, 0);
      masked.globalCompositeOperation = "destination-in";
      masked.drawImage(layer.mask, 0, 0);
    }
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  }
  render(target: HTMLCanvasElement) {
    if (target.width !== this.width) target.width = this.width;
    if (target.height !== this.height) target.height = this.height;
    const ctx = target.getContext("2d")!;
    ctx.clearRect(0, 0, this.width, this.height);
    for (const layer of this.layers) {
      if (layer.parent) continue;
      if (layer.kind === "group") {
        if (!layer.visible) continue;
        const group = imageCanvas(this.width, this.height),
          g = group.getContext("2d")!;
        for (const child of this.layers.filter((l) => l.parent === layer.id))
          this.drawLayer(g, child);
        ctx.save();
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blend;
        ctx.drawImage(group, layer.x, layer.y);
        ctx.restore();
      } else this.drawLayer(ctx, layer);
    }
    return target;
  }
  selectionMask(layer?: ImageLayer): HTMLCanvasElement {
    if (layer && this.selection) {
      const local = imageCanvas(layer.canvas.width, layer.canvas.height);
      const ctx = local.getContext("2d")!;
      ctx.setTransform(
        layerMatrix(
          layer,
          this.layers.find((p) => p.id === layer.parent),
        ).inverse(),
      );
      ctx.drawImage(this.selectionMask(), 0, 0);
      return local;
    }
    const canvas = imageCanvas(this.width, this.height),
      ctx = canvas.getContext("2d")!,
      selection = this.selection;
    if (!selection) {
      ctx.fillRect(0, 0, this.width, this.height);
      return canvas;
    }
    const [a, b] = selection.points;
    if (!a || !b) return canvas;
    ctx.fillStyle = "#fff";
    if (selection.feather)
      ctx.filter = `blur(${Math.min(100, selection.feather)}px)`;
    ctx.beginPath();
    if (selection.kind === "rectangle")
      ctx.rect(
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.abs(b.x - a.x),
        Math.abs(b.y - a.y),
      );
    else if (selection.kind === "ellipse")
      ctx.ellipse(
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
        Math.abs(b.x - a.x) / 2,
        Math.abs(b.y - a.y) / 2,
        0,
        0,
        2 * Math.PI,
      );
    else {
      ctx.moveTo(a.x, a.y);
      for (const p of selection.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
    }
    ctx.fill();
    if (selection.invert) {
      const inverted = imageCanvas(this.width, this.height),
        ic = inverted.getContext("2d")!;
      ic.fillRect(0, 0, this.width, this.height);
      ic.globalCompositeOperation = "destination-out";
      ic.drawImage(canvas, 0, 0);
      return inverted;
    }
    return canvas;
  }
  addMask() {
    const layer = this.active;
    if (!layer || layer.locked || layer.kind === "group") return;
    const before = layer.mask,
      after = this.selectionMask(layer);
    layer.mask = after;
    this.remember({
      label: "Layer mask",
      bytes: this.width * this.height * 4,
      undo: () => {
        layer.mask = before;
      },
      redo: () => {
        layer.mask = after;
      },
    });
  }
  removeMask() {
    const layer = this.active;
    if (!layer?.mask || layer.locked) return;
    const before = layer.mask;
    delete layer.mask;
    this.remember({
      label: "Remove mask",
      bytes: this.width * this.height * 4,
      undo: () => {
        layer.mask = before;
      },
      redo: () => {
        delete layer.mask;
      },
    });
  }
  commitPixels(
    layer: ImageLayer,
    before: ImageData,
    box: { x: number; y: number; width: number; height: number },
    label = "Paint",
  ) {
    const x = Math.max(0, Math.floor(box.x)),
      y = Math.max(0, Math.floor(box.y)),
      w = Math.min(layer.canvas.width - x, Math.ceil(box.width + 2)),
      h = Math.min(layer.canvas.height - y, Math.ceil(box.height + 2));
    if (w <= 0 || h <= 0) return;
    const clipped = new ImageData(w, h);
    for (let row = 0; row < h; row++)
      clipped.data.set(
        before.data.subarray(
          ((row + y) * before.width + x) * 4,
          ((row + y) * before.width + x + w) * 4,
        ),
        row * w * 4,
      );
    const ctx = layer.canvas.getContext("2d")!,
      after = ctx.getImageData(x, y, w, h);
    this.encoded.delete(layer.canvas);
    this.remember({
      label,
      bytes: w * h * 8,
      undo: () => {
        ctx.putImageData(clipped, x, y);
        this.encoded.delete(layer.canvas);
      },
      redo: () => {
        ctx.putImageData(after, x, y);
        this.encoded.delete(layer.canvas);
      },
    });
  }
  async filter(filter: string, amount: number) {
    const layer = this.active;
    if (!layer || layer.locked || layer.kind === "group") return;
    const revision = this.revision,
      ctx = layer.canvas.getContext("2d")!,
      before = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height),
      input = new ImageData(
        new Uint8ClampedArray(before.data),
        before.width,
        before.height,
      );
    const worker = new Worker(new URL("./image.worker.ts", import.meta.url), {
      type: "module",
    });
    try {
      const output = await new Promise<ImageData>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Filter exceeded its processing time limit."));
          worker.terminate();
        }, 20000);
        worker.onmessage = (e) => {
          clearTimeout(timeout);
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data.image);
        };
        worker.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Image processing failed."));
        };
        worker.postMessage({ image: input, filter, amount }, [
          input.data.buffer,
        ]);
      });
      if (this.revision !== revision)
        throw new Error(
          "The image changed during processing. Reapply the filter to the current version.",
        );
      if (this.selection) {
        const mask = this.selectionMask(layer)
          .getContext("2d")!
          .getImageData(0, 0, layer.canvas.width, layer.canvas.height).data;
        for (let i = 0; i < output.data.length; i += 4) {
          const alpha = mask[i + 3] / 255;
          for (let c = 0; c < 4; c++)
            output.data[i + c] =
              before.data[i + c] * (1 - alpha) + output.data[i + c] * alpha;
        }
      }
      ctx.putImageData(output, 0, 0);
      this.commitPixels(
        layer,
        before,
        { x: 0, y: 0, width: before.width, height: before.height },
        filter,
      );
    } finally {
      worker.terminate();
    }
  }
  resize(
    width: number,
    height: number,
    crop?: { x: number; y: number },
    sampling: ImageSampling = "smooth",
  ) {
    const error =
      imageSizeError(width, height, this.layers.length) ||
      (crop ? cropError({ ...crop, width, height }, this) : "");
    if (error) throw new Error(error);
    if (
      width === this.width &&
      height === this.height &&
      (!crop || (!crop.x && !crop.y))
    )
      return;
    const snapshot = () => ({
      width: this.width,
      height: this.height,
      selection: this.selection ? structuredClone(this.selection) : null,
      canvases: this.layers.map((layer) => ({ layer, values: { ...layer } })),
    });
    const old = snapshot(),
      sx = crop ? 1 : width / this.width,
      sy = crop ? 1 : height / this.height;
    const output = new DOMMatrix()
      .scale(sx, sy)
      .translate(-(crop?.x ?? 0), -(crop?.y ?? 0));
    // Prepare every replacement before mutation. A failed allocation must never
    // leave only some layers resized. Bake in document coordinates so a rotated,
    // moved or grouped layer does not jump when its canvas center changes.
    const canvases = this.layers.map((layer) => {
      const parent = this.layers.find((p) => p.id === layer.parent);
      const matrix = output.multiply(layerMatrix(layer, parent));
      const resample = (source: HTMLCanvasElement) => {
        // Render geometry at its original resolution first, using exactly the
        // same transform sequence as the artboard. Composing rotation into the
        // resize matrix otherwise changes edge coverage in some canvas engines.
        const projected = imageCanvas(old.width, old.height);
        this.drawLayer(projected.getContext("2d")!, {
          ...layer,
          canvas: source,
          mask: undefined,
          visible: true,
          opacity: 1,
          blend: "source-over",
        });
        const result = imageCanvas(width, height),
          ctx = result.getContext("2d")!;
        ctx.imageSmoothingEnabled = sampling === "smooth";
        ctx.imageSmoothingQuality = "high";
        ctx.setTransform(output);
        ctx.drawImage(projected, parent?.x ?? 0, parent?.y ?? 0);
        return result;
      };
      const values: ImageLayer = {
        ...layer,
        canvas: resample(layer.canvas),
        mask: layer.mask ? resample(layer.mask) : undefined,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      };
      if (layer.kind === "text") {
        if (keepsEditableText(layer, sx, sy)) {
          const origin = new DOMPoint(
            layer.textOrigin?.x ?? 0,
            layer.textOrigin?.y ?? 0,
          ).matrixTransform(matrix);
          values.textOrigin = { x: origin.x, y: origin.y };
          values.fontSize = (layer.fontSize ?? 40) * sy;
        } else {
          // The dialog warns before applying this conversion; Undo restores the
          // complete editable text record, not just its flattened appearance.
          values.kind = "raster";
          values.text = values.fontFamily = values.color = undefined;
          values.textOrigin = values.fontSize = undefined;
        }
      }
      return { layer, values };
    });
    const after = { width, height, selection: null, canvases };
    const apply = (s: typeof old) => {
      this.width = s.width;
      this.height = s.height;
      this.selection = s.selection ? structuredClone(s.selection) : null;
      s.canvases.forEach(({ layer, values }) => Object.assign(layer, values));
    };
    apply(after);
    this.remember({
      label: crop ? "Crop image" : "Resize image",
      bytes:
        (old.width * old.height + width * height) *
        this.layers.reduce((n, l) => n + (l.mask ? 2 : 1), 0) *
        4,
      undo: () => apply(old),
      redo: () => apply(after),
    });
  }
  mergeVisible() {
    const canvas = this.render(imageCanvas(this.width, this.height)),
      before = [...this.layers];
    const layer: ImageLayer = {
      id: crypto.randomUUID(),
      name: "Merged visible",
      kind: "raster",
      canvas,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      blend: "source-over",
      visible: true,
      locked: false,
    };
    // Keep hidden groups and their children intact. Hidden children of a merged
    // visible group become independent layers; never leave a dangling parent.
    const hiddenGroups = new Set(
      this.layers
        .filter((l) => l.kind === "group" && !l.visible)
        .map((l) => l.id),
    );
    const remaining = this.layers.filter(
      (l) => !l.visible || (l.parent && hiddenGroups.has(l.parent)),
    );
    const parents = new Map(remaining.map((l) => [l, l.parent]));
    remaining.forEach((l) => {
      if (l.parent && !hiddenGroups.has(l.parent)) delete l.parent;
    });
    this.layers = [...remaining, layer];
    const after = [...this.layers];
    this.selected = layer.id;
    this.remember({
      label: "Merge visible",
      bytes: this.width * this.height * 4,
      undo: () => {
        this.layers = before;
        parents.forEach((parent, l) => {
          l.parent = parent;
        });
      },
      redo: () => {
        this.layers = after;
        remaining.forEach((l) => {
          if (l.parent && !hiddenGroups.has(l.parent)) delete l.parent;
        });
      },
    });
  }
  async snapshot() {
    const revision = this.revision,
      assets: { blob: Blob; hash: string; path: string }[] = [],
      layers = [];
    for (const layer of this.layers) {
      const asset = await this.png(layer.canvas),
        mask = layer.mask ? await this.png(layer.mask) : undefined;
      assets.push(asset);
      if (mask) assets.push(mask);
      layers.push({ ...layerData(layer), asset: asset.path, mask: mask?.path });
    }
    if (this.previewCache?.revision !== revision)
      this.previewCache = {
        revision,
        value: this.png(this.render(imageCanvas(this.width, this.height))),
      };
    const pendingPreview = this.previewCache;
    const preview = await pendingPreview.value.catch((error) => {
      if (this.previewCache === pendingPreview) this.previewCache = null;
      throw error;
    });
    if (this.revision !== revision)
      throw new Error(
        "Image changed while preparing its draft. The next completed operation will be saved.",
      );
    return {
      revision,
      project: imageProjectManifest.parse({
        format: "axiom-image",
        version: 1,
        width: this.width,
        height: this.height,
        layers,
      }),
      assets,
      preview,
    };
  }
  async bundle() {
    const snapshot = await this.snapshot(),
      zip = new JSZip();
    for (const asset of snapshot.assets)
      zip.file(asset.path, await asset.blob.arrayBuffer());
    zip.file("preview.png", await snapshot.preview.blob.arrayBuffer());
    zip.file("manifest.json", JSON.stringify(snapshot.project));
    return zip.generateAsync({
      type: "blob",
      compression: "STORE",
      mimeType: "application/vnd.axiom.image+zip",
    });
  }
  static async open(data: ArrayBuffer) {
    if (data.byteLength > 36_000_000)
      throw new Error("Project exceeds the 36 MB opening limit.");
    const zip = await JSZip.loadAsync(data),
      raw = zip.file("manifest.json");
    if (!raw) throw new Error("This is not an Axiom image project.");
    let expanded = 0;
    for (const file of Object.values(zip.files)) {
      expanded +=
        (file as typeof file & { _data?: { uncompressedSize: number } })._data
          ?.uncompressedSize ?? 0;
      if (expanded > 200_000_000)
        throw new Error("Project expansion exceeds the safe limit.");
    }
    const m = imageProjectManifest.parse(JSON.parse(await raw.async("string")));
    if (
      m.format !== "axiom-image" ||
      m.version !== 1 ||
      !Array.isArray(m.layers) ||
      m.layers.length > imageLimits.layers
    )
      throw new Error("Unsupported image project version.");
    const doc = new ImageDocument(m.width, m.height);
    if (m.layers.length * m.width * m.height > 64_000_000)
      throw new Error("Project exceeds the total layer pixel budget.");
    for (const value of m.layers) {
      if (
        !/^[\da-f-]{36}$/.test(value.id) ||
        !/^layers\/[\da-f-]+\.png$/.test(value.asset) ||
        !zip.file(value.asset)
      )
        throw new Error("Invalid layer asset.");
      const pixels = await zip.file(value.asset)!.async("arraybuffer");
      if (!isProjectPng(new Uint8Array(pixels), m.width, m.height))
        throw new Error("Layer PNG dimensions do not match the project.");
      const image = await createImageBitmap(new Blob([pixels]));
      if (image.width !== m.width || image.height !== m.height) {
        image.close();
        throw new Error("Layer dimensions do not match the project.");
      }
      const layer = doc.addLayer(
        String(value.name).slice(0, 160),
        image,
        ["raster", "text", "group"].includes(value.kind)
          ? value.kind
          : "raster",
      );
      image.close();
      for (const field of [
        "x",
        "y",
        "rotation",
        "scaleX",
        "scaleY",
        "opacity",
      ] as const)
        if (
          typeof value[field] !== "number" ||
          !Number.isFinite(value[field]) ||
          Math.abs(value[field]) > 1_000_000
        )
          throw new Error("Invalid layer geometry.");
      Object.assign(layer, {
        id: value.id,
        name: String(value.name).slice(0, 160),
        x: value.x,
        y: value.y,
        rotation: value.rotation,
        scaleX: value.scaleX,
        scaleY: value.scaleY,
        opacity: Math.max(0, Math.min(1, value.opacity)),
        blend: blendModes.includes(value.blend) ? value.blend : "source-over",
        visible: value.visible !== false,
        locked: !!value.locked,
        parent: typeof value.parent === "string" ? value.parent : undefined,
        text:
          typeof value.text === "string"
            ? value.text.slice(0, 10000)
            : undefined,
        fontSize:
          typeof value.fontSize === "number" &&
          value.fontSize >= 8 &&
          value.fontSize <= 500
            ? value.fontSize
            : 40,
        fontFamily:
          value.fontFamily && imageFonts.includes(value.fontFamily)
            ? value.fontFamily
            : "Inter",
        color:
          typeof value.color === "string" && /^#[\da-f]{6}$/i.test(value.color)
            ? value.color
            : "#202124",
        textOrigin:
          value.textOrigin &&
          Number.isFinite(value.textOrigin.x) &&
          Number.isFinite(value.textOrigin.y)
            ? { x: value.textOrigin.x, y: value.textOrigin.y }
            : { x: 0, y: 0 },
      });
      if (
        Math.abs(layer.scaleX) < 0.01 ||
        Math.abs(layer.scaleY) < 0.01 ||
        Math.abs(layer.scaleX) > 64 ||
        Math.abs(layer.scaleY) > 64
      )
        throw new Error("Unsupported layer scale.");
      if (value.mask) {
        if (
          !/^layers\/[\da-f-]+\.png$/.test(value.mask) ||
          !zip.file(value.mask)
        )
          throw new Error("Missing layer mask.");
        const maskBytes = await zip.file(value.mask)!.async("arraybuffer");
        if (!isProjectPng(new Uint8Array(maskBytes), m.width, m.height))
          throw new Error("Mask PNG dimensions do not match the project.");
        const mask = await createImageBitmap(new Blob([maskBytes]));
        if (mask.width !== m.width || mask.height !== m.height) {
          mask.close();
          throw new Error("Mask dimensions do not match the project.");
        }
        layer.mask = imageCanvas(m.width, m.height);
        layer.mask.getContext("2d")!.drawImage(mask, 0, 0);
        mask.close();
      }
    }
    const ids = new Set(doc.layers.map((l) => l.id));
    if (ids.size !== doc.layers.length) throw new Error("Duplicate layer IDs.");
    for (const l of doc.layers)
      if (
        l.parent &&
        !doc.layers.some(
          (p) =>
            p.id === l.parent &&
            p.kind === "group" &&
            !p.parent &&
            p.id !== l.id,
        )
      )
        delete l.parent;
    doc.selected = doc.layers.at(-1)?.id ?? "";
    doc.past = [];
    doc.future = [];
    doc.revision = 0;
    return doc;
  }
}
