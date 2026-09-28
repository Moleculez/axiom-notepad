/** Deterministic, loopback-only provider for isolated 3004 acceptance. Never a deployed service. */
import { createServer } from "node:http";
import { assistantTaskSchema } from "../../packages/shared/src/assistant";
let calls = 0;
const server = createServer(async (req, res) => {
  if (req.url === "/calls") {
    res.end(JSON.stringify({ calls }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404).end();
    return;
  }
  if (req.headers.authorization !== "Bearer assistant-fixture-token") {
    res.writeHead(401).end();
    return;
  }
  let body = "";
  for await (const c of req) {
    body += c;
    if (body.length > 1_000_000) {
      res.writeHead(413).end();
      return;
    }
  }
  calls++;
  const parsed = JSON.parse(body);
  const initial = parsed.messages.filter((m:any)=>m.role === "user").map((m:any)=>{try{return JSON.parse(m.content);}catch{return {};}}).findLast((m:any)=>m.mode && m.request);
  if (initial) {
    const last = JSON.parse(parsed.messages.at(-1).content),spaceId=initial.primaryWorkspace;
    const common=(key:string,action:string,title:string,payload:unknown)=>({key,action,title,spaceId,payload,explanation:"Fixture proposal; review before applying.",dependsOn:[]});
    let actions:unknown[]=[];
    let reads:unknown[]=[];
    let done=true;
    if(initial.discover && !last.toolResults) {reads=[{kind:"search",query:""},{kind:"planning",id:spaceId}];done=false;}
    else if(initial.mode === "prepare") {
      if(/productivity-edit/.test(initial.request)) {
        const e=initial.evidence.find((e:any)=>e.kind==="document");
        actions=[{...common("edit","document_edit","Clarify research note",{noteId:e.id,generation:e.generation,expectedHash:e.hash,source:e.source+"\n\nReviewed productivity edit.\n"}),targetId:e.id}];
      } else actions=[
        common("folder","folder_create","Create experiment folder",{kind:"folder",name:"Productivity experiment"}),
        common("brief","file_create","Create research brief",{type:"markdown",name:"Research brief",parentId:"@{folder}",source:"# Research brief\n\nVerify the model assumptions.\n"}),
        common("milestone","workspace_milestone_create","Define review milestone",{title:"Review evidence",dueOn:null}),
        common("task","workspace_task_create","Review assumptions",{title:"Review assumptions",resourceIds:["@{brief}"],milestoneId:"@{milestone}",estimateHours:2}),
        common("subtask","workspace_task_create","Record limitations",{title:"Record limitations",parentId:"@{task}",resourceIds:["@{brief}"]}),
      ];
    }
    if(/productivity-slow/.test(initial.request)) await new Promise(r=>setTimeout(r,6000));
    const content=/productivity-malformed/.test(initial.request)?"Plain inert response":JSON.stringify({answer:"A private productivity draft is ready for review; nothing has been applied.",reads,actions,done});
    res.setHeader("content-type","application/json");res.end(JSON.stringify({choices:[{finish_reason:"stop",message:{content}}],usage:{prompt_tokens:100,completion_tokens:100}}));return;
  }
  const last = JSON.parse(parsed.messages.at(-1).content),
    e = last.evidence[0];
  const proposals: unknown[] = [];
  if (/propos|draft/i.test(last.request)) {
    for (const item of last.evidence.filter((v: any) => v.editable)) {
      if (item.kind === "document")
        proposals.push({
          kind: "document",
          evidenceKey: item.key,
          source:
            item.source + "\n\nAssumptions must be verified experimentally.\n",
          explanation: "Make the verification boundary explicit.",
        });
      if (item.kind === "task")
        proposals.push(
          /schedule/i.test(last.request)
            ? {
                kind: "schedule",
                evidenceKey: item.key,
                startOn: "2026-10-05",
                dueOn: "2026-10-06",
                explanation:
                  "A reviewed date change for the selected task only.",
              }
            : {
                kind: "task-update",
                evidenceKey: item.key,
                fields: {
                  ...item.task,
                  title: item.task.title + " — reviewed",
                  priority: "high",
                },
                explanation: "Prioritize the reviewed experiment.",
              },
        );
    }
    if (last.allowTaskCreate)
      proposals.push({
        kind: "task-create",
        fields: assistantTaskSchema.parse({
          title: "Verify the research assumptions",
          body: "Review the source and reproduce the result.",
          status: "todo",
          priority: "normal",
          assigneeId: null,
          labels: ["research"],
          estimateHours: 2,
        }),
        explanation: "A private proposed follow-up, not an executed action.",
      });
  }
  const answer = `## Evidence and interpretation\n\nThe selected material supports a preliminary comparison${e ? ` [[${e.key}]]` : ""}. **Verify the assumptions** before drawing a conclusion.\n\nFor a simple model, $E=mc^2$ describes the stated relationship; this is an explanation, not formal verification.\n\n- Check the source conditions.\n- Record limitations and uncertainty.\n- Reproduce the result independently.`;
  const content = /malformed/i.test(last.request)
    ? "A plain answer with no executable actions."
    : JSON.stringify({ answer, proposals: proposals.slice(0, 5) });
  if (/slow/i.test(last.request)) await new Promise((r) => setTimeout(r, 6000));
  if (/disconnect/i.test(last.request)) {
    req.socket.destroy();
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content } }],
      usage: { prompt_tokens: 123, completion_tokens: 45 },
    }),
  );
});
server.listen(8096, "127.0.0.1", () =>
  console.log(
    "Isolated assistant fixture on 127.0.0.1:8096. No external AI requests.",
  ),
);
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
