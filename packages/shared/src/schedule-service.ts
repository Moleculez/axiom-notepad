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
import {
  availabilitySchema,
  unknownAvailability,
  scheduleCapacity,
} from "./planning-analysis";

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
    "SELECT capacity_version FROM groups WHERE id=$1 FOR SHARE",
    [space.group_id],
  );
  if (space.group_id) {
    const { rows } = await db.query(
      'SELECT u.id,u.name,a.settings,a.version FROM members m JOIN "user" u ON u.id=m.user_id LEFT JOIN group_availability a ON a.group_id=m.group_id AND a.user_id=m.user_id WHERE m.group_id=$1 ORDER BY u.id',
      [space.group_id],
    );
    plan.capacity = scheduleCapacity(
      tasks,
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
    );
  }
  const {
    rows: [receipt],
  } = await db.query(
    "INSERT INTO schedule_previews(space_id,user_id,planning_version,plan,capacity_version) VALUES($1,$2,$3,$4,$5) RETURNING id,expires_at",
    [
      space.id,
      user,
      space.planning_version,
      plan,
      group?.capacity_version ?? null,
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
      "SELECT capacity_version FROM groups WHERE id=$1 FOR SHARE",
      [space.group_id],
    );
    if (group?.capacity_version !== preview.capacity_version)
      throw new HttpError(
        409,
        "Group availability changed. Review a fresh schedule preview.",
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
