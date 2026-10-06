import { z } from "zod";
import type { PoolClient } from "pg";
import { transaction } from "./db";
import { HttpError, spaceAccess } from "./access";
import {
  requireScope,
  workspaceMutation,
  workspaceJson as json,
} from "./workspace-service";
import { lockPlanning } from "./planning-api";
import { planningEntityHistory } from "./planning-suite-api";
import { fieldDefinitions } from "./planning-field-service";
import {
  fieldInputSchema,
  labLimits,
  timeInputSchema,
  timeQuerySchema,
  localDay,
  fieldPresets,
} from "./planning-lab";
import { parsePage, encodeArchiveCursor } from "./planning-archive-pagination";
import { notifyWorkspace } from "./documents";
import { addDays, dayNumber, dateFromDay } from "./planning";
import { automationApi } from "./planning-automation-api";
import { historyQuerySchema } from "./planning-archives";
import { currentAuditContext } from "./audit-context";

export async function labAudit(
  db: PoolClient,
  user: string,
  space: string,
  id: string,
  kind: string,
  title: string,
  before: unknown,
  after: unknown,
) {
  await db.query(
    `INSERT INTO audit_events(actor_id,actor_name,space_id,group_id,entity_id,entity_type,entity_name,action,before_values,after_values)
    SELECT $1,u.name,$2,s.group_id,$3,$4,$5,'update',$6,$7 FROM spaces s JOIN "user" u ON u.id=$1 WHERE s.id=$2`,
    [user, space, id, kind, title, before, after],
  );
}
export async function planningLabApi(
  request: Request,
  path: string[],
  user: string,
): Promise<Response | null> {
  const [root, space, section, id, action] = path;
  if (
    root !== "spaces" ||
    !space ||
    ![
      "planning-fields",
      "planning-time",
      "planning-automations",
      "planning-automation-runs",
    ].includes(section)
  )
    return null;
  z.uuid().parse(space);
  const scope = await spaceAccess(user, space),
    params = new URL(request.url).searchParams;
  if (section.startsWith("planning-automation"))
    return automationApi(request, path, user);
  if (request.method === "GET")
    return json(
      await transaction(async (db) => {
        await requireScope(db, user, space);
        if (section === "planning-fields") {
          if (id || action) throw new HttpError(404, "Unknown field read.");
          return fieldDefinitions(db, space);
        }
        if (section === "planning-time" && id === "export")
          return timePage(
            db,
            space,
            user,
            scope.timezone ?? "UTC",
            params,
            true,
          );
        if (id) {
          z.uuid().parse(id);
          const row = (
            await db.query(
              `SELECT e.*,t.title AS task_title,t.deleted_at AS task_deleted_at,u.name AS author_name FROM planning_time e JOIN tasks t ON t.id=e.task_id LEFT JOIN "user" u ON u.id=e.author_id WHERE e.space_id=$1 AND e.id=$2`,
              [space, id],
            )
          ).rows[0];
          if (!row) throw new HttpError(404, "Time entry unavailable.");
          if (action && action !== "history")
            throw new HttpError(404, "Unknown time operation.");
          if (action === "history") {
            return readTimeHistoryPage(db, params, space, user, id);
          }
          return { item: row };
        }
        return timePage(db, space, user, scope.timezone ?? "UTC", params);
      }),
    );
  if (!["POST", "PATCH"].includes(request.method))
    throw new HttpError(405, "Use POST or PATCH for lab operations.");
  const actorContext = currentAuditContext();
  if (
    actorContext?.integrationId ||
    actorContext?.pluginGrantId ||
    actorContext?.assistantContextId
  )
    throw new HttpError(
      403,
      "Task-field configuration and time changes require native workspace controls.",
    );
  const raw = await request.json(),
    mutationId = z.uuid().parse(raw.mutationId);
  const result = await workspaceMutation(
    user,
    mutationId,
    `lab:${space}:${section}:${id ?? ""}:${action ?? ""}:${request.method}`,
    raw,
    async (db) => {
      const settings = await lockPlanning(
        db,
        user,
        space,
        section === "planning-fields" ? "manage" : "edit",
      );
      if (section === "planning-fields") {
        if (action) throw new HttpError(404, "Unknown field operation.");
        if (id === "presets") {
          if (settings.planning_fields_version !== raw.fieldsVersion)
            throw new HttpError(
              409,
              "Task fields changed. Review this preset again before creating fields.",
            );
          const preset = z
              .enum(["experiment", "paperReview"])
              .parse(raw.preset),
            existing = await fieldDefinitions(db, space),
            drafts = fieldPresets[preset].map((p) =>
              fieldInputSchema.parse({
                ...p,
                options: ("choices" in p ? (p.choices ?? []) : []).map(
                  (label) => ({
                    id: crypto.randomUUID(),
                    label,
                    archived: false,
                  }),
                ),
              }),
            );
          if (
            existing.items.length + drafts.length > labLimits.retainedFields ||
            existing.items.filter((f) => !f.archived).length + drafts.length >
              labLimits.activeFields
          )
            throw new HttpError(
              413,
              "This preset would exceed the workspace field limit.",
            );
          if (
            drafts.some((d) =>
              existing.items.some(
                (f) =>
                  !f.archived &&
                  f.name.toLocaleLowerCase() === d.name.toLocaleLowerCase(),
              ),
            )
          )
            throw new HttpError(
              409,
              "An active field already has a preset name. No fields were created; add the remaining fields individually.",
            );
          const items = [];
          for (const draft of drafts) {
            const row = (
              await db.query(
                "INSERT INTO planning_fields(space_id,name,kind,unit,options,archived,position,created_by) VALUES($1,$2,$3,$4,$5,false,$6,$7) RETURNING *",
                [
                  space,
                  draft.name,
                  draft.kind,
                  draft.unit,
                  JSON.stringify(draft.options),
                  draft.position,
                  user,
                ],
              )
            ).rows[0];
            items.push(row);
            await planningEntityHistory(
              db,
              user,
              space,
              row.id,
              "task-field",
              row.name,
              "Created field from reviewed preset",
            );
            await labAudit(
              db,
              user,
              space,
              row.id,
              "task-field",
              row.name,
              null,
              row,
            );
          }
          await db.query(
            "UPDATE spaces SET planning_fields_version=planning_fields_version+1 WHERE id=$1",
            [space],
          );
          return { items, fieldsVersion: settings.planning_fields_version + 1 };
        }
        const old = id
          ? (
              await db.query(
                "SELECT * FROM planning_fields WHERE id=$1 AND space_id=$2 FOR UPDATE",
                [z.uuid().parse(id), space],
              )
            ).rows[0]
          : null;
        if (id && !old) throw new HttpError(404, "Field unavailable.");
        if (
          settings.planning_fields_version !== raw.fieldsVersion ||
          (old && old.version !== raw.version)
        )
          throw new HttpError(
            409,
            "Fields changed. Reload the definitions before saving; your draft was retained.",
          );
        const input = fieldInputSchema.parse({ ...old, ...raw });
        if (old && input.kind !== old.kind)
          throw new HttpError(
            409,
            "Field types are immutable. Archive this field and create a new one.",
          );
        const counts = (
          await db.query(
            "SELECT count(*)::int AS total,count(*) FILTER(WHERE NOT archived)::int AS active FROM planning_fields WHERE space_id=$1",
            [space],
          )
        ).rows[0];
        if (
          (!old && counts.total >= labLimits.retainedFields) ||
          (!input.archived &&
            (!old || old.archived) &&
            counts.active >= labLimits.activeFields)
        )
          throw new HttpError(
            413,
            "This workspace has reached its task-field limit.",
          );
        if (
          input.archived &&
          !old?.archived &&
          (
            await db.query(
              `SELECT 1 FROM planning_automations r WHERE r.space_id=$1 AND enabled AND NOT archived AND (EXISTS(SELECT 1 FROM jsonb_array_elements(r.config->'conditions') v WHERE v->>'fieldId'=$2) OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.config->'actions') v WHERE v->>'fieldId'=$2)) LIMIT 1`,
              [space, id],
            )
          ).rowCount
        )
          throw new HttpError(
            409,
            "Pause the rules using this field before archiving it.",
          );
        for (const removed of (old?.options ?? []).filter(
          (o: { id: string }) => !input.options.some((n) => n.id === o.id),
        ))
          if (
            (old.used_options ?? []).includes(removed.id) ||
            (
              await db.query(
                "SELECT 1 FROM planning_field_values WHERE space_id=$1 AND field_id=$2 AND (value=to_jsonb($3::text) OR value @> jsonb_build_array($3::text)) LIMIT 1",
                [space, id, removed.id],
              )
            ).rowCount
          )
            throw new HttpError(
              409,
              "A task has used this option. Archive the option instead of removing its stable identity.",
            );
        let row;
        try {
          row = (
            await db.query(
              old
                ? "UPDATE planning_fields SET name=$3,kind=$4,unit=$5,options=$6,archived=$7,position=$8,version=version+1,updated_at=now() WHERE id=$1 AND space_id=$2 RETURNING *"
                : "INSERT INTO planning_fields(id,space_id,name,kind,unit,options,archived,position,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
              [
                id ?? crypto.randomUUID(),
                space,
                input.name,
                input.kind,
                input.unit,
                JSON.stringify(input.options),
                input.archived,
                input.position,
                ...(!old ? [user] : []),
              ],
            )
          ).rows[0];
        } catch (e) {
          if ((e as { code?: string }).code === "23505")
            throw new HttpError(409, "An active field already has that name.");
          throw e;
        }
        await db.query(
          "UPDATE spaces SET planning_fields_version=planning_fields_version+1 WHERE id=$1",
          [space],
        );
        await planningEntityHistory(
          db,
          user,
          space,
          row.id,
          "task-field",
          row.name,
          old
            ? input.archived
              ? "Archived field"
              : "Updated field"
            : "Created field",
        );
        await labAudit(
          db,
          user,
          space,
          row.id,
          "task-field",
          row.name,
          old,
          row,
        );
        return {
          item: row,
          fieldsVersion: settings.planning_fields_version + 1,
        };
      }
      const old = id
        ? (
            await db.query(
              "SELECT * FROM planning_time WHERE id=$1 AND space_id=$2 FOR UPDATE",
              [z.uuid().parse(id), space],
            )
          ).rows[0]
        : null;
      if (id && !old) throw new HttpError(404, "Time entry unavailable.");
      if (old && old.version !== raw.version)
        throw new HttpError(
          409,
          "This time entry changed. Your correction has not been applied.",
        );
      const access = await requireScope(db, user, space, "edit"),
        reason = z
          .string()
          .trim()
          .max(500)
          .parse(raw.reason ?? "");
      if (old && old.author_id !== user && (!access.manage || !reason))
        throw new HttpError(
          403,
          "Managers need a correction reason to change another person's entry.",
        );
      if (action && !["withdraw", "restore"].includes(action))
        throw new HttpError(404, "Unknown time operation.");
      if (action && !old)
        throw new HttpError(400, "Choose an existing time entry.");
      if (
        old &&
        ((action === "withdraw" && old.withdrawn) ||
          (action === "restore" && !old.withdrawn))
      )
        throw new HttpError(
          409,
          "This entry is already in the requested state. Reload its confirmed status.",
        );
      if (old?.withdrawn && !action)
        throw new HttpError(409, "Restore this entry before editing it.");
      const input = action
        ? {
            taskId: old.task_id,
            spentOn: old.spent_on,
            minutes: old.minutes,
            note: old.note,
          }
        : timeInputSchema.parse({
            taskId: raw.taskId,
            spentOn: raw.spentOn,
            minutes: raw.minutes,
            note: raw.note ?? "",
          });
      if (old && input.taskId !== old.task_id)
        throw new HttpError(
          400,
          "Withdraw this entry and record a new one to change its task.",
        );
      if (!action) {
        if (input.spentOn > localDay(settings.timezone))
          throw new HttpError(
            400,
            "Record work already done, not a future date.",
          );
        if (
          !(
            await db.query(
              "SELECT 1 FROM tasks WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL",
              [input.taskId, space],
            )
          ).rowCount
        )
          throw new HttpError(404, "Choose a live task in this workspace.");
      }
      const row = (
        await db.query(
          old
            ? "UPDATE planning_time SET spent_on=$3,minutes=$4,note=$5,withdrawn=$6,version=version+1,updated_at=now() WHERE id=$1 AND space_id=$2 RETURNING *"
            : "INSERT INTO planning_time(id,space_id,spent_on,minutes,note,withdrawn,task_id,author_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            id ?? crypto.randomUUID(),
            space,
            input.spentOn,
            input.minutes,
            input.note,
            action === "withdraw",
            ...(!old ? [input.taskId, user] : []),
          ],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO planning_time_history(entry_id,space_id,actor_id,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)",
        [row.id, space, user, reason, old, JSON.stringify(row)],
      );
      await planningEntityHistory(
        db,
        user,
        space,
        row.id,
        "time-entry",
        "Time entry",
        action === "withdraw"
          ? "Withdrew time entry"
          : action === "restore"
            ? "Restored time entry"
            : old
              ? "Corrected time entry"
              : "Recorded time entry",
      );
      await labAudit(
        db,
        user,
        space,
        row.id,
        "time-entry",
        "Time entry",
        old,
        row,
      );
      return { item: row };
    },
  );
  await notifyWorkspace();
  return json(result);
}

/** Current access is required by the caller; filters never broaden on a cursor error. */
export async function readTimeHistoryPage(
  db: PoolClient,
  params: URLSearchParams,
  space: string,
  user: string,
  entry: string,
) {
  let parsed;
  try {
    parsed = parsePage(
      historyQuerySchema.parse(Object.fromEntries(params)),
      "time-history",
      space,
      user,
      entry,
      false,
      Date.now(),
    );
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const { query, cursor, context } = parsed;
  const asOf =
    cursor?.asOf ??
    (
      await db.query(
        `SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
      )
    ).rows[0].at;
  const args: unknown[] = [space, entry, asOf];
  const bind = (value: unknown) => {
    args.push(value);
    return `$${args.length}`;
  };
  const where = [
    "h.space_id=$1",
    "h.entry_id=$2",
    "h.created_at<=$3::timestamptz",
  ];
  if (query.q) {
    const search = bind("%" + query.q.replace(/[\\%_]/g, "\\$&") + "%");
    where.push(
      `(h.reason ILIKE ${search} OR h.before_data->>'note' ILIKE ${search} OR h.after_data->>'note' ILIKE ${search})`,
    );
  }
  if (query.mine === "1") where.push(`h.actor_id=${bind(user)}`);
  const countWhere = where.join(" AND ");
  const direction = query.sort === "oldest" ? "ASC" : "DESC";
  if (cursor)
    where.push(
      `(h.created_at,h.id)${direction === "ASC" ? ">" : "<"}(${bind(cursor.at)}::timestamptz,${bind(cursor.id)}::uuid)`,
    );
  const limit = bind(query.limit + 1);
  const result = (
    await db.query(
      `SELECT (SELECT count(*)::int FROM planning_time_history h WHERE ${countWhere}) AS total,
    coalesce((SELECT jsonb_agg(p ORDER BY p.created_at ${direction},p.id ${direction}) FROM (
      SELECT h.*,u.name AS actor_name,to_char(h.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
      FROM planning_time_history h LEFT JOIN "user" u ON u.id=h.actor_id WHERE ${where.join(" AND ")}
      ORDER BY h.created_at ${direction},h.id ${direction} LIMIT ${limit}
    ) p),'[]') AS items`,
      args,
    )
  ).rows[0];
  const items = result.items.slice(0, query.limit),
    last = items.at(-1);
  return {
    items: items.map(({ cursor_at: _cursor, ...item }: any) => item),
    total: result.total,
    asOf,
    nextCursor:
      result.items.length > query.limit && last
        ? encodeArchiveCursor({
            v: 1,
            context,
            asOf,
            at: last.cursor_at,
            id: last.id,
          })
        : null,
  };
}
export async function timePage(
  db: PoolClient,
  space: string,
  user: string,
  timezone: string,
  params: URLSearchParams,
  includeNotes = false,
) {
  const today = localDay(timezone),
    monday = dateFromDay(
      dayNumber(today) - ((new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7),
    );
  let parsed;
  try {
    parsed = parsePage(
      timeQuerySchema.parse({
        from: monday,
        to: addDays(monday, 6),
        ...Object.fromEntries(params),
      }),
      "time",
      space,
      user,
      null,
      true,
      Date.now(),
    );
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const { query: q, cursor, context } = parsed;
  if (dayNumber(q.to!) - dayNumber(q.from!) + 1 > 366)
    throw new HttpError(400, "Choose at most 366 days for a time report.");
  const asOf =
    cursor?.asOf ??
    (
      await db.query(
        `SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
      )
    ).rows[0].at;
  const args: unknown[] = [space, asOf, q.from, q.to],
    bind = (v: unknown) => {
      args.push(v);
      return `$${args.length}`;
    };
  const where = [
    "e.space_id=$1",
    "e.created_at<=$2::timestamptz",
    "e.spent_on BETWEEN $3::date AND $4::date",
  ];
  if (q.state !== "all")
    where.push(`e.withdrawn=${bind(q.state === "withdrawn")}`);
  if (q.member) where.push(`e.author_id=${bind(q.member)}`);
  if (q.task) {
    const task = bind(q.task);
    where.push(
      q.descendants === "1"
        ? `e.task_id IN (WITH RECURSIVE tree AS (SELECT id FROM tasks WHERE space_id=$1 AND id=${task}::uuid UNION SELECT child.id FROM tasks child JOIN tree parent ON child.parent_id=parent.id WHERE child.space_id=$1) SELECT id FROM tree)`
        : `e.task_id=${task}::uuid`,
    );
  }
  if (q.q) {
    const search = bind("%" + q.q.replace(/[\\%_]/g, "\\$&") + "%");
    where.push(`(t.title ILIKE ${search} OR e.note ILIKE ${search})`);
  }
  const countWhere = where.join(" AND ");
  if (cursor)
    where.push(
      `(e.spent_on,e.id)<(${bind(cursor.at)}::date,${bind(cursor.id)}::uuid)`,
    );
  const limit = bind(q.limit + 1);
  const result = (
    await db.query(
      `WITH matches AS (SELECT e.*,t.title AS task_title,t.deleted_at AS task_deleted_at,u.name AS author_name FROM planning_time e JOIN tasks t ON t.id=e.task_id LEFT JOIN "user" u ON u.id=e.author_id WHERE ${countWhere}),
  totals AS (SELECT count(*)::int AS total,coalesce(sum(minutes),0)::bigint AS minutes FROM matches)
  SELECT totals.*,coalesce((SELECT jsonb_agg(x) FROM (SELECT author_id AS id,author_name AS name,sum(minutes)::bigint AS minutes FROM matches GROUP BY author_id,author_name ORDER BY author_name NULLS LAST,author_id) x),'[]') AS members,
  coalesce((SELECT jsonb_agg(x) FROM (SELECT to_char(date_trunc('week',spent_on),'YYYY-MM-DD') AS week,sum(minutes)::bigint AS minutes FROM matches GROUP BY 1 ORDER BY 1) x),'[]') AS weeks,
  coalesce((SELECT jsonb_agg(x ORDER BY x.spent_on DESC,x.id DESC) FROM (SELECT e.id,e.task_id,t.title AS task_title,t.deleted_at AS task_deleted_at,e.author_id,u.name AS author_name,to_char(e.spent_on,'YYYY-MM-DD') AS spent_on,e.minutes,${includeNotes ? "e.note," : ""}left(e.note,200) AS note_preview,length(e.note)>200 AS note_truncated,e.withdrawn,e.version,e.created_at,e.updated_at FROM planning_time e JOIN tasks t ON t.id=e.task_id LEFT JOIN "user" u ON u.id=e.author_id WHERE ${where.join(" AND ")} ORDER BY e.spent_on DESC,e.id DESC LIMIT ${limit}) x),'[]') AS items FROM totals`,
      args,
    )
  ).rows[0];
  const items = result.items.slice(0, q.limit),
    last = items.at(-1);
  return {
    items,
    total: result.total,
    totals: {
      minutes: Number(result.minutes),
      entries: result.total,
      byMember: result.members.map((r: any) => ({
        ...r,
        minutes: Number(r.minutes),
      })),
      byWeek: result.weeks.map((r: any) => ({
        ...r,
        minutes: Number(r.minutes),
      })),
    },
    asOf,
    nextCursor:
      result.items.length > q.limit && last
        ? encodeArchiveCursor({
            v: 1,
            context,
            asOf,
            at: last.spent_on,
            id: last.id,
          })
        : null,
  };
}
