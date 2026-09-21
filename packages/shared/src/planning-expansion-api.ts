import { z } from "zod";
import { currentAuditContext } from "./audit-context";
import type { PoolClient } from "pg";
import { transaction } from "./db";
import { HttpError, memberAccess, spaceAccess } from "./access";
import {
  requireScope,
  workspaceJson as json,
  workspaceMutation,
  assertGroupActive,
  recordActivity,
} from "./workspace-service";
import { notifyWorkspace } from "./documents";
import { lockPlanning, planningTasks } from "./planning-api";
import { calendarSchema } from "./planning";
import {
  analyzeSchedule,
  availabilitySchema,
  capacityReport,
  compareBaseline,
  unknownAvailability,
  type BaselineSnapshot,
} from "./planning-analysis";

const uuid = z.uuid(),
  name = z.string().trim().min(1).max(120);
async function snapshot(
  db: PoolClient,
  space: Record<string, any>,
): Promise<BaselineSnapshot> {
  return {
    tasks: await planningTasks(db, space.id),
    calendar: calendarSchema.parse({
      ...space.planning_calendar,
      timezone: space.timezone,
    }),
    milestones: (
      await db.query(
        "SELECT id,title,due_on,completed_at FROM project_milestones WHERE space_id=$1 ORDER BY id",
        [space.id],
      )
    ).rows,
    planningVersion: space.planning_version,
  };
}
async function groupLock(
  db: PoolClient,
  user: string,
  group: string,
  manage = false,
  write = false,
) {
  // Scope locks precede group locks, matching membership/lifecycle operations.
  await db.query(
    "SELECT id FROM spaces WHERE group_id=$1 ORDER BY id FOR KEY SHARE",
    [group],
  );
  const {
    rows: [member],
  } = await db.query(
    "SELECT m.role,g.lifecycle_status FROM members m JOIN groups g ON g.id=m.group_id WHERE m.group_id=$1 AND m.user_id=$2 FOR SHARE OF m,g",
    [group, user],
  );
  if (!member || (manage && member.role === "member"))
    throw new HttpError(403, "Your group access changed.");
  if (["trashed", "purging"].includes(member.lifecycle_status))
    throw new HttpError(404, "Group unavailable.");
  if (write) await assertGroupActive(db, group);
  return member;
}
async function audit(
  db: PoolClient,
  user: string,
  group: string,
  type: string,
  id: string,
  title: string,
  before: unknown,
  after: unknown,
) {
  await db.query(
    `INSERT INTO audit_events(actor_id,actor_name,group_id,entity_id,entity_type,entity_name,action,before_values,after_values,administrative)
    VALUES($1,(SELECT name FROM "user" WHERE id=$1),$2,$3,$4,$5,'update',$6,$7,true)`,
    [user, group, id, type, title, before, after],
  );
}
export async function planningExpansionApi(
  request: Request,
  path: string[],
  user: string,
): Promise<Response | null> {
  const [root, id, section, child] = path,
    method = request.method,
    url = new URL(request.url);
  if (
    root === "spaces" &&
    ["planning-analysis", "baselines"].includes(section)
  ) {
    uuid.parse(id);
    await spaceAccess(
      user,
      id,
      method === "GET"
        ? "read"
        : section === "baselines" && !child
          ? "edit"
          : "manage",
    );
    if (method === "GET")
      return json(
        await transaction(async (db) => {
          await requireScope(db, user, id);
          const {
            rows: [space],
          } = await db.query("SELECT * FROM spaces WHERE id=$1 FOR SHARE", [
            id,
          ]);
          if (section === "planning-analysis") {
            const s = await snapshot(db, space);
            return {
              ...analyzeSchedule(s.tasks, s.calendar),
              version: s.planningVersion,
            };
          }
          const baselineId = child ?? url.searchParams.get("baseline");
          if (!baselineId)
            return (
              await db.query(
                "SELECT id,name,created_at,archived,version FROM planning_baselines WHERE space_id=$1 ORDER BY created_at DESC LIMIT 100",
                [id],
              )
            ).rows;
          const {
            rows: [base],
          } = await db.query(
            "SELECT * FROM planning_baselines WHERE id=$1 AND space_id=$2",
            [uuid.parse(baselineId), id],
          );
          if (!base) throw new HttpError(404, "Baseline unavailable.");
          const compare = url.searchParams.get("compare");
          let other: BaselineSnapshot;
          if (compare && compare !== "current") {
            const {
              rows: [target],
            } = await db.query(
              "SELECT snapshot FROM planning_baselines WHERE id=$1 AND space_id=$2",
              [uuid.parse(compare), id],
            );
            if (!target)
              throw new HttpError(404, "Comparison baseline unavailable.");
            other = target.snapshot;
          } else other = await snapshot(db, space);
          return { ...base, comparison: compareBaseline(base.snapshot, other) };
        }),
      );
    if (section !== "baselines" || !["POST", "PATCH"].includes(method))
      throw new HttpError(405, "Unsupported planning operation.");
    const raw = await request.json(),
      mutationId = uuid.parse(raw.mutationId);
    const result = await workspaceMutation(
      user,
      mutationId,
      `baseline:${id}:${child ?? "new"}:${method}`,
      raw,
      async (db) => {
        const space = await lockPlanning(
          db,
          user,
          id,
          child ? "manage" : "edit",
        );
        if (method === "POST" && !child) {
          const input = z
            .object({
              name,
              version: z.number().int().positive(),
              mutationId: uuid,
            })
            .strict()
            .parse(raw);
          if (space.planning_version !== input.version)
            throw new HttpError(
              409,
              "The plan changed. Refresh before capturing a baseline.",
            );
          const {
            rows: [count],
          } = await db.query(
            "SELECT count(*)::int AS n FROM planning_baselines WHERE space_id=$1",
            [id],
          );
          if (count.n >= 100)
            throw new HttpError(
              413,
              "This workspace has reached its 100-baseline limit.",
            );
          const {
            rows: [row],
          } = await db.query(
            "INSERT INTO planning_baselines(space_id,name,snapshot,created_by) VALUES($1,$2,$3,$4) RETURNING id,name,version",
            [id, input.name, await snapshot(db, space), user],
          );
          await recordActivity(db, {
            spaceId: id,
            userId: user,
            kind: "planning",
            title: `Captured baseline: ${input.name}`,
          });
          return row;
        }
        if (!child || method !== "PATCH")
          throw new HttpError(405, "Unsupported baseline operation.");
        const input = z
          .object({
            name,
            archived: z.boolean(),
            version: z.number().int().positive(),
            mutationId: uuid,
          })
          .strict()
          .parse(raw);
        const {
          rows: [row],
        } = await db.query(
          "UPDATE planning_baselines SET name=$3,archived=$4,version=version+1 WHERE id=$1 AND space_id=$2 AND version=$5 RETURNING id,name,version",
          [uuid.parse(child), id, input.name, input.archived, input.version],
        );
        if (!row)
          throw new HttpError(
            409,
            "The baseline changed. Refresh before editing its label.",
          );
        await recordActivity(db, {
          spaceId: id,
          userId: user,
          kind: "planning",
          title: `Updated baseline: ${input.name}`,
        });
        return row;
      },
    );
    await notifyWorkspace();
    return json(result);
  }
  if (
    root !== "groups" ||
    !["portfolio", "portfolios", "capacity"].includes(section)
  )
    return null;
  uuid.parse(id);
  const membership = await memberAccess(
    user,
    id,
    section === "portfolios" && method !== "GET",
  );
  if (method === "GET")
    return json(
      await transaction(async (db) => {
        await groupLock(db, user, id);
        const integration = currentAuditContext()?.integrationId ?? null;
        const { rows: spaces } = await db.query(
          "SELECT s.* FROM spaces s WHERE group_id=$1 AND axiom_space_role($2,s.id) IS NOT NULL AND axiom_space_state(s.id)='active' AND ($3::uuid IS NULL OR s.id=ANY((SELECT space_ids FROM integration_connections WHERE id=$3 AND user_id=$2 AND revoked_at IS NULL)::uuid[])) ORDER BY name,id LIMIT 101",
          [id, user, integration],
        );
        if (spaces.length > 100)
          throw new HttpError(
            413,
            "Group planning supports at most 100 active accessible workspaces.",
          );
        for (const s of spaces) await requireScope(db, user, s.id);
        const { rows: portfolios } = await db.query(
          "SELECT p.id,p.name,p.version,coalesce(array_agg(ps.space_id) FILTER(WHERE ps.space_id=ANY($2::uuid[])),'{}') AS space_ids FROM group_portfolios p LEFT JOIN portfolio_spaces ps ON ps.portfolio_id=p.id WHERE p.group_id=$1 GROUP BY p.id ORDER BY p.name",
          [id, spaces.map((s) => s.id)],
        );
        if (section === "portfolios") return portfolios;
        const selected = url.searchParams.get("portfolio"),
          requested = selected
            ? portfolios.find((p) => p.id === selected)?.space_ids
            : null;
        if (selected && !requested)
          throw new HttpError(404, "Portfolio unavailable.");
        const visible = requested
          ? spaces.filter((s) => requested.includes(s.id))
          : spaces;
        const all = [] as Awaited<ReturnType<typeof planningTasks>>;
        const summaries = [];
        for (const s of visible) {
          const tasks = await planningTasks(db, s.id);
          all.push(...tasks);
          if (all.length > 100000)
            throw new HttpError(
              413,
              "Choose a smaller portfolio: analysis is limited to 100,000 tasks.",
            );
          const active = tasks.filter(
            (t) => !["done", "cancelled"].includes(t.status),
          );
          const today = new Intl.DateTimeFormat("sv-SE", {
            timeZone: s.timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date());
          summaries.push({
            id: s.id,
            name: s.name,
            version: s.planning_version,
            total: tasks.length,
            completed: tasks.filter((t) => t.status === "done").length,
            overdue: active.filter((t) => t.due_on && t.due_on < today).length,
            blocked: active.filter((t) => (t as any).blocked).length,
            estimatedHours: active.reduce(
              (n, t) => n + Number(t.estimate_hours ?? 0),
              0,
            ),
            unestimated: active.filter((t) => t.estimate_hours == null).length,
            startOn: active.flatMap((t) => t.start_on ?? []).sort()[0] ?? null,
            dueOn:
              active
                .flatMap((t) => t.due_on ?? [])
                .sort()
                .at(-1) ?? null,
            milestones: (
              await db.query(
                "SELECT id,title,due_on,completed_at FROM project_milestones WHERE space_id=$1 ORDER BY due_on NULLS LAST LIMIT 100",
                [s.id],
              )
            ).rows,
          });
        }
        if (section === "portfolio")
          return {
            spaces: summaries,
            portfolios,
            canManage: membership.role !== "member",
            coverage: "Accessible active workspaces only",
          };
        const { rows: people } = await db.query(
          'SELECT u.id,u.name,a.settings,a.version FROM members m JOIN "user" u ON u.id=m.user_id LEFT JOIN group_availability a ON a.group_id=m.group_id AND a.user_id=m.user_id WHERE m.group_id=$1 ORDER BY u.name',
          [id],
        );
        const start = z
            .string()
            .date()
            .parse(
              url.searchParams.get("start") ??
                new Date().toISOString().slice(0, 10),
            ),
          weeks = z.coerce
            .number()
            .int()
            .min(1)
            .max(52)
            .parse(url.searchParams.get("weeks") ?? 12);
        return {
          ...capacityReport(
            all,
            Object.fromEntries(
              visible.map((s) => [
                s.id,
                calendarSchema.parse({
                  ...s.planning_calendar,
                  timezone: s.timezone,
                }),
              ]),
            ),
            people.map((p) => ({
              id: p.id,
              name: p.name,
              availability: p.settings
                ? availabilitySchema.parse(p.settings)
                : unknownAvailability,
              version: p.version ?? 0,
            })),
            start,
            weeks,
          ),
          tasks: all
            .filter((t) => !["done", "cancelled"].includes(t.status))
            .map((t) => ({ id: t.id, title: t.title, spaceId: t.space_id })),
          canManage: membership.role !== "member",
          coverage: "Accessible active workspaces only",
        };
      }),
    );
  if (!["POST", "PATCH", "DELETE"].includes(method))
    throw new HttpError(405, "Unsupported group planning operation.");
  const raw = await request.json(),
    mutationId = uuid.parse(raw.mutationId);
  const result = await workspaceMutation(
    user,
    mutationId,
    `group-planning:${id}:${section}:${child ?? "new"}:${method}`,
    raw,
    async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `group-planning:${id}`,
      ]);
      const currentMember = await groupLock(
        db,
        user,
        id,
        section === "portfolios",
        true,
      );
      if (section === "capacity" && method === "PATCH") {
        const input = z
          .object({
            userId: z.string().min(1).max(100),
            settings: availabilitySchema,
            version: z.number().int().nonnegative(),
            mutationId: uuid,
          })
          .strict()
          .parse(raw);
        if (input.userId !== user && currentMember.role === "member")
          throw new HttpError(
            403,
            "Only group administrators can change another member's availability.",
          );
        const { rowCount } = await db.query(
          "SELECT 1 FROM members WHERE group_id=$1 AND user_id=$2 FOR SHARE",
          [id, input.userId],
        );
        if (!rowCount)
          throw new HttpError(404, "This person is no longer in the group.");
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `availability:${id}:${input.userId}`,
        ]);
        const {
          rows: [old],
        } = await db.query(
          "SELECT * FROM group_availability WHERE group_id=$1 AND user_id=$2 FOR UPDATE",
          [id, input.userId],
        );
        if ((old?.version ?? 0) !== input.version)
          throw new HttpError(
            409,
            "Availability changed. Refresh before saving.",
          );
        await db.query(
          "INSERT INTO group_availability(group_id,user_id,settings) VALUES($1,$2,$3) ON CONFLICT(group_id,user_id) DO UPDATE SET settings=$3,version=group_availability.version+1,updated_at=now()",
          [id, input.userId, input.settings],
        );
        await db.query(
          "UPDATE groups SET capacity_version=capacity_version+1 WHERE id=$1",
          [id],
        );
        await audit(
          db,
          user,
          id,
          "availability",
          input.userId,
          "Group availability",
          old?.settings ?? null,
          input.settings,
        );
        return { ok: true };
      }
      if (section !== "portfolios")
        throw new HttpError(405, "Unsupported group planning operation.");
      const input = z
        .object({
          name,
          spaceIds: z.array(uuid).max(100),
          version: z.number().int().nonnegative(),
          mutationId: uuid,
        })
        .strict()
        .parse(raw);
      for (const sid of [...new Set(input.spaceIds)].sort()) {
        await requireScope(db, user, sid);
        const {
          rows: [s],
        } = await db.query("SELECT group_id FROM spaces WHERE id=$1", [sid]);
        if (s?.group_id !== id)
          throw new HttpError(400, "Portfolios cannot cross group boundaries.");
      }
      let pid = child;
      if (child) {
        const { rowCount } = await db.query(
          "UPDATE group_portfolios SET name=$3,version=version+1 WHERE id=$1 AND group_id=$2 AND version=$4",
          [uuid.parse(child), id, input.name, input.version],
        );
        if (!rowCount)
          throw new HttpError(
            409,
            "This portfolio changed. Refresh before saving.",
          );
        // Do not let an administrator silently remove hidden workspace membership.
        const { rows: old } = await db.query(
          "SELECT space_id FROM portfolio_spaces WHERE portfolio_id=$1",
          [child],
        );
        for (const row of old) await requireScope(db, user, row.space_id);
        if (method === "DELETE") {
          await db.query("DELETE FROM group_portfolios WHERE id=$1", [child]);
          await audit(
            db,
            user,
            id,
            "portfolio",
            child,
            input.name,
            { name: input.name },
            null,
          );
          return { ok: true };
        }
        await db.query("DELETE FROM portfolio_spaces WHERE portfolio_id=$1", [
          child,
        ]);
      } else {
        if (method !== "POST")
          throw new HttpError(405, "Create a portfolio first.");
        const {
          rows: [count],
        } = await db.query(
          "SELECT count(*)::int AS n FROM group_portfolios WHERE group_id=$1",
          [id],
        );
        if (count.n >= 100)
          throw new HttpError(
            413,
            "This group has reached its 100-portfolio limit.",
          );
        pid = (
          await db.query(
            "INSERT INTO group_portfolios(group_id,name) VALUES($1,$2) RETURNING id",
            [id, input.name],
          )
        ).rows[0].id;
      }
      await db.query(
        "INSERT INTO portfolio_spaces(portfolio_id,space_id) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING",
        [pid, input.spaceIds],
      );
      await audit(db, user, id, "portfolio", pid!, input.name, null, {
        name: input.name,
      });
      return { id: pid };
    },
  );
  await notifyWorkspace();
  return json(result);
}
