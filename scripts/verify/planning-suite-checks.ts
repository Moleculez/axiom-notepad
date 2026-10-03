import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { addDays } from "../../packages/shared/src/planning";

type Call = (
  path: string,
  method?: string,
  body?: any,
  user?: string,
) => Promise<any>;
/** Invoked only after the parent verifier has switched to its disposable DB. */
export async function verifyPlanningSuite(
  db: pg.Client,
  call: Call,
  scope: {
    owner: string;
    viewer: string;
    outsider: string;
    group: string;
    space: string;
  },
) {
  const { owner, viewer, outsider, group, space } = scope,
    base = `spaces/${space}`;
  assert.match(
    String(new URL(process.env.DATABASE_URL!).pathname),
    /^\/axiom_planning_test_/,
  );
  assert.equal(
    (await db.query("SELECT max(version) AS version FROM schema_migrations"))
      .rows[0].version,
    39,
  );
  const audit = (
    await db.query(
      "SELECT pg_get_functiondef('axiom_planning_audit()'::regprocedure) AS definition",
    )
  ).rows[0].definition;
  assert.match(audit, /lag_days/);
  assert.match(audit, /progress_percent/);
  const a = await call(`${base}/tasks`, "POST", {
    title: "Suite parent",
    progressPercent: 50,
  });
  const child = await call(`${base}/tasks`, "POST", {
    title: "Suite child",
    parentId: a.id,
    status: "done",
  });
  const b = await call(`${base}/tasks`, "POST", {
    title: "Suite successor",
    progressPercent: 50,
    dependencyLinks: [{ taskId: a.id, lagDays: -2 }],
  });
  const goal = await call(`${base}/goals`, "POST", {
    title: "Verified outcome",
    kind: "linked",
    taskIds: [a.id, child.id, b.id],
  });
  assert.deepEqual(
    (await call(`${base}/goals`)).find((g: any) => g.id === goal.id).progress,
    { tracked: 2, completed: 1.5, percent: 75, unavailable: 0 },
  );
  await assert.rejects(
    call(
      `${base}/goals`,
      "POST",
      { title: "Forbidden", kind: "metric" },
      viewer,
    ),
  );
  await assert.rejects(call(`${base}/intake`, "GET", undefined, outsider));
  const privateView = await call(`${base}/planning-views`, "POST", {
    name: "Private owner view",
    state: { view: "gantt" },
    shared: false,
  });
  assert(
    !(await call(`${base}/planning-views`, "GET", undefined, viewer)).some(
      (v: any) => v.id === privateView.id,
    ),
  );
  await call(
    `${base}/planning-views`,
    "POST",
    { name: "Viewer's personal view", state: { view: "list" }, shared: false },
    viewer,
  );
  await assert.rejects(
    call(
      `${base}/planning-views`,
      "POST",
      { name: "Not authorized", state: {}, shared: true },
      viewer,
    ),
  );
  const collaborator = `suite-${randomUUID()}`;
  await db.query(
    "INSERT INTO \"user\"(id,name,email) VALUES($1,'Collaborator',$2)",
    [collaborator, `${collaborator}@axiom.test`],
  );
  await db.query(
    "INSERT INTO members(group_id,user_id,role,content_role) VALUES($1,$2,'member','editor')",
    [group, collaborator],
  );
  let request = await call(
    `${base}/intake`,
    "POST",
    { title: "Research intake", kind: "experiment", body: "Source evidence" },
    collaborator,
  );
  await assert.rejects(
    call(
      `${base}/intake/${request.id}`,
      "PATCH",
      { version: request.version, decision: "accepted" },
      collaborator,
    ),
  );
  request = await call(`${base}/intake/${request.id}`, "PATCH", {
    version: request.version,
    decision: "needs-changes",
    note: "Specify the control.",
  });
  request = await call(
    `${base}/intake/${request.id}`,
    "PATCH",
    { version: request.version, body: "Control specified" },
    collaborator,
  );
  const decision = {
      version: request.version,
      decision: "accepted",
      mutationId: randomUUID(),
    },
    accepted = await call(`${base}/intake/${request.id}`, "PATCH", decision);
  assert.equal(
    (await call(`${base}/intake/${request.id}`, "PATCH", decision)).task_id,
    accepted.task_id,
  );
  assert.equal((await call(`${base}/planning?q=Research%20intake`)).total, 1);
  const today = new Date().toISOString().slice(0, 10),
    routine = await call(`${base}/recurrences`, "POST", {
      rule: { frequency: "daily", start: today, until: addDays(today, 7) },
      template: {
        title: "Daily review",
        body: "Original template",
        progressPercent: 25,
        labels: ["lab", "review"],
      },
    });
  const { processRecurrences } =
    await import("../../packages/shared/src/workspace-jobs");
  await processRecurrences();
  await processRecurrences();
  const occurrences = await call(
    `${base}/recurrences/${routine.id}/occurrences`,
  );
  assert.equal(occurrences.length, 1);
  const generated = await call(`${base}/tasks/${occurrences[0].id}`);
  assert.equal(generated.progress_percent, 25);
  assert.deepEqual(generated.labels, ["lab", "review"]);
  const changed = await call(`${base}/recurrences/${routine.id}`, "PATCH", {
    version: routine.version,
    template: {
      ...routine.template,
      title: "Future review",
      body: "Edited future template",
    },
    enabled: false,
  });
  assert.equal(
    (await call(`${base}/tasks/${generated.id}`)).body,
    "Original template",
  );
  const preview = await call(`${base}/recurrences/${routine.id}`);
  assert.equal(preview.dates.length, 5);
  assert(preview.dates.every((d: string) => d > today));
  await call(`${base}/recurrences/${routine.id}`, "PATCH", {
    version: changed.version,
    archived: true,
    enabled: true,
  });
  await processRecurrences();
  assert.equal(
    (await call(`${base}/recurrences/${routine.id}/occurrences`)).length,
    1,
  );
  assert((await call(`${base}/planning-history/${routine.id}`)).length >= 3);

  // The real connection/change-set services must not write before human review.
  const clientId = `suite-client-${randomUUID()}`,
    connectionId = randomUUID();
  await db.query(
    "INSERT INTO oauth_client(id,client_id,user_id,redirect_uris) VALUES($1,$1,$2,'{}')",
    [clientId, owner],
  );
  await db.query(
    "INSERT INTO integration_connections(id,user_id,client_id,name,scopes,space_ids) VALUES($1,$2,$3,'Verification client',ARRAY['workspace:read','workspace:write','workspace:manage'],$4)",
    [connectionId, owner, clientId, [space]],
  );
  const { activeConnection } =
      await import("../../packages/shared/src/integration-security"),
    { prepareIntegrationChange } =
      await import("../../packages/shared/src/integration-change-sets"),
    {
      createChangeSet,
      previewChangeSet,
      approveChangeSet,
      processChangeSet,
      changeSetView,
    } = await import("../../packages/shared/src/workspace-change-sets"),
    { integrationActions, integrationPath } =
      await import("../../packages/shared/src/integration-catalog");
  const connection = await activeConnection(connectionId, owner),
    token = randomUUID();
  const writeOnlyId = randomUUID(),
    writeOnlyClientId = `${clientId}-write`;
  await db.query(
    "INSERT INTO oauth_client(id,client_id,user_id,redirect_uris) VALUES($1,$1,$2,'{}')",
    [writeOnlyClientId, owner],
  );
  await db.query(
    "INSERT INTO integration_connections(id,user_id,client_id,name,scopes,space_ids) VALUES($1,$2,$3,'Write-only client',ARRAY['workspace:read','workspace:write'],$4)",
    [writeOnlyId, owner, writeOnlyClientId, [space]],
  );
  await assert.rejects(
    prepareIntegrationChange(
      await activeConnection(writeOnlyId, owner),
      "workspace_planning_view_create",
      {
        spaceId: space,
        payload: {
          name: "Unauthorized shared view",
          shared: true,
          state: { view: "gantt" },
        },
      },
    ),
  );
  const pending = await prepareIntegrationChange(
    connection,
    "workspace_goal_create",
    {
      spaceId: space,
      approvalId: token,
      payload: {
        title: "MCP reviewed outcome",
        kind: "metric",
        target: 10,
        currentValue: 3,
      },
    },
  );
  assert.equal(pending.requiresApproval, true);
  assert(
    !(await call(`${base}/goals`)).some(
      (g: any) => g.title === "MCP reviewed outcome",
    ),
  );
  assert.equal(
    (
      await prepareIntegrationChange(connection, "workspace_goal_create", {
        spaceId: space,
        approvalId: token,
        payload: {
          title: "MCP reviewed outcome",
          kind: "metric",
          target: 10,
          currentValue: 3,
        },
      })
    ).changeSetId,
    token,
  );
  let set = await changeSetView(token, owner);
  set = await previewChangeSet(token, owner, set.version, ["action"]);
  await approveChangeSet(token, owner, set.preview!.fingerprint);
  await processChangeSet(async (actor, action, operationId) => {
    const definition = integrationActions.find(
      (a) => a.name === action.action,
    )!;
    return call(
      integrationPath(definition, action.spaceId, action.targetId),
      definition.method,
      { ...action.payload, mutationId: operationId },
      actor.userId,
    );
  });
  assert.equal((await changeSetView(token, owner)).status, "complete");
  assert.equal(
    (await call(`${base}/goals`)).filter(
      (g: any) => g.title === "MCP reviewed outcome",
    ).length,
    1,
  );
  const inApp = await createChangeSet(
    { userId: owner, spaceIds: [space] },
    {
      mutationId: randomUUID(),
      title: "Reviewed task batch",
      spaceIds: [space],
      actions: [
        {
          key: "bulk",
          action: "workspace_tasks_bulk",
          spaceId: space,
          title: "Set priority",
          dependsOn: [],
          explanation: "Human review",
          payload: {
            items: [{ id: b.id, version: b.version }],
            patch: { priority: "high" },
          },
        },
      ],
    },
  );
  await previewChangeSet(inApp.id, owner, inApp.version, ["bulk"]);
  assert.equal((await call(`${base}/tasks/${b.id}`)).priority, "normal");
  await db.query(
    "UPDATE integration_connections SET revoked_at=now() WHERE id=$1",
    [connectionId],
  );
  await assert.rejects(
    prepareIntegrationChange(connection, "workspace_goal_create", {
      spaceId: space,
      payload: { title: "Revoked", kind: "metric" },
    }),
  );
  console.log(
    "PASS planning suite: additive schema/audit, private/shared view ACL, linked goal deduplication, member-only intake transitions/retry, recurrence idempotency/history/future edits, and reviewed MCP/in-app writes with revocation.",
  );
}
