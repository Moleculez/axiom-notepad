"use client";
import { useRef } from "react";
import type { ResourcePage } from "@axiom/shared/workspace";
import ReferenceLibrary from "../ReferenceLibrary";
import Graph from "../Graph";
import { api } from "../../lib/client";
import { useResearch } from "../../lib/research-store";
import { Empty, ErrorNotice, Loading, useAction, useData, useLocation, useWorkspace, WorkspaceLink } from "./ui";

export default function ResearchCollection({ view }: { view: "references" | "graph" }) {
  const { session, spaces, revision, refresh, navigate, open } = useWorkspace(), { params } = useLocation();
  const group = params.get("group") ?? session.groups[0]?.id ?? "";
  const groupData = useData(group ? `workspace?groupId=${encodeURIComponent(group)}` : null, revision);
  const personal = spaces.find(space => space.kind === "personal");
  const privateData = useData<ResourcePage>(!group && personal ? `resources?spaceId=${personal.id}&view=all&kind=note&limit=100` : null, revision);
  const research = useResearch(session.user.id, group || personal?.id), action = useAction(), input = useRef<HTMLInputElement>(null);
  return <main className="ws-page ws-research-collection">
    <div className="ws-list-toolbar"><nav className="ws-segmented" aria-label="Research collections"><WorkspaceLink to="/research">Overview</WorkspaceLink><WorkspaceLink to="/research/references" aria-current={view === "references" ? "page" : undefined}>References</WorkspaceLink><WorkspaceLink to="/research/graph" aria-current={view === "graph" ? "page" : undefined}>Knowledge graph</WorkspaceLink></nav>
    <label>Research group<select aria-label="Research group" value={group} onChange={event => navigate(`/research/${view}?group=${event.target.value}`)}>{!session.groups.length && <option value="">Personal space</option>}{session.groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    <ErrorNotice message={groupData.error || privateData.error || action.error} retry={groupData.error ? groupData.reload : privateData.error ? privateData.reload : undefined} />
    {groupData.loading && <Loading />}
    {view === "graph" && <Graph notes={groupData.data?.notes ?? privateData.data?.items.map(item => ({ ...item, title: item.name })) ?? []} links={groupData.data?.links ?? []} open={id => open({ id, kind: "note" })} />}
    {view === "references" && (!group ? <Empty title="References belong to a research group">Your private note citation snapshots remain available in each note. Join or create a group to build a shared reference library.</Empty> : groupData.data && <ReferenceLibrary groupId={group} references={groupData.data.references} notes={groupData.data.notes} projects={groupData.data.projects} research={research} readOnly={spaces.find(space => space.kind === "team" && space.group_id === group)?.role !== "editor"} onRefresh={async () => { groupData.reload(); refresh(); }} onImport={() => input.current?.click()} onOpenNote={id => open({ id, kind: "note" })} onOpenPaper={paper => { void action.run(async () => { const item = await api(`attachments/${paper.id}/resource`); open({ id: item.id, kind: "file", versionId: paper.id }); }); }} />)}
    <input ref={input} type="file" accept=".bib" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void action.run(async () => { if (file.size > 2_000_000) throw new Error("Choose a BibTeX file up to 2 MB."); await api(`references?groupId=${group}`, { method: "PUT", body: JSON.stringify({ bibtex: await file.text() }) }); groupData.reload(); refresh(); }); }} />
  </main>;
}
