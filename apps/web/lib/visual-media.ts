import { safeUrl } from "@axiom/markdown";
import { diagramColors, renderDiagram } from "./editor-vnext/diagrams";
import {
  visualDigest,
  visualIdentity,
  type VisualAsset,
} from "./visual-assets";
import type {
  VisualSource,
  VisualShape,
} from "@axiom/shared/visual-annotations";
import type { MetadataField } from "./visual-metadata.worker";
export type VisualMedia = {
  url: string;
  image: HTMLImageElement;
  width: number;
  height: number;
  blob?: Blob;
  svg?: string;
  identity: VisualSource;
  notice: string;
  dispose: () => void;
};
export const visualPixelLimit = 16_000_000;
const byteLimit = 50 * 1024 * 1024;
class UnavailableImage extends Error {}
export async function imageBytes(
  url: string,
  signal: AbortSignal,
): Promise<Blob> {
  const address = new URL(url, location.href);
  if (!safeUrl(address.href, true))
    throw new Error("This image address is blocked.");
  const response = await fetch(address, {
    signal,
    mode: "cors",
    credentials: address.origin === location.origin ? "same-origin" : "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok)
    throw new UnavailableImage(
      response.status === 403 || response.status === 404
        ? "Image unavailable or access changed."
        : "Image bytes are unavailable.",
    );
  if (Number(response.headers.get("content-length")) > byteLimit)
    throw new Error(
      "Byte inspection is limited to 50 MB. Viewing remains available.",
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Image bytes are unavailable.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > byteLimit) {
        await reader.cancel();
        throw new Error(
          "Byte inspection is limited to 50 MB. Viewing remains available.",
        );
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, {
    type:
      response.headers.get("content-type")?.split(";")[0] ??
      "application/octet-stream",
  });
}
function decode(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.draggable = false;
    img.referrerPolicy = "no-referrer";
    const cancel = () => {
      img.src = "";
      reject(new DOMException("Aborted", "AbortError"));
    };
    const done = () => {
      signal.removeEventListener("abort", cancel);
      img.onload = null;
      img.onerror = null;
    };
    signal.addEventListener("abort", cancel, { once: true });
    img.onload = () => {
      done();
      resolve(img);
    };
    img.onerror = () => {
      done();
      reject(
        new Error(
          "The browser cannot decode this image. Download the original to open it elsewhere.",
        ),
      );
    };
    if (signal.aborted) {
      done();
      cancel();
    } else img.src = url;
  });
}
/** External SVG is displayed only as an image. Never inject its DOM into the app. */
export async function loadVisualMedia(
  asset: VisualAsset,
  root: HTMLElement,
  signal: AbortSignal,
): Promise<VisualMedia> {
  let blob: Blob | undefined,
    svg: string | undefined,
    url = asset.url ?? "",
    notice = "",
    fingerprint = asset.fingerprint ?? "",
    verified = false;
  if (asset.kind === "mermaid") {
    svg =
      asset.svg ??
      (await renderDiagram(asset.source ?? "", diagramColors(root))).svg;
    const xml = new DOMParser().parseFromString(svg, "image/svg+xml"),
      element = xml.documentElement;
    const box = element
      .getAttribute("viewBox")
      ?.trim()
      .split(/[ ,]+/)
      .map(Number);
    if (box?.length === 4 && box.every(Number.isFinite)) {
      element.setAttribute("width", String(box[2]));
      element.setAttribute("height", String(box[3]));
    }
    element.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg = new XMLSerializer().serializeToString(element);
    blob = new Blob([svg], { type: "image/svg+xml" });
    fingerprint = await visualDigest(asset.source ?? "");
    verified = true;
    if (asset.state === "stale")
      notice =
        "Last valid diagram preview. The current source has a syntax error.";
  } else {
    if (!safeUrl(url, true)) throw new Error("This image address is blocked.");
    try {
      blob = await imageBytes(url, signal);
      fingerprint = await visualDigest(await blob.arrayBuffer());
      verified = true;
    } catch (e) {
      if (signal.aborted || e instanceof UnavailableImage) throw e;
      notice =
        "Remote/limited preview · metadata, pixel inspection and image export may be unavailable. The remote content cannot be verified.";
      fingerprint = await visualDigest(url);
    }
  }
  signal.throwIfAborted();
  if (blob) url = URL.createObjectURL(blob);
  try {
    const image = await decode(url, signal);
    signal.throwIfAborted();
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (!width || !height || width > 1_000_000 || height > 1_000_000)
      throw new Error("The image has no usable dimensions.");
    return {
      url,
      image,
      width,
      height,
      blob,
      svg,
      identity: visualIdentity(asset, width, height, fingerprint, verified),
      notice,
      dispose: () => {
        if (blob) URL.revokeObjectURL(url);
        image.src = "";
      },
    };
  } catch (e) {
    if (blob) URL.revokeObjectURL(url);
    throw e;
  }
}
export function readVisualMetadata(
  blob: Blob,
  signal: AbortSignal,
): Promise<MetadataField[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./visual-metadata.worker.ts", import.meta.url),
      { type: "module" },
    );
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("Metadata inspection exceeded its time limit."));
    }, 8000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (
      e: MessageEvent<{ fields?: MetadataField[]; error?: string }>,
    ) => {
      finish();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.fields ?? []);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("Metadata worker could not load."));
    };
    void blob
      .arrayBuffer()
      .then((buffer) => {
        if (signal.aborted) abort();
        else worker.postMessage(buffer, [buffer]);
      })
      .catch((e) => {
        finish();
        reject(e);
      });
  });
}
export function visualCanvas(media: VisualMedia, scale = 1): HTMLCanvasElement {
  const w = Math.round(media.width * scale),
    h = Math.round(media.height * scale);
  if (w < 1 || h < 1 || w > 8192 || h > 8192 || w * h > visualPixelLimit)
    throw new Error(
      "Pixel analysis and exports are limited to 16 megapixels and 8,192 pixels per side. Choose a smaller export scale.",
    );
  if (!media.blob)
    throw new Error(
      "This remote image does not allow pixel access. Import an authorized copy first.",
    );
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas
    .getContext("2d", { willReadFrequently: true })!
    .drawImage(media.image, 0, 0, w, h);
  return canvas;
}
export function drawVisualShape(
  ctx: CanvasRenderingContext2D,
  shape: VisualShape,
  w: number,
  h: number,
) {
  const points = shape.points.map(([x, y]) => [x * w, y * h]),
    a = points[0],
    b = points.at(-1)!;
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.stroke * Math.max(1, Math.min(w, h) / 600);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (shape.kind === "rectangle")
    ctx.rect(
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.abs(b[0] - a[0]),
      Math.abs(b[1] - a[1]),
    );
  else if (shape.kind === "ellipse")
    ctx.ellipse(
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      Math.abs(b[0] - a[0]) / 2,
      Math.abs(b[1] - a[1]) / 2,
      0,
      0,
      2 * Math.PI,
    );
  else if (shape.kind === "pin") {
    ctx.arc(a[0], a[1], ctx.lineWidth * 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape.kind === "label") {
    ctx.font = `${Math.max(14, Math.min(w, h) / 35)}px sans-serif`;
    ctx.fillText(shape.text || "Label", a[0], a[1]);
  } else {
    ctx.moveTo(...(a as [number, number]));
    for (const p of points.slice(1)) ctx.lineTo(...(p as [number, number]));
    if (shape.kind === "arrow") {
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]),
        size = ctx.lineWidth * 5;
      for (const d of [-0.5, 0.5]) {
        ctx.moveTo(b[0], b[1]);
        ctx.lineTo(
          b[0] - size * Math.cos(angle + d),
          b[1] - size * Math.sin(angle + d),
        );
      }
    }
  }
  ctx.stroke();
}
export async function exportVisual(
  media: VisualMedia,
  format: "png" | "jpeg" | "webp" | "svg",
  scale: number,
  background: string | undefined,
  shapes: VisualShape[],
): Promise<Blob> {
  if (!Number.isFinite(scale) || scale < 0.01 || scale > 16)
    throw new Error("Choose an export scale between 0.01 and 16.");
  if (format === "svg") {
    if (!media.svg)
      throw new Error(
        "SVG export is available for Mermaid diagrams. Download an original SVG image unchanged instead.",
      );
    const xml = new DOMParser().parseFromString(media.svg, "image/svg+xml"),
      root = xml.documentElement;
    const box = root.getAttribute("viewBox")!.trim().split(/[ ,]+/).map(Number);
    const node = (tag: string, attributes: Record<string, string | number>) => {
      const element = xml.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [key, value] of Object.entries(attributes))
        element.setAttribute(key, String(value));
      return element;
    };
    root.setAttribute("width", String(media.width * scale));
    root.setAttribute("height", String(media.height * scale));
    if (background)
      root.insertBefore(
        node("rect", {
          x: box[0],
          y: box[1],
          width: box[2],
          height: box[3],
          fill: background,
        }),
        root.firstChild,
      );
    const layer = node("g", {
      "data-axiom-markup": "true",
      transform: `translate(${box[0]} ${box[1]})`,
      "font-family": "sans-serif",
    });
    for (const shape of shapes) {
      const points = shape.points.map(([x, y]) => [x * box[2], y * box[3]]),
        a = points[0],
        b = points.at(-1)!;
      const stroke = shape.stroke * Math.max(1, Math.min(box[2], box[3]) / 600);
      const group = node("g", {
        stroke: shape.color,
        "stroke-width": stroke,
        fill: "none",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });
      let element: Element;
      if (shape.kind === "rectangle")
        element = node("rect", {
          x: Math.min(a[0], b[0]),
          y: Math.min(a[1], b[1]),
          width: Math.abs(b[0] - a[0]),
          height: Math.abs(b[1] - a[1]),
        });
      else if (shape.kind === "ellipse")
        element = node("ellipse", {
          cx: (a[0] + b[0]) / 2,
          cy: (a[1] + b[1]) / 2,
          rx: Math.abs(b[0] - a[0]) / 2,
          ry: Math.abs(b[1] - a[1]) / 2,
        });
      else if (shape.kind === "pin")
        element = node("circle", {
          cx: a[0],
          cy: a[1],
          r: stroke * 3,
          fill: shape.color,
        });
      else if (shape.kind === "label") {
        element = node("text", {
          x: a[0],
          y: a[1],
          fill: shape.color,
          stroke: "none",
          "font-size": Math.max(14, Math.min(box[2], box[3]) / 35),
        });
        element.textContent = shape.text || "Label";
      } else {
        let d = points
          .map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`)
          .join(" ");
        if (shape.kind === "arrow") {
          const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
          d += [-0.5, 0.5]
            .map(
              (v) =>
                ` M${b[0]} ${b[1]} L${b[0] - stroke * 5 * Math.cos(angle + v)} ${b[1] - stroke * 5 * Math.sin(angle + v)}`,
            )
            .join("");
        }
        element = node("path", { d });
      }
      group.append(element);
      layer.append(group);
    }
    if (shapes.length) root.append(layer);
    return new Blob([new XMLSerializer().serializeToString(root)], {
      type: "image/svg+xml",
    });
  }
  const canvas = visualCanvas(media, scale),
    ctx = canvas.getContext("2d")!;
  if (background || format === "jpeg") {
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = background ?? "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.save();
  ctx.scale(canvas.width / media.width, canvas.height / media.height);
  shapes.forEach((shape) =>
    drawVisualShape(ctx, shape, media.width, media.height),
  );
  ctx.restore();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob && blob.type === `image/${format}`
          ? resolve(blob)
          : reject(
              new Error(
                "This browser does not support that image export format.",
              ),
            ),
      `image/${format}`,
      0.94,
    ),
  );
}
export function downloadVisual(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
