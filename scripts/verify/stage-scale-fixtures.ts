import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { stageFixture } from "./stage-fixtures";

/** Fixed recipe; IDs vary by fixture namespace, never between measured sources. */
export function scaleTaskId(namespace: string, position: number) {
  const hex = createHash("sha256")
    .update(`axiom-stage-scale-v1:${namespace}:${position}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function insertScaleTasks(
  db: pg.Client,
  space: string,
  owner: string,
  count: number,
  project: string | null = null,
) {
  if (!Number.isInteger(count) || count < 1 || count > 5000)
    throw new Error("Scale fixture batches contain 1–5,000 tasks.");
  const rows = Array.from({ length: count }, (_, i) => ({
    id: scaleTaskId(space, i),
    title: `Experiment ${i}`,
    position: i,
    status: i % 7 === 0 ? "done" : "todo",
    estimate: 1 + (i % 4),
    body: `Synthetic task body ${i}; never include in planning summaries.`,
  }));
  await db.query(
    `INSERT INTO tasks(id,space_id,project_id,created_by,title,body,position,status,assignee_id,start_on,due_on,estimate_hours)
    SELECT r.id,$2,$3,$4,r.title,r.body,r.position,r.status,$4,'2026-10-05','2026-10-09',r.estimate
    FROM jsonb_to_recordset($1::jsonb) AS r(id uuid,title text,body text,position integer,status text,estimate numeric)`,
    [JSON.stringify(rows), space, project, owner],
  );
  return rows.map((r) => r.id);
}
export type StageScaleFixture = {
  owner: string;
  group: string;
  space: string;
  spaces: string[];
  portfolio: string;
  tasks: number;
  rows: number;
  recipe: string;
};
export async function seedStageScale(
  db: pg.Client,
): Promise<StageScaleFixture> {
  const f = await stageFixture(db, "Measured laboratory portfolio"),
    spaces: string[] = [];
  for (let i = 0; i < 20; i++) {
    const project = randomUUID();
    await db.query(
      "INSERT INTO projects(id,group_id,name,audience,created_by) VALUES($1,$2,$3,'group',$4)",
      [
        project,
        f.group,
        `Measured workspace ${String(i + 1).padStart(2, "0")}`,
        f.owner,
      ],
    );
    const space = (
      await db.query("SELECT id FROM spaces WHERE project_id=$1", [project])
    ).rows[0].id as string;
    spaces.push(space);
    await insertScaleTasks(db, space, f.owner, 5000, project);
  }
  const portfolio = randomUUID();
  await db.query(
    "INSERT INTO group_portfolios(id,group_id,name) VALUES($1,$2,'Measured 20-workspace portfolio')",
    [portfolio, f.group],
  );
  await db.query(
    "INSERT INTO portfolio_spaces(portfolio_id,space_id) SELECT $1,unnest($2::uuid[])",
    [portfolio, spaces],
  );
  // Statistics are refreshed for both sources before measurement.
  await db.query("ANALYZE tasks");
  await db.query("ANALYZE spaces");
  await db.query("ANALYZE task_dependencies");
  return {
    owner: f.owner,
    group: f.group,
    space: spaces[0],
    spaces,
    portfolio,
    tasks: 100000,
    rows: 5000,
    recipe: "axiom-stage-scale-v1",
  };
}
