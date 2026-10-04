import { makePluginPackage } from "./plugin-package";
import { pluginManifestSchema } from "./plugins";

// Shipped packages use the same manifest, archive validator, worker and broker
// as imports. None is enabled automatically. No server-side plugin execution.
const pilots = [
  {
    manifest: {
      id: "axiom.journal",
      version: "1.0.1",
      name: "Research Journal",
      description:
        "Prepare daily notes, lab records and meeting minutes as reviewed Markdown files.",
      capabilities: ["resources:read", "files:propose"],
      commands: [
        {
          id: "axiom.journal.open",
          title: "New research journal",
          description:
            "Choose a template and destination, then review the exact file.",
          icon: "NotebookPen",
          slash: true,
          menu: true,
        },
        {
          id: "axiom.journal.prepare",
          title: "Review journal file",
          description: "Prepare a file for explicit review.",
          icon: "NotebookPen",
          panelOnly: true,
        },
      ],
    },
    bundle: `export default {async run(api,ctx) {
      if(ctx.command.endsWith('.prepare')) {
        const title=String(ctx.inputs.title||'Research journal').trim();
        const source=String(ctx.inputs.source||'');
        const result=await api.request('changes.prepare',{mutationId:api.createId(),title:'Create '+title,spaceIds:[ctx.spaceId],actions:[{key:'journal',action:'file_create',spaceId:ctx.spaceId,title:'Create '+title,payload:{type:'markdown',name:title,source,parentId:ctx.inputs.folder||null}}]});
        return api.render({title:'Research Journal',blocks:[{kind:'notice',text:'Nothing has been created. Review the exact content and choose Apply.',tone:'info'},{kind:'review',label:'Review proposed journal',setId:result.id}]});
      }
      const files=await api.request('resources.list',{kind:'folder'});
      const date=new Date().toISOString().slice(0,10),template=String(ctx.inputs.template||'daily');
      const source=template==='lab'?'# Lab record — '+date+'\\n\\n## Research question\\n\\n## Materials and methods\\n\\n## Observations\\n\\n## Results and uncertainty\\n\\n## Reproducibility checklist\\n\\n- [ ] Data and code linked\\n- [ ] Parameters and versions recorded\\n':template==='meeting'?'# Meeting — '+date+'\\n\\n## Participants\\n\\n## Agenda\\n\\n## Decisions\\n\\n## Actions\\n\\n- [ ] Owner and due date to confirm\\n\\n## Open questions\\n':'# Research journal — '+date+'\\n\\n## Today’s focus\\n\\n## Evidence and observations\\n\\n## Questions\\n\\n## Next steps\\n\\n- [ ] \\n';
      await api.render({title:'Research Journal',blocks:[{kind:'field',field:{id:'template',label:'Template',type:'select',value:template,options:[{value:'daily',label:'Daily journal'},{value:'lab',label:'Lab record'},{value:'meeting',label:'Meeting minutes'}]}},{kind:'action',label:'Load template',command:'axiom.journal.open'},{kind:'field',field:{id:'title',label:'File name',type:'text',required:true,value:'Research journal — '+date}},{kind:'field',field:{id:'folder',label:'Destination folder',type:'select',value:'',options:[{value:'',label:'Workspace root'},...files.items.map(f=>({value:f.id,label:f.name}))]}},{kind:'field',field:{id:'source',label:'Markdown content',type:'textarea',value:source}},{kind:'notice',text:files.hasMore?'Only the first 100 folders are listed. Use Explorer to move the reviewed file later.':'Created only after your explicit review.',tone:'info'},{kind:'action',label:'Prepare for review',command:'axiom.journal.prepare',primary:true}]});
    }};`,
  },
  {
    manifest: {
      id: "axiom.document-health",
      version: "1.0.1",
      name: "Document Health",
      description:
        "Inspect a saved note for unresolved note and citation links, repeated labels and undescribed images. Results are tied to a source snapshot.",
      capabilities: ["resources:read", "documents:read", "references:read"],
      commands: [
        {
          id: "axiom.document-health.inspect",
          title: "Check document health",
          description:
            "Read a saved snapshot and report navigable findings without changing it.",
          icon: "CheckCheck",
          context: "document",
          menu: true,
        },
      ],
    },
    bundle: `export default {async run(api,ctx) {
      if(!ctx.resourceId) return api.render({title:'Document Health',blocks:[{kind:'notice',text:'Open a Markdown note first.',tone:'info'}]});
      const [doc,files,refs]=await Promise.all([api.request('documents.read',{resourceId:ctx.resourceId}),api.request('resources.list',{}),api.request('references.list',{})]);
      if(doc.format!=='markdown') return api.render({title:'Document Health',blocks:[{kind:'notice',text:'This check supports Markdown notes only.',tone:'info'}]});
      const names=new Set(files.items.map(f=>f.name.toLowerCase().replace(/\\.md$/,''))),ids=new Set(files.items.map(f=>f.id)),keys=new Set(refs.items.map(r=>r.cite_key)),labels=new Set(),findings=[];
      const lines=doc.source.split('\\n');let fence=false;
      const add=(line,text)=>findings.push({kind:'link',label:'Line '+line+' · '+text,target:{resourceId:doc.resourceId,line,expectedHash:doc.hash}});
      lines.forEach((line,index)=>{if(/^\\s*(\`\`\`|~~~)/.test(line)){fence=!fence;return;}if(fence)return;
        for(const m of line.matchAll(/\\[\\[([^\\]#|]+)(?:[^\\]]*)\\]\\]/g)) {const target=m[1].trim();if(!ids.has(target)&&!names.has(target.toLowerCase().replace(/\\.md$/,''))) add(index+1,(files.hasMore?'Possibly unresolved':'Unresolved')+' note: '+target);}
        for(const m of line.matchAll(/(?:\\[|;|\\s)-?@([a-zA-Z0-9_:.+-]+)/g)) if(!keys.has(m[1])) add(index+1,(refs.hasMore?'Possibly unresolved':'Unresolved')+' citation: '+m[1]);
        for(const m of line.matchAll(/(?:\\{#((?:fig|eq)[\\w:.-]*)\\}|\\\\label\\{([^}]+)\\})/g)) {const key=m[1]||m[2];if(labels.has(key))add(index+1,'Repeated figure/equation label: '+key);labels.add(key);}
        if(/!\\[\\]\\([^)]+\\)/.test(line))add(index+1,'Image has no description');
      });
      await api.render({title:'Document Health',blocks:[{kind:'text',text:'Saved snapshot of '+doc.title+'. This is a bounded heuristic check, not a proof or exhaustive Markdown analysis.'},{kind:'notice',text:findings.length?findings.length+' finding(s). Links check that the saved source is unchanged before opening.':'No findings in this snapshot.',tone:findings.length?'warning':'success'},...findings.slice(0,90),...(findings.length>90?[{kind:'text',text:'Showing the first 90 findings.'}]:[])]});
    }};`,
  },
  {
    manifest: {
      id: "axiom.planning-brief",
      version: "1.0.1",
      name: "Planning Brief",
      description:
        "Summarize progress, blocked and overdue work and upcoming milestones, then prepare a reviewed Markdown report.",
      capabilities: ["planning:read", "files:propose"],
      commands: [
        {
          id: "axiom.planning-brief.open",
          title: "Prepare planning brief",
          description:
            "Summarize the selected workspace using a live saved planning snapshot.",
          icon: "ChartGantt",
          context: "planning",
          menu: true,
        },
        {
          id: "axiom.planning-brief.prepare",
          title: "Review planning brief",
          description: "Prepare a Markdown progress report for review.",
          icon: "ChartGantt",
          panelOnly: true,
        },
      ],
    },
    bundle: `export default {async run(api,ctx) {
      if(ctx.command.endsWith('.prepare')) {
        const name=String(ctx.inputs.title||'Planning brief');
        const result=await api.request('changes.prepare',{mutationId:api.createId(),title:'Create '+name,spaceIds:[ctx.spaceId],actions:[{key:'brief',action:'file_create',spaceId:ctx.spaceId,title:'Create '+name,payload:{type:'markdown',name,source:String(ctx.inputs.source||'')}}]});
        return api.render({title:'Planning Brief',blocks:[{kind:'notice',text:'The report is a proposal, not a created file. Planning may have changed since this snapshot.',tone:'info'},{kind:'review',label:'Review planning report',setId:result.id}]});
      }
      const data=await api.request('planning.read',{}),date=new Date().toISOString().slice(0,10),s=data.summary;
      const root='/workbench/workspaces/'+ctx.spaceId+'/planning';
      const rows=data.tasks.filter(t=>t.blocked||t.overdue).slice(0,100).map(t=>[t.title,t.status,t.blocked?'Blocked':t.overdue?'Overdue':'',t.due_on||'—']);
      const source='# Planning brief — '+date+'\\n\\n[Workspace plan]('+root+')\\n\\nSaved planning revision: '+data.version+'. This describes current state, not verified historical progress.\\n\\n## Summary\\n\\n- '+s.total+' tasks\\n- '+s.done+' complete\\n- '+s.blocked+' blocked\\n- '+s.overdue+' overdue\\n\\n## Blocked and overdue work\\n\\n'+(rows.length?rows.map(r=>'- '+r[0]+' — '+r[1]+', '+r[2].toLowerCase()+(r[3]!=='—'?', due '+r[3]:'')).join('\\n'):'No blocked or overdue tasks in the returned snapshot.')+'\\n\\n## Upcoming milestones\\n\\n'+data.milestones.map(m=>'- '+m.title+(m.due_on?' — '+m.due_on:'')).join('\\n')+'\\n\\n## Next steps\\n\\n- [ ] Confirm priorities and assignments\\n'+(data.hasMore?'\\nTask details are truncated to the first 1,000 items; summary counts cover the workspace.\\n':'');
      const clipped=source.length>16000,report=clipped?source.slice(0,15800)+'\\n\\nReport excerpt: content exceeded the field limit. See the workspace plan for the full list.\\n':source;
      await api.render({title:'Planning Brief',blocks:[{kind:'table',columns:['Tasks','Complete','Blocked','Overdue'],rows:[[String(s.total),String(s.done),String(s.blocked),String(s.overdue)]]},{kind:'field',field:{id:'title',label:'Report name',type:'text',required:true,value:'Planning brief — '+date}},{kind:'field',field:{id:'source',label:'Markdown report',type:'textarea',value:report}},{kind:'notice',text:clipped?'Report excerpt: the full list exceeds this panel’s field limit. Review the workspace plan before applying.':'Review this saved-state report before applying. It does not claim historical accomplishments.',tone:clipped?'warning':'info'},{kind:'action',label:'Prepare for review',command:'axiom.planning-brief.prepare',primary:true}]});
    }};`,
  },
];
let packages: ReturnType<typeof buildPackages> | undefined;
async function buildPackages() {
  return Promise.all(
    pilots.map((p) =>
      makePluginPackage(
        pluginManifestSchema.parse({
          format: "axiom-plugin",
          apiVersion: 1,
          author: "Axiom",
          license: "MIT",
          entry: "main.js",
          ...p.manifest,
        }),
        p.bundle,
      ),
    ),
  );
}
export const pilotPackages = () => (packages ??= buildPackages());
