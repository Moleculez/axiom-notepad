/** One navigation lifetime for API and bootstrap reads, without account/cache
 * dependencies. Preparation cancels reads only: a dismissed unload prompt must
 * not discard in-flight writes. A hidden page cannot resume until pageshow. */
let leaving = false;
let prepared = false;
const requests = new Map<AbortController, boolean>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    prepared = true;
    for (const [request, readOnly] of requests) if (readOnly) request.abort();
  });
  window.addEventListener("pagehide", () => {
    leaving = true;
    for (const request of requests.keys()) request.abort();
  });
  window.addEventListener("pageshow", () => {
    leaving = false;
    prepared = false;
  });
  const resume = () => {
    if (!leaving) prepared = false;
  };
  window.addEventListener("focus", resume);
  window.addEventListener("pointerdown", resume, true);
  window.addEventListener("keydown", resume, true);
}

export function pageRequest(
  caller?: AbortSignal | null,
  readOnly = true,
): { controller: AbortController; finish: () => void } {
  if (leaving || (prepared && readOnly))
    throw new DOMException("Navigation is being prepared.", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort(caller?.reason);
  if (caller?.aborted) abort();
  else caller?.addEventListener("abort", abort, { once: true });
  requests.set(controller, readOnly);
  return {
    controller,
    finish() {
      requests.delete(controller);
      caller?.removeEventListener("abort", abort);
    },
  };
}
