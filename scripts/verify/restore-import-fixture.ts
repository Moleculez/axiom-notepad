import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { retireRestoredTransfers } from "../../packages/shared/src/restore-transfers";

/** Metadata-only restore rehearsal; caller provides a fresh disposable schema 43 database. */
export async function verifyRestoredImportTransfers(
  db: pg.Client,
  groupId: string,
) {
  assert(
    (
      await db.query("SELECT current_database() AS name")
    ).rows[0].name.startsWith("axiom_import_upgrade_test_"),
  );
  const {
    rows: [space],
  } = await db.query(
    "SELECT id FROM spaces WHERE group_id=$1 AND kind='team'",
    [groupId],
  );
  const successful: string[] = [];
  for (const [batchStatus, uploadStatus] of [
    ["preparing", "uploading"],
    ["publishing", "staged"],
    ["blocked", "failed"],
    ["complete", "complete"],
    ["cancelled", "cancelled"],
  ]) {
    const batchId = randomUUID(),
      id = randomUUID();
    await db.query(
      "INSERT INTO workspace_imports(id,owner_id,space_id,manifest,manifest_hash,preview_hash,plan,status,result) VALUES($1,'rehearsal',$2,'{}',$3,$3,'[]',$4,$5)",
      [
        batchId,
        space.id,
        "a".repeat(64),
        batchStatus,
        batchStatus === "complete"
          ? JSON.stringify({ resources: [], warnings: [] })
          : null,
      ],
    );
    await db.query(
      "INSERT INTO workspace_import_entries(id,batch_id,path,kind,digest) VALUES($1,$2,'Prepared.md','note',$3)",
      [id, batchId, "a".repeat(64)],
    );
    await db.query(
      "INSERT INTO upload_sessions(id,owner_id,space_id,import_entry_id,name,bytes,storage_key,status,multipart_id,sha256) VALUES($1,'rehearsal',$2,$1,'Prepared.md',4,$3,$4,'original-installation-handle',$5)",
      [id, space.id, randomUUID(), uploadStatus, "b".repeat(64)],
    );
    await db.query(
      "INSERT INTO upload_chunks(upload_id,part,bytes,sha256) VALUES($1,1,4,$2)",
      [id, "a".repeat(64)],
    );
    for (const [kind, target] of [
      ["complete-upload", id],
      ["finalize-import", batchId],
    ])
      await db.query(
        "INSERT INTO workspace_jobs(kind,payload,status,lease_id,leased_until) VALUES($1,$2,'running',$3,now()+interval '1 hour')",
        [kind, JSON.stringify({ id: target }), randomUUID()],
      );
    if (batchStatus === "complete") successful.push(id, batchId);
  }
  // Folder-only private preparation is canceled too, even without a transfer.
  await db.query(
    "INSERT INTO workspace_imports(id,owner_id,space_id,manifest,manifest_hash,preview_hash,plan,status) VALUES($1,'rehearsal',$2,'{}',$3,$3,'[]','blocked')",
    [randomUUID(), space.id, "a".repeat(64)],
  );
  await db.query(
    "INSERT INTO upload_sessions(id,owner_id,space_id,name,bytes,storage_key,status) VALUES($1,'rehearsal',$2,'Ordinary.bin',4,$3,'verifying')",
    [randomUUID(), space.id, randomUUID()],
  );
  const before = (
    await db.query(
      "SELECT to_jsonb(u) AS transfer,to_jsonb(b) AS batch FROM upload_sessions u JOIN workspace_import_entries e ON e.id=u.import_entry_id JOIN workspace_imports b ON b.id=e.batch_id WHERE u.status='complete'",
    )
  ).rows;
  const successfulJobs = (
    await db.query(
      "SELECT to_jsonb(j) AS job FROM workspace_jobs j WHERE payload->>'id'=ANY($1::text[]) ORDER BY id",
      [successful],
    )
  ).rows;
  assert.deepEqual(await retireRestoredTransfers(db), {
    uploads: 5,
    imports: 4,
  });
  assert.deepEqual(await retireRestoredTransfers(db), {
    uploads: 0,
    imports: 0,
  });
  assert.deepEqual(
    (
      await db.query(
        "SELECT to_jsonb(u) AS transfer,to_jsonb(b) AS batch FROM upload_sessions u JOIN workspace_import_entries e ON e.id=u.import_entry_id JOIN workspace_imports b ON b.id=e.batch_id WHERE u.status='complete'",
      )
    ).rows,
    before,
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT to_jsonb(j) AS job FROM workspace_jobs j WHERE payload->>'id'=ANY($1::text[]) ORDER BY id",
        [successful],
      )
    ).rows,
    successfulJobs,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM workspace_imports WHERE status NOT IN ('cancelled','complete')",
      )
    ).rows[0].count,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM upload_sessions WHERE status='cancelled' AND multipart_id IS NOT NULL",
      )
    ).rows[0].count,
    1,
  ); // Previously canceled terminal metadata is unchanged.
  assert.equal(
    (await db.query("SELECT count(*)::int AS count FROM upload_chunks")).rows[0]
      .count,
    1,
  ); // Only the completed transfer retains its receipt.
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM workspace_jobs WHERE payload->>'id'<>ALL($1::text[]) AND (status<>'failed' OR lease_id IS NOT NULL OR leased_until IS NOT NULL)",
        [successful],
      )
    ).rows[0].count,
    2,
  ); // Previously canceled jobs are not newly retired.
}
