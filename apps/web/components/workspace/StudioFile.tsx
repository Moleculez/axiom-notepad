"use client";
import dynamic from "next/dynamic";
import type { ToolProject } from "@axiom/shared/research-tools";
import type { Resource } from "@axiom/shared/workspace";
import { ErrorNotice, Loading, useData, useWorkspace } from "./ui";
const MathStudio = dynamic(() => import("../tools/MathStudio"), { ssr: false });
const CanvasStudio = dynamic(() => import("../tools/CanvasStudio"), {
  ssr: false,
});
const ImageStudio = dynamic(() => import("../tools/ImageStudio"), {
  ssr: false,
});
const TextStudio = dynamic(() => import("../tools/TextStudio"), { ssr: false });

/** Only the requested file is fetched; there is no studio library or second resource identity. */
export default function StudioFile({
  resource,
  route,
}: {
  resource: Resource;
  route?: string;
}) {
  const { revision } = useWorkspace();
  const project = useData<ToolProject>(`tools/${resource.id}`, revision);
  const params = new URL(route ?? "/", "http://workspace.local").searchParams;
  if (project.error)
    return <ErrorNotice message={project.error} retry={project.reload} />;
  if (!project.data) return <Loading label={`Opening ${resource.name}…`} />;
  return (
    <section className="file-studio-view" aria-label={resource.name}>
      {project.data.kind === "canvas" ? (
        <CanvasStudio project={project.data} />
      ) : project.data.kind === "math" ? (
        <MathStudio project={project.data} />
      ) : project.data.kind === "text" ? (
        <TextStudio project={project.data} />
      ) : (
        <ImageStudio
          project={project.data}
          importFile={params.get("file")}
          importVersion={params.get("file") ? params.get("version") : null}
        />
      )}
    </section>
  );
}
