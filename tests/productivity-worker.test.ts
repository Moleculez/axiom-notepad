import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const f = vi.hoisted(() => ({
  query: vi.fn(),
  sql: vi.fn(),
  context: vi.fn(),
  access: vi.fn(),
  provider: vi.fn(),
  call: vi.fn(),
  read: vi.fn(),
  store: vi.fn(),
  snapshot: vi.fn(),
  all: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../packages/shared/src/db", () => ({
  query: f.query,
  transaction: (work: (db: unknown) => unknown) => work({ query: f.sql }),
}));
vi.mock("../packages/shared/src/assistant-service", () => ({
  assistantContext: f.context,
  assistantProvider: f.provider,
  assertAssistantAccess: f.access,
}));
vi.mock("../packages/shared/src/tool-providers", () => ({
  callAssistantProvider: f.call,
}));
vi.mock("../packages/shared/src/assistant-evidence-service", () => ({
  readAssistantEvidence: f.read,
}));
vi.mock("../packages/shared/src/assistant-run-review", () => ({
  assistantAllEvidence: f.all,
  storeAssistantReview: f.store,
  lockAssistantRunContext: vi.fn(),
  assertAssistantReviewSnapshot: f.snapshot,
}));
vi.mock("../packages/shared/src/workspace-change-sets", () => ({
  createChangeSet: f.create,
}));
import { executeProductivityRound } from "../packages/shared/src/productivity-worker";
import type { AssistantContext } from "../packages/shared/src/assistant-service";
import type { AssistantReviewRow } from "../packages/shared/src/assistant-run-review";
import type { AssistantEvidence } from "../packages/shared/src/assistant";
const id = randomUUID(),
  space = randomUUID(),
  provider = randomUUID();
const evidence: AssistantEvidence = {
  key: "Ecaptured",
  kind: "document",
  id: randomUUID(),
  title: "Synthetic evidence",
  source: "A = B",
  hash: "a".repeat(64),
  capturedAt: new Date().toISOString(),
  editable: false,
  spaceId: space,
};
let context: AssistantContext,
  review: AssistantReviewRow,
  run: Record<string, any>,
  job: Record<string, any>,
  step: Record<string, any> | undefined,
  status: string;
const submitted = vi.fn();
const answer = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    answer: "Observation [[Ecaptured]]",
    actions: [],
    reads: [],
    done: true,
    ...patch,
  });
const action = {
  key: "note",
  action: "file_create",
  spaceId: space,
  title: "Private note",
  explanation: "Draft",
  dependsOn: [],
  payload: { type: "markdown", name: "Draft" },
};
beforeEach(() => {
  vi.resetAllMocks();
  status = "running";
  step = undefined;
  context = {
    id: randomUUID(),
    conversation_id: randomUUID(),
    provider_id: provider,
    provider_version: 1,
    prompt: "Synthetic task",
    evidence: [evidence],
    bases: {},
    messages: [{ role: "user", content: "Exact captured context" }],
    history_ids: [],
    fingerprint: "a".repeat(64),
    allow_task_create: false,
    conversation_version: 1,
    expires_at: new Date(Date.now() + 900000).toISOString(),
    submitted_at: null,
    cleared_at: null,
    created_at: new Date().toISOString(),
    owner_id: "owner",
    space_id: space,
    space_ids: [space],
    agent_config: { mode: "prepare", discover: true },
  };
  review = {
    id: randomUUID(),
    run_id: id,
    ordinal: 1,
    fingerprint: "b".repeat(64),
    expires_at: context.expires_at,
    state: "approved",
    prefix_messages: context.messages,
    read_results: [],
    approval_mutation_id: randomUUID(),
    envelope: {
      provider: {
        id: provider,
        name: "Fixture",
        model: "fixture",
        version: 1,
        group_name: "Fixture",
      },
      spaceIds: [space],
      messages: context.messages,
      evidence: [evidence],
      newEvidenceKeys: [],
      budget: { maxRounds: 8, maxOutputTokens: 1024 },
    },
  };
  run = {
    id,
    review_id: review.id,
    round: 0,
    actions: [],
    messages: [],
    activity: [],
  };
  job = { id, owner_id: "owner", assistant_context_id: context.id, input: {} };
  f.context.mockImplementation(async () => context);
  f.provider.mockResolvedValue({ id: provider, daily_limit: 100 });
  f.access.mockResolvedValue(undefined);
  f.all.mockResolvedValue([evidence]);
  f.create.mockResolvedValue({ id: randomUUID() });
  f.call.mockResolvedValue({
    text: answer(),
    usage: { input: null, output: 5 },
  });
  f.read.mockResolvedValue({
    output: { ...evidence, key: "Enew" },
    evidence: { ...evidence, key: "Enew" },
  });
  f.query.mockImplementation(async (sql: string) =>
    sql.startsWith("SELECT * FROM assistant_runs")
      ? [run]
      : sql.startsWith("SELECT * FROM assistant_run_reviews")
        ? [review]
        : sql.startsWith("SELECT * FROM assistant_run_steps")
          ? step
            ? [step]
            : []
          : [],
  );
  f.sql.mockImplementation(async (sql: string, args: unknown[] = []) => {
    if (sql.startsWith("SELECT j.status"))
      return { rows: [{ status, review_id: run.review_id, round: run.round }] };
    if (sql.startsWith("SELECT status FROM tool_jobs"))
      return { rows: [{ status }] };
    if (sql.includes("AS used")) return { rows: [{ used: 1 }] };
    if (sql.startsWith("INSERT INTO assistant_run_steps"))
      step = { ordinal: args[1], review_id: args[3], outcome: "dispatched" };
    if (sql.startsWith("UPDATE assistant_run_steps SET usage"))
      step = {
        ...step,
        usage: JSON.parse(args[2] as string),
        response: JSON.parse(args[3] as string),
        completed_at: new Date().toISOString(),
        outcome: "complete",
      };
    if (sql.startsWith("UPDATE assistant_run_steps SET finalized"))
      step!.finalized_at = new Date().toISOString();
    if (sql.startsWith("UPDATE assistant_runs SET round")) {
      run.round = args[1];
      run.messages = JSON.parse(args[2] as string);
      run.actions = JSON.parse(args[3] as string);
      run.activity = JSON.parse(args[4] as string);
    }
    if (sql.startsWith("UPDATE tool_jobs SET result"))
      job.result = JSON.parse(args[1] as string);
    if (sql.startsWith("UPDATE tool_jobs SET status='awaiting-review'"))
      status = "awaiting-review";
    if (sql.startsWith("UPDATE tool_jobs SET status='complete'")) {
      status = "complete";
      job.result = JSON.parse(args[1] as string);
    }
    return { rows: [], rowCount: 1 };
  });
});
const execute = (signal = new AbortController().signal) =>
  executeProductivityRound(job, signal, submitted);
describe("one dispatch per immutable reviewed batch (mocked DB)", () => {
  it("holds missing, pending and expired reviews without calling the provider", async () => {
    for (const state of ["pending", "expired", "missing"]) {
      review.state = state === "pending" ? "pending" : "approved";
      review.expires_at =
        state === "expired" ? new Date(0).toISOString() : context.expires_at;
      run.review_id = state === "missing" ? null : review.id;
      await execute();
    }
    expect(f.call).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
    expect(
      f.query.mock.calls.filter(([sql]) =>
        String(sql).includes("awaiting-review"),
      ),
    ).toHaveLength(3);
  });
  it("sends exactly the captured messages and reviewed output cap, stores unknown usage", async () => {
    await execute();
    expect(f.call).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      review.envelope.messages,
      expect.any(AbortSignal),
      { maxOutputTokens: 1024 },
    );
    expect(step?.usage).toEqual({ input: null, output: 5 });
    expect(step?.finalized_at).toBeTruthy();
    expect(status).toBe("complete");
  });
  it("retrieves locally but never sends a second round without another approval", async () => {
    f.call.mockResolvedValue({
      text: answer({
        done: false,
        reads: [{ kind: "document", id: evidence.id }],
      }),
      usage: { input: 10, output: 20 },
    });
    await execute();
    expect(f.call).toHaveBeenCalledTimes(1);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(status).toBe("awaiting-review");
    expect(f.store).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      id,
      2,
      expect.arrayContaining([
        { role: "assistant", content: expect.any(String) },
      ]),
      expect.any(Array),
      review.envelope.budget,
      { actionKeys: [] },
    );
  });
  it("preserves confirmed output when local retrieval fails and keeps error text inside review", async () => {
    f.call.mockResolvedValue({
      text: answer({
        done: false,
        reads: [{ kind: "document", id: evidence.id }],
      }),
      usage: { input: 10, output: 20 },
    });
    f.read.mockRejectedValue(new Error("Private DB error"));
    await execute();
    expect(status).toBe("awaiting-review");
    expect(job.result.warning).toMatch(/could not be captured/);
    expect(JSON.stringify(f.store.mock.calls)).not.toContain(
      "Private DB error",
    );
    expect(step?.completed_at).toBeTruthy();
  });
  it("enforces round limit and opt-out before additional local reads", async () => {
    review.envelope.budget.maxRounds = 1;
    f.call.mockResolvedValue({
      text: answer({
        done: false,
        reads: [{ kind: "document", id: evidence.id }],
      }),
      usage: { input: 10, output: 20 },
    });
    await execute();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.store).not.toHaveBeenCalled();
    expect(job.result.warning).toMatch(/round limit/);
  });
  it("keeps invented citations and Ask-mode writes inert", async () => {
    f.call.mockResolvedValue({
      text: answer({ answer: "Unsupported [[Eunknown]]", actions: [action] }),
      usage: { input: 10, output: 20 },
    });
    await execute();
    expect(f.create).not.toHaveBeenCalled();
    expect(job.result.grounding.unknownKeys).toEqual(["Eunknown"]);
    run.round = 0;
    status = "running";
    context.agent_config!.mode = "ask";
    f.call.mockResolvedValue({
      text: answer({ actions: [action] }),
      usage: { input: 10, output: 20 },
    });
    await execute();
    expect(f.create).not.toHaveBeenCalled();
    expect(job.result.warning).toMatch(/inert/);
  });
  it("checks permissions, envelope integrity and cancellation before dispatch", async () => {
    f.snapshot.mockImplementationOnce(() => {
      throw new Error("Envelope changed");
    });
    await expect(execute()).rejects.toThrow(/Envelope/);
    f.access.mockRejectedValueOnce(new Error("Revoked"));
    await expect(execute()).rejects.toThrow(/Revoked/);
    const controller = new AbortController();
    controller.abort();
    await expect(execute(controller.signal)).rejects.toThrow(/cancelled/);
    expect(f.call).not.toHaveBeenCalled();
  });
  it("checks the current provider configuration again before dispatch", async () => {
    f.provider.mockRejectedValueOnce(new Error("Provider changed"));
    await expect(execute()).rejects.toThrow(/Provider changed/);
    expect(f.call).not.toHaveBeenCalled();
    expect(submitted).not.toHaveBeenCalled();
  });
  it("fails closed at the next-round daily quota without submitting or replacing retained drafts", async () => {
    run.round = 1;
    review.ordinal = 2;
    f.provider.mockResolvedValue({ id: provider, daily_limit: 1 });
    await expect(execute()).rejects.toThrow(/daily request limit/);
    expect(f.call).not.toHaveBeenCalled();
    expect(step).toBeUndefined();
    expect(run.round).toBe(1);
  });
  it("stops oversized discovery without silently truncating or sending its captured text", async () => {
    f.call.mockResolvedValue({
      text: answer({
        done: false,
        reads: [{ kind: "document", id: evidence.id }],
      }),
      usage: { input: 10, output: 20 },
    });
    f.read.mockResolvedValue({
      output: { ...evidence, key: "Enew", source: "x".repeat(30000) },
      evidence: { ...evidence, key: "Enew", source: "x".repeat(30000) },
    });
    await execute();
    expect(status).toBe("complete");
    expect(f.store).not.toHaveBeenCalled();
    expect(f.call).toHaveBeenCalledTimes(1);
    expect(job.result.warning).toMatch(/No additional context was sent/);
    expect(JSON.stringify(job.result)).not.toContain("x".repeat(30000));
  });
  it("replays a confirmed response before its local checkpoint without another provider call", async () => {
    f.call.mockResolvedValue({
      text: answer({ actions: [action], done: false }),
      usage: { input: 10, output: 20 },
    });
    f.all.mockRejectedValueOnce(new Error("Local DB read failed"));
    await expect(execute()).rejects.toThrow(/Local DB/);
    expect(run.round).toBe(0);
    expect(step?.completed_at).toBeTruthy();
    job.input = { recoverConfirmed: true };
    await execute();
    expect(f.call).toHaveBeenCalledTimes(1);
    expect(status).toBe("awaiting-review");
    expect(run.actions).toHaveLength(1);
  });
  it("does not publish output after cancellation during provider processing", async () => {
    f.call.mockImplementation(async () => {
      status = "cancelled";
      return { text: answer(), usage: { input: 10, output: 20 } };
    });
    await execute();
    expect(step?.completed_at).toBeUndefined();
    expect(f.store).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });
  it("finishes a confirmed response locally after a finalization failure, without duplicated actions or billing", async () => {
    f.call.mockResolvedValue({
      text: answer({ actions: [action] }),
      usage: { input: 10, output: 20 },
    });
    f.create.mockRejectedValueOnce(new Error("Local failure"));
    await expect(execute()).rejects.toThrow(/Local failure/);
    expect(step?.completed_at).toBeTruthy();
    expect(step?.finalized_at).toBeUndefined();
    expect(run.actions).toHaveLength(1);
    job.input = { recoverConfirmed: true };
    await execute();
    expect(status).toBe("complete");
    expect(f.call).toHaveBeenCalledTimes(1);
    expect(f.create.mock.calls[1][1].actions).toHaveLength(1);
    expect(step?.finalized_at).toBeTruthy();
  });
  it("never recovers an uncertain, redacted or already finalized response", async () => {
    job.input = { recoverConfirmed: true };
    for (const invalid of [
      { outcome: "uncertain" },
      { completed_at: new Date(), outcome: "complete", response: null },
      {
        completed_at: new Date(),
        outcome: "complete",
        response: { text: answer() },
        finalized_at: new Date(),
      },
    ]) {
      step = { ordinal: 1, review_id: review.id, ...invalid };
      await expect(execute()).rejects.toThrow(/confirmed unfinished/);
    }
    expect(f.call).not.toHaveBeenCalled();
  });
});
