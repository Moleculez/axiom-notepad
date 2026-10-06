import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  assistantRunBudgetSchema,
  aggregateAssistantUsage,
  providerUsage,
  assistantGroundingReport,
  invalidActionEvidence,
  reviseReviewResults,
  planningEvidenceTask,
  type AssistantReviewResult,
} from "../packages/shared/src/assistant-grounding";
import {
  prepareLiveAcceptance,
  validateLiveAcceptance,
  liveAcceptanceMessages,
  liveUsageCost,
} from "../packages/shared/src/assistant-live-acceptance";
import { assistantHash } from "../packages/shared/src/assistant-hash";
import { remainingChangeActions } from "../packages/shared/src/change-set-recovery";
import type { AssistantEvidence } from "../packages/shared/src/assistant";
import type { ChangeAction } from "../packages/shared/src/productivity";

const e: AssistantEvidence = {
  key: "Eone",
  kind: "document",
  id: "00000000-0000-4000-8000-000000000001",
  title: "Source",
  source: "alpha beta gamma",
  hash: "a".repeat(64),
  capturedAt: "2026-10-06T00:00:00Z",
  editable: false,
  from: 100,
  to: 116,
  generation: 1,
};
describe("grounded assistant contracts", () => {
  it("retains the historical receipt fingerprint encoding when extracting the shared helper", () => {
    expect(assistantHash({ b: 2, a: 1 })).toBe(
      createHash("sha256").update('{"a":1,"b":2}').digest("hex"),
    );
  });
  it("keeps existing ceilings but permits smaller explicitly reviewed budgets", () => {
    expect(assistantRunBudgetSchema.parse({})).toEqual({
      maxRounds: 8,
      maxOutputTokens: 4096,
    });
    expect(
      assistantRunBudgetSchema.parse({ maxRounds: 1, maxOutputTokens: 128 }),
    ).toEqual({ maxRounds: 1, maxOutputTokens: 128 });
    for (const raw of [
      { maxRounds: 0 },
      { maxRounds: 9 },
      { maxRounds: 1.5 },
      { maxOutputTokens: 127 },
      { maxOutputTokens: 4097 },
      { maxRounds: Infinity },
      { costUsd: 1 },
    ])
      expect(assistantRunBudgetSchema.safeParse(raw).success).toBe(false);
  });
  it("represents absent, invalid and negative usage as unknown, without inventing zero", () => {
    expect(providerUsage(undefined)).toEqual({ input: null, output: null });
    expect(providerUsage({ prompt_tokens: 0, completion_tokens: 0 })).toEqual({
      input: 0,
      output: 0,
    });
    for (const n of [-1, NaN, Infinity, 0.5, "12"])
      expect(providerUsage({ prompt_tokens: n }).input).toBeNull();
    expect(
      aggregateAssistantUsage([
        { usage: { input: 20, output: 8 } },
        { usage: { input: null, output: 3 } },
      ]),
    ).toMatchObject({
      requests: 2,
      inputTokens: null,
      outputTokens: 11,
      reportedInputTokens: 20,
      missingUsage: 1,
    });
    expect(aggregateAssistantUsage([{ usage: null }])).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      requests: 1,
    });
    expect(aggregateAssistantUsage([])).toMatchObject({
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });
  it("validates membership only and does not label claims or quotes verified", () => {
    const report = assistantGroundingReport(
      "Unsupported claim [[Eone]], invented [[Efake]], repeat [[Eone]].",
      [e],
    );
    expect(report.unknownKeys).toEqual(["Efake"]);
    expect(report.citations).toEqual([
      { key: "Eone", status: "matched" },
      { key: "Efake", status: "unknown" },
    ]);
    expect(report.verification).toBe("source-membership-only");
    expect(
      invalidActionEvidence(
        {
          evidenceKeys: ["Eone", "Efake"],
          payload: { source: "[[Eanother]]" },
        },
        [e],
      ),
    ).toEqual(["Eanother", "Efake"]);
  });
  it("narrows captured text without replacing its full-document hash or consulting live data", () => {
    const results: AssistantReviewResult[] = [
      { request: { kind: "document", id: e.id }, result: e },
    ];
    const revised = reviseReviewResults(results, {
      fingerprint: "f".repeat(64),
      excludeKeys: [],
      excerpts: [{ key: e.key, from: 6, to: 10 }],
    });
    expect(revised[0].result).toMatchObject({
      source: "beta",
      from: 106,
      to: 110,
      hash: e.hash,
      editable: false,
    });
    expect(results[0].result).toBe(e);
    const omitted = reviseReviewResults(results, {
      fingerprint: "f".repeat(64),
      excludeKeys: [e.key],
      excerpts: [],
    });
    expect(JSON.stringify(omitted)).not.toContain("alpha beta gamma");
    expect(omitted[0].result).toMatchObject({ omitted: true });
  });
  it("rejects unknown, repeated, oversized or structurally invalid narrowing", () => {
    const results: AssistantReviewResult[] = [{ request: {}, result: e }];
    const base = { fingerprint: "f".repeat(64), excludeKeys: [], excerpts: [] };
    expect(() =>
      reviseReviewResults(results, { ...base, excludeKeys: ["Ehistory"] }),
    ).toThrow(/newly/);
    expect(() =>
      reviseReviewResults(results, {
        ...base,
        excerpts: [{ key: e.key, from: 0, to: 1000 }],
      }),
    ).toThrow(/range/);
    expect(() =>
      reviseReviewResults(results, {
        ...base,
        excerpts: [
          { key: e.key, from: 0, to: 1 },
          { key: e.key, from: 0, to: 2 },
        ],
      }),
    ).toThrow(/once/);
    expect(() =>
      reviseReviewResults(
        [{ request: {}, result: { ...e, kind: "planning" } }],
        { ...base, excerpts: [{ key: e.key, from: 0, to: 1 }] },
      ),
    ).toThrow(/document/);
  });
  it("does not implicitly send typed lab fields, time notes, or future task properties", () => {
    expect(
      planningEvidenceTask({
        id: e.id,
        title: "Task",
        body: "Accepted task text",
        custom_fields: { patient: "secret" },
        timeNotes: "secret",
        futureProperty: "secret",
        dependencyLinks: [],
      }),
    ).toEqual({
      id: e.id,
      title: "Task",
      body: "Accepted task text",
      dependencyLinks: [],
    });
  });
});

describe("remaining-only change sets", () => {
  const action = (
    key: string,
    overrides: Partial<ChangeAction> = {},
  ): ChangeAction => ({
    key,
    spaceId: e.id,
    action: "file_create",
    title: key,
    explanation: "",
    dependsOn: [],
    payload: { type: "markdown", name: key },
    ...overrides,
  });
  const row = (
    key: string,
    state: string,
    payload: Record<string, unknown> = {},
  ) => ({
    data: action(key, { payload }),
    state,
    selected: true,
    entity_id: key + "-allocated",
  });
  it("substitutes confirmed created IDs and retains only eligible unfinished dependencies", () => {
    const rows = [
      row("folder", "complete"),
      row("note", "failed", { parentId: "@{folder}", source: "See @{folder}" }),
      {
        ...row("task", "pending", { resourceIds: ["@{note}"] }),
        data: action("task", {
          action: "workspace_task_create",
          dependsOn: ["folder"],
          payload: { resourceIds: ["@{note}"] },
        }),
      },
    ];
    const remaining = remainingChangeActions(rows, ["task"]);
    expect(remaining.map((a) => a.key)).toEqual(["note", "task"]);
    expect(remaining[0].payload).toMatchObject({
      parentId: "folder-allocated",
      source: "See folder-allocated",
    });
    expect(remaining[1].dependsOn).toEqual([]);
    expect(remaining[1].payload.resourceIds).toEqual(["@{note}"]);
    expect(rows[1].data.payload.parentId).toBe("@{folder}");
  });
  it("never retries an uncertain action or one that depends on it", () => {
    const rows = [
      row("folder", "uncertain"),
      row("note", "pending", { parentId: "@{folder}" }),
    ];
    expect(() => remainingChangeActions(rows, ["folder"])).toThrow(/reconcile/);
    expect(() => remainingChangeActions(rows, ["note"])).toThrow(/reconcile/);
    expect(() =>
      remainingChangeActions([row("note", "executing")], ["note"]),
    ).toThrow(/reconcile/);
  });
  it("preserves stale version/hash guards and rejects unknown or previously unselected work", () => {
    const original = row("note", "failed", { version: 3, expectedHash: "old" });
    expect(remainingChangeActions([original], ["note"])[0].payload).toEqual(
      original.data.payload,
    );
    expect(() =>
      remainingChangeActions([{ ...original, selected: false }], ["note"]),
    ).toThrow();
    expect(() => remainingChangeActions([original], ["other"])).toThrow(
      /Unknown/,
    );
    expect(() =>
      remainingChangeActions([row("note", "complete")], ["note"]),
    ).toThrow(/no eligible/);
  });
});

describe("opt-in synthetic live-provider acceptance", () => {
  const now = new Date("2026-10-06T00:00:00Z");
  const config = {
    providerId: "Explicit acceptance provider",
    kind: "private",
    endpoint: "https://provider.example/v1/",
    model: "explicit-model",
    budgetUsd: 0.1,
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 2,
  };
  it("prepares exactly one synthetic call without credentials or arbitrary content", () => {
    const review = prepareLiveAcceptance(config, now);
    expect(
      validateLiveAcceptance(review, review.fingerprint, 0.1, now),
    ).toEqual(review);
    expect(review.maxCalls).toBe(1);
    expect(review.maxOutputTokens).toBe(1024);
    expect(review.messages).toEqual(liveAcceptanceMessages);
    expect(JSON.stringify(review)).not.toContain("credential");
    review.messages[0].content = "Unapproved message";
    expect(prepareLiveAcceptance(config, now).messages).toEqual(
      liveAcceptanceMessages,
    );
  });
  it("rejects changed endpoints, model, prices, budgets, messages and consent fingerprints", () => {
    const review = prepareLiveAcceptance(config, now);
    for (const patch of [
      { provider: { ...review.provider, model: "changed" } },
      { provider: { ...review.provider, budgetUsd: 1 } },
      { messages: [{ role: "user", content: "private research" }] },
    ])
      expect(() =>
        validateLiveAcceptance(
          { ...review, ...patch },
          review.fingerprint,
          0.1,
          now,
        ),
      ).toThrow();
    const malicious = {
      ...review,
      messages: [{ role: "user" as const, content: "private research" }],
    };
    const { fingerprint: _, ...payload } = malicious;
    malicious.fingerprint = assistantHash(payload);
    expect(() =>
      validateLiveAcceptance(malicious, malicious.fingerprint, 0.1, now),
    ).toThrow(/synthetic/);
    expect(() =>
      validateLiveAcceptance(review, "f".repeat(64), 0.1, now),
    ).toThrow(/Approval/);
    expect(() =>
      validateLiveAcceptance(review, review.fingerprint, 1, now),
    ).toThrow(/spending/);
  });
  it("requires HTTPS, finite configured prices, fresh receipts and a confirmed budget", () => {
    expect(() =>
      prepareLiveAcceptance(
        { ...config, endpoint: "http://provider.example" },
        now,
      ),
    ).toThrow();
    expect(() =>
      prepareLiveAcceptance({ ...config, inputUsdPerMillion: NaN }, now),
    ).toThrow();
    expect(() =>
      prepareLiveAcceptance({ ...config, inputUsdPerMillion: 1000 }, now),
    ).toThrow(/estimate exceeds/);
    expect(() =>
      prepareLiveAcceptance(
        { ...config, endpoint: "https://user:secret@provider.example/v1/" },
        now,
      ),
    ).toThrow();
    const review = prepareLiveAcceptance(config, now);
    expect(() =>
      validateLiveAcceptance(
        review,
        review.fingerprint,
        0.1,
        new Date(now.valueOf() + 900000),
      ),
    ).toThrow(/expired/);
    expect(
      liveUsageCost({ input: null, output: 100 }, review.provider),
    ).toBeNull();
    expect(
      liveUsageCost({ input: 100, output: 100 }, review.provider),
    ).toBeCloseTo(0.0003);
  });
});
