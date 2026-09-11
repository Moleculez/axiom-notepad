"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Copy,
  Download,
  FileText,
  Link as LinkIcon,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { safeUrl } from "@axiom/markdown";
import {
  readingStatuses,
  referenceDetailsSchema,
  type ReadingData,
  type ReadingItem,
  type ReferenceDetails,
} from "@axiom/shared/research";
import type { ResearchController } from "../lib/research-store";
import { api, post, ApiError } from "../lib/client";
import Dialog from "./Dialog";
type Reference = ReferenceDetails & {
  id: string;
  cite_key: string;
  version: number;
  linked_notes?: {
    id: string;
    title: string;
    project_id: string | null;
    tags: string[];
  }[];
  linked_papers?: { id: string; name: string; note_id: string }[];
};
const blank: ReferenceDetails = {
  title: "",
  authors: "",
  year: "",
  url: "",
  doi: "",
  arxiv: "",
  venue: "",
};
export default function ReferenceLibrary({
  groupId,
  references,
  notes,
  projects,
  research,
  onRefresh,
  onImport,
  onOpenNote,
  onOpenPaper,
  readOnly = false,
}: {
  groupId: string;
  references: Reference[];
  notes: { id: string; title: string; deleted_at?: string | null }[];
  projects: { id: string; name: string }[];
  research: ResearchController;
  onRefresh: () => Promise<void>;
  onImport: () => void;
  readOnly?: boolean;
  onOpenNote: (id: string) => void;
  onOpenPaper: (paper: {
    id: string;
    name: string;
    note_id: string;
    citeKey?: string;
  }) => void;
}) {
  const [editing, setEditing] = useState<Reference | null | undefined>(
      undefined,
    ),
    [filter, setFilter] = useState<ReadingData>({
      label: "",
      query: "",
      author: "",
      year: "",
      project: "",
      tag: "",
      filterStatus: "all",
    }),
    [message, setMessage] = useState("");
  const close = useCallback(() => {
    setEditing(undefined);
    void onRefresh().catch((e) => setMessage((e as Error).message));
  }, [onRefresh]);
  const items = research.entries
    .filter((e) => e.kind === "reading" && !e.value.deleted)
    .map((e) => e.value as ReadingItem);
  const statusFor = (id: string) =>
    items.find((i) => i.kind === "reading" && i.target_id === id)?.data
      .status ?? "want";
  const filtered = references.filter(
    (r) =>
      (!filter.query ||
        [r.title, r.cite_key, r.doi, r.arxiv, r.venue]
          .join(" ")
          .toLowerCase()
          .includes(filter.query.toLowerCase())) &&
      (!filter.author ||
        r.authors.toLowerCase().includes(filter.author.toLowerCase())) &&
      (!filter.year || r.year.includes(filter.year)) &&
      (!filter.filterStatus ||
        filter.filterStatus === "all" ||
        statusFor(r.id) === filter.filterStatus) &&
      (!filter.project ||
        r.linked_notes?.some((n) => n.project_id === filter.project)) &&
      (!filter.tag ||
        r.linked_notes?.some((n) =>
          n.tags.some((t) =>
            t.toLowerCase().includes(filter.tag!.toLowerCase()),
          ),
        )),
  );
  const work = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <section className="collection-page reference-library">
      <div className="section-heading">
        <div>
          <div className="eyebrow">THE IDEAS WE BUILD ON</div>
          <h1>Reference library</h1>
          <p className="muted">
            A shared bibliography. A reading journey that is yours.
          </p>
        </div>
        <button className="button primary" disabled={readOnly} onClick={() => setEditing(null)}>
          <Plus size={16} />
          Add reference
        </button>
      </div>
      <div className="collection-tools">
        <button className="button secondary small" disabled={readOnly} onClick={onImport}>
          <Upload size={14} />
          Import BibTeX
        </button>
        <a
          className="button secondary small"
          href={`/api/v1/references?groupId=${groupId}&format=bib`}
        >
          <Download size={14} />
          Export BibTeX
        </a>
        <span>
          {filtered.length} / {references.length} references
        </span>
      </div>
      <div className="reference-filters">
        <label>
          Find a paper
          <input
            aria-label="Search reference library"
            value={filter.query}
            placeholder="Title, citation key, DOI…"
            onChange={(e) =>
              setFilter((f) => ({ ...f, query: e.target.value }))
            }
          />
        </label>
        <label>
          Author
          <input
            aria-label="Filter reference author"
            value={filter.author}
            onChange={(e) =>
              setFilter((f) => ({ ...f, author: e.target.value }))
            }
          />
        </label>
        <label>
          Year
          <input
            aria-label="Filter reference year"
            value={filter.year}
            onChange={(e) => setFilter((f) => ({ ...f, year: e.target.value }))}
          />
        </label>
        <label>
          My reading queue
          <select
            aria-label="Filter reading status"
            value={filter.filterStatus}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                filterStatus: e.target.value as ReadingData["filterStatus"],
              }))
            }
          >
            <option value="all">All papers</option>
            {Object.entries(readingStatuses).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Linked project
          <select
            aria-label="Filter linked project"
            value={filter.project}
            onChange={(e) =>
              setFilter((f) => ({ ...f, project: e.target.value }))
            }
          >
            <option value="">Any project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Linked note tag
          <input
            aria-label="Filter linked note tag"
            value={filter.tag}
            onChange={(e) => setFilter((f) => ({ ...f, tag: e.target.value }))}
          />
        </label>
      </div>
      <div className="saved-filters">
        <button
          className="text-button"
          onClick={() => {
            const label = prompt("Name this personal library filter");
            if (label?.trim())
              void work(async () => {
                await research.saveReading("filter", "group", groupId, {
                  ...filter,
                  label: label.trim().slice(0, 300),
                });
              });
          }}
        >
          Save current filter
        </button>
        {items
          .filter((i) => i.kind === "filter")
          .map((item) => (
            <span key={item.id}>
              <button
                className="text-button"
                onClick={() =>
                  setFilter({
                    query: "",
                    author: "",
                    year: "",
                    project: "",
                    tag: "",
                    filterStatus: "all",
                    ...item.data,
                  })
                }
              >
                {item.data.label}
              </button>
              <button
                className="icon-button"
                aria-label={`Remove saved filter ${item.data.label}`}
                onClick={() =>
                  void work(async () => {
                    const entry = research.entries.find(
                      (e) => e.value.id === item.id,
                    )!;
                    await research.remove(entry);
                  })
                }
              >
                ×
              </button>
            </span>
          ))}
      </div>
      <div className="reference-list">
        {filtered.map((r) => (
          <article className="reference-card" key={r.id}>
            <div className="reference-icon">
              <BookOpen size={22} />
            </div>
            <div className="reference-card-body">
              <span className="reference-key">
                {r.cite_key} · {r.year || "Year unknown"}
              </span>
              <h3>{r.title}</h3>
              <p>{r.authors}</p>
              {r.venue && <p className="muted">{r.venue}</p>}
              <div className="reference-actions">
                {r.url && (
                  <a
                    href={safeUrl(r.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View source <ArrowUpRight size={13} />
                  </a>
                )}
                <button
                  onClick={() =>
                    void work(async () => {
                      await navigator.clipboard.writeText(`[@${r.cite_key}]`);
                      setMessage("Citation copied.");
                    })
                  }
                >
                  <Copy size={13} />
                  Copy citation
                </button>
                <button disabled={readOnly} onClick={() => setEditing(r)}>
                  Edit metadata & links
                </button>
              </div>
              <div className="reference-linked">
                {r.linked_papers?.map((p) => (
                  <button
                    className="text-button"
                    key={p.id}
                    onClick={() => onOpenPaper({ ...p, citeKey: r.cite_key })}
                  >
                    <FileText size={14} />
                    {p.name}
                  </button>
                ))}
                {r.linked_notes?.map((n) => (
                  <button
                    className="text-button"
                    key={n.id}
                    onClick={() => onOpenNote(n.id)}
                  >
                    <LinkIcon size={14} />
                    {n.title}
                  </button>
                ))}
              </div>
            </div>
            <select
              className="reading-status"
              aria-label={`Reading status for ${r.cite_key}`}
              value={statusFor(r.id)}
              onChange={(e) =>
                void work(async () => {
                  await research.saveReading("reading", "reference", r.id, {
                    label: r.title,
                    status: e.target.value as ReadingData["status"],
                  });
                })
              }
            >
              {Object.entries(readingStatuses).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <BookOpen size={30} />
          <h3>
            {references.length
              ? "No papers match this filter"
              : "Build your shared reading shelf"}
          </h3>
          <p>
            Import BibTeX, add a reference, or look up a DOI or arXiv
            identifier.
          </p>
          <button className="button secondary" disabled={readOnly} onClick={() => setEditing(null)}>
            Add a reference
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {editing !== undefined && (
        <Dialog
          title={editing ? "Reference details" : "Add a reference"}
          onClose={close}
          wide
        >
          <ReferenceEditor
            groupId={groupId}
            reference={editing ?? undefined}
            references={references}
            notes={notes.filter((n) => !n.deleted_at)}
            onSaved={async () => {
              await onRefresh();
              close();
            }}
            onCancel={close}
          />
        </Dialog>
      )}
    </section>
  );
}
export function ReferenceEditor({
  groupId,
  reference,
  references,
  notes = [],
  onSaved,
  onCancel,
}: {
  groupId: string;
  reference?: Reference;
  references: Reference[];
  notes?: { id: string; title: string }[];
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ReferenceDetails>(() =>
      reference
        ? (Object.fromEntries(
            Object.keys(blank).map((k) => [
              k,
              reference[k as keyof Reference] ?? "",
            ]),
          ) as ReferenceDetails)
        : blank,
    ),
    [key, setKey] = useState(reference?.cite_key ?? ""),
    [version, setVersion] = useState(reference?.version ?? 1),
    [identifier, setIdentifier] = useState(""),
    [preview, setPreview] = useState<{
      provider: string;
      details: ReferenceDetails;
    } | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [remote, setRemote] = useState<Reference | null>(null),
    [chosenNote, setChosenNote] = useState(""),
    [papers, setPapers] = useState<any[]>([]),
    [chosenPaper, setChosenPaper] = useState(""),
    [links, setLinks] = useState<{
      notes: { id: string; title: string }[];
      attachments: { id: string; name: string }[];
    }>({
      notes: reference?.linked_notes ?? [],
      attachments: reference?.linked_papers ?? [],
    });
  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setRemote(e.data?.current);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const loadLinks = async () => {
    if (reference) setLinks(await api(`references/${reference.id}/links`));
  };
  useEffect(() => {
    let alive = true;
    setPapers([]);
    setChosenPaper("");
    if (chosenNote)
      void api<any[]>(`notes/${chosenNote}/attachments`)
        .then((files) => {
          if (alive)
            setPapers(files.filter((f) => f.mime === "application/pdf"));
        })
        .catch((e) => {
          if (alive) setMessage(e.message);
        });
    return () => {
      alive = false;
    };
  }, [chosenNote]);
  const duplicate = references.filter(
    (r) =>
      r.id !== reference?.id &&
      ((draft.doi && r.doi?.toLowerCase() === draft.doi.trim().toLowerCase()) ||
        (draft.arxiv &&
          r.arxiv?.replace(/v\d+$/, "") === draft.arxiv.replace(/v\d+$/, "")) ||
        (draft.title &&
          r.title.toLowerCase() === draft.title.trim().toLowerCase())),
  );
  return (
    <div className="reference-form">
      <div className="reference-lookup">
        <label>
          DOI or arXiv identifier
          <input
            aria-label="DOI or arXiv lookup identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="10.1000/example or 1706.03762"
            maxLength={500}
          />
        </label>
        <p className="muted">
          Lookup sends only this identifier to Crossref or arXiv. Notes, files
          and your email are never sent. Results are previewed before saving.
        </p>
        <button
          className="button secondary"
          disabled={busy || !identifier.trim() || !navigator.onLine}
          onClick={() =>
            void work(async () =>
              setPreview(
                await post("references/lookup", { groupId, identifier }),
              ),
            )
          }
        >
          <Search size={15} />
          Look up metadata
        </button>
        {preview && (
          <div className="metadata-preview">
            <strong>{preview.details.title}</strong>
            <p>
              {preview.details.authors} · {preview.details.year}
            </p>
            <small>Source: {preview.provider}</small>
            <button
              className="button secondary small"
              onClick={() => {
                setDraft(preview.details);
                if (!key)
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
              Use these details
            </button>
          </div>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void work(async () => {
            const details = referenceDetailsSchema.parse(draft);
            if (reference)
              await api(`references/${reference.id}`, {
                method: "PATCH",
                body: JSON.stringify({ ...details, version }),
              });
            else
              await post("references", { ...details, groupId, citeKey: key });
            await onSaved();
          });
        }}
      >
        <label>
          Citation key
          <input
            aria-label="Citation key"
            value={key}
            readOnly={!!reference}
            required
            maxLength={100}
            onChange={(e) => setKey(e.target.value)}
          />
          {reference && (
            <small>
              Keys stay stable so existing citations continue to work.
            </small>
          )}
        </label>
        <label>
          Title
          <input
            aria-label="Reference title"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            required
            maxLength={200}
          />
        </label>
        <label>
          Authors
          <input
            aria-label="Reference authors"
            value={draft.authors}
            onChange={(e) =>
              setDraft((d) => ({ ...d, authors: e.target.value }))
            }
            maxLength={2000}
          />
          <small>Separate authors with “and” for BibTeX.</small>
        </label>
        <div className="setting-pair">
          {(["year", "venue", "doi", "arxiv"] as const).map((k) => (
            <label key={k}>
              {
                {
                  year: "Year",
                  venue: "Journal / venue",
                  doi: "DOI",
                  arxiv: "arXiv ID",
                }[k]
              }
              <input
                aria-label={`Reference ${k}`}
                value={draft[k]}
                maxLength={
                  k === "venue"
                    ? 500
                    : k === "doi"
                      ? 300
                      : k === "year"
                        ? 20
                        : 100
                }
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [k]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <label>
          Source URL
          <input
            aria-label="Reference URL"
            type="url"
            value={draft.url}
            onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
            maxLength={2000}
          />
        </label>
        {duplicate.length > 0 && (
          <p className="form-error" role="status">
            Possible duplicate: {duplicate.map((r) => r.cite_key).join(", ")}.
            Existing entries will not be merged or overwritten.
          </p>
        )}
        {remote && (
          <div className="research-conflict">
            <p>
              The server now has: {remote.title} · {remote.authors} ·{" "}
              {remote.year}. Review it before saving your retained changes.
            </p>
            <button
              type="button"
              className="button secondary small"
              onClick={() => {
                setVersion(remote.version);
                setRemote(null);
                setMessage(
                  "Your edits are retained. Save again to replace the reviewed server version.",
                );
              }}
            >
              Keep my edits
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() => {
                setDraft(
                  referenceDetailsSchema.parse(
                    Object.fromEntries(
                      Object.keys(blank).map((k) => [
                        k,
                        remote[k as keyof Reference] ?? "",
                      ]),
                    ),
                  ),
                );
                setVersion(remote.version);
                setRemote(null);
              }}
            >
              Use latest metadata
            </button>
          </div>
        )}
        <div className="dialog-footer">
          <button type="button" className="button secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !!remote || !navigator.onLine}
          >
            {reference ? "Save reference" : "Add reference"}
          </button>
        </div>
      </form>
      {reference && (
        <section className="reference-links-editor">
          <h3>Related notes & papers</h3>
          <p className="muted">
            Links follow note permissions. Linking a private draft does not
            share it.
          </p>
          {links.notes.map((n) => (
            <div className="offline-paper-row" key={n.id}>
              <span>{n.title}</span>
              <button
                className="text-button"
                onClick={() =>
                  void work(async () => {
                    await api(`references/${reference.id}/links`, {
                      method: "DELETE",
                      body: JSON.stringify({ kind: "note", targetId: n.id }),
                    });
                    await loadLinks();
                  })
                }
              >
                Unlink note
              </button>
            </div>
          ))}
          {links.attachments.map((p) => (
            <div className="offline-paper-row" key={p.id}>
              <span>{p.name}</span>
              <button
                className="text-button"
                onClick={() =>
                  void work(async () => {
                    await api(`references/${reference.id}/links`, {
                      method: "DELETE",
                      body: JSON.stringify({
                        kind: "attachment",
                        targetId: p.id,
                      }),
                    });
                    await loadLinks();
                  })
                }
              >
                Unlink PDF
              </button>
            </div>
          ))}
          <label>
            Choose a note
            <select
              aria-label="Note to link to reference"
              value={chosenNote}
              onChange={(e) => setChosenNote(e.target.value)}
            >
              <option value="">Select a note…</option>
              {notes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary small"
            disabled={!chosenNote || busy}
            onClick={() =>
              void work(async () => {
                await post(`references/${reference.id}/links`, {
                  kind: "note",
                  targetId: chosenNote,
                });
                await loadLinks();
              })
            }
          >
            Link this note
          </button>
          {chosenNote && (
            <>
              <label>
                PDF attached to this note
                <select
                  aria-label="PDF to link to reference"
                  value={chosenPaper}
                  onChange={(e) => setChosenPaper(e.target.value)}
                >
                  <option value="">
                    {papers.length
                      ? "Select a PDF…"
                      : "No PDFs attached to this note"}
                  </option>
                  {papers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button secondary small"
                disabled={!chosenPaper || busy}
                onClick={() =>
                  void work(async () => {
                    await post(`references/${reference.id}/links`, {
                      kind: "attachment",
                      targetId: chosenPaper,
                    });
                    await loadLinks();
                  })
                }
              >
                Link this PDF
              </button>
            </>
          )}
        </section>
      )}
      {message && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
