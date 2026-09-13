export type ImageSize = { width: number; height: number };
export type CropRect = ImageSize & { x: number; y: number };
export type CropHandle = "move" | "nw" | "ne" | "sw" | "se";
export type ImageSampling = "smooth" | "pixelated";
export const imageGeometryLimits = {
  side: 8192,
  pixels: 16_000_000,
  layerPixels: 64_000_000,
};

export function imageSizeError(width: number, height: number, layers = 1) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > imageGeometryLimits.side ||
    height > imageGeometryLimits.side ||
    width * height > imageGeometryLimits.pixels
  )
    return "Use whole-pixel dimensions within 8,192 px per side and 16 megapixels.";
  if (width * height * layers > imageGeometryLimits.layerPixels)
    return "These dimensions exceed the project's 64 megapixel layer budget.";
  return "";
}
export function cropError(rect: CropRect, size: ImageSize) {
  return (
    imageSizeError(rect.width, rect.height) ||
    (!Number.isInteger(rect.x) ||
    !Number.isInteger(rect.y) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > size.width ||
    rect.y + rect.height > size.height
      ? "Keep the crop within the image boundaries."
      : "")
  );
}
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export function cropFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
  size: ImageSize,
): CropRect {
  const x = clamp(Math.round(Math.min(a.x, b.x)), 0, size.width - 1);
  const y = clamp(Math.round(Math.min(a.y, b.y)), 0, size.height - 1);
  return {
    x,
    y,
    width: clamp(Math.round(Math.max(a.x, b.x)) - x, 1, size.width - x),
    height: clamp(Math.round(Math.max(a.y, b.y)) - y, 1, size.height - y),
  };
}
/** Largest centered rectangle of the requested ratio inside the current crop. */
export function cropWithRatio(rect: CropRect, ratio: number | null): CropRect {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return { ...rect };
  const width = Math.max(
    1,
    Math.min(rect.width, Math.round(rect.height * ratio)),
  );
  const height = Math.max(1, Math.min(rect.height, Math.round(width / ratio)));
  return {
    x: rect.x + Math.floor((rect.width - width) / 2),
    y: rect.y + Math.floor((rect.height - height) / 2),
    width,
    height,
  };
}
/** Corner drags anchor the opposite corner; moving never resizes the crop. */
export function dragCrop(
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  size: ImageSize,
  ratio: number | null,
): CropRect {
  if (handle === "move")
    return {
      ...rect,
      x: clamp(Math.round(rect.x + dx), 0, size.width - rect.width),
      y: clamp(Math.round(rect.y + dy), 0, size.height - rect.height),
    };
  const west = handle.includes("w"),
    north = handle.includes("n");
  const anchor = {
    x: west ? rect.x + rect.width : rect.x,
    y: north ? rect.y + rect.height : rect.y,
  };
  const maxWidth = west ? anchor.x : size.width - anchor.x;
  const maxHeight = north ? anchor.y : size.height - anchor.y;
  let width = clamp(Math.round(rect.width + (west ? -dx : dx)), 1, maxWidth);
  let height = clamp(
    Math.round(rect.height + (north ? -dy : dy)),
    1,
    maxHeight,
  );
  if (ratio && Number.isFinite(ratio) && ratio > 0) {
    if (Math.abs(dx) >= Math.abs(dy * ratio))
      height = Math.max(1, Math.round(width / ratio));
    else width = Math.max(1, Math.round(height * ratio));
    if (width > maxWidth) {
      width = maxWidth;
      height = Math.max(1, Math.round(width / ratio));
    }
    if (height > maxHeight) {
      height = maxHeight;
      width = Math.max(1, Math.round(height * ratio));
    }
    width = clamp(width, 1, maxWidth);
    height = clamp(height, 1, maxHeight);
  }
  return {
    x: west ? anchor.x - width : anchor.x,
    y: north ? anchor.y - height : anchor.y,
    width,
    height,
  };
}
export function proportionalSize(
  size: ImageSize,
  axis: "width" | "height",
  value: number,
): ImageSize {
  return axis === "width"
    ? {
        width: value,
        height: Math.max(1, Math.round((value * size.height) / size.width)),
      }
    : {
        width: Math.max(1, Math.round((value * size.width) / size.height)),
        height: value,
      };
}

/** A baked affine transform cannot be represented by our simple editable text model. */
export function keepsEditableText(
  layer: {
    rotation: number;
    scaleX: number;
    scaleY: number;
    fontSize?: number;
  },
  sx: number,
  sy: number,
) {
  const fontSize = (layer.fontSize ?? 40) * sy;
  return (
    Math.abs(sx - sy) < 0.000001 &&
    layer.rotation === 0 &&
    layer.scaleX === 1 &&
    layer.scaleY === 1 &&
    fontSize >= 8 &&
    fontSize <= 500
  );
}
