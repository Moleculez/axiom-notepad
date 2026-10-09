import { beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "../packages/shared/src/db";
import { localeApi } from "../packages/shared/src/locale-api";
import { defaultLocaleRecord } from "../packages/shared/src/locale-preferences";
import { forwardMigrations as migrations } from "../packages/shared/src/migrations";
vi.mock("../packages/shared/src/db", () => ({ query: vi.fn() }));
const mockQuery = vi.mocked(query);
const mutationId = "00000000-0000-4000-8000-000000000011";
const request = (body: unknown) =>
  new Request("http://localhost/api/v1/me/locale", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  mockQuery.mockReset();
});
describe("account locale API", () => {
  it("adds one forward migration without changing applied schemas", () => {
    const migration = migrations.find((item) => item.version === 51);
    expect(migration).toMatchObject({
      version: 51,
      name: "account-interface-language",
    });
    expect(migration!.sql).toContain('REFERENCES "user"(id) ON DELETE CASCADE');
  });
  it("defaults an existing account to automatic without a write", async () => {
    mockQuery.mockResolvedValue([]);
    const response = await localeApi(
      new Request("http://localhost"),
      "account-A",
    );
    expect(await response.json()).toEqual(defaultLocaleRecord);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/^SELECT/), [
      "account-A",
    ]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each(["de", "zh-TW", "", "AUTO"])(
    "rejects unsupported %s before SQL",
    async (locale) => {
      await expect(
        localeApi(request({ locale, version: 0, mutationId }), "account-A"),
      ).rejects.toThrow();
      expect(mockQuery).not.toHaveBeenCalled();
    },
  );
  it.each([
    { locale: "es", version: -1, mutationId },
    { locale: "es", version: 1.2, mutationId },
    { locale: "es", version: 0, mutationId: "bad" },
    { locale: "es", version: 0, mutationId, userId: "account-B" },
  ])("rejects invalid mutation %j", async (input) => {
    await expect(localeApi(request(input), "account-A")).rejects.toThrow();
    expect(mockQuery).not.toHaveBeenCalled();
  });
  it("uses the authenticated account, not a client-supplied identity", async () => {
    mockQuery.mockResolvedValue([{ locale: "ar", version: 1, mutationId }]);
    const response = await localeApi(
      request({ locale: "ar", version: 0, mutationId }),
      "account-A",
    );
    expect(response.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/^INSERT/), [
      "account-A",
      "ar",
      mutationId,
    ]);
  });
  it("retries the same mutation idempotently", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ locale: "es", version: 3, mutationId }]);
    const response = await localeApi(
      request({ locale: "es", version: 2, mutationId }),
      "account-A",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: 3 });
  });
  it("exposes a conflict rather than overwriting a different device", async () => {
    const current = {
      locale: "fr",
      version: 4,
      mutationId: "00000000-0000-4000-8000-000000000012",
    };
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([current]);
    const response = await localeApi(
      request({ locale: "es", version: 2, mutationId }),
      "account-A",
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "locale_conflict",
      current,
    });
    expect(mockQuery.mock.calls[0][0]).toContain("version=$3");
  });
  it("rejects unsupported methods without database work", async () => {
    const response = await localeApi(
      new Request("http://localhost", { method: "DELETE" }),
      "account-A",
    );
    expect(response.status).toBe(405);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
