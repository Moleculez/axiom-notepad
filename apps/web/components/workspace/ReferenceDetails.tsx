"use client";
import { useState } from "react";
import {
  Copy,
  ExternalLink,
  FileText,
  Link2,
  Network,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import type {
  LibraryReference,
  LibraryScope,
} from "@axiom/shared/research-library";
import { libraryDraftSchema } from "@axiom/shared/research-library";
import type { ReferenceDetails } from "@axiom/shared/research";
import Dialog, { DialogFooter } from "../Dialog";
import ResizablePanel from "../ResizablePanel";
import InsertResource from "./InsertResource";
import { api } from "../../lib/client";
import { ErrorNotice, useAction, useData, useWorkspace, mutate } from "./ui";
const blank: ReferenceDetails = {
  title: "",
  authors: "",
  year: "",
  venue: "",
  doi: "",
  arxiv: "",
  url: "",
};
export const referenceLabels: Record<keyof ReferenceDetails, string> = {
  title: "Title",
  authors: "Authors",
  year: "Year",
  venue: "Journal / venue",
  doi: "DOI",
  arxiv: "arXiv ID",
  url: "Source URL",
};
export function referenceDraft(r?: ReferenceDetails) {
  return r
    ? (Object.fromEntries(
        Object.keys(blank).map((k) => [
          k,
          r[k as keyof ReferenceDetails] ?? "",
        ]),
      ) as ReferenceDetails)
    : blank;
}
export function ReferenceFields({
  value,
  onChange,
}: {
  value: ReferenceDetails;
  onChange: (v: ReferenceDetails) => void;
}) {
  return (
    <div className="library-property-grid">
      {Object.entries(referenceLabels).map(([key, label]) => (
        <label key={key}>
          <span>{label}</span>
          <input
            aria-label={`Reference ${key}`}
            type={key === "url" ? "url" : "text"}
            value={value[key as keyof ReferenceDetails]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            maxLength={
              key === "title"
                ? 200
                : key === "authors"
                  ? 2000
                  : key === "venue"
                    ? 500
                    : key === "year"
                      ? 20
                      : key === "arxiv"
                        ? 100
                        : key === "doi"
                          ? 300
                          : 2000
            }
          />
        </label>
      ))}
    </div>
  );
}
export function ReferenceForm({
  scope,
  reference,
  onClose,
  onSaved,
}: {
  scope: LibraryScope;
  reference?: LibraryReference;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [draft, setDraft] = useState(() => referenceDraft(reference)),
    [citeKey, setKey] = useState(reference?.cite_key ?? ""),
    [tags, setTags] = useState(reference?.tags.join(", ") ?? ""),
    [identifier, setIdentifier] = useState(""),
    [preview, setPreview] = useState<{
      provider: string;
      details: ReferenceDetails;
    } | null>(null);
  const action = useAction();
  return (
    <Dialog
      title={reference ? "Edit reference" : "Add reference"}
      onClose={onClose}
      wide
    >
      <div className="library-lookup">
        <label>
          DOI or arXiv identifier
          <input
            aria-label="Lookup identifier"
            placeholder="10.… or arXiv ID"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </label>
        <button
          className="button secondary"
          disabled={action.busy || !identifier.trim()}
          onClick={() =>
            void action.run(async () =>
              setPreview(
                await api("references/lookup", {
                  method: "POST",
                  body: JSON.stringify({ spaceId: scope.spaceId, identifier }),
                }),
              ),
            )
          }
        >
          <Search size={15} />
          Look up
        </button>
      </div>
      <p className="muted">
        Only the identifier is sent to Crossref or arXiv, when you choose Look
        up.
      </p>
      {preview && (
        <div className="research-notice">
          <strong>{preview.details.title}</strong>
          <p>
            {preview.details.authors} · {preview.provider}
          </p>
          <button
            className="button secondary"
            onClick={() => {
              setDraft(preview.details);
              if (!citeKey)
                setKey(
                  (
                    preview.details.authors
                      .split(" and ")[0]
                      .split(" ")
                      .at(-1) ?? "paper"
                  )
                    .replace(/[^a-z0-9]/gi, "")
                    .toLowerCase() + preview.details.year,
                );
              setPreview(null);
            }}
          >
            Use reviewed metadata
          </button>
        </div>
      )}
      <label>
        Citation key
        <input
          aria-label="Citation key"
          required
          readOnly={!!reference}
          value={citeKey}
          onChange={(e) => setKey(e.target.value)}
          maxLength={100}
        />
        <small>Stable keys keep existing Markdown citations working.</small>
      </label>
      <ReferenceFields value={draft} onChange={setDraft} />
      <label>
        Tags
        <input
          aria-label="Reference tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="spectral methods, review"
        />
        <small>Separate tags with commas.</small>
      </label>
      <ErrorNotice message={action.error} />
      <DialogFooter>
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const parsed = libraryDraftSchema.parse({
                ...draft,
                citeKey,
                tags: tags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              });
              const { citeKey: _key, ...details } = parsed;
              const r = await mutate<{ id: string }>(
                "research/library/items" +
                  (reference ? "/" + reference.id : ""),
                {
                  scope,
                  ...(reference
                    ? { draft: details, version: reference.version }
                    : { draft: parsed }),
                },
                reference ? "PATCH" : "POST",
              );
              onSaved(r.id);
            })
          }
        >
          {reference ? "Save reference" : "Add reference"}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
type Detail = LibraryReference & {
  notes: {
    id: string;
    title: string;
    space_id: string;
    manual: boolean;
    cited: boolean;
  }[];
  attachments: {
    id: string;
    resource_id: string;
    name: string;
    ordinal: number;
  }[];
};
export default function ReferenceInspector({
  id,
  scope,
  canEdit,
  onClose,
  onEdit,
  onRefresh,
}: {
  id: string;
  scope: LibraryScope;
  canEdit: boolean;
  onClose: () => void;
  onEdit: (r: LibraryReference) => void;
  onRefresh: () => void;
}) {
  const { session, revision, navigate, spaces, notify } = useWorkspace(),
    data = useData<Detail>(
      "research/library/items/" + id + "?spaceId=" + scope.spaceId,
      revision,
    ),
    action = useAction(),
    [picker, setPicker] = useState<"note" | "file" | null>(null);
  const r = data.data,
    allowed = spaces.filter((s) => s.id === scope.spaceId);
  const link = async (
    kind: "note" | "attachment",
    targetId: string,
    remove = false,
  ) => {
    if (!r) return;
    await mutate(
      `research/library/items/${r.canonical_id ?? r.id}/links`,
      { scope, version: r.version, kind, targetId },
      remove ? "DELETE" : "POST",
    );
    setPicker(null);
    data.reload();
    onRefresh();
  };
  return (
    <ResizablePanel
      account={session.user.id}
      name="research-details"
      edge="left"
      className="research-inspector"
      label="Reference details"
    >
      <header>
        <span className="docs-eyebrow">Reference details</span>
        <button
          className="icon-button"
          aria-label="Close reference details"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <ErrorNotice message={data.error || action.error} retry={data.reload} />
      {r && (
        <>
          <h2>{r.title}</h2>
          <p>{r.authors}</p>
          <div className="research-tags">
            {r.tags.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="ws-actions">
            <button
              className="button ghost"
              title="Copy Markdown citation"
              onClick={() =>
                void navigator.clipboard.writeText(`[@${r.cite_key}]`).then(
                  () => notify("Citation copied."),
                  () => notify("Clipboard unavailable."),
                )
              }
            >
              <Copy size={14} />
              {r.cite_key}
            </button>
            {canEdit && !r.deleted_at && (
              <button
                className="icon-button"
                aria-label="Edit reference"
                title="Edit reference"
                onClick={() => onEdit({ ...r, id: r.canonical_id ?? r.id })}
              >
                <Pencil size={15} />
              </button>
            )}
          </div>
          {r.merged_into && (
            <p className="research-notice">
              This citation key redirects to the merged reference. Existing
              citations still work.
            </p>
          )}
          <dl className="reference-facts">
            {(["year", "venue", "doi", "arxiv"] as const)
              .filter((k) => r[k])
              .map((k) => (
                <div key={k}>
                  <dt>{referenceLabels[k]}</dt>
                  <dd>{r[k]}</dd>
                </div>
              ))}
          </dl>
          {r.url && (
            <a
              className="button ghost"
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={14} />
              Visit source
            </a>
          )}
          <button
            className="button ghost"
            onClick={() =>
              navigate(
                `/workspaces/${scope.spaceId}/research?view=graph&focus=reference:${r.canonical_id ?? r.id}`,
              )
            }
          >
            <Network size={14} />
            Explore connections
          </button>
          <h3>Linked PDFs</h3>
          <div className="research-connections">
            {r.attachments.map((p) => (
              <div key={p.id}>
                <button
                  onClick={() =>
                    navigate(`/pdf/${p.resource_id}?version=${p.id}`)
                  }
                >
                  <FileText size={15} />
                  <span>
                    {p.name}
                    <small>Version {p.ordinal}</small>
                  </span>
                </button>
                {canEdit && !r.deleted_at && (
                  <button
                    className="icon-button"
                    aria-label={`Unlink ${p.name}`}
                    title="Unlink PDF"
                    onClick={() =>
                      void action.run(() => link("attachment", p.id, true))
                    }
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!r.attachments.length && (
            <p className="muted">
              Link an existing PDF, including standalone files.
            </p>
          )}
          {canEdit && !r.deleted_at && (
            <button className="button ghost" onClick={() => setPicker("file")}>
              <Plus size={14} />
              Link PDF
            </button>
          )}
          <h3>Notes & citation usage</h3>
          <div className="research-connections">
            {r.notes.map((n) => (
              <div key={n.id}>
                <button onClick={() => navigate("/notes/" + n.id)}>
                  <Link2 size={15} />
                  <span>
                    {n.title}
                    <small>
                      {n.cited ? "Cited in Markdown" : "Linked note"}
                    </small>
                  </span>
                </button>
                {n.manual && canEdit && !r.deleted_at && (
                  <button
                    className="icon-button"
                    aria-label={`Unlink ${n.title}`}
                    title="Remove association (citations remain)"
                    onClick={() =>
                      void action.run(() => link("note", n.id, true))
                    }
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!r.notes.length && (
            <p className="muted">No linked or citing notes yet.</p>
          )}
          {canEdit && !r.deleted_at && (
            <button className="button ghost" onClick={() => setPicker("note")}>
              <Plus size={14} />
              Link note
            </button>
          )}
          {r.import_source && Object.keys(r.import_source).length > 0 && (
            <details className="reference-original">
              <summary>Original imported record</summary>
              <pre>{String(r.import_source.raw ?? r.bibtex)}</pre>
            </details>
          )}
          {picker && (
            <InsertResource
              kind={picker}
              note={{ id: "", visibility: "private" }}
              space={allowed[0]}
              initialFilter={picker === "file" ? "pdf" : "all"}
              selection={{
                spaceIds: allowed.map((s) => s.id),
                onChoose: (resource) =>
                  void action.run(() =>
                    link(
                      picker === "file" ? "attachment" : "note",
                      picker === "file"
                        ? resource.current_version_id!
                        : resource.id,
                    ),
                  ),
              }}
              onInsert={() => false}
              onClose={() => setPicker(null)}
            />
          )}
        </>
      )}
    </ResizablePanel>
  );
}
