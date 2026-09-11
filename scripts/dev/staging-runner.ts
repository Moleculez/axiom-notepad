import "dotenv/config";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";

export type StagingProfile = {
  database: string;
  storage: string;
  dist: string;
  devDist: string;
  webPort: number;
  syncPort: number;
};
export async function runStaging(
  profile: StagingProfile,
  command: string,
  extra: string[] = [],
) {
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "Staging helpers must not run in a production environment.",
    );
  if (!/^axiom_[a-z0-9_]*test[a-z0-9_]*$/.test(profile.database))
    throw new Error("Use an isolated axiom_*test* database name.");
  const target = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(target.hostname))
    throw new Error("Staging requires a local PostgreSQL server.");
  if (target.pathname.slice(1) === profile.database)
    throw new Error(
      "Staging must not reuse the configured application database.",
    );
  if (
    resolve(profile.storage) ===
    resolve(process.env.STORAGE_PATH ?? "data/attachments")
  )
    throw new Error(
      "Staging must not reuse the configured attachment directory.",
    );
  if (
    ![profile.webPort, profile.syncPort].every(
      (port) => Number.isInteger(port) && port > 0 && port <= 65535,
    ) ||
    profile.webPort === profile.syncPort
  )
    throw new Error(
      "Staging web and sync ports must be distinct valid port numbers.",
    );
  target.pathname = `/${profile.database}`;
  const env = {
    ...process.env,
    DATABASE_URL: target.href,
    APP_URL: `http://localhost:${profile.webPort}`,
    BETTER_AUTH_URL: `http://localhost:${profile.webPort}`,
    PORT: String(profile.webPort),
    SYNC_PORT: String(profile.syncPort),
    SYNC_INTERNAL_URL: `http://127.0.0.1:${profile.syncPort}`,
    NEXT_PUBLIC_SYNC_URL: `ws://localhost:${profile.syncPort}`,
    STORAGE_DRIVER: "local",
    STORAGE_PATH: resolve(profile.storage),
    AXIOM_DIST_DIR: profile.dist,
    AXIOM_DEV_DIST_DIR: profile.devDist,
    NEXT_PUBLIC_AXIOM_EDITOR_ENGINE: "milkdown",
  };
  const run = (args: string[]) =>
    new Promise<void>((done, fail) => {
      const child = spawn(process.execPath, args, { env, stdio: "inherit" });
      const stop = () => child.kill("SIGTERM");
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
        if (code === 0) done();
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
  else
    throw new Error(
      "Choose init, migrate, build, dev, web, sync, worker or admin.",
    );
}
