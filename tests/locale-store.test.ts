import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../apps/web/lib/client", () => ({
  api: fixture.api,
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public data?: unknown,
    ) {
      super(message);
    }
  },
}));
import {
  AccountLocaleStore,
  readGuestLocale,
} from "../apps/web/lib/locale-preferences";
import { ApiError } from "../apps/web/lib/client";
const values = new Map<string, string>();
const cacheKey = "axiom:locale:account:v1:locale-test-A";
const stores: AccountLocaleStore[] = [];
const empty = { locale: "en", version: 0, mutationId: null };
const browser = { onLine: false, languages: ["en"], language: "en" };
beforeEach(() => {
  vi.useFakeTimers();
  values.clear();
  fixture.api.mockReset();
  vi.stubGlobal("window", new EventTarget());
  browser.onLine = false;
  vi.stubGlobal("navigator", browser);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ Save: "Guardar" })),
  );
});
afterEach(() => {
  stores.splice(0).forEach((store) => store.stop());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function start(account = "locale-test-A") {
  const store = new AccountLocaleStore(account);
  stores.push(store);
  store.start();
  return store;
}
describe("locale account isolation and durable saves", () => {
  it("defaults to US English and preserves an explicit Automatic choice", () => {
    expect(readGuestLocale()).toBe("en");
    values.set("axiom:locale:guest:v1", "auto");
    expect(readGuestLocale()).toBe("auto");
    values.set("axiom:locale:guest:v1", "ar");
    expect(readGuestLocale()).toBe("auto");
  });
  it("retires only an Arabic outbox without replaying a different choice under its receipt", () => {
    values.set(
      cacheKey,
      JSON.stringify({
        schema: 1,
        base: {
          locale: "ar",
          version: 7,
          mutationId: "00000000-0000-4000-8000-000000000011",
        },
        outbox: {
          locale: "ar",
          version: 7,
          mutationId: "00000000-0000-4000-8000-000000000012",
        },
      }),
    );
    const store = start();
    expect(store.snapshot()).toMatchObject({ locale: "auto", pending: false });
    expect(fixture.api).not.toHaveBeenCalled();
    expect(store.save("ja")).toBe(true);
    const sent = JSON.parse(values.get(cacheKey)!).outbox;
    expect(sent.version).toBe(7);
    expect(sent.locale).toBe("ja");
    expect(sent.mutationId).not.toBe("00000000-0000-4000-8000-000000000012");
  });
  it("previews without writing preferences or an outbox", async () => {
    const store = start();
    await store.previewChoice("es");
    expect(store.snapshot()).toMatchObject({ locale: "en", pending: false });
    expect(values.has(cacheKey)).toBe(false);
    expect(fixture.api).not.toHaveBeenCalled();
    store.cancelPreview();
  });
  it("saves offline durably and keeps accounts separate", () => {
    const a = start();
    expect(a.save("ko")).toBe(true);
    expect(a.snapshot()).toMatchObject({ locale: "ko", pending: true });
    const cached = JSON.parse(values.get(cacheKey)!);
    expect(cached.outbox).toMatchObject({ locale: "ko", version: 0 });
    expect(cached.outbox.mutationId).toMatch(/^[0-9a-f-]{36}$/);
    const b = start("locale-test-B");
    expect(b.snapshot().locale).toBe("en");
    expect(fixture.api).not.toHaveBeenCalled();
  });
  it("replays the exact mutation and acknowledges only the saved record", async () => {
    const store = start();
    store.save("es");
    const outbox = JSON.parse(values.get(cacheKey)!).outbox;
    browser.onLine = true;
    fixture.api.mockResolvedValue({
      locale: "es",
      version: 1,
      mutationId: outbox.mutationId,
    });
    await store.refresh();
    expect(JSON.parse(fixture.api.mock.calls[0][1].body)).toEqual(outbox);
    expect(store.snapshot()).toMatchObject({
      locale: "es",
      pending: false,
      saving: false,
    });
    expect(JSON.parse(values.get(cacheKey)!).outbox).toBeNull();
  });
  it("retains the outbox after transient failure and survives reopening", async () => {
    const store = start();
    store.save("bn");
    browser.onLine = true;
    fixture.api.mockRejectedValue(new TypeError("network unavailable"));
    await store.refresh();
    store.stop();
    browser.onLine = false;
    const reopened = start();
    expect(reopened.snapshot()).toMatchObject({ locale: "bn", pending: true });
  });
  it("drains a save made during the initial read immediately without polling", async () => {
    let finish!: (value: unknown) => void;
    fixture.api.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    browser.onLine = true;
    const store = start();
    expect(store.save("es")).toBe(true);
    const mutation = JSON.parse(values.get(cacheKey)!).outbox;
    fixture.api.mockResolvedValue({
      locale: "es",
      version: 1,
      mutationId: mutation.mutationId,
    });
    finish(empty);
    await vi.waitFor(() => expect(store.snapshot().pending).toBe(false));
    expect(fixture.api).toHaveBeenCalledTimes(2);
    expect(fixture.api.mock.calls[1][1].method).toBe("PATCH");
    expect(JSON.parse(fixture.api.mock.calls[1][1].body)).toEqual(mutation);
  });
  it("requires an explicit decision when another device changed the version", async () => {
    const store = start();
    store.save("es");
    browser.onLine = true;
    const current = {
      locale: "fr",
      version: 3,
      mutationId: "00000000-0000-4000-8000-000000000012",
    };
    fixture.api.mockRejectedValue(new ApiError("Conflict", 409, { current }));
    await store.refresh();
    expect(store.snapshot().conflict).toEqual(current);
    store.resolve(false);
    expect(store.snapshot()).toMatchObject({
      locale: "fr",
      pending: false,
      conflict: null,
    });
  });
  it("uses a new exact mutation against the reviewed version when keeping local", async () => {
    const store = start();
    store.save("es");
    const first = JSON.parse(values.get(cacheKey)!).outbox;
    browser.onLine = true;
    fixture.api.mockRejectedValue(
      new ApiError("Conflict", 409, {
        current: {
          locale: "fr",
          version: 2,
          mutationId: "00000000-0000-4000-8000-000000000012",
        },
      }),
    );
    await store.refresh();
    browser.onLine = false;
    store.resolve(true);
    const next = JSON.parse(values.get(cacheKey)!).outbox;
    expect(next).toMatchObject({ locale: "es", version: 2 });
    expect(next.mutationId).not.toBe(first.mutationId);
  });
  it("does not report a durable save when storage rejected the outbox", () => {
    const store = start();
    localStorage.setItem = () => {
      throw new Error("Quota exceeded");
    };
    expect(store.save("hi")).toBe(false);
    expect(store.snapshot()).toMatchObject({ locale: "en", pending: false });
    expect(fixture.api).not.toHaveBeenCalled();
  });
  it("stopped accounts cannot apply late network responses", async () => {
    const a = start();
    browser.onLine = true;
    let finish!: (value: unknown) => void;
    fixture.api.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const refresh = a.refresh();
    a.stop();
    finish({
      locale: "ru",
      version: 9,
      mutationId: "00000000-0000-4000-8000-000000000012",
    });
    await refresh;
    expect(a.snapshot().locale).toBe("en");
    expect(values.has(cacheKey)).toBe(false);
  });
  it("ignores another account's storage event", () => {
    const a = start();
    values.set(
      "axiom:locale:account:v1:locale-test-B",
      JSON.stringify({
        schema: 1,
        base: { ...empty, locale: "ko" },
        outbox: null,
      }),
    );
    const event = Object.assign(new Event("storage"), {
      key: "axiom:locale:account:v1:locale-test-B",
    });
    window.dispatchEvent(event);
    expect(a.snapshot().locale).toBe("en");
  });
});
