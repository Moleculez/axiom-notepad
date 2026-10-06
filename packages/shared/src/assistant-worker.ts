import { query, transaction } from "./db";
import {
  assistantContext,
  assistantProvider,
  assertAssistantAccess,
} from "./assistant-service";
import { parseAssistantResponse } from "./assistant";
import { callAssistantProvider } from "./tool-providers";
import { executeProductivityRound } from "./productivity-worker";
import {
  assistantAllEvidence,
  lockAssistantRunContext,
} from "./assistant-run-review";
import {
  assistantGroundingReport,
  invalidActionEvidence,
  aggregateAssistantUsage,
} from "./assistant-grounding";

/** The outer tool worker owns the durable lease, cancellation and deadline. */
export async function executeAssistantJob(
  job: Record<string, any>,
  signal: AbortSignal,
  submitted: () => void,
) {
  const context = await assistantContext(
    job.assistant_context_id,
    job.owner_id,
  );
  if (context.agent_config)
    return executeProductivityRound(job, signal, submitted);
  await assertAssistantAccess(context);
  const p = await assistantProvider(
    job.owner_id,
    context.space_id,
    context.provider_id,
    context.provider_version,
  );
  if (signal.aborted) throw new Error("Request cancelled before submission.");
  submitted();
  const response = await callAssistantProvider(
    p as Parameters<typeof callAssistantProvider>[0],
    context.messages,
    signal,
  );
  const output = parseAssistantResponse(
    response.text,
    context.evidence,
    context.allow_task_create,
  );
  const evidence = await assistantAllEvidence(context);
  const grounding = assistantGroundingReport(output.answer, evidence);
  if (
    grounding.unknownKeys.length ||
    output.proposals.some((p) => invalidActionEvidence(p, evidence).length)
  ) {
    output.proposals = [];
    output.warning =
      "Unknown source references were returned. Proposed actions are inert; verify the answer.";
  }
  await transaction(async (client) => {
    await lockAssistantRunContext(client, context);
    await assertAssistantAccess(context, client);
    await assistantProvider(
      job.owner_id,
      context.space_id,
      context.provider_id,
      context.provider_version,
      client,
    );
    const {
      rows: [current],
    } = await client.query(
      "SELECT status FROM tool_jobs WHERE id=$1 FOR UPDATE",
      [job.id],
    );
    const {
      rows: [captured],
    } = await client.query(
      "SELECT cleared_at FROM assistant_contexts WHERE id=$1",
      [context.id],
    );
    const {
      rows: [conversation],
    } = await client.query(
      "SELECT deleted_at FROM assistant_conversations WHERE id=$1",
      [context.conversation_id],
    );
    if (
      signal.aborted ||
      current?.status !== "running" ||
      !captured ||
      captured.cleared_at ||
      !conversation ||
      conversation.deleted_at
    )
      return;
    for (const proposal of output.proposals)
      await client.query(
        "INSERT INTO assistant_proposals(job_id,data) VALUES($1,$2)",
        [job.id, JSON.stringify(proposal)],
      );
    await client.query(
      "UPDATE tool_jobs SET status='complete',result=$2,input='{}',updated_at=now() WHERE id=$1",
      [
        job.id,
        JSON.stringify({
          answer: output.answer,
          warning: output.warning,
          usage: response.usage,
          runUsage: aggregateAssistantUsage([{ usage: response.usage }]),
          grounding,
        }),
      ],
    );
  });
}

export async function assistantJobStillAuthorized(job: Record<string, any>) {
  if (job.kind !== "assistant") return;
  const c = await assistantContext(job.assistant_context_id, job.owner_id);
  await assertAssistantAccess(c);
  // Local recovery has no provider dispatch and may finish after its configuration changes.
  if (job.input?.recoverConfirmed) return;
  const [review] = c.agent_config
    ? await query(
        "SELECT v.envelope FROM assistant_runs r JOIN assistant_run_reviews v ON v.id=r.review_id WHERE r.id=$1",
        [job.id],
      )
    : [];
  await assistantProvider(
    job.owner_id,
    c.space_id,
    c.provider_id,
    review?.envelope.provider.version ?? c.provider_version,
  );
  const [conversation] = await query(
    "SELECT deleted_at FROM assistant_conversations WHERE id=$1",
    [c.conversation_id],
  );
  if (!conversation || conversation.deleted_at)
    throw new Error("Conversation unavailable.");
}
