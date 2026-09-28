import { z } from "zod";
import { query } from "./db";
import { type GraphNode, type GraphEdge } from "./research-library";
import {
  checkLibraryScope,
  liveResource,
  libraryPredicate,
  resolveLibraryScope,
} from "./research-library-service";
import { workspaceJson as json } from "./workspace-service";
export async function researchGraphApi(
  request: Request,
  path: string[],
  user: string,
): Promise<Response | null> {
  if (path.join("/") !== "research/graph" || request.method !== "GET")
    return null;
  const url = new URL(request.url),
    scope = await resolveLibraryScope(
      user,
      url.searchParams.get("spaceId")
        ? { spaceId: url.searchParams.get("spaceId") }
        : { groupId: url.searchParams.get("groupId") || null },
    );
  await checkLibraryScope(user, scope);
  const tag = z
    .string()
    .max(80)
    .parse(url.searchParams.get("tag") ?? "");
  const collection = url.searchParams.get("collection")
    ? z.uuid().parse(url.searchParams.get("collection"))
    : null;
  const types = z
    .array(z.enum(["note", "reference", "pdf"]))
    .min(1)
    .max(3)
    .parse((url.searchParams.get("types") ?? "note,reference,pdf").split(","));
  const values = [user, scope.spaceId, tag, collection, types];
  const visible = `WITH RECURSIVE visible AS (SELECT r.*,s.group_id FROM resources r JOIN spaces s ON s.id=r.space_id WHERE r.space_id=$2::uuid AND axiom_space_role($1,s.id) IS NOT NULL AND ${liveResource()}), cited AS (SELECT DISTINCT nc.note_id,c.reference_id FROM visible v JOIN note_citations nc ON nc.note_id=v.note_id CROSS JOIN LATERAL axiom_note_bibliography(nc.note_id) c WHERE c.cite_key=nc.cite_key AND c.reference_id IS NOT NULL), refs AS (SELECT b.* FROM bibliography b WHERE ${libraryPredicate()} AND b.deleted_at IS NULL AND b.merged_into IS NULL)`;
  const rows = await query<GraphNode>(
    `${visible}, selected_collections AS (SELECT id FROM reference_collections b WHERE b.id=$4::uuid AND ${libraryPredicate()} UNION SELECT c.id FROM reference_collections c JOIN selected_collections t ON c.parent_id=t.id), nodes AS (
 SELECT 'note:'||n.id AS id,'note'::text AS kind,n.title,r.tags,'/notes/'||n.id AS route,''::text AS detail,ARRAY(SELECT DISTINCT ci.collection_id::text FROM reference_collection_items ci JOIN refs b ON b.id=ci.reference_id WHERE EXISTS(SELECT 1 FROM reference_notes rn WHERE rn.reference_id=b.id AND rn.note_id=n.id) OR EXISTS(SELECT 1 FROM cited WHERE cited.reference_id=b.id AND cited.note_id=n.id)) AS collections,r.updated_at FROM visible r JOIN notes n ON n.id=r.note_id WHERE n.source_format='markdown'
 UNION ALL SELECT 'reference:'||b.id,'reference',b.title,b.tags,'/workspaces/'||b.space_id||'/research?view=library&reference='||b.id,concat_ws(' · ',nullif(b.authors,''),nullif(b.year,''),b.cite_key),ARRAY(SELECT ci.collection_id::text FROM reference_collection_items ci WHERE ci.reference_id=b.id),b.updated_at FROM refs b
 UNION ALL SELECT 'pdf:'||v.id,'pdf',r.name,r.tags,'/pdf/'||r.id||'?version='||v.id,'PDF · version '||v.ordinal,ARRAY(SELECT DISTINCT ci.collection_id::text FROM reference_attachments ra JOIN refs b ON b.id=ra.reference_id JOIN reference_collection_items ci ON ci.reference_id=b.id WHERE ra.attachment_id=v.id),r.updated_at FROM visible r JOIN file_versions v ON v.resource_id=r.id JOIN attachments a ON a.id=v.id AND a.mime='application/pdf' WHERE v.id=r.current_version_id OR EXISTS(SELECT 1 FROM reference_attachments l JOIN refs b ON b.id=l.reference_id WHERE l.attachment_id=v.id)
 ) SELECT id,kind,title,tags,route,detail,collections FROM nodes WHERE kind=ANY($5::text[]) AND ($3='' OR $3=ANY(tags)) AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM selected_collections c WHERE c.id::text=ANY(collections))) ORDER BY updated_at DESC,id LIMIT 1001`,
    values,
  );
  const nodes = rows.slice(0, 1000),
    ids = nodes.map((n) => n.id);
  const edges = await query<GraphEdge>(
    `WITH edges AS (
 SELECT 'note:'||l.source_id AS source,'note:'||l.target_id AS target,'link'::text AS kind FROM note_links l WHERE l.target_id IS NOT NULL AND l.source_id=ANY($2::uuid[])
 UNION SELECT 'note:'||nc.note_id,'reference:'||b.reference_id,'citation' FROM note_citations nc CROSS JOIN LATERAL axiom_note_bibliography(nc.note_id) b WHERE b.cite_key=nc.cite_key AND b.reference_id IS NOT NULL AND nc.note_id=ANY($2::uuid[])
 UNION SELECT 'note:'||rn.note_id,'reference:'||coalesce(b.merged_into,b.id),'association' FROM reference_notes rn JOIN bibliography b ON b.id=rn.reference_id WHERE rn.note_id=ANY($2::uuid[])
 UNION SELECT 'reference:'||coalesce(b.merged_into,b.id),'pdf:'||ra.attachment_id,'pdf' FROM reference_attachments ra JOIN bibliography b ON b.id=ra.reference_id WHERE ra.attachment_id=ANY($3::uuid[])
 UNION SELECT 'note:'||rr.source_id,'pdf:'||rr.version_id,'pdf' FROM resource_references rr WHERE rr.snapshot_id IS NULL AND rr.source_id=ANY($2::uuid[])
 ) SELECT DISTINCT source||':'||kind||':'||target AS id,source,target,kind FROM edges WHERE source=ANY($1::text[]) AND target=ANY($1::text[]) AND source<>target ORDER BY id LIMIT 5001`,
    [
      ids,
      nodes.filter((n) => n.kind === "note").map((n) => n.id.slice(5)),
      nodes.filter((n) => n.kind === "pdf").map((n) => n.id.slice(4)),
    ],
  );
  const [{ indexing }] = await query(
    `${visible} SELECT EXISTS(SELECT 1 FROM research_index_queue q JOIN visible v ON v.note_id=q.note_id) AS indexing`,
    values.slice(0, 2),
  );
  return json({
    nodes,
    edges: edges.slice(0, 5000),
    truncated: rows.length > 1000 || edges.length > 5000,
    indexing,
  });
}
