import { z } from "zod";
import {
  assistantCitationKeys,
  type AssistantEvidence,
  type AssistantMessage,
} from "./assistant";

/** Application-enforced limits, not a promise about a provider's billing. */
export const assistantRunBudgetSchema = z
  .object({
    maxRounds: z.number().int().min(1).max(8).default(8),
    maxOutputTokens: z.number().int().min(128).max(4096).default(4096),
  })
  .strict();
export type AssistantRunBudget = z.infer<typeof assistantRunBudgetSchema>;
export const defaultAssistantRunBudget: AssistantRunBudget = {
  maxRounds: 8,
  maxOutputTokens: 4096,
};
export type AssistantTokenUsage = {
  input: number | null;
  output: number | null;
};
export type AssistantRunUsage = {
  requests: number;
  inputTokens: number | null;
  outputTokens: number | null;
  reportedInputTokens: number;
  reportedOutputTokens: number;
  missingUsage: number;
};
export function providerUsage(
  usage: Record<string, unknown> | undefined,
): AssistantTokenUsage {
  const token = (n: unknown) =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
  return {
    input: token(usage?.prompt_tokens),
    output: token(usage?.completion_tokens),
  };
}
export function aggregateAssistantUsage(
  steps: { usage?: AssistantTokenUsage | null }[],
): AssistantRunUsage {
  const reportedInputTokens = steps.reduce(
    (n, s) => n + (s.usage?.input ?? 0),
    0,
  );
  const reportedOutputTokens = steps.reduce(
    (n, s) => n + (s.usage?.output ?? 0),
    0,
  );
  return {
    requests: steps.length,
    inputTokens: steps.some((s) => s.usage?.input == null)
      ? null
      : reportedInputTokens,
    outputTokens: steps.some((s) => s.usage?.output == null)
      ? null
      : reportedOutputTokens,
    reportedInputTokens,
    reportedOutputTokens,
    missingUsage: steps.filter(
      (s) => s.usage?.input == null || s.usage?.output == null,
    ).length,
  };
}
export type AssistantGroundingReport = {
  citations: { key: string; status: "matched" | "unknown" }[];
  unknownKeys: string[];
  /** This checks source membership, never truth or semantic entailment. */
  verification: "source-membership-only";
};
export function assistantGroundingReport(
  text: string,
  evidence: AssistantEvidence[],
): AssistantGroundingReport {
  const known = new Set(evidence.map((e) => e.key));
  const citations = assistantCitationKeys(text).map((key) => ({
    key,
    status: known.has(key) ? ("matched" as const) : ("unknown" as const),
  }));
  return {
    citations,
    unknownKeys: citations
      .filter((c) => c.status === "unknown")
      .map((c) => c.key),
    verification: "source-membership-only",
  };
}
export function invalidActionEvidence(
  action: unknown,
  evidence: AssistantEvidence[],
) {
  const text = JSON.stringify(action);
  const keys =
    typeof action === "object" && action !== null && "evidenceKeys" in action
      ? ((action as { evidenceKeys?: string[] }).evidenceKeys ?? [])
      : [];
  const known = new Set(evidence.map((e) => e.key));
  return [
    ...new Set([
      ...assistantGroundingReport(text, evidence).unknownKeys,
      ...keys.filter((key) => !known.has(key)),
    ]),
  ];
}
const planningEvidenceKeys = new Set([
  "id",
  "space_id",
  "title",
  "body",
  "status",
  "priority",
  "assignee_id",
  "assignee_name",
  "parent_id",
  "start_on",
  "due_on",
  "estimate_hours",
  "milestone_id",
  "version",
  "labels",
  "dependencies",
  "dependencyLinks",
  "progress_percent",
  "resource_ids",
  "note_id",
]);
export function planningEvidenceTask(task: object) {
  return Object.fromEntries(
    Object.entries(task).filter(([key]) => planningEvidenceKeys.has(key)),
  );
}

export type AssistantReviewResult = {
  request: Record<string, unknown>;
  result: AssistantEvidence | Record<string, unknown>;
};
export type AssistantContextReview = {
  id: string;
  runId: string;
  ordinal: number;
  fingerprint: string;
  expiresAt: string;
  state: "pending" | "approved" | "superseded";
  provider: {
    id: string;
    name: string;
    model: string;
    version: number;
    group_name: string;
  };
  spaceIds: string[];
  messages: AssistantMessage[];
  evidence: AssistantEvidence[];
  newEvidenceKeys: string[];
  budget: AssistantRunBudget;
  usage: AssistantRunUsage;
  characters: number;
};
export const assistantReviewRefreshSchema = z
  .object({
    fingerprint: z.string().length(64),
    excludeKeys: z.array(z.string().max(80)).max(20).default([]),
    excerpts: z
      .array(
        z
          .object({
            key: z.string().max(80),
            from: z.number().int().nonnegative(),
            to: z.number().int().positive(),
          })
          .strict()
          .refine((v) => v.to > v.from, "Select a nonempty excerpt."),
      )
      .max(20)
      .default([]),
  })
  .strict();

/** Ranges are relative to the captured excerpt; never read a newer source here. */
export function reviseReviewResults(
  results: AssistantReviewResult[],
  input: z.infer<typeof assistantReviewRefreshSchema>,
) {
  const all = results.flatMap((r) =>
    "key" in r.result ? [r.result as AssistantEvidence] : [],
  );
  const keys = new Set(all.map((e) => e.key));
  if (
    [...input.excludeKeys, ...input.excerpts.map((e) => e.key)].some(
      (key) => !keys.has(key),
    )
  )
    throw new Error(
      "Only newly retrieved excerpts can be removed or narrowed.",
    );
  if (new Set(input.excerpts.map((e) => e.key)).size !== input.excerpts.length)
    throw new Error("An excerpt can only be narrowed once per review.");
  return results.map((r) => {
    if (!("key" in r.result)) return r;
    const e = r.result as AssistantEvidence;
    if (input.excludeKeys.includes(e.key))
      return {
        ...r,
        result: {
          omitted: true,
          message: "The user did not approve this excerpt.",
        },
      };
    const range = input.excerpts.find((v) => v.key === e.key);
    if (!range) return r;
    if (
      !Number.isSafeInteger(range.from) ||
      !Number.isSafeInteger(range.to) ||
      range.from < 0 ||
      range.to <= range.from ||
      range.to > e.source.length ||
      (e.kind !== "document" && e.kind !== "office")
    )
      throw new Error(
        "Only captured document text can be narrowed within its range.",
      );
    return {
      ...r,
      result: {
        ...e,
        from: (e.from ?? 0) + range.from,
        to: (e.from ?? 0) + range.to,
        source: e.source.slice(range.from, range.to),
        excerptHash: undefined,
      },
    };
  });
}
