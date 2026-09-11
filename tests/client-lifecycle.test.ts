import { afterEach, beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());

function pendingFetch() {
  const fetcher = vi.fn(
    (_input: unknown, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = options!.signal!;
        if (signal.aborted) reject(signal.reason);
        else
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

test("departing pages cancel requests and cannot launch delayed background reads", async () => {
  const fetcher = pendingFetch();
  const { api } = await import("../apps/web/lib/client");
  const pending = api("spaces");
  window.dispatchEvent(new Event("pagehide"));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await expect(api("me/reading")).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("restored pages get a new request lifetime without reviving old requests", async () => {
  pendingFetch();
  const { api } = await import("../apps/web/lib/client");
  const pending = api("spaces");
  window.dispatchEvent(new Event("pagehide"));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  window.dispatchEvent(new Event("pageshow"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ restored: true })),
  );
  await expect(api("spaces")).resolves.toEqual({ restored: true });
});

test("page request management preserves caller cancellation and HTTP errors", async () => {
  pendingFetch();
  const { api, ApiError } = await import("../apps/web/lib/client");
  const caller = new AbortController();
  const pending = api("spaces", { signal: caller.signal });
  caller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: "Access changed." }, { status: 403 }),
    ),
  );
  await expect(api("spaces")).rejects.toEqual(
    new ApiError("Access changed.", 403, { error: "Access changed." }),
  );
});

test("body-decoding cancellation is not returned as successful application data", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new DOMException(
          "Navigation interrupted decoding.",
          "AbortError",
        );
      },
    })),
  );
  const { api } = await import("../apps/web/lib/client");
  await expect(api("notes/example/comments")).rejects.toMatchObject({
    name: "AbortError",
  });
});

test.each([200, 403, 503])(
  "invalid JSON keeps HTTP failure semantics instead of entering UI state: %i",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Unavailable</html>", { status })),
    );
    const { api, ApiError } = await import("../apps/web/lib/client");
    await expect(api("notes/example/comments")).rejects.toEqual(
      new ApiError(
        "The server returned an unreadable response. Please try again.",
        status === 200 ? 502 : status,
      ),
    );
  },
);
