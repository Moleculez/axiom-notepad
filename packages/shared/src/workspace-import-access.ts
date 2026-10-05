import type pg from "pg";
import { HttpError } from "./access";
import { requireScope } from "./workspace-service";

/** Scope → batch → upload is the common order for transfer, verification and cancellation. */
export async function lockImportUpload(
  client: pg.PoolClient,
  upload: {
    import_entry_id?: string | null;
    owner_id: string;
    space_id: string;
  },
) {
  if (!upload.import_entry_id) return;
  await requireScope(client, upload.owner_id, upload.space_id, "edit");
  const {
    rows: [batch],
  } = await client.query(
    "SELECT b.* FROM workspace_imports b JOIN workspace_import_entries e ON e.batch_id=b.id WHERE e.id=$1 AND b.owner_id=$2 FOR UPDATE OF b",
    [upload.import_entry_id, upload.owner_id],
  );
  if (
    !batch ||
    !["preparing", "blocked"].includes(batch.status) ||
    new Date(batch.expires_at).valueOf() <= Date.now()
  )
    throw new HttpError(
      409,
      "This import no longer accepts transfers. Nothing has been published.",
    );
}
