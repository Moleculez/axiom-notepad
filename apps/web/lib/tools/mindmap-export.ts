import { DiagramPreviews } from "../editor-vnext/diagrams";

/** Export-only rendering. Does not switch editor/read surfaces into print mode. */
export async function waitForMindmapPreviews(
  element: HTMLElement,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!element.querySelector("[data-math-request], [data-mermaid]")) return;
  const diagrams = new DiagramPreviews();
  diagrams.render(element);
  window.dispatchEvent(
    new CustomEvent("axiom:prepare-math", { detail: element }),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearInterval(timer);
        signal.removeEventListener("abort", cancelled);
      };
      const cancelled = () => {
        cleanup();
        reject(
          signal.reason ?? new DOMException("Export cancelled", "AbortError"),
        );
      };
      const start = Date.now();
      const check = () => {
        if (signal.aborted) return cancelled();
        if (
          element.querySelector(
            '[data-math-state="error"], [data-preview-state="error"], [data-preview-state="stale"]',
          )
        ) {
          cleanup();
          reject(
            new Error(
              "An equation or diagram could not render. Fix its source or disable rich labels; no incomplete export was downloaded.",
            ),
          );
        } else if (
          !element.querySelector(
            '[data-math-request]:not([data-math-state="ready"]), [data-mermaid]:not([data-preview-state="ready"]), [data-mermaid][aria-busy="true"]',
          )
        ) {
          cleanup();
          resolve();
        } else if (Date.now() - start >= 65000) {
          cleanup();
          reject(
            new Error(
              "Rich preview export timed out. Wait for the preview or export Markdown instead.",
            ),
          );
        }
      };
      const timer = setInterval(check, 100);
      signal.addEventListener("abort", cancelled, { once: true });
      check();
    });
  } finally {
    diagrams.destroy();
  }
}
