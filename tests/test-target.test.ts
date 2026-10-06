import { describe, it, expect, vi } from "vitest";
import { resolve, join } from "node:path";
import { mkdtemp, mkdir, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  mutationTestTarget,
  verifyMutationTestServer,
  verifyMutationTestStorage,
} from "../packages/shared/src/test-target";
const fixture = () => ({
  AXIOM_TEST_PROFILE: "extensions",
  AXIOM_TEST_ROOT: process.cwd(),
  TEST_APP_URL: "http://localhost:3004",
  APP_URL: "http://localhost:3004",
  DATABASE_URL: "postgresql://test:secret@127.0.0.1:54339/axiom_plugins_test",
  STORAGE_DRIVER: "local",
  STORAGE_PATH: resolve("data/plugins-test-attachments"),
  SYNC_PORT: "1236",
});
describe("mutation test isolation", () => {
  it("requires explicit target identity, never working defaults", () => {
    expect(() => mutationTestTarget({})).toThrow("isolated staging profile");
    const target = mutationTestTarget(fixture());
    expect(target.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(target.origin).toBe("http://localhost:3004");
    expect(target.fingerprint).not.toContain("secret");
    expect(
      mutationTestTarget({
        ...fixture(),
        DATABASE_URL: fixture().DATABASE_URL.replace("secret", "different"),
      }).fingerprint,
    ).toBe(target.fingerprint);
  });
  it.each([
    ["AXIOM_TEST_PROFILE", ""],
    ["AXIOM_TEST_PROFILE", "constructor"],
    ["AXIOM_TEST_PROFILE", "unregistered"],
    ["TEST_APP_URL", "http://localhost:8080"],
    ["TEST_APP_URL", "https://notepad.synaiv.com"],
    ["TEST_APP_URL", "http://localhost:3004/private"],
    ["TEST_APP_URL", "http://user:pass@localhost:3004"],
    ["TEST_APP_URL", "http://localhost:3004?target=8080"],
    ["APP_URL", "http://localhost:8080"],
    ["DATABASE_URL", "postgresql://test:secret@127.0.0.1/axiom"],
    ["DATABASE_URL", "postgresql://test:secret@db.example/axiom_plugins_test"],
    ["DATABASE_URL", "https://127.0.0.1/axiom_plugins_test"],
    ["DATABASE_URL", "postgresql://127.0.0.1/axiom_plugins_test?host=remote"],
    ["STORAGE_PATH", resolve("data/attachments")],
    ["STORAGE_PATH", "data/plugins-test-attachments"],
    ["STORAGE_DRIVER", "s3"],
    ["SYNC_PORT", "1234"],
  ])("rejects unsafe %s=%s without echoing credentials", (key, value) => {
    expect(() => mutationTestTarget({ ...fixture(), [key]: value })).toThrow(
      "isolated staging profile",
    );
  });
  it("binds a running server to the database host/port, workspace root and profile", () => {
    const value = fixture(),
      initial = mutationTestTarget(value).fingerprint;
    expect(
      mutationTestTarget({
        ...value,
        DATABASE_URL: value.DATABASE_URL.replace("54339", "54340"),
      }).fingerprint,
    ).not.toBe(initial);
    expect(
      mutationTestTarget({
        ...value,
        AXIOM_TEST_PROFILE: "release",
        DATABASE_URL: value.DATABASE_URL.replace(
          "axiom_plugins_test",
          "axiom_release_test",
        ),
        STORAGE_PATH: resolve("data/release-test-attachments"),
      }).fingerprint,
    ).not.toBe(initial);
  });
  it("refuses network access before rejecting unsafe configuration", async () => {
    const request = vi.fn();
    await expect(
      verifyMutationTestServer(
        { ...fixture(), TEST_APP_URL: "http://localhost:8080" },
        request,
      ),
    ).rejects.toThrow("isolated staging profile");
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    [503, { status: "unavailable" }],
    [200, { status: "ok" }],
    [200, { status: "ok", testTarget: "different" }],
    [200, { status: "unavailable", testTarget: "different" }],
  ])(
    "fails closed for readiness or identity mismatch",
    async (status, body) => {
      await expect(
        verifyMutationTestServer(
          fixture(),
          vi.fn(async () => Response.json(body, { status })),
        ),
      ).rejects.toThrow("no mutation tests were started");
    },
  );
  it("accepts an exact, no-store health attestation without following redirects", async () => {
    const value = fixture(),
      target = mutationTestTarget(value);
    const request = vi.fn(async () =>
      Response.json({ status: "ok", testTarget: target.fingerprint }),
    );
    expect(await verifyMutationTestServer(value, request)).toEqual(target);
    expect(request).toHaveBeenCalledWith(
      target.origin + "/health",
      expect.objectContaining({ redirect: "error", cache: "no-store" }),
    );
  });
  it("rejects redirected local storage", async () => {
    const directory = await mkdtemp(
      join(await realpath(tmpdir()), "axiom-isolation-"),
    );
    await mkdir(join(directory, "original"));
    await symlink(join(directory, "original"), join(directory, "redirect"));
    const target = mutationTestTarget(fixture());
    await expect(
      verifyMutationTestStorage({
        ...target,
        storage: join(directory, "redirect"),
      }),
    ).rejects.toThrow("symlinks");
    await expect(
      verifyMutationTestStorage({
        ...target,
        storage: join(directory, "original"),
      }),
    ).resolves.toBeUndefined();
  });
});
