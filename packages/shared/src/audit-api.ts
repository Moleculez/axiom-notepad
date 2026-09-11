import { z } from "zod";
import { query } from "./db";
import { HttpError } from "./access";
import { workspaceJson as json } from "./workspace-service";
import type { AuditEvent } from "./audit";

const filtersSchema = z.object({
  space: z.uuid().optional(),
  actor: z.string().max(200).optional(),
  action: z.string().max(80).optional(),
  entity: z.string().max(80).optional(),
  q: z.string().max(200).default(""),
  after: z.iso.date().optional(),
  before: z.iso.date().optional(),
  cursor: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const columns = `e.*,
 CASE WHEN axiom_base_space_role($1,e.space_id) IS NOT NULL OR axiom_manage_space($1,e.space_id)
   THEN s.name ELSE NULL END AS space_name,
 (EXISTS(SELECT 1 FROM snapshots v JOIN resources r ON r.note_id=v.note_id
   WHERE v.id=e.version_id AND r.deleted_at IS NULL AND axiom_space_role($1,r.space_id) IS NOT NULL)
   OR EXISTS(SELECT 1 FROM file_versions v JOIN resources r ON r.id=v.resource_id WHERE v.id=e.version_id AND r.deleted_at IS NULL AND axiom_space_role($1,r.space_id) IS NOT NULL)) AS version_available,
 (SELECT kind FROM resources WHERE id::text=e.entity_id AND axiom_space_role($1,space_id) IS NOT NULL) AS resource_kind,
 (SELECT space_id FROM resources WHERE id::text=e.entity_id AND axiom_space_role($1,space_id) IS NOT NULL) AS resource_space_id,
 EXISTS(SELECT 1 FROM resources r WHERE r.id::text=e.entity_id AND r.deleted_at IS NULL
   AND axiom_space_role($1,r.space_id) IS NOT NULL) AS resource_available`;

/** Historical locations are not a backdoor into a currently inaccessible space. */
async function redactLocations(events: AuditEvent[], userId: string) {
  const ids = [
    ...new Set(
      events.flatMap((e) =>
        [e.before_values, e.after_values]
          .flatMap((value) => [
            value?.space_id,
            value?.parent_id,
            value?.shortcut_target_id,
          ])
          .filter(
            (id): id is string =>
              typeof id === "string" && z.uuid().safeParse(id).success,
          ),
      ),
    ),
  ];
  const visible = new Set(
    (
      await query<{ id: string }>(
        `SELECT id FROM spaces WHERE id=ANY($2::uuid[]) AND axiom_base_space_role($1,id) IS NOT NULL
     UNION SELECT id FROM resources WHERE id=ANY($2::uuid[]) AND axiom_base_space_role($1,space_id) IS NOT NULL`,
        [userId, ids],
      )
    ).map((r) => r.id),
  );
  return events.map((event) => ({
    ...event,
    ...Object.fromEntries(
      (["before_values", "after_values"] as const).map((field) => [
        field,
        event[field] &&
          Object.fromEntries(
            Object.entries(event[field]!).map(([key, value]) => [
              key,
              ["space_id", "parent_id", "shortcut_target_id"].includes(key) &&
              typeof value === "string" &&
              !visible.has(value)
                ? "Unavailable location"
                : value,
            ]),
          ),
      ]),
    ),
  }));
}
export async function auditApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  if (path[0] !== "audit") return null;
  if (request.method !== "GET")
    throw new HttpError(405, "Audit history is read-only.");
  const [, id, action] = path,
    url = new URL(request.url);
  if (id === "operations") {
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(url.searchParams.get("offset") ?? 0);
    const status = z
      .enum([
        "",
        "queued",
        "running",
        "completed",
        "cancelled",
        "failed",
        "done",
      ])
      .parse(url.searchParams.get("status") ?? "");
    const items = await query(
      `SELECT * FROM (
       SELECT id,'files' AS kind,command,status,created_at,jsonb_array_length(input->'items') AS total,
         (SELECT count(*)::int FROM jsonb_array_elements(results) r WHERE (r->>'ok')::boolean) AS done,
         (SELECT count(*)::int FROM jsonb_array_elements(results) r WHERE NOT (r->>'ok')::boolean) AS blocked,NULL::uuid AS space_id
       FROM file_operations WHERE user_id=$1
       UNION ALL SELECT o.id,'trash',o.action,o.status,o.created_at,count(i.resource_id)::int,
         count(*) FILTER(WHERE i.status='done')::int,count(*) FILTER(WHERE i.status IN ('blocked','skipped'))::int,NULL::uuid
       FROM trash_operations o LEFT JOIN trash_operation_items i ON i.operation_id=o.id WHERE o.user_id=$1 AND o.status<>'preview' GROUP BY o.id
       UNION ALL SELECT j.id,'workspace','purge',CASE WHEN j.status='done' AND j.error='Cancelled by the workspace owner' THEN 'cancelled' ELSE j.status END,j.created_at,1,CASE WHEN j.status='done' AND j.error IS NULL THEN 1 ELSE 0 END,
         CASE WHEN j.status='failed' THEN 1 ELSE 0 END,(j.payload->>'spaceId')::uuid
       FROM workspace_jobs j WHERE j.kind='purge-space' AND j.payload->>'userId'=$1
       ) operations WHERE ($3='' OR status=$3) ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $2`,
      [userId, offset, status],
    );
    return json({
      items: items.slice(0, 50),
      nextOffset: items.length > 50 ? offset + 50 : null,
    });
  }
  if (id && id !== "export") {
    z.string()
      .regex(/^\d{1,20}$/)
      .parse(id);
    const [event] = await query<AuditEvent>(
      `SELECT ${columns} FROM audit_events e LEFT JOIN audit_scopes s ON s.space_id=e.space_id
       WHERE e.id=$2 AND axiom_audit_visible($1,e)`,
      [userId, id],
    );
    if (!event)
      throw new HttpError(
        404,
        "This history is unavailable with your current access.",
      );
    if (action === "version") {
      if (!event.version_available)
        throw new HttpError(
          410,
          "This version expired, was removed, or is no longer accessible.",
        );
      const [version] = await query(
        `SELECT v.id,v.title,v.body,v.label,v.created_at,previous.body AS previous_body,previous.created_at AS previous_created_at
         FROM snapshots v JOIN resources r ON r.note_id=v.note_id
         LEFT JOIN LATERAL (SELECT body,created_at FROM snapshots p WHERE p.note_id=v.note_id AND (p.created_at,p.id)<(v.created_at,v.id) ORDER BY p.created_at DESC,p.id DESC LIMIT 1) previous ON true
         WHERE v.id=$2 AND r.deleted_at IS NULL AND axiom_space_role($1,r.space_id) IS NOT NULL`,
        [userId, event.version_id],
      );
      if (!version) throw new HttpError(404, "Version unavailable.");
      return json(version);
    }
    return json((await redactLocations([event], userId))[0]);
  }
  const f = filtersSchema.parse(Object.fromEntries(url.searchParams));
  const events = await query<AuditEvent>(
    `SELECT ${columns} FROM audit_events e LEFT JOIN audit_scopes s ON s.space_id=e.space_id
     WHERE axiom_audit_visible($1,e) AND ($2::uuid IS NULL OR e.space_id=$2)
       AND ($3::text IS NULL OR e.actor_id=$3 OR $3=ANY(e.contributors))
       AND ($4::text IS NULL OR e.action=$4) AND ($5::text IS NULL OR e.entity_type=$5)
       AND (e.entity_name ILIKE $6 OR e.actor_name ILIKE $6)
       AND ($7::date IS NULL OR e.created_at>=$7::date) AND ($8::date IS NULL OR e.created_at<$8::date+interval '1 day')
       AND ($9::bigint IS NULL OR (e.created_at,e.id)<(SELECT c.created_at,c.id FROM audit_events c WHERE c.id=$9 AND axiom_audit_visible($1,c))) ORDER BY e.created_at DESC,e.id DESC LIMIT $10`,
    [
      userId,
      f.space ?? null,
      f.actor ?? null,
      f.action ?? null,
      f.entity ?? null,
      `%${f.q.replace(/[\\%_]/g, "\\$&")}%`,
      f.after ?? null,
      f.before ?? null,
      f.cursor ?? null,
      f.limit + 1,
    ],
  );
  const items = await redactLocations(events.slice(0, f.limit), userId);
  return json({
    items,
    nextCursor: events.length > f.limit ? items.at(-1)!.id : null,
  });
}
