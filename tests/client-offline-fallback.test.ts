import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { offlineRead } = vi.hoisted(() => ({ offlineRead: vi.fn() }));
vi.mock("../apps/web/lib/offline-files", () => ({
  offlineRead,
  offlineAccount: () => "sidebar-account",
}));

beforeEach(() => {
  vi.resetModules();
  offlineRead.mockReset();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("indexedDB", {});
});
afterEach(() => vi.unstubAllGlobals());

test.each([{ items: [] }, { items: [{ id: "downloaded-file" }] }])(
  "an online listing failure cannot replace the server tree with a partial offline list: %j",
  async ({ items }) => {
    offlineRead.mockResolvedValue({ items, nextCursor: null, offline: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "Unavailable" }, { status: 503 }),
      ),
    );
    const { api } = await import("../apps/web/lib/client");
    await expect(
      api("resources?spaceId=workspace&limit=40"),
    ).rejects.toMatchObject({
      status: 503,
    });
  },
);

test("a network failure while online also preserves the listing error", async () => {
  offlineRead.mockResolvedValue({ items: [], offline: true });
  const failure = new TypeError("Failed to fetch");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
  const { api } = await import("../apps/web/lib/client");
  await expect(api("resources?spaceId=workspace")).rejects.toBe(failure);
});

test("offline browsing still returns the downloaded subset without a network request", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  const listing = { items: [{ id: "downloaded-file" }], offline: true };
  offlineRead.mockResolvedValue(listing);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { api } = await import("../apps/web/lib/client");
  await expect(api("resources?spaceId=workspace")).resolves.toBe(listing);
  expect(fetcher).not.toHaveBeenCalled();
});

test("exact cached data remains available during an online server outage", async () => {
  const spaces = [{ id: "workspace", name: "Downloaded workspace" }];
  offlineRead.mockResolvedValue(spaces);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: "Unavailable" }, { status: 503 })),
  );
  const { api } = await import("../apps/web/lib/client");
  await expect(api("spaces")).resolves.toBe(spaces);
});
