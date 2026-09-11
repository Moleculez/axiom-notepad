import { randomUUID } from "node:crypto";
import sharp from "sharp";
import JSZip from "jszip";
import { imageProjectManifest } from "./research-tools";
/** A new drawing is immediately a valid, downloadable layered document. */
export async function blankImageProject() {
  const width = 1200,
    height = 800,
    id = randomUUID();
  const preview = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  const asset = `layers/${id}.png`,
    zip = new JSZip();
  const manifest = imageProjectManifest.parse({
    format: "axiom-image",
    version: 1,
    width,
    height,
    layers: [
      {
        id,
        name: "Layer 1",
        kind: "raster",
        asset,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        visible: true,
        locked: false,
        blend: "source-over",
      },
    ],
  });
  zip.file("manifest.json", JSON.stringify(manifest));
  zip.file(asset, preview);
  zip.file("preview.png", preview);
  return {
    data: await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    }),
    preview,
  };
}
