import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  stageDatabase,
  stageFixture,
  stageCall,
  startStageAssistant,
  stageProviderCalls,
  boundedWait,
} from "./stage-fixtures";
import { stopAcceptanceChild } from "./acceptance-process";

const directory = resolve(process.argv[2] ?? "");
assert(
  directory.startsWith(resolve("data/reliability-")) &&
    (await realpath(directory)) === directory,
  "Races must belong to an owned reliability run.",
);
const db = await stageDatabase();
const controllerName = `axiom-stage-controller-${randomUUID()}`;
process.env.PGAPPNAME = controllerName;
process.env.PGOPTIONS = "-c statement_timeout=30000 -c lock_timeout=25000";
const children = new Set<ChildProcess>(),
  checks: string[] = [];
let passed = false,
  failure: string | undefined;
function worker(mode: "planning" | "tool", barrier = "", clock = "") {
  const name = `axiom-stage-${randomUUID()}`;
  const child = fork(
    resolve("scripts/verify/stage-worker.ts"),
    [mode, barrier, ...(clock ? [clock] : [])],
    {
      execArgv: ["--import", "tsx"],
      env: { ...process.env, PGAPPNAME: name },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    },
  );
  children.add(child);
  let held = false;
  child.on("message", (m: unknown) => {
    if ((m as { kind?: string })?.kind === "barrier") held = true;
  });
  const ended = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((done, fail) => {
    child.once("error", fail);
    child.once("exit", (code, signal) => {
      children.delete(child);
      done({ code, signal });
    });
  });
  // Retain the rejection for join() without a transient unhandled rejection.
  void ended.catch(() => {});
  let result: Awaited<typeof ended> | undefined;
  void ended.then(
    (value) => {
      result = value;
    },
    () => {},
  );
  return {
    child,
    name,
    hold: () =>
      boundedWait(
        async () => (held ? true : false),
        `worker barrier ${barrier}`,
      ),
    release: () => {
      if (!child.connected)
        throw new Error("Controlled worker disconnected before release.");
      child.send({ kind: "release" });
    },
    join: async () => {
      await boundedWait(
        async () => result ?? false,
        `worker ${mode} must exit`,
        45000,
      );
      const completed = await ended;
      assert.equal(
        completed.code,
        0,
        `Worker failed: ${completed.signal ?? completed.code}`,
      );
    },
    crash: async () => {
      child.kill("SIGKILL");
      await boundedWait(
        async () => result ?? false,
        `crashed worker ${mode} must exit`,
      );
      assert.equal((await ended).signal, "SIGKILL");
    },
  };
}
const count = async (sql: string, args: unknown[]) =>
  Number((await db.query(sql, args)).rows[0].n);
const status = async (id: string) =>
  (await db.query("SELECT status FROM tool_jobs WHERE id=$1", [id])).rows[0]
    .status as string;
const one = async (mode: "planning" | "tool", clock = "") =>
  worker(mode, "", clock).join();
const rejectStatus = async (work: Promise<unknown>, expected: number) => {
  await assert.rejects(
    work,
    (e: any) => e.status === expected || e.statusCode === expected,
  );
};
try {
  const f = await stageFixture(db, "Worker race laboratory"),
    rule = randomUUID();
  await db.query(
    "INSERT INTO planning_automations(id,space_id,name,config,enabled,configured_by,enabled_at) VALUES($1,$2,'Reviewed triage',$3,true,$4,now())",
    [
      rule,
      f.space,
      JSON.stringify({
        name: "Reviewed triage",
        trigger: "changed",
        watched: ["priority"],
        conditions: [],
        actions: [{ kind: "status", value: "in_progress" }],
        enabled: true,
        archived: false,
        at: "09:00",
      }),
      f.owner,
    ],
  );
  await db.query(
    "UPDATE tasks SET priority='high',version=version+1 WHERE id=$1",
    [f.task],
  );
  const first = worker("planning", "planning-before-commit");
  await first.hold();
  const second = worker("planning");
  await boundedWait(
    async () =>
      (
        await db.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
          [second.name],
        )
      ).rowCount
        ? true
        : false,
    "second automation worker must really wait on a PostgreSQL lock",
  );
  first.release();
  await Promise.all([first.join(), second.join()]);
  assert.equal(
    await count(
      "SELECT count(*) AS n FROM planning_automation_runs WHERE rule_id=$1",
      [rule],
    ),
    1,
  );
  assert.equal(
    await count(
      "SELECT count(*) AS n FROM planning_automation_events WHERE task_id=$1 AND processed_at IS NULL",
      [f.task],
    ),
    0,
  );
  assert.equal(
    (await db.query("SELECT status FROM tasks WHERE id=$1", [f.task])).rows[0]
      .status,
    "todo",
  );
  checks.push(
    "Two real automation workers serialize one event; proposals never apply themselves",
  );

  await db.query(
    "UPDATE tasks SET priority='urgent',version=version+1 WHERE id=$1",
    [f.task],
  );
  const crash = worker("planning", "planning-before-commit");
  await crash.hold();
  await crash.crash();
  assert.equal(
    await count(
      "SELECT count(*) AS n FROM planning_automation_events WHERE task_id=$1 AND processed_at IS NULL",
      [f.task],
    ),
    1,
  );
  await one("planning");
  assert.equal(
    await count(
      "SELECT count(*) AS n FROM planning_automation_runs WHERE rule_id=$1",
      [rule],
    ),
    2,
  );
  checks.push(
    "Automation process loss rolls back staged proposals and retains the event for exactly-once recovery",
  );

  // Use the actual mutation handler while the worker holds its event transaction.
  const { planningApi } =
    await import("../../packages/shared/src/planning-api");
  const { planningLabApi } =
    await import("../../packages/shared/src/planning-lab-api");
  await db.query(
    "UPDATE tasks SET priority='normal',version=version+1 WHERE id=$1",
    [f.task],
  );
  const coalescing = worker("planning", "planning-before-commit");
  await coalescing.hold();
  const version = (
    await db.query("SELECT version FROM tasks WHERE id=$1", [f.task])
  ).rows[0].version;
  const writer = stageCall(
    planningApi,
    f.owner,
    `spaces/${f.space}/tasks/${f.task}`,
    { mutationId: randomUUID(), version, priority: "high" },
    "PATCH",
  );
  void writer.catch(() => {});
  await boundedWait(
    async () =>
      (
        await db.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
          [controllerName],
        )
      ).rowCount
        ? true
        : false,
    "task writer must overlap the held event transaction",
  );
  coalescing.release();
  await Promise.all([coalescing.join(), writer]);
  await one("planning");
  assert.equal(
    await count(
      "SELECT count(*) AS n FROM planning_automation_events WHERE task_id=$1 AND processed_at IS NULL",
      [f.task],
    ),
    0,
  );
  assert.equal(
    (await db.query("SELECT priority FROM tasks WHERE id=$1", [f.task])).rows[0]
      .priority,
    "high",
  );
  checks.push(
    "A real task write and event coalescing worker finish without deadlock or lost metadata",
  );

  // Daily keys are exercised by the real worker/SQL at a controlled fixture clock.
  await db.query("UPDATE spaces SET timezone='America/New_York' WHERE id=$1", [
    f.space,
  ]);
  const daily = randomUUID();
  const config = {
    name: "Daily lab review",
    trigger: "daily",
    watched: [],
    conditions: [],
    actions: [{ kind: "priority", value: "high" }],
    enabled: true,
    archived: false,
    at: "02:30",
  };
  await db.query(
    "INSERT INTO planning_automations(id,space_id,name,config,enabled,configured_by,enabled_at) VALUES($1,$2,'Daily lab review',$3,true,$4,now())",
    [daily, f.space, JSON.stringify(config), f.owner],
  );
  await one("planning", "2026-03-08T06:30:00Z");
  assert.equal(
    await count(
      "SELECT count(*) AS n FROM planning_automation_runs WHERE rule_id=$1",
      [daily],
    ),
    0,
  );
  await one("planning", "2026-03-08T07:05:00Z");
  await one("planning", "2026-03-08T08:05:00Z");
  assert.equal(
    await count(
      "SELECT count(*) AS n FROM planning_automation_runs WHERE rule_id=$1 AND event_key='day:2026-03-08'",
      [daily],
    ),
    1,
  );
  await db.query(
    "UPDATE planning_automations SET config=$2,version=version+1 WHERE id=$1",
    [daily, JSON.stringify({ ...config, at: "01:15" })],
  );
  await one("planning", "2026-11-01T05:30:00Z");
  await one("planning", "2026-11-01T06:30:00Z");
  assert.equal(
    await count(
      "SELECT count(*) AS n FROM planning_automation_runs WHERE rule_id=$1 AND event_key='day:2026-11-01'",
      [daily],
    ),
    1,
  );
  checks.push(
    "Spring and fall DST daily proposals have exactly one committed local-day key across restarts",
  );
  // Access transitions use the same workspace fence as administration writes.
  await db.query("BEGIN");
  await db.query("SELECT id FROM spaces WHERE id=$1 FOR UPDATE", [f.space]);
  await db.query(
    "UPDATE members SET role='member',content_role='viewer' WHERE group_id=$1 AND user_id=$2",
    [f.group, f.owner],
  );
  await db.query("COMMIT");
  await db.query(
    "UPDATE tasks SET priority='urgent',version=version+1 WHERE id=$1",
    [f.task],
  );
  await one("planning");
  assert.equal(
    (
      await db.query("SELECT enabled FROM planning_automations WHERE id=$1", [
        rule,
      ])
    ).rows[0].enabled,
    false,
  );
  await db.query(
    "UPDATE members SET role='owner',content_role='editor' WHERE group_id=$1 AND user_id=$2",
    [f.group, f.owner],
  );
  await db.query(
    "UPDATE planning_automations SET enabled=false WHERE space_id=$1",
    [f.space],
  );
  checks.push(
    "Revoked rule-manager authority pauses the rule instead of authorizing new work",
  );

  const entry = await stageCall(
    planningLabApi,
    f.member,
    `spaces/${f.space}/planning-time`,
    {
      mutationId: randomUUID(),
      taskId: f.task,
      spentOn: "2026-01-01",
      minutes: 30,
      note: "Synthetic work log",
    },
  );
  const correction = {
    mutationId: randomUUID(),
    version: entry.item.version,
    taskId: f.task,
    spentOn: "2026-01-01",
    minutes: 45,
    note: "Corrected synthetic work",
  };
  await rejectStatus(
    stageCall(
      planningLabApi,
      f.viewer,
      `spaces/${f.space}/planning-time/${entry.item.id}`,
      correction,
      "PATCH",
    ),
    403,
  );
  await rejectStatus(
    stageCall(
      planningLabApi,
      f.owner,
      `spaces/${f.space}/planning-time/${entry.item.id}`,
      correction,
      "PATCH",
    ),
    403,
  );
  const updated = await stageCall(
    planningLabApi,
    f.owner,
    `spaces/${f.space}/planning-time/${entry.item.id}`,
    {
      ...correction,
      mutationId: randomUUID(),
      reason: "Verified against the synthetic protocol",
    },
    "PATCH",
  );
  assert.equal(updated.item.minutes, 45);
  await rejectStatus(
    stageCall(
      planningLabApi,
      f.owner,
      `spaces/${f.space}/planning-time/${entry.item.id}`,
      { ...correction, mutationId: randomUUID(), reason: "Stale version" },
      "PATCH",
    ),
    409,
  );
  checks.push(
    "Another member's time correction requires manager authority, a reason and a current version",
  );
  await stageCall(planningLabApi, f.member, `spaces/${f.space}/planning-time`, {
    mutationId: randomUUID(),
    taskId: f.task,
    spentOn: "2026-01-01",
    minutes: 10,
    note: "Second cursor entry",
  });
  const page = await stageCall(
    planningLabApi,
    f.owner,
    `spaces/${f.space}/planning-time?from=2026-01-01&to=2026-01-01&limit=1`,
  );
  assert(page.nextCursor);
  await rejectStatus(
    stageCall(
      planningLabApi,
      f.member,
      `spaces/${f.space}/planning-time?from=2026-01-01&to=2026-01-01&limit=1&cursor=${page.nextCursor}`,
    ),
    400,
  );
  await rejectStatus(
    stageCall(
      planningLabApi,
      f.owner,
      `spaces/${f.space}/planning-time?from=2026-01-01&to=2026-01-02&limit=1&cursor=${page.nextCursor}`,
    ),
    400,
  );
  checks.push("Real report cursors cannot cross actor or filter boundaries");

  const a = await stageFixture(db, "Assistant race laboratory");
  const { assistantApi } =
    await import("../../packages/shared/src/assistant-api");
  const { assistantRunReviewApi } =
    await import("../../packages/shared/src/assistant-run-review");
  const run = await startStageAssistant(
    db,
    a,
    "productivity-evidence " + a.note,
    { discover: true },
  );
  const before = await stageProviderCalls();
  await Promise.all([one("tool"), one("tool")]);
  assert.equal(await stageProviderCalls(), before + 1);
  assert.equal(await status(run.id), "awaiting-review");
  const review = await stageCall(
      assistantRunReviewApi,
      a.owner,
      `assistant/runs/${run.id}/review`,
    ),
    mutationId = randomUUID();
  const approve = () =>
    stageCall(
      assistantRunReviewApi,
      a.owner,
      `assistant/runs/${run.id}/review/approve`,
      { fingerprint: review.fingerprint, consent: true, mutationId },
    );
  const approved = await Promise.all([approve(), approve()]);
  assert.equal(approved[0].reviewId, approved[1].reviewId);
  await Promise.all([one("tool"), one("tool")]);
  assert.equal(await stageProviderCalls(), before + 2);
  assert.equal(
    await count(
      "SELECT count(*) AS n FROM assistant_run_steps WHERE run_id=$1",
      [run.id],
    ),
    2,
  );
  assert.equal(await status(run.id), "complete");
  checks.push(
    "Concurrent exact-receipt approvals and two tool workers yield one dispatch per approved round",
  );

  for (const invalidation of [
    "expired-before-approval",
    "expired-after-approval",
    "provider-changed",
  ] as const) {
    const held = await startStageAssistant(
      db,
      a,
      "productivity-evidence " + a.note,
      { discover: true },
    );
    await one("tool");
    const saved = await stageCall(
      assistantRunReviewApi,
      a.owner,
      `assistant/runs/${held.id}/review`,
    );
    const calls = await stageProviderCalls();
    const approve = () =>
      stageCall(
        assistantRunReviewApi,
        a.owner,
        `assistant/runs/${held.id}/review/approve`,
        {
          fingerprint: saved.fingerprint,
          consent: true,
          mutationId: randomUUID(),
        },
      );
    if (invalidation === "expired-before-approval") {
      await db.query(
        "UPDATE assistant_run_reviews SET expires_at=now()-interval '1 second' WHERE run_id=$1",
        [held.id],
      );
      await rejectStatus(approve(), 409);
    } else {
      await approve();
      if (invalidation === "expired-after-approval")
        await db.query(
          "UPDATE assistant_run_reviews SET expires_at=now()-interval '1 second' WHERE run_id=$1",
          [held.id],
        );
      else
        await db.query(
          "UPDATE tool_providers SET version=version+1 WHERE id=$1",
          [held.provider],
        );
    }
    await Promise.all([one("tool"), one("tool")]);
    assert.equal(await stageProviderCalls(), calls);
    assert.equal(
      await count(
        "SELECT count(*) AS n FROM assistant_run_steps WHERE run_id=$1 AND ordinal>1",
        [held.id],
      ),
      0,
    );
    assert(["awaiting-review", "failed"].includes(await status(held.id)));
    checks.push(
      `${invalidation} prevents a subsequent external dispatch in the real worker`,
    );
  }

  const q1 = await startStageAssistant(
    db,
    a,
    "productivity-evidence " + a.note,
    { discover: true, dailyLimit: 3 },
  );
  const q2 = await startStageAssistant(
    db,
    a,
    "productivity-evidence " + a.note,
    { discover: true, provider: q1.provider },
  );
  const quotaBefore = await stageProviderCalls();
  await Promise.all([one("tool"), one("tool")]);
  assert.equal(await stageProviderCalls(), quotaBefore + 2);
  for (const pending of [q1, q2]) {
    const r = await stageCall(
      assistantRunReviewApi,
      a.owner,
      `assistant/runs/${pending.id}/review`,
    );
    await stageCall(
      assistantRunReviewApi,
      a.owner,
      `assistant/runs/${pending.id}/review/approve`,
      {
        fingerprint: r.fingerprint,
        consent: true,
        mutationId: randomUUID(),
      },
    );
  }
  await Promise.all([one("tool"), one("tool")]);
  assert.equal(await stageProviderCalls(), quotaBefore + 3);
  assert.deepEqual((await Promise.all([status(q1.id), status(q2.id)])).sort(), [
    "complete",
    "failed",
  ]);
  assert.equal(
    await count(
      "SELECT count(*) AS n FROM assistant_run_steps WHERE provider_id=$1 AND ordinal>1",
      [q1.provider],
    ),
    1,
  );
  checks.push(
    "Two approved rounds competing for one provider quota slot produce exactly one additional request",
  );

  for (const barrier of ["after-confirmed", "after-checkpoint"] as const) {
    const local = await startStageAssistant(
      db,
      a,
      "productivity-local-recovery",
      { mode: "prepare", provider: run.provider },
    );
    const started = await stageProviderCalls(),
      controlled = worker("tool", barrier);
    await controlled.hold();
    await controlled.crash();
    assert.equal(await stageProviderCalls(), started + 1);
    await db.query(
      "UPDATE tool_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [local.id],
    );
    await one("tool");
    assert.equal(await status(local.id), "failed");
    const captured = await stageCall(
        assistantRunReviewApi,
        a.owner,
        `assistant/runs/${local.id}/review`,
      ),
      retry = randomUUID();
    const recover = () =>
      stageCall(
        assistantRunReviewApi,
        a.owner,
        `assistant/runs/${local.id}/review/recover`,
        { fingerprint: captured.fingerprint, mutationId: retry },
      );
    await Promise.all([recover(), recover()]);
    await Promise.all([one("tool"), one("tool")]);
    assert.equal(await status(local.id), "complete");
    assert.equal(await stageProviderCalls(), started + 1);
    assert.equal(
      await count(
        "SELECT count(*) AS n FROM workspace_change_sets WHERE run_id=$1",
        [local.id],
      ),
      1,
    );
    assert.equal(
      await count(
        "SELECT count(*) AS n FROM workspace_change_actions a JOIN workspace_change_sets s ON s.id=a.set_id WHERE s.run_id=$1",
        [local.id],
      ),
      5,
    );
    checks.push(
      `Confirmed local recovery at ${barrier} retains one draft and makes zero extra provider calls`,
    );
  }
  const unknown = await startStageAssistant(db, a, "productivity-slow", {
    provider: run.provider,
  });
  const unknownBefore = await stageProviderCalls(),
    unknownWorker = worker("tool");
  await boundedWait(
    async () =>
      (await stageProviderCalls()) === unknownBefore + 1 ? true : false,
    "provider accepted the deliberately interrupted request",
  );
  await unknownWorker.crash();
  await db.query(
    "UPDATE tool_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [unknown.id],
  );
  await one("tool");
  assert.equal(await status(unknown.id), "uncertain");
  const unknownReview = await stageCall(
    assistantRunReviewApi,
    a.owner,
    `assistant/runs/${unknown.id}/review`,
  );
  await rejectStatus(
    stageCall(
      assistantRunReviewApi,
      a.owner,
      `assistant/runs/${unknown.id}/review/recover`,
      { fingerprint: unknownReview.fingerprint, mutationId: randomUUID() },
    ),
    409,
  );
  await one("tool");
  assert.equal(await stageProviderCalls(), unknownBefore + 1);
  checks.push(
    "An externally accepted but unconfirmed request becomes uncertain and cannot be retried as local recovery",
  );

  const cancelled = await startStageAssistant(
    db,
    a,
    "productivity-evidence " + a.note,
    { discover: true, provider: run.provider },
  );
  await one("tool");
  const pending = await stageCall(
      assistantRunReviewApi,
      a.owner,
      `assistant/runs/${cancelled.id}/review`,
    ),
    calls = await stageProviderCalls();
  const race = await Promise.allSettled([
    stageCall(
      assistantRunReviewApi,
      a.owner,
      `assistant/runs/${cancelled.id}/review/approve`,
      {
        fingerprint: pending.fingerprint,
        consent: true,
        mutationId: randomUUID(),
      },
    ),
    stageCall(
      assistantApi,
      a.owner,
      `assistant/conversations/${cancelled.conversationId}/turns/${cancelled.id}/cancel`,
      {},
    ),
  ]);
  assert(race.some((r) => r.status === "fulfilled"));
  await one("tool");
  assert.equal(await status(cancelled.id), "cancelled");
  assert.equal(await stageProviderCalls(), calls);
  const deleted = await startStageAssistant(
    db,
    a,
    "productivity-evidence " + a.note,
    { discover: true, provider: run.provider },
  );
  await one("tool");
  const held = await stageCall(
      assistantRunReviewApi,
      a.owner,
      `assistant/runs/${deleted.id}/review`,
    ),
    prior = await stageProviderCalls();
  await Promise.allSettled([
    stageCall(
      assistantRunReviewApi,
      a.owner,
      `assistant/runs/${deleted.id}/review/approve`,
      {
        fingerprint: held.fingerprint,
        consent: true,
        mutationId: randomUUID(),
      },
    ),
    stageCall(
      assistantApi,
      a.owner,
      `assistant/conversations/${deleted.conversationId}`,
      undefined,
      "DELETE",
    ),
  ]);
  assert.equal(
    (
      await db.query(
        "SELECT deleted_at IS NOT NULL AS cleared FROM assistant_conversations WHERE id=$1",
        [deleted.conversationId],
      )
    ).rows[0].cleared,
    true,
  );
  await one("tool");
  assert.equal(await stageProviderCalls(), prior);
  assert.equal(
    await count(
      "SELECT count(*) AS n FROM assistant_run_reviews WHERE run_id=$1 AND envelope<>'{}'::jsonb",
      [deleted.id],
    ),
    0,
  );
  checks.push(
    "Concurrent cancellation or retention and approval cannot authorize a later dispatch or retain outgoing content",
  );

  const access = await stageFixture(db, "Revocation laboratory");
  const revoked = await startStageAssistant(
    db,
    access,
    "productivity-evidence " + access.note,
    { discover: true },
  );
  await one("tool");
  const last = await stageCall(
    assistantRunReviewApi,
    access.owner,
    `assistant/runs/${revoked.id}/review`,
  );
  await stageCall(
    assistantRunReviewApi,
    access.owner,
    `assistant/runs/${revoked.id}/review/approve`,
    {
      fingerprint: last.fingerprint,
      consent: true,
      mutationId: randomUUID(),
    },
  );
  const revokeCalls = await stageProviderCalls();
  await db.query("BEGIN");
  await db.query("SELECT id FROM spaces WHERE id=$1 FOR UPDATE", [
    access.space,
  ]);
  await db.query("DELETE FROM members WHERE group_id=$1 AND user_id=$2", [
    access.group,
    access.owner,
  ]);
  await db.query("COMMIT");
  await Promise.all([one("tool"), one("tool")]);
  assert.equal(await stageProviderCalls(), revokeCalls);
  assert.equal(await status(revoked.id), "failed");
  checks.push(
    "Loss of workspace membership after consent blocks a queued external dispatch",
  );

  // Real adapter and SQL grants; this is not an OAuth login/transport certification.
  const m = await stageFixture(db, "MCP evidence laboratory"),
    outside = await stageFixture(db, "MCP evidence outside grant", m.owner),
    client = randomUUID(),
    connection = randomUUID();
  await db.query(
    "INSERT INTO oauth_client(id,client_id,name,user_id,scopes,redirect_uris) VALUES($1,$1,'Synthetic acceptance client',$2,ARRAY['workspace:read'],ARRAY['http://localhost:3004/synthetic-callback'])",
    [client, m.owner],
  );
  await db.query(
    "INSERT INTO integration_connections(id,user_id,client_id,name,scopes,space_ids) VALUES($1,$2,$3,'Synthetic acceptance grant',ARRAY['workspace:read'],ARRAY[$4::uuid])",
    [connection, m.owner, client, m.space],
  );
  const { activeConnection } =
    await import("../../packages/shared/src/integration-security");
  const { executeIntegrationAction } =
    await import("../../apps/web/lib/integration-executor");
  const grant = await activeConnection(connection, m.owner);
  const evidence = await executeIntegrationAction(
    grant,
    "workspace_evidence_search",
    {
      spaceId: m.space,
      query: {
        q: "MCP evidence",
        limit: "1",
        spaceIds: outside.space,
        spaces: outside.space,
      },
    },
  );
  assert.equal(evidence.items.length, 1);
  assert(evidence.items.every((item: any) => item.space_id === m.space));
  assert(evidence.nextCursor);
  await rejectStatus(
    executeIntegrationAction(grant, "workspace_evidence_search", {
      spaceId: outside.space,
      query: { q: "MCP evidence" },
    }),
    403,
  );
  await rejectStatus(
    executeIntegrationAction(grant, "workspace_evidence_search", {
      spaceId: m.space,
      query: { q: "Different query", cursor: evidence.nextCursor },
    }),
    400,
  );
  await rejectStatus(
    executeIntegrationAction(grant, "workspace_evidence_read", {
      spaceId: m.space,
      query: { id: outside.note },
    }),
    403,
  );
  await rejectStatus(
    executeIntegrationAction(grant, "assistant_review_approve", {
      spaceId: m.space,
    }),
    404,
  );
  await db.query(
    "UPDATE integration_connections SET revoked_at=now(),updated_at=now() WHERE id=$1",
    [connection],
  );
  await rejectStatus(
    executeIntegrationAction(grant, "workspace_evidence_search", {
      spaceId: m.space,
    }),
    403,
  );
  checks.push(
    "Native MCP evidence reads retain exact grants, cursor scope and revocation and cannot approve assistant consent",
  );
  // Persist a partial receipt fixture; exercise the actual native recovery API.
  // We do not label this fixture as a new application/crash execution pass.
  const partial = randomUUID(),
    completedFolder = randomUUID();
  await db.query(
    "INSERT INTO resources(id,space_id,kind,name,owner_id) VALUES($1,$2,'folder','Already completed output',$3)",
    [completedFolder, m.space, m.owner],
  );
  await db.query(
    "INSERT INTO workspace_change_sets(id,owner_id,title,space_ids,request_hash,status) VALUES($1,$2,'Partial receipt fixture',ARRAY[$3::uuid],repeat('a',64),'partial')",
    [partial, m.owner, m.space],
  );
  const partialActions = [
    {
      key: "done",
      action: "folder_create",
      title: "Completed folder",
      dependsOn: [],
      payload: { kind: "folder", name: "Already completed output" },
    },
    {
      key: "remaining",
      action: "file_create",
      title: "Remaining note",
      dependsOn: ["done"],
      payload: {
        type: "markdown",
        name: "Remaining note",
        parentId: "@{done}",
        source: "# Retained source\n",
      },
    },
    {
      key: "unknown",
      action: "folder_create",
      title: "Uncertain output",
      dependsOn: [],
      payload: { kind: "folder", name: "Must not replay" },
    },
  ];
  for (const [index, action] of partialActions.entries())
    await db.query(
      "INSERT INTO workspace_change_actions(set_id,key,position,entity_id,data,selected,state) VALUES($1,$2,$3,$4,$5,true,$6)",
      [
        partial,
        action.key,
        index,
        index === 0 ? completedFolder : randomUUID(),
        JSON.stringify({
          ...action,
          spaceId: m.space,
          explanation: "Saved partial receipt fixture",
        }),
        ["complete", "pending", "uncertain"][index],
      ],
    );
  const { productivityApi } =
    await import("../../packages/shared/src/productivity-api");
  const remainingMutationId = randomUUID(),
    resourceCount = await count(
      "SELECT count(*) AS n FROM resources WHERE space_id=$1",
      [m.space],
    );
  const recoverRemaining = () =>
    stageCall(
      productivityApi,
      m.owner,
      `assistant/change-sets/${partial}/reprepare`,
      {
        version: 1,
        keys: ["remaining"],
        mutationId: remainingMutationId,
      },
    );
  const recovered = await Promise.all([recoverRemaining(), recoverRemaining()]);
  assert.equal(recovered[0].id, recovered[1].id);
  assert.equal(recovered[0].recovery_of, partial);
  assert.equal(recovered[0].status, "draft");
  assert.equal(recovered[0].actions.length, 1);
  assert.equal(recovered[0].actions[0].data.payload.parentId, completedFolder);
  assert.deepEqual(recovered[0].actions[0].data.dependsOn, []);
  assert.equal(
    await count("SELECT count(*) AS n FROM resources WHERE space_id=$1", [
      m.space,
    ]),
    resourceCount,
  );
  await rejectStatus(
    stageCall(
      productivityApi,
      m.owner,
      `assistant/change-sets/${partial}/reprepare`,
      {
        version: 1,
        keys: ["unknown"],
        mutationId: randomUUID(),
      },
    ),
    409,
  );
  await rejectStatus(
    stageCall(
      productivityApi,
      m.owner,
      `assistant/change-sets/${partial}/reprepare`,
      {
        version: 2,
        keys: ["remaining"],
        mutationId: randomUUID(),
      },
    ),
    409,
  );
  await rejectStatus(
    stageCall(
      productivityApi,
      m.member,
      `assistant/change-sets/${partial}/reprepare`,
      {
        version: 1,
        keys: ["remaining"],
        mutationId: randomUUID(),
      },
    ),
    404,
  );
  checks.push(
    "Saved partial receipt recovery is concurrent-idempotent, reuses completed IDs, excludes uncertain work and creates only a private draft",
  );
  passed = true;
} catch (error) {
  failure = (error as Error).message;
  throw error;
} finally {
  await Promise.all([...children].map(stopAcceptanceChild));
  await db.end();
  await (await import("../../packages/shared/src/db")).pool.end();
  await writeFile(
    join(directory, "races.json"),
    JSON.stringify(
      {
        format: "axiom-stage-runtime-races",
        version: 1,
        passed,
        checks,
        error: failure,
        finishedAt: new Date().toISOString(),
        environment:
          "Attested disposable PostgreSQL, actual production workers, deterministic loopback provider; no mocked SQL results.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
