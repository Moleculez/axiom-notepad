import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import * as Y from "yjs";
import {
  migration,
  forwardMigrations,
} from "../../packages/shared/src/migrations";
import { migrateDatabase } from "../../packages/shared/src/migrate-database";

// Never load .env or attach to an existing cluster. Both comparisons own the
// same fresh, retained corpus, permissions and process runtime.
const port = 54349;
await new Promise<void>((done, fail) => {
  const server = createServer();
  server.once("error", fail);
  server.listen(port, "127.0.0.1", () =>
    server.close((error) => (error ? fail(error) : done())),
  );
});
await mkdir(resolve("data"), { recursive: true });
const root = await mkdtemp(resolve("data/performance-audit-backlinks-"));
const password = randomBytes(24).toString("hex");
const database = new EmbeddedPostgres({
  databaseDir: join(root, "postgres"),
  user: "axiom_backlinks",
  password,
  port,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: console.error,
});
const client = new pg.Client({
  connectionString: `postgresql://axiom_backlinks:${password}@127.0.0.1:${port}/postgres`,
  statement_timeout: 30000,
});
const receipt: Record<string, unknown> = {
  status: "failed",
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  warmups: 3,
  measured: 20,
  fixture: { notes: 1000, links: 100100, incoming: 100 },
  scope:
    "Direct reverse-link SQL and permission-filtered SQL only; not an entire page or uncontended handler benchmark",
};
let running = false,
  connected = false,
  interrupted = false;
const stop = () => {
  interrupted = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  await database.initialise();
  await database.start();
  running = true;
  await client.connect();
  connected = true;
  await client.query("BEGIN");
  await client.query(migration);
  await client.query(
    "CREATE TABLE schema_migrations(version integer PRIMARY KEY,name text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const item of forwardMigrations.filter((item) => item.version <= 49)) {
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query(item.sql);
    await client.query(
      "INSERT INTO schema_migrations(version,name) VALUES($1,$2)",
      [item.version, item.name],
    );
  }
  await client.query("COMMIT");
  const owner = "backlink-fixture-owner",
    group = randomUUID();
  await client.query(
    "INSERT INTO \"user\"(id,name,email) VALUES($1,$1,'backlinks@axiom.test')",
    [owner],
  );
  await client.query(
    "INSERT INTO groups(id,name) VALUES($1,'Synthetic backlinks')",
    [group],
  );
  await client.query(
    "INSERT INTO members(group_id,user_id,role,content_role) VALUES($1,$2,'owner','editor')",
    [group, owner],
  );
  await client.query(
    "INSERT INTO notes(group_id,author_id,title) SELECT $1,$2,'Target '||i FROM generate_series(1,1000) i",
    [group, owner],
  );
  const ids = (
    await client.query(
      "SELECT id FROM notes WHERE group_id=$1 ORDER BY title",
      [group],
    )
  ).rows.map((row) => row.id);
  const target = ids[999];
  await client.query(
    "INSERT INTO note_links(source_id,target,target_id) SELECT ($1::uuid[])[(i%900)+1],'edge-'||i,($1::uuid[])[(i%900)+1] FROM generate_series(1,100000) i",
    [ids],
  );
  await client.query(
    "INSERT INTO note_links(source_id,target,target_id) SELECT ($1::uuid[])[(i%900)+1],'incoming-'||i,$2 FROM generate_series(1,100) i",
    [ids, target],
  );
  await client.query("ANALYZE");
  const queries = {
    lookup: {
      sql: "SELECT * FROM note_links WHERE source_id=$1 OR target_id=$1 LIMIT 200",
      args: [target],
    },
    authorized: {
      sql: "SELECT l.*,n.title AS source_title,t.title AS target_title FROM note_links l JOIN notes n ON n.id=l.source_id LEFT JOIN notes t ON t.id=l.target_id WHERE (l.source_id=$2 OR l.target_id=$2) AND axiom_can_read_note($1,l.source_id) AND (l.target_id IS NULL OR axiom_can_read_note($1,l.target_id)) LIMIT 200",
      args: [owner, target],
    },
  };
  const samples: Record<string, unknown> = {},
    plans: Record<string, unknown> = {};
  async function measure(name: string, query: { sql: string; args: string[] }) {
    const times: number[] = [];
    let semanticHash = "";
    for (let i = 0; i < 23; i++) {
      if (interrupted)
        throw new Error("Interrupted; fixture evidence retained.");
      const started = performance.now();
      const result = await client.query(query.sql, query.args);
      const elapsed = performance.now() - started;
      assert.equal(result.rows.length, 100);
      const nextHash = createHash("sha256")
        .update(
          JSON.stringify(
            result.rows.sort((a, b) => a.target.localeCompare(b.target)),
          ),
        )
        .digest("hex");
      if (semanticHash) assert.equal(nextHash, semanticHash);
      semanticHash = nextHash;
      if (i >= 3) times.push(elapsed);
    }
    const p95 = [...times].sort((a, b) => a - b)[18];
    const report = { times, semanticHash, p95, count: 100, queries: 1 };
    samples[name] = report;
    plans[name] = (
      await client.query(
        `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${query.sql}`,
        query.args,
      )
    ).rows[0]["QUERY PLAN"];
    console.log(`${name}: ${p95.toFixed(2)} ms p95, 100 results`);
    return report;
  }
  const before = {
    lookup: await measure("lookup-before", queries.lookup),
    authorized: await measure("authorized-before", queries.authorized),
  };
  await client.query(
    "CREATE INDEX backend_fixture_reverse_links ON note_links(target_id,source_id) WHERE target_id IS NOT NULL",
  );
  await client.query("ANALYZE note_links");
  const after = {
    lookup: await measure("lookup-after", queries.lookup),
    authorized: await measure("authorized-after", queries.authorized),
  };
  assert.equal(before.lookup.semanticHash, after.lookup.semanticHash);
  assert.equal(before.authorized.semanticHash, after.authorized.semanticHash);
  await client.query("DROP INDEX backend_fixture_reverse_links");
  const source = "# Preserved source\r\n\r\n[[Target 1]] and exact bytes.\r\n";
  const doc = new Y.Doc();
  doc.getText("markdown").insert(0, source);
  await client.query("UPDATE notes SET body=$2 WHERE id=$1", [target, source]);
  await client.query(
    "INSERT INTO documents(room,note_id,state) VALUES($1,$2,$3)",
    [`${target}:1`, target, Buffer.from(Y.encodeStateAsUpdate(doc))],
  );
  doc.destroy();
  const capture = async () => ({
    source: (
      await client.query(
        "SELECT n.body,encode(d.state,'hex') AS state FROM notes n JOIN documents d ON d.note_id=n.id WHERE n.id=$1",
        [target],
      )
    ).rows,
    links: (
      await client.query(
        "SELECT count(*)::integer AS count,md5(string_agg(source_id::text||':'||target||':'||coalesce(target_id::text,''),'|' ORDER BY source_id,target)) AS hash FROM note_links",
      )
    ).rows,
  });
  const preserved = await capture();
  await client.query("BEGIN");
  try {
    await migrateDatabase(client);
    await client.query("SELECT 1/0");
    assert.fail("Rollback fixture did not fail.");
  } catch {
    await client.query("ROLLBACK");
  }
  assert.equal(
    (
      await client.query(
        "SELECT to_regclass('note_links_target_source') AS name",
      )
    ).rows[0].name,
    null,
  );
  assert.equal(
    (
      await client.query(
        "SELECT max(version) AS version FROM schema_migrations",
      )
    ).rows[0].version,
    49,
  );
  assert.deepEqual(await capture(), preserved);
  for (let attempt = 0; attempt < 2; attempt++) {
    await client.query("BEGIN");
    await migrateDatabase(client);
    await client.query("COMMIT");
    assert.deepEqual(await capture(), preserved);
  }
  const index = (
    await client.query(
      "SELECT indexdef FROM pg_indexes WHERE indexname='note_links_target_source'",
    )
  ).rows;
  assert.equal(index.length, 1);
  assert.match(
    index[0].indexdef,
    /\(target_id, source_id\).*WHERE \(target_id IS NOT NULL\)/,
  );
  Object.assign(receipt, {
    status: "passed",
    samples,
    plans,
    ratios: {
      lookup: after.lookup.p95 / before.lookup.p95,
      authorized: after.authorized.p95 / before.authorized.p95,
    },
    migration: {
      version: 50,
      rollbackPreserved: true,
      repeatedUpgradePreserved: true,
      index: index[0].indexdef,
    },
  });
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  if (connected) await client.end();
  if (running) await database.stop();
  receipt.finishedAt = new Date().toISOString();
  await writeFile(
    join(root, "receipt.json"),
    JSON.stringify(receipt, null, 2),
    { mode: 0o600 },
  );
  console.log(`Backlink SQL evidence: ${root}`);
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
