"use client";
import { useState } from "react";
import { Download, MessageSquare, Undo2, Redo2 } from "lucide-react";
import type { ToolProject } from "@axiom/shared/research-tools";
import { useToolDocument } from "../../lib/tools/use-tool-document";
import { downloadText } from "../../lib/tools/download";
import {
  ErrorNotice,
  Loading,
  useWorkspace,
  WorkspaceLink,
} from "../workspace/ui";
import StudioSource from "./StudioSource";
import ResourceDiscussion from "./ResourceDiscussion";
export default function TextStudio({ project }: { project: ToolProject }) {
  const { session } = useWorkspace(),
    shared = useToolDocument(
      project.resource_id,
      project.generation ?? 1,
      session.user,
      project.role === "editor",
      "text",
    );
  const [discussion, setDiscussion] = useState(false);
  const extension = project.name.split(".").pop()?.toLowerCase();
  return (
    <main className="plain-text-studio tool-studio">
      <header className="canvas-header">
        <WorkspaceLink
          className="button ghost"
          to={`/explorer?space=${project.space_id}${project.parent_id ? `&folder=${project.parent_id}` : ""}`}
        >
          ← Explorer
        </WorkspaceLink>
        <h1>{project.name}</h1>
        <span className="tool-spacer" />
        <button
          className="icon-button"
          title="Undo"
          aria-label="Undo"
          disabled={shared.readOnly}
          onClick={() => shared.binding?.history(false)}
        >
          <Undo2 size={17} />
        </button>
        <button
          className="icon-button"
          title="Redo"
          aria-label="Redo"
          disabled={shared.readOnly}
          onClick={() => shared.binding?.history(true)}
        >
          <Redo2 size={17} />
        </button>
        <button
          className="icon-button"
          title="Download source"
          aria-label="Download source"
          onClick={() =>
            downloadText(
              shared.source,
              project.name.includes(".") ? project.name : `${project.name}.txt`,
            )
          }
        >
          <Download size={17} />
        </button>
        <button
          className="icon-button"
          title="Discussion"
          aria-label="Discussion"
          aria-pressed={discussion}
          onClick={() => setDiscussion(!discussion)}
        >
          <MessageSquare size={17} />
        </button>
      </header>
      <ErrorNotice message={shared.error} />
      {shared.recovery !== null && (
        <div className="tool-recovery">
          <button
            className="button secondary"
            onClick={() =>
              downloadText(shared.recovery!, `${project.name}-recovered.txt`)
            }
          >
            Export retained draft
          </button>
          <button className="button ghost" onClick={shared.reopen}>
            Reopen server version
          </button>
        </div>
      )}
      <div className="plain-text-body">
        {shared.binding ? (
          <StudioSource
            binding={shared.binding}
            readOnly={shared.readOnly}
            language={
              ["json", "yaml", "csv"].includes(extension ?? "")
                ? extension
                : "text"
            }
          />
        ) : (
          <Loading />
        )}
        {discussion && (
          <aside className="canvas-inspector">
            <ResourceDiscussion
              resourceId={project.resource_id}
              canComment={project.role === "editor"}
              kinds={["whole", "line"]}
            />
          </aside>
        )}
      </div>
      <footer className="canvas-status">
        <span role="status">{shared.status}</span>
        <span>
          {shared.source.length.toLocaleString()} characters ·{" "}
          {shared.source.split("\n").length.toLocaleString()} lines
        </span>
        <span>
          {shared.peers.length
            ? `${shared.peers.length + 1} collaborators`
            : shared.readOnly
              ? "Read only"
              : "Plain text · collaborative"}
        </span>
      </footer>
    </main>
  );
}
