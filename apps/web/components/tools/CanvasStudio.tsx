"use client";
import { I18nText } from "@axiom/i18n/react";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { ToolProject } from "@axiom/shared/research-tools";
import type { Resource, ResourcePage } from "@axiom/shared/workspace";
import { openAssistant } from "../../lib/assistant";
import { api } from "../../lib/client";
import { useToolDocument } from "../../lib/tools/use-tool-document";
import { useWorkspace, WorkspaceLink } from "../workspace/ui";
import { CanvasHostContext, type CanvasHost } from "./CanvasHost";
import {
  CanvasSurface as BrowserCanvasSurface,
  type CanvasSession,
} from "./CanvasSurface";
import ResourceSharing from "../workspace/ResourceSharing";
import ResourceDiscussion from "./ResourceDiscussion";

const FilePreviewSurface = dynamic(() => import("./FilePreviewSurface"), {
  ssr: false,
});
const CanvasExportDialog = dynamic(() => import("./CanvasExportDialog"), {
  ssr: false,
});
export type { CanvasSession } from "./CanvasSurface";

/** Authenticated services remain outside the reusable browser canvas. */
export default function CanvasStudio({ project }: { project: ToolProject }) {
  const { session } = useWorkspace();
  const shared = useToolDocument(
    project.resource_id,
    project.generation ?? 1,
    session.user,
    project.role === "editor",
    "canvas",
  );
  return <CanvasSurface project={project} shared={shared} />;
}
export function CanvasSurface({
  project,
  shared,
  sandbox = false,
}: {
  project: ToolProject;
  shared: CanvasSession;
  sandbox?: boolean;
}) {
  const { session, appearance, editorSettings, notify, open, revision } =
    useWorkspace();
  const host = useMemo<CanvasHost>(
    () => ({
      identity: session.user.id,
      revision,
      appearance,
      editorSettings,
      notify,
      open,
      resources: async (query, signal) =>
        (
          await api<ResourcePage>(
            `resources?view=all&spaceId=${project.space_id}&q=${encodeURIComponent(query)}`,
            { signal },
          )
        ).items,
      resource: (id) => api<Resource>(`resources/${id}`),
      resolvePreview: (id, version, signal) =>
        api(
          `resources/${id}/card-preview${version ? `?version=${version}` : ""}`,
          { signal },
        ),
      renderFile: (file, onReload) => (
        <FilePreviewSurface
          resourceId={file.resourceId}
          versionId={file.versionId}
          compact
          initialManifest={file}
          onReload={onReload}
        />
      ),
      sharing: <ResourceSharing resourceId={project.resource_id} />,
      explorer: (
        <WorkspaceLink
          className="button ghost"
          to={`/explorer?space=${project.space_id}${project.parent_id ? `&folder=${project.parent_id}` : ""}`}
        >
          <I18nText id="← Explorer" />
        </WorkspaceLink>
      ),
      discussion: (cardId, names, select) => (
        <ResourceDiscussion
          key={cardId ?? "whole"}
          resourceId={project.resource_id}
          canComment={project.role !== "viewer"}
          fixedAnchor={
            cardId ? { kind: "canvas-node", nodeId: cardId } : undefined
          }
          anchorLabel={(anchor) =>
            anchor.kind === "canvas-node"
              ? (names.get(String(anchor.nodeId)) ?? "Removed card")
              : "Whole canvas"
          }
          onAnchor={(anchor) => select(String(anchor.nodeId))}
        />
      ),
      assistant: async (nodeIds) => {
        const snapshot = await api<{ source: string; hash: string }>(
          `resources/${project.resource_id}/history/current`,
        );
        openAssistant({
          spaceId: project.space_id,
          selection: {
            kind: "canvas",
            id: project.resource_id,
            nodeIds,
            hash: snapshot.hash,
          },
          selectionLabel: `${nodeIds.length} canvas cards`,
          prompt:
            "Summarize the selected cards and connections. Identify open questions without treating linked files as included evidence.",
        });
      },
      export: (options) => (
        <CanvasExportDialog
          {...options}
          resourceId={project.resource_id}
          spaceId={project.space_id}
        />
      ),
    }),
    [
      session.user.id,
      appearance,
      editorSettings,
      notify,
      open,
      revision,
      project.resource_id,
      project.space_id,
      project.parent_id,
      project.role,
    ],
  );
  return (
    <CanvasHostContext.Provider value={host}>
      <BrowserCanvasSurface
        project={project}
        shared={shared}
        sandbox={sandbox}
      />
    </CanvasHostContext.Provider>
  );
}
