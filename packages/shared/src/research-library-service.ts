import type pg from "pg";
import { z } from "zod";
import { query, transaction } from "./db";
import { HttpError } from "./access";
import { requireScope, workspaceMutation } from "./workspace-service";
import { currentAuditContext } from "./audit-context";
import { requireResearchIntegrationRead } from "./integration-research-authority";
import {
  libraryScopeSchema,
  type LibraryReference,
  type LibraryScope,
} from "./research-library";

export const libraryPredicate = (alias = "b", space = "$2", user = "$1") =>
  `(${alias}.space_id=${space}::uuid AND ${user}::text IS NOT NULL AND (${alias}.owner_user_id IS NULL OR ${alias}.owner_user_id=${user}))`;

/** Keep native linked evidence within the adapter's one selected workspace. */
export function libraryLinkedSpacePredicate(alias = "r", space = "$2") {
  return currentAuditContext()?.integrationReadArea === "research-library"
    ? ` AND ${alias}.space_id=${space}::uuid`
    : "";
}

/** Only the compatibility boundary understands group/account libraries. */
export async function resolveLibraryScope(
  user: string,
  input: unknown,
): Promise<LibraryScope> {
  const parsed = libraryScopeSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  if (currentAuditContext()?.integrationId)
    throw new HttpError(403, "Select an explicitly granted workspace.");
  const legacy = z
    .object({ groupId: z.uuid().nullable().default(null) })
    .strict()
    .parse(input);
  const [space] = await query(
    "SELECT id FROM spaces WHERE (kind='team' AND group_id=$2::uuid) OR (kind='personal' AND owner_id=$1 AND $2::uuid IS NULL)",
    [user, legacy.groupId],
  );
  if (!space) throw new HttpError(404, "Library workspace unavailable.");
  return { spaceId: space.id };
}

export async function libraryRequestInput(request: Request, user: string) {
  const input = await request.json();
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  if (input.scope) input.scope = await resolveLibraryScope(user, input.scope);
  if (input.sourceScope)
    input.sourceScope = await resolveLibraryScope(user, input.sourceScope);
  return input;
}
export const liveResource = (alias = "r") =>
  `${alias}.deleted_at IS NULL AND NOT EXISTS(WITH RECURSIVE parents AS (SELECT id,parent_id,deleted_at FROM resources WHERE id=${alias}.parent_id UNION SELECT p.id,p.parent_id,p.deleted_at FROM resources p JOIN parents a ON p.id=a.parent_id) SELECT 1 FROM parents WHERE deleted_at IS NOT NULL)`;
export async function requireLibraryScope(
  client: pg.PoolClient,
  user: string,
  scope: LibraryScope,
  edit = false,
) {
  const context = currentAuditContext();
  if (context?.integrationId || context?.allowedSpaceIds) {
    if (edit)
      throw new HttpError(403, "Manage reference libraries in the workbench.");
    await requireResearchIntegrationRead(
      user,
      scope.spaceId,
      "research-library",
      client,
    );
  }
  const {
    rows: [space],
  } = await client.query(
    "SELECT id,axiom_space_state(id) AS state,axiom_space_role($2,id) AS role FROM spaces WHERE id=$1 FOR KEY SHARE",
    [scope.spaceId, user],
  );
  if (!space || !space.role || ["trashed", "purging"].includes(space.state))
    throw new HttpError(404, "This library is unavailable.");
  const access = await requireScope(
    client,
    user,
    space.id,
    edit ? "edit" : "read",
  );
  return access.role === "editor" && space.state === "active";
}
export const checkLibraryScope = (
  user: string,
  scope: LibraryScope,
  edit = false,
) => transaction((c) => requireLibraryScope(c, user, scope, edit));
export async function referenceAccess(user: string, id: string) {
  const [r] = await query<LibraryReference>(
    "SELECT * FROM reference_catalog WHERE id=$1",
    [id],
  );
  if (!r || (r.owner_user_id && r.owner_user_id !== user))
    throw new HttpError(404, "This reference is unavailable.");
  await checkLibraryScope(user, { spaceId: r.space_id });
  return r;
}
export async function libraryWrite<T>(
  user: string,
  scope: LibraryScope,
  mutation: string,
  action: string,
  input: unknown,
  work: (c: pg.PoolClient) => Promise<T>,
) {
  await checkLibraryScope(user, scope, true);
  return workspaceMutation(
    user,
    mutation,
    "library:" + action,
    input,
    async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
      );
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "library:" + scope.spaceId,
      ]);
      await requireLibraryScope(c, user, scope, true);
      const provenanceKind =
        action === "merge"
          ? "merge"
          : action.startsWith("edit:")
            ? "edit"
            : action === "copy"
              ? "copy"
              : action === "import"
                ? "import"
                : "";
      await c.query("SELECT set_config('axiom.reference_operation',$1,true)", [
        provenanceKind,
      ]);
      return work(c);
    },
  );
}
export async function libraryAudit(
  c: pg.PoolClient,
  user: string,
  scope: LibraryScope,
  entity: string,
  name: string,
  action: string,
  after: unknown,
) {
  await c.query(
    `INSERT INTO audit_events(actor_id,actor_name,group_id,private_user_id,space_id,entity_id,entity_type,entity_name,action,after_values,operation_id)
 SELECT $1,u.name,s.group_id,s.owner_id,s.id,$3,'reference',$4,$5,$6,nullif(current_setting('axiom.operation_id',true),'')::uuid FROM "user" u JOIN spaces s ON s.id=$2 WHERE u.id=$1`,
    [user, scope.spaceId, entity, name, action, JSON.stringify(after)],
  );
}
export async function lockReferences(
  c: pg.PoolClient,
  user: string,
  scope: LibraryScope,
  ids: string[],
  versions?: Record<string, number>,
) {
  const { rows } = await c.query<LibraryReference>(
    `SELECT * FROM bibliography b WHERE ${libraryPredicate()} AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE`,
    [user, scope.spaceId, ids],
  );
  if (rows.length !== new Set(ids).size)
    throw new HttpError(404, "Some references are unavailable.");
  if (
    rows.some(
      (r) => r.merged_into || (versions && versions[r.id] !== r.version),
    )
  )
    throw new HttpError(
      409,
      "References changed. Refresh and review your selection.",
    );
  return rows;
}
export async function referenceLinks(
  user: string,
  id: string,
  c?: pg.PoolClient,
) {
  const selectedSpace =
    currentAuditContext()?.integrationReadArea === "research-library"
      ? currentAuditContext()?.allowedSpaceIds?.[0]
      : null;
  const run = async (sql: string, v: unknown[]) =>
    c ? (await c.query(sql, v)).rows : query(sql, v);
  const notes = await run(
    `SELECT id,title,space_id,bool_or(manual) AS manual,bool_or(cited) AS cited FROM (
     SELECT n.id,n.title,r.space_id,true AS manual,false AS cited FROM reference_notes l JOIN notes n ON n.id=l.note_id JOIN resources r ON r.note_id=n.id WHERE l.reference_id=$1 AND axiom_space_role($2,r.space_id) IS NOT NULL AND ${liveResource()} AND ($3::uuid IS NULL OR r.space_id=$3)
     UNION ALL SELECT n.id,n.title,r.space_id,false,true FROM note_citations nc JOIN notes n ON n.id=nc.note_id JOIN resources r ON r.note_id=n.id CROSS JOIN LATERAL axiom_note_bibliography(n.id) b WHERE nc.cite_key=b.cite_key AND b.reference_id=$1 AND axiom_space_role($2,r.space_id) IS NOT NULL AND ${liveResource()} AND ($3::uuid IS NULL OR r.space_id=$3)
    ) sources GROUP BY id,title,space_id ORDER BY title,id${selectedSpace ? " LIMIT 201" : ""}`,
    [id, user, selectedSpace],
  );
  const attachments = await run(
    `SELECT a.id,r.id AS resource_id,r.name,r.space_id,a.note_id,v.ordinal,a.bytes FROM reference_attachments l JOIN attachments a ON a.id=l.attachment_id JOIN file_versions v ON v.id=a.id JOIN resources r ON r.id=v.resource_id WHERE l.reference_id=$1 AND axiom_space_role($2,r.space_id) IS NOT NULL AND ${liveResource()} AND ($3::uuid IS NULL OR r.space_id=$3) ORDER BY r.name,a.id${selectedSpace ? " LIMIT 201" : ""}`,
    [id, user, selectedSpace],
  );
  return { notes, attachments };
}
