import {
  exportJsonCanvas,
  parseCanvas,
  type CanvasData,
} from "@axiom/shared/canvas";
import { getFontEmbedCSS } from "html-to-image";
import { store } from "./context";
import { notePath, markdownPath } from "./store";

export function portableCanvas(data: CanvasData): CanvasData {
  return {
    ...data,
    nodes: data.nodes.map((n) => {
      if (n.type !== "file" || !n.resourceId) return n;
      try {
        return { ...n, file: store.filePath(store.resource(n.resourceId)) };
      } catch {
        return n;
      }
    }),
  };
}
/** Immutable snapshots plus portable paths. Binary assets never enter editor drafts. */
export async function portableBundle(
  canvas?: CanvasData,
  canvasName = "board.canvas",
) {
  const snapshot = store.getSnapshot(),
    { default: JSZip } = await import("jszip"),
    zip = new JSZip();
  const documents = snapshot.documents.map((d) => ({ ...d })),
    assets = [...snapshot.assets];
  for (const doc of documents) {
    let source = doc.source;
    if (doc.kind === "canvas")
      source = exportJsonCanvas(portableCanvas(parseCanvas(source)));
    else if (doc.kind === "markdown")
      for (const entry of [
        ...assets.map((a) => a.path),
        ...documents.map(notePath),
      ])
        source = source
          .split(`](${markdownPath(entry)}`)
          .join(`](../../${markdownPath(entry)}`);
    zip.file(notePath(doc), source);
  }
  for (const asset of assets)
    zip.file(asset.path, await asset.blob.arrayBuffer());
  if (canvas) zip.file(canvasName, exportJsonCanvas(portableCanvas(canvas)));
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        format: "axiom-showcase-backup",
        version: 1,
        created: new Date().toISOString(),
        documents: documents.map((d) => ({
          id: d.id,
          title: d.title,
          kind: d.kind,
          ...(d.view ? { view: d.view } : {}),
          path: notePath(d),
        })),
        assets: assets.map((a) => ({
          id: a.id,
          name: a.name,
          mime: a.mime,
          path: a.path,
        })),
      },
      null,
      2,
    ),
  );
  zip.file(
    "README.txt",
    "Axiom local showcase backup\n\nOpen .md notes in a Markdown app and .canvas files in a JSON Canvas-compatible app. Keep the notes and assets folders together. Markdown image and attachment paths are relative to their note. JSON Canvas file paths are relative to the bundle root (vault).\n\nRestore this entire ZIP using Import files in the Axiom showcase. This backup has no account credentials or cloud data.\n",
  );
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 4 },
  });
}
function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
/** Freeze the reading surface; inline resolved styles and local media for offline HTML. */
export async function renderedHtml(stage: HTMLElement, title: string) {
  await document.fonts.ready;
  window.dispatchEvent(new Event("axiom:prepare-print"));
  const start = Date.now();
  while (Date.now() - start < 70000) {
    const math = stage.querySelector(
      '[data-math-request]:not([data-math-state="ready"]):not([data-math-state="error"])',
    );
    const diagrams = stage.querySelector(
      '[data-preview-state="pending"], [data-preview-state="loading"]',
    );
    const images = [...stage.querySelectorAll("img")].some(
      (img) => !img.complete,
    );
    if (!math && !diagrams && !images && Date.now() - start > 1000) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (
    stage.querySelector(
      '[data-math-request]:not([data-math-state="ready"]):not([data-math-state="error"]), [data-preview-state="pending"], [data-preview-state="loading"]',
    )
  ) {
    window.dispatchEvent(new Event("afterprint"));
    throw new Error(
      "Some previews are still loading. Wait for them to finish and retry, or export the original Markdown.",
    );
  }
  const original = stage.querySelector<HTMLElement>(".reading-view") ?? stage,
    clone = original.cloneNode(true) as HTMLElement;
  const originals = [original, ...original.querySelectorAll<HTMLElement>("*")],
    clones = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
  for (let i = 0; i < originals.length; i++) {
    const element = originals[i],
      copy = clones[i],
      computed = getComputedStyle(element);
    if (element instanceof HTMLElement && copy instanceof HTMLElement) {
      const fields = [
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "line-height",
        "color",
        "background-color",
        "display",
        "white-space",
        "text-align",
        "border-top",
        "border-bottom",
        "border-left",
        "border-right",
        "border-collapse",
        "padding",
        "margin",
        "vertical-align",
        "max-width",
        "overflow-wrap",
        "letter-spacing",
        "text-decoration",
      ];
      for (const key of fields)
        copy.style.setProperty(key, computed.getPropertyValue(key));
      copy.removeAttribute("contenteditable");
      copy.removeAttribute("tabindex");
    }
    if (
      element instanceof HTMLImageElement &&
      copy instanceof HTMLImageElement &&
      element.src.startsWith("blob:")
    ) {
      const asset = store
        .getSnapshot()
        .assets.find((a) => store.url(a) === element.src);
      if (asset) copy.src = await dataUrl(asset.blob);
    }
  }
  clone
    .querySelectorAll(
      "button, .visual-note-pin, .reading-block-actions, [data-export-exclude]",
    )
    .forEach((el) => el.remove());
  clone.removeAttribute("style");
  clone.className = "prose";
  const heading = document.createElement("span");
  heading.textContent = title;
  const fonts = await getFontEmbedCSS(original).catch(() => "");
  const color = getComputedStyle(original).color,
    background = getComputedStyle(document.documentElement).getPropertyValue(
      "--paper",
    );
  const documentStyle = getComputedStyle(original),
    family = documentStyle.fontFamily;
  // The generated page has no script, application IDs, account routes or trackers.
  window.dispatchEvent(new Event("afterprint"));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${heading.innerHTML}</title><style>${fonts}\nbody{margin:0;padding:48px 28px;background:${background};color:${color};font-family:${family}}.prose{max-width:780px;margin:0 auto;line-height:1.8}img,svg{max-width:100%;height:auto}table{width:100%;border-collapse:collapse}pre{overflow:auto}a{color:inherit}mjx-container{max-width:100%}.document-toc{padding:1em}.task-list-item{list-style:none}@media print{body{padding:0;background:white;color:#222}pre,table,figure{break-inside:avoid}a{text-decoration:none}@page{size:A4;margin:20mm}}</style></head><body>${clone.outerHTML}</body></html>`;
}
