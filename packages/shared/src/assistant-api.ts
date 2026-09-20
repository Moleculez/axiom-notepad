import { z } from "zod";
import { query, transaction } from "./db";
import { HttpError, spaceAccess } from "./access";
import { workspaceJson as json, requireScope } from "./workspace-service";
import {
  assistantLimits,
  assistantInstruction,
  assistantSelectionSchema,
  assistantUserMessage,
  validateAssistantBudget,
  type AssistantMessage,
  type AssistantTurn,
} from "./assistant";
import {
  assistantContext,
  assistantConversation,
  assistantHash,
  assistantProvider,
  assertAssistantAccess,
  captureAssistantEvidence,
  publicAssistantContext,
  assistantMaintenance,
  type AssistantContext,
} from "./assistant-service";
import { assistantProposalApi } from "./assistant-proposals";

export async function assistantApi(
  request: Request,
  path: string[],
  user: string,
): Promise<Response | null> {
  const url = new URL(request.url),
    method = request.method;
  if (path[0] === "spaces" && path[2] === "assistant") {
    const spaceId = z.uuid().parse(path[1]),
      action = path[3];
    const space = await spaceAccess(user, spaceId);
    if (action === "providers" && method === "GET")
      return json(
        await query(
          "SELECT p.id,p.name,p.model,p.version,g.name AS group_name FROM tool_providers p JOIN members m ON m.group_id=p.group_id AND m.user_id=$1 JOIN groups g ON g.id=p.group_id WHERE p.enabled AND 'assistant'=ANY(p.capabilities) AND g.lifecycle_status='active' AND ($2::uuid IS NULL OR p.group_id=$2) ORDER BY p.name",
          [user, space.group_id],
        ),
      );
    if (action === "search" && method === "GET") {
      const q = z
          .string()
          .max(200)
          .parse(url.searchParams.get("q") ?? ""),
        offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(10000)
          .parse(url.searchParams.get("offset") ?? 0);
      const items = await query(
        `SELECT * FROM (
        SELECT r.id,r.name AS title,CASE WHEN n.source_format IN ('markdown','latex','text') THEN 'document' ELSE 'pdf' END AS kind,
        left(coalesce(n.plain_text,r.description,''),220) AS excerpt,n.source_format AS format,r.current_version_id AS version_id,r.updated_at
        FROM resources r LEFT JOIN notes n ON n.id=r.note_id LEFT JOIN attachments a ON a.id=r.current_version_id
        WHERE r.space_id=$1 AND r.deleted_at IS NULL AND (n.source_format IN ('markdown','latex','text') OR a.mime='application/pdf')
        AND (r.name ILIKE '%'||$2||'%' OR n.plain_text ILIKE '%'||$2||'%' OR r.description ILIKE '%'||$2||'%')
        UNION ALL SELECT id,title,'task',left(body,220),NULL,NULL,updated_at FROM tasks WHERE space_id=$1 AND deleted_at IS NULL AND (title ILIKE '%'||$2||'%' OR body ILIKE '%'||$2||'%')
      ) s ORDER BY updated_at DESC,id LIMIT 31 OFFSET $3`,
        [spaceId, q, offset],
      );
      return json({
        items: items.slice(0, 30),
        nextOffset: items.length > 30 ? offset + 30 : null,
      });
    }
    if (action === "conversations") {
      if (method === "GET")
        return json(
          await query(
            "SELECT id,title,version,updated_at FROM assistant_conversations WHERE space_id=$1 AND owner_id=$2 AND deleted_at IS NULL AND updated_at>now()-interval '30 days' ORDER BY updated_at DESC LIMIT 100",
            [spaceId, user],
          ),
        );
      if (method === "POST") {
        const input = z
          .object({
            id: z.uuid(),
            title: z
              .string()
              .trim()
              .min(1)
              .max(120)
              .default("Research conversation"),
          })
          .strict()
          .parse(await request.json());
        await transaction(async (client) => {
          await requireScope(client, user, spaceId);
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            "assistant-previews:" + user,
          ]);
          const {
            rows: [usage],
          } = await client.query(
            "SELECT count(*)::int AS total FROM assistant_conversations WHERE owner_id=$1 AND space_id=$2 AND deleted_at IS NULL AND updated_at>now()-interval '30 days' AND id<>$3",
            [user, spaceId, input.id],
          );
          if (usage.total >= 100)
            throw new HttpError(
              429,
              "Delete an older private conversation before starting another. This workspace retains at most 100 conversations per person.",
            );
          await client.query(
            "INSERT INTO assistant_conversations(id,owner_id,space_id,title) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
            [input.id, user, spaceId, input.title],
          );
        });
        const c = await assistantConversation(input.id, user);
        if (c.space_id !== spaceId)
          throw new HttpError(
            409,
            "This conversation identifier belongs to a different workspace.",
          );
        return json(c, 201);
      }
    }
    if (action === "contexts" && method === "POST") {
      const input = z
        .object({
          conversationId: z.uuid(),
          providerId: z.uuid(),
          providerVersion: z.number().int().positive(),
          prompt: z.string().trim().min(1).max(10000),
          selections: z
            .array(assistantSelectionSchema)
            .max(assistantLimits.items),
          allowTaskCreate: z.boolean().default(false),
        })
        .strict()
        .parse(await request.json());
      const c = await assistantConversation(input.conversationId, user);
      if (c.space_id !== spaceId)
        throw new HttpError(403, "Conversation workspace mismatch.");
      if (input.allowTaskCreate) await spaceAccess(user, spaceId, "edit");
      const p = await assistantProvider(
        user,
        spaceId,
        input.providerId,
        input.providerVersion,
      );
      const history = await query(
        "SELECT x.id,j.status,j.result FROM assistant_contexts x JOIN tool_jobs j ON j.assistant_context_id=x.id WHERE x.conversation_id=$1 ORDER BY x.submitted_at,x.id LIMIT 101",
        [c.id],
      );
      if (history.some((t) => ["queued", "running"].includes(t.status)))
        throw new HttpError(
          409,
          "Wait for or cancel the current response first.",
        );
      if (history.length >= assistantLimits.history)
        throw new HttpError(
          413,
          "Start a new conversation. This one reached its turn limit.",
        );
      const messages: AssistantMessage[] = [
          { role: "system", content: assistantInstruction },
        ],
        historyIds: string[] = [];
      for (const turn of history.filter((t) => t.status === "complete")) {
        const previous = await assistantContext(turn.id, user);
        await assertAssistantAccess(previous);
        historyIds.push(previous.id);
        messages.push(
          {
            role: "user",
            content: assistantUserMessage(
              previous.prompt,
              previous.evidence,
              previous.allow_task_create,
            ),
          },
          { role: "assistant", content: turn.result?.answer ?? "" },
        );
      }
      const { evidence, bases } = await captureAssistantEvidence(
        user,
        spaceId,
        input.selections,
      );
      messages.push({
        role: "user",
        content: assistantUserMessage(
          input.prompt,
          evidence,
          input.allowTaskCreate,
        ),
      });
      try {
        validateAssistantBudget(evidence, messages);
      } catch (e) {
        throw new HttpError(413, (e as Error).message);
      }
      const fingerprint = assistantHash({
        provider: p.id,
        version: p.version,
        messages,
        conversationVersion: c.version,
      });
      const created = await transaction(async (client) => {
        await requireScope(client, user, spaceId);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "assistant-previews:" + user,
        ]);
        const {
          rows: [current],
        } = await client.query(
          "SELECT version FROM assistant_conversations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR SHARE",
          [c.id, user],
        );
        if (!current || current.version !== c.version)
          throw new HttpError(
            409,
            "The conversation changed while preparing context. Prepare a fresh preview.",
          );
        const {
          rows: [usage],
        } = await client.query(
          "SELECT count(*)::int AS total FROM assistant_contexts x JOIN assistant_conversations c ON c.id=x.conversation_id WHERE c.owner_id=$1 AND c.deleted_at IS NULL AND x.submitted_at IS NULL AND x.cleared_at IS NULL AND x.expires_at>now()",
          [user],
        );
        if (usage.total >= 20)
          throw new HttpError(
            429,
            "There are 20 pending context previews. Send a reviewed preview, delete an unused conversation, or wait 15 minutes for previews to expire.",
          );
        const {
          rows: [created],
        } = await client.query(
          "INSERT INTO assistant_contexts(conversation_id,provider_id,provider_version,prompt,evidence,bases,messages,history_ids,allow_task_create,fingerprint,conversation_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",
          [
            c.id,
            p.id,
            p.version,
            input.prompt,
            JSON.stringify(evidence),
            JSON.stringify(bases),
            JSON.stringify(messages),
            historyIds,
            input.allowTaskCreate,
            fingerprint,
            c.version,
          ],
        );
        const captured = await assistantContext(created.id, user, client);
        await assertAssistantAccess(captured, client);
        return created;
      });
      const context = await assistantContext(created.id, user);
      await assertAssistantAccess(context);
      return json(publicAssistantContext(context, p), 201);
    }
    throw new HttpError(405, "Unsupported assistant action.");
  }
  if (path[0] !== "assistant") return null;
  if (path[1] === "proposals") return assistantProposalApi(request, path, user);
  if (path[1] !== "conversations")
    throw new HttpError(404, "Assistant endpoint unavailable.");
  const id = z.uuid().parse(path[2]),
    action = path[3],
    c = await assistantConversation(id, user);
  if (!action && method === "PATCH") {
    const input = z
      .object({
        title: z.string().trim().min(1).max(120),
        version: z.number().int().positive(),
      })
      .strict()
      .parse(await request.json());
    const rows = await query(
      "UPDATE assistant_conversations SET title=$3,version=version+1,updated_at=now() WHERE id=$1 AND owner_id=$2 AND version=$4 RETURNING id,version,title",
      [id, user, input.title, input.version],
    );
    if (!rows.length)
      throw new HttpError(
        409,
        "The conversation changed. Refresh before renaming.",
      );
    return json(rows[0]);
  }
  if (!action && method === "DELETE") {
    await query(
      "UPDATE assistant_conversations SET deleted_at=now(),title='Deleted conversation',version=version+1 WHERE id=$1 AND owner_id=$2",
      [id, user],
    );
    await assistantMaintenance();
    return json({ ok: true });
  }
  if ((!action || action === "export") && method === "GET") {
    const jobs = await query(
      "SELECT j.id,j.status,j.result,j.error,j.created_at,j.assistant_context_id FROM tool_jobs j JOIN assistant_contexts x ON x.id=j.assistant_context_id WHERE x.conversation_id=$1 ORDER BY j.created_at,j.id LIMIT 100",
      [id],
    );
    const turns: AssistantTurn[] = [];
    const contextIds = jobs.map((j) => j.assistant_context_id);
    const contexts = new Map(
      (
        await query<AssistantContext>(
          "SELECT x.*,c.owner_id,c.space_id FROM assistant_contexts x JOIN assistant_conversations c ON c.id=x.conversation_id WHERE x.id=ANY($1::uuid[]) AND c.owner_id=$2 AND c.deleted_at IS NULL AND x.cleared_at IS NULL AND x.created_at>now()-interval '30 days'",
          [contextIds, user],
        )
      ).map((x) => [x.id, x]),
    );
    // Normal polling validates the union once instead of repeating every earlier
    // source for every turn. On revocation, fall back to per-turn checks so only
    // affected turns and their descendants are withheld.
    const authorized = new Set<string>();
    const latest = contexts.get(contextIds.at(-1));
    if (latest && contexts.size === contextIds.length) {
      try {
        await assertAssistantAccess({
          ...latest,
          history_ids: [
            ...new Set([
              ...contextIds.filter((id) => id !== latest.id),
              ...[...contexts.values()].flatMap((x) => x.history_ids),
            ]),
          ].filter((id) => id !== latest.id),
        });
        contextIds.forEach((id) => authorized.add(id));
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
      }
    }
    for (const j of jobs) {
      try {
        const x = contexts.get(j.assistant_context_id);
        if (!x)
          throw new HttpError(
            403,
            "Private context expired or is unavailable.",
          );
        if (!authorized.has(x.id)) await assertAssistantAccess(x);
        const historyEvidence = [];
        for (const oldId of x.history_ids) {
          const previous = contexts.get(oldId);
          if (!previous)
            throw new HttpError(
              403,
              "Earlier evidence expired or is unavailable.",
            );
          historyEvidence.push(...previous.evidence);
        }
        const proposals = await query<
          NonNullable<AssistantTurn["proposals"]>[number]
        >(
          "SELECT p.id,p.data,CASE WHEN s.id IS NOT NULL THEN 'published' ELSE p.state END AS state,r.id AS receipt,r.result FROM assistant_proposals p LEFT JOIN assistant_receipts r ON r.proposal_id=p.id AND r.applied_at IS NOT NULL LEFT JOIN revision_suggestions s ON s.id=p.id WHERE p.job_id=$1 ORDER BY p.created_at,p.id",
          [j.id],
        );
        turns.push({
          id: j.id,
          status: j.status,
          prompt: x.prompt,
          answer: j.result?.answer,
          warning: j.result?.warning,
          error: j.error,
          created_at: j.created_at,
          evidence: [...historyEvidence, ...x.evidence],
          proposals,
        });
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        await query(
          "UPDATE tool_jobs SET status='cancelled',input='{}' WHERE id=$1 AND status IN ('queued','running')",
          [j.id],
        );
        turns.push({
          id: j.id,
          status: "unavailable",
          created_at: j.created_at,
          unavailable: true,
          error:
            "Source access changed or context expired. This turn is withheld.",
        });
      }
    }
    if (action === "export") {
      if (turns.some((t) => t.unavailable))
        throw new HttpError(
          403,
          "Export is unavailable because a source expired or access changed.",
        );
      return json({
        title: c.title,
        markdown: [
          `# ${c.title}`,
          "Private AI-assisted research — verify claims against the sources.",
          ...turns.flatMap((t) => [
            `## Request\n\n${t.prompt}`,
            `## Answer\n\n${t.answer ?? t.status}`,
            ...(t.evidence ?? []).map(
              (e) =>
                `### ${e.key} · ${e.title}${e.page ? ` · p. ${e.page}` : ""}\n\nCaptured ${e.capturedAt}\n\n${e.source}`,
            ),
          ]),
        ].join("\n\n"),
      });
    }
    return json({
      id: c.id,
      title: c.title,
      version: c.version,
      spaceId: c.space_id,
      turns,
    });
  }
  if (action === "turns" && !path[4] && method === "POST") {
    const input = z
      .object({
        contextId: z.uuid(),
        fingerprint: z.string().length(64),
        consent: z.literal(true),
        mutationId: z.uuid(),
      })
      .strict()
      .parse(await request.json());
    const x = await assistantContext(input.contextId, user);
    if (x.conversation_id !== id || input.fingerprint !== x.fingerprint)
      throw new HttpError(409, "Consent does not match the prepared request.");
    return json(
      await transaction(async (client) => {
        await requireScope(client, user, c.space_id);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "tool-queue:" + user,
        ]);
        const {
          rows: [existing],
        } = await client.query(
          "SELECT id,status,assistant_context_id FROM tool_jobs WHERE id=$1",
          [input.mutationId],
        );
        if (existing) {
          if (existing.assistant_context_id !== x.id)
            throw new HttpError(
              409,
              "Retry identifier belongs to another request.",
            );
          await assertAssistantAccess(x, client);
          return { id: existing.id, status: existing.status };
        }
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          x.provider_id,
        ]);
        const {
          rows: [current],
        } = await client.query(
          "SELECT * FROM assistant_conversations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
          [id, user],
        );
        const {
          rows: [captured],
        } = await client.query(
          "SELECT * FROM assistant_contexts WHERE id=$1 FOR UPDATE",
          [x.id],
        );
        if (
          !current ||
          current.version !== x.conversation_version ||
          captured.submitted_at ||
          captured.cleared_at ||
          new Date(x.expires_at).valueOf() <= Date.now()
        )
          throw new HttpError(
            409,
            "This preview expired or the conversation changed. Review a fresh preview.",
          );
        await assertAssistantAccess(x, client);
        const provider = await assistantProvider(
          user,
          c.space_id,
          x.provider_id,
          x.provider_version,
          client,
        );
        const {
          rows: [usage],
        } = await client.query(
          "SELECT count(*) FILTER(WHERE owner_id=$1 AND status IN ('queued','running'))::int AS pending,count(*) FILTER(WHERE provider_id=$2 AND created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))::int AS used FROM tool_jobs",
          [user, provider.id],
        );
        if (usage.pending >= 5 || usage.used >= provider.daily_limit)
          throw new HttpError(
            429,
            "The account pending-request or provider daily limit has been reached.",
          );
        const { rowCount } = await client.query(
          "SELECT 1 FROM tool_jobs j JOIN assistant_contexts x ON x.id=j.assistant_context_id WHERE x.conversation_id=$1 AND j.status IN ('queued','running')",
          [id],
        );
        if (rowCount)
          throw new HttpError(
            409,
            "This conversation already has a pending response.",
          );
        await client.query(
          "INSERT INTO tool_jobs(id,owner_id,provider_id,kind,assistant_context_id) VALUES($1,$2,$3,'assistant',$4)",
          [input.mutationId, user, provider.id, x.id],
        );
        await client.query(
          "UPDATE assistant_contexts SET submitted_at=now() WHERE id=$1",
          [x.id],
        );
        await client.query(
          "UPDATE assistant_conversations SET version=version+1,updated_at=now() WHERE id=$1",
          [id],
        );
        return { id: input.mutationId, status: "queued" };
      }),
      202,
    );
  }
  if (action === "turns" && path[5] === "cancel" && method === "POST") {
    const jobId = z.uuid().parse(path[4]);
    await query(
      "UPDATE tool_jobs j SET status='cancelled',input='{}',updated_at=now() FROM assistant_contexts x WHERE j.id=$1 AND j.owner_id=$2 AND j.assistant_context_id=x.id AND x.conversation_id=$3 AND j.status IN ('queued','running')",
      [jobId, user, id],
    );
    return json({
      ok: true,
      message:
        "Cancellation requested. The provider may already have received the reviewed material.",
    });
  }
  throw new HttpError(405, "Unsupported assistant operation.");
}
