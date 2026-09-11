import "dotenv/config";
import assert from "node:assert/strict";
import pg from "pg";
import {
  checkpointRetentionSql,
  writeDueCheckpoints,
} from "../../packages/shared/src/document-checkpoints";
import {
  migration,
  forwardMigrations,
} from "../../packages/shared/src/migrations";

// Deliberately new, disposable database. No research rows or live settings touched.
const source = new URL(process.env.DATABASE_URL!);
const target = new URL(source);
const name = `axiom_audit_test_${Date.now()}`;
target.pathname = `/${name}`;
const admin = new pg.Client({ connectionString: source.href });
await admin.connect();
await admin.query(`CREATE DATABASE "${name}"`);
await admin.end();
const client = new pg.Client({ connectionString: target.href });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(migration);
  for (const next of forwardMigrations) await client.query(next.sql);
  await client.query(
    "INSERT INTO \"user\"(id,name,email) VALUES('audit-owner','Audit owner','owner@audit.test'),('audit-reader','Reader','reader@audit.test'),('audit-outsider','Outsider','outsider@audit.test')",
  );
  await client.query("SELECT set_config('axiom.actor_id','audit-owner',true)");
  const group = (
    await client.query(
      "INSERT INTO groups(name) VALUES('Disposable audit group') RETURNING id",
    )
  ).rows[0];
  await client.query(
    "INSERT INTO members(group_id,user_id,role) VALUES($1,'audit-owner','owner'),($1,'audit-reader','member')",
    [group.id],
  );
  const space = (
    await client.query(
      "SELECT id FROM spaces WHERE group_id=$1 AND kind='team'",
      [group.id],
    )
  ).rows[0];
  const folder = (
    await client.query(
      "INSERT INTO resources(space_id,kind,name,owner_id) VALUES($1,'folder','Before','audit-owner') RETURNING id",
      [space.id],
    )
  ).rows[0];
  await client.query(
    "UPDATE resources SET name='After',version=version+1 WHERE id=$1",
    [folder.id],
  );
  const events = (
    await client.query(
      "SELECT * FROM audit_events WHERE entity_id=$1 ORDER BY id",
      [folder.id],
    )
  ).rows;
  assert.equal(events.length, 2);
  assert.equal(events[1].actor_id, "audit-owner");
  assert.equal(events[1].before_values.name, "Before");
  assert.equal(events[1].after_values.name, "After");
  const visibility = async (who: string) =>
    (
      await client.query(
        "SELECT count(*)::int AS n FROM audit_events e WHERE entity_id=$1 AND axiom_audit_visible($2,e)",
        [folder.id, who],
      )
    ).rows[0].n;
  assert.equal(await visibility("audit-reader"), 2);
  assert.equal(await visibility("audit-outsider"), 0);
  await client.query(
    "INSERT INTO resource_favorites(user_id,resource_id) VALUES('audit-owner',$1) ON CONFLICT DO NOTHING",
    [folder.id],
  );
  await client.query(
    "INSERT INTO resource_favorites(user_id,resource_id) VALUES('audit-owner',$1) ON CONFLICT DO NOTHING",
    [folder.id],
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE entity_type='favorite'",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    await visibility("audit-reader"),
    2,
    "Favorites must remain owner-only",
  );
  const note = (
    await client.query(
      "INSERT INTO notes(group_id,author_id,title,body) VALUES($1,'audit-owner','Checkpoint proof','Initial proof') RETURNING id",
      [group.id],
    )
  ).rows[0];
  const room = `${note.id}:1`;
  await client.query(
    "INSERT INTO documents(room,note_id,state) VALUES($1,$2,$3)",
    [room, note.id, Buffer.from([0, 0])],
  );
  await client.query("INSERT INTO document_updates(room,data) VALUES($1,$2)", [
    room,
    Buffer.from([0, 0]),
  ]);
  await client.query("SELECT set_config('axiom.actor_id','audit-reader',true)");
  await client.query("INSERT INTO document_updates(room,data) VALUES($1,$2)", [
    room,
    Buffer.from([0, 0]),
  ]);
  const pending = (
    await client.query(
      "SELECT * FROM document_checkpoint_pending WHERE note_id=$1",
      [note.id],
    )
  ).rows[0];
  assert.deepEqual(pending.contributors.sort(), [
    "audit-owner",
    "audit-reader",
  ]);
  await client.query(
    "UPDATE document_checkpoint_pending SET first_edit_at=now()-interval '6 minutes' WHERE note_id=$1",
    [note.id],
  );
  await writeDueCheckpoints(client);
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM snapshots WHERE note_id=$1",
        [note.id],
      )
    ).rows[0].n,
    0,
    "Unpersisted journals must not become incomplete versions",
  );
  await client.query("DELETE FROM document_updates WHERE room=$1", [room]);
  await client.query("SELECT set_config('axiom.actor_id','',true)");
  await writeDueCheckpoints(client);
  const checkpoint = (
    await client.query("SELECT * FROM snapshots WHERE note_id=$1", [note.id])
  ).rows[0];
  assert.deepEqual(checkpoint.contributors.sort(), [
    "audit-owner",
    "audit-reader",
  ]);
  assert.equal(
    checkpoint.author_id,
    null,
    "Never guess a single author for collaborative checkpoints",
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM document_checkpoint_pending WHERE note_id=$1",
        [note.id],
      )
    ).rows[0].n,
    0,
  );
  await client.query(
    "UPDATE notes SET body='Short session proof' WHERE id=$1",
    [note.id],
  );
  await client.query(
    "INSERT INTO document_checkpoint_pending(note_id,first_edit_at,last_edit_at,contributors) VALUES($1,now()-interval '90 seconds',now()-interval '70 seconds',ARRAY['audit-owner'])",
    [note.id],
  );
  await writeDueCheckpoints(client);
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM snapshots WHERE note_id=$1",
        [note.id],
      )
    ).rows[0].n,
    2,
    "Closed short sessions are checkpointed without a loaded editor",
  );
  await client.query(
    "INSERT INTO snapshots(note_id,title,body,state,generation,label,created_at) VALUES($1,'Named proof','Retained', $2,1,'Keep this',now()-interval '40 days')",
    [note.id, Buffer.from([0, 0])],
  );
  await client.query(
    "UPDATE snapshots SET created_at=now()-interval '40 days' WHERE id=$1",
    [checkpoint.id],
  );
  const project = (
    await client.query(
      "INSERT INTO projects(group_id,name) VALUES($1,'Review evidence project') RETURNING id",
      [group.id],
    )
  ).rows[0];
  const reviewVersion = (
    await client.query(
      "INSERT INTO snapshots(note_id,title,body,state,generation,created_at) VALUES($1,'Review proof','Retained by review',$2,1,now()-interval '40 days') RETURNING id",
      [note.id, Buffer.from([0, 0])],
    )
  ).rows[0];
  await client.query(
    "INSERT INTO review_requests(project_id,note_id,snapshot_id,requested_by,reviewer_id) VALUES($1,$2,$3,'audit-owner','audit-reader')",
    [project.id, note.id, reviewVersion.id],
  );
  await client.query(
    "INSERT INTO project_members(project_id,user_id,role,can_manage) VALUES($1,'audit-owner','editor',true)",
    [project.id],
  );
  await client.query(checkpointRetentionSql);
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM snapshots WHERE id=$1",
        [reviewVersion.id],
      )
    ).rows[0].n,
    1,
    "Formal review evidence survives automatic expiry",
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM snapshots WHERE id=$1",
        [checkpoint.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM snapshots WHERE note_id=$1 AND label='Keep this'",
        [note.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE version_id=$1",
        [checkpoint.id],
      )
    ).rows[0].n,
    1,
    "Expiry retains audit metadata",
  );
  await client.query("SELECT set_config('axiom.actor_id','audit-owner',true)");
  await client.query("SAVEPOINT rollback_test");
  await client.query("UPDATE resources SET name='Rolled back' WHERE id=$1", [
    folder.id,
  ]);
  await client.query("ROLLBACK TO SAVEPOINT rollback_test");
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE entity_name='Rolled back'",
      )
    ).rows[0].n,
    0,
  );
  await client.query("UPDATE resources SET deleted_at=now() WHERE id=$1", [
    folder.id,
  ]);
  assert.equal(
    (
      await client.query("SELECT deleted_by FROM resources WHERE id=$1", [
        folder.id,
      ])
    ).rows[0].deleted_by,
    "audit-owner",
  );
  await client.query(
    "DELETE FROM members WHERE group_id=$1 AND user_id='audit-reader'",
    [group.id],
  );
  assert.equal(await visibility("audit-reader"), 0);
  // Clear the review's RESTRICT reference only as part of this disposable
  // cascade rehearsal; application deletion retains its separate safety gates.
  await client.query("DELETE FROM review_requests WHERE project_id=$1", [
    project.id,
  ]);
  await client.query("DELETE FROM groups WHERE id=$1", [group.id]);
  assert.equal(
    (
      await client.query(
        "SELECT entity_name FROM audit_events WHERE entity_type='workspace' AND entity_id=$1 AND action='purge'",
        [space.id],
      )
    ).rows[0].entity_name,
    "Disposable audit group",
  );
  assert((await visibility("audit-owner")) >= 3);
  assert.equal(await visibility("audit-reader"), 0);
  const projectPurge = (
    await client.query(
      "SELECT * FROM audit_events e WHERE entity_type='project' AND entity_id=$1 AND action='purge' AND axiom_audit_visible('audit-owner',e)",
      [project.id],
    )
  ).rows[0];
  assert.equal(projectPurge.group_id, group.id);
  assert(projectPurge.space_id, "Purged projects retain their workspace scope");
  assert.equal(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM audit_events e WHERE entity_type='membership' AND entity_id=$1 AND action='purge' AND axiom_audit_visible('audit-owner',e)",
        [project.id + ":audit-owner"],
      )
    ).rows[0].n,
    1,
    "Cascaded membership removal stays in the authorized audit history",
  );
  await client.query("SAVEPOINT immutable_test");
  await assert.rejects(client.query("DELETE FROM audit_events"), /append-only/);
  await client.query("ROLLBACK TO SAVEPOINT immutable_test");
  await client.query("ROLLBACK");
  console.log(
    `PASS: migrations, transactional changes, retry safety, collaborative and idle checkpoints, expiry, revocation, private events, purge retention and immutable log. Disposable database: ${name}`,
  );
} finally {
  await client.end();
}
