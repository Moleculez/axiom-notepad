import type pg from "pg";

/** Only inside a transaction on a restored database with writers stopped.
 * Staging is not in the paired backup. Retire its database intent/receipts,
 * never abort multipart handles or touch the original installation's storage.
 */
export async function retireRestoredTransfers(
  client: Pick<pg.Client, "query">,
) {
  const {
    rows: [tables],
  } = await client.query(
    "SELECT to_regclass('upload_sessions') AS uploads,to_regclass('workspace_imports') AS imports,to_regclass('workspace_jobs') AS jobs,EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('workspace_jobs') AND attname='lease_id' AND NOT attisdropped) AS has_lease",
  );
  let imports = 0,
    uploads = 0;
  if (tables.imports) {
    const cancelled = await client.query<{ id: string }>(
      "UPDATE workspace_imports SET status='cancelled',error='Private import preparation is not included in a backup. Import the original collection again.',updated_at=now() WHERE status IN ('preparing','publishing','blocked') RETURNING id",
    );
    imports = cancelled.rowCount ?? 0;
    if (tables.jobs && imports)
      await client.query(
        `UPDATE workspace_jobs SET status='failed',${tables.has_lease ? "lease_id=NULL," : ""}leased_until=NULL,error='Import the original collection again after restoring the backup.',updated_at=now() WHERE kind='finalize-import' AND status IN ('queued','running') AND payload->>'id'=ANY($1::text[])`,
        [cancelled.rows.map((row) => row.id)],
      );
  }
  if (tables.uploads) {
    const cancelled = await client.query<{ id: string }>(
      "UPDATE upload_sessions SET status='cancelled',multipart_id=NULL,error='Incomplete upload/import staging is not included in a backup. Select the originals for a new transfer.',updated_at=now() WHERE status IN ('uploading','verifying','failed','staged') RETURNING id",
    );
    uploads = cancelled.rowCount ?? 0;
    if (tables.jobs && uploads)
      await client.query(
        `UPDATE workspace_jobs SET status='failed',${tables.has_lease ? "lease_id=NULL," : ""}leased_until=NULL,error='Start a new transfer after restoring the backup.',updated_at=now() WHERE kind='complete-upload' AND status IN ('queued','running') AND payload->>'id'=ANY($1::text[])`,
        [cancelled.rows.map((row) => row.id)],
      );
    await client.query(
      "DELETE FROM upload_chunks WHERE upload_id IN (SELECT id FROM upload_sessions WHERE status='cancelled')",
    );
  }
  return { uploads, imports };
}
