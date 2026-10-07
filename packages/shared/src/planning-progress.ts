import { query } from "./db";
import { HttpError } from "./access";
import { planningProgress, type PlanningTask } from "./planning";

/** Read only the active descendant closure of visible parents. UNION (rather
 * than UNION ALL) deduplicates overlapping roots and terminates damaged cycles.
 * The existing progress algorithm still counts each active leaf exactly once. */
export async function readPlanningProgress(
  spaceId: string,
  parentIds: string[],
) {
  if (!parentIds.length) return new Map<string, number>();
  const descendants = await query<PlanningTask>(
    `WITH RECURSIVE descendants AS (
       SELECT id,parent_id,status,progress_percent FROM tasks
       WHERE space_id=$1 AND deleted_at IS NULL AND id=ANY($2::uuid[])
       UNION
       SELECT t.id,t.parent_id,t.status,t.progress_percent FROM tasks t
       JOIN descendants d ON t.parent_id=d.id
       WHERE t.space_id=$1 AND t.deleted_at IS NULL
     ) SELECT * FROM descendants LIMIT 50001`,
    [spaceId, [...new Set(parentIds)]],
  );
  if (descendants.length > 50000)
    throw new HttpError(
      413,
      "This task branch exceeds the progress analysis limit.",
    );
  return planningProgress(descendants);
}
