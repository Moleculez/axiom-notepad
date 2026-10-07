import { afterEach, beforeEach, expect, test, vi } from "vitest";

const identity = {
  datasetId: "11111111-2222-4333-8444-555555555555",
  setupRequired: false,
};
let values: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  values = new Map();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

test("bootstrap and polling identity checks share one in-flight read", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi
    .fn(async () => Response.json(identity))
    .mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)));
  vi.stubGlobal("fetch", fetcher);
  const { verifyDataset, currentDataset } =
    await import("../apps/web/lib/dataset");
  const first = verifyDataset(),
    second = verifyDataset();
  expect(fetcher).toHaveBeenCalledTimes(1);
  resolve(Response.json(identity));
  await expect(first).resolves.toEqual(identity);
  await expect(second).resolves.toEqual(identity);
  expect(currentDataset()).toBe(identity.datasetId);
  await verifyDataset();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test.each(["beforeunload", "pagehide"])(
  "%s cancels identity reads and blocks late polling until restored",
  async (event) => {
    const fetcher = vi.fn(
      (_url, options: RequestInit) =>
        new Promise<Response>((_, reject) => {
          options.signal!.addEventListener(
            "abort",
            () => reject(options.signal!.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const { verifyDataset, currentDataset } =
      await import("../apps/web/lib/dataset");
    const pending = verifyDataset();
    window.dispatchEvent(new Event(event));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(verifyDataset()).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(currentDataset()).toBeNull();
    expect(values.size).toBe(0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(identity)),
    );
    window.dispatchEvent(
      new Event(event === "pagehide" ? "pageshow" : "focus"),
    );
    await expect(verifyDataset()).resolves.toEqual(identity);
  },
);

test("an abandoned decoded response cannot mark or replace the retained dataset", async () => {
  let resolve!: (value: typeof identity) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: () => new Promise<typeof identity>((r) => (resolve = r)),
    })),
  );
  const { verifyDataset, currentDataset } =
    await import("../apps/web/lib/dataset");
  const pending = verifyDataset();
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  window.dispatchEvent(new Event("beforeunload"));
  resolve(identity);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(currentDataset()).toBeNull();
  expect(values.size).toBe(0);
});

test.each([
  ["beforeunload", "focus"],
  ["pagehide", "pageshow"],
])(
  "rapid %s -> %s starts a fresh identity lifetime before canceled finally runs",
  async (cancel, resume) => {
    const fetcher = vi
      .fn(async (_url: RequestInfo | URL, _options?: RequestInit) =>
        Response.json(identity),
      )
      .mockImplementationOnce(
        (_url, options) =>
          new Promise<Response>((_, reject) => {
            options!.signal!.addEventListener(
              "abort",
              () => reject(options!.signal!.reason),
              { once: true },
            );
          }),
      );
    vi.stubGlobal("fetch", fetcher);
    const { verifyDataset, currentDataset } =
      await import("../apps/web/lib/dataset");
    const first = verifyDataset();
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    window.dispatchEvent(new Event(cancel));
    window.dispatchEvent(new Event(resume));
    const restored = verifyDataset(),
      shared = verifyDataset();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await rejected;
    await expect(restored).resolves.toEqual(identity);
    await expect(shared).resolves.toEqual(identity);
    expect(currentDataset()).toBe(identity.datasetId);
  },
);

test("API writes remain alive while an identity read is canceled", async () => {
  const fetcher = vi.fn(
    (_url, options: RequestInit) =>
      new Promise<Response>((_, reject) => {
        options.signal!.addEventListener(
          "abort",
          () => reject(options.signal!.reason),
          { once: true },
        );
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const { api } = await import("../apps/web/lib/client");
  const { verifyDataset } = await import("../apps/web/lib/dataset");
  const writer = new AbortController();
  const write = api("spaces", { method: "POST", signal: writer.signal });
  const read = verifyDataset();
  window.dispatchEvent(new Event("beforeunload"));
  await expect(read).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher.mock.calls[0][1].signal!.aborted).toBe(false);
  writer.abort();
  await expect(write).rejects.toMatchObject({ name: "AbortError" });
});

test("dataset replacement remains an explicit reset, not a retry or offline cache success", async () => {
  values.set("axiom:dataset", "66666666-7777-4888-9999-000000000000");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(identity)),
  );
  const { verifyDataset, currentDataset, DATASET_RESET } =
    await import("../apps/web/lib/dataset");
  const reset = vi.fn();
  window.addEventListener(DATASET_RESET, reset);
  await expect(verifyDataset()).rejects.toThrow("dataset changed");
  expect(reset).toHaveBeenCalledTimes(1);
  expect(currentDataset()).toBeNull();
  expect(values.get("axiom:dataset")).not.toBe(identity.datasetId);
});
