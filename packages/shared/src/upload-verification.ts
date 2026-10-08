import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { currentAuditContext } from "./audit-context";

/** Caller holds the upload row lock and has checked its current edit authority.
 * Rechecks must not steal a running lease or bypass a queued retry's backoff.
 * A terminal job for a still-verifying upload, however, cannot make progress. */
export async function enqueueUploadVerification(
  client: PoolClient,
  id: string,
) {
  const context = currentAuditContext();
  const payload = {
    id,
    ...(context?.integrationId ? { integrationAudit: context } : {}),
  };
  await client.query(
    `INSERT INTO workspace_jobs(kind,dedupe_key,payload)
     VALUES('complete-upload',$1,$2)
     ON CONFLICT(dedupe_key) DO UPDATE SET
       status='queued',attempts=0,available_at=now(),leased_until=NULL,
       lease_id=NULL,error=NULL,updated_at=now()
     WHERE workspace_jobs.kind='complete-upload'
       AND workspace_jobs.status IN ('done','failed')`,
    ["upload:" + id, JSON.stringify(payload)],
  );
}

/** Repairs a lost enqueue/old terminal job after a worker restart. This is not
 * an automatic retry of a failed upload: those retain their explicit Retry.
 * Row locks fence publication, imports and concurrent browser rechecks. */
export async function recoverUploadVerifications() {
  const candidates = await query<{ id: string }>(
    `SELECT u.id FROM upload_sessions u
     LEFT JOIN workspace_jobs j ON j.dedupe_key='upload:'||u.id::text
     WHERE u.status='verifying' AND u.expires_at>now()
       AND u.updated_at<now()-interval '30 seconds'
       AND (j.id IS NULL OR j.status='done')
     ORDER BY u.updated_at LIMIT 50`,
  );
  for (const candidate of candidates)
    await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id FROM upload_sessions WHERE id=$1 AND status='verifying'
         AND expires_at>now() FOR UPDATE SKIP LOCKED`,
        [candidate.id],
      );
      if (rows.length) await enqueueUploadVerification(client, candidate.id);
    });
}
