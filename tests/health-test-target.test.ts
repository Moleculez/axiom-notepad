import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { query } from "../packages/shared/src/db";
import {
  mutationTestTarget,
  verifyMutationTestStorage,
} from "../packages/shared/src/test-target";
import { GET } from "../apps/web/app/health/route";
vi.mock("../packages/shared/src/db", () => ({ query: vi.fn() }));
vi.mock("../packages/shared/src/schema-readiness", () => ({
  pendingDatabaseMigrations: vi.fn(async () => []),
}));
vi.mock("../packages/shared/src/test-target", async (original) => ({
  ...(await original<typeof import("../packages/shared/src/test-target")>()),
  verifyMutationTestStorage: vi.fn(async () => {}),
}));
const fixture = {
  AXIOM_TEST_PROFILE: "reliability",
  AXIOM_TEST_ROOT: process.cwd(),
  TEST_APP_URL: "http://localhost:3004",
  APP_URL: "http://localhost:3004",
  DATABASE_URL: "postgresql://test:secret@127.0.0.1:54339/axiom_plugins_test",
  STORAGE_DRIVER: "local",
  STORAGE_PATH: resolve("data/reliability-test-attachments"),
  SYNC_PORT: "1236",
};
beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(verifyMutationTestStorage).mockReset().mockResolvedValue(undefined);
  for (const [key, value] of Object.entries(fixture)) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());
describe("runtime test attestation", () => {
  it("keeps normal deployment health unchanged and identity-free", async () => {
    vi.stubEnv("AXIOM_TEST_PROFILE", "");
    vi.mocked(query).mockResolvedValue([]);
    const response = await GET();
    expect(await response.json()).toEqual({ status: "ok", service: "web" });
    expect(verifyMutationTestStorage).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("attests the actual database with no paths, connection strings or secrets", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([{ name: "axiom_plugins_test" }])
      .mockResolvedValueOnce([]);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      status: "ok",
      service: "web",
      testTarget: mutationTestTarget(fixture).fingerprint,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(body)).not.toMatch(
      /secret|54339|attachments|axiom_plugins_test/,
    );
  });
  it("rejects a pool connected to another database", async () => {
    vi.mocked(query).mockResolvedValueOnce([{ name: "axiom" }]);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
  it("rejects symlink redirects without exposing the underlying path", async () => {
    vi.mocked(verifyMutationTestStorage).mockRejectedValue(
      new Error("Private path"),
    );
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(query).not.toHaveBeenCalled();
  });
});
