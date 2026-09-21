import { api } from "./client";
import { beginWorkspaceActivity } from "./workspace-activity";

type Pending = {
  promise: Promise<unknown>;
  controller: AbortController;
  readers: number;
};
const pending = new Map<string, Pending>();
/** In-flight deduplication only: no permission-bearing response is retained as a global cache. */
export function sharedRequest<T>(
  account: string,
  path: string,
  revision = 0,
  retry = 0,
) {
  const key = JSON.stringify([account, path, revision, retry]);
  let entry = pending.get(key);
  if (!entry || entry.controller.signal.aborted) {
    const controller = new AbortController();
    const finish = beginWorkspaceActivity();
    controller.signal.addEventListener("abort", finish, { once: true });
    const next: Pending = {
      controller,
      readers: 0,
      promise: Promise.resolve(),
    };
    next.promise = api<T>(path, { signal: controller.signal }).finally(() => {
      controller.signal.removeEventListener("abort", finish);
      finish();
      if (pending.get(key) === next) pending.delete(key);
    });
    pending.set(key, next);
    entry = next;
  }
  const owned = entry;
  owned.readers++;
  let released = false;
  return {
    promise: owned.promise as Promise<T>,
    release: () => {
      if (released) return;
      released = true;
      owned.readers--;
      queueMicrotask(() => {
        if (owned.readers === 0) owned.controller.abort();
      });
    },
  };
}
export function clearSharedRequests() {
  for (const entry of pending.values()) entry.controller.abort();
  pending.clear();
}
if (typeof window !== "undefined")
  window.addEventListener("axiom:close-documents", clearSharedRequests);
