import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PoolClient } from "pg";
import { migrateDatabase } from "../../packages/shared/src/migrate-database";

/** Disposable single-user SQL gate. No dotenv, pg-wire, URL, listener or real blobs. */
export async function offlinePostgresGate(prefix: string) {
  assert(/^[a-z-]+$/.test(prefix), "Use a fixed descriptive fixture prefix.");
  const host = `${process.platform}-${process.arch}`;
  assert(
    ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].includes(host),
    "Use supported local PostgreSQL binaries.",
  );
  const { postgres, initdb } = (await import(`@embedded-postgres/${host}`)) as {
    postgres: string;
    initdb: string;
  };
  await mkdir(resolve("data"), { recursive: true });
  const root = await mkdtemp(resolve(`data/${prefix}-`));
  async function initialize(name: string) {
    assert(/^[a-z-]+$/.test(name));
    const directory = join(root, name);
    await new Promise<void>((done, fail) => {
      const child = spawn(
        initdb,
        [
          `--pgdata=${directory}`,
          "--auth=trust",
          "--username=axiom_offline_gate",
          "--locale=C",
          "--encoding=UTF8",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (c) => (output += String(c)));
      child.stderr.on("data", (c) => (output += String(c)));
      child.on("error", fail);
      child.on("exit", (code) =>
        code === 0
          ? done()
          : fail(
              new Error(
                `Local fixture initialization failed: ${output.slice(-2000)}`,
              ),
            ),
      );
    });
    return directory;
  }
  async function sql(directory: string, source: string, label: string) {
    assert(
      directory.startsWith(root + "/"),
      "SQL must use this disposable cluster.",
    );
    const output = await new Promise<string>((done, fail) => {
      const child = spawn(
        postgres,
        ["--single", "-j", "-D", directory, "postgres"],
        {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, LC_MESSAGES: "en_US.UTF-8" },
        },
      );
      let result = "";
      child.stdout.on("data", (c) => (result += String(c)));
      child.stderr.on("data", (c) => (result += String(c)));
      child.on("error", fail);
      child.on("exit", (code) =>
        code === 0
          ? done(result)
          : fail(
              new Error(
                `${label}: PostgreSQL exited ${code}: ${result.slice(-1600)}`,
              ),
            ),
      );
      child.stdin.end(source.replace(/\n\s*\n/g, "\n") + "\n\n");
    });
    if (/(?:ERROR|FATAL|PANIC):/.test(output))
      throw new Error(
        `${label}: ${output.slice(output.search(/(?:ERROR|FATAL|PANIC):/)).slice(0, 1800)}`,
      );
  }
  return { root, initialize, sql };
}
export const sqlLiteral = (v: unknown) =>
  v == null
    ? "NULL"
    : typeof v === "number"
      ? String(v)
      : "'" + String(v).replaceAll("'", "''") + "'";
/** Capture the normal controller; the caller independently checks the actual SQL ledger. */
export async function offlineMigrationCommands(versions: Set<number>) {
  const result: string[] = [];
  await migrateDatabase({
    query: async (source: string, args: unknown[] = []) => {
      if (source.includes("to_regclass"))
        return {
          rows: [{ tracked: versions.size ? "schema_migrations" : null }],
          rowCount: 1,
        };
      if (source.startsWith("SELECT 1 FROM schema_migrations"))
        return {
          rows: [],
          rowCount: source.includes("version>=4")
            ? versions.size
              ? 1
              : 0
            : versions.has(Number(args[0]))
              ? 1
              : 0,
        };
      if (source.startsWith("INSERT INTO schema_migrations"))
        versions.add(Number(args[0]));
      result.push(
        args.length
          ? source.replace(/\$(\d+)/g, (_, n) =>
              sqlLiteral(args[Number(n) - 1]),
            )
          : source,
      );
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pick<PoolClient, "query">);
  return "BEGIN;\n" + result.join(";\n") + ";\nCOMMIT;";
}
