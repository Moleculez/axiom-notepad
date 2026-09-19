"use client";
import { useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { fileTypes, type FileType } from "@axiom/shared/file-types";
import { fileRoute } from "@axiom/shared/file-routes";
import type { Resource } from "@axiom/shared/workspace";
import { post } from "../../lib/client";
import { useWorkSessions } from "../../lib/workspace-sessions";
import type { FileCreationRequest } from "../../lib/file-creation";
import Dialog from "../Dialog";
import { ErrorNotice, go, useData, useLocation, useWorkspace } from "./ui";

export default function NewFileDialog({
  type,
  target,
  importFile,
  importVersion,
  onClose,
}: FileCreationRequest & { onClose: () => void }) {
  const { navigate, refresh, spaces, notify, session } = useWorkspace();
  const tabs = useWorkSessions();
  const owner = useRef({ tab: tabs?.state.active, user: session.user.id });
  const current = useRef({ tabs, session });
  current.current = { tabs, session };
  const [name, setName] = useState("");
  const [spaceId, setSpaceId] = useState(target?.spaceId ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false),
    alive = useRef(true);
  const [mutationId] = useState(() => crypto.randomUUID());
  const info = fileTypes.find((t) => t.id === type)!;
  const parentId = spaceId === target?.spaceId ? target.parentId : null;
  const parent = useData<Resource>(parentId ? `resources/${parentId}` : null);
  const writable = spaces.filter(
    (space) => space.role === "editor" && space.effective_status === "active",
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <Dialog
      title={`New ${info.label.toLowerCase()}`}
      subtitle={info.description}
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            pending.current ||
            !writable.some((space) => space.id === spaceId)
          )
            return;
          pending.current = true;
          setBusy(true);
          setError("");
          try {
            const result = await post("files/new", {
              type,
              name: name.trim() || `Untitled.${info.extension}`,
              spaceId,
              parentId,
              mutationId,
            });
            if (
              !alive.current ||
              current.current.session.user.id !== owner.current.user
            )
              return;
            refresh();
            onClose();
            const documentType = ["csv", "json", "yaml"].includes(type)
              ? "text"
              : type;
            const resource = {
              id: result.id,
              kind: result.kind,
              document_type: ["docx", "xlsx", "pptx"].includes(type)
                ? undefined
                : (documentType as Resource["document_type"]),
              mime:
                type === "docx"
                  ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  : type === "xlsx"
                    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    : type === "pptx"
                      ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                      : undefined,
            };
            const destination = new URL(
              fileRoute(resource),
              "http://workspace.local",
            );
            if (importFile && type === "image") {
              destination.searchParams.set("file", importFile);
              if (importVersion)
                destination.searchParams.set("version", importVersion);
            }
            if (
              !owner.current.tab ||
              current.current.tabs?.state.active === owner.current.tab
            )
              navigate(destination.pathname + destination.search);
            else
              notify(
                `Created ${name.trim() || `Untitled.${info.extension}`}. It is available in Explorer.`,
              );
          } catch (error) {
            if (alive.current) setError((error as Error).message);
          } finally {
            pending.current = false;
            if (alive.current) setBusy(false);
          }
        }}
      >
        <label>
          Name
          <input
            autoFocus
            value={name}
            maxLength={150}
            placeholder={`Untitled.${info.extension}`}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Workspace
          <select
            required
            value={spaceId}
            disabled={busy}
            onChange={(event) => setSpaceId(event.target.value)}
          >
            <option value="" disabled>
              Choose a workspace…
            </option>
            {writable.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
        <p className="file-create-location">
          <FolderOpen size={16} />
          {parentId
            ? (parent.data?.name ?? "Selected folder")
            : "Workspace root"}
        </p>
        {importFile && (
          <p className="ws-note">
            A new editable copy will be created. The original image and its
            history stay unchanged.
          </p>
        )}
        {!writable.length && (
          <p className="ws-note">
            You need editor access to an active workspace to create files.
          </p>
        )}
        <ErrorNotice message={error || parent.error} />
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !writable.some((space) => space.id === spaceId)}
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Links and all application surfaces share this dialog, never a creation page. */
export function FileCreationHost() {
  const { params, path } = useLocation();
  const [request, setRequest] = useState<
    (FileCreationRequest & { key: string }) | null
  >(null);
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<FileCreationRequest>).detail;
      if (fileTypes.some((type) => type.id === detail?.type))
        setRequest({ ...detail, key: crypto.randomUUID() });
    };
    window.addEventListener("axiom:create-file", listener);
    return () => window.removeEventListener("axiom:create-file", listener);
  }, []);
  const create = params.get("create");
  useEffect(() => {
    if (!create || !fileTypes.some((type) => type.id === create)) return;
    const query = new URLSearchParams(location.search);
    setRequest({
      type: create as FileType,
      key: crypto.randomUUID(),
      target: query.get("space")
        ? { spaceId: query.get("space")!, parentId: query.get("folder") }
        : undefined,
      importFile: query.get("file") ?? undefined,
      importVersion: query.get("version") ?? undefined,
    });
    for (const key of ["create", "file", "version"]) query.delete(key);
    go(path + (query.size ? `?${query}` : ""), true, true);
  }, [create, path]);
  if (!request) return null;
  const { key, ...options } = request;
  return (
    <NewFileDialog key={key} {...options} onClose={() => setRequest(null)} />
  );
}
