"use client";
import dynamic from "next/dynamic";

// The public offline shell contains no account data or browser editor engine.
// Loading this boundary only in the browser also keeps the CRDT implementation
// from being instantiated by both the server and client render bundles.
const WorkspaceApp = dynamic(() => import("./WorkspaceApp"), {
  ssr: false,
  loading: () => (
    <div className="ws-boot" role="status">
      Opening your workspace…
    </div>
  ),
});
export default WorkspaceApp;
