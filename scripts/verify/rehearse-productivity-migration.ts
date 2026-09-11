import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";

// Restore only into a new, explicitly named rehearsal database. Never change the
// current database or reuse a populated restore target.
const backup = resolve(
  process.argv[2] || "data/before-productivity-migration9-20260909",
);
const source = new URL(process.env.DATABASE_URL!);
const target = new URL(source);
target.pathname = "/axiom_productivity_migration9_test_20260909";
assert(target.href !== source.href);
const admin = new pg.Client({ connectionString: source.href });
await admin.connect();
try {
  await admin.query(
    'CREATE DATABASE "axiom_productivity_migration9_test_20260909"',
  );
} finally {
  await admin.end();
}
const env = {
  ...process.env,
  RESTORE_DATABASE_URL: target.href,
  STORAGE_PATH: resolve(
    "data/productivity-migration9-test-attachments-20260909",
  ),
  PG_BIN: "/opt/homebrew/opt/libpq/bin",
};
async function run(args: string[], overrides: Record<string, string> = {}) {
  const child = spawn(process.execPath, ["--import", "tsx", ...args], {
    env: { ...env, ...overrides },
    stdio: "inherit",
  });
  await new Promise<void>((done, fail) => {
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`Rehearsal step exited ${code}`)),
    );
  });
}
await run(["scripts/ops/backup.ts", "restore", backup]);
const db = new pg.Client({ connectionString: target.href });
await db.connect();
async function fingerprints() {
  const result: Record<string, unknown> = {};
  for (const [table, field] of [
    ["notes", "id"],
    ["documents", "room"],
    ["document_updates", "id"],
    ["attachments", "id"],
    ["snapshots", "id"],
    ["user_preferences", "user_id"],
    ["user_editor_preferences", "user_id"],
  ]) {
    result[table] = (
      await db.query(
        `SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY ${field}),'')) AS hash FROM ${table} t`,
      )
    ).rows[0];
  }
  return result;
}
try {
  const before = await fingerprints();
  await run(["scripts/ops/migrate.ts"], { DATABASE_URL: target.href });
  assert.deepEqual(
    await fingerprints(),
    before,
    "Existing research, CRDT state, files, history and preferences must be unchanged.",
  );
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM members WHERE version<>1"))
      .rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM invitations WHERE content_role<>'editor' OR revoked_at IS NOT NULL",
      )
    ).rows[0].n,
    0,
  );
  console.log(
    "PASS: migration 9 preserves all research/state/file/history/preference fingerprints and initializes legacy memberships/invitations safely.",
  );
} finally {
  await db.end();
}
