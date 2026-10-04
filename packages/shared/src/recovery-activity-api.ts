import { query } from "./db";
import { HttpError } from "./access";
import { pluginsEnabled } from "./plugin-security";
import type { RecoveryActivityItem } from "./recovery-activity";

/** Adapters over authoritative job tables, never another queue or executor.
 * Only bounded metadata; no source, prompts, provider keys or raw results. */
export async function recoveryActivityApi(
  request: Request,
  path: string[],
  user: string,
) {
  if (path[0] !== "recovery-activity" || path.length !== 1) return null;
  if (request.method !== "GET")
    throw new HttpError(405, "Activity is read-only.");
  const [operations, exports, jobs, ocr, proposals] = await Promise.all([
    query<RecoveryActivityItem>(
      "SELECT id,'files' AS kind,initcap(command)||' · '||jsonb_array_length(input->'items')||' items' AS title,CASE WHEN status='completed' AND EXISTS(SELECT 1 FROM jsonb_array_elements(results) x WHERE NOT (x->>'ok')::boolean) THEN 'partial' ELSE status END AS status,created_at AS \"createdAt\" FROM file_operations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30",
      [user],
    ),
    query<RecoveryActivityItem>(
      "SELECT e.id,'export' AS kind,s.name||' · ZIP export' AS title,e.status,e.created_at AS \"createdAt\",e.space_id AS \"spaceId\" FROM workspace_exports e JOIN spaces s ON s.id=e.space_id WHERE e.user_id=$1 AND axiom_space_role($1,e.space_id) IS NOT NULL ORDER BY e.created_at DESC LIMIT 30",
      [user],
    ),
    query<RecoveryActivityItem>(
      "SELECT j.id,CASE WHEN j.kind='assistant' THEN 'assistant' ELSE 'tool' END AS kind,CASE WHEN j.kind='assistant' THEN 'Assistant · '||c.title ELSE initcap(j.kind)||' · '||r.name END AS title,j.status,j.created_at AS \"createdAt\",coalesce(r.space_id,c.space_id) AS \"spaceId\",r.id AS \"resourceId\",c.id AS \"conversationId\" FROM tool_jobs j LEFT JOIN resources r ON r.id=j.resource_id LEFT JOIN assistant_contexts x ON x.id=j.assistant_context_id LEFT JOIN assistant_conversations c ON c.id=x.conversation_id WHERE j.owner_id=$1 AND ((r.id IS NOT NULL AND r.deleted_at IS NULL AND axiom_space_role($1,r.space_id) IS NOT NULL) OR (j.kind='assistant' AND c.owner_id=$1 AND c.deleted_at IS NULL AND axiom_space_role($1,c.space_id) IS NOT NULL)) ORDER BY j.created_at DESC LIMIT 30",
      [user],
    ),
    query<RecoveryActivityItem>(
      'SELECT j.id,\'ocr\' AS kind,\'OCR · \'||r.name AS title,j.status,j.created_at AS "createdAt",r.space_id AS "spaceId",r.id AS "resourceId" FROM pdf_ocr_jobs j JOIN file_versions v ON v.id=j.version_id JOIN resources r ON r.id=v.resource_id WHERE j.owner_id=$1 AND j.cleared_at IS NULL AND r.deleted_at IS NULL AND axiom_space_role($1,r.space_id) IS NOT NULL ORDER BY j.created_at DESC LIMIT 30',
      [user],
    ),
    pluginsEnabled()
      ? query<RecoveryActivityItem>(
          "SELECT s.id,'extension' AS kind,CASE WHEN axiom_space_role($1,g.space_id) IS NOT NULL THEN s.title ELSE 'Extension proposal · workspace unavailable' END AS title,s.status,s.created_at AS \"createdAt\",s.id AS \"changeSetId\" FROM workspace_change_sets s LEFT JOIN plugin_grants g ON g.id=s.plugin_grant_id WHERE s.owner_id=$1 AND s.plugin_grant_id IS NOT NULL ORDER BY s.created_at DESC LIMIT 30",
          [user],
        )
      : [],
  ]);
  const items = [...operations, ...exports, ...jobs, ...ocr, ...proposals]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 100);
  return Response.json(
    { items },
    { headers: { "cache-control": "private, no-store" } },
  );
}
