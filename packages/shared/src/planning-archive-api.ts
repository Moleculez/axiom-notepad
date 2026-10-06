import type { PoolClient } from "pg";
import { HttpError } from "./access";
import { planningTasks } from "./planning-api";
import { goalProgress, goalProgressContext } from "./planning-suite";
import {
  workspaceGoalLimit,
  type ArchivePage,
  type GoalDetail,
  type GoalPage,
  type HistoryEntry,
  type HistoryPage,
  type OccurrencePage,
  type OccurrenceSummary,
} from "./planning-archives";
import {
  encodeArchiveCursor,
  parseGoalPageQuery,
  parseHistoryPageQuery,
  parseOccurrencePageQuery,
  type ArchiveCursor,
} from "./planning-archive-pagination";

const timestamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const literalSearch = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
function parseQuery<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof Error && "issues" in error) throw error;
    throw new HttpError(400, (error as Error).message);
  }
}
async function ceiling(db: PoolClient, cursor: ArchiveCursor | null) {
  return (
    cursor?.asOf ??
    ((await db.query(`SELECT ${timestamp("statement_timestamp()")} AS at`))
      .rows[0].at as string)
  );
}
function bindings(space: string, asOf: string) {
  const values: unknown[] = [space, asOf];
  return {
    values,
    bind(value: unknown) {
      values.push(value);
      return `$${values.length}`;
    },
  };
}
function page<T extends { id: string; cursor_at: string }>(
  rows: T[],
  total: number,
  limit: number,
  context: string,
  asOf: string,
): ArchivePage<Omit<T, "cursor_at">> {
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    total,
    asOf,
    items: items.map(({ cursor_at: _at, ...item }) => item),
    nextCursor:
      rows.length > limit && last
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
const goalFields = `g.id,g.title,g.owner_id,u.name AS owner_name,to_char(g.due_on,'YYYY-MM-DD') AS due_on,g.kind,g.target,g.current_value,g.unit,
  g.task_ids,g.milestone_ids,g.archived,g.version,g.created_at,g.updated_at`;
type GoalRow = Omit<GoalDetail, "progress" | "body">;
async function withProgress<T extends GoalRow>(
  db: PoolClient,
  space: string,
  rows: T[],
) {
  // Manual-metric pages never fetch the workspace task graph. Linked goals share
  // one index per response; their source-backed descriptions never enter a list.
  const linked = rows.some((g) => g.kind === "linked");
  const tasks = linked ? await planningTasks(db, space) : [];
  const milestones = linked
    ? (
        await db.query(
          "SELECT id,completed_at FROM project_milestones WHERE space_id=$1",
          [space],
        )
      ).rows
    : [];
  const context = linked ? goalProgressContext(tasks, milestones) : undefined;
  return rows.map((g) => ({
    ...g,
    target: Number(g.target),
    current_value: Number(g.current_value),
    progress: goalProgress(g, tasks, milestones, context),
  }));
}
/** All helpers require a current authorized workspace scope from their caller. */
export async function readGoalPage(
  db: PoolClient,
  params: URLSearchParams,
  space: string,
  user: string,
): Promise<GoalPage> {
  const { query, cursor, context } = parseQuery(() =>
    parseGoalPageQuery(params, space, user),
  );
  const asOf = await ceiling(db, cursor),
    { values, bind } = bindings(space, asOf);
  const where = ["g.space_id=$1", "g.created_at <= $2::timestamptz"];
  if (query.q) {
    const search = bind(literalSearch(query.q));
    where.push(`(g.title ILIKE ${search} OR g.body ILIKE ${search})`);
  }
  if (query.kind) where.push(`g.kind=${bind(query.kind)}`);
  if (query.mine === "1") where.push(`g.owner_id=${bind(user)}`);
  const countWhere = where.join(" AND ");
  if (query.filter !== "all")
    where.push(`g.archived=${bind(query.filter === "archived")}`);
  const direction = query.sort === "oldest" ? "ASC" : "DESC";
  if (cursor)
    where.push(
      `(g.created_at,g.id) ${direction === "ASC" ? ">" : "<"} (${bind(cursor.at)}::timestamptz,${bind(cursor.id)}::uuid)`,
    );
  const result = (
    await db.query<{
      active: number;
      archived: number;
      workspace_total: number;
      items: Array<GoalRow & { cursor_at: string }>;
    }>(
      `WITH counts AS (SELECT count(*) FILTER (WHERE NOT g.archived)::int AS active,count(*) FILTER (WHERE g.archived)::int AS archived FROM planning_goals g WHERE ${countWhere})
    SELECT counts.*,(SELECT count(*)::int FROM planning_goals WHERE space_id=$1) AS workspace_total,
    coalesce((SELECT jsonb_agg(p ORDER BY p.created_at ${direction},p.id ${direction}) FROM (
      SELECT ${goalFields},${timestamp("g.created_at")} AS cursor_at FROM planning_goals g LEFT JOIN "user" u ON u.id=g.owner_id
      WHERE ${where.join(" AND ")} ORDER BY g.created_at ${direction},g.id ${direction} LIMIT ${bind(query.limit + 1)}
    ) p),'[]') AS items FROM counts`,
      values,
    )
  ).rows[0];
  const total =
    query.filter === "all"
      ? result.active + result.archived
      : result[query.filter];
  const paged = page(result.items, total, query.limit, context, asOf);
  const enriched = await withProgress(db, space, paged.items);
  return {
    ...paged,
    items: enriched.map(
      ({ task_ids: _tasks, milestone_ids: _milestones, ...summary }) => summary,
    ),
    stateCounts: { active: result.active, archived: result.archived },
    workspaceTotal: result.workspace_total,
    goalLimit: workspaceGoalLimit,
  };
}
export async function readGoalDetail(
  db: PoolClient,
  space: string,
  id: string,
): Promise<{ item: GoalDetail }> {
  const row = (
    await db.query<GoalRow & { body: string }>(
      `SELECT ${goalFields},g.body FROM planning_goals g LEFT JOIN "user" u ON u.id=g.owner_id WHERE g.space_id=$1 AND g.id=$2`,
      [space, id],
    )
  ).rows[0];
  if (!row)
    throw new HttpError(
      404,
      "This goal is no longer available in this workspace.",
    );
  // pg's scalar date parser and JSON aggregation differ; keep the browser contract identical.
  row.due_on = row.due_on ? String(row.due_on).slice(0, 10) : null;
  return { item: (await withProgress(db, space, [row]))[0] };
}
export async function readHistoryPage(
  db: PoolClient,
  params: URLSearchParams,
  space: string,
  user: string,
  entity: string,
): Promise<HistoryPage> {
  const { query, cursor, context } = parseQuery(() =>
    parseHistoryPageQuery(params, space, user, entity),
  );
  const asOf = await ceiling(db, cursor),
    { values, bind } = bindings(space, asOf);
  const where = [
    "h.space_id=$1",
    "h.created_at <= $2::timestamptz",
    `h.entity_id=${bind(entity)}::uuid`,
  ];
  if (query.q) where.push(`h.summary ILIKE ${bind(literalSearch(query.q))}`);
  if (query.mine === "1") where.push(`h.actor_id=${bind(user)}`);
  const countWhere = where.join(" AND "),
    direction = query.sort === "oldest" ? "ASC" : "DESC";
  if (cursor)
    where.push(
      `(h.created_at,h.id) ${direction === "ASC" ? ">" : "<"} (${bind(cursor.at)}::timestamptz,${bind(cursor.id)}::uuid)`,
    );
  const result = (
    await db.query<{
      total: number;
      items: Array<HistoryEntry & { cursor_at: string }>;
    }>(
      `SELECT (SELECT count(*)::int FROM planning_history h WHERE ${countWhere}) AS total,
    coalesce((SELECT jsonb_agg(p ORDER BY p.created_at ${direction},p.id ${direction}) FROM (
      SELECT h.id,h.kind,h.summary,h.actor_id,h.created_at,u.name AS actor_name,${timestamp("h.created_at")} AS cursor_at
      FROM planning_history h LEFT JOIN "user" u ON u.id=h.actor_id WHERE ${where.join(" AND ")}
      ORDER BY h.created_at ${direction},h.id ${direction} LIMIT ${bind(query.limit + 1)}
    ) p),'[]') AS items`,
      values,
    )
  ).rows[0];
  return page(result.items, result.total, query.limit, context, asOf);
}
export async function readOccurrencePage(
  db: PoolClient,
  params: URLSearchParams,
  space: string,
  user: string,
  entity: string,
): Promise<OccurrencePage> {
  const { query, cursor, context } = parseQuery(() =>
    parseOccurrencePageQuery(params, space, user, entity),
  );
  const asOf = await ceiling(db, cursor),
    { values, bind } = bindings(space, asOf);
  const where = [
    "t.space_id=$1",
    "t.created_at <= $2::timestamptz",
    `o.recurrence_id=${bind(entity)}::uuid`,
  ];
  if (query.q) where.push(`t.title ILIKE ${bind(literalSearch(query.q))}`);
  if (query.status) where.push(`t.status=${bind(query.status)}`);
  if (query.state !== "all")
    where.push(`t.deleted_at IS ${query.state === "active" ? "" : "NOT "}NULL`);
  if (query.from) where.push(`o.occurs_on>=${bind(query.from)}::date`);
  if (query.to) where.push(`o.occurs_on<=${bind(query.to)}::date`);
  const countWhere = where.join(" AND "),
    direction = query.sort === "oldest" ? "ASC" : "DESC";
  // (recurrence_id, occurs_on) is already unique and indexed; no OFFSET scan.
  if (cursor)
    where.push(
      `o.occurs_on ${direction === "ASC" ? ">" : "<"} ${bind(cursor.at)}::date`,
    );
  const from = "FROM task_occurrences o JOIN tasks t ON t.id=o.task_id";
  const result = (
    await db.query<{
      total: number;
      items: Array<OccurrenceSummary & { cursor_at: string }>;
    }>(
      `SELECT (SELECT count(*)::int ${from} WHERE ${countWhere}) AS total,
    coalesce((SELECT jsonb_agg(p ORDER BY p.occurs_on ${direction}) FROM (
      SELECT t.id,t.title,t.status,t.deleted_at,o.occurs_on,to_char(o.occurs_on,'YYYY-MM-DD') AS cursor_at ${from}
      WHERE ${where.join(" AND ")} ORDER BY o.occurs_on ${direction} LIMIT ${bind(query.limit + 1)}
    ) p),'[]') AS items`,
      values,
    )
  ).rows[0];
  return page(result.items, result.total, query.limit, context, asOf);
}
