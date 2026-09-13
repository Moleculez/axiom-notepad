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
  for (const mode of ["fresh", "upgrade"] as const) {
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
      document.getText("content").insert(0, "# Preserved research\n\nA = B.\n");
      const state = Buffer.from(Y.encodeStateAsUpdate(document));
      document.destroy();
      let before: unknown;
      if (mode === "upgrade") {
        await db.query(migration);
        await db.query(
          "CREATE TABLE schema_migrations(version integer PRIMARY KEY,name text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
        );
        for (const item of forwardMigrations.filter((m) => m.version <= 18)) {
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
      if (mode === "upgrade") {
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
