import { transaction, query } from "./db";
import type pg from "pg";

/** Survives room unload/restart; pending contributors were committed with edits. */
export async function saveDueCheckpoints() {
  await transaction(writeDueCheckpoints);
  await query(checkpointRetentionSql);
}
export const checkpointRetentionSql = `DELETE FROM snapshots s WHERE s.label IS NULL AND s.created_at<now()-interval '30 days'
 AND NOT EXISTS(SELECT 1 FROM review_requests r WHERE r.snapshot_id=s.id)`;
/** Caller owns the transaction; also used by the isolated durability rehearsal. */
export async function writeDueCheckpoints(
  client: Pick<pg.PoolClient, "query">,
) {
  await client.query(
    "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
  );
  const { rows } = await client.query(
    `SELECT p.* FROM document_checkpoint_pending p
       WHERE (last_edit_at<=now()-interval '60 seconds' OR first_edit_at<=now()-interval '5 minutes')
       AND NOT EXISTS(SELECT 1 FROM document_updates u WHERE split_part(u.room,':',1)=p.note_id::text)
       ORDER BY first_edit_at LIMIT 100 FOR UPDATE OF p SKIP LOCKED`,
  );
  for (const pending of rows) {
    await client.query(
      `INSERT INTO snapshots(note_id,title,body,state,generation,contributors,author_id,source_format)
         SELECT n.id,n.title,n.body,d.state,n.generation,$2::text[],CASE WHEN cardinality($2::text[])=1 AND EXISTS(SELECT 1 FROM "user" WHERE id=($2::text[])[1]) THEN ($2::text[])[1] END,n.source_format
         FROM notes n JOIN documents d ON d.room=n.id::text||':'||n.generation::text WHERE n.id=$1
         AND n.body IS DISTINCT FROM (SELECT body FROM snapshots WHERE note_id=n.id ORDER BY created_at DESC,id DESC LIMIT 1)`,
      [pending.note_id, pending.contributors],
    );
    await client.query(
      "DELETE FROM document_checkpoint_pending WHERE note_id=$1",
      [pending.note_id],
    );
  }
}
