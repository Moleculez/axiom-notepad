import type { PoolClient } from "pg";
import { HttpError } from "./access";
import {
  intakeStatuses,
  type IntakePage,
  type IntakeDetail,
  type IntakeSummary,
} from "./planning-intake";
import {
  encodeIntakeCursor,
  intakeFilterStatuses,
  parseIntakePageQuery,
} from "./planning-intake-pagination";

const timestamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const fields = `i.id,i.kind,i.title,i.priority,i.status,i.created_by,i.due_on,i.version,
  i.decision_note,i.task_id,i.created_at,i.updated_at,u.name AS author_name,v.name AS reviewer_name`;
const people = `LEFT JOIN "user" u ON u.id=i.created_by LEFT JOIN "user" v ON v.id=i.reviewed_by`;

/** Caller rechecks workspace access. Counts and rows share one SQL snapshot. */
export async function readIntakePage(
  db: PoolClient,
  params: URLSearchParams,
  space: string,
  user: string,
  canReview: boolean,
): Promise<IntakePage> {
  let parsed: ReturnType<typeof parseIntakePageQuery>;
  try {
    parsed = parseIntakePageQuery(params, space, user);
  } catch (error) {
    // Schema errors retain the application's ordinary field-error handling.
    if (error instanceof Error && "issues" in error) throw error;
    throw new HttpError(400, (error as Error).message);
  }
  const { query, context, cursor } = parsed;
  const asOf =
    cursor?.asOf ??
    (await db.query(`SELECT ${timestamp("statement_timestamp()")} AS at`))
      .rows[0].at;
  const values: unknown[] = [space, asOf];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const where = ["i.space_id=$1", "i.created_at <= $2::timestamptz"];
  if (query.q) {
    const search = bind(`%${query.q.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(
      `(i.title ILIKE ${search} OR i.body ILIKE ${search} OR i.decision_note ILIKE ${search})`,
    );
  }
  if (query.kind) where.push(`i.kind=${bind(query.kind)}`);
  if (query.mine === "1") where.push(`i.created_by=${bind(user)}`);
  const countWhere = where.join(" AND ");
  const statuses = intakeFilterStatuses(query.filter);
  if (statuses) where.push(`i.status=ANY(${bind(statuses)}::text[])`);
  const direction = query.sort === "oldest" ? "ASC" : "DESC";
  if (cursor)
    where.push(
      `(i.created_at,i.id) ${direction === "ASC" ? ">" : "<"} (${bind(cursor.at)}::timestamptz,${bind(cursor.id)}::uuid)`,
    );
  const result = (
    await db.query<{
      counts: Partial<IntakePage["statusCounts"]>;
      items: Array<IntakeSummary & { cursor_at: string }>;
    }>(
      `WITH counts AS (SELECT i.status,count(*)::int AS count FROM planning_intake i WHERE ${countWhere} GROUP BY i.status)
      SELECT coalesce((SELECT jsonb_object_agg(status,count) FROM counts),'{}') AS counts,
      coalesce((SELECT jsonb_agg(p ORDER BY p.created_at ${direction},p.id ${direction}) FROM (
        SELECT ${fields},${timestamp("i.created_at")} AS cursor_at FROM planning_intake i ${people}
        WHERE ${where.join(" AND ")} ORDER BY i.created_at ${direction},i.id ${direction} LIMIT ${bind(query.limit + 1)}
      ) p),'[]') AS items`,
      values,
    )
  ).rows[0];
  const statusCounts = Object.fromEntries(
    intakeStatuses.map((status) => [status, result.counts[status] ?? 0]),
  ) as IntakePage["statusCounts"];
  const total = (statuses ?? intakeStatuses).reduce(
    (n, status) => n + statusCounts[status as keyof typeof statusCounts],
    0,
  );
  const rows = result.items;
  const page = rows.slice(0, query.limit),
    last = page.at(-1);
  return {
    canReview,
    total,
    statusCounts,
    asOf,
    items: page.map(({ cursor_at: _cursorAt, ...item }) => item),
    nextCursor:
      rows.length > query.limit && last
        ? encodeIntakeCursor({
            v: 1,
            context,
            asOf,
            at: last.cursor_at,
            id: last.id,
          })
        : null,
  };
}
export async function readIntakeDetail(
  db: PoolClient,
  space: string,
  id: string,
  canReview: boolean,
): Promise<IntakeDetail> {
  const item = (
    await db.query<IntakeDetail["item"]>(
      `SELECT ${fields},i.body FROM planning_intake i ${people} WHERE i.space_id=$1 AND i.id=$2`,
      [space, id],
    )
  ).rows[0];
  if (!item)
    throw new HttpError(
      404,
      "This request is no longer available in this workspace.",
    );
  return { canReview, item };
}
