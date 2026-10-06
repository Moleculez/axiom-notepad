import JSZip from "jszip";
import { inspectImportZip } from "./workspace-import-zip";
import { imageProjectManifest, isProjectPng } from "./research-tools";

/** The same pixel/schema contract as Image Studio, with archive preflight before
 * JSZip can sanitize paths. Runs only for explicitly declared native projects. */
export async function validateImportedImageProject(bytes: Uint8Array) {
  if (bytes.byteLength > 36_000_000)
    throw new Error("Image projects must fit the 36 MB native save limit.");
  const entries = inspectImportZip(bytes);
  if (
    entries.length > 300 ||
    entries.some((e) =>
      e.directory
        ? e.path !== "layers"
        : !/^(?:manifest\.json|preview\.png|layers\/[\da-f-]+\.png)$/.test(
            e.path,
          ),
    )
  )
    throw new Error("Image project has unsafe or excessive assets.");
  const manifestEntry = entries.find((e) => e.path === "manifest.json");
  if (!manifestEntry || manifestEntry.bytes > 1_000_000)
    throw new Error("Image manifest is missing or too large.");
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const manifest = imageProjectManifest.parse(
    JSON.parse(await zip.file("manifest.json")!.async("string")),
  );
  for (const name of new Set([
    "preview.png",
    ...manifest.layers.flatMap((layer) => [
      layer.asset,
      ...(layer.mask ? [layer.mask] : []),
    ]),
  ])) {
    const file = zip.file(name);
    if (
      !file ||
      !isProjectPng(
        await file.async("uint8array"),
        manifest.width,
        manifest.height,
      )
    )
      throw new Error(
        "Image project assets do not match its declared dimensions.",
      );
  }
  return manifest;
}
