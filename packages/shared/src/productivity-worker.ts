import { randomBytes } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "./db";
import { HttpError, resourceAccess, spaceAccess } from "./access";
import { assistantContext, assistantProvider, assertAssistantAccess } from "./assistant-service";
import { documentSource } from "./document-format";
import { currentRevisionDoc } from "./revision-api";
import { sourceHash } from "./document-commands";
import { callAssistantProvider } from "./tool-providers";
import { validateAssistantBudget, type AssistantEvidence, type AssistantMessage } from "./assistant";
import { agentReadSchema, agentResponseSchema, orderedActions, productivityLimits, productivityWrites, type ChangeAction } from "./productivity";
import { createChangeSet } from "./workspace-change-sets";

async function readEvidence(user: string, scope: string[], read: z.infer<typeof agentReadSchema>) {
  for (const id of scope) await spaceAccess(user,id);
  if (read.kind === "search") {
    const items = await query(`SELECT r.id,r.space_id,r.name,r.kind,r.version,n.source_format FROM resources r LEFT JOIN notes n ON n.id=r.note_id WHERE r.space_id=ANY($1::uuid[]) AND r.deleted_at IS NULL AND (r.name ILIKE '%'||$2||'%' OR n.plain_text ILIKE '%'||$2||'%' OR r.description ILIKE '%'||$2||'%') ORDER BY r.updated_at DESC,r.id LIMIT 21`,[scope,read.query]);
    return { output:{items:items.slice(0,20),more:items.length>20},evidence:undefined };
  }
  let evidence: AssistantEvidence = { key:"E"+randomBytes(7).toString("hex"),kind:read.kind === "planning" ? "planning" : "document",id:read.id,title:"",source:"",hash:"",capturedAt:new Date().toISOString(),editable:false };
  if (read.kind === "planning") {
    if (!scope.includes(read.id)) throw new HttpError(403,"Planning data is outside the selected workspaces.");
    await spaceAccess(user,read.id);
    const [space] = await query("SELECT name,planning_version,planning_calendar,timezone FROM spaces WHERE id=$1",[read.id]);
    const tasks = await query("SELECT id,title,body,status,priority,assignee_id,parent_id,start_on,due_on,estimate_hours,milestone_id,version,labels,(SELECT coalesce(jsonb_agg(depends_on),'[]'::jsonb) FROM task_dependencies WHERE task_id=t.id) AS dependencies FROM tasks t WHERE space_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC,id LIMIT 101",[read.id]);
    if (tasks.length>100) throw new HttpError(413,"This plan exceeds 100 tasks. Select specific planning evidence; nothing was truncated.");
    const milestones = await query("SELECT id,title,due_on,version FROM project_milestones WHERE space_id=$1 ORDER BY id LIMIT 101",[read.id]);
    const members = await query('SELECT id,name FROM "user" WHERE axiom_space_role(id,$1) IS NOT NULL ORDER BY id LIMIT 101',[read.id]);
    if (milestones.length>100 || members.length>100) throw new HttpError(413,"Select narrower planning evidence; workspace membership or milestones exceed this read limit.");
    evidence = {...evidence,spaceId:read.id,title:space.name+" · planning",planningVersion:space.planning_version,taskIds:tasks.map((t)=>t.id),source:JSON.stringify({tasks,milestones,members,calendar:space.planning_calendar,timezone:space.timezone})};
  } else {
    const {resource} = await resourceAccess(user,read.id);
    if (!scope.includes(resource.space_id)) throw new HttpError(403,"File is outside the selected workspaces.");
    if (!resource.note_id) throw new HttpError(400,"Attach exact PDF/OCR/Office excerpts using Add evidence; this read supports native files.");
    const current = await currentRevisionDoc(resource.note_id);
    try {
      if (!["markdown","latex","text","canvas"].includes(current.format)) throw new HttpError(400,"This format is not readable by the assistant.");
      const source = documentSource(current.doc,current.format);
      evidence = {...evidence,kind:current.format === "canvas" ? "canvas" : "document",spaceId:resource.space_id,title:resource.name,source,format:current.format,generation:current.generation,from:0,to:source.length,version:resource.version};
    } finally { current.doc.destroy(); }
  }
  evidence.hash = sourceHash(evidence.source);
  if (evidence.source.length>30000) throw new HttpError(413,"Select a shorter excerpt. This source exceeds the context budget; nothing was truncated.");
  return {output:evidence,evidence};
}

export async function executeProductivityRound(job: Record<string,any>,signal: AbortSignal,submitted:()=>void) {
  const c = await assistantContext(job.assistant_context_id,job.owner_id);
  if (!c.agent_config) throw new Error("Productivity consent is missing.");
  await assertAssistantAccess(c);
  const provider = await assistantProvider(c.owner_id,c.space_id,c.provider_id,c.provider_version);
  const [run] = await query("SELECT * FROM assistant_runs WHERE id=$1",[job.id]);
  if (!run || run.round>=productivityLimits.rounds) throw new Error("This run reached its eight-round limit. Start a new reviewed request.");
  const messages: AssistantMessage[] = [...c.messages,...run.messages];
  validateAssistantBudget(c.evidence,messages);
  const ordinal = run.round+1;
  await transaction(async (db)=>{
    await assertAssistantAccess(c,db);
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[c.provider_id]);
    const {rows:[state]} = await db.query("SELECT status FROM tool_jobs WHERE id=$1 FOR UPDATE",[job.id]);
    if (state.status !== "running" || signal.aborted) throw new Error("Run cancelled before dispatch.");
    const {rows:[usage]} = await db.query("SELECT (SELECT count(*) FROM tool_jobs WHERE provider_id=$1 AND created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))+(SELECT count(*) FROM assistant_run_steps WHERE provider_id=$1 AND ordinal>1 AND dispatched_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS used",[c.provider_id]);
    if (ordinal>1 && Number(usage.used)>=provider.daily_limit) throw new HttpError(429,"Provider daily request limit reached; completed drafts were retained.");
    await db.query("INSERT INTO assistant_run_steps(run_id,ordinal,provider_id) VALUES($1,$2,$3)",[job.id,ordinal,c.provider_id]);
  });
  submitted();
  const response = await callAssistantProvider(provider as Parameters<typeof callAssistantProvider>[0],messages,signal);
  let output: z.infer<typeof agentResponseSchema> | undefined;
  try { output = agentResponseSchema.parse(JSON.parse(response.text.replace(/^\s*```(?:json)?\s*\n/,"").replace(/\n```\s*$/,""))); } catch { /* Malformed output is inert, never executed. */ }
  const activity: any[] = [...run.activity,{kind:"draft",message:`Completed model round ${ordinal}`,at:new Date().toISOString()}];
  const actions: ChangeAction[] = [...run.actions];
  const evidence = [...c.evidence];
  const nextMessages: AssistantMessage[] = [...run.messages,{role:"assistant",content:response.text}];
  let warning = "",answer = output?.answer || response.text,more = false;
  if (!output) warning = "The provider returned invalid structured output. No actions from this response are available.";
  else {
    if (c.agent_config.mode === "ask" && output.actions.length) throw new HttpError(400,"Ask mode cannot prepare writes. No workspace changes were made.");
    for (const a of output.actions) {
      if (!(productivityWrites as readonly string[]).includes(a.action)) throw new HttpError(400,"The provider requested an unavailable action.");
      actions.push(a);
    }
    if (actions.length>productivityLimits.actions) throw new HttpError(413,"Split this plan into batches of at most 50 actions.");
    orderedActions(actions);
    if (output.reads.length && !c.agent_config.discover) throw new HttpError(403,"Additional reading was not authorized. No content was retrieved.");
    const results = [];
    for (const read of output.reads) {
      if (signal.aborted) throw new Error("Run cancelled.");
      const result = await readEvidence(c.owner_id,c.space_ids ?? [c.space_id],read);
      if (result.evidence) evidence.push(result.evidence);
      results.push({request:read,result:result.output});
      activity.push({kind:"read",message:read.kind === "search" ? `Searched: ${read.query || "workspace files"}` : `Read: ${result.evidence?.title}`,evidenceKey:result.evidence?.key,at:new Date().toISOString()});
    }
    if (results.length) nextMessages.push({role:"user",content:JSON.stringify({toolResults:results,previousDraftKeys:actions.map((a)=>a.key),roundsRemaining:productivityLimits.rounds-ordinal})});
    more = !output.done && ordinal<productivityLimits.rounds;
    if (!output.done && ordinal === productivityLimits.rounds) warning = "The run reached eight rounds. Review available drafts or send a new request to continue.";
  }
  validateAssistantBudget(evidence,[...c.messages,...nextMessages]);
  let publish = false;
  await transaction(async (db)=>{
    await assertAssistantAccess(c,db);
    await assistantProvider(c.owner_id,c.space_id,c.provider_id,c.provider_version,db);
    const {rows:[state]} = await db.query("SELECT status FROM tool_jobs WHERE id=$1 FOR UPDATE",[job.id]);
    if (signal.aborted || state.status !== "running") return;
    await db.query("UPDATE assistant_contexts SET evidence=$2 WHERE id=$1",[c.id,JSON.stringify(evidence)]);
    await assertAssistantAccess({...c,evidence},db);
    await db.query("UPDATE assistant_runs SET round=$2,messages=$3,actions=$4,activity=$5 WHERE id=$1",[job.id,ordinal,JSON.stringify(nextMessages),JSON.stringify(actions),JSON.stringify(activity)]);
    await db.query("UPDATE assistant_run_steps SET completed_at=now() WHERE run_id=$1 AND ordinal=$2",[job.id,ordinal]);
    if (more) await db.query("UPDATE tool_jobs SET status='queued',lease_until=NULL,updated_at=now() WHERE id=$1",[job.id]);
    else publish = true;
  });
  if (!publish) return;
  let changeSetId: string | undefined;
  if (output && actions.length) {
    const set = await createChangeSet({userId:c.owner_id,spaceIds:c.space_ids ?? [c.space_id]}, {mutationId:job.id,title:c.prompt.replace(/\s+/g," ").slice(0,160),spaceIds:c.space_ids ?? [c.space_id],actions},c.id,job.id);
    changeSetId = set.id;
    answer = output.answer || "Your draft changes are ready for review. Nothing has been applied.";
  }
  await transaction(async (db)=>{
    await assertAssistantAccess(await assistantContext(c.id,c.owner_id,db),db);
    const {rowCount} = await db.query("UPDATE tool_jobs SET status='complete',result=$2,input='{}',updated_at=now() WHERE id=$1 AND status='running'",[job.id,JSON.stringify({answer,warning,usage:response.usage,changeSetId})]);
    if (!rowCount && changeSetId) await db.query("DELETE FROM workspace_change_sets WHERE id=$1 AND status='draft'",[changeSetId]);
  });
}
