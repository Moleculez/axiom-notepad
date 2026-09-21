export type ActivityPhase = "idle" | "loading" | "complete";

/** Request lifetimes only. Never caches content, credentials or navigation targets. */
export function createWorkspaceActivity() {
  const active = new Set<symbol>();
  const listeners = new Set<() => void>();
  let phase: ActivityPhase = "idle";
  let shownAt = 0;
  let reveal: ReturnType<typeof setTimeout> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let hide: ReturnType<typeof setTimeout> | undefined;
  const publish = (next: ActivityPhase) => {
    if (phase === next) return;
    phase = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => phase,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin() {
      const token = Symbol();
      active.add(token);
      clearTimeout(settle);
      clearTimeout(hide);
      if (phase === "complete") {
        shownAt = Date.now();
        publish("loading");
      } else if (phase === "idle" && !reveal) {
        reveal = setTimeout(() => {
          reveal = undefined;
          if (!active.size) return;
          shownAt = Date.now();
          publish("loading");
        }, 160);
      }
      return () => {
        if (!active.delete(token) || active.size) return;
        clearTimeout(reveal);
        reveal = undefined;
        if (phase !== "loading") return;
        settle = setTimeout(
          () => {
            publish("complete");
            hide = setTimeout(() => publish("idle"), 180);
          },
          Math.max(0, 260 - (Date.now() - shownAt)),
        );
      };
    },
    reset() {
      active.clear();
      clearTimeout(reveal);
      clearTimeout(settle);
      clearTimeout(hide);
      reveal = undefined;
      publish("idle");
    },
  };
}

export const workspaceActivity = createWorkspaceActivity();
export const beginWorkspaceActivity = () => workspaceActivity.begin();
if (typeof window !== "undefined") {
  window.addEventListener("axiom:close-documents", () =>
    workspaceActivity.reset(),
  );
  window.addEventListener("pagehide", () => workspaceActivity.reset());
}
