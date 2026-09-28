import "dotenv/config";
import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { workspaceResearchMigration } from "../../packages/shared/src/workspace-research-migration";

// Rehearse against an isolated schema-37 database; every fixture and DDL change
// is rolled back. Never point this at the working application database.
const url = new URL(process.env.DATABASE_URL!);
const database = process.env.AXIOM_STAGING_DATABASE ?? "axiom_docs_test";
if (
  !/axiom_.*test/.test(database) ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname === "/" + database
)
  throw new Error("Choose an isolated local staging database.");
url.pathname = "/" + database;
const c = new pg.Client({ connectionString: url.href });
await c.connect();
const one = async (sql: string, values: unknown[] = []) =>
  (await c.query(sql, values)).rows[0];
try {
  await c.query("BEGIN");
  assert.equal(
    (await one("SELECT max(version) AS version FROM schema_migrations"))
      .version,
    37,
  );
  const user = (
    await one('SELECT id FROM "user" WHERE email=$1', [
      "researcher@axiom.local",
    ])
  ).id;
  const group = await one(
    "INSERT INTO groups(name) VALUES('Migration verification') RETURNING id",
  );
  await c.query(
    "INSERT INTO members(group_id,user_id,role) VALUES($1,$2,'owner')",
    [group.id, user],
  );
  const project = await one(
    "INSERT INTO projects(group_id,name,created_by) VALUES($1,'Restricted research',$2) RETURNING id",
    [group.id, user],
  );
  const main = await one(
    "SELECT id FROM spaces WHERE kind='team' AND group_id=$1",
    [group.id],
  );
  const space = await one("SELECT id FROM spaces WHERE project_id=$1", [
    project.id,
  ]);
  const paper = await one(
    "INSERT INTO bibliography(group_id,cite_key,title,bibtex) VALUES($1,'migration-paper','Original source','@article{migration-paper,title={Original source}}') RETURNING id",
    [group.id],
  );
  const alias = await one(
    "INSERT INTO bibliography(group_id,cite_key,title,merged_into) VALUES($1,'old-key','Old source',$2) RETURNING id",
    [group.id, paper.id],
  );
  const unused = await one(
    "INSERT INTO bibliography(group_id,cite_key,title) VALUES($1,'unused','Unfiled source') RETURNING id",
    [group.id],
  );
  const root = await one(
    "INSERT INTO reference_collections(group_id,name) VALUES($1,'Methods') RETURNING id",
    [group.id],
  );
  const child = await one(
    "INSERT INTO reference_collections(group_id,name,parent_id) VALUES($1,'Spectral',$2) RETURNING id",
    [group.id, root.id],
  );
  await c.query("INSERT INTO reference_collection_items VALUES($1,$2)", [
    child.id,
    paper.id,
  ]);
  const note = await one(
    "INSERT INTO notes(group_id,project_id,author_id,title,body) VALUES($1,$2,$3,'Existing citation','See [@old-key].') RETURNING id,body",
    [group.id, project.id, user],
  );
  await c.query("INSERT INTO reference_notes VALUES($1,$2)", [
    paper.id,
    note.id,
  ]);
  await c.query("UPDATE notes SET deleted_at=now() WHERE id=$1", [note.id]);
  const attachment = randomUUID(),
    resource = randomUUID();
  await c.query(
    "INSERT INTO attachments(id,name,mime,bytes,sha256,storage_key) VALUES($1::uuid,'Study.pdf','application/pdf',10,$2,$1::text)",
    [attachment, "a".repeat(64)],
  );
  await c.query(
    "INSERT INTO resources(id,space_id,kind,name,owner_id) VALUES($1,$2,'file','Study.pdf',$3)",
    [resource, space.id, user],
  );
  await c.query(
    "INSERT INTO file_versions(id,resource_id,ordinal,created_by) VALUES($1,$2,1,$3)",
    [attachment, resource, user],
  );
  await c.query("UPDATE resources SET current_version_id=$1 WHERE id=$2", [
    attachment,
    resource,
  ]);
  await c.query("INSERT INTO reference_attachments VALUES($1,$2)", [
    paper.id,
    attachment,
  ]);
  await c.query(
    "INSERT INTO reading_items(id,user_id,group_id,kind,target_type,target_id,data,mutation_id) VALUES($1,$2,$3,'reading','reference',$4,'{\"status\":\"reading\"}',$5)",
    [randomUUID(), user, group.id, paper.id, randomUUID()],
  );
  await c.query(workspaceResearchMigration);
  const clone = await one(
    "SELECT * FROM bibliography WHERE space_id=$1 AND cite_key='migration-paper'",
    [space.id],
  );
  assert.ok(clone);
  assert.notEqual(clone.id, paper.id);
  assert.equal(
    (await one("SELECT space_id FROM bibliography WHERE id=$1", [paper.id]))
      .space_id,
    main.id,
  );
  assert.equal(
    (
      await one(
        "SELECT count(*)::int AS n FROM bibliography WHERE cite_key='unused' AND space_id=$1",
        [space.id],
      )
    ).n,
    0,
  );
  assert.equal(
    (await one("SELECT space_id FROM bibliography WHERE id=$1", [unused.id]))
      .space_id,
    main.id,
  );
  assert.equal(
    (
      await one(
        "SELECT merged_into FROM bibliography WHERE space_id=$1 AND cite_key='old-key'",
        [space.id],
      )
    ).merged_into,
    clone.id,
  );
  assert.equal(
    (
      await one("SELECT reference_id FROM reference_notes WHERE note_id=$1", [
        note.id,
      ])
    ).reference_id,
    clone.id,
  );
  assert.equal(
    (
      await one(
        "SELECT reference_id FROM reference_attachments WHERE attachment_id=$1",
        [attachment],
      )
    ).reference_id,
    clone.id,
  );
  assert.equal(
    (
      await one(
        "SELECT title FROM axiom_note_bibliography($1) WHERE cite_key='old-key'",
        [note.id],
      )
    ).title,
    "Original source",
  );
  assert.equal(
    (await one("SELECT body FROM notes WHERE id=$1", [note.id])).body,
    note.body,
  );
  assert.equal(
    (
      await one(
        "SELECT p.name FROM reference_collections c JOIN reference_collections p ON p.id=c.parent_id WHERE c.space_id=$1",
        [space.id],
      )
    ).name,
    "Methods",
  );
  assert.equal(
    (
      await one(
        "SELECT data->>'status' AS status FROM reading_items WHERE target_id=$1 AND user_id=$2",
        [clone.id, user],
      )
    ).status,
    "reading",
  );
  assert.equal(
    (
      await one(
        "SELECT reference_id FROM research_workspace_reference_map WHERE original_id=$1 AND space_id=$2",
        [alias.id, space.id],
      )
    ).reference_id,
    (
      await one(
        "SELECT id FROM bibliography WHERE space_id=$1 AND cite_key='old-key'",
        [space.id],
      )
    ).id,
  );
  await c.query(
    "UPDATE bibliography SET title='Independent copy' WHERE id=$1",
    [clone.id],
  );
  assert.equal(
    (await one("SELECT title FROM bibliography WHERE id=$1", [paper.id])).title,
    "Original source",
  );
  await c.query("SAVEPOINT boundary");
  await assert.rejects(
    c.query("INSERT INTO reference_collection_items VALUES($1,$2)", [
      root.id,
      clone.id,
    ]),
  );
  await c.query("ROLLBACK TO boundary");
  await c.query("SAVEPOINT boundary");
  await assert.rejects(
    c.query("UPDATE bibliography SET merged_into=$1 WHERE id=$2", [
      paper.id,
      clone.id,
    ]),
  );
  await c.query("ROLLBACK TO boundary");
  await c.query("DELETE FROM bibliography WHERE space_id=$1", [space.id]);
  assert.equal(
    (
      await one(
        "SELECT count(*)::int AS n FROM reading_items WHERE target_id=$1",
        [clone.id],
      )
    ).n,
    0,
  );
  console.log(
    "Workspace library migration: usage copies, aliases, trashed citations, PDF links, nested collections, private statuses, independent edits, scope boundaries and cleanup passed.",
  );
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
