import { randomUUID, createHash } from "node:crypto";
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
import {
  fieldDefinitions,
  validateCustomPatch,
  fieldWhere,
} from "./planning-field-service";
import { applyMetadataBatch } from "./planning-metadata-service";
import {
  ruleInputSchema,
  validateRuleConfiguration,
  labLimits,
  localDay,
  localClock,
  ruleMatches,
  ruleChange,
  type AutomationRule,
  type AutomationTask,
  type AutomationChange,
} from "./planning-lab";
import { parsePage, encodeArchiveCursor } from "./planning-archive-pagination";
import { notifyWorkspace } from "./documents";
import { labAudit } from "./planning-lab-api";
import { currentAuditContext } from "./audit-context";

export function decodeRule(row: any): AutomationRule {
  return {
    ...row.config,
    id: row.id,
    space_id: row.space_id,
    name: row.name,
    enabled: row.enabled,
    archived: row.archived,
    version: row.version,
    configured_by: row.configured_by,
  };
}
async function validateRule(db: PoolClient, space: string, raw: unknown) {
  const rule = ruleInputSchema.parse(raw),
    defs = await fieldDefinitions(db, space);
  try {
    validateRuleConfiguration(rule, defs.items);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const people = new Set<string>();
  for (const c of rule.conditions)
    if (
      c.op === "eq" &&
      typeof c.value === "string" &&
      (c.field === "assignee" ||
        (c.field === "custom" &&
          defs.items.some((f) => f.id === c.fieldId && f.kind === "person")))
    )
      people.add(c.value);
  for (const a of rule.actions)
    if (
      typeof a.value === "string" &&
      a.value &&
      (a.kind === "assignee" ||
        (a.kind === "custom" &&
          defs.items.some((f) => f.id === a.fieldId && f.kind === "person")))
    )
      people.add(a.value);
  const permittedPeople = new Set<string>(
    people.size
      ? (
          await db.query<{ id: string }>(
            "SELECT id FROM unnest($1::text[]) people(id) WHERE axiom_space_role(id,$2) IS NOT NULL",
            [[...people], space],
          )
        ).rows.map((p) => p.id)
      : [],
  );
  if (permittedPeople.size !== people.size)
    throw new HttpError(
      400,
      "Choose people with current workspace access for conditions and actions.",
    );
  const patch = Object.fromEntries(
    rule.actions
      .filter((a) => a.kind === "custom")
      .map((a) => [a.fieldId, a.value]),
  );
  if (Object.keys(patch).length)
    await validateCustomPatch(
      db,
      space,
      patch,
      defs.version,
      {},
      defs,
      permittedPeople,
    );
  return rule;
}
async function ruleAuthority(db: PoolClient, row: any) {
  if (!row.configured_by) return false;
  const scope = (
    await db.query(
      "SELECT axiom_space_role($1,$2) AS role,axiom_manage_space($1,$2) AS manage,axiom_space_state($2) AS state",
      [row.configured_by, row.space_id],
    )
  ).rows[0];
  return scope?.role === "editor" && scope.manage && scope.state === "active";
}
const taskFields =
  "id,version,title,status,priority,assignee_id,labels,to_char(due_on,'YYYY-MM-DD') AS due_on,custom_fields,deleted_at";
async function collectChanges(db: PoolClient, row: any, events?: any[]) {
  const rule = decodeRule(row),
    defs = await fieldDefinitions(db, row.space_id),
    today = localDay(
      (
        await db.query("SELECT timezone FROM spaces WHERE id=$1", [
          row.space_id,
        ])
      ).rows[0].timezone,
    );
  const args: unknown[] = [row.space_id],
    custom = rule.conditions
      .filter((c) => c.field === "custom")
      .map((c) => ({ fieldId: c.fieldId!, op: c.op, value: c.value }));
  validateRuleConfiguration(rule, defs.items);
  let where = "space_id=$1 AND deleted_at IS NULL";
  if (events) {
    args.push(events.map((e) => e.task_id));
    where += " AND id=ANY($2::uuid[])";
  }
  if (custom.length) where += fieldWhere(custom, defs.items, args, "t");
  // Conditions are compiled to bindings so Run now/daily scans never transfer the full graph.
  for (const c of rule.conditions.filter((c) => c.field !== "custom")) {
    const bind = (v: unknown) => {
      args.push(v);
      return `$${args.length}`;
    };
    if (c.field === "overdue") {
      const expr = `(due_on<${bind(today)}::date AND status NOT IN ('done','cancelled'))`;
      where += c.value ? ` AND ${expr}` : ` AND NOT coalesce(${expr},false)`;
    } else if (c.field === "label")
      where +=
        c.op === "contains"
          ? ` AND ${bind(c.value)}=ANY(labels)`
          : c.op === "empty"
            ? " AND cardinality(labels)=0"
            : " AND cardinality(labels)>0";
    else {
      const col = c.field === "assignee" ? "assignee_id" : c.field;
      where +=
        c.op === "empty"
          ? ` AND ${col} IS NULL`
          : c.op === "notEmpty"
            ? ` AND ${col} IS NOT NULL`
            : ` AND ${col}=${bind(c.value)}`;
    }
  }
  const tasks = (
    await db.query<AutomationTask>(
      `SELECT ${taskFields} FROM tasks t WHERE ${where} ORDER BY id LIMIT ${labLimits.runTasks + 1}`,
      args,
    )
  ).rows;
  if (tasks.length > labLimits.runTasks)
    return {
      changes: [] as AutomationChange[],
      fieldsVersion: defs.version,
      error:
        "More than 100 tasks match. Narrow this rule before preparing changes.",
    };
  const changes: AutomationChange[] = [];
  const currentEvents = events
    ? (
        await db.query(
          "SELECT id,version FROM tasks WHERE space_id=$1 AND id=ANY($2::uuid[])",
          [row.space_id, events.map((e) => e.task_id)],
        )
      ).rows
    : [];
  const superseded =
    events?.filter(
      (e) =>
        e.kind === rule.trigger &&
        !currentEvents.some(
          (t) => t.id === e.task_id && t.version === e.task_version,
        ),
    ).length ?? 0;
  for (const task of tasks) {
    if (events) {
      const event = events.find(
        (e) => e.task_id === task.id && e.task_version === task.version,
      );
      if (
        !event ||
        event.created_at < row.enabled_at ||
        event.kind !== rule.trigger ||
        (event.kind === "changed" &&
          !rule.watched.some(
            (k) =>
              JSON.stringify(event.before_data?.[k]) !==
              JSON.stringify(event.after_data[k]),
          ))
      )
        continue;
    }
    if (ruleMatches(rule, task, today)) {
      const change = ruleChange(rule, task);
      if (change) changes.push(change);
    }
  }
  return {
    changes,
    fieldsVersion: defs.version,
    notice: superseded
      ? `${superseded} superseded task event(s) skipped. Run now to evaluate current metadata.`
      : null,
    error:
      Buffer.byteLength(JSON.stringify(changes)) > labLimits.runBytes
        ? "This proposal exceeds 1.5 MiB. Narrow the rule or reduce its changed values."
        : null,
  };
}
async function createRun(
  db: PoolClient,
  row: any,
  key: string,
  events?: any[],
) {
  const existing = (
    await db.query(
      "SELECT id,status FROM planning_automation_runs WHERE rule_id=$1 AND rule_version=$2 AND event_key=$3",
      [row.id, row.version, key],
    )
  ).rows[0];
  if (existing) return existing;
  let result;
  try {
    result = await collectChanges(db, row, events);
  } catch (e) {
    result = {
      changes: [],
      fieldsVersion: (await fieldDefinitions(db, row.space_id)).version,
      error: (e as Error).message,
    };
  }
  return (
    await db.query(
      "INSERT INTO planning_automation_runs(space_id,rule_id,rule_version,field_version,event_key,changes,status,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(rule_id,rule_version,event_key) DO UPDATE SET event_key=excluded.event_key RETURNING id,status",
      [
        row.space_id,
        row.id,
        row.version,
        result.fieldsVersion,
        key,
        JSON.stringify(result.error ? [] : result.changes),
        result.error ? "blocked" : result.changes.length ? "pending" : "noop",
        result.error ?? ("notice" in result ? result.notice : null),
      ],
    )
  ).rows[0];
}
const runQuery = z.object({
  q: z.string().trim().max(200).default(""),
  status: z
    .enum([
      "all",
      "pending",
      "applied",
      "blocked",
      "cancelled",
      "undone",
      "noop",
    ])
    .default("pending"),
  rule: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(1200).optional(),
});
async function readRuns(
  db: PoolClient,
  space: string,
  user: string,
  params: URLSearchParams,
) {
  let parsed;
  try {
    parsed = parsePage(
      runQuery.parse(Object.fromEntries(params)),
      "automation-runs",
      space,
      user,
      null,
      false,
      Date.now(),
    );
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const { query: q, cursor, context } = parsed,
    asOf =
      cursor?.asOf ??
      (
        await db.query(
          `SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
        )
      ).rows[0].at;
  const args: unknown[] = [space, asOf],
    bind = (v: unknown) => {
      args.push(v);
      return `$${args.length}`;
    },
    where = ["r.space_id=$1", "r.created_at<=$2::timestamptz"];
  if (q.status !== "all") where.push(`r.status=${bind(q.status)}`);
  if (q.rule) where.push(`r.rule_id=${bind(q.rule)}::uuid`);
  if (q.q)
    where.push(
      `a.name ILIKE ${bind("%" + q.q.replace(/[\\%_]/g, "\\$&") + "%")}`,
    );
  const countWhere = where.join(" AND ");
  if (cursor)
    where.push(
      `(r.created_at,r.id)<(${bind(cursor.at)}::timestamptz,${bind(cursor.id)}::uuid)`,
    );
  const limit = bind(q.limit + 1),
    result = (
      await db.query(
        `SELECT (SELECT count(*)::int FROM planning_automation_runs r JOIN planning_automations a ON a.id=r.rule_id WHERE ${countWhere}) AS total,coalesce((SELECT jsonb_agg(x ORDER BY x.created_at DESC,x.id DESC) FROM (SELECT r.id,r.rule_id,a.name AS rule_name,r.status,r.error,r.version,r.created_at,jsonb_array_length(r.changes) AS tasks,to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM planning_automation_runs r JOIN planning_automations a ON a.id=r.rule_id WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC,r.id DESC LIMIT ${limit}) x),'[]') AS items`,
        args,
      )
    ).rows[0];
  const items = result.items.slice(0, q.limit),
    last = items.at(-1);
  return {
    items: items.map(({ cursor_at: _at, ...r }: any) => r),
    total: result.total,
    asOf,
    nextCursor:
      result.items.length > q.limit && last
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
export async function automationApi(
  request: Request,
  path: string[],
  user: string,
) {
  const [, space, section, id, action] = path;
  await spaceAccess(user, space);
  const actorContext = currentAuditContext();
  if (
    (actorContext?.integrationId ||
      actorContext?.pluginGrantId ||
      actorContext?.assistantContextId) &&
    request.method !== "GET"
  )
    throw new HttpError(
      403,
      "Automation configuration and approval require the native workspace controls.",
    );
  if (request.method === "GET")
    return json(
      await transaction(async (db) => {
        await requireScope(db, user, space);
        if (section === "planning-automations") {
          if (action) throw new HttpError(404, "Unknown rule read.");
          const rows = (
            await db.query(
              `SELECT * FROM planning_automations WHERE space_id=$1 ${id ? "AND id=$2" : ""} ORDER BY archived,lower(name),id`,
              [space, ...(id ? [z.uuid().parse(id)] : [])],
            )
          ).rows;
          if (id && !rows.length) throw new HttpError(404, "Rule unavailable.");
          return { items: rows.map(decodeRule), limits: labLimits };
        }
        if (id) {
          if (action) throw new HttpError(404, "Unknown run read.");
          const row = (
            await db.query(
              "SELECT r.*,a.name AS rule_name FROM planning_automation_runs r JOIN planning_automations a ON a.id=r.rule_id WHERE r.space_id=$1 AND r.id=$2",
              [space, z.uuid().parse(id)],
            )
          ).rows[0];
          if (!row) throw new HttpError(404, "Run unavailable.");
          return { item: row };
        }
        return readRuns(db, space, user, new URL(request.url).searchParams);
      }),
    );
  if (!["POST", "PATCH"].includes(request.method))
    throw new HttpError(405, "Use POST or PATCH for reviewed rules.");
  const raw = await request.json(),
    mutationId = z.uuid().parse(raw.mutationId),
    result = await workspaceMutation(
      user,
      mutationId,
      `automation:${space}:${section}:${id ?? ""}:${action ?? ""}:${request.method}`,
      raw,
      async (db) => {
        const settings = await lockPlanning(db, user, space, "manage");
        await requireScope(db, user, space, "edit");
        if (section === "planning-automations") {
          const old = id
            ? (
                await db.query(
                  "SELECT * FROM planning_automations WHERE space_id=$1 AND id=$2 FOR UPDATE",
                  [space, z.uuid().parse(id)],
                )
              ).rows[0]
            : null;
          if (id && !old) throw new HttpError(404, "Rule unavailable.");
          if (old && old.version !== raw.version)
            throw new HttpError(
              409,
              "The rule changed. Reload before continuing.",
            );
          if (action === "run") {
            if (!old.enabled || old.archived || !(await ruleAuthority(db, old)))
              throw new HttpError(
                409,
                "Enable this rule with current workspace management access first.",
              );
            return createRun(db, old, "manual:" + mutationId);
          }
          if (old && ["pause", "archive", "reopen"].includes(action)) {
            const updated = (
              await db.query(
                "UPDATE planning_automations SET enabled=false,archived=CASE WHEN $3='archive' THEN true WHEN $3='reopen' THEN false ELSE archived END,enabled_at=NULL,version=version+1,updated_at=now() WHERE id=$1 AND space_id=$2 RETURNING *",
                [id, space, action],
              )
            ).rows[0];
            await planningEntityHistory(
              db,
              user,
              space,
              id,
              "automation",
              old.name,
              action === "pause"
                ? "Paused rule"
                : action === "archive"
                  ? "Archived rule"
                  : "Reopened paused rule",
            );
            await labAudit(
              db,
              user,
              space,
              id,
              "automation",
              old.name,
              old,
              updated,
            );
            return { item: decodeRule(updated) };
          }
          if (action) throw new HttpError(404, "Unknown rule action.");
          if (raw.fieldsVersion !== settings.planning_fields_version)
            throw new HttpError(
              409,
              "Task fields changed. Review the latest definitions before saving this rule; your draft was retained.",
            );
          const {
              version: _v,
              mutationId: _m,
              fieldsVersion: _f,
              ...input
            } = raw,
            rule = await validateRule(
              db,
              space,
              old ? { ...old.config, ...input } : input,
            );
          const counts = (
            await db.query(
              "SELECT count(*)::int AS total,count(*) FILTER(WHERE enabled AND NOT archived)::int AS enabled FROM planning_automations WHERE space_id=$1",
              [space],
            )
          ).rows[0];
          if (
            (!old && counts.total >= labLimits.rules) ||
            (rule.enabled &&
              !rule.archived &&
              !old?.enabled &&
              counts.enabled >= labLimits.enabledRules)
          )
            throw new HttpError(
              413,
              "This workspace has reached its rule limit.",
            );
          const enabled = rule.enabled && !rule.archived,
            ruleId = id ?? randomUUID();
          const row = (
            await db.query(
              old
                ? "UPDATE planning_automations SET name=$3,config=$4,enabled=$5,archived=$6,configured_by=$7,enabled_at=CASE WHEN $5 THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE id=$1 AND space_id=$2 RETURNING *"
                : "INSERT INTO planning_automations(id,space_id,name,config,enabled,archived,configured_by,enabled_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5 THEN now() ELSE NULL END) RETURNING *",
              [
                ruleId,
                space,
                rule.name,
                JSON.stringify(rule),
                enabled,
                rule.archived,
                user,
              ],
            )
          ).rows[0];
          await planningEntityHistory(
            db,
            user,
            space,
            row.id,
            "automation",
            row.name,
            old ? "Updated reviewed rule" : "Created disabled-by-default rule",
          );
          await labAudit(
            db,
            user,
            space,
            row.id,
            "automation",
            row.name,
            old,
            row,
          );
          return { item: decodeRule(row) };
        }
        const run = (
          await db.query(
            "SELECT * FROM planning_automation_runs WHERE id=$1 AND space_id=$2 FOR UPDATE",
            [z.uuid().parse(id), space],
          )
        ).rows[0];
        if (!run) throw new HttpError(404, "Run unavailable.");
        if (run.version !== raw.version)
          throw new HttpError(
            409,
            "This proposal changed. Reload its confirmed status before continuing.",
          );
        const row = (
          await db.query(
            "SELECT * FROM planning_automations WHERE id=$1 AND space_id=$2",
            [run.rule_id, space],
          )
        ).rows[0];
        if (action === "cancel") {
          if (!["pending", "blocked"].includes(run.status))
            throw new HttpError(
              409,
              "Only an unapplied proposal can be cancelled.",
            );
          await db.query(
            "UPDATE planning_automation_runs SET status='cancelled',preview=NULL,version=version+1,updated_at=now() WHERE id=$1",
            [id],
          );
        } else if (action === "preview" || action === "apply") {
          if (
            run.status !== "pending" ||
            !row.enabled ||
            row.archived ||
            row.version !== run.rule_version ||
            settings.planning_fields_version !== run.field_version ||
            !(await ruleAuthority(db, row))
          )
            throw new HttpError(
              409,
              "This proposal is stale or its authority changed. Cancel it and use Run now to prepare a fresh proposal.",
            );
          const ids = z
              .array(z.uuid())
              .min(1)
              .max(labLimits.runTasks)
              .parse(raw.selected),
            all = run.changes as AutomationChange[];
          if (
            new Set(ids).size !== ids.length ||
            ids.some((id) => !all.some((c) => c.id === id))
          )
            throw new HttpError(
              400,
              "Choose distinct tasks from this exact proposal.",
            );
          const selected = all.filter((c) => ids.includes(c.id)),
            tasks = (
              await db.query(
                "SELECT id,version,deleted_at FROM tasks WHERE space_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
                [space, ids],
              )
            ).rows;
          if (
            tasks.length !== selected.length ||
            selected.some(
              (c) =>
                !tasks.some(
                  (t) =>
                    t.id === c.id && t.version === c.version && !t.deleted_at,
                ),
            )
          )
            throw new HttpError(
              409,
              "An affected task changed. Nothing has been applied.",
            );
          if (action === "preview") {
            const preview = {
              id: randomUUID(),
              selected: ids.sort(),
              expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
              userId: user,
            };
            await db.query(
              "UPDATE planning_automation_runs SET preview=$2,version=version+1,updated_at=now() WHERE id=$1",
              [id, JSON.stringify(preview)],
            );
            return { preview, version: run.version + 1, changes: selected };
          }
          if (
            !run.preview ||
            run.preview.id !== raw.previewId ||
            run.preview.userId !== user ||
            Date.parse(run.preview.expiresAt) < Date.now() ||
            JSON.stringify(run.preview.selected) !==
              JSON.stringify([...ids].sort())
          )
            throw new HttpError(
              409,
              "Review this exact selection again before applying it.",
            );
          await db.query(
            "SELECT set_config('axiom.automation_origin',$1,true)",
            [id],
          );
          const applied = await applyMetadataBatch(
            db,
            user,
            space,
            selected,
            run.field_version,
          );
          const changes = all.map((c) => {
            const item = applied.find((t) => t.id === c.id);
            return item ? { ...c, resultVersion: item.version } : c;
          });
          await db.query(
            "UPDATE planning_automation_runs SET status='applied',changes=$2,approved_by=$3,preview=NULL,version=version+1,updated_at=now() WHERE id=$1",
            [id, JSON.stringify(changes), user],
          );
        } else if (action === "undo") {
          if (run.status !== "applied")
            throw new HttpError(409, "Choose a confirmed applied run.");
          await db.query(
            "SELECT set_config('axiom.automation_origin',$1,true)",
            [id],
          );
          await applyMetadataBatch(
            db,
            user,
            space,
            (run.changes as AutomationChange[])
              .filter((c) => c.resultVersion != null)
              .map((c) => ({
                id: c.id,
                version: c.resultVersion!,
                patch: c.before,
              })),
            settings.planning_fields_version,
          );
          await db.query(
            "UPDATE planning_automation_runs SET status='undone',version=version+1,updated_at=now() WHERE id=$1",
            [id],
          );
        } else throw new HttpError(404, "Unknown proposal action.");
        await planningEntityHistory(
          db,
          user,
          space,
          id,
          "automation-run",
          row.name,
          action === "apply"
            ? "Applied reviewed rule"
            : action === "undo"
              ? "Undid reviewed rule"
              : "Cancelled proposed rule",
        );
        const updated = (
          await db.query("SELECT * FROM planning_automation_runs WHERE id=$1", [
            id,
          ])
        ).rows[0];
        await labAudit(
          db,
          user,
          space,
          id,
          "automation-run",
          row.name,
          run,
          updated,
        );
        return {
          item: updated,
        };
      },
    );
  await notifyWorkspace();
  return json(result);
}

/** Short PostgreSQL row-lock leases: proposals and processed markers commit together. */
export async function processPlanningAutomation() {
  let worked = false;
  await transaction(async (db) => {
    const first = (
      await db.query(
        "SELECT space_id FROM planning_automation_events WHERE processed_at IS NULL ORDER BY created_at,id LIMIT 1",
      )
    ).rows[0];
    if (first) {
      // Writers lock the workspace before a task/outbox row. Take locks in that
      // same order: leasing an event first can deadlock a coalescing task write.
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "automation:" + first.space_id,
      ]);
      await db.query("SELECT id FROM spaces WHERE id=$1 FOR KEY SHARE", [
        first.space_id,
      ]);
      const events = (
        await db.query(
          "SELECT * FROM planning_automation_events WHERE space_id=$1 AND processed_at IS NULL ORDER BY created_at,id LIMIT 100 FOR UPDATE SKIP LOCKED",
          [first.space_id],
        )
      ).rows;
      const rules = events.length
        ? (
            await db.query(
              "SELECT * FROM planning_automations WHERE space_id=$1 AND enabled AND NOT archived AND config->>'trigger'<>'daily' ORDER BY id",
              [first.space_id],
            )
          ).rows
        : [];
      const key =
        "events:" +
        createHash("sha256")
          .update(
            events
              .map((e) => e.id)
              .sort()
              .join(","),
          )
          .digest("hex");
      for (const row of rules) {
        if (await ruleAuthority(db, row)) await createRun(db, row, key, events);
        else await pauseWithoutAuthority(db, row, key);
      }
      if (events.length) {
        await db.query(
          "UPDATE planning_automation_events SET processed_at=now() WHERE id=ANY($1::uuid[])",
          [events.map((e) => e.id)],
        );
        worked = true;
      }
    }
    // Bounded due rules; idempotent local-day keys survive DST and process restarts.
    const daily = (
      await db.query(
        "SELECT r.id,r.space_id FROM planning_automations r JOIN spaces s ON s.id=r.space_id WHERE r.enabled AND NOT r.archived AND r.config->>'trigger'='daily' AND axiom_space_state(r.space_id)='active' AND to_char(now() AT TIME ZONE s.timezone,'HH24:MI')>=r.config->>'at' AND NOT EXISTS(SELECT 1 FROM planning_automation_runs x WHERE x.rule_id=r.id AND x.rule_version=r.version AND x.event_key='day:'||to_char(now() AT TIME ZONE s.timezone,'YYYY-MM-DD')) ORDER BY r.id LIMIT 10",
      )
    ).rows;
    for (const candidate of daily) {
      await db.query("SELECT id FROM spaces WHERE id=$1 FOR KEY SHARE", [
        candidate.space_id,
      ]);
      const row = (
        await db.query(
          "SELECT r.*,s.timezone FROM planning_automations r JOIN spaces s ON s.id=r.space_id WHERE r.id=$1 AND r.enabled AND NOT r.archived AND r.config->>'trigger'='daily' FOR UPDATE OF r SKIP LOCKED",
          [candidate.id],
        )
      ).rows[0];
      if (!row) continue;
      if (
        localClock(row.timezone) >= row.config.at &&
        (await ruleAuthority(db, row))
      ) {
        await createRun(db, row, "day:" + localDay(row.timezone));
        worked = true;
      } else if (!(await ruleAuthority(db, row))) {
        await pauseWithoutAuthority(db, row, "authority:" + row.version);
        worked = true;
      }
    }
  });
  if (worked) await notifyWorkspace();
  return worked;
}
async function pauseWithoutAuthority(db: PoolClient, row: any, key: string) {
  const defs = await fieldDefinitions(db, row.space_id);
  await db.query(
    "INSERT INTO planning_automation_runs(space_id,rule_id,rule_version,field_version,event_key,status,error) VALUES($1,$2,$3,$4,$5,'blocked','The configuring manager no longer has active editing and management access. This rule was paused; a current manager can review and re-enable it.') ON CONFLICT DO NOTHING",
    [row.space_id, row.id, row.version, defs.version, key],
  );
  const updated = (
    await db.query(
      "UPDATE planning_automations SET enabled=false,enabled_at=NULL,version=version+1,updated_at=now() WHERE id=$1 AND version=$2 RETURNING *",
      [row.id, row.version],
    )
  ).rows[0];
  if (updated) {
    await db.query(
      "INSERT INTO planning_history(space_id,entity_id,kind,summary) VALUES($1,$2,'automation','Paused rule after management access changed')",
      [row.space_id, row.id],
    );
    await db.query(
      "INSERT INTO audit_events(actor_name,space_id,group_id,entity_id,entity_type,entity_name,action,before_values,after_values) SELECT 'System',$1,s.group_id,$2,'automation',$3,'update',$4,$5 FROM spaces s WHERE s.id=$1",
      [row.space_id, row.id, row.name, row, updated],
    );
  }
}
