/** Pure SQL shared by the transaction-owned batch writer and isolated SQL gate.
 * $1 is the authorized workspace; $2 contains only validated, version-fenced rows.
 * SQL retains untouched custom values rather than transferring whole maps to JS.
 */
export const metadataBatchUpdateSql = `
UPDATE tasks t SET
 status=x.status,priority=x.priority,assignee_id=x.assignee_id,labels=x.labels,
 custom_fields=CASE WHEN x.custom_patch IS NULL THEN t.custom_fields ELSE jsonb_strip_nulls(t.custom_fields||x.custom_patch) END,
 version=t.version+1,updated_at=now()
FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,status text,priority text,assignee_id text,labels text[],custom_patch jsonb)
WHERE t.id=x.id AND t.space_id=$1 RETURNING t.id,t.version`.trim();
