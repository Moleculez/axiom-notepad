"use client";
import { NativeSelect } from "../ui/controls";
import { useState } from "react";
import { Copy, FolderOpen } from "lucide-react";
import type { Resource, ResourceLocation } from "@axiom/shared/workspace";
import { ErrorNotice, bytes, useData, useWorkspace } from "../workspace/ui";
export default function FileIdentity({
  resource,
  onVersion,
}: {
  resource: Resource;
  onVersion?: (id: string, mime: string) => void;
}) {
  const { navigate } = useWorkspace(),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState("");
  const location = useData<ResourceLocation>(
    expanded ? `resources/${resource.id}/location` : null,
  );
  const versions = useData<
    {
      id: string;
      ordinal: number;
      mime: string;
      bytes: number;
      created_at: string;
    }[]
  >(
    expanded && resource.kind === "file"
      ? `files/${resource.id}/versions`
      : null,
  );
  const usage = useData<{
    references: number;
    annotations: number;
    citations: number;
  }>(
    expanded && resource.kind === "file" ? `files/${resource.id}/usage` : null,
  );
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label + " copied");
      setError("");
    } catch {
      setError("Clipboard unavailable. Select and copy the identifier below.");
    }
  };
  return (
    <details
      className="media-identity"
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary>File identity & versions</summary>
      <ErrorNotice
        message={error || location.error || versions.error || usage.error}
      />
      <dl>
        <div>
          <dt>File code</dt>
          <dd>{resource.reference_code || "Not assigned"}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>
            {location.data
              ? [
                  location.data.space.name,
                  ...location.data.ancestors.map((entry) => entry.name),
                ].join(" / ")
              : "Loading…"}
          </dd>
        </div>
        <div>
          <dt>Internal ID</dt>
          <dd>
            <code>{resource.id}</code>
          </dd>
        </div>
        <div>
          <dt>Pinned version ID</dt>
          <dd>
            <code>{resource.current_version_id}</code>
          </dd>
        </div>
      </dl>
      {versions.data && (
        <label>
          Version
          <NativeSelect
            aria-label="File version"
            value={resource.current_version_id ?? ""}
            disabled={!onVersion}
            onChange={(e) => {
              const v = versions.data?.find(
                (item) => item.id === e.target.value,
              );
              if (v) onVersion?.(v.id, v.mime);
            }}
          >
            {versions.data.map((version) => (
              <option key={version.id} value={version.id}>
                Version {version.ordinal} · {bytes(version.bytes)} ·{" "}
                {new Date(version.created_at).toLocaleDateString()}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {usage.data && (
        <p className="ws-small muted">
          {usage.data.references} saved references · {usage.data.annotations}{" "}
          annotations · {usage.data.citations} citation links
        </p>
      )}
      <div className="media-identity-actions">
        <button
          title="Copy file link"
          onClick={() =>
            void copy(
              `${locationOrigin()}/workbench/notes/${resource.id}`,
              "File link",
            )
          }
        >
          <Copy size={14} />
          Link
        </button>
        <button
          title="Copy readable code"
          disabled={!resource.reference_code}
          onClick={() => void copy(resource.reference_code!, "File code")}
        >
          <Copy size={14} />
          Code
        </button>
        <button
          title="Copy internal ID"
          onClick={() => void copy(resource.id, "Internal ID")}
        >
          <Copy size={14} />
          ID
        </button>
        <button
          onClick={() =>
            navigate(
              `/workspaces/${resource.space_id}/files${resource.parent_id ? "?folder=" + resource.parent_id : ""}`,
            )
          }
        >
          <FolderOpen size={14} />
          Reveal
        </button>
      </div>
      <small role="status">{copied}</small>
    </details>
  );
}
function locationOrigin() {
  return window.location.origin;
}
