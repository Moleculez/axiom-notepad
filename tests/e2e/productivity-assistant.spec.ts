import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin, replaceSource } from "./native-editor-helpers";
test.beforeAll(()=>{if(origin!=="http://localhost:3004")throw new Error("Productivity acceptance requires isolated port 3004 and the fixture provider.");});
async function call(request:APIRequestContext,path:string,data?:unknown,method=data===undefined?"GET":"POST") {
  const response=await request.fetch(`/api/v1/${path}`,{method,data,headers:{origin}});
  expect(response.ok(),await response.text()).toBeTruthy();return response.json();
}
async function setup(f:Awaited<ReturnType<typeof fixture>>) {
  const spaces=await call(f.member.request,"spaces"),space=spaces.find((s:any)=>s.group_id===f.group.id&&s.kind==="team");
  await call(f.owner.request,`group-admin/${f.group.id}/providers`,{name:"Productivity fixture",kind:"private",endpoint:"http://127.0.0.1:8096/v1/",model:"deterministic-productivity",credential:"assistant-fixture-token",capabilities:["assistant"],enabled:true,dailyLimit:100});
  const provider=(await call(f.member.request,`spaces/${space.id}/assistant/providers`))[0];
  const generate=async(prompt="productivity-kickoff",discover=true,mode="prepare")=>{
    const conversation=await call(f.member.request,`spaces/${space.id}/assistant/conversations`,{id:randomUUID(),title:prompt});
    const context=await call(f.member.request,`spaces/${space.id}/assistant/contexts`,{conversationId:conversation.id,providerId:provider.id,providerVersion:provider.version,prompt,selections:prompt.includes("edit")?[{kind:"document",id:f.note.id,editable:false}]:[],agent:{mode,discover}});
    const job=await call(f.member.request,`assistant/conversations/${conversation.id}/turns`,{contextId:context.id,fingerprint:context.fingerprint,consent:true,mutationId:randomUUID()});
    let turn:any;
    await expect.poll(async()=>{turn=(await call(f.member.request,`assistant/conversations/${conversation.id}`)).turns.find((t:any)=>t.id===job.id);return turn?.status;},{timeout:45000}).toBe("complete");
    return {turn,conversation,context};
  };
  const preview=(s:any,keys=s.actions.map((a:any)=>a.data.key))=>call(f.member.request,`assistant/change-sets/${s.id}/preview`,{version:s.version,keys});
  const apply=async(s:any)=>{
    await call(f.member.request,`assistant/change-sets/${s.id}/apply`,{fingerprint:s.preview.fingerprint,consent:true});
    let value:any;
    await expect.poll(async()=>{value=await call(f.member.request,`assistant/change-sets/${s.id}`);return value.status;},{timeout:30000}).toBe("complete");return value;
  };
  return {space,provider,generate,preview,apply};
}
test("scoped retrieval creates only a private plan until UI approval, with linked files/tasks and repeat-safe apply",async({browser},info)=>{
  test.setTimeout(180000);const f=await fixture(browser,"# Evidence\n\nInspect the assumptions.\n"),s=await setup(f);
  try {
    const {turn}=await s.generate();expect(turn.round).toBe(2);expect(turn.activity.some((a:any)=>a.kind==="read")).toBe(true);
    let set=await call(f.member.request,`assistant/change-sets/${turn.changeSetId}`);expect(set.actions).toHaveLength(5);
    expect((await f.owner.request.get(`/api/v1/assistant/change-sets/${set.id}`)).status()).toBe(404);
    const before=await call(f.member.request,`spaces/${s.space.id}/planning`);expect(before.tasks??before.items).toHaveLength(0);
    set=await s.preview(set,["subtask"]);expect(set.actions.filter((a:any)=>a.selected)).toHaveLength(5);
    const denied=await f.member.request.post(`/api/v1/assistant/change-sets/${set.id}/apply`,{headers:{origin},data:{fingerprint:"0".repeat(64),consent:true}});expect(denied.status()).toBe(409);
    await f.page.goto(`/workbench/settings/connections?review=${set.id}`);
    const dialog=f.page.getByRole("dialog",{name:"Review workspace changes",exact:true});await expect(dialog).toBeVisible();
    await dialog.getByRole("button",{name:"Create research brief"}).click();await expect(dialog.locator(".revision-comparison")).toBeVisible();
    await f.page.screenshot({path:info.outputPath("reviewed-files-current.png"),fullPage:true});
    await dialog.getByRole("button",{name:"Plan preview",exact:true}).click();await expect(dialog.getByText("Proposed plan",{exact:true})).toBeVisible();
    await f.page.screenshot({path:info.outputPath("reviewed-plan-current.png"),fullPage:true});
    await dialog.getByRole("checkbox",{name:"I approve these exact changes and their destinations."}).check();
    await dialog.getByRole("button",{name:"Approve & apply",exact:true}).click();
    let complete:any;await expect.poll(async()=>{complete=await call(f.member.request,`assistant/change-sets/${set.id}`);return complete.status;},{timeout:30000}).toBe("complete");
    const folder=complete.actions.find((a:any)=>a.data.key==="folder"),brief=complete.actions.find((a:any)=>a.data.key==="brief"),task=complete.actions.find((a:any)=>a.data.key==="task"),subtask=complete.actions.find((a:any)=>a.data.key==="subtask");
    expect((await call(f.member.request,`resources/${brief.entity_id}`)).parent_id).toBe(folder.entity_id);
    expect((await call(f.member.request,`tasks/${task.entity_id}`)).resource_ids).toContain(brief.entity_id);
    expect((await call(f.member.request,`tasks/${subtask.entity_id}`)).parent_id).toBe(task.entity_id);
    await s.apply(set);const finalPlan=await call(f.member.request,`spaces/${s.space.id}/planning`);expect(finalPlan.tasks??finalPlan.items).toHaveLength(2);
    const audit=await call(f.member.request,`audit?space=${s.space.id}`);expect(JSON.stringify(audit)).toContain(set.id);
  } finally {await f.close();}
});
test("document review applies through collaboration, guards Undo and rejects stale content",async({browser})=>{
  test.setTimeout(180000);const f=await fixture(browser,"# Review\n\nOriginal text.\n"),s=await setup(f);
  try {
    const first=await s.generate("productivity-edit",false);
    let set=await call(f.member.request,`assistant/change-sets/${first.turn.changeSetId}`);set=await s.preview(set);const done=await s.apply(set);
    await expect.poll(f.source).toContain("Reviewed productivity edit");
    const undo=await call(f.member.request,`assistant/change-sets/${done.id}/undo`,{key:"edit"});await s.apply(await s.preview(undo));
    await expect.poll(f.source).toBe("# Review\n\nOriginal text.\n");
    const next=await s.generate("productivity-edit",false);set=await call(f.member.request,`assistant/change-sets/${next.turn.changeSetId}`);set=await s.preview(set);
    await replaceSource(f.page,"# Review\n\nA collaborator changed this.\n");await expect.poll(f.source).toContain("A collaborator");
    await call(f.member.request,`assistant/change-sets/${set.id}/apply`,{fingerprint:set.preview.fingerprint,consent:true});
    await expect.poll(async()=>(await call(f.member.request,`assistant/change-sets/${set.id}`)).status).toBe("partial");
    expect(await f.source()).toContain("A collaborator");
  } finally {await f.close();}
});
test("Ask stays read-only, malformed output is inert, presets remain private, width sliders are removed",async({browser},info)=>{
  test.setTimeout(180000);const f=await fixture(browser,"# Settings\n\nLocal evidence.\n"),s=await setup(f);
  try {
    expect((await s.generate("productivity-ask",true,"ask")).turn.changeSetId).toBeUndefined();
    expect((await s.generate("productivity-malformed",false)).turn.changeSetId).toBeUndefined();
    const preset=await call(f.member.request,`spaces/${s.space.id}/assistant/workflows`,{name:"Weekly lab report",instructions:"Prepare a report with evidence, blockers and next steps."});
    expect((await call(f.owner.request,`spaces/${s.space.id}/assistant/workflows`)).custom).toHaveLength(0);
    await call(f.member.request,`spaces/${s.space.id}/assistant/workflows/${preset.id}`,{name:"Monthly lab report",instructions:"Prepare monthly research progress.",version:preset.version},"PATCH");
    await call(f.member.request,`spaces/${s.space.id}/assistant/workflows/${preset.id}`,undefined,"DELETE");
    await f.page.goto("/workbench/settings/layout");
    await expect(f.page.getByText("Sidebar width",{exact:true})).toHaveCount(0);await expect(f.page.getByText("Research panel width",{exact:true})).toHaveCount(0);
    await expect(f.page.getByText("Resize the sidebar and document panel",{exact:false})).toBeVisible();
    await f.page.screenshot({path:info.outputPath("appearance-panel-resizing-current.png"),fullPage:true});
    await f.page.goto(`/workbench/notes/${f.note.id}`);const handle=f.page.getByRole("separator",{name:"Resize workspace navigation",exact:true});await expect(handle).toBeVisible();const width=Number(await handle.getAttribute("aria-valuenow"));await handle.focus();await handle.press("ArrowRight");await expect(handle).toHaveAttribute("aria-valuenow",String(width+10));
  } finally {await f.close();}
});
