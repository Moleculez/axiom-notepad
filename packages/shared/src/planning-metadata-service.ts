import type { PoolClient } from "pg";
import { HttpError } from "./access";
import {
  assertRevision,
  recordActivity,
  deliverEvent,
} from "./workspace-service";
import { taskStatusSchema, taskPrioritySchema } from "./workspace";
import { z } from "zod";
import {
  fieldDefinitions,
  validateCustomPatch,
} from "./planning-field-service";
import type {
  MetadataPatch,
  AutomationTask,
  FieldDefinitions,
} from "./planning-lab";
import { customFieldsPatchSchema } from "./planning-lab";
import { metadataBatchUpdateSql } from "./planning-metadata-query";

export const metadataPatchSchema = z
  .object({
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assigneeId: z.string().max(100).nullable().optional(),
    labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    customFields: customFieldsPatchSchema.optional(),
  })
  .strict();
/** One transaction-owned, graph-free path for non-structural metadata batches. */
export async function applyMetadataBatch(
  db: PoolClient,
  user: string,
  space: string,
  changes: Array<{ id: string; version: number; patch: MetadataPatch }>,
  fieldsVersion?: number,
  providedDefinitions?: FieldDefinitions,
) {
  if (
    !changes.length ||
    changes.length > 1000 ||
    new Set(changes.map((c) => c.id)).size !== changes.length
  )
    throw new HttpError(400, "Choose 1–1,000 distinct tasks.");
  const ids = changes.map((c) => z.uuid().parse(c.id)),
    rows = (
      await db.query<
        Pick<
          AutomationTask,
          | "id"
          | "version"
          | "title"
          | "status"
          | "priority"
          | "assignee_id"
          | "labels"
        > & { deleted_at: string | null }
      >(
        "SELECT id,version,title,status,priority,assignee_id,labels,deleted_at FROM tasks WHERE space_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
        [space, ids],
      )
    ).rows;
  if (rows.length !== changes.length)
    throw new HttpError(404, "An affected task is unavailable.");
  const byId = new Map(rows.map((t) => [t.id, t])),
    defs = changes.some((c) => c.patch.customFields)
      ? (providedDefinitions ?? (await fieldDefinitions(db, space)))
      : undefined;
  const assignees = [
    ...new Set(
      changes.flatMap((c) => (c.patch.assigneeId ? [c.patch.assigneeId] : [])),
    ),
  ];
  if (
    assignees.length &&
    (
      await db.query(
        'SELECT id FROM "user" WHERE id=ANY($1::text[]) AND axiom_space_role(id,$2) IS NOT NULL',
        [assignees, space],
      )
    ).rowCount !== assignees.length
  )
    throw new HttpError(400, "An assignee no longer has workspace access.");
  const prepared = [];
  const persons = [
    ...new Set(
      changes.flatMap((c) =>
        Object.entries(c.patch.customFields ?? {}).flatMap(([id, v]) =>
          defs?.items.some((f) => f.id === id && f.kind === "person") &&
          typeof v === "string"
            ? [v]
            : [],
        ),
      ),
    ),
  ];
  const permittedPeople = new Set<string>(
    persons.length
      ? (
          await db.query(
            'SELECT id FROM "user" WHERE id=ANY($1::text[]) AND axiom_space_role(id,$2) IS NOT NULL',
            [persons, space],
          )
        ).rows.map((r) => r.id)
      : [],
  );
  for (const c of changes) {
    const old = byId.get(c.id)!;
    assertRevision(old.version, c.version);
    if (old.deleted_at)
      throw new HttpError(409, "Restore the affected task before editing it.");
    const p = metadataPatchSchema.parse(c.patch),
      values = p.customFields
        ? await validateCustomPatch(
            db,
            space,
            p.customFields,
            fieldsVersion,
            {},
            defs,
            permittedPeople,
          )
        : null;
    prepared.push({
      id: c.id,
      status: p.status ?? old.status,
      priority: p.priority ?? old.priority,
      assignee_id: Object.hasOwn(p, "assigneeId")
        ? p.assigneeId
        : old.assignee_id,
      labels: p.labels ?? old.labels,
      // Send only touched fields. PostgreSQL retains all other canonical values;
      // nulls delete just those keys and never become a second map writer.
      custom_patch: p.customFields
        ? Object.fromEntries(
            Object.entries(p.customFields).map(([id, value]) => [
              id,
              value === null ? null : values![id],
            ]),
          )
        : null,
      old,
    });
  }
  const results = (
    await db.query(metadataBatchUpdateSql, [
      space,
      JSON.stringify(prepared.map(({ old: _old, ...p }) => p)),
    ])
  ).rows;
  for (const p of prepared) {
    await recordActivity(db, {
      spaceId: space,
      userId: user,
      kind: "planning",
      title: `Updated task: ${p.old.title}`,
      taskId: p.id,
    });
    if (
      p.assignee_id &&
      p.assignee_id !== user &&
      p.assignee_id !== p.old.assignee_id
    )
      await deliverEvent(db, {
        userId: p.assignee_id,
        spaceId: space,
        kind: "assignments",
        title: `Assigned to you: ${p.old.title}`,
        taskId: p.id,
        dedupe: `assigned:${p.id}:${results.find((t) => t.id === p.id)!.version}`,
      });
  }
  return results as Array<{ id: string; version: number }>;
}
