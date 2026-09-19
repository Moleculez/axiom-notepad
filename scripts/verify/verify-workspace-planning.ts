import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  migration,
  forwardMigrations,
} from "../../packages/shared/src/migrations";
import { migrateDatabase } from "../../packages/shared/src/migrate-database";

// Disposable, local-only v24 upgrade fixture. Never migrate the configured database.
const configured = new URL(process.env.DATABASE_URL ?? "");
assert(
  process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1"].includes(configured.hostname),
);
const name = `axiom_planning_test_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
  adminUrl = new URL(configured);
adminUrl.pathname = "/postgres";
const admin = new pg.Client({ connectionString: adminUrl.href });
await admin.connect();
await admin.query(`CREATE DATABASE "${name}"`);
await admin.end();
const target = new URL(configured);
target.pathname = `/${name}`;
process.env.DATABASE_URL = target.href;
const db = new pg.Client({ connectionString: target.href });
await db.connect();
const owner = "planning-owner",
  viewer = "planning-viewer",
  outsider = "planning-outsider",
  group = randomUUID(),
  project = randomUUID(),
  oldTask = randomUUID(),
  oldNote = randomUUID();
await db.query("BEGIN");
try {
  await db.query(migration);
  await db.query(
    "CREATE TABLE schema_migrations(version integer PRIMARY KEY,name text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const m of forwardMigrations.filter((m) => m.version <= 24)) {
    await db.query(m.sql);
    await db.query(
      "INSERT INTO schema_migrations(version,name) VALUES($1,$2)",
      [m.version, m.name],
    );
  }
  for (const id of [owner, viewer, outsider])
    await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)', [
      id,
      id + "@axiom.test",
    ]);
  await db.query(
    "INSERT INTO groups(id,name,description) VALUES($1,'Planning lab','Group identity')",
    [group],
  );
  await db.query(
    "INSERT INTO members(group_id,user_id,role,content_role) VALUES($1,$2,'owner','editor'),($1,$3,'member','viewer')",
    [group, owner, viewer],
  );
  await db.query(
    "INSERT INTO projects(id,group_id,name,audience,created_by) VALUES($1,$2,'Existing study','group',$3)",
    [project, group, owner],
  );
  await db.query(
    "INSERT INTO notes(id,group_id,project_id,author_id,title,body) VALUES($1,$2,$3,$4,'Existing evidence','# Keep this evidence')",
    [oldNote, group, project, owner],
  );
  await db.query(
    "INSERT INTO tasks(id,project_id,created_by,title,body,start_on,due_on,note_id) VALUES($1,$2,$3,'Existing experiment','Keep this body','2026-09-21','2026-09-22',$4)",
    [oldTask, project, owner, oldNote],
  );
  await db.query(
    "UPDATE spaces SET status='archived' WHERE kind='team' AND group_id=$1",
    [group],
  );
  const before = (
    await db.query(
      "SELECT id,title,body,start_on::text,due_on::text,version FROM tasks WHERE id=$1",
      [oldTask],
    )
  ).rows[0];
  await migrateDatabase(db);
  await migrateDatabase(db);
  assert.deepEqual(
    (
      await db.query(
        "SELECT id,title,body,start_on::text,due_on::text,version FROM tasks WHERE id=$1",
        [oldTask],
      )
    ).rows[0],
    before,
  );
  assert.equal(
    (await db.query("SELECT lifecycle_status FROM groups WHERE id=$1", [group]))
      .rows[0].lifecycle_status,
    "archived",
  );
  assert.equal(
    (
      await db.query(
        "SELECT status FROM spaces WHERE kind='team' AND group_id=$1",
        [group],
      )
    ).rows[0].status,
    "active",
  );
  assert.equal(
    (
      await db.query(
        "SELECT axiom_space_role($1,id) AS role FROM spaces WHERE project_id=$2",
        [owner, project],
      )
    ).rows[0].role,
    "viewer",
  );
  await db.query("COMMIT");
} catch (error) {
  await db.query("ROLLBACK");
  await db.end();
  throw error;
}
const { planningApi } = await import("../../packages/shared/src/planning-api"),
  { spaceLifecycleApi } =
    await import("../../packages/shared/src/space-lifecycle"),
  { groupAdministrationApi } =
    await import("../../packages/shared/src/group-administration"),
  { pool } = await import("../../packages/shared/src/db");
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  user = owner,
) {
  const url = "http://localhost/api/v1/" + path,
    parts = path.split("?")[0].split("/"),
    request = new Request(url, {
      method,
      ...(body
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mutationId: randomUUID(), ...body }),
          }
        : {}),
    });
  const response =
    (await planningApi(request, parts, user)) ??
    (await spaceLifecycleApi(request, parts, user)) ??
    (await groupAdministrationApi(request, parts, user));
  assert(response, "Unhandled test path " + path);
  return response.json();
}
try {
  const scopes = (
      await db.query("SELECT * FROM spaces WHERE group_id=$1 OR owner_id=$2", [
        group,
        owner,
      ])
    ).rows,
    main = scopes.find((s) => s.kind === "team"),
    study = scopes.find((s) => s.project_id === project),
    personal = scopes.find((s) => s.kind === "personal");
  await call(`group-admin/${group}/lifecycle`, "POST", {
    version: 1,
    action: "unarchive",
    confirmation: "Planning lab",
  });
  await call(`spaces/${main.id}/archive`, "POST", { version: main.version });
  assert.equal(
    (await db.query("SELECT axiom_space_state($1) AS state", [study.id]))
      .rows[0].state,
    "active",
  );
  const detail = await call(`spaces/${study.id}`);
  await call(`spaces/${study.id}`, "PATCH", {
    version: detail.space.version,
    name: "Renamed workspace",
    description: "Workspace only",
  });
  assert.equal(
    (await db.query("SELECT name FROM groups WHERE id=$1", [group])).rows[0]
      .name,
    "Planning lab",
  );
  const personalTask = await call(`spaces/${personal.id}/tasks`, "POST", {
    title: "Personal planning",
  });
  assert.equal(personalTask.project_id, null);
  assert.equal(personalTask.space_id, personal.id);
  await assert.rejects(
    call(`spaces/${personal.id}/tasks`, "GET", undefined, outsider),
  );
  await assert.rejects(
    call(`spaces/${study.id}/tasks`, "POST", { title: "Forbidden" }, viewer),
  );
  const b = await call(`spaces/${study.id}/tasks`, "POST", {
    title: "Analyze results",
    startOn: "2026-09-23",
    dueOn: "2026-09-24",
    dependencies: [oldTask],
  });
  await assert.rejects(
    call(`spaces/${study.id}/tasks/${oldTask}`, "PATCH", {
      version: 1,
      dependencies: [b.id],
    }),
  );
  const preview = await call(`spaces/${study.id}/schedule/preview`, "POST", {
    changes: [
      { id: oldTask, version: 1, startOn: "2026-09-24", dueOn: "2026-09-25" },
    ],
  });
  assert.equal(preview.proposed.length, 2);
  assert.equal(preview.proposed[1].startOn, "2026-09-28");
  const token = randomUUID(),
    applied = await call(`spaces/${study.id}/schedule/apply`, "POST", {
      previewId: preview.id,
      mode: "proposed",
      mutationId: token,
    });
  assert.deepEqual(
    await call(`spaces/${study.id}/schedule/apply`, "POST", {
      previewId: preview.id,
      mode: "proposed",
      mutationId: token,
    }),
    applied,
  );
  const moved = await call(`spaces/${study.id}/tasks/${b.id}`);
  assert.equal(moved.start_on, "2026-09-28");
  await call(`spaces/${study.id}/schedule/undo`, "POST", {
    previewId: preview.id,
  });
  assert.equal(
    (await call(`spaces/${study.id}/tasks/${b.id}`)).start_on,
    "2026-09-23",
  );
  const current = await call(`spaces/${study.id}/tasks/${oldTask}`),
    stale = await call(`spaces/${study.id}/schedule/preview`, "POST", {
      changes: [
        {
          id: oldTask,
          version: current.version,
          startOn: "2026-09-24",
          dueOn: "2026-09-25",
        },
      ],
    });
  await call(`spaces/${study.id}/tasks/${b.id}`, "PATCH", {
    version: 3,
    title: "Changed concurrently",
  });
  await assert.rejects(
    call(`spaces/${study.id}/schedule/apply`, "POST", {
      previewId: stale.id,
      mode: "proposed",
    }),
  );
  const deleted = await call(
    `spaces/${personal.id}/tasks/${personalTask.id}`,
    "PATCH",
    { version: 1, deleted: true },
  );
  const linked = await call(`spaces/${study.id}/tasks/${oldTask}`);
  assert.deepEqual(linked.resource_ids, [oldNote]);
  const unlinked = await call(`spaces/${study.id}/tasks/${oldTask}`, "PATCH", {
    version: linked.version,
    resourceIds: [],
  });
  assert.deepEqual(unlinked.resource_ids, []);
  assert.equal(unlinked.note_id, null);
  assert.equal(unlinked.body, "Keep this body");
  assert.equal((await call(`spaces/${personal.id}/planning`)).total, 0);
  assert.equal(
    (await call(`spaces/${personal.id}/planning?deleted=1`)).total,
    1,
  );
  await call(`spaces/${personal.id}/tasks/${personalTask.id}`, "PATCH", {
    version: deleted.version,
    deleted: false,
  });
  await db.query(
    "INSERT INTO tasks(space_id,created_by,title,status) SELECT $1,$2,'Load test '||i,CASE WHEN i%2=0 THEN 'done' ELSE 'todo' END FROM generate_series(1,5000) AS i",
    [personal.id, owner],
  );
  // Bulk fixtures bypass normal autovacuum timing. Measure the maintained index
  // plan separately from the first query against deliberately stale statistics.
  await db.query("ANALYZE tasks");
  await db.query("ANALYZE task_dependencies");
  await db.query("ANALYZE task_resources");
  const started = performance.now(),
    large = await call(`spaces/${personal.id}/planning?limit=5000`);
  assert.equal(large.items.length, 5000);
  assert.equal(large.total, 5001);
  assert.equal(large.nextOffset, 5000);
  assert(large.items.every((task: { body: string }) => task.body === ""));
  const filtered = await call(
    `spaces/${personal.id}/planning?status=done&q=Load&limit=10`,
  );
  assert.equal(filtered.total, 2500);
  assert.equal(filtered.completed, 2500);
  assert.equal(filtered.items.length, 10);
  assert(
    (
      await db.query(
        "SELECT 1 FROM audit_events WHERE entity_type='task' AND after_values ? 'start_on' LIMIT 1",
      )
    ).rowCount,
  );
  console.log(
    `PASS v24 upgrade, independent lifecycle, personal/shared permissions, DAG, schedule preview/apply/idempotency/undo/conflicts, soft delete/restore, audit, and 5,000-task server filtering (${Math.round(performance.now() - started)} ms). Database retained: ${name}`,
  );
} finally {
  await pool.end();
  await db.end();
}
