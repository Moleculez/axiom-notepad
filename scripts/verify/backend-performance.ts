import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import { build } from "esbuild";
import {
  migration,
  forwardMigrations,
} from "../../packages/shared/src/migrations";
import { migrateDatabase } from "../../packages/shared/src/migrate-database";

// No dotenv, existing database, application service, attachment storage or remote
// provider. This process creates, owns and stops its own retained fixture cluster.
const port = 54349;
await new Promise<void>((done, fail) => {
  const server = createServer();
  server.once("error", fail);
  server.listen(port, "127.0.0.1", () =>
    server.close((error) => (error ? fail(error) : done())),
  );
});
await mkdir(resolve("data"), { recursive: true });
const root = await mkdtemp(resolve("data/performance-audit-"));
const password = randomBytes(24).toString("hex");
const connectionString = `postgresql://axiom_backend:${password}@127.0.0.1:${port}/postgres`;
process.env.DATABASE_URL = connectionString;
process.env.SYNC_SECRET = "isolated-backend-performance-fixture-secret";
process.env.APP_URL = "http://localhost:3004";
Object.assign(process.env, { NODE_ENV: "test" });
const database = new EmbeddedPostgres({
  databaseDir: join(root, "postgres"),
  user: "axiom_backend",
  password,
  port,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: console.error,
});
const baselineCommit = "afd0065";
const receipt: Record<string, unknown> = {
  status: "failed",
  baselineCommit,
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  fixture: { targetNotes: 1000, links: 100100, folders: 50003, tasks: 5001 },
  candidateSources: Object.fromEntries(
    await Promise.all(
      [
        "documents.ts",
        "planning-api.ts",
        "planning-progress.ts",
        "workspace-api.ts",
      ].map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(resolve("packages/shared/src", file)))
          .digest("hex"),
      ]),
    ),
  ),
  lockHash: createHash("sha256")
    .update(await readFile(resolve("package-lock.json")))
    .digest("hex"),
  warmups: 3,
  measured: 20,
  scope:
    "Same-host synthetic server handlers/SQL only, not network or input-to-paint; no working data or storage",
  reports: {},
  plans: {},
};
let running = false;
let client: pg.Client | undefined;
let pool: pg.Pool | undefined;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const p95 = (samples: number[]) =>
  [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
type Handler = (
  request: Request,
  path: string[],
  user: string,
) => Promise<Response | null>;
async function baseline(name: string) {
  const source = execFileSync(
    "git",
    ["show", `${baselineCommit}:packages/shared/src/${name}.ts`],
    { encoding: "utf8" },
  );
  const output = join(root, `baseline-${name}.mjs`);
  await build({
    stdin: {
      contents: source,
      resolveDir: resolve("packages/shared/src"),
      sourcefile: `${name}.ts`,
      loader: "ts",
    },
    outfile: output,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  await chmod(output, 0o600);
  return import(pathToFileURL(output).href);
}
try {
  await database.initialise();
  await database.start();
  running = true;
  client = new pg.Client({ connectionString, statement_timeout: 30000 });
  await client.connect();
  const db = client;
  assert.equal(
    (await db.query("SELECT current_database() AS name")).rows[0].name,
    "postgres",
  );
  // Start before the prospective performance migration so its before/after
  // index evidence remains honest when this probe is rerun after it is added.
  await db.query("BEGIN");
  await db.query(migration);
  await db.query(
    "CREATE TABLE schema_migrations(version integer PRIMARY KEY,name text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const item of forwardMigrations.filter((item) => item.version <= 49)) {
    await db.query("SET CONSTRAINTS ALL IMMEDIATE");
    await db.query("SET CONSTRAINTS ALL DEFERRED");
    await db.query(item.sql);
    await db.query(
      "INSERT INTO schema_migrations(version,name) VALUES($1,$2)",
      [item.version, item.name],
    );
  }
  await db.query("COMMIT");
  const owner = "backend-fixture-owner",
    outsider = "backend-fixture-outsider";
  await db.query(
    'INSERT INTO "user"(id,name,email) VALUES($1,$1,$3),($2,$2,$4)',
    [
      owner,
      outsider,
      "backend-owner@axiom.test",
      "backend-outsider@axiom.test",
    ],
  );
  const group = randomUUID(),
    otherGroup = randomUUID();
  await db.query(
    "INSERT INTO groups(id,name) VALUES($1,'Synthetic backend performance'),($2,'Other synthetic scope')",
    [group, otherGroup],
  );
  await db.query(
    "INSERT INTO members(group_id,user_id,role,content_role) VALUES($1,$3,'owner','editor'),($2,$3,'owner','editor')",
    [group, otherGroup, owner],
  );
  const sourceId = randomUUID();
  await db.query(
    "INSERT INTO notes(id,group_id,author_id,title) VALUES($1,$2,$3,'Source fixture')",
    [sourceId, group, owner],
  );
  await db.query(
    "INSERT INTO notes(group_id,author_id,title) SELECT $1,$2,'Target '||i FROM generate_series(1,1000) i",
    [group, owner],
  );
  const space = (
    await db.query("SELECT space_id FROM resources WHERE note_id=$1", [
      sourceId,
    ])
  ).rows[0].space_id;
  const targetRows = (
    await db.query(
      "SELECT id,title FROM notes WHERE group_id=$1 AND title LIKE 'Target %' ORDER BY title",
      [group],
    )
  ).rows;
  const targetIds = targetRows.map((row) => row.id);
  const contextNote = targetIds[999];
  await db.query(
    "INSERT INTO note_links(source_id,target,target_id) SELECT ($1::uuid[])[(i%900)+1],'edge-'||i,($1::uuid[])[(i%900)+1] FROM generate_series(1,100000) i",
    [targetIds],
  );
  await db.query(
    "INSERT INTO note_links(source_id,target,target_id) SELECT ($1::uuid[])[(i%900)+1],'incoming-'||i,$2 FROM generate_series(1,100) i",
    [targetIds, contextNote],
  );
  await db.query(
    "INSERT INTO resources(space_id,kind,name,owner_id) SELECT $1,'folder','Synthetic folder '||i,$2 FROM generate_series(1,5000) i",
    [space, owner],
  );
  await db.query(
    "INSERT INTO resources(space_id,kind,name,owner_id) VALUES($1,'folder','literal %_\\ token',$2),($1,'folder','literal non-wildcard token',$2),($1,'folder','Ωmega RESEARCH',$2)",
    [space, owner],
  );
  const parent = randomUUID();
  await db.query(
    "INSERT INTO tasks(id,space_id,created_by,title,position) VALUES($1,$2,$3,'Visible parent',-1)",
    [parent, space, owner],
  );
  await db.query(
    "INSERT INTO tasks(space_id,created_by,title,parent_id,status,progress_percent,position) SELECT $1,$2,'Leaf '||i,CASE WHEN i<=100 THEN $3::uuid END,CASE WHEN i%2=0 THEN 'done' ELSE 'todo' END,20,i FROM generate_series(1,5000) i",
    [space, owner, parent],
  );
  await db.query("ANALYZE");
  const candidateDocuments =
    await import("../../packages/shared/src/documents");
  const candidatePlanning =
    await import("../../packages/shared/src/planning-api");
  const candidateWorkspace =
    await import("../../packages/shared/src/workspace-api");
  pool = (await import("../../packages/shared/src/db")).pool;
  const oldDocuments = await baseline("documents"),
    oldPlanning = await baseline("planning-api"),
    oldWorkspace = await baseline("workspace-api");
  let queries = 0;
  const originals = new WeakMap<pg.PoolClient, pg.PoolClient["query"]>();
  pool.on("acquire", (connection) => {
    const original = connection.query;
    originals.set(connection, original);
    connection.query = ((...args: unknown[]) => {
      queries++;
      return Reflect.apply(original, connection, args);
    }) as typeof connection.query;
  });
  pool.on("release", (_error, connection) => {
    const original = originals.get(connection);
    if (original) connection.query = original;
    originals.delete(connection);
  });
  const tracked = {
    query: async (sql: string, args: unknown[] = []) => {
      queries++;
      return db.query(sql, args);
    },
  } as unknown as pg.PoolClient;
  const reports = receipt.reports as Record<string, unknown>;
  async function sample(
    name: string,
    work: () => Promise<unknown>,
    stable?: (value: any) => unknown,
  ) {
    const samples: number[] = [],
      counts: number[] = [];
    let resultHash = "";
    for (let i = 0; i < 23; i++) {
      if (interrupted)
        throw new Error("Backend fixture interrupted; evidence retained.");
      const count = queries,
        started = performance.now();
      const value = await work();
      const elapsed = performance.now() - started,
        currentHash = hash(stable ? stable(value) : value);
      if (resultHash)
        assert.equal(
          currentHash,
          resultHash,
          `Changed semantic result: ${name}`,
        );
      resultHash = currentHash;
      if (i >= 3) {
        samples.push(elapsed);
        counts.push(queries - count);
      }
    }
    const report = { samples, queries: counts, resultHash, p95: p95(samples) };
    reports[name] = report;
    console.log(
      `${name}: p95 ${report.p95.toFixed(2)}ms, ${Math.min(...counts)}–${Math.max(...counts)} SQL statements`,
    );
    return report;
  }
  async function call(handler: Handler, path: string) {
    const response = await handler(
      new Request(`http://localhost:3004/api/v1/${path}`),
      path.split("?")[0].split("/"),
      owner,
    );
    assert(response?.ok);
    return response.json();
  }
  const comparisons: Record<string, unknown> = {};
  const plans = receipt.plans as Record<string, unknown>;
  const explain = async (sql: string, args: unknown[]) =>
    (await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, args))
      .rows[0]["QUERY PLAN"];
  const insertRoots = async () => {
    await tracked.query("BEGIN");
    try {
      const result = await tracked.query(
        "INSERT INTO resources(space_id,kind,name,owner_id) SELECT $1,'folder','Transient synthetic root '||i,$2 FROM generate_series(1,100) i RETURNING kind",
        [space, owner],
      );
      await tracked.query("ROLLBACK");
      return result.rows;
    } catch (error) {
      await tracked.query("ROLLBACK");
      throw error;
    }
  };
  const rootBefore = await sample("root-insert-100-baseline", insertRoots);
  plans.parentsBefore = await explain(
    "SELECT 1 FROM resources WHERE parent_id=$1 AND space_id<>$2",
    [randomUUID(), space],
  );
  await db.query(
    "CREATE INDEX backend_fixture_resource_parents ON resources(parent_id,space_id) WHERE parent_id IS NOT NULL",
  );
  const rootAfter = await sample("root-insert-100-candidate", insertRoots);
  assert.equal(rootAfter.resultHash, rootBefore.resultHash);
  plans.parentsAfter = await explain(
    "SELECT 1 FROM resources WHERE parent_id=$1 AND space_id<>$2",
    [randomUUID(), space],
  );
  comparisons.rootInsert = { ratio: rootAfter.p95 / rootBefore.p95 };
  // This temporary index is shared by both handlers only while growing the
  // synthetic corpus. Its insertion measurement above did not prove a benefit;
  // it is not a proposed production migration.
  await db.query(
    "INSERT INTO resources(space_id,kind,name,owner_id) SELECT $1,'folder','Synthetic folder '||i,$2 FROM generate_series(5001,50000) i",
    [space, owner],
  );
  await db.query("ANALYZE resources");
  await db.query("DROP INDEX backend_fixture_resource_parents");
  for (const count of [100, 1000]) {
    const source = Array.from(
      { length: count },
      (_, i) => `[[Target ${i + 1}]]`,
    ).join("\n");
    await db.query("UPDATE notes SET body=$2 WHERE id=$1", [sourceId, source]);
    const run = (index: typeof candidateDocuments.indexNote) => async () => {
      await tracked.query("BEGIN");
      try {
        await index(`${sourceId}:1`, source, tracked);
        await tracked.query("COMMIT");
      } catch (error) {
        await tracked.query("ROLLBACK");
        throw error;
      }
      return (
        await tracked.query(
          "SELECT target,target_id FROM note_links WHERE source_id=$1 ORDER BY target",
          [sourceId],
        )
      ).rows;
    };
    const before = await sample(
      `links-${count}-baseline`,
      run(oldDocuments.indexNote),
    );
    const after = await sample(
      `links-${count}-candidate`,
      run(candidateDocuments.indexNote),
    );
    assert.equal(after.resultHash, before.resultHash);
    comparisons[`links-${count}`] = {
      ratio: after.p95 / before.p95,
      queriesBefore: before.queries[0],
      queriesAfter: after.queries[0],
    };
  }
  const planningSummary = (value: any) => ({
    total: value.total,
    completed: value.completed,
    items: value.items.map((task: any) => ({
      id: task.id,
      progress: task.derived_progress_percent,
      body: task.body,
    })),
  });
  for (const [name, query] of [
    ["planning-parent-page", "limit=20"],
    ["planning-leaf-page", "limit=20&q=Leaf"],
  ]) {
    const before = await sample(
      `${name}-baseline`,
      () => call(oldPlanning.planningApi, `spaces/${space}/planning?${query}`),
      planningSummary,
    );
    const after = await sample(
      `${name}-candidate`,
      () =>
        call(
          candidatePlanning.planningApi,
          `spaces/${space}/planning?${query}`,
        ),
      planningSummary,
    );
    assert.equal(after.resultHash, before.resultHash);
    comparisons[name] = {
      ratio: after.p95 / before.p95,
      queriesBefore: before.queries[0],
      queriesAfter: after.queries[0],
    };
  }
  const directoryPath = `resources?spaceId=${space}&name=${encodeURIComponent("Synthetic folder 49999")}`;
  const summarizeDirectory = (value: any) => ({
    ids: value.items.map((item: any) => item.id),
    next: value.nextCursor,
  });
  const directoryBefore = await sample(
    "directory-name-baseline",
    () => call(oldWorkspace.workspaceApi, directoryPath),
    summarizeDirectory,
  );
  const directoryAfter = await sample(
    "directory-name-candidate",
    () => call(candidateWorkspace.workspaceApi, directoryPath),
    summarizeDirectory,
  );
  assert.equal(directoryAfter.resultHash, directoryBefore.resultHash);
  comparisons.directory = { ratio: directoryAfter.p95 / directoryBefore.p95 };
  for (const name of ["%_\\", "Ωmega research"]) {
    assert.deepEqual(
      summarizeDirectory(
        await call(
          oldWorkspace.workspaceApi,
          `resources?spaceId=${space}&name=${encodeURIComponent(name)}`,
        ),
      ),
      summarizeDirectory(
        await call(
          candidateWorkspace.workspaceApi,
          `resources?spaceId=${space}&name=${encodeURIComponent(name)}`,
        ),
      ),
    );
  }
  plans.directoryBefore = await explain(
    "SELECT id FROM resources WHERE space_id=$1 AND strpos(lower(name),lower($2))>0",
    [space, "Synthetic folder 49999"],
  );
  plans.directoryAfter = await explain(
    "SELECT id FROM resources WHERE space_id=$1 AND lower(name) LIKE lower($2)",
    [space, "%Synthetic folder 49999%"],
  );
  const contextSummary = (value: any) =>
    value.links
      .map((link: any) => ({
        source: link.source_id,
        target: link.target,
        targetId: link.target_id,
      }))
      .sort((a: any, b: any) => a.target.localeCompare(b.target));
  const backlinksBefore = await sample(
    "backlink-context-baseline",
    () => call(candidateWorkspace.workspaceApi, `notes/${contextNote}/context`),
    contextSummary,
  );
  plans.backlinksBefore = await explain(
    "SELECT * FROM note_links WHERE source_id=$1 OR target_id=$1 LIMIT 200",
    [contextNote],
  );
  await db.query(
    "CREATE INDEX backend_fixture_reverse_links ON note_links(target_id,source_id) WHERE target_id IS NOT NULL",
  );
  await db.query("ANALYZE note_links");
  const backlinksAfter = await sample(
    "backlink-context-candidate",
    () => call(candidateWorkspace.workspaceApi, `notes/${contextNote}/context`),
    contextSummary,
  );
  assert.equal(backlinksAfter.resultHash, backlinksBefore.resultHash);
  plans.backlinksAfter = await explain(
    "SELECT * FROM note_links WHERE source_id=$1 OR target_id=$1 LIMIT 200",
    [contextNote],
  );
  comparisons.backlinks = { ratio: backlinksAfter.p95 / backlinksBefore.p95 };
  await db.query("DROP INDEX backend_fixture_reverse_links");
  // Real SQL ambiguity, fragments, scope isolation and unchanged-body reindex.
  await db.query(
    "INSERT INTO notes(group_id,author_id,title) VALUES($1,$2,'Ambiguous'),($1,$2,'ambiguous'),($3,$2,'Outside only'),($1,$2,$4)",
    [group, owner, otherGroup, targetIds[0]],
  );
  const semanticSource = `[[Ambiguous]] [[Outside only]] [[${targetIds[0]}]] [[Target 1#one]] [[Target 1#two]] [[Missing]]`;
  await db.query("UPDATE notes SET body=$2 WHERE id=$1", [
    sourceId,
    semanticSource,
  ]);
  await candidateDocuments.indexNote(`${sourceId}:1`, semanticSource, tracked);
  const semantics = (
    await db.query(
      "SELECT target,target_id FROM note_links WHERE source_id=$1 ORDER BY target",
      [sourceId],
    )
  ).rows;
  assert(
    semantics
      .filter((row) =>
        ["Ambiguous", "Outside only", targetIds[0], "Missing"].includes(
          row.target,
        ),
      )
      .every((row) => row.target_id === null),
  );
  assert(
    semantics
      .filter((row) => row.target.startsWith("Target 1#"))
      .every((row) => row.target_id !== null),
  );
  const outsiderResponse = await candidateWorkspace
    .workspaceApi(
      new Request(`http://localhost:3004/api/v1/resources?spaceId=${space}`),
      ["resources"],
      outsider,
    )
    .catch((error: unknown) => error);
  assert(
    outsiderResponse instanceof Error,
    "Unauthorized fixture scope became visible.",
  );
  const preserved = (await db.query("SELECT id,body FROM notes ORDER BY id"))
    .rows;
  await db.query("BEGIN");
  await migrateDatabase(db);
  await db.query("COMMIT");
  await db.query("BEGIN");
  await migrateDatabase(db);
  await db.query("COMMIT");
  assert.deepEqual(
    (await db.query("SELECT id,body FROM notes ORDER BY id")).rows,
    preserved,
  );
  receipt.status = "passed";
  receipt.comparisons = comparisons;
  receipt.peakRssKb = process.resourceUsage().maxRSS;
  receipt.currentMigration = Math.max(
    ...forwardMigrations.map((item) => item.version),
  );
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await pool?.end();
  await client?.end();
  if (running) await database.stop();
  receipt.finishedAt = new Date().toISOString();
  await writeFile(
    join(root, "receipt.json"),
    JSON.stringify(receipt, null, 2),
    { mode: 0o600 },
  );
  console.log(`Backend performance evidence: ${root}`);
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
