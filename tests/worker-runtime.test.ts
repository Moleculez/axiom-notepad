import { describe, expect, it } from "vitest";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  workerHealthy,
  startWorkerHeartbeat,
} from "../scripts/ops/worker-health";
import { buildEnvironment } from "../scripts/build/environment";

describe("worker runtime deployment gates", () => {
  it("resolves the real worker import graph without dispatching or opening a database", async () => {
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/ops/workspace-worker.ts", "--check"],
      {
        env: buildEnvironment({
          ...process.env,
          DOTENV_CONFIG_PATH: "/dev/null",
        }),
        timeout: 15_000,
      },
    );
    expect(result.stdout).toContain("runtime imports are available");
    expect(result.stdout).not.toContain("worker started");
  });
  it("ships web adapters, health command and a database-free build check in the runtime image", async () => {
    const docker = await readFile("Dockerfile", "utf8"),
      compose = await readFile("compose.yaml", "utf8");
    const runtime = docker
      .split(" AS runtime\n")[1]
      .split(" AS operations\n")[0];
    expect(runtime).toContain("/app/apps/web/lib ./apps/web/lib");
    expect(runtime).toContain("/app/scripts/ops/worker-health.ts");
    expect(runtime).toContain("RUN AXIOM_BUILD=1");
    expect(runtime).toContain("scripts/ops/workspace-worker.ts --check");
    const worker = compose.split("\n  worker:\n")[1].split("\n  publish:\n")[0];
    expect(worker).toContain("scripts/ops/worker-health.ts");
    expect(worker).not.toContain("sync: { condition: service_healthy }");
  });
  it("requires a fresh valid heartbeat and removes it on graceful shutdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "axiom-worker-health-"));
    const file = join(directory, "heartbeat");
    let stop: (() => Promise<void>) | undefined;
    try {
      expect(await workerHealthy(file)).toBe(false);
      stop = await startWorkerHeartbeat(file);
      expect(await workerHealthy(file)).toBe(true);
      expect(await workerHealthy(file, Date.now() + 100_000)).toBe(false);
      await stop();
      stop = undefined;
      expect(await workerHealthy(file)).toBe(false);
      for (const invalid of [
        "garbage",
        "0",
        "NaN",
        String(Date.now() + 100_000),
      ]) {
        await writeFile(file, invalid);
        expect(await workerHealthy(file)).toBe(false);
      }
    } finally {
      await stop?.();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
