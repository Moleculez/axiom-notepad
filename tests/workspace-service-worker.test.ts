import { expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { workspaceServiceWorker } from "../apps/web/lib/workspace-service-worker";

function worker() {
  const handlers = new Map<string, (event: any) => void>();
  const fetcher = vi.fn(async () => Response.json({ ready: true }));
  runInNewContext(workspaceServiceWorker, {
    importScripts() {},
    self: {
      AXIOM_BUILD_ID: "fixture",
      AXIOM_ASSETS: [],
      location: { origin: "http://localhost:3004" },
      addEventListener: (event: string, callback: (event: any) => void) =>
        handlers.set(event, callback),
    },
    URL,
    Headers,
    Response,
    fetch: fetcher,
  });
  return { fetcher, handle: handlers.get("fetch")! };
}

it.each([
  ["/api/v1/events", "*/*"],
  ["/api/v1/other-stream", "text/event-stream"],
])(
  "does not wrap or cache the browser-owned streaming lifetime for %s",
  (path, accept) => {
    const { handle, fetcher } = worker();
    const respondWith = vi.fn();
    handle({
      request: new Request("http://localhost:3004" + path, {
        headers: { accept },
      }),
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it("retains network-first API reads without placing private responses in the shell cache", async () => {
  const { handle, fetcher } = worker();
  let response: Promise<Response> | undefined;
  handle({
    request: new Request("http://localhost:3004/api/v1/resources"),
    respondWith: (value: Promise<Response>) => {
      response = value;
    },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await (await response!).json()).toEqual({ ready: true });
});
