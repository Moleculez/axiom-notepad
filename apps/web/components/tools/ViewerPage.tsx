"use client";
import { useState } from "react";
import { FileSearch, Search, ArrowLeft, ExternalLink } from "lucide-react";
import type { Resource, ResourcePage } from "@axiom/shared/workspace";
import FilePreviewSurface from "./FilePreviewSurface";
import {
  bytes,
  ErrorNotice,
  Loading,
  ResourceIcon,
  useData,
  useWorkspace,
  WorkspaceLink,
} from "../workspace/ui";
export default function ViewerPage() {
  const { spaces, open } = useWorkspace(),
    [search, setSearch] = useState(""),
    [space, setSpace] = useState(""),
    [file, setFile] = useState<Resource | null>(null);
  const data = useData<ResourcePage>(
    `resources?kind=file&view=all&limit=100${space ? `&spaceId=${space}` : ""}${search ? `&q=${encodeURIComponent(search)}` : ""}`,
  );
  return (
    <main className="research-studio file-viewer-studio">
      <header className="studio-header">
        <WorkspaceLink
          to="/tools"
          className="icon-button"
          aria-label="Back to tools"
        >
          <ArrowLeft size={18} />
        </WorkspaceLink>
        <FileSearch size={21} />
        <div className="studio-title">
          <span>Research tools</span>
          <h1>File viewer</h1>
        </div>
        <span className="tool-spacer" />
        {file && (
          <button className="button secondary" onClick={() => open(file)}>
            <ExternalLink size={15} />
            Open full file tab
          </button>
        )}
      </header>
      <div className="studio-body">
        <aside className="viewer-file-picker">
          <label className="tool-search">
            <Search size={15} />
            <input
              aria-label="Find a file to preview"
              value={search}
              placeholder="Find a file…"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="Preview workspace"
            value={space}
            onChange={(e) => setSpace(e.target.value)}
          >
            <option value="">All accessible workspaces</option>
            {spaces.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <ErrorNotice message={data.error} />
          {data.loading ? (
            <Loading />
          ) : data.data?.items.length ? (
            data.data.items.map((r) => (
              <button
                key={r.id}
                className="viewer-file-row"
                aria-pressed={file?.id === r.id}
                onClick={() => setFile(r)}
              >
                <ResourceIcon resource={r} />
                <span>
                  <strong>{r.name}</strong>
                  <small>{bytes(r.bytes)}</small>
                </span>
              </button>
            ))
          ) : (
            <p className="ws-note">
              No matching files. Upload originals in Explorer to preview them
              here.
            </p>
          )}
        </aside>
        <div className="viewer-main">
          {file ? (
            <FilePreviewSurface
              key={file.id}
              resourceId={file.id}
              versionId={file.current_version_id}
            />
          ) : (
            <div className="tool-preview-fallback">
              <FileSearch size={44} strokeWidth={1} />
              <h2>Inspect your research files</h2>
              <p>
                Choose an image, recording, paper, text file, dataset, or Office
                document. Originals stay unchanged.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
