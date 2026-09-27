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
  foreground = true,
) {
  const key = JSON.stringify([account, path, revision, retry]);
  let entry = pending.get(key);
  if (!entry || entry.controller.signal.aborted) {
    const controller = new AbortController();
    const next: Pending = {
      controller,
      readers: 0,
      promise: Promise.resolve(),
    };
    next.promise = api<T>(path, { signal: controller.signal }).finally(() => {
      if (pending.get(key) === next) pending.delete(key);
    });
    pending.set(key, next);
    entry = next;
  }
  const owned = entry;
  owned.readers++;
  // Feedback belongs to the reader, not the network request: a background
  // poll may share transport with navigation without keeping its bar alive.
  const finish = foreground ? beginWorkspaceActivity() : () => {};
  owned.controller.signal.addEventListener("abort", finish, { once: true });
  const settled = () => {
    owned.controller.signal.removeEventListener("abort", finish);
    finish();
  };
  void owned.promise.then(settled, settled);
  let released = false;
  return {
    promise: owned.promise as Promise<T>,
    release: () => {
      if (released) return;
      released = true;
      settled();
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
