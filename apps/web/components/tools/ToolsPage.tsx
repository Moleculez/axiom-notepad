"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Sigma,
  Image,
  FileSearch,
  Plus,
  ArrowUpRight,
  Clock,
  FolderOpen,
  Network,
  Braces,
} from "lucide-react";
import type { ToolProject } from "@axiom/shared/research-tools";
import { post } from "../../lib/client";
import { useAppTabs } from "../../lib/application-tabs";
import {
  ErrorNotice,
  Loading,
  PageHeading,
  useData,
  useLocation,
  useWorkspace,
  WorkspaceLink,
  go,
} from "../workspace/ui";
const MathStudio = dynamic(() => import("./MathStudio"), {
  ssr: false,
  loading: () => <Loading label="Opening Math Studio…" />,
});
const ImageStudio = dynamic(() => import("./ImageStudio"), {
  ssr: false,
  loading: () => <Loading label="Opening Image Studio…" />,
});
const ViewerPage = dynamic(() => import("./ViewerPage"), { ssr: false });
const CanvasStudio = dynamic(() => import("./CanvasStudio"), {
  ssr: false,
  loading: () => <Loading label="Opening Canvas…" />,
});
const TextStudio = dynamic(() => import("./TextStudio"), { ssr: false });
const studios = ["math", "image", "canvas", "text"];
export default function ToolsPage({
  kind,
  id,
}: {
  kind?: string;
  id?: string;
}) {
  const { spaces, revision, refresh, notify } = useWorkspace(),
    { params } = useLocation();
  const tabs = useAppTabs();
  const projects = useData<ToolProject[]>("tools", revision),
    project = useData<ToolProject>(
      id && id !== "new" ? `tools/${id}` : null,
      revision,
    );
  const [name, setName] = useState(""),
    [space, setSpace] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (project.data)
      window.dispatchEvent(
        new CustomEvent("axiom:tab-title", {
          detail: {
            path: `/tools/${project.data.kind}/${project.data.resource_id}`,
            title: project.data.name,
          },
        }),
      );
  }, [project.data?.name, project.data?.resource_id]);
  if (kind === "viewer") return <ViewerPage />;
  if (studios.includes(kind ?? "") && id && id !== "new")
    return project.error ? (
      <ErrorNotice message={project.error} retry={project.reload} />
    ) : !project.data ? (
      <Loading />
    ) : project.data.kind !== kind ? (
      <ErrorNotice message="This project belongs to a different studio." />
    ) : kind === "canvas" ? (
      <CanvasStudio key={id} project={project.data} />
    ) : kind === "text" ? (
      <TextStudio key={id} project={project.data} />
    ) : kind === "math" ? (
      <MathStudio key={id} project={project.data} />
    ) : (
      <ImageStudio
        key={id}
        project={project.data}
        importFile={params.get("file")}
        importVersion={params.get("version")}
      />
    );
  if (studios.includes(kind ?? "") && id === "new")
    return (
      <main className="ws-page tools-create">
        <WorkspaceLink to="/tools" className="button ghost">
          ← Research tools
        </WorkspaceLink>
        <div className="tool-create-card">
          {kind === "canvas" ? (
            <Network size={32} />
          ) : kind === "text" ? (
            <Braces size={32} />
          ) : kind === "math" ? (
            <Sigma size={32} />
          ) : (
            <Image size={32} />
          )}
          <h1>
            New {kind} {kind === "text" ? "file" : "project"}
          </h1>
          <p>
            {kind === "canvas"
              ? "Connect research notes, papers, images, and ideas on a collaborative infinite canvas."
              : kind === "text"
                ? "A clean, collaborative source editor for text, data, and code."
                : kind === "math"
                  ? "A live, collaborative LaTeX workspace with visual input and publication-ready exports."
                  : "A layered, non-destructive workspace. The original image stays untouched."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              const creationTab = tabs?.active;
              void post("tools", {
                kind,
                name:
                  name.trim() ||
                  (kind === "math"
                    ? "Untitled equation"
                    : kind === "canvas"
                      ? "Untitled canvas"
                      : kind === "text"
                        ? "Untitled.txt"
                        : "Untitled image"),
                spaceId:
                  space ||
                  params.get("space") ||
                  spaces.find(
                    (s) =>
                      s.role === "editor" && s.effective_status === "active",
                  )?.id,
                mutationId: crypto.randomUUID(),
                parentId: params.get("folder"),
                source: kind === "math" ? "E = mc^2" : "",
              })
                .then((result) => {
                  refresh();
                  const q = new URLSearchParams();
                  if (params.get("file")) q.set("file", params.get("file")!);
                  if (params.get("version"))
                    q.set("version", params.get("version")!);
                  const destination = `/tools/${kind}/${result.id}${q.size ? "?" + q : ""}`;
                  if (tabs && creationTab) {
                    if (
                      !tabs.replace(
                        creationTab.id,
                        destination,
                        creationTab.path,
                      )
                    )
                      notify(
                        "Project created. You can open it from Research tools or Explorer.",
                      );
                  } else go(destination, true);
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Project name
              <input
                autoFocus
                maxLength={160}
                placeholder={
                  kind === "math" ? "Untitled equation" : `Untitled ${kind}`
                }
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Workspace
              <select
                value={
                  space ||
                  params.get("space") ||
                  spaces.find(
                    (s) =>
                      s.role === "editor" && s.effective_status === "active",
                  )?.id ||
                  ""
                }
                onChange={(e) => setSpace(e.target.value)}
              >
                {spaces
                  .filter(
                    (s) =>
                      s.role === "editor" && s.effective_status === "active",
                  )
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <ErrorNotice message={error} />
            <button
              className="button primary"
              disabled={
                busy ||
                !spaces.some(
                  (s) => s.role === "editor" && s.effective_status === "active",
                )
              }
            >
              <Plus size={16} />
              {busy ? "Creating…" : "Create project"}
            </button>
          </form>
        </div>
      </main>
    );
  return (
    <main className="ws-page tools-hub">
      <PageHeading eyebrow="Research workspace" title="Tools">
        From an idea to a clear equation, figure, or finding. Your files stay in
        your workspace.
      </PageHeading>
      <div className="tool-launchers">
        {[
          [
            "canvas",
            "Canvas",
            "Connect ideas, notes, figures, and papers on a shared infinite canvas.",
            Network,
          ],
          [
            "text",
            "Text editor",
            "Collaborative plain text, data, and code without Markdown interpretation.",
            Braces,
          ],
          [
            "math",
            "Math Studio",
            "Write LaTeX, explore symbols, and compose equations together.",
            Sigma,
          ],
          [
            "image",
            "Image Studio",
            "Build layered figures and edit images without changing the original.",
            Image,
          ],
          [
            "viewer",
            "File viewer",
            "Inspect papers, recordings, data, and documents in one place.",
            FileSearch,
          ],
        ].map(([k, title, description, Icon]) => {
          const Glyph = Icon as typeof Sigma;
          return (
            <WorkspaceLink
              key={String(k)}
              to={k === "viewer" ? "/tools/viewer" : `/tools/${k}/new`}
              className="tool-launcher"
            >
              <span className="tool-launcher-icon">
                <Glyph size={25} strokeWidth={1.5} />
              </span>
              <h2>{String(title)}</h2>
              <p>{String(description)}</p>
              <span className="tool-launcher-link">
                {k === "viewer" ? "Browse files" : "Create project"}
                <ArrowUpRight size={15} />
              </span>
            </WorkspaceLink>
          );
        })}
      </div>
      <div className="tools-section-heading">
        <h2>
          <Clock size={18} />
          Recent studio projects
        </h2>
        <WorkspaceLink to="/explorer" className="button ghost">
          <FolderOpen size={15} />
          Explorer
        </WorkspaceLink>
      </div>
      <ErrorNotice message={projects.error} retry={projects.reload} />
      {projects.loading ? (
        <Loading />
      ) : projects.data?.length ? (
        <div className="tool-project-list">
          {projects.data.map((p) => (
            <WorkspaceLink
              className="tool-project-row"
              key={p.resource_id}
              to={`/tools/${p.kind}/${p.resource_id}`}
            >
              <span className="tool-project-kind">
                {p.kind === "canvas" ? (
                  <Network size={18} />
                ) : p.kind === "text" ? (
                  <Braces size={18} />
                ) : p.kind === "math" ? (
                  <Sigma size={18} />
                ) : (
                  <Image size={18} />
                )}
              </span>
              <strong>{p.name}</strong>
              <span>{spaces.find((s) => s.id === p.space_id)?.name}</span>
              <time>{new Date(p.updated_at).toLocaleDateString()}</time>
              <ArrowUpRight size={15} />
            </WorkspaceLink>
          ))}
        </div>
      ) : (
        <p className="ws-note">
          Create a studio project to start. Notes, collaboration, and your
          original files stay where they are.
        </p>
      )}
    </main>
  );
}
