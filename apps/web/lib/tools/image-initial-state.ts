import type { ImageDocument } from "./image-engine";

/** Match the generated starter in shared/blank-image, never just an empty-looking figure. */
export function isInitialImageTemplate(doc: ImageDocument) {
  if (doc.width !== 1200 || doc.height !== 800 || doc.layers.length !== 1)
    return false;
  const layer = doc.layers[0];
  if (
    layer.name !== "Layer 1" ||
    layer.kind !== "raster" ||
    layer.parent ||
    layer.mask ||
    layer.x !== 0 ||
    layer.y !== 0 ||
    layer.rotation !== 0 ||
    layer.scaleX !== 1 ||
    layer.scaleY !== 1 ||
    layer.opacity !== 1 ||
    !layer.visible ||
    layer.locked ||
    layer.blend !== "source-over" ||
    layer.canvas.width !== doc.width ||
    layer.canvas.height !== doc.height
  )
    return false;
  const pixels = layer.canvas
    .getContext("2d")!
    .getImageData(0, 0, doc.width, doc.height).data;
  for (let offset = 0; offset < pixels.length; offset++)
    if (pixels[offset] !== 0) return false;
  return true;
}

/** Immutable history distinguishes a starter from a deliberately saved blank canvas. */
export function isInitialImageVersion(
  current: string,
  versions: readonly { id: string; ordinal: number }[],
) {
  return (
    versions.length === 1 &&
    versions[0].id === current &&
    versions[0].ordinal === 1
  );
}
