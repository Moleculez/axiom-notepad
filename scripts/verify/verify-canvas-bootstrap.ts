import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import pg from "pg";
import { migrateDatabase } from "../../packages/shared/src/migrate-database";

const target = new URL(process.env.DATABASE_URL!);
if (!["127.0.0.1", "localhost"].includes(target.hostname))
  throw new Error("Bootstrap verification requires local PostgreSQL.");
const database = `axiom_canvas_setup_test_${Date.now()}`;
target.pathname = "/postgres";
const admin = new pg.Client({ connectionString: target.href });
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
await admin.end();
target.pathname = "/" + database;
process.env.DATABASE_URL = target.href;
process.env.APP_URL = "http://localhost:3005";
Object.assign(process.env, { NODE_ENV: "test" });
process.env.AXIOM_DEV_SETUP = "1";
const { pool } = await import("../../packages/shared/src/db");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await migrateDatabase(client);
  await client.query("COMMIT");
  const { instanceApi, assertDataset, instanceIdentity } =
    await import("../../packages/shared/src/instance");
  const token = randomBytes(32).toString("base64url");
  await client.query("UPDATE app_instance SET setup_token_hash=$1", [
    createHash("sha256").update(token).digest("hex"),
  ]);
  const payload = {
    token,
    email: "first-owner@axiom.test",
    name: "First owner",
    password: "BootstrapVerification2026!",
    groupName: "Research",
  };
  const setup = (overrides: Record<string, unknown> = {}) =>
    instanceApi(
      new Request("http://localhost:3005/api/v1/development-setup", {
        method: "POST",
        headers: {
          origin: "http://localhost:3005",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...payload, ...overrides }),
      }),
      ["development-setup"],
    );
  assert.equal((await instanceIdentity()).setupRequired, true);
  await assert.rejects(
    () => setup({ token: "x".repeat(43) }),
    /token is incorrect/,
  );
  Object.assign(process.env, { NODE_ENV: "production" });
  await assert.rejects(() => setup(), /unavailable/);
  Object.assign(process.env, { NODE_ENV: "test" });
  await assert.rejects(
    () =>
      assertDataset(
        new Request("http://localhost:3005/api/v1/resources", {
          headers: { "X-Axiom-Dataset": "old-dataset" },
        }),
      ),
    /replaced/,
  );
  // Simulate failure between Better Auth's account creation and group commit.
  await client.query(
    "CREATE FUNCTION reject_setup_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name='fail-once' THEN RAISE EXCEPTION 'fixture group failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_setup_failure BEFORE INSERT ON groups FOR EACH ROW EXECUTE FUNCTION reject_setup_fixture()",
  );
  await assert.rejects(
    () => setup({ groupName: "fail-once" }),
    /fixture group failure/,
  );
  assert.equal(
    (await client.query('SELECT count(*)::int AS n FROM "user"')).rows[0].n,
    1,
  );
  assert.equal(
    (await client.query("SELECT count(*)::int AS n FROM groups")).rows[0].n,
    0,
  );
  assert.equal((await instanceIdentity()).setupRequired, true);
  await assert.rejects(
    () => setup({ email: "different@axiom.test" }),
    /original email/,
  );
  await assert.rejects(() => setup({ password: "IncorrectPassword2026!" }));
  const results = await Promise.allSettled([setup(), setup()]);
  assert.equal(
    results.filter((r) => r.status === "fulfilled" && r.value?.status === 201)
      .length,
    1,
  );
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(
    (await client.query("SELECT count(*)::int AS n FROM groups")).rows[0].n,
    1,
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM members WHERE role='owner'",
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await instanceIdentity()).setupRequired, false);
  assert.equal(
    (await client.query("SELECT setup_token_hash FROM app_instance")).rows[0]
      .setup_token_hash,
    null,
  );
  assert.equal(
    (await client.query("SELECT count(*)::int AS n FROM notes")).rows[0].n,
    0,
  );
  await assert.rejects(() => setup(), /already finished/);
  console.log(
    `Bootstrap verification passed: token rejection, production guard, stale-dataset guard, partial-failure recovery, password validation, concurrent completion, single owner/group, no demo content. Isolated database retained: ${database}`,
  );
} finally {
  client.release();
  await pool.end();
}
