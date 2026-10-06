/** Export-only rendering. Does not switch editor/read surfaces into print mode. */
export async function waitForMindmapMath(
  element: HTMLElement,
  signal: AbortSignal,
) {
  if (!element.querySelector("[data-math-request]")) return;
  window.dispatchEvent(
    new CustomEvent("axiom:prepare-math", { detail: element }),
  );
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
      if (element.querySelector('[data-math-state="error"]')) {
        cleanup();
        reject(
          new Error(
            "An equation could not render. Fix its source or disable rich labels; no incomplete export was downloaded.",
          ),
        );
      } else if (
        !element.querySelector(
          '[data-math-request]:not([data-math-state="ready"])',
        )
      ) {
        cleanup();
        resolve();
      } else if (Date.now() - start >= 65000) {
        cleanup();
        reject(
          new Error(
            "Equation export timed out. Wait for the preview or export Markdown instead.",
          ),
        );
      }
    };
    const timer = setInterval(check, 100);
    signal.addEventListener("abort", cancelled, { once: true });
    check();
  });
}
