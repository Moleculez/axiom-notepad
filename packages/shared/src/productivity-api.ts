import { z } from "zod";
import { query } from "./db";
import { HttpError, spaceAccess, resourceAccess } from "./access";
import { workspaceJson as json } from "./workspace-service";
import { changeActionSchema, workflowPresetSchema, productivityWorkflows } from "./productivity";
import { loadChangeSet, changeSetView, previewChangeSet, approveChangeSet, cancelChangeSet, reviseChangeSet } from "./workspace-change-sets";
import { prepareChangeSetUndo } from "./change-set-undo";

export async function productivityApi(request: Request, path: string[], user: string) {
  if (path[0] === "spaces" && path[2] === "assistant" && path[3] === "workflows") {
    const space = z.uuid().parse(path[1]);
    await spaceAccess(user, space);
    if (request.method === "GET") return json({ builtIn: productivityWorkflows, custom: await query("SELECT id,name,instructions,destination_id,version FROM assistant_workflow_presets WHERE owner_id=$1 AND space_id=$2 ORDER BY name", [user,space]) });
    const id = path[4] ? z.uuid().parse(path[4]) : undefined;
    if (request.method === "DELETE" && id) {
      await query("DELETE FROM assistant_workflow_presets WHERE id=$1 AND owner_id=$2 AND space_id=$3", [id,user,space]);
      return json({ ok: true });
    }
    if (["POST","PATCH"].includes(request.method)) {
      const input = workflowPresetSchema.parse(await request.json());
      if (input.destinationId) {
        const { resource } = await resourceAccess(user,input.destinationId);
        if (resource.space_id !== space || resource.kind !== "folder") throw new HttpError(400,"Choose a folder in this workspace.");
      }
      if (id) {
        const rows = await query("UPDATE assistant_workflow_presets SET name=$4,instructions=$5,destination_id=$6,version=version+1,updated_at=now() WHERE id=$1 AND owner_id=$2 AND space_id=$3 AND version=$7 RETURNING *", [id,user,space,input.name,input.instructions,input.destinationId,input.version]);
        if (!rows.length) throw new HttpError(409,"Workflow changed. Refresh before saving.");
        return json(rows[0]);
      }
      const [row] = await query("INSERT INTO assistant_workflow_presets(owner_id,space_id,name,instructions,destination_id) SELECT $1,$2,$3,$4,$5 WHERE (SELECT count(*) FROM assistant_workflow_presets WHERE owner_id=$1 AND space_id=$2)<50 RETURNING *", [user,space,input.name,input.instructions,input.destinationId]);
      if (!row) throw new HttpError(429,"Remove an older preset; at most 50 are retained per workspace.");
      return json(row,201);
    }
    throw new HttpError(405,"Unsupported workflow operation.");
  }
  if (path[0] !== "assistant" || path[1] !== "change-sets") return null;
  const id = path[2], action = path[3];
  if (!id && request.method === "GET") {
    const rows = await query("SELECT id FROM workspace_change_sets WHERE owner_id=$1 AND created_at>now()-interval '30 days' ORDER BY updated_at DESC LIMIT 100", [user]);
    const items = [];
    for (const r of rows) {
      try {
        const s = await loadChangeSet(r.id,user);
        items.push({ id:s.id,title:s.title,status:s.status,connection_id:s.connection_id,space_ids:s.space_ids,updated_at:s.updated_at });
      } catch (e) { if (!(e instanceof HttpError)) throw e; }
    }
    return json(items);
  }
  z.uuid().parse(id);
  if (!action && request.method === "GET") return json(await changeSetView(id,user));
  if (!action && request.method === "PATCH") {
    const input = z.object({ version:z.number().int().positive(),actions:z.array(changeActionSchema).min(1).max(50) }).strict().parse(await request.json());
    return json(await reviseChangeSet(id,user,input.version,input.actions));
  }
  if (request.method === "POST") {
    if (action === "undo") {
      const input = z.object({key:z.string().min(1).max(40)}).strict().parse(await request.json());
      return json(await prepareChangeSetUndo(id,user,input.key),201);
    }
    if (action === "preview") {
      const input = z.object({version:z.number().int().positive(),keys:z.array(z.string()).min(1).max(50)}).strict().parse(await request.json());
      return json(await previewChangeSet(id,user,input.version,input.keys));
    }
    if (action === "apply") {
      const input = z.object({fingerprint:z.string().length(64),consent:z.literal(true)}).strict().parse(await request.json());
      return json(await approveChangeSet(id,user,input.fingerprint),202);
    }
    if (action === "cancel") return json(await cancelChangeSet(id,user));
  }
  throw new HttpError(405,"Unsupported change set operation.");
}
