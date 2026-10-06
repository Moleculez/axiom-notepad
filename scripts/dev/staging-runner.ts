import "dotenv/config";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { lstat, mkdir } from "node:fs/promises";
import pg from "pg";
import { mutationTestTarget } from "../../packages/shared/src/test-target";
import {
  stagingEnvironment,
  type StagingProfile,
} from "../../packages/shared/src/test-staging";

export type { StagingProfile };
export async function runStaging(
  profile: StagingProfile,
  command: string,
  extra: string[] = [],
) {
  const env = stagingEnvironment(profile, process.env);
  const target = new URL(env.DATABASE_URL);
  // A familiar test path must not redirect into real attachment storage.
  let ancestor = resolve(profile.storage);
  while (ancestor !== resolve("/")) {
    try {
      if ((await lstat(ancestor)).isSymbolicLink())
        throw new Error("Staging attachment paths must not contain symlinks.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    ancestor = resolve(ancestor, "..");
  }
  await mkdir(resolve(profile.storage), { recursive: true });
  const run = (args: string[]) =>
    new Promise<void>((done, fail) => {
      const child = spawn(process.execPath, args, {
        env: {
          ...env,
          NODE_ENV:
            command === "web" || command === "build"
              ? "production"
              : "development",
        },
        stdio: "inherit",
      });
      let interrupted = false;
      const stop = () => {
        interrupted = true;
        child.kill("SIGTERM");
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      const cleanup = () => {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      };
      child.on("error", (error) => {
        cleanup();
        fail(error);
      });
      child.on("exit", (code) => {
        cleanup();
        if (code === 0 || interrupted) done();
        else
          fail(new Error(`Staging child exited with ${code ?? "a signal"}.`));
      });
    });
  if (command === "init") {
    const admin = new URL(target);
    admin.pathname = "/postgres";
    const client = new pg.Client({ connectionString: admin.href });
    await client.connect();
    try {
      if (
        !(
          await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [
            profile.database,
          ])
        ).rowCount
      )
        await client.query(`CREATE DATABASE "${profile.database}"`);
    } finally {
      await client.end();
    }
  }
  const ts = (path: string, args: string[] = []) => [
    "--import",
    "tsx",
    path,
    ...args,
  ];
  if (command === "init" || command === "migrate")
    await run(ts("scripts/ops/migrate.ts"));
  else if (command === "build") {
    await run(ts("scripts/build/application.ts"));
  } else if (command === "dev" || command === "web") {
    await run([
      "node_modules/next/dist/bin/next",
      command === "dev" ? "dev" : "start",
      "apps/web",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(profile.webPort),
    ]);
  } else if (command === "sync") await run(ts("apps/sync/src/server.ts"));
  else if (command === "worker")
    await run(ts("scripts/ops/workspace-worker.ts"));
  else if (command === "admin") await run(ts("scripts/ops/admin.ts", extra));
  else if (command === "verify-plugins")
    await run(ts("scripts/verify/verify-plugins.ts", extra));
  else if (command === "verify-imports")
    await run(ts("scripts/verify/verify-workspace-imports.ts", extra));
  else if (command === "test") {
    mutationTestTarget(env);
    await run(["node_modules/@playwright/test/cli.js", "test", ...extra]);
  } else if (command === "verify-durability")
    await run(ts("scripts/verify/verify-durability.ts", extra));
  else
    throw new Error(
      "Choose init, migrate, build, dev, web, sync, worker, admin, test, verify-durability, verify-plugins or verify-imports.",
    );
}
