import type { DocumentExportResult } from "@axiom/shared/document-export";
import { renderDiagram } from "./editor-vnext/diagrams";

export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  milliseconds = 30_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () =>
      finish(() =>
        reject(signal.reason ?? new DOMException("Cancelled", "AbortError")),
      );
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(
              "Export preparation timed out. Retry, or export Markdown + assets.",
            ),
          ),
        ),
      milliseconds,
    );
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      action();
    };
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

/** Mermaid is rendered locally, not by a server-side browser or a third party.
 * The resulting file contains no scripts or remote image/font dependencies. */
export async function completeExport(
  result: DocumentExportResult,
  signal: AbortSignal,
  colors: string[],
): Promise<DocumentExportResult> {
  const document = new DOMParser().parseFromString(result.html, "text/html");
  const warnings = new Set(result.warnings);
  for (const diagram of document.querySelectorAll<HTMLElement>(
    "[data-mermaid]",
  )) {
    signal.throwIfAborted();
    try {
      const rendered = await abortable(
        renderDiagram(diagram.dataset.mermaid ?? "", colors),
        signal,
      );
      const svgDocument = new DOMParser().parseFromString(
        rendered.svg,
        "image/svg+xml",
      );
      const svg = svgDocument.documentElement;
      if (
        svg.localName !== "svg" ||
        svg.querySelector("parsererror, foreignObject")
      )
        throw new Error("Unsupported diagram output");
      svg
        .querySelectorAll("script, iframe, object, embed, image, animate, set")
        .forEach((node) => node.remove());
      for (const node of [svg, ...svg.querySelectorAll("*")]) {
        for (const attribute of [...node.attributes]) {
          if (
            /^on/i.test(attribute.name) ||
            (/(?:^|:)href$/i.test(attribute.name) &&
              !attribute.value.startsWith("#"))
          )
            node.removeAttribute(attribute.name);
        }
      }
      diagram.replaceChildren(document.importNode(svg, true));
      diagram.classList.add("diagram-preview");
      diagram.removeAttribute("data-mermaid");
    } catch (error) {
      if (signal.aborted) throw error;
      warnings.add(
        "A diagram could not render; its readable Mermaid source is included instead.",
      );
    }
  }
  // Renderer metadata is useful in the editor, not in a portable document.
  for (const node of document.querySelectorAll("*")) {
    for (const attribute of [...node.attributes])
      if (
        /^on/i.test(attribute.name) ||
        /^data-(?:visual|block|review|annotation)/.test(attribute.name)
      )
        node.removeAttribute(attribute.name);
  }
  document
    .querySelectorAll("script, iframe, object, embed, form")
    .forEach((node) => node.remove());
  return {
    html: "<!doctype html>\n" + document.documentElement.outerHTML,
    warnings: [...warnings],
  };
}

export async function readyExportFrame(
  frame: HTMLIFrameElement,
  signal: AbortSignal,
) {
  const doc = frame.contentDocument;
  if (!doc) throw new Error("The preview could not open. Try again.");
  await abortable(
    Promise.all([
      doc.fonts.ready,
      ...Array.from(doc.images, (image) =>
        image.decode().catch(() => {
          throw new Error(
            "An embedded image could not decode. Export Markdown + assets to preserve the original.",
          );
        }),
      ),
    ]),
    signal,
  );
  signal.throwIfAborted();
}

/** Sandboxed WebKit can suppress parent-installed event callbacks. Disable
 * preview navigation declaratively, before load, instead of relying on clicks
 * being cancellable. Keep hrefs so browser PDFs can still contain link targets. */
export function previewExportHtml(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    'a[href]:not([href^="#"])',
  )) {
    link.style.pointerEvents = "none";
    link.tabIndex = -1;
    link.setAttribute("aria-disabled", "true");
    link.title = "Open this link from the exported document";
  }
  return "<!doctype html>\n" + document.documentElement.outerHTML;
}
