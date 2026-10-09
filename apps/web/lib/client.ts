import { datasetRequestHeaders } from "./dataset";
import { pageRequest } from "./request-lifecycle";
import { formatRelativeTime } from "@axiom/i18n";
import { currentLocale } from "@axiom/i18n/client";
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
const readOnlyRequest = (path: string, options: RequestInit) =>
  ["GET", "HEAD"].includes(options.method ?? "GET") ||
  (options.method === "POST" && path.endsWith("/sync-token"));
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
  const readOnly = readOnlyRequest(path, options);
  const { controller, finish } = pageRequest(options.signal, readOnly);
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
      if (/^(?:plugins(?:\/|$)|recovery-activity(?:\?|$))/.test(path))
        throw new ApiError(
          "Extensions and background activity require an online session. Your local editor remains available.",
          503,
        );
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
      // Offline resource lists contain only explicitly downloaded files, not a
      // cached server listing. Substituting one during an online refresh makes
      // loaded folders disappear (often the downloaded subset is empty).
      const partialListing =
        cached &&
        typeof cached === "object" &&
        "offline" in cached &&
        cached.offline === true;
      if (cached !== undefined && (!navigator.onLine || !partialListing))
        return cached as T;
    }
    throw error;
  } finally {
    finish();
  }
}
export const post = <T = any>(path: string, data: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data) });
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
  return formatRelativeTime(currentLocale(), value);
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
