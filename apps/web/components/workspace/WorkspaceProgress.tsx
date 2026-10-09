"use client";
import { uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { useSyncExternalStore } from "react";
import { workspaceActivity } from "../../lib/workspace-activity";

export default function WorkspaceProgress() {
  useInterfaceLocale();
  const phase = useSyncExternalStore(
    workspaceActivity.subscribe,
    workspaceActivity.getSnapshot,
    () => "idle",
  );
  return (
    <>
      <div
        className="workspace-progress"
        data-phase={phase}
        role="progressbar"
        aria-label={uiText("Workspace loading")}
        aria-valuetext={phase === "loading" ? "Loading" : "Finished"}
        aria-hidden={phase === "idle" ? true : undefined}
      >
        <span className="workspace-progress-fill" />
      </div>
      <span className="workspace-loading-announcement" role="status">
        {phase === "loading" ? uiText("Loading workspace content…") : ""}
      </span>
    </>
  );
}
