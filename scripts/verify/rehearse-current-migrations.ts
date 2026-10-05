import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import * as Y from "yjs";
import {
  migration,
  forwardMigrations,
} from "../../packages/shared/src/migrations";
import { migrateDatabase } from "../../packages/shared/src/migrate-database";
import { verifyRestoredImportTransfers } from "./restore-import-fixture";

// Fresh disposable databases only. Never restore, reset or migrate the configured
// application database. Retain receipts/databases for operator inspection.
const configured = new URL(process.env.DATABASE_URL ?? "");
assert(
  process.env.NODE_ENV !== "production",
  "Use a local rehearsal environment.",
);
assert(["localhost", "127.0.0.1"].includes(configured.hostname));
const stamp = randomUUID().replaceAll("-", "").slice(0, 12);
const administrator = new URL(configured);
administrator.pathname = "/postgres";
const admin = new pg.Client({ connectionString: administrator.href });
await admin.connect();
try {
  for (const mode of [
    "fresh",
    "upgrade",
    "assistant_upgrade",
    "planning_upgrade",
    "extensions_upgrade",
    "intake_upgrade",
    "import_upgrade",
  ] as const) {
    const name = `axiom_${mode}_test_${stamp}`;
    assert(configured.pathname !== `/${name}`);
    await admin.query(`CREATE DATABASE "${name}"`);
    const target = new URL(configured);
    target.pathname = `/${name}`;
    const db = new pg.Client({ connectionString: target.href });
    await db.connect();
    try {
      await db.query("BEGIN");
      const noteId = randomUUID(),
        commentId = randomUUID(),
        groupId = randomUUID();
      const document = new Y.Doc();
      document
        .getText("markdown")
        .insert(0, "# Preserved research\n\nA = B.\n");
      const state = Buffer.from(Y.encodeStateAsUpdate(document));
      document.destroy();
      let before: unknown;
      let beforeIntake: unknown;
      let beforeUpload: unknown;
      const uploadId = randomUUID();
      if (mode !== "fresh") {
        await db.query(migration);
        await db.query(
          "CREATE TABLE schema_migrations(version integer PRIMARY KEY,name text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
        );
        for (const item of forwardMigrations.filter(
          (m) =>
            m.version <=
            (mode === "import_upgrade"
              ? 42
              : mode === "intake_upgrade"
                ? 41
                : mode === "extensions_upgrade"
                  ? 39
                  : mode === "planning_upgrade"
                    ? 28
                    : mode === "assistant_upgrade"
                      ? 27
                      : 18),
        )) {
          await db.query("SET CONSTRAINTS ALL IMMEDIATE");
          await db.query("SET CONSTRAINTS ALL DEFERRED");
          await db.query(item.sql);
          await db.query(
            "INSERT INTO schema_migrations(version,name) VALUES($1,$2)",
            [item.version, item.name],
          );
        }
        await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [
          "rehearsal",
          "Rehearsal Researcher",
          "rehearsal@axiom.test",
        ]);
        await db.query(
          "INSERT INTO groups(id,name) VALUES($1,'Schema rehearsal')",
          [groupId],
        );
        await db.query(
          "INSERT INTO members(group_id,user_id,role) VALUES($1,'rehearsal','owner')",
          [groupId],
        );
        await db.query(
          "INSERT INTO notes(id,group_id,author_id,title,body) VALUES($1,$2,'rehearsal','Preserved research',$3)",
          [noteId, groupId, "# Preserved research\n\nA = B.\n"],
        );
        await db.query(
          "INSERT INTO comments(id,note_id,author_id,body) VALUES($1,$2,'rehearsal','Existing discussion')",
          [commentId, noteId],
        );
        await db.query(
          "INSERT INTO documents(room,note_id,state) VALUES($1,$2,$3)",
          [`note:${noteId}:1`, noteId, state],
        );
        before = (
          await db.query(
            "SELECT to_jsonb(n) AS note,encode(d.state,'hex') AS state FROM notes n JOIN documents d ON d.note_id=n.id WHERE n.id=$1",
            [noteId],
          )
        ).rows;
        if (mode === "import_upgrade") {
          await db.query(
            "INSERT INTO upload_sessions(id,owner_id,space_id,name,bytes,storage_key) SELECT $1,'rehearsal',id,'Preserved.csv',4,$2 FROM spaces WHERE group_id=$3 AND kind='team'",
            [uploadId, randomUUID(), groupId],
          );
          await db.query(
            "INSERT INTO upload_chunks(upload_id,part,bytes,sha256,etag) VALUES($1,1,4,$2,'retained-etag')",
            [uploadId, "a".repeat(64)],
          );
          beforeUpload = (
            await db.query(
              "SELECT to_jsonb(u)-'import_entry_id' AS upload,to_jsonb(c) AS chunk FROM upload_sessions u JOIN upload_chunks c ON c.upload_id=u.id WHERE u.id=$1",
              [uploadId],
            )
          ).rows;
        }
        if (mode === "planning_upgrade") {
          await db.query(
            "INSERT INTO assistant_conversations(id,owner_id,space_id,title) SELECT $1,'rehearsal',id,'Preserved assistant' FROM spaces WHERE group_id=$2 AND kind='team'",
            [commentId, groupId],
          );
        }
        if (mode === "intake_upgrade") {
          await db.query(
            `INSERT INTO planning_intake(id,space_id,created_by,kind,title,body,status,decision_note,version,created_at)
            SELECT $1,id,'rehearsal','experiment','Existing research request','> Keep multiline source\n\n$$E=mc^2$$','needs-changes','Original decision',7,'2026-10-04T03:01:02.123456Z' FROM spaces WHERE group_id=$2 AND kind='team'`,
            [commentId, groupId],
          );
          beforeIntake = (
            await db.query(
              "SELECT to_jsonb(i) AS request FROM planning_intake i WHERE id=$1",
              [commentId],
            )
          ).rows;
        }
      }
      await migrateDatabase(db);
      await migrateDatabase(db); // Idempotent rerun must not change retained data.
      assert.equal(
        (
          await db.query(
            "SELECT max(version) AS version FROM schema_migrations",
          )
        ).rows[0].version,
        forwardMigrations.at(-1)!.version,
      );
      assert.equal(
        (
          await db.query(
            "SELECT to_regclass('public.visual_annotations')::text AS name",
          )
        ).rows[0].name,
        "visual_annotations",
      );
      assert.equal(
        (
          await db.query(
            "SELECT to_regclass('public.assistant_contexts')::text AS name",
          )
        ).rows[0].name,
        "assistant_contexts",
      );
      if (mode !== "fresh") {
        assert.deepEqual(
          (
            await db.query(
              "SELECT to_jsonb(n) AS note,encode(d.state,'hex') AS state FROM notes n JOIN documents d ON d.note_id=n.id WHERE n.id=$1",
              [noteId],
            )
          ).rows,
          before,
        );
        const comment = (
          await db.query(
            "SELECT body,kind,visibility,body_format,version,deleted FROM comments WHERE id=$1",
            [commentId],
          )
        ).rows[0];
        assert.deepEqual(comment, {
          body: "Existing discussion",
          kind: "discussion",
          visibility: "shared",
          body_format: "plain",
          version: 1,
          deleted: false,
        });
        if (mode === "planning_upgrade") {
          const row = (
            await db.query(
              "SELECT space_id,space_ids FROM assistant_conversations WHERE id=$1",
              [commentId],
            )
          ).rows[0];
          assert.deepEqual(row.space_ids, [row.space_id]);
        }
        if (mode === "intake_upgrade") {
          assert.deepEqual(
            (
              await db.query(
                "SELECT to_jsonb(i) AS request FROM planning_intake i WHERE id=$1",
                [commentId],
              )
            ).rows,
            beforeIntake,
          );
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int AS count FROM pg_indexes WHERE tablename='planning_intake' AND indexname=ANY($1::text[])",
                [
                  [
                    "planning_intake_created_page",
                    "planning_intake_status_page",
                    "planning_intake_author_page",
                  ],
                ],
              )
            ).rows[0].count,
            3,
          );
        }
        if (mode === "import_upgrade") {
          assert.deepEqual(
            (
              await db.query(
                "SELECT to_jsonb(u)-'import_entry_id' AS upload,to_jsonb(c) AS chunk FROM upload_sessions u JOIN upload_chunks c ON c.upload_id=u.id WHERE u.id=$1",
                [uploadId],
              )
            ).rows,
            beforeUpload,
          );
          assert.equal(
            (
              await db.query(
                "SELECT import_entry_id FROM upload_sessions WHERE id=$1",
                [uploadId],
              )
            ).rows[0].import_entry_id,
            null,
          );
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int AS count FROM workspace_imports",
              )
            ).rows[0].count,
            0,
          );
          await verifyRestoredImportTransfers(db, groupId);
          assert.deepEqual(
            (
              await db.query(
                "SELECT to_jsonb(n) AS note,encode(d.state,'hex') AS state FROM notes n JOIN documents d ON d.note_id=n.id WHERE n.id=$1",
                [noteId],
              )
            ).rows,
            before,
          );
        }
      }
      await db.query("COMMIT");
      console.log(
        `PASS ${mode}: ${name}, schema ${forwardMigrations.at(-1)!.version}; database retained for inspection.`,
      );
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      await db.end();
    }
  }
} finally {
  await admin.end();
}
