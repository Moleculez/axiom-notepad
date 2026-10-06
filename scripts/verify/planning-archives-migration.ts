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

// No dotenv or configured application URLs/storage. Refuse an occupied test port.
const port = 54341;
await new Promise<void>((done, fail) => {
  const server = createServer();
  server.once("error", fail);
  server.listen(port, "127.0.0.1", () =>
    server.close((error) => (error ? fail(error) : done())),
  );
});
await mkdir(resolve("data"), { recursive: true });
const root = await mkdtemp(resolve("data/planning-archives-migration-")),
  password = randomBytes(24).toString("hex");
const database = new EmbeddedPostgres({
  databaseDir: join(root, "postgres"),
  user: "axiom_archives",
  password,
  port,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: console.error,
});
let running = false,
  status = "failed";
const to = Math.max(...forwardMigrations.map((m) => m.version));
try {
  await database.initialise();
  await database.start();
  running = true;
  const client = new pg.Client({
    connectionString: `postgresql://axiom_archives:${password}@127.0.0.1:${port}/postgres`,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(migration);
    await client.query(
      "CREATE TABLE schema_migrations(version integer PRIMARY KEY,name text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const item of forwardMigrations.filter((m) => m.version <= 44)) {
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
      goal = randomUUID(),
      routine = randomUUID(),
      task = randomUUID();
    const source =
      "# Preserved manuscript\r\n\r\nCanonical $E=mc^2$ source.\r\n";
    await client.query(
      "INSERT INTO \"user\"(id,name,email) VALUES('archive-migration','Upgrade fixture','archives@axiom.test')",
    );
    await client.query(
      "INSERT INTO groups(id,name) VALUES($1,'Archive upgrade fixture')",
      [group],
    );
    await client.query(
      "INSERT INTO members(group_id,user_id,role) VALUES($1,'archive-migration','owner')",
      [group],
    );
    await client.query(
      "INSERT INTO notes(id,group_id,author_id,title,body) VALUES($1,$2,'archive-migration','Original manuscript',$3)",
      [note, group, source],
    );
    const doc = new Y.Doc();
    doc.getText("markdown").insert(0, source);
    await client.query(
      "INSERT INTO documents(room,note_id,state) VALUES($1,$2,$3)",
      [`note:${note}:1`, note, Buffer.from(Y.encodeStateAsUpdate(doc))],
    );
    doc.destroy();
    const space = (
      await client.query("SELECT space_id FROM resources WHERE id=$1", [note])
    ).rows[0].space_id;
    await client.query(
      "INSERT INTO planning_goals(id,space_id,title,body,owner_id,kind,target,current_value,archived,version,created_at) VALUES($1,$2,'Preserved goal',$3,'archive-migration','metric',10,4,true,13,'2026-10-06T03:01:02.123456Z')",
      [goal, space, source],
    );
    await client.query(
      "INSERT INTO planning_history(space_id,entity_id,kind,actor_id,summary,created_at) SELECT $1,$2,'goal','archive-migration','Preserved change '||n,'2026-10-06T03:01:02Z'::timestamptz+(n/10)*interval '1 microsecond' FROM generate_series(1,250) n",
      [space, goal],
    );
    await client.query(
      'INSERT INTO task_recurrences(id,space_id,project_id,created_by,rule,template,enabled,version) SELECT $1,id,project_id,\'archive-migration\',\'{"frequency":"daily","interval":1,"start":"2026-01-01"}\',\'{"title":"Preserved routine"}\',false,9 FROM spaces WHERE id=$2',
      [routine, space],
    );
    await client.query(
      "INSERT INTO tasks(id,space_id,project_id,title,body,created_by,version) SELECT $1,id,project_id,'Preserved generated task',$3,'archive-migration',7 FROM spaces WHERE id=$2",
      [task, space, source],
    );
    await client.query(
      "INSERT INTO task_occurrences(recurrence_id,occurs_on,task_id) VALUES($1,'2026-01-01',$2)",
      [routine, task],
    );
    await client.query("COMMIT");
    const capture = async () => {
      const records = [];
      for (const sql of [
        "SELECT to_jsonb(n) AS data,encode(d.state,'hex') AS state FROM notes n JOIN documents d ON d.note_id=n.id ORDER BY n.id",
        "SELECT to_jsonb(g) AS data FROM planning_goals g ORDER BY id",
        "SELECT to_jsonb(h) AS data FROM planning_history h ORDER BY id",
        "SELECT to_jsonb(r) AS data FROM task_recurrences r ORDER BY id",
        "SELECT to_jsonb(t)-'custom_fields' AS data FROM tasks t ORDER BY id",
        "SELECT to_jsonb(o) AS data FROM task_occurrences o ORDER BY recurrence_id,occurs_on",
      ])
        records.push((await client.query(sql)).rows);
      return records;
    };
    const before = await capture();
    await client.query("BEGIN");
    await migrateDatabase(client);
    await client.query("COMMIT");
    assert.deepEqual(
      await capture(),
      before,
      "Archive upgrade altered source, identities, versions or existing history.",
    );
    await client.query("BEGIN");
    await migrateDatabase(client);
    await client.query("COMMIT");
    assert.deepEqual(
      await capture(),
      before,
      "Repeated migration changed retained data.",
    );
    assert.equal(
      (
        await client.query(
          "SELECT max(version) AS version FROM schema_migrations",
        )
      ).rows[0].version,
      to,
    );
    for (const index of [
      "planning_goals_created_page",
      "planning_history_created_page",
    ])
      assert.equal(
        (
          await client.query(
            "SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass($1)",
            [index],
          )
        ).rows[0].indisvalid,
        true,
      );
    const newest = (
      await client.query(
        "SELECT id FROM planning_history WHERE space_id=$1 AND entity_id=$2 ORDER BY created_at DESC,id DESC LIMIT 37",
        [space, goal],
      )
    ).rows;
    const last = newest.at(-1)!.id;
    const following = (
      await client.query(
        "SELECT id FROM planning_history WHERE space_id=$1 AND entity_id=$2 AND (created_at,id)<(SELECT created_at,id FROM planning_history WHERE id=$3) ORDER BY created_at DESC,id DESC LIMIT 37",
        [space, goal, last],
      )
    ).rows;
    assert.equal(new Set([...newest, ...following].map((r) => r.id)).size, 74);
    status = "passed";
    console.log(
      `PASS: isolated 44 → ${to} upgrade and repeat preserve six record sets, exact CRLF/Yjs source, versions and microsecond history; both paging indexes are valid.`,
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
        from: 44,
        to,
        recordSets: 6,
        scope:
          "Fictional fixtures in a new embedded PostgreSQL cluster; working data untouched",
        finishedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log("Migration evidence: " + root);
}
