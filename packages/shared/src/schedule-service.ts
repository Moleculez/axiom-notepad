import type { PoolClient } from "pg";
import { HttpError } from "./access";
import { planningTasks } from "./planning-api";
import {
  calendarSchema,
  planSchedule,
  type ScheduleChange,
  type SchedulePlan,
} from "./planning";
import { recordActivity } from "./workspace-service";
import { currentAuditContext } from "./audit-context";
import {
  availabilitySchema,
  unknownAvailability,
  scheduleCapacity,
} from "./planning-analysis";

async function capacityScopes(db: PoolClient, user: string, group: string) {
  const audit = currentAuditContext(),
    integration = audit?.integrationId ?? null,
    allowed = audit?.allowedSpaceIds ?? null;
  const rows = (
    await db.query(
      `SELECT s.id,s.planning_calendar,s.timezone,s.planning_version FROM spaces s WHERE s.group_id=$1
  AND axiom_space_role($2,s.id) IS NOT NULL AND axiom_space_state(s.id)='active'
  AND ($3::uuid IS NULL OR s.id=ANY((SELECT space_ids FROM integration_connections WHERE id=$3 AND user_id=$2 AND revoked_at IS NULL)::uuid[]))
  AND ($4::uuid[] IS NULL OR s.id=ANY($4::uuid[])) ORDER BY s.id LIMIT 101`,
      [group, user, integration, allowed],
    )
  ).rows;
  if (rows.length > 100)
    throw new HttpError(
      413,
      "Capacity previews support at most 100 accessible active workspaces.",
    );
  return rows;
}

/** Caller holds lockPlanning. All entrypoints use identical immutable receipts. */
export async function previewSchedule(
  db: PoolClient,
  user: string,
  space: Record<string, any>,
  changes: ScheduleChange[],
) {
  let plan: SchedulePlan;
  const tasks = await planningTasks(db, space.id);
  const calendar = calendarSchema.parse({
    ...space.planning_calendar,
    timezone: space.timezone,
  });
  try {
    plan = planSchedule(
      tasks,
      changes,
      calendarSchema.parse({
        ...space.planning_calendar,
        timezone: space.timezone,
      }),
    );
  } catch (e) {
    throw new HttpError(409, (e as Error).message);
  }
  const {
    rows: [group],
  } = await db.query(
    "SELECT capacity_version,planning_context_version FROM groups WHERE id=$1 FOR UPDATE",
    [space.group_id],
  );
  let capacityContext: { version: string; spaceIds: string[] } | null = null;
  if (space.group_id) {
    const scopes = await capacityScopes(db, user, space.group_id),
      cohort = [] as Awaited<ReturnType<typeof planningTasks>>;
    for (const s of scopes) {
      cohort.push(
        ...(s.id === space.id ? tasks : await planningTasks(db, s.id)),
      );
      if (cohort.length > 100000)
        throw new HttpError(
          413,
          "Capacity previews support at most 100,000 tasks.",
        );
    }
    capacityContext = {
      version: String(group.planning_context_version),
      spaceIds: scopes.map((s) => s.id),
    };
    const { rows } = await db.query(
      'SELECT u.id,u.name,a.settings,a.version FROM members m JOIN "user" u ON u.id=m.user_id LEFT JOIN group_availability a ON a.group_id=m.group_id AND a.user_id=m.user_id WHERE m.group_id=$1 ORDER BY u.id',
      [space.group_id],
    );
    plan.capacity = scheduleCapacity(
      cohort,
      calendar,
      rows.map((p) => ({
        id: p.id,
        name: p.name,
        version: p.version ?? 0,
        availability: p.settings
          ? availabilitySchema.parse(p.settings)
          : unknownAvailability,
      })),
      plan,
      Object.fromEntries(
        scopes.map((s) => [
          s.id,
          calendarSchema.parse({
            ...s.planning_calendar,
            timezone: s.timezone,
          }),
        ]),
      ),
    );
    if (plan.capacity)
      plan.capacity.coverage =
        "Estimated commitments across accessible active workspaces in this group. Restricted workspaces are not included; availability may be unknown.";
  }
  const {
    rows: [receipt],
  } = await db.query(
    "INSERT INTO schedule_previews(space_id,user_id,planning_version,plan,capacity_version,capacity_context) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,expires_at",
    [
      space.id,
      user,
      space.planning_version,
      plan,
      group?.capacity_version ?? null,
      capacityContext,
    ],
  );
  await db.query(
    "DELETE FROM schedule_previews WHERE space_id=$1 AND applied_at IS NULL AND expires_at<now()",
    [space.id],
  );
  return { ...receipt, ...plan };
}
export async function applySchedule(
  db: PoolClient,
  user: string,
  space: Record<string, any>,
  previewId: string,
  mode: "direct" | "proposed" = "proposed",
  undo = false,
) {
  const {
    rows: [preview],
  } = await db.query(
    "SELECT * FROM schedule_previews WHERE id=$1 AND space_id=$2 AND user_id=$3 FOR UPDATE",
    [previewId, space.id, user],
  );
  if (!preview) throw new HttpError(404, "Schedule preview unavailable.");
  if (undo) {
    if (preview.undone_at) return { ok: true, undone: true };
    if (!preview.applied_at)
      throw new HttpError(409, "This schedule has not been applied.");
    for (const row of preview.inverse as ScheduleChange[]) {
      const { rowCount } = await db.query(
        "UPDATE tasks SET start_on=$3,due_on=$4,version=version+1,updated_at=now() WHERE id=$1 AND space_id=$2 AND version=$5 AND deleted_at IS NULL",
        [row.id, space.id, row.startOn, row.dueOn, row.version],
      );
      if (!rowCount)
        throw new HttpError(
          409,
          "A scheduled task changed; Undo would overwrite newer work.",
        );
    }
    await db.query("UPDATE schedule_previews SET undone_at=now() WHERE id=$1", [
      preview.id,
    ]);
    await recordActivity(db, {
      spaceId: space.id,
      userId: user,
      kind: "planning",
      title: "Undid schedule change",
    });
    return { ok: true, undone: true };
  }
  if (preview.applied_at)
    return {
      ok: true,
      undoId: preview.id,
      count: (preview.inverse ?? []).length,
    };
  if (
    new Date(preview.expires_at).valueOf() <= Date.now() ||
    space.planning_version !== preview.planning_version
  )
    throw new HttpError(
      409,
      "This schedule preview expired or the plan changed. Preview again.",
    );
  if (space.group_id) {
    const {
      rows: [group],
    } = await db.query(
      "SELECT capacity_version,planning_context_version FROM groups WHERE id=$1 FOR UPDATE",
      [space.group_id],
    );
    if (group?.capacity_version !== preview.capacity_version)
      throw new HttpError(
        409,
        "Group availability changed. Review a fresh schedule preview.",
      );
    const context = preview.capacity_context as {
      version: string;
      spaceIds: string[];
    } | null;
    const scopes = await capacityScopes(db, user, space.group_id);
    if (
      !context ||
      context.version !== String(group.planning_context_version) ||
      JSON.stringify(context.spaceIds) !==
        JSON.stringify(scopes.map((s) => s.id))
    )
      throw new HttpError(
        409,
        "Shared planning commitments or access changed. Review a fresh schedule preview.",
      );
  }
  const inverse: ScheduleChange[] = [];
  for (const row of (preview.plan as SchedulePlan)[mode]) {
    const {
      rows: [before],
    } = await db.query(
      "SELECT start_on::text,due_on::text,version FROM tasks WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL FOR UPDATE",
      [row.id, space.id],
    );
    if (!before || before.version !== row.version)
      throw new HttpError(409, "A scheduled task changed. Preview again.");
    inverse.push({
      id: row.id,
      version: row.version + 1,
      startOn: before.start_on,
      dueOn: before.due_on,
    });
    await db.query(
      "UPDATE tasks SET start_on=$2,due_on=$3,version=version+1,updated_at=now() WHERE id=$1",
      [row.id, row.startOn, row.dueOn],
    );
  }
  await db.query(
    "UPDATE schedule_previews SET applied_at=now(),inverse=$2 WHERE id=$1",
    [preview.id, JSON.stringify(inverse)],
  );
  await recordActivity(db, {
    spaceId: space.id,
    userId: user,
    kind: "planning",
    title: `Rescheduled ${inverse.length} tasks`,
  });
  return { ok: true, undoId: preview.id, count: inverse.length };
}
