import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  mutationTestTarget,
  verifyMutationTestStorage,
  verifyMutationTestServer,
} from "../../packages/shared/src/test-target";

export async function stageDatabase(
  env: NodeJS.ProcessEnv = process.env,
  requireServer = true,
) {
  const target = mutationTestTarget(env, env.AXIOM_TEST_ROOT);
  assert.equal(target.profile, "reliability");
  await verifyMutationTestStorage(target);
  if (requireServer) await verifyMutationTestServer(env);
  const db = new pg.Client({
    connectionString: target.databaseUrl,
    statement_timeout: 30000,
  });
  await db.connect();
  const actual = (await db.query("SELECT current_database() AS name")).rows[0];
  if (actual.name !== target.databaseName) {
    await db.end();
    throw new Error(
      "Actual stage database does not match its attested target.",
    );
  }
  return db;
}
export async function stageFixture(
  db: pg.Client,
  label: string,
  existingOwner?: string,
) {
  const suffix = randomUUID().slice(0, 8),
    group = randomUUID(),
    note = randomUUID();
  const owner = existingOwner ?? `stage-owner-${suffix}`,
    member = `stage-member-${suffix}`,
    viewer = `stage-viewer-${suffix}`,
    outsider = `stage-outsider-${suffix}`;
  for (const user of [
    ...(existingOwner ? [] : [owner]),
    member,
    viewer,
    outsider,
  ])
    await db.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)', [
      user,
      `${user}@axiom.test`,
    ]);
  await db.query("INSERT INTO groups(id,name) VALUES($1,$2)", [group, label]);
  await db.query(
    "INSERT INTO members(group_id,user_id,role,content_role) VALUES($1,$2,'owner','editor'),($1,$3,'member','editor'),($1,$4,'member','viewer')",
    [group, owner, member, viewer],
  );
  await db.query(
    "INSERT INTO notes(id,group_id,author_id,title,body) VALUES($1,$2,$3,$4,$5)",
    [
      note,
      group,
      owner,
      label,
      "# Synthetic evidence\r\n\r\nAn observation is not proof.\r\n",
    ],
  );
  const space = (
    await db.query("SELECT space_id FROM resources WHERE id=$1", [note])
  ).rows[0].space_id as string;
  const task = randomUUID();
  await db.query(
    "INSERT INTO tasks(id,space_id,created_by,title,body) VALUES($1,$2,$3,$4,'Unchanged synthetic task body')",
    [task, space, owner, label],
  );
  return { owner, member, viewer, outsider, group, note, space, task };
}
export async function stageCall(
  handler: (
    request: Request,
    path: string[],
    user: string,
  ) => Promise<Response | null>,
  user: string,
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
) {
  const request = new Request(`http://localhost:3004/api/v1/${path}`, {
    method,
    headers: {
      origin: "http://localhost:3004",
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await handler(request, path.split("?")[0].split("/"), user);
  assert(response, `Missing real handler for ${path}`);
  assert(response.ok, `Real handler refused ${path}: ${response.status}`);
  return response.json();
}
export async function startStageAssistant(
  db: pg.Client,
  f: Awaited<ReturnType<typeof stageFixture>>,
  prompt: string,
  options: {
    mode?: "ask" | "prepare";
    discover?: boolean;
    provider?: string;
    dailyLimit?: number;
  } = {},
) {
  const { assistantApi } =
    await import("../../packages/shared/src/assistant-api");
  const { sealCredential } =
    await import("../../packages/shared/src/tool-providers");
  let provider = options.provider;
  if (!provider) {
    assert(
      Number.isInteger(options.dailyLimit ?? 1000) &&
        (options.dailyLimit ?? 1000) >= 1,
    );
    provider = randomUUID();
    await db.query(
      "INSERT INTO tool_providers(id,group_id,name,kind,endpoint,model,credential,capabilities,enabled,daily_limit) VALUES($1,$2,'Synthetic stage provider','private','http://127.0.0.1:8096/v1/','synthetic-only',$3,ARRAY['assistant'],true,$4)",
      [
        provider,
        f.group,
        sealCredential("assistant-fixture-token"),
        options.dailyLimit ?? 1000,
      ],
    );
  }
  const conversation = await stageCall(
    assistantApi,
    f.owner,
    `spaces/${f.space}/assistant/conversations`,
    { id: randomUUID(), title: prompt.slice(0, 120) },
  );
  const preview = await stageCall(
    assistantApi,
    f.owner,
    `spaces/${f.space}/assistant/contexts`,
    {
      conversationId: conversation.id,
      providerId: provider,
      providerVersion: 1,
      prompt,
      selections: [],
      agent: {
        mode: options.mode ?? "ask",
        discover: options.discover ?? false,
        budget: { maxRounds: 4, maxOutputTokens: 1024 },
      },
    },
  );
  const job = await stageCall(
    assistantApi,
    f.owner,
    `assistant/conversations/${conversation.id}/turns`,
    {
      contextId: preview.id,
      fingerprint: preview.fingerprint,
      consent: true,
      mutationId: randomUUID(),
    },
  );
  return {
    id: job.id as string,
    provider,
    conversationId: conversation.id as string,
    contextId: preview.id as string,
  };
}
export async function stageProviderCalls() {
  const response = await fetch("http://127.0.0.1:8096/calls", {
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  assert(response.ok);
  return (await response.json()).calls as number;
}
export async function boundedWait<T>(
  work: () => Promise<T | false | undefined>,
  message: string,
  timeout = 20000,
): Promise<T> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = await work();
    if (result !== false && result !== undefined) return result;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`Stage acceptance timed out: ${message}`);
}
