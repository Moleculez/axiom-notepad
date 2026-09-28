import { beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "../packages/shared/src/db";
import { forwardMigrations } from "../packages/shared/src/migrations";
import {
  isDatabaseUpgradeRequired,
  pendingDatabaseMigrations,
} from "../packages/shared/src/schema-readiness";
import { GET } from "../apps/web/app/health/route";

vi.mock("../packages/shared/src/db", () => ({ query: vi.fn() }));
const mockQuery = vi.mocked(query);
const receipts = forwardMigrations.map(({ version }) => ({ version }));

beforeEach(() => {
  mockQuery.mockReset();
});

describe("database upgrade readiness", () => {
  it("detects the pre-publishing schema behind both Storage and Website failures", async () => {
    mockQuery.mockResolvedValue(
      receipts.filter(({ version }) => version <= 30),
    );
    expect(await pendingDatabaseMigrations()).toEqual(
      receipts
        .filter(({ version }) => version > 30)
        .map(({ version }) => version),
    );
    expect(await isDatabaseUpgradeRequired({ code: "42P01" })).toBe(true);
    expect(await isDatabaseUpgradeRequired({ code: "42703" })).toBe(true);
  });

  it("checks gaps even when the latest migration is recorded", async () => {
    mockQuery.mockResolvedValue(
      receipts.filter(({ version }) => version !== 31),
    );
    expect(await pendingDatabaseMigrations()).toEqual([31]);
  });

  it("requires initialization when the migration ledger is missing", async () => {
    mockQuery.mockRejectedValue({ code: "42P01" });
    expect(await pendingDatabaseMigrations()).toEqual(
      receipts.map(({ version }) => version),
    );
  });

  it("does not mislabel query bugs on a current schema as an upgrade problem", async () => {
    mockQuery.mockResolvedValue(receipts);
    expect(await pendingDatabaseMigrations()).toEqual([]);
    expect(await isDatabaseUpgradeRequired({ code: "42P01" })).toBe(false);
    expect(await isDatabaseUpgradeRequired({ code: "42703" })).toBe(false);
  });

  it.each([undefined, null, new Error("Request failed"), { code: "23505" }])(
    "does not perform diagnostics for unrelated errors: %s",
    async (error) => {
      expect(await isDatabaseUpgradeRequired(error)).toBe(false);
      expect(mockQuery).not.toHaveBeenCalled();
    },
  );

  it("preserves connection and permission failures without masking the original error", async () => {
    const error = { code: "42501" };
    mockQuery.mockRejectedValue(error);
    await expect(pendingDatabaseMigrations()).rejects.toBe(error);
    expect(await isDatabaseUpgradeRequired({ code: "42P01" })).toBe(false);
  });

  it("does not reject additional receipts from an additive newer schema", async () => {
    mockQuery.mockResolvedValue([...receipts, { version: 999 }]);
    expect(await pendingDatabaseMigrations()).toEqual([]);
  });
});

describe("web health readiness", () => {
  it("reports unavailable, not healthy, when the database needs upgrading", async () => {
    mockQuery.mockResolvedValue(
      receipts.filter(({ version }) => version <= 30),
    );
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "unavailable",
      reason: "database_upgrade_required",
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("becomes healthy immediately after migration without a cached failure", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(receipts)
      .mockResolvedValueOnce([{ "?column?": 1 }]);
    expect((await GET()).status).toBe(503);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "web" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not expose database diagnostics on a public health endpoint", async () => {
    mockQuery.mockRejectedValue(new Error("private database details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });

  it("still checks the installation table on a migrated database", async () => {
    mockQuery
      .mockResolvedValueOnce(receipts)
      .mockRejectedValueOnce({ code: "42P01" });
    expect((await GET()).status).toBe(503);
    expect(mockQuery).toHaveBeenLastCalledWith(
      "SELECT 1 FROM app_instance LIMIT 1",
    );
  });
});
