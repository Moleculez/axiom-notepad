import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const broker = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../apps/web/lib/client", () => ({ api: broker.api }));
import {
  PluginRuntime,
  type PluginRuntimeStart,
} from "../apps/web/lib/plugin-runtime";
import {
  pluginManifestSchema,
  pluginPermissionActive,
} from "../packages/shared/src/plugins";
import { stagePortabilityMigration } from "../packages/shared/src/stage-portability-migration";

let frame: Record<string, any>,
  listener: ((event: any) => void) | undefined,
  port: Record<string, any>;
const day = 86400000;
function runtime(expiresAt = new Date(Date.now() + 30 * day).toISOString()) {
  const state = vi.fn();
  const start: PluginRuntimeStart = {
    expiresAt,
    bundle: "export default {run(){}}",
    grantId: randomUUID(),
    grantRevision: 1,
    packageHash: "a".repeat(64),
    manifest: pluginManifestSchema.parse({
      format: "axiom-plugin",
      apiVersion: 1,
      id: "fixture.expiry",
      name: "Expiry fixture",
      version: "1.0.0",
      description: "Synthetic",
      author: "Test",
      license: "MIT",
      entry: "main.js",
      capabilities: [],
      commands: [
        { id: "fixture.expiry.run", title: "Run", description: "Test" },
      ],
    }),
    context: {
      spaceId: randomUUID(),
      spaceName: "Synthetic workspace",
      command: "fixture.expiry.run",
      inputs: {},
      settings: {},
    },
  };
  const instance = new PluginRuntime(start, {
    onPanel: vi.fn(),
    onState: state,
  });
  if (listener && !frame.remove.mock.calls.length) {
    listener({
      source: frame.contentWindow,
      origin: "null",
      data: {
        type: "axiom-plugin-ready",
        nonce: new URL(frame.src, "http://localhost").searchParams.get("nonce"),
      },
    });
    port.onmessage({ data: JSON.stringify({ type: "loaded" }) });
    port.onmessage({ data: JSON.stringify({ type: "done" }) });
  }
  return { instance, state, start };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
  vi.resetAllMocks();
  listener = undefined;
  frame = {
    contentWindow: { postMessage: vi.fn() },
    setAttribute: vi.fn(),
    remove: vi.fn(),
  };
  port = { postMessage: vi.fn(), start: vi.fn(), close: vi.fn() };
  vi.stubGlobal("document", {
    createElement: () => frame,
    body: { append: vi.fn() },
  });
  vi.stubGlobal("window", {
    addEventListener: (_type: string, callback: typeof listener) => {
      listener = callback;
    },
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = port;
      port2 = {};
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("expiring extension consent", () => {
  it("uses exact boundaries and treats absent/invalid expiries as inactive", () => {
    expect(pluginPermissionActive(new Date(Date.now() + 1))).toBe(true);
    expect(pluginPermissionActive(new Date(Date.now()))).toBe(false);
    expect(pluginPermissionActive(undefined)).toBe(false);
    expect(pluginPermissionActive("not a date")).toBe(false);
  });
  it("retains an idle runtime beyond the 24.8-day timer maximum, then stops at the real expiry", async () => {
    const { instance, state } = runtime();
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(frame.remove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30 * day - 2_147_483_647);
    expect(frame.remove).toHaveBeenCalledOnce();
    expect(state).toHaveBeenLastCalledWith(
      "error",
      expect.stringContaining("permissions expired"),
    );
    expect(port.close).toHaveBeenCalledOnce();
    expect(broker.api).not.toHaveBeenCalled();
    instance.dispose();
    expect(frame.remove).toHaveBeenCalledOnce();
  });
  it("fences local actions immediately even if a background timer has not fired", async () => {
    const { instance } = runtime(new Date(Date.now() + 100).toISOString());
    vi.setSystemTime(new Date(Date.now() + 101));
    await expect(instance.request("resources.list", {})).rejects.toThrow(
      /expired/,
    );
    expect(() => instance.run("fixture.expiry.run", {})).toThrow(/expired/);
    expect(broker.api).not.toHaveBeenCalled();
    expect(frame.remove).toHaveBeenCalledOnce();
  });
  it("clears timers on Stop and rejects expired start data without contacting the broker", () => {
    runtime().instance.dispose();
    expect(vi.getTimerCount()).toBe(0);
    const { state } = runtime(new Date(Date.now() - 1).toISOString());
    expect(state).toHaveBeenLastCalledWith(
      "error",
      expect.stringContaining("expired"),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it("adds forward-only 30-day grace and enforces expiry at every shared server authority fence", () => {
    expect(
      stagePortabilityMigration.match(
        /DEFAULT clock_timestamp\(\)\+interval '720 hours'/g,
      ),
    ).toHaveLength(2);
    expect(stagePortabilityMigration).not.toMatch(/UPDATE notes|DELETE|DROP/);
    const guard = readFileSync(
        "packages/shared/src/plugin-security.ts",
        "utf8",
      ),
      api = readFileSync("packages/shared/src/plugins-api.ts", "utf8"),
      writes = readFileSync(
        "packages/shared/src/workspace-change-sets.ts",
        "utf8",
      );
    expect(guard).toContain("g.expires_at>clock_timestamp()");
    expect(guard).toContain("AND expires_at>clock_timestamp()");
    expect(api).toContain("expiresAt: grant.effective_expires_at");
    expect(api).toContain("expires_at=clock_timestamp()+interval '720 hours'");
    expect(writes).toContain("authorizePluginAction(");
  });
});
