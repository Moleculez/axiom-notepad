import { randomUUID } from "node:crypto";
import { query } from "./db";
import { HttpError } from "./access";
import { createChangeSet, loadChangeSet } from "./workspace-change-sets";
import { currentRevisionDoc } from "./revision-api";
import { documentSource } from "./document-format";
import { sourceHash } from "./document-commands";
import { parseCanvas } from "./canvas";
import type { ChangeAction } from "./productivity";
import {taskDependencyLinks} from './planning';

/** Undo is itself a fresh reviewed change; never overwrite intervening work. */
export async function prepareChangeSetUndo(id:string,user:string,key:string) {
  const s=await loadChangeSet(id,user);
  const [a]=await query("SELECT * FROM workspace_change_actions WHERE set_id=$1 AND key=$2 AND state='complete'",[id,key]);
  if(!a?.result) throw new HttpError(409,"Choose an applied action with a confirmed result.");
  const original=a.data as ChangeAction,b=a.before_data??{},result=a.result;
  const inverse:ChangeAction={key:"undo",action:original.action,spaceId:original.spaceId,targetId:original.targetId,title:`Undo: ${original.title}`,explanation:"Restore the reviewed previous state only if newer work has not changed it.",dependsOn:[],payload:{}};
  if(original.action === "document_edit") {
    const current=await currentRevisionDoc(result.noteId);
    try {
      const source=documentSource(current.doc,current.format);
      if(current.generation!==result.generation||sourceHash(source)!==result.hash) throw new HttpError(409,"The document has newer changes. Use version history to prepare a selective edit instead.");
      inverse.targetId=result.noteId;
      inverse.payload={noteId:result.noteId,generation:result.generation,expectedHash:result.hash};
      if(current.format==="canvas") {
        const before=parseCanvas(b.source),after=parseCanvas(source);
        inverse.payload.canvasCommands=[{type:"remove",ids:[...after.nodes.map(n=>n.id),...after.edges.map(e=>e.id)]},{type:"add",nodes:before.nodes,edges:before.edges}];
      } else inverse.payload.source=b.source;
    } finally {current.doc.destroy();}
  } else if(["workspace_task_create","workspace_task_update"].includes(original.action)) {
    const [task]=await query("SELECT * FROM tasks WHERE id=$1 AND space_id=$2",[result.id,original.spaceId]);
    if(!task||task.version!==result.version) throw new HttpError(409,"This task has newer changes; Undo would overwrite them.");
    inverse.action="workspace_task_update";inverse.targetId=task.id;
    if(original.action==="workspace_task_create") {
      const [linked]=await query("SELECT EXISTS(SELECT 1 FROM tasks WHERE parent_id=$1 AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM task_dependencies d JOIN tasks t ON t.id=d.task_id WHERE d.depends_on=$1 AND t.deleted_at IS NULL) AS present",[task.id]);
      if(linked.present) throw new HttpError(409,"This task has dependent work. Remove or undo dependents first.");
      inverse.payload={version:task.version,deleted:true};
    } else if(original.payload.deleted!==undefined) inverse.payload={version:task.version,deleted:!!b.deleted_at};
    else inverse.payload={version:task.version,title:b.title,body:b.body,status:b.status,priority:b.priority,assigneeId:b.assignee_id,parentId:b.parent_id,estimateHours:b.estimate_hours==null?null:Number(b.estimate_hours),labels:b.labels,milestoneId:b.milestone_id,noteId:b.note_id,resourceIds:b.resource_ids??[],dependencies:b.dependencies??[],dependencyLinks:taskDependencyLinks(b),progressPercent:b.progress_percent??0,position:b.position};
  } else if(original.action === "file_update") {
    const [current]=await query("SELECT version FROM resources WHERE id=$1",[original.targetId]);
    if(!current||current.version!==result.version) throw new HttpError(409,"File metadata changed after this action. Review its history instead.");
    inverse.payload={version:current.version};
    for(const [field,column] of [["name","name"],["description","description"],["tags","tags"],["parentId","parent_id"]]) if(Object.hasOwn(original.payload,field)) inverse.payload[field]=b[column];
  } else if(original.action === "workspace_schedule_apply") {
    inverse.action="workspace_schedule_undo";
    inverse.payload={previewId:a.prepared.payload.previewId};
  } else throw new HttpError(400,"Automatic Undo is not supported for this action. Use the corresponding workspace controls.");
  return createChangeSet({userId:user,spaceIds:s.space_ids,connectionId:s.connection_id,grantVersion:s.grant_version}, {mutationId:randomUUID(),title:inverse.title.slice(0,160),spaceIds:s.space_ids,actions:[inverse]},s.context_id);
}
