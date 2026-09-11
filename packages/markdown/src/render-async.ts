import { renderDocument } from "./render";
import type { ParsedDocument, RenderContext } from "./types";
import type { MathRequest } from "./math-contract";
import { renderMathBatch } from "./math-server";
import { escapeHtml } from "./render";

/** Server/worker conversion. Browser UI uses the same renderer in a worker. */
export async function renderDocumentAsync(
  document: ParsedDocument,
  context: RenderContext = {},
) {
  const requests = new Map<string, MathRequest>();
  renderDocument(document, {
    ...context,
    math: (request) => {
      requests.set(JSON.stringify(request), request);
      return "";
    },
  });
  const results = await renderMathBatch([...requests.values()]);
  const cache = new Map(
    [...requests.keys()].map((key, index) => [key, results[index]]),
  );
  let css = "";
  const html = renderDocument(document, {
    ...context,
    math: (request: MathRequest) => {
      const key = JSON.stringify(request);
      const result = cache.get(key)!;
      css ||= result.css;
      return `<span class="math-render" data-math-state="${result.error ? "error" : "ready"}">${result.error ? `<span class="math-error" title="${escapeHtml(result.error)}">${escapeHtml(request.tex)}</span>` : result.html}</span>`;
    },
  });
  return { html, css };
}
