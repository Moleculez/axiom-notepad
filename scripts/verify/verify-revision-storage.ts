import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

// Exercise the actual maintenance SQL, with no committed fixture mutations and
// no storage writes. Refuse the configured working database or remote services.
const target = new URL(process.env.DATABASE_URL ?? "");
assert(process.env.NODE_ENV !== "production");
assert(["localhost", "127.0.0.1"].includes(target.hostname));
assert(target.pathname !== "/axiom_release_test");
target.pathname = "/axiom_release_test";
process.env.DATABASE_URL = target.href;
const { pruneImageDraftAssetsInTransaction } =
  await import("../../packages/shared/src/image-cloud-api");
const db = new pg.Client({ connectionString: target.href });
await db.connect();
await db.query("BEGIN");
try {
  const {
    rows: [resource],
  } = await db.query(
    "SELECT r.id,r.owner_id FROM resources r JOIN tool_projects p ON p.resource_id=r.id WHERE p.kind='image' AND r.deleted_at IS NULL LIMIT 1",
  );
  assert(
    resource,
    "Run isolated image browser fixtures before this rehearsal.",
  );
  const ids = Array.from({ length: 6 }, () => randomUUID());
  for (const [index, id] of ids.entries())
    await db.query(
      "INSERT INTO image_draft_assets(id,resource_id,sha256,storage_key,bytes,created_at) VALUES($1,$2,$3,$1,1,CASE WHEN $4 THEN now() ELSE now()-interval '2 days' END)",
      [id, resource.id, id.replaceAll("-", "").repeat(2), index === 5],
    );
  const current = { assets: { "layers/shared.png": ids[0] }, preview: ids[2] },
    previous = { assets: { "layers/shared.png": ids[1] }, preview: ids[3] };
  await db.query(
    "INSERT INTO image_cloud_drafts(resource_id,owner_id,manifest,previous_manifest) VALUES($1,$2,$3,$4) ON CONFLICT(resource_id) DO UPDATE SET manifest=excluded.manifest,previous_manifest=excluded.previous_manifest",
    [resource.id, resource.owner_id, current, previous],
  );
  await pruneImageDraftAssetsInTransaction(db);
  const { rows } = await db.query(
    "SELECT id FROM image_draft_assets WHERE id=ANY($1::uuid[])",
    [ids],
  );
  assert.deepEqual(
    new Set(rows.map((r) => r.id)),
    new Set(ids.filter((_, index) => index !== 4)),
  );
  assert.equal(
    (
      await db.query(
        "SELECT 1 FROM workspace_jobs WHERE kind='delete-blob' AND payload->>'key'=$1",
        [ids[4]],
      )
    ).rowCount,
    1,
  );
  const {
    rows: [note],
  } = await db.query(
    "SELECT id,author_id,generation FROM notes WHERE source_format='markdown' AND deleted_at IS NULL LIMIT 1",
  );
  const {
    rows: [file],
  } = await db.query("SELECT id FROM file_versions LIMIT 1");
  assert(note && file);
  const decision = randomUUID();
  const suggestions = [
    {
      id: randomUUID(),
      hunks: [{ before: "/api/v1/attachments/" + file.id, insert: "" }],
    },
  ];
  await db.query(
    "INSERT INTO revision_decisions(id,note_id,generation,actor_id,action,suggestions) VALUES($1,$2,$3,$4,'accept',$5)",
    [
      decision,
      note.id,
      note.generation,
      note.author_id,
      JSON.stringify(suggestions),
    ],
  );
  const references = async () =>
    (
      await db.query(
        "SELECT 1 FROM resource_references WHERE decision_id=$1 AND version_id=$2",
        [decision, file.id],
      )
    ).rowCount;
  assert.equal(await references(), 1);
  await db.query("UPDATE notes SET body=body WHERE id=$1", [note.id]);
  assert.equal(
    await references(),
    1,
    "Live indexing must not remove Undo attachment retention",
  );
  await db.query("UPDATE revision_decisions SET undone=true WHERE id=$1", [
    decision,
  ]);
  assert.equal(await references(), 0);
  console.log(
    "Reversible decisions retain original attachment versions independently of live indexing; Undo releases decision-owned references.",
  );
  console.log(
    "Draft retention passed: current/previous assets sharing a path and both previews survive; recent uploads survive; expired orphan queues cleanup. All fixture changes rolled back.",
  );
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
