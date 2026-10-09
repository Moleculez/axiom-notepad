"use client";
import { currentLocale } from "@axiom/i18n/client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, IconButton } from "../ui/controls";
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
import ResourceSharing from "../workspace/ResourceSharing";
export default function TextStudio({ project }: { project: ToolProject }) {
  useInterfaceLocale();
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
          <I18nText id="← Explorer" />
        </WorkspaceLink>
        <h1>{project.name}</h1>
        <ResourceSharing resourceId={project.resource_id} />
        <span className="tool-spacer" />
        <IconButton
          className="icon-button"
          title={uiText("Undo")}
          aria-label={uiText("Undo")}
          disabled={shared.readOnly}
          onClick={() => shared.binding?.history(false)}
        >
          <Undo2 size={17} />
        </IconButton>
        <IconButton
          className="icon-button"
          title={uiText("Redo")}
          aria-label={uiText("Redo")}
          disabled={shared.readOnly}
          onClick={() => shared.binding?.history(true)}
        >
          <Redo2 size={17} />
        </IconButton>
        <IconButton
          className="icon-button"
          title={uiText("Download source")}
          aria-label={uiText("Download source")}
          onClick={() =>
            downloadText(
              shared.source,
              project.name.includes(".") ? project.name : `${project.name}.txt`,
            )
          }
        >
          <Download size={17} />
        </IconButton>
        <IconButton
          className="icon-button"
          title={uiText("Discussion")}
          aria-label={uiText("Discussion")}
          aria-pressed={discussion}
          onClick={() => setDiscussion(!discussion)}
        >
          <MessageSquare size={17} />
        </IconButton>
      </header>
      <ErrorNotice message={shared.error} />
      {shared.recovery !== null && (
        <div className="tool-recovery">
          <Button
            className="button secondary"
            onClick={() =>
              downloadText(shared.recovery!, `${project.name}-recovered.txt`)
            }
          >
            <I18nText id="Export retained draft" />
          </Button>
          <Button className="button ghost" onClick={shared.reopen}>
            <I18nText id="Reopen server version" />
          </Button>
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
          {shared.source.length.toLocaleString(currentLocale())}{" "}
          <I18nText id="characters ·" />{" "}
          {shared.source.split("\n").length.toLocaleString(currentLocale())}{" "}
          <I18nText id="lines" />
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
