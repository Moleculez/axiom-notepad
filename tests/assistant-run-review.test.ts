import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const f = vi.hoisted(() => ({
  sql: vi.fn(),
  context: vi.fn(),
  access: vi.fn(),
  provider: vi.fn(),
}));
vi.mock("../packages/shared/src/db", () => ({
  query: vi.fn(),
  transaction: (work: (db: unknown) => unknown) => work({ query: f.sql }),
}));
vi.mock("../packages/shared/src/assistant-service", async () => ({
  assistantContext: f.context,
  assertAssistantAccess: f.access,
  assistantProvider: f.provider,
  ...(await import("../packages/shared/src/assistant-hash")),
}));
import {
  assistantRunReviewApi,
  storeAssistantReview,
  assertAssistantReviewSnapshot,
  type AssistantReviewRow,
} from "../packages/shared/src/assistant-run-review";
import type { AssistantContext } from "../packages/shared/src/assistant-service";
const runId = randomUUID(),
  contextId = randomUUID(),
  providerId = randomUUID(),
  spaceId = randomUUID();
const c: AssistantContext = {
  id: contextId,
  conversation_id: randomUUID(),
  provider_id: providerId,
  provider_version: 1,
  prompt: "Synthetic request",
  evidence: [],
  bases: {},
  messages: [{ role: "user", content: "Exact initial request" }],
  history_ids: [],
  fingerprint: "a".repeat(64),
  allow_task_create: false,
  conversation_version: 1,
  expires_at: new Date(Date.now() + 900000).toISOString(),
  submitted_at: null,
  cleared_at: null,
  created_at: new Date().toISOString(),
  owner_id: "owner",
  space_id: spaceId,
  space_ids: [spaceId],
  agent_config: { mode: "ask", discover: true },
};
let review: AssistantReviewRow | undefined,
  state: string,
  round: number,
  providerVersion: number,
  steps: Record<string, unknown>[],
  jobInput: Record<string, unknown>;
const request = (body: unknown) =>
  new Request("http://isolated.local/api/v1/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const api = (operation: string, body: unknown) =>
  assistantRunReviewApi(
    request(body),
    ["assistant", "runs", runId, "review", operation],
    "owner",
  );
beforeEach(async () => {
  vi.clearAllMocks();
  state = "awaiting-review";
  round = 1;
  providerVersion = 1;
  steps = [{ usage: { input: 10, output: 5 } }];
  jobInput = {};
  review = undefined;
  f.context.mockResolvedValue(c);
  f.access.mockResolvedValue(undefined);
  f.provider.mockImplementation(async (_user, _space, _provider, version) => {
    if (version !== undefined && version !== providerVersion)
      throw new Error("Provider configuration changed");
    return {
      id: providerId,
      name: "Synthetic provider",
      model: "fixture",
      version: providerVersion,
      group_name: "Fixture group",
    };
  });
  f.sql.mockImplementation(async (sql: string, args: unknown[] = []) => {
    if (sql.startsWith("SELECT j.assistant_context_id"))
      return { rows: [{ assistant_context_id: contextId }], rowCount: 1 };
    if (sql.startsWith("SELECT r.*,j.status"))
      return {
        rows: [
          {
            id: runId,
            round,
            status: state,
            review_id: review?.id,
            actions: [],
            messages: [],
          },
        ],
        rowCount: 1,
      };
    if (sql.startsWith("SELECT * FROM assistant_run_reviews"))
      return { rows: review ? [review] : [], rowCount: review ? 1 : 0 };
    if (sql.startsWith("SELECT usage FROM assistant_run_steps"))
      return { rows: steps, rowCount: steps.length };
    if (sql.startsWith("SELECT * FROM assistant_run_steps"))
      return { rows: steps.slice(-1), rowCount: steps.length ? 1 : 0 };
    if (sql.startsWith("SELECT input FROM tool_jobs"))
      return { rows: [{ input: jobInput }], rowCount: 1 };
    if (sql.startsWith("SELECT count(*)::int AS pending"))
      return { rows: [{ pending: 0 }], rowCount: 1 };
    if (sql.startsWith("INSERT INTO assistant_run_reviews")) {
      review = {
        id: args[0] as string,
        run_id: args[1] as string,
        ordinal: args[2] as number,
        fingerprint: args[3] as string,
        envelope: JSON.parse(args[4] as string),
        prefix_messages: JSON.parse(args[5] as string),
        read_results: JSON.parse(args[6] as string),
        state: args[7] as AssistantReviewRow["state"],
        expires_at: args[8] as string,
        approval_mutation_id: args[9] as string | null,
      };
      return { rows: [review], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE assistant_run_reviews SET state='approved'")) {
      review!.state = "approved";
      review!.approval_mutation_id = args[1] as string;
    }
    if (sql.startsWith("UPDATE tool_jobs SET status='queued'")) {
      state = "queued";
      if (args[1]) jobInput = JSON.parse(args[1] as string);
    }
    return { rows: [], rowCount: 0 };
  });
  await storeAssistantReview(
    { query: f.sql } as never,
    c,
    runId,
    2,
    [...c.messages, { role: "assistant", content: "Previous output" }],
    [],
    { maxRounds: 8, maxOutputTokens: 4096 },
  );
  f.sql.mockClear();
  f.provider.mockClear();
});
describe("immutable exact-batch review mechanics (mocked DB, not SQL concurrency acceptance)", () => {
  it("returns an owner-private preview without any dispatch or queue mutation", async () => {
    const response = await assistantRunReviewApi(
      new Request("http://isolated.local"),
      ["assistant", "runs", runId, "review"],
      "owner",
    );
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    const value = await response!.json();
    expect(value.messages).toEqual(review!.envelope.messages);
    expect(value.usage.requests).toBe(1);
    expect(
      f.sql.mock.calls.some(([sql]) =>
        String(sql).startsWith("UPDATE tool_jobs"),
      ),
    ).toBe(false);
  });
  it("requires explicit consent and the exact fresh fingerprint", async () => {
    for (const body of [
      {
        fingerprint: review!.fingerprint,
        consent: false,
        mutationId: randomUUID(),
      },
      { fingerprint: "f".repeat(64), consent: true, mutationId: randomUUID() },
    ])
      await expect(api("approve", body)).rejects.toThrow();
    expect(state).toBe("awaiting-review");
  });
  it("requeues exactly once and preserves the approval receipt on retries", async () => {
    const body = {
      fingerprint: review!.fingerprint,
      consent: true,
      mutationId: randomUUID(),
    };
    expect((await api("approve", body))?.status).toBe(202);
    expect(state).toBe("queued");
    const count = f.sql.mock.calls.filter(([sql]) =>
      String(sql).startsWith("UPDATE tool_jobs"),
    ).length;
    expect((await api("approve", body))?.status).toBe(202);
    expect(
      f.sql.mock.calls.filter(([sql]) =>
        String(sql).startsWith("UPDATE tool_jobs"),
      ).length,
    ).toBe(count);
    await expect(
      api("approve", { ...body, mutationId: randomUUID() }),
    ).rejects.toThrow(/another receipt/);
  });
  it("does not grandfather provider changes or revoked source access", async () => {
    providerVersion = 2;
    await expect(
      api("approve", {
        fingerprint: review!.fingerprint,
        consent: true,
        mutationId: randomUUID(),
      }),
    ).rejects.toThrow(/configuration/);
    expect(state).toBe("awaiting-review");
    f.access.mockRejectedValueOnce(new Error("Source revoked"));
    await expect(
      api("refresh", { fingerprint: review!.fingerprint }),
    ).rejects.toThrow(/revoked/);
  });
  it("refresh creates a different pending receipt; approval for the old envelope is rejected", async () => {
    const old = structuredClone(review!);
    providerVersion = 2;
    const response = await api("refresh", { fingerprint: old.fingerprint });
    const next = await response!.json();
    expect(next.fingerprint).not.toBe(old.fingerprint);
    expect(next.provider.version).toBe(2);
    expect(next.state).toBe("pending");
    expect(state).toBe("awaiting-review");
    await expect(
      api("approve", {
        fingerprint: old.fingerprint,
        consent: true,
        mutationId: randomUUID(),
      }),
    ).rejects.toThrow(/exact/);
  });
  it("locks conversation and context before a job/run, matching retention order", async () => {
    await api("approve", {
      fingerprint: review!.fingerprint,
      consent: true,
      mutationId: randomUUID(),
    });
    const sql = f.sql.mock.calls.map(([sql]) => String(sql));
    const conversation = sql.findIndex(
      (sql) =>
        sql.includes("assistant_conversations") && sql.includes("FOR SHARE"),
    );
    const context = sql.findIndex(
      (sql) => sql.includes("assistant_contexts") && sql.includes("FOR UPDATE"),
    );
    const job = sql.findIndex((sql) => sql.includes("FOR UPDATE OF j,r"));
    expect(context).toBeGreaterThan(conversation);
    expect(job).toBeGreaterThan(context);
  });
  it("refuses accidental or adversarial mutation of a stored envelope", async () => {
    review!.envelope.messages.push({
      role: "user",
      content: "Unapproved extra context",
    });
    expect(() => assertAssistantReviewSnapshot(review!)).toThrow(
      /no longer matches/,
    );
    await expect(
      api("approve", {
        fingerprint: review!.fingerprint,
        consent: true,
        mutationId: randomUUID(),
      }),
    ).rejects.toThrow(/no longer matches/);
  });
  it("redemption fails after cancellation and receipt expiry", async () => {
    state = "cancelled";
    await expect(
      api("approve", {
        fingerprint: review!.fingerprint,
        consent: true,
        mutationId: randomUUID(),
      }),
    ).rejects.toThrow(/run changed/);
    state = "awaiting-review";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.parse(review!.expires_at) + 1));
    try {
      await expect(
        api("approve", {
          fingerprint: review!.fingerprint,
          consent: true,
          mutationId: randomUUID(),
        }),
      ).rejects.toThrow(/expired/);
    } finally {
      vi.useRealTimers();
    }
  });
  it("explicitly recovers only a confirmed unfinished response, idempotently and without renewing external consent", async () => {
    state = "failed";
    providerVersion = 2;
    steps = [
      {
        ordinal: 2,
        review_id: review!.id,
        completed_at: new Date().toISOString(),
        outcome: "complete",
        response: { text: "saved response" },
      },
    ];
    const input = {
      fingerprint: review!.fingerprint,
      mutationId: randomUUID(),
    };
    expect(await (await api("recover", input))!.json()).toMatchObject({
      status: "queued",
      localOnly: true,
    });
    expect(jobInput).toEqual({
      recoverConfirmed: true,
      recoveryReceipt: input.mutationId,
    });
    expect(f.provider).not.toHaveBeenCalled();
    const count = f.sql.mock.calls.filter(([sql]) =>
      String(sql).startsWith("UPDATE tool_jobs"),
    ).length;
    await api("recover", input);
    expect(
      f.sql.mock.calls.filter(([sql]) =>
        String(sql).startsWith("UPDATE tool_jobs"),
      ).length,
    ).toBe(count);
    await expect(
      api("recover", { ...input, mutationId: randomUUID() }),
    ).rejects.toThrow(/Only confirmed/);
  });
  it("cannot recover an uncertain request, cancelled run, redacted response or revoked context", async () => {
    const input = {
      fingerprint: review!.fingerprint,
      mutationId: randomUUID(),
    };
    for (const patch of [
      { outcome: "uncertain" },
      { response: null },
      { finalized_at: new Date().toISOString() },
    ]) {
      state = "failed";
      steps = [
        {
          ordinal: 2,
          review_id: review!.id,
          completed_at: new Date().toISOString(),
          outcome: "complete",
          response: { text: "saved" },
          ...patch,
        },
      ];
      await expect(api("recover", input)).rejects.toThrow(/Only confirmed/);
    }
    state = "cancelled";
    await expect(api("recover", input)).rejects.toThrow();
    f.access.mockRejectedValueOnce(new Error("Revoked"));
    await expect(api("recover", input)).rejects.toThrow(/Revoked/);
  });
  it("counts held batches when reserving the shared account queue for local recovery", async () => {
    state = "failed";
    steps = [
      {
        ordinal: 2,
        review_id: review!.id,
        completed_at: new Date().toISOString(),
        outcome: "complete",
        response: { text: "saved" },
      },
    ];
    const previous = f.sql.getMockImplementation()!;
    f.sql.mockImplementation((sql: string, args: unknown[] = []) =>
      sql.startsWith("SELECT count(*)::int AS pending")
        ? { rows: [{ pending: 5 }], rowCount: 1 }
        : previous(sql, args),
    );
    await expect(
      api("recover", {
        fingerprint: review!.fingerprint,
        mutationId: randomUUID(),
      }),
    ).rejects.toThrow(/five jobs/);
    expect(state).toBe("failed");
  });
});
