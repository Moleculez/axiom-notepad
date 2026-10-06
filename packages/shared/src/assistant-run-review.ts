import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { query, transaction } from "./db";
import { HttpError } from "./access";
import { workspaceJson } from "./workspace-service";
import { sourceHash } from "./document-commands";
import {
  validateAssistantBudget,
  type AssistantEvidence,
  type AssistantMessage,
} from "./assistant";
import {
  assistantContext,
  assistantProvider,
  assistantHash,
  assertAssistantAccess,
  type AssistantContext,
} from "./assistant-service";
import {
  aggregateAssistantUsage,
  assistantReviewRefreshSchema,
  defaultAssistantRunBudget,
  reviseReviewResults,
  type AssistantContextReview,
  type AssistantReviewResult,
  type AssistantRunBudget,
} from "./assistant-grounding";

type Envelope = Pick<
  AssistantContextReview,
  | "provider"
  | "spaceIds"
  | "messages"
  | "evidence"
  | "newEvidenceKeys"
  | "budget"
>;
export type AssistantReviewRow = {
  id: string;
  run_id: string;
  ordinal: number;
  fingerprint: string;
  expires_at: string;
  state: AssistantContextReview["state"];
  envelope: Envelope;
  prefix_messages: AssistantMessage[];
  read_results: AssistantReviewResult[];
  approval_mutation_id: string | null;
};
export function assertAssistantReviewSnapshot(row: AssistantReviewRow) {
  if (
    row.fingerprint !==
    assistantHash({
      id: row.id,
      runId: row.run_id,
      ordinal: row.ordinal,
      expiresAt: new Date(row.expires_at).toISOString(),
      envelope: row.envelope,
    })
  )
    throw new HttpError(
      409,
      "The captured envelope no longer matches its review. Nothing will be sent.",
    );
}

/** Match retention's conversation -> context -> job lock order. */
export async function lockAssistantRunContext(
  db: PoolClient,
  c: AssistantContext,
) {
  await db.query(
    "SELECT id FROM assistant_conversations WHERE id=$1 FOR SHARE",
    [c.conversation_id],
  );
  await db.query("SELECT id FROM assistant_contexts WHERE id=$1 FOR UPDATE", [
    c.id,
  ]);
}

export async function assistantAllEvidence(
  c: AssistantContext,
  db?: PoolClient,
) {
  const sql =
    "SELECT evidence FROM assistant_contexts WHERE id=ANY($1::uuid[]) AND cleared_at IS NULL";
  const rows = db
    ? (await db.query(sql, [[c.id, ...c.history_ids]])).rows
    : await query(sql, [[c.id, ...c.history_ids]]);
  return [
    ...new Map(
      [
        ...rows.flatMap((r) => r.evidence as AssistantEvidence[]),
        ...c.evidence,
      ].map((e) => [e.key, e]),
    ).values(),
  ];
}

/** Each review is a new immutable envelope; refreshing supersedes, never edits it. */
export async function storeAssistantReview(
  db: PoolClient,
  c: AssistantContext,
  runId: string,
  ordinal: number,
  prefix: AssistantMessage[],
  results: AssistantReviewResult[],
  budget: AssistantRunBudget,
  options: {
    approved?: boolean;
    mutationId?: string;
    actionKeys?: string[];
  } = {},
) {
  if (ordinal > budget.maxRounds)
    throw new HttpError(429, "This run reached its reviewed round limit.");
  const provider = await assistantProvider(
    c.owner_id,
    c.space_id,
    c.provider_id,
    undefined,
    db,
  );
  const newEvidence = results
    .flatMap((r) => ("key" in r.result ? [r.result as AssistantEvidence] : []))
    .map((e) => ({ ...e, excerptHash: sourceHash(e.source) }));
  const evidence = [...c.evidence, ...newEvidence];
  const messages: AssistantMessage[] = [...prefix];
  if (results.length)
    messages.push({
      role: "user",
      content: JSON.stringify({
        toolResults: results.map((r) => ({
          ...r,
          result:
            "key" in r.result
              ? {
                  ...r.result,
                  excerptHash: sourceHash(
                    (r.result as AssistantEvidence).source,
                  ),
                }
              : r.result,
        })),
        previousDraftKeys: options.actionKeys ?? [],
        roundsRemaining: budget.maxRounds - ordinal + 1,
      }),
    });
  try {
    validateAssistantBudget(evidence, messages);
  } catch (e) {
    throw new HttpError(413, (e as Error).message);
  }
  await assertAssistantAccess({ ...c, evidence }, db);
  const id = randomUUID(),
    expiresAt = new Date(Date.now() + 900000).toISOString();
  const envelope: Envelope = JSON.parse(
    JSON.stringify({
      provider: {
        id: provider.id,
        name: provider.name,
        model: provider.model,
        version: provider.version,
        group_name: provider.group_name,
      },
      spaceIds: c.space_ids ?? [c.space_id],
      messages,
      evidence,
      newEvidenceKeys: newEvidence.map((e) => e.key),
      budget,
    }),
  );
  const fingerprint = assistantHash({
    id,
    runId,
    ordinal,
    expiresAt,
    envelope,
  });
  await db.query(
    "UPDATE assistant_run_reviews SET state='superseded' WHERE run_id=$1 AND ordinal=$2 AND state='pending'",
    [runId, ordinal],
  );
  const {
    rows: [review],
  } = await db.query<AssistantReviewRow>(
    "INSERT INTO assistant_run_reviews(id,run_id,ordinal,fingerprint,envelope,prefix_messages,read_results,state,expires_at,approved_at,approval_mutation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $8='approved' THEN now() ELSE NULL END,$10) RETURNING *",
    [
      id,
      runId,
      ordinal,
      fingerprint,
      JSON.stringify(envelope),
      JSON.stringify(prefix),
      JSON.stringify(results),
      options.approved ? "approved" : "pending",
      expiresAt,
      options.mutationId ?? null,
    ],
  );
  await db.query("UPDATE assistant_runs SET review_id=$2 WHERE id=$1", [
    runId,
    id,
  ]);
  return review;
}

export async function createInitialAssistantReview(
  db: PoolClient,
  c: AssistantContext,
  runId: string,
  mutationId: string,
) {
  return storeAssistantReview(
    db,
    c,
    runId,
    1,
    c.messages,
    [],
    c.agent_config?.budget ?? defaultAssistantRunBudget,
    { approved: true, mutationId },
  );
}

async function loadReviewRun(id: string, user: string, db: PoolClient) {
  const {
    rows: [found],
  } = await db.query(
    "SELECT j.assistant_context_id FROM tool_jobs j JOIN assistant_runs r ON r.id=j.id WHERE j.id=$1 AND j.owner_id=$2",
    [id, user],
  );
  if (!found) throw new HttpError(404, "Private assistant run unavailable.");
  const c = await assistantContext(found.assistant_context_id, user, db);
  await lockAssistantRunContext(db, c);
  await assertAssistantAccess(c, db);
  const {
    rows: [run],
  } = await db.query(
    "SELECT r.*,j.status FROM assistant_runs r JOIN tool_jobs j ON j.id=r.id WHERE r.id=$1 AND j.owner_id=$2 FOR UPDATE OF j,r",
    [id, user],
  );
  if (!run) throw new HttpError(404, "Private assistant run unavailable.");
  const {
    rows: [review],
  } = run.review_id
    ? await db.query<AssistantReviewRow>(
        "SELECT * FROM assistant_run_reviews WHERE id=$1",
        [run.review_id],
      )
    : { rows: [] };
  if (review) assertAssistantReviewSnapshot(review);
  return { run, c, review };
}
async function publicReview(
  db: PoolClient,
  row: AssistantReviewRow,
): Promise<AssistantContextReview> {
  const { rows: steps } = await db.query(
    "SELECT usage FROM assistant_run_steps WHERE run_id=$1 ORDER BY ordinal",
    [row.run_id],
  );
  return {
    id: row.id,
    runId: row.run_id,
    ordinal: row.ordinal,
    fingerprint: row.fingerprint,
    expiresAt: row.expires_at,
    state: row.state,
    ...row.envelope,
    usage: aggregateAssistantUsage(steps),
    characters: row.envelope.messages.reduce((n, m) => n + m.content.length, 0),
  };
}

export async function assistantRunReviewApi(
  request: Request,
  path: string[],
  user: string,
) {
  if (path[0] !== "assistant" || path[1] !== "runs") return null;
  const id = z.uuid().parse(path[2]);
  if (path[3] !== "review")
    throw new HttpError(404, "Assistant run action unavailable.");
  const operation = path[4];
  if (request.method === "GET" && !operation)
    return workspaceJson(
      await transaction(async (db) => {
        const { run, c, review } = await loadReviewRun(id, user, db);
        if (!review)
          return {
            legacy: true,
            message: "Refresh to review this legacy run's next exact context.",
          };
        await assertAssistantAccess(
          { ...c, evidence: review.envelope.evidence },
          db,
        );
        if (run.review_id !== review.id)
          throw new HttpError(409, "Review changed.");
        return publicReview(db, review);
      }),
    );
  if (request.method !== "POST")
    throw new HttpError(405, "Unsupported context review operation.");
  if (operation === "recover") {
    const input = z
      .object({ fingerprint: z.string().length(64), mutationId: z.uuid() })
      .strict()
      .parse(await request.json());
    return workspaceJson(
      await transaction(async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "tool-queue:" + user,
        ]);
        const { run, c, review } = await loadReviewRun(id, user, db);
        if (!review || review.fingerprint !== input.fingerprint)
          throw new HttpError(409, "The recovery snapshot changed.");
        const {
          rows: [job],
        } = await db.query("SELECT input FROM tool_jobs WHERE id=$1", [id]);
        if (
          ["queued", "running"].includes(run.status) &&
          job?.input?.recoveryReceipt === input.mutationId
        )
          return { id, status: run.status };
        const {
          rows: [step],
        } = await db.query(
          "SELECT * FROM assistant_run_steps WHERE run_id=$1 ORDER BY ordinal DESC LIMIT 1",
          [id],
        );
        if (
          run.status !== "failed" ||
          !step?.completed_at ||
          step.outcome !== "complete" ||
          step.finalized_at ||
          !step.response?.text ||
          step.review_id !== review.id ||
          ![run.round, run.round + 1].includes(step.ordinal)
        )
          throw new HttpError(
            409,
            "Only confirmed unfinished local processing can be recovered. Uncertain requests are never retried.",
          );
        await assertAssistantAccess(
          { ...c, evidence: review.envelope.evidence },
          db,
        );
        const {
          rows: [pending],
        } = await db.query(
          "SELECT count(*)::int AS pending FROM tool_jobs WHERE owner_id=$1 AND status IN ('queued','running','awaiting-review')",
          [user],
        );
        if (pending.pending >= 5)
          throw new HttpError(
            429,
            "Stop or finish a pending request before recovering another. At most five jobs may be pending per account.",
          );
        await db.query(
          "UPDATE tool_jobs SET status='queued',error=NULL,input=$2,updated_at=now() WHERE id=$1",
          [
            id,
            JSON.stringify({
              recoverConfirmed: true,
              recoveryReceipt: input.mutationId,
            }),
          ],
        );
        return { id, status: "queued", localOnly: true };
      }),
      202,
    );
  }
  if (operation === "refresh") {
    const input = assistantReviewRefreshSchema.parse(await request.json());
    return workspaceJson(
      await transaction(async (db) => {
        const { run, c, review } = await loadReviewRun(id, user, db);
        if (run.status !== "awaiting-review")
          throw new HttpError(409, "This run is not awaiting context review.");
        if (review && review.fingerprint !== input.fingerprint)
          throw new HttpError(
            409,
            "The context changed. Open its current review.",
          );
        if (!review && input.fingerprint !== c.fingerprint)
          throw new HttpError(409, "Legacy review fingerprint mismatch.");
        if (review)
          await assertAssistantAccess(
            { ...c, evidence: review.envelope.evidence },
            db,
          );
        let results: AssistantReviewResult[];
        try {
          results = reviseReviewResults(review?.read_results ?? [], input);
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
        const next = await storeAssistantReview(
          db,
          c,
          id,
          run.round + 1,
          review?.prefix_messages ?? [...c.messages, ...run.messages],
          results,
          review?.envelope.budget ??
            c.agent_config?.budget ??
            defaultAssistantRunBudget,
          { actionKeys: run.actions.map((a: { key: string }) => a.key) },
        );
        return publicReview(db, next);
      }),
      201,
    );
  }
  if (operation === "approve") {
    const input = z
      .object({
        fingerprint: z.string().length(64),
        consent: z.literal(true),
        mutationId: z.uuid(),
      })
      .strict()
      .parse(await request.json());
    return workspaceJson(
      await transaction(async (db) => {
        const { run, c, review } = await loadReviewRun(id, user, db);
        if (!review || review.fingerprint !== input.fingerprint)
          throw new HttpError(
            409,
            "Approval does not match this exact outgoing context.",
          );
        if (review.approval_mutation_id) {
          if (review.approval_mutation_id !== input.mutationId)
            throw new HttpError(
              409,
              "This review was already approved with another receipt.",
            );
          return { id, status: run.status, reviewId: review.id };
        }
        if (
          run.status !== "awaiting-review" ||
          review.state !== "pending" ||
          new Date(review.expires_at).valueOf() <= Date.now()
        )
          throw new HttpError(
            409,
            "Review expired or the run changed. Refresh and approve a new preview.",
          );
        await assertAssistantAccess(
          { ...c, evidence: review.envelope.evidence },
          db,
        );
        await assistantProvider(
          user,
          c.space_id,
          c.provider_id,
          review.envelope.provider.version,
          db,
        );
        const { rowCount } = await db.query(
          "SELECT 1 FROM assistant_run_reviews WHERE approval_mutation_id=$1",
          [input.mutationId],
        );
        if (rowCount)
          throw new HttpError(
            409,
            "Approval identifier belongs to another review.",
          );
        await db.query(
          "UPDATE assistant_run_reviews SET state='approved',approved_at=now(),approval_mutation_id=$2 WHERE id=$1",
          [review.id, input.mutationId],
        );
        await db.query(
          "UPDATE tool_jobs SET status='queued',error=NULL,updated_at=now() WHERE id=$1",
          [id],
        );
        return { id, status: "queued", reviewId: review.id };
      }),
      202,
    );
  }
  throw new HttpError(404, "Unknown context review operation.");
}

export async function assistantRunSummary(id: string, c: AssistantContext) {
  return transaction(async (db) => {
    const {
      rows: [run],
    } = await db.query(
      "SELECT r.*,v.id AS next_id,v.ordinal AS next_ordinal,v.fingerprint AS review_fingerprint,v.expires_at,v.envelope,v.state FROM assistant_runs r LEFT JOIN assistant_run_reviews v ON v.id=r.review_id WHERE r.id=$1",
      [id],
    );
    if (!run) return {};
    if (run.envelope && run.state === "pending")
      await assertAssistantAccess(
        { ...c, evidence: run.envelope.evidence },
        db,
      );
    const { rows: steps } = await db.query(
      "SELECT usage,ordinal,completed_at,finalized_at,outcome,response IS NOT NULL AS has_response FROM assistant_run_steps WHERE run_id=$1 ORDER BY ordinal",
      [id],
    );
    const last = steps.at(-1);
    return {
      activity: run.activity,
      round: run.round,
      budget:
        run.envelope?.budget ??
        c.agent_config?.budget ??
        defaultAssistantRunBudget,
      usage: aggregateAssistantUsage(steps),
      nextReview:
        run.state === "pending"
          ? {
              id: run.next_id,
              ordinal: run.next_ordinal,
              expiresAt: run.expires_at,
            }
          : undefined,
      recoveryFingerprint:
        last?.completed_at &&
        last.outcome === "complete" &&
        !last.finalized_at &&
        last.has_response &&
        [run.round, run.round + 1].includes(last.ordinal)
          ? run.review_fingerprint
          : undefined,
      legacyFingerprint: !run.next_id ? c.fingerprint : undefined,
    };
  });
}
