import { datasetRequestHeaders } from "./dataset";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: any,
  ) {
    super(message);
  }
}
/** Keep local schema errors readable; Zod's default message is a JSON dump. */
export function errorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    return error.issues
      .slice(0, 3)
      .map(
        (issue: { path?: PropertyKey[]; message?: string }) =>
          `${issue.path?.filter((part) => part !== "data").join(" · ") || "Value"}: ${issue.message || "Please check this value."}`,
      )
      .join("; ");
  }
  return error instanceof Error ? error.message : fallback;
}
let pageLeaving = false;
const pageRequests = new Map<AbortController, boolean>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    // WebKit can invalidate the old origin before pagehide. Stop current reads
    // before that boundary; do not cancel writes or permanently disable this
    // page, because the user may cancel navigation in an unsaved-work prompt.
    for (const [request, readOnly] of pageRequests)
      if (readOnly) request.abort();
  });
  window.addEventListener("pagehide", () => {
    pageLeaving = true;
    for (const request of pageRequests.keys()) request.abort();
  });
  window.addEventListener("pageshow", () => {
    pageLeaving = false;
  });
}
export const SIGN_OUT_PENDING = "axiom:pending-signout";
let signingOut: Promise<boolean> | undefined;
export function finishPendingSignOut(): Promise<boolean> {
  if (!localStorage.getItem(SIGN_OUT_PENDING)) return Promise.resolve(true);
  if (!navigator.onLine) return Promise.resolve(false);
  if (signingOut) return signingOut;
  signingOut = (async () => {
    const marker = localStorage.getItem(SIGN_OUT_PENDING);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) return false;
      if (localStorage.getItem(SIGN_OUT_PENDING) === marker)
        localStorage.removeItem(SIGN_OUT_PENDING);
      return true;
    } catch {
      return false;
    } finally {
      signingOut = undefined;
    }
  })();
  return signingOut;
}
export function cacheAvailable(error: unknown) {
  return (
    !navigator.onLine ||
    error instanceof TypeError ||
    (error instanceof ApiError && error.status >= 500)
  );
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (pageLeaving) throw new DOMException("The page is leaving.", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  pageRequests.set(
    controller,
    ["GET", "HEAD"].includes(options.method ?? "GET") ||
      (options.method === "POST" && path.endsWith("/sync-token")),
  );
  try {
    if (
      typeof indexedDB !== "undefined" &&
      /^(?:resources|notes|tools)\/[\da-f-]{36}/i.test(path)
    ) {
      const offline = await import("./offline-files");
      if (await offline.hasPendingOfflineCreation(path)) {
        if (path.endsWith("/sync-token")) {
          try {
            await offline.waitForOfflineCreation(path);
          } catch (e) {
            throw new ApiError((e as Error).message, 503);
          }
        } else if (["GET", "HEAD"].includes(options.method ?? "GET")) {
          const cached = await offline.offlineRead(path);
          if (cached !== undefined) return cached as T;
          throw new ApiError(
            "This new file is waiting to be created on the server. Your local work is retained.",
            503,
          );
        }
      }
    }
    if (
      typeof navigator !== "undefined" &&
      navigator.onLine === false &&
      typeof indexedDB !== "undefined"
    ) {
      const offline = await import("./offline-files");
      if (offline.offlineAccount()) {
        if (["GET", "HEAD"].includes(options.method ?? "GET")) {
          const cached = await offline.offlineRead(path);
          if (cached !== undefined) return cached as T;
        } else
          return (await offline.queueOffline(
            path,
            options.method ?? "POST",
            typeof options.body === "string" ? JSON.parse(options.body) : {},
          )) as T;
      }
    }
    // Offline-store lookups above may outlive their component or page. Do not
    // start a fetch with an already-aborted signal (WebKit reports it as CORS).
    controller.signal.throwIfAborted();
    const response = await fetch("/api/v1/" + path, {
      ...options,
      signal: controller.signal,
      headers: {
        ...datasetRequestHeaders(),
        ...(options.body instanceof FormData
          ? {}
          : { "content-type": "application/json" }),
        ...options.headers,
      },
    });
    const data = await response.json().catch((error: unknown) => {
      // Navigation can abort body decoding before pagehide reaches us (Firefox).
      // Never turn that rejection into a successful object passed to array consumers.
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new ApiError(
        "The server returned an unreadable response. Please try again.",
        response.ok ? 502 : response.status,
      );
    });
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!response.ok) {
      if (
        [401, 403, 404].includes(response.status) &&
        typeof indexedDB !== "undefined"
      )
        void import("./offline-files")
          .then((m) => m.revokeOfflineResource(path))
          .catch(() => {});
      throw new ApiError(
        data?.error ?? data?.message ?? "Request failed",
        response.status,
        data,
      );
    }
    return data;
  } catch (error) {
    if (
      (error instanceof TypeError ||
        (error instanceof ApiError && error.status >= 500)) &&
      !controller.signal.aborted &&
      typeof indexedDB !== "undefined" &&
      ["GET", "HEAD"].includes(options.method ?? "GET")
    ) {
      const cached = await (await import("./offline-files")).offlineRead(path);
      if (cached !== undefined) return cached as T;
    }
    throw error;
  } finally {
    pageRequests.delete(controller);
    options.signal?.removeEventListener("abort", abort);
  }
}
export const post = (path: string, data: unknown = {}) =>
  api(path, { method: "POST", body: JSON.stringify(data) });
export async function authRequest(path: string, body: unknown = {}) {
  const response = await fetch("/api/auth/" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      result.message ?? "Account operation failed. Please try again.",
      response.status,
    );
  return result;
}
export function download(name: string, body: BlobPart, mime = "text/markdown") {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function timeAgo(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  return seconds < 60
    ? "just now"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h ago`
        : seconds < 604800
          ? `${Math.floor(seconds / 86400)}d ago`
          : new Date(value).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            });
}
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
export function colorFor(id: string) {
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) | 0;
  return ["#5479a7", "#73927a", "#967ab4", "#bd8a5b", "#bc737d"][
    Math.abs(n) % 5
  ];
}
