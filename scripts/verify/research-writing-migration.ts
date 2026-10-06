import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
import EmbeddedPostgres from "embedded-postgres";
import * as Y from "yjs";
import {
  migration,
  forwardMigrations,
} from "../../packages/shared/src/migrations";
import { migrateDatabase } from "../../packages/shared/src/migrate-database";
// No dotenv, application URLs or working storage. Refuse an occupied test port.
await new Promise<void>((done, fail) => {
  const server = createServer();
  server.once("error", fail);
  server.listen(54340, "127.0.0.1", () =>
    server.close((error) => (error ? fail(error) : done())),
  );
});
await mkdir(resolve("data"), { recursive: true });
const root = await mkdtemp(resolve("data/research-writing-migration-")),
  password = randomBytes(24).toString("hex");
const database = new EmbeddedPostgres({
  databaseDir: join(root, "postgres"),
  user: "axiom_writing",
  password,
  port: 54340,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: console.error,
});
let running = false,
  status = "failed";
const latest = Math.max(...forwardMigrations.map((m) => m.version));
try {
  await database.initialise();
  await database.start();
  running = true;
  const client = new pg.Client({
    connectionString: `postgresql://axiom_writing:${password}@127.0.0.1:54340/postgres`,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(migration);
    await client.query(
      "CREATE TABLE schema_migrations(version integer PRIMARY KEY,name text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const item of forwardMigrations.filter((m) => m.version <= 43)) {
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      await client.query(item.sql);
      await client.query(
        "INSERT INTO schema_migrations(version,name) VALUES($1,$2)",
        [item.version, item.name],
      );
    }
    const group = randomUUID(),
      note = randomUUID(),
      reference = randomUUID(),
      source =
        "# Preserved manuscript\r\n\r\nUnchanged source [@preserved].\r\n";
    await client.query(
      "INSERT INTO \"user\"(id,name,email) VALUES('writing-fixture','Migration fixture','migration@axiom.test')",
    );
    await client.query(
      "INSERT INTO groups(id,name) VALUES($1,'Writing upgrade fixture')",
      [group],
    );
    await client.query(
      "INSERT INTO members(group_id,user_id,role) VALUES($1,'writing-fixture','owner')",
      [group],
    );
    await client.query(
      "INSERT INTO notes(id,group_id,author_id,title,body) VALUES($1,$2,'writing-fixture','Preserved manuscript',$3)",
      [note, group, source],
    );
    const doc = new Y.Doc();
    doc.getText("markdown").insert(0, source);
    await client.query(
      "INSERT INTO documents(room,note_id,state) VALUES($1,$2,$3)",
      [`note:${note}:1`, note, Buffer.from(Y.encodeStateAsUpdate(doc))],
    );
    doc.destroy();
    await client.query(
      "INSERT INTO bibliography(id,space_id,cite_key,title,bibtex,version) SELECT $1,space_id,'preserved','Prior bibliography','@article(preserved,title={Prior bibliography},custom={untouched})',7 FROM resources WHERE id=$2",
      [reference, note],
    );
    await client.query("COMMIT");
    const capture = async () => ({
      notes: (
        await client.query(
          "SELECT to_jsonb(n) AS note,encode(d.state,'hex') AS state FROM notes n JOIN documents d ON d.note_id=n.id WHERE n.id=$1",
          [note],
        )
      ).rows,
      references: (
        await client.query(
          "SELECT to_jsonb(b) AS reference FROM bibliography b WHERE id=$1",
          [reference],
        )
      ).rows,
    });
    const before = await capture();
    await client.query("BEGIN");
    await migrateDatabase(client);
    await client.query("COMMIT");
    assert.deepEqual(
      await capture(),
      before,
      "Upgrade changed original Markdown, Yjs state or bibliography.",
    );
    const baseline = (
      await client.query(
        "SELECT * FROM reference_provenance WHERE reference_id=$1",
        [reference],
      )
    ).rows;
    assert.equal(baseline.length, 1);
    assert.equal(baseline[0].kind, "baseline");
    assert.equal(baseline[0].version, 7);
    assert.equal(baseline[0].actor_id, null);
    assert.equal(baseline[0].before_data, null);
    assert.equal(
      baseline[0].after_data.bibtex,
      before.references[0].reference.bibtex,
    );
    await client.query("BEGIN");
    await migrateDatabase(client);
    await client.query("COMMIT");
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM reference_provenance",
        )
      ).rows[0].n,
      1,
      "Repeated migration duplicated baseline events.",
    );
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('axiom.actor_id','writing-fixture',true)",
    );
    await client.query(
      "UPDATE bibliography SET title='Reviewed update',version=version+1 WHERE id=$1",
      [reference],
    );
    await client.query("COMMIT");
    const edit = (
      await client.query(
        "SELECT * FROM reference_provenance WHERE reference_id=$1 AND kind='edit'",
        [reference],
      )
    ).rows[0];
    assert.equal(edit.before_data.title, "Prior bibliography");
    assert.equal(edit.after_data.title, "Reviewed update");
    assert.equal(edit.actor_id, "writing-fixture");
    assert.deepEqual((await capture()).notes, before.notes);
    assert.equal(
      (
        await client.query(
          "SELECT max(version) AS version FROM schema_migrations",
        )
      ).rows[0].version,
      latest,
    );
    status = "passed";
    console.log(
      `PASS: isolated 43 → ${latest} upgrade preserves Markdown/Yjs/raw bibliography, records honest baselines, is repeatable and captures subsequent edits.`,
    );
  } finally {
    await client.end();
  }
} finally {
  if (running) await database.stop();
  await writeFile(
    join(root, "receipt.json"),
    JSON.stringify(
      {
        status,
        from: 43,
        to: latest,
        scope:
          "Fictional fixtures and dedicated embedded PostgreSQL only; working data untouched",
        finishedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log("Migration evidence: " + root);
}
