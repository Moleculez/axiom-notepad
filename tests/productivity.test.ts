import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { actionReferences, agentConfigSchema, agentResponseSchema, changeSetInput, isWorkspaceMutation, orderedActions, resolveActionReferences, selectedActionKeys, productivityWorkflows, type ChangeAction } from "../packages/shared/src/productivity";
import { integrationActions } from "../packages/shared/src/integration-catalog";
const spaceId=randomUUID();
const action=(key:string,overrides:Partial<ChangeAction>={}):ChangeAction=>({key,action:"file_create",spaceId,title:key,explanation:"",dependsOn:[],payload:{type:"markdown",name:key,source:""},...overrides});
describe("reviewed productivity contracts",()=>{
  it("orders new folders, files and dependent tasks independently of output order",()=>{
    const input=[action("task",{action:"workspace_task_create",payload:{title:"Read",resourceIds:["@{note}"]}}),action("note",{payload:{name:"Brief",parentId:"@{folder}"}}),action("folder",{action:"folder_create"})];
    expect(orderedActions(input).map(a=>a.key)).toEqual(["folder","note","task"]);
    expect(selectedActionKeys(input,["task"])).toEqual(["folder","note","task"]);
    expect(selectedActionKeys(input,["note"])).toEqual(["folder","note"]);
  });
  it("rejects cycles, missing keys, duplicate keys and references to noncreating actions",()=>{
    expect(()=>orderedActions([action("a",{dependsOn:["b"]}),action("b",{dependsOn:["a"]})])).toThrow(/cycle/);
    expect(()=>orderedActions([action("a",{dependsOn:["missing"]})])).toThrow(/Missing/);
    expect(()=>orderedActions([action("a"),action("a")])).toThrow(/unique/);
    expect(()=>orderedActions([action("a",{payload:{source:"@{b}"}}),action("b",{action:"file_update"})])).toThrow(/creates/);
    expect(()=>selectedActionKeys([action("a")],["not-there"])).toThrow(/Unknown/);
  });
  it("resolves only explicit references and supports links and nested task references",()=>{
    const id=randomUUID(),value={source:"[Plan](/workbench/notes/@{plan})",task:{dependencies:["@{plan}"]},literal:"$plan"};
    expect(actionReferences(value)).toEqual(["plan","plan"]);
    expect(resolveActionReferences(value,{plan:id})).toEqual({source:`[Plan](/workbench/notes/${id})`,task:{dependencies:[id]},literal:"$plan"});
    expect(()=>resolveActionReferences("@{unknown}",{})).toThrow();
  });
  it("gates every existing MCP mutation, including direct document edits, but not read/preview",()=>{
    for(const a of integrationActions) expect(isWorkspaceMutation(a.name),a.name).toBe(a.method!=="GET"&&a.name!=="workspace_schedule_preview");
    expect(isWorkspaceMutation("document_edit")).toBe(true);
    expect(isWorkspaceMutation("shell")).toBe(false);
  });
  it("bounds change sets and rejects malformed provider envelopes",()=>{
    expect(changeSetInput.safeParse({mutationId:randomUUID(),title:"Plan",spaceIds:[spaceId],actions:Array.from({length:51},(_,i)=>action(`a${i}`))}).success).toBe(false);
    expect(agentResponseSchema.safeParse({answer:"Done",actions:[],reads:[],done:true,execute:true}).success).toBe(false);
    expect(agentResponseSchema.safeParse({answer:"Plan",actions:[],reads:[{kind:"http",url:"https://example.org"}],done:false}).success).toBe(false);
    expect(agentConfigSchema.safeParse({mode:"autonomous",discover:true}).success).toBe(false);
  });
  it("includes the full workflow suite without changing workspace state",()=>{
    expect(new Set(productivityWorkflows.map(p=>p.id)).size).toBe(9);
    expect(productivityWorkflows.every(p=>p.instructions.length>40)).toBe(true);
  });
});
