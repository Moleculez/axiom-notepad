import { z } from "zod";
import { query, transaction } from "./db";
import { memberAccess, resourceAccess, HttpError } from "./access";
import {
  workspaceJson as json,
  requireScope,
  assertGroupActive,
  recordActivity,
} from "./workspace-service";
import {
  providerEndpoint,
  sealCredential,
  providerKey,
  callMathProvider,
} from "./tool-providers";
const uuid = z.uuid();
const publicFields =
  "id,group_id,name,kind,endpoint,model,capabilities,enabled,daily_limit,version";
export async function toolServicesApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action, providerId] = path,
    method = request.method,
    url = new URL(request.url);
  if (endpoint === "group-admin" && id && action === "providers") {
    const actor = await memberAccess(userId, uuid.parse(id));
    if (!["owner", "admin"].includes(actor.role))
      throw new HttpError(
        403,
        "Only group administrators can configure providers.",
      );
    if (method === "GET") {
      let configured = true;
      try {
        providerKey();
      } catch {
        configured = false;
      }
      return json({
        configured,
        providers: await query(
          `SELECT ${publicFields},(SELECT count(*)::int FROM tool_jobs j WHERE j.provider_id=p.id AND j.created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS used_today FROM tool_providers p WHERE group_id=$1 ORDER BY created_at`,
          [id],
        ),
      });
    }
    if (providerId && path[4] === "test" && method === "POST") {
      const [provider] = await query(
        "SELECT * FROM tool_providers WHERE id=$1 AND group_id=$2",
        [uuid.parse(providerId), id],
      );
      if (!provider) throw new HttpError(404, "Provider unavailable.");
      await callMathProvider(
        {
          kind: provider.kind,
          endpoint: provider.endpoint,
          model: provider.model,
          credential: provider.credential,
        },
        {
          kind: "generate",
          source: "",
          prompt: "Reply with OK. This is an administrator connection test.",
        },
        AbortSignal.timeout(30000),
      );
      return json({ ok: true });
    }
    if (method === "POST" || method === "PATCH") {
      const input = z
        .object({
          name: z.string().trim().min(1).max(100),
          kind: z.enum(["private", "openrouter"]),
          endpoint: z.string().max(500),
          model: z.string().trim().min(1).max(160),
          credential: z.string().max(2000).optional(),
          capabilities: z
            .array(z.enum(["math", "ocr"]))
            .min(1)
            .max(2),
          enabled: z.boolean(),
          dailyLimit: z.number().int().min(1).max(10000),
          version: z.number().int().positive().optional(),
        })
        .parse(await request.json());
      const target = providerEndpoint(input.kind, input.endpoint).toString();
      const result = await transaction(async (client) => {
        await client.query(
          "SELECT id FROM groups WHERE id=$1 FOR NO KEY UPDATE",
          [id],
        );
        await assertGroupActive(client, id);
        const {
          rows: [member],
        } = await client.query(
          "SELECT role FROM members WHERE group_id=$1 AND user_id=$2",
          [id, userId],
        );
        if (!["owner", "admin"].includes(member?.role))
          throw new HttpError(403, "Administration access changed.");
        if (providerId) {
          const {
            rows: [old],
          } = await client.query(
            "SELECT * FROM tool_providers WHERE id=$1 AND group_id=$2 FOR UPDATE",
            [uuid.parse(providerId), id],
          );
          if (!old || old.version !== input.version)
            throw new HttpError(
              409,
              "Provider configuration changed. Reload before saving.",
            );
          const credential = input.credential
            ? sealCredential(input.credential)
            : old.credential;
          await client.query(
            "UPDATE tool_providers SET name=$2,kind=$3,endpoint=$4,model=$5,credential=$6,capabilities=$7,enabled=$8,daily_limit=$9,version=version+1 WHERE id=$1",
            [
              providerId,
              input.name,
              input.kind,
              target,
              input.model,
              credential,
              input.capabilities,
              input.enabled,
              input.dailyLimit,
            ],
          );
        } else {
          if (!input.credential)
            throw new HttpError(400, "Enter a provider credential.");
          await client.query(
            "INSERT INTO tool_providers(group_id,name,kind,endpoint,model,credential,capabilities,enabled,daily_limit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              id,
              input.name,
              input.kind,
              target,
              input.model,
              sealCredential(input.credential),
              input.capabilities,
              input.enabled,
              input.dailyLimit,
            ],
          );
        }
        const {
          rows: [space],
        } = await client.query(
          "SELECT id FROM spaces WHERE group_id=$1 AND kind='team'",
          [id],
        );
        await recordActivity(client, {
          spaceId: space.id,
          userId,
          kind: "settings",
          title: "Updated research tool provider configuration",
        });
        return { ok: true };
      });
      return json(result);
    }
  }
  if (endpoint === "tool-providers" && method === "GET") {
    const { space } = await resourceAccess(
      userId,
      uuid.parse(url.searchParams.get("resource")),
    );
    return json(
      await query(
        `SELECT ${publicFields} FROM tool_providers p WHERE enabled AND ($2::uuid IS NULL OR p.group_id=$2) AND EXISTS(SELECT 1 FROM members m WHERE m.group_id=p.group_id AND m.user_id=$1) ORDER BY name`,
        [userId, space.group_id],
      ),
    );
  }
  if (endpoint === "tool-jobs") {
    if (!id && method === "GET") {
      const resourceId = uuid.parse(url.searchParams.get("resource"));
      await resourceAccess(userId, resourceId);
      return json(
        await query(
          "SELECT id,kind,status,result,error,created_at,updated_at,provider_id FROM tool_jobs WHERE resource_id=$1 AND owner_id=$2 ORDER BY created_at DESC LIMIT 50",
          [resourceId, userId],
        ),
      );
    }
    if (!id && method === "POST") {
      const input = z
        .object({
          resourceId: uuid,
          providerId: uuid,
          kind: z.enum(["ocr", "generate", "check", "explain"]),
          source: z.string().max(30000),
          prompt: z.string().max(10000),
          image: z.string().max(12_000_000).optional(),
          consent: z.literal(true),
        })
        .parse(await request.json());
      const { resource, space } = await resourceAccess(
        userId,
        input.resourceId,
        "edit",
      );
      if (input.kind === "ocr" && !input.image)
        throw new HttpError(400, "Choose or paste an image to transcribe.");
      if (
        input.image &&
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
          input.image,
        )
      )
        throw new HttpError(400, "Use a PNG, JPEG or WebP image.");
      return json(
        await transaction(async (client) => {
          await requireScope(client, userId, resource.space_id, "edit");
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            "tool-queue:" + userId,
          ]);
          const {
            rows: [pending],
          } = await client.query(
            "SELECT count(*)::int AS count FROM tool_jobs WHERE owner_id=$1 AND status IN ('queued','running')",
            [userId],
          );
          if (pending.count >= 5)
            throw new HttpError(
              429,
              "Wait for or cancel a pending request before submitting another. At most five requests can be pending per account.",
            );
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            input.providerId,
          ]);
          const {
            rows: [provider],
          } = await client.query(
            "SELECT p.* FROM tool_providers p JOIN members m ON m.group_id=p.group_id AND m.user_id=$2 WHERE p.id=$1 AND p.enabled AND ($3::uuid IS NULL OR p.group_id=$3) FOR SHARE OF p",
            [input.providerId, userId, space.group_id],
          );
          if (
            !provider ||
            !provider.capabilities.includes(
              input.kind === "ocr" ? "ocr" : "math",
            )
          )
            throw new HttpError(
              403,
              "This provider is unavailable for the requested operation.",
            );
          const {
            rows: [usage],
          } = await client.query(
            "SELECT count(*)::int AS count FROM tool_jobs WHERE provider_id=$1 AND created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')",
            [input.providerId],
          );
          if (usage.count >= provider.daily_limit)
            throw new HttpError(
              429,
              "This provider's daily request limit has been reached.",
            );
          return (
            await client.query(
              "INSERT INTO tool_jobs(resource_id,owner_id,provider_id,kind,input) VALUES($1,$2,$3,$4,$5) RETURNING id,kind,status,created_at",
              [
                input.resourceId,
                userId,
                input.providerId,
                input.kind,
                JSON.stringify({
                  source: input.source,
                  prompt: input.prompt,
                  image: input.image,
                }),
              ],
            )
          ).rows[0];
        }),
        202,
      );
    }
    if (id) {
      const [job] = await query(
        "SELECT * FROM tool_jobs WHERE id=$1 AND owner_id=$2",
        [uuid.parse(id), userId],
      );
      if (!job) throw new HttpError(404, "Job unavailable.");
      if (job.resource_id) await resourceAccess(userId, job.resource_id);
      if (method === "GET")
        return json({
          id: job.id,
          kind: job.kind,
          status: job.status,
          result: job.result,
          error: job.error,
          created_at: job.created_at,
        });
      if (action === "cancel" && method === "POST") {
        await query(
          "UPDATE tool_jobs SET status='cancelled',input='{}',updated_at=now() WHERE id=$1 AND status IN ('queued','running')",
          [id],
        );
        return json({
          ok: true,
          message:
            "Cancellation requested. An external provider may already have received the submitted material.",
        });
      }
    }
  }
  return null;
}
