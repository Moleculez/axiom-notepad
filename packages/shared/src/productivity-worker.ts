import { z } from "zod";
import { query, transaction } from "./db";
import { HttpError } from "./access";
import {
  assistantContext,
  assistantProvider,
  assertAssistantAccess,
  type AssistantContext,
} from "./assistant-service";
import { callAssistantProvider } from "./tool-providers";
import { validateAssistantBudget, type AssistantMessage } from "./assistant";
import {
  agentResponseSchema,
  orderedActions,
  productivityLimits,
  productivityWrites,
  type ChangeAction,
} from "./productivity";
import { createChangeSet } from "./workspace-change-sets";
import { readAssistantEvidence } from "./assistant-evidence-service";
import {
  assistantAllEvidence,
  storeAssistantReview,
  lockAssistantRunContext,
  assertAssistantReviewSnapshot,
  type AssistantReviewRow,
} from "./assistant-run-review";
import {
  assistantGroundingReport,
  invalidActionEvidence,
  type AssistantReviewResult,
} from "./assistant-grounding";

/** One provider dispatch per explicit, immutable review. Never loop automatically. */
export async function executeProductivityRound(
  job: Record<string, any>,
  signal: AbortSignal,
  submitted: () => void,
) {
  const c = await assistantContext(job.assistant_context_id, job.owner_id);
  if (!c.agent_config) throw new Error("Productivity consent is missing.");
  const [run] = await query("SELECT * FROM assistant_runs WHERE id=$1", [
    job.id,
  ]);
  if (!run) throw new Error("Assistant run unavailable.");
  if (job.input?.recoverConfirmed) {
    const [step] = await query(
      "SELECT * FROM assistant_run_steps WHERE run_id=$1 ORDER BY ordinal DESC LIMIT 1",
      [job.id],
    );
    if (
      !step?.completed_at ||
      step.outcome !== "complete" ||
      step.finalized_at ||
      !step.response?.text ||
      ![run.round, run.round + 1].includes(step.ordinal)
    )
      throw new HttpError(
        409,
        "No confirmed unfinished response is available. Uncertain requests are never retried.",
      );
    const [savedReview] = await query<AssistantReviewRow>(
      "SELECT * FROM assistant_run_reviews WHERE id=$1",
      [step.review_id],
    );
    if (!savedReview)
      throw new HttpError(409, "The captured review was removed.");
    assertAssistantReviewSnapshot(savedReview);
    await assertAssistantAccess({
      ...c,
      evidence: savedReview.envelope.evidence,
    });
    if (run.round === step.ordinal)
      return publishProductivityDraft(
        job,
        c,
        run.actions,
        job.result,
        step.ordinal,
        signal,
      );
    return finishProductivityResponse(
      job,
      c,
      run,
      savedReview,
      step.response.text,
      signal,
    );
  }
  const [review] = run.review_id
    ? await query<AssistantReviewRow>(
        "SELECT * FROM assistant_run_reviews WHERE id=$1",
        [run.review_id],
      )
    : [];
  if (
    !review ||
    review.state !== "approved" ||
    new Date(review.expires_at).valueOf() <= Date.now()
  ) {
    await query(
      "UPDATE tool_jobs SET status='awaiting-review',lease_until=NULL,error='Refresh and approve the exact outgoing context before continuing.',updated_at=now() WHERE id=$1 AND status='running'",
      [job.id],
    );
    return;
  }
  const ordinal = run.round + 1,
    budget = review.envelope.budget;
  assertAssistantReviewSnapshot(review);
  if (review.ordinal !== ordinal || ordinal > budget.maxRounds)
    throw new HttpError(
      409,
      "The reviewed round changed or its limit was reached.",
    );
  const captured = { ...c, evidence: review.envelope.evidence };
  const messages = review.envelope.messages;
  validateAssistantBudget(captured.evidence, messages);
  const provider = await assistantProvider(
    c.owner_id,
    c.space_id,
    c.provider_id,
    review.envelope.provider.version,
  );
  await transaction(async (db) => {
    await lockAssistantRunContext(db, c);
    const {
      rows: [state],
    } = await db.query(
      "SELECT j.status,r.review_id,r.round FROM tool_jobs j JOIN assistant_runs r ON r.id=j.id WHERE j.id=$1 FOR UPDATE OF j,r",
      [job.id],
    );
    if (
      state?.status !== "running" ||
      state.review_id !== review.id ||
      state.round !== run.round ||
      signal.aborted
    )
      throw new HttpError(
        409,
        "Run cancelled or review changed before dispatch.",
      );
    await assertAssistantAccess(captured, db);
    await assistantProvider(
      c.owner_id,
      c.space_id,
      c.provider_id,
      review.envelope.provider.version,
      db,
    );
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      c.provider_id,
    ]);
    const {
      rows: [usage],
    } = await db.query(
      "SELECT (SELECT count(*) FROM tool_jobs WHERE provider_id=$1 AND created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))+(SELECT count(*) FROM assistant_run_steps WHERE provider_id=$1 AND ordinal>1 AND dispatched_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS used",
      [c.provider_id],
    );
    if (ordinal > 1 && Number(usage.used) >= provider.daily_limit)
      throw new HttpError(
        429,
        "Provider daily request limit reached; completed drafts were retained.",
      );
    if (new Date(review.expires_at).valueOf() <= Date.now())
      throw new HttpError(
        409,
        "The approved review expired before dispatch. No request was sent.",
      );
    await db.query(
      "INSERT INTO assistant_run_steps(run_id,ordinal,provider_id,review_id,request_characters) VALUES($1,$2,$3,$4,$5)",
      [
        job.id,
        ordinal,
        c.provider_id,
        review.id,
        messages.reduce((n, m) => n + m.content.length, 0),
      ],
    );
    // Retain authorization dependencies even if a dispatched request is uncertain.
    // The approved outgoing messages themselves are never recomputed.
    await db.query("UPDATE assistant_contexts SET evidence=$2 WHERE id=$1", [
      c.id,
      JSON.stringify(captured.evidence),
    ]);
  });
  if (signal.aborted)
    throw new HttpError(409, "Run cancelled before submission.");
  submitted();
  const response = await callAssistantProvider(
    provider as Parameters<typeof callAssistantProvider>[0],
    messages,
    signal,
    { maxOutputTokens: budget.maxOutputTokens },
  );
  const recorded = await transaction(async (db) => {
    await lockAssistantRunContext(db, c);
    const {
      rows: [state],
    } = await db.query("SELECT status FROM tool_jobs WHERE id=$1 FOR UPDATE", [
      job.id,
    ]);
    if (signal.aborted || state?.status !== "running") return false;
    await assertAssistantAccess(captured, db);
    if (signal.aborted) return false;
    await db.query(
      "UPDATE assistant_run_steps SET usage=$3,response=$4,completed_at=now(),outcome='complete' WHERE run_id=$1 AND ordinal=$2",
      [
        job.id,
        ordinal,
        JSON.stringify(response.usage),
        JSON.stringify({ text: response.text }),
      ],
    );
    return true;
  });
  if (!recorded) return;
  return finishProductivityResponse(job, c, run, review, response.text, signal);
}

/** Replay only confirmed local processing, never a provider dispatch. */
async function finishProductivityResponse(
  job: Record<string, any>,
  c: AssistantContext,
  run: Record<string, any>,
  review: AssistantReviewRow,
  text: string,
  signal: AbortSignal,
) {
  if (!c.agent_config)
    throw new HttpError(409, "Productivity consent is missing.");
  const ordinal = review.ordinal,
    budget = review.envelope.budget;
  const captured = { ...c, evidence: review.envelope.evidence },
    messages = review.envelope.messages;
  let output: z.infer<typeof agentResponseSchema> | undefined;
  try {
    output = agentResponseSchema.parse(
      JSON.parse(
        text
          .replace(/^\s*\`\`\`(?:json)?\s*\n/, "")
          .replace(/\n\`\`\`\s*$/, ""),
      ),
    );
  } catch {
    /* Inert fallback. */
  }
  const allEvidence = await assistantAllEvidence(captured);
  const answer = output?.answer || text;
  const grounding = assistantGroundingReport(answer, allEvidence);
  const activity = [
    ...run.activity,
    {
      kind: "draft",
      message: "Completed model round " + ordinal,
      at: new Date().toISOString(),
    },
  ];
  const actions: ChangeAction[] = [...run.actions];
  const results: AssistantReviewResult[] = [];
  const prefix: AssistantMessage[] = [
    ...messages,
    { role: "assistant", content: text },
  ];
  let warning = "",
    more = false;
  if (!output)
    warning =
      "Invalid structured output. This response has no executable actions.";
  else {
    const invalid = output.actions.some(
      (a) =>
        invalidActionEvidence(a, allEvidence).length ||
        !(productivityWrites as readonly string[]).includes(a.action),
    );
    if (
      invalid ||
      grounding.unknownKeys.length ||
      (c.agent_config.mode === "ask" && output.actions.length)
    ) {
      warning =
        "Unapproved actions or unknown source references were returned. Actions from this response are inert; verify the answer.";
    } else {
      try {
        const candidate = [...actions, ...output.actions];
        if (candidate.length > productivityLimits.actions)
          throw new Error(
            "Split this plan into batches of at most 50 actions.",
          );
        orderedActions(candidate);
        actions.push(...output.actions);
      } catch (e) {
        warning =
          (e as Error).message + " No actions from this response were added.";
      }
    }
    more = !output.done && ordinal < budget.maxRounds;
    if (!output.done && !more)
      warning +=
        " The reviewed round limit was reached. Available drafts were retained.";
    if (more && output.reads.length && !c.agent_config.discover) {
      warning +=
        " Additional reading was not authorized; nothing was retrieved.";
      more = false;
    }
    if (more)
      for (const read of output.reads) {
        if (signal.aborted) return;
        try {
          const result = await readAssistantEvidence(
            c.owner_id,
            c.space_ids ?? [c.space_id],
            read,
          );
          results.push({ request: read, result: result.output });
          activity.push({
            kind: "read",
            message:
              read.kind === "search"
                ? "Local search: " + read.query
                : "Captured locally: " +
                  (result.evidence?.title ?? "empty source"),
            evidenceKey: result.evidence?.key,
            at: new Date().toISOString(),
          });
        } catch (e) {
          results.push({
            request: read,
            result: {
              error:
                e instanceof HttpError
                  ? e.message
                  : "Evidence could not be captured. Review a narrower selection.",
            },
          });
          warning += " Some local evidence could not be captured.";
        }
      }
    if (more) {
      const added = results.flatMap((r) =>
        "key" in r.result
          ? [r.result as import("./assistant").AssistantEvidence]
          : [],
      );
      const nextMessages: AssistantMessage[] = [...prefix];
      if (results.length)
        nextMessages.push({
          role: "user",
          content: JSON.stringify({
            toolResults: results,
            previousDraftKeys: actions.map((a) => a.key),
            roundsRemaining: budget.maxRounds - ordinal,
          }),
        });
      try {
        validateAssistantBudget([...captured.evidence, ...added], nextMessages);
      } catch (e) {
        more = false;
        warning +=
          " " + (e as Error).message + " No additional context was sent.";
      }
    }
  }
  let publish = false;
  await transaction(async (db) => {
    await lockAssistantRunContext(db, c);
    const {
      rows: [state],
    } = await db.query("SELECT status FROM tool_jobs WHERE id=$1 FOR UPDATE", [
      job.id,
    ]);
    if (signal.aborted || state?.status !== "running") return;
    await assertAssistantAccess(captured, db);
    if (signal.aborted) return;
    await db.query(
      "UPDATE assistant_runs SET round=$2,messages=$3,actions=$4,activity=$5 WHERE id=$1",
      [
        job.id,
        ordinal,
        JSON.stringify(prefix.slice(c.messages.length)),
        JSON.stringify(actions),
        JSON.stringify(activity),
      ],
    );
    await db.query(
      "UPDATE tool_jobs SET result=$2,updated_at=now() WHERE id=$1",
      [job.id, JSON.stringify({ answer, warning, grounding })],
    );
    if (more) {
      await storeAssistantReview(
        db,
        captured,
        job.id,
        ordinal + 1,
        prefix,
        results,
        budget,
        { actionKeys: actions.map((a) => a.key) },
      );
      await db.query(
        "UPDATE assistant_run_steps SET finalized_at=now() WHERE run_id=$1 AND ordinal=$2",
        [job.id, ordinal],
      );
      await db.query(
        "UPDATE tool_jobs SET status='awaiting-review',lease_until=NULL,updated_at=now() WHERE id=$1",
        [job.id],
      );
    } else publish = true;
  });
  if (!publish) return;
  return publishProductivityDraft(
    job,
    c,
    actions,
    { answer, warning, grounding },
    ordinal,
    signal,
  );
}

async function publishProductivityDraft(
  job: Record<string, any>,
  c: AssistantContext,
  actions: ChangeAction[],
  result: Record<string, unknown>,
  ordinal: number,
  signal: AbortSignal,
) {
  if (signal.aborted) return;
  let changeSetId: string | undefined;
  if (actions.length) {
    const set = await createChangeSet(
      { userId: c.owner_id, spaceIds: c.space_ids ?? [c.space_id] },
      {
        mutationId: job.id,
        title: c.prompt.replace(/\s+/g, " ").slice(0, 160),
        spaceIds: c.space_ids ?? [c.space_id],
        actions,
      },
      c.id,
      job.id,
    );
    changeSetId = set.id;
  }
  await transaction(async (db) => {
    await lockAssistantRunContext(db, c);
    const {
      rows: [state],
    } = await db.query("SELECT status FROM tool_jobs WHERE id=$1 FOR UPDATE", [
      job.id,
    ]);
    if (state?.status !== "running" || signal.aborted) {
      if (changeSetId)
        await db.query(
          "DELETE FROM workspace_change_sets WHERE id=$1 AND status='draft'",
          [changeSetId],
        );
      return;
    }
    await assertAssistantAccess(
      await assistantContext(c.id, c.owner_id, db),
      db,
    );
    if (signal.aborted) {
      if (changeSetId)
        await db.query(
          "DELETE FROM workspace_change_sets WHERE id=$1 AND status='draft'",
          [changeSetId],
        );
      return;
    }
    await db.query(
      "UPDATE assistant_run_steps SET finalized_at=now() WHERE run_id=$1 AND ordinal=$2",
      [job.id, ordinal],
    );
    await db.query(
      "UPDATE tool_jobs SET status='complete',result=$2,input='{}',updated_at=now() WHERE id=$1",
      [job.id, JSON.stringify({ ...result, changeSetId })],
    );
  });
}
