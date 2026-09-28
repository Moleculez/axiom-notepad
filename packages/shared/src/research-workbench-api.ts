import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { query } from "./db";
import { HttpError, memberAccess, spaceAccess } from "./access";
import { fileCreateApi } from "./file-create-api";
import { requireScope, workspaceJson as json } from "./workspace-service";
import {
  synthesisInputSchema,
  synthesisSource,
  type EvidenceItem,
  type SynthesisPreview,
} from "./research-workbench";

// All branches share the same scope and resource-access predicate. No note body
// is loaded; annotation text is bounded by its existing 12k field contracts.
const evidenceSQL = `WITH visible AS (
 SELECT r.id,r.name,r.space_id,r.current_version_id,r.updated_at,s.group_id,s.kind
 FROM resources r JOIN spaces s ON s.id=r.space_id
 WHERE r.deleted_at IS NULL AND axiom_space_role($1,s.id) IS NOT NULL
 AND (($2::uuid IS NOT NULL AND s.group_id=$2) OR ($2::uuid IS NULL AND s.id=$3::uuid))
 AND ($3::uuid IS NULL OR s.id=$3)
 AND NOT EXISTS(WITH RECURSIVE parents AS (SELECT id,parent_id,deleted_at FROM resources WHERE id=r.parent_id UNION SELECT p.id,p.parent_id,p.deleted_at FROM resources p JOIN parents x ON x.parent_id=p.id) SELECT 1 FROM parents WHERE deleted_at IS NOT NULL)
), evidence AS (
 SELECT 'paper'::text AS kind,v.id AS id,r.name AS title,''::text AS detail,''::text AS quote,''::text AS body,
 a.sha256 AS revision,coalesce(ri.updated_at,r.updated_at) AS updated_at,r.id AS resource_id,v.id AS attachment_id,r.space_id,r.group_id,(r.kind='personal') AS private,NULL::int AS page,
 '/pdf/'||r.id||'?version='||v.id AS route,ri.data->>'status' AS status,to_jsonb(ri)-'user_id' AS reading,true AS mine
 FROM visible r JOIN file_versions v ON v.id=r.current_version_id JOIN attachments a ON a.id=v.id AND a.mime='application/pdf'
 LEFT JOIN reading_items ri ON ri.user_id=$1 AND ri.kind='reading' AND ri.target_type='attachment' AND ri.target_id=v.id AND NOT ri.deleted
 UNION ALL
 SELECT 'reference',b.id,b.title,concat_ws(' · ',nullif(b.authors,''),nullif(b.year,''),nullif(b.cite_key,'')),'','',b.version::text,coalesce(ri.updated_at,b.created_at),NULL::uuid,NULL::uuid,NULL::uuid,b.group_id,false,NULL::int,
 '/research/references?groupId='||b.group_id,ri.data->>'status',to_jsonb(ri)-'user_id',true
 FROM bibliography b JOIN members m ON m.group_id=b.group_id AND m.user_id=$1 JOIN groups g ON g.id=b.group_id AND g.lifecycle_status NOT IN ('trashed','purging')
 LEFT JOIN reading_items ri ON ri.user_id=$1 AND ri.kind='reading' AND ri.target_type='reference' AND ri.target_id=b.id AND NOT ri.deleted
 WHERE b.group_id=$2 AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM reference_attachments l JOIN file_versions v ON v.id=l.attachment_id JOIN visible r ON r.id=v.resource_id WHERE l.reference_id=b.id) OR EXISTS(SELECT 1 FROM reference_notes l JOIN visible r ON r.id=l.note_id WHERE l.reference_id=b.id))
 UNION ALL
 SELECT 'annotation',a.id,r.name,u.name,a.data->>'quote',a.data->>'body',a.version::text,a.updated_at,r.id,v.id,r.space_id,r.group_id,NOT a.shared OR r.kind='personal',(a.data->>'page')::int,
 '/pdf/'||r.id||'?version='||v.id||'#page='||(a.data->>'page'),NULL::text,NULL::jsonb,a.author_id=$1
 FROM paper_annotations a JOIN file_versions v ON v.id=a.attachment_id JOIN visible r ON r.id=v.resource_id JOIN "user" u ON u.id=a.author_id
 WHERE NOT a.deleted AND (a.author_id=$1 OR a.shared)
 UNION ALL
 SELECT ri.kind,ri.id,coalesce(nullif(ri.data->>'label',''),r.name),r.name,coalesce(ri.data->>'quote',''),' ',ri.version::text,ri.updated_at,r.id,v.id,r.space_id,r.group_id,true,(ri.data->>'page')::int,
 CASE WHEN v.id IS NOT NULL THEN '/pdf/'||r.id||'?version='||v.id||coalesce('#page='||(ri.data->>'page'),'') ELSE '/notes/'||r.id END,NULL::text,to_jsonb(ri)-'user_id',true
 FROM reading_items ri LEFT JOIN file_versions v ON ri.target_type='attachment' AND v.id=ri.target_id
 JOIN visible r ON r.id=CASE WHEN ri.target_type='note' THEN ri.target_id ELSE v.resource_id END
 WHERE ri.user_id=$1 AND ri.kind IN ('bookmark','progress') AND NOT ri.deleted
 )`;
type Scope = { groupId: string | null; spaceId: string | null };
async function scopeAccess(user: string, scope: Scope) {
  if (!scope.groupId && !scope.spaceId)
    throw new HttpError(400, "Choose Personal or a research group.");
  const member = scope.groupId ? await memberAccess(user, scope.groupId) : null;
  if (scope.spaceId) {
    const space = await spaceAccess(user, scope.spaceId);
    if (
      scope.groupId
        ? space.group_id !== scope.groupId
        : space.kind !== "personal"
    )
      throw new HttpError(400, "Choose a workspace in this research context.");
  }
  return member;
}
const decorate = (row: EvidenceItem) => ({
  ...row,
  key: `${row.kind}:${row.id}`,
});
const scopeValues = (user: string, scope: Scope) => [
  user,
  scope.groupId,
  scope.spaceId,
];
async function resolveEvidence(
  user: string,
  input: z.infer<typeof synthesisInputSchema>,
  client?: pg.PoolClient,
) {
  const sql =
      evidenceSQL +
      " SELECT * FROM evidence WHERE kind||':'||id=ANY($4::text[])",
    values = [
      ...scopeValues(user, input),
      input.selection.map((s) => `${s.kind}:${s.id}`),
    ];
  const rows = (
    client
      ? (await client.query<EvidenceItem>(sql, values)).rows
      : await query<EvidenceItem>(sql, values)
  ).map(decorate);
  if (rows.length !== input.selection.length)
    throw new HttpError(
      409,
      "Some evidence is no longer available. Review your selection again.",
    );
  return input.selection.map((s) =>
    rows.find((r) => r.key === `${s.kind}:${s.id}`)!,
  );
}
function previewFor(
  items: EvidenceItem[],
  input: z.infer<typeof synthesisInputSchema>,
  sharedDestination: boolean,
): SynthesisPreview {
  const source = synthesisSource(items, input.name, input.type);
  if (source.length > 900_000)
    throw new HttpError(
      413,
      "Choose fewer or shorter annotations for one synthesis.",
    );
  return {
    source,
    hash: createHash("sha256")
      .update(
        JSON.stringify({
          source,
          destination: input.destination,
          sharedDestination,
        }),
      )
      .digest("hex"),
    privateCount: items.filter((i) => i.private).length,
    sharedDestination,
    sources: items.length,
  };
}
export async function researchWorkbenchApi(
  request: Request,
  path: string[],
  user: string,
): Promise<Response | null> {
  if (path[0] !== "research") return null;
  const url = new URL(request.url);
  if (path.join("/") === "research/workbench" && request.method === "GET") {
    const params = z
      .object({
        groupId: z.uuid().nullable(),
        spaceId: z.uuid().nullable(),
        view: z.enum(["overview", "queue", "evidence"]).default("overview"),
        q: z.string().max(200).default(""),
        author: z.enum(["mine", "shared", "all"]).default("mine"),
        status: z
          .enum(["all", "want", "reading", "read", "archived"])
          .default("all"),
        cursor: z.string().max(700).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(30),
      })
      .parse({
        ...Object.fromEntries(url.searchParams),
        groupId: url.searchParams.get("groupId"),
        spaceId: url.searchParams.get("spaceId"),
      });
    const member = await scopeAccess(user, params);
    let cursor: { at: string; key: string } | null = null;
    if (params.cursor) {
      try {
        cursor = z
          .object({
            at: z.iso.datetime({ offset: true }),
            key: z
              .string()
              .regex(
                /^(paper|reference|annotation|bookmark|progress):[\da-f-]{36}$/,
              ),
          })
          .parse(
            JSON.parse(Buffer.from(params.cursor, "base64url").toString()),
          );
      } catch {
        throw new HttpError(400, "Invalid evidence cursor.");
      }
    }
    const rows = (
      await query<EvidenceItem>(
        evidenceSQL +
          ` SELECT *,kind||':'||id AS key FROM evidence
      WHERE ($4='overview' OR ($4='queue' AND kind IN ('paper','reference')) OR ($4='evidence' AND kind IN ('annotation','bookmark')))
      AND ($5='' OR strpos(lower(title||' '||detail||' '||coalesce(quote,'')||' '||coalesce(body,'')),lower($5))>0)
      AND ($6='all' OR coalesce(status,'want')=$6)
      AND ($4<>'evidence' OR $10='all' OR ($10='mine' AND mine) OR ($10='shared' AND NOT private))
      AND ($7::timestamptz IS NULL OR (updated_at,kind||':'||id)<($7::timestamptz,$8::text))
      ORDER BY updated_at DESC,kind||':'||id DESC LIMIT $9`,
        [
          ...scopeValues(user, params),
          params.view,
          params.q,
          params.status,
          cursor?.at ?? null,
          cursor?.key ?? null,
          params.limit + 1,
          params.author,
        ],
      )
    ).map(decorate);
    const items = rows.slice(0, params.limit).map((row) => ({
        ...row,
        quote: row.quote?.slice(0, 700) ?? "",
        body: row.body?.slice(0, 700) ?? "",
      })),
      last = items.at(-1);
    return json({
      items,
      canEditLibrary: member?.content_role === "editor",
      next:
        rows.length > params.limit && last
          ? Buffer.from(
              JSON.stringify({
                at: new Date(last.updated_at).toISOString(),
                key: last.key,
              }),
            ).toString("base64url")
          : null,
    });
  }
  if (
    ["research/synthesis/preview", "research/synthesis/create"].includes(
      path.join("/"),
    ) &&
    request.method === "POST"
  ) {
    const input = synthesisInputSchema.parse(await request.json());
    await scopeAccess(user, input);
    const destination = await spaceAccess(user, input.destination, "edit"),
      items = await resolveEvidence(user, input);
    const preview = previewFor(items, input, destination.kind !== "personal");
    if (path[2] === "preview") return json(preview);
    if (!input.mutationId || !input.id)
      throw new HttpError(
        400,
        "An idempotency key and new file identity are required.",
      );
    if (preview.hash !== input.expectedHash)
      throw new HttpError(
        409,
        "The evidence or destination changed. Refresh the preview before creating a file.",
      );
    if (
      preview.privateCount &&
      preview.sharedDestination &&
      !input.acknowledgePrivate
    )
      throw new HttpError(
        400,
        "Acknowledge copying private evidence into a shared workspace.",
      );
    return fileCreateApi(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify({
          type: input.type,
          id: input.id,
          mutationId: input.mutationId,
          name: input.name,
          spaceId: input.destination,
          source: preview.source,
        }),
      }),
      ["files", "new"],
      user,
      async (client) => {
        // Source records and permission rows remain locked through creation. The
        // normal creation transaction still owns idempotency, quota and auditing.
        await client.query(
          "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
        );
        for (const spaceId of [
          ...new Set(
            items.map((i) => i.space_id).filter((s): s is string => !!s),
          ),
        ].sort())
          await requireScope(client, user, spaceId);
        if (input.groupId) {
          await client.query("SELECT id FROM groups WHERE id=$1 FOR SHARE", [
            input.groupId,
          ]);
          await client.query(
            "SELECT user_id FROM members WHERE group_id=$1 AND user_id=$2 FOR SHARE",
            [input.groupId, user],
          );
        }
        await client.query(
          "SELECT id FROM resources WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
          [items.flatMap((i) => (i.resource_id ? [i.resource_id] : []))],
        );
        await client.query(
          "SELECT id FROM bibliography WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
          [items.filter((i) => i.kind === "reference").map((i) => i.id)],
        );
        await client.query(
          "SELECT id FROM paper_annotations WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
          [items.filter((i) => i.kind === "annotation").map((i) => i.id)],
        );
        const fresh = previewFor(
          await resolveEvidence(user, input, client),
          input,
          destination.kind !== "personal",
        );
        if (fresh.hash !== preview.hash)
          throw new HttpError(
            409,
            "Evidence changed during creation. Refresh the preview.",
          );
      },
    );
  }
  return null;
}
