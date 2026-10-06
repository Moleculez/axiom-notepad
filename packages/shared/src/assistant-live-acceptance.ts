import { z } from "zod";
import { assistantInstruction, type AssistantMessage } from "./assistant";
import { assistantHash } from "./assistant-hash";

const money = z.number().finite().positive().max(1000);
export const liveProviderConfigSchema = z
  .object({
    providerId: z.string().trim().min(1).max(200),
    kind: z.enum(["private", "openrouter"]),
    endpoint: z.url(),
    model: z.string().trim().min(1).max(200),
    budgetUsd: money,
    inputUsdPerMillion: z.number().finite().nonnegative().max(1000),
    outputUsdPerMillion: z.number().finite().nonnegative().max(1000),
  })
  .strict()
  .refine((v) => {
    const url = new URL(v.endpoint);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.endsWith("/") &&
      (v.kind !== "openrouter" || url.href === "https://openrouter.ai/api/v1/")
    );
  }, "Live acceptance requires the exact plain HTTPS API base URL with a trailing slash (OpenRouter: https://openrouter.ai/api/v1/).");
export type LiveProviderConfig = z.infer<typeof liveProviderConfigSchema>;
export const liveAcceptanceMessages = Object.freeze(
  [
    { role: "system", content: assistantInstruction },
    {
      role: "user",
      content: JSON.stringify({
        request:
          "Summarize the two synthetic measurements and their limitation. Cite Esynthetic. Do not propose actions.",
        allowTaskCreate: false,
        evidence: [
          {
            key: "Esynthetic",
            kind: "document",
            id: "00000000-0000-4000-8000-000000000001",
            title: "Fictional acceptance experiment",
            source:
              "Synthetic experiment, not research data: trial A measured 2.0 arbitrary units; trial B measured 2.2 arbitrary units. Two measurements cannot establish reproducibility.",
            editable: false,
          },
        ],
      }),
    },
  ].map((m) => Object.freeze(m as AssistantMessage)),
);
export function prepareLiveAcceptance(raw: unknown, now = new Date()) {
  const provider = liveProviderConfigSchema.parse(raw);
  const costEstimate = liveRequestEstimate(provider);
  if (costEstimate.estimatedMaxUsd > provider.budgetUsd)
    throw new Error(
      "The configured-price request estimate exceeds the confirmed spending limit. Raise the explicit provider-side limit or do not run this sample.",
    );
  const payload = {
    format: "axiom-assistant-live-review" as const,
    version: 1 as const,
    provider,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.valueOf() + 900000).toISOString(),
    maxCalls: 1,
    maxOutputTokens: 1024,
    messages: liveAcceptanceMessages.map((m) => ({ ...m })),
    costEstimate,
  };
  return { ...payload, fingerprint: assistantHash(payload) };
}
export type LiveAcceptanceReview = ReturnType<typeof prepareLiveAcceptance>;
export function validateLiveAcceptance(
  raw: unknown,
  fingerprint: string,
  confirmedBudgetUsd: number,
  now = new Date(),
): LiveAcceptanceReview {
  const review = z
    .object({
      format: z.literal("axiom-assistant-live-review"),
      version: z.literal(1),
      provider: liveProviderConfigSchema,
      createdAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
      maxCalls: z.literal(1),
      maxOutputTokens: z.literal(1024),
      messages: z.array(
        z
          .object({
            role: z.enum(["system", "user", "assistant"]),
            content: z.string(),
          })
          .strict(),
      ),
      costEstimate: z
        .object({
          inputTokens: z.number().int().nonnegative(),
          outputTokens: z.literal(1024),
          inputBasis: z.literal(
            "UTF-8 bytes plus 128 per message; not a provider token count",
          ),
          estimatedMaxUsd: z.number().finite().nonnegative(),
        })
        .strict(),
      fingerprint: z.string().length(64),
    })
    .strict()
    .parse(raw);
  const { fingerprint: stored, ...payload } = review;
  if (stored !== fingerprint || assistantHash(payload) !== fingerprint)
    throw new Error("Approval does not match the exact live-provider preview.");
  if (
    JSON.stringify(review.messages) !== JSON.stringify(liveAcceptanceMessages)
  )
    throw new Error(
      "Live acceptance accepts only the bundled synthetic evidence, never workspace content.",
    );
  if (
    assistantHash(review.costEstimate) !==
      assistantHash(liveRequestEstimate(review.provider)) ||
    review.costEstimate.estimatedMaxUsd > confirmedBudgetUsd
  )
    throw new Error(
      "The configured-price estimate changed or exceeds the confirmed spending limit.",
    );
  if (
    Date.parse(review.expiresAt) <= now.valueOf() ||
    Date.parse(review.createdAt) > now.valueOf() ||
    Date.parse(review.expiresAt) - Date.parse(review.createdAt) !== 900000
  )
    throw new Error("Live preview expired or has an invalid lifetime.");
  if (confirmedBudgetUsd !== review.provider.budgetUsd)
    throw new Error(
      "Confirm the exact provider-side spending limit shown in the preview.",
    );
  return review;
}
function liveRequestEstimate(config: LiveProviderConfig) {
  const inputTokens = liveAcceptanceMessages.reduce(
    (n, m) => n + Buffer.byteLength(m.content, "utf8") + 128,
    0,
  );
  return {
    inputTokens,
    outputTokens: 1024 as const,
    inputBasis:
      "UTF-8 bytes plus 128 per message; not a provider token count" as const,
    estimatedMaxUsd:
      (inputTokens * config.inputUsdPerMillion +
        1024 * config.outputUsdPerMillion) /
      1_000_000,
  };
}
export function liveUsageCost(
  usage: { input: number | null; output: number | null },
  config: LiveProviderConfig,
) {
  if (usage.input === null || usage.output === null) return null;
  return (
    (usage.input * config.inputUsdPerMillion +
      usage.output * config.outputUsdPerMillion) /
    1_000_000
  );
}
