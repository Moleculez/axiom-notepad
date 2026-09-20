"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfPageRange } from "@axiom/shared/pdf-reader";
import {
  pdfOcrMarkdown,
  type PdfOcrJob,
  type PdfOcrPage,
} from "@axiom/shared/pdf-ocr";
import type { PaperMeta } from "../../lib/research-store";
import { api, post, download } from "../../lib/client";
import Dialog from "../Dialog";
import PdfPages from "./PdfPages";
import PdfSaveCopy from "./PdfSaveCopy";
import { parseMarkdown, type MarkdownNode } from "@axiom/markdown";
import { confirmAction } from "../../lib/app-prompt";
export default function PdfOcrPanel({
  pdf,
  meta,
  onClose,
  onInsert,
  returnFocus,
}: {
  pdf: PDFDocumentProxy;
  meta: PaperMeta;
  onClose: () => void;
  onInsert: (text: string, privateMaterial?: boolean) => void;
  returnFocus?: () => HTMLElement | null;
}) {
  const [cap, setCap] = useState<{
      available: boolean;
      research: boolean;
      languages: string[];
    } | null>(null),
    [range, setRange] = useState(`1-${pdf.numPages}`),
    [language, setLanguage] = useState("eng"),
    [research, setResearch] = useState(false),
    [searchable, setSearchable] = useState(true),
    [consent, setConsent] = useState(false);
  const [jobs, setJobs] = useState<PdfOcrJob[]>([]),
    [id, setId] = useState(""),
    [job, setJob] = useState<PdfOcrJob | null>(null),
    [page, setPage] = useState(1),
    [draft, setDraft] = useState(""),
    [draftVersion, setDraftVersion] = useState(0),
    [dirty, setDirty] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [prepared, setPrepared] = useState<Uint8Array | null>(null);
  const [equations, setEquations] = useState<
      { tex: string; display: boolean }[]
    >([]),
    [createdNote, setCreatedNote] = useState("");
  const noteRequest = useRef({ key: "", mutationId: crypto.randomUUID() });
  const request = useRef({ key: "", id: crypto.randomUUID() }),
    dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  const close = async () => {
    if (
      !dirty ||
      (await confirmAction(
        "Unsaved research-text corrections will be discarded. Saved reviews stay in your private OCR history.",
        { title: "Discard corrections?", confirmLabel: "Discard" },
      ))
    )
      onClose();
  };
  const refresh = async () => {
    setJobs(await api(`pdf-ocr?version=${meta.id}`));
    if (id) setJob(await api(`pdf-ocr/${id}`));
  };
  useEffect(() => {
    const controller = new AbortController();
    void api<typeof cap>("pdf-ocr/capabilities", { signal: controller.signal })
      .then(setCap)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const list = await api<PdfOcrJob[]>(`pdf-ocr?version=${meta.id}`, {
          signal: controller.signal,
        });
        setJobs(list);
        if (id)
          setJob(await api(`pdf-ocr/${id}`, { signal: controller.signal }));
      } catch (e) {
        if (!controller.signal.aborted) {
          setError((e as Error).message);
          setJob(null);
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [id, meta.id]);
  const selected = job?.pages?.find((p) => p.page === page);
  useEffect(() => {
    if (!dirtyRef.current) {
      setDraft(selected?.reviewed_text ?? selected?.text ?? "");
      setDraftVersion(selected?.version ?? 0);
    }
  }, [selected?.page, selected?.version, id]);
  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reviewed = job?.pages?.filter((p) => p.reviewed) ?? [],
    markdown = pdfOcrMarkdown(reviewed, meta.id);
  if (prepared)
    return (
      <PdfSaveCopy
        bytes={prepared}
        meta={meta}
        annotations={[]}
        operation="ocr"
        onClose={() => setPrepared(null)}
      />
    );
  return (
    <Dialog
      title="Batch OCR & research text"
      subtitle="Private, self-hosted processing · source PDF stays unchanged"
      wide
      className="pdf-compare-dialog"
      onClose={() => void close()}
      returnFocus={returnFocus}
    >
      {!cap?.available && (
        <p className="muted">
          Self-hosted OCR is not enabled. Your administrator can configure the
          optional PDF OCR service and worker. No external provider will be
          contacted.
        </p>
      )}
      <div className="pdf-compare-controls">
        <label>
          Pages
          <input
            aria-label="OCR page range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          />
        </label>
        <label>
          Language
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {(cap?.languages ?? ["eng"]).map((l) => (
              <option key={l} value={l}>
                {{
                  eng: "English",
                  chi_sim: "Simplified Chinese",
                  "eng+chi_sim": "English + Chinese",
                  deu: "German",
                  fra: "French",
                  spa: "Spanish",
                }[l] ?? l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={research}
            disabled={!cap?.research}
            onChange={(e) => setResearch(e.target.checked)}
          />
          Equation-aware text
        </label>
        <label>
          <input
            type="checkbox"
            checked={searchable}
            onChange={(e) => setSearchable(e.target.checked)}
          />
          Also create searchable PDF
        </label>
      </div>
      <label className="pdf-save-option">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        Process the selected pages using this deployment’s private OCR service.
      </label>
      <button
        className="button primary"
        disabled={!cap?.available || !consent || busy || dirty}
        onClick={() =>
          void work(async () => {
            const settings = {
                pages: pdfPageRange(range, pdf.numPages),
                language,
                research,
                searchable,
              },
              key = JSON.stringify(settings);
            if (request.current.key !== key)
              request.current = { key, id: crypto.randomUUID() };
            const result = await post("pdf-ocr", {
              id: request.current.id,
              versionId: meta.id,
              settings,
              consent: true,
            });
            setDirty(false);
            setPage(settings.pages[0]);
            setId(result.id);
            request.current = { key: "", id: crypto.randomUUID() };
            await refresh();
          })
        }
      >
        Start OCR
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <label>
        Processing history
        <select
          aria-label="OCR job"
          value={id}
          disabled={dirty || busy}
          onChange={(e) => {
            setId(e.target.value);
            setJob(null);
            setPage(
              jobs.find((j) => j.id === e.target.value)?.settings.pages[0] ?? 1,
            );
            setEquations([]);
          }}
        >
          <option value="">Choose a job</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {new Date(j.created_at).toLocaleString()} · {j.status} ·{" "}
              {j.completed_pages}/{j.settings.pages.length} pages
            </option>
          ))}
        </select>
      </label>
      {job && (
        <>
          <div className="pdf-thread-status">
            <span role="status">
              {job.status} · {job.pages?.length ?? 0}/
              {job.settings.pages.length} text pages · results retained until{" "}
              {new Date(job.expires_at).toLocaleDateString()}
            </span>
            {["queued", "running"].includes(job.status) ? (
              <button
                disabled={busy}
                onClick={() =>
                  void work(async () => {
                    await post(`pdf-ocr/${id}/cancel`, {});
                    await refresh();
                  })
                }
              >
                Cancel processing
              </button>
            ) : ["failed", "cancelled"].includes(job.status) ? (
              <button
                disabled={busy}
                onClick={() =>
                  void work(async () => {
                    await post(`pdf-ocr/${id}/retry`, {});
                    await refresh();
                  })
                }
              >
                Retry unfinished outputs
              </button>
            ) : null}
          </div>
          {job.error && <p role="alert">{job.error}</p>}
          <div className="pdf-compare-panes pdf-workbench">
            <section>
              <header>
                <label>
                  Review page
                  <select
                    value={page}
                    disabled={dirty}
                    onChange={(e) => {
                      setPage(Number(e.target.value));
                      setEquations([]);
                    }}
                  >
                    {job.settings.pages.map((p) => (
                      <option key={p} value={p}>
                        {p}
                        {job.pages?.find((v) => v.page === p)?.reviewed
                          ? " · reviewed"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </header>
              <PdfPages
                pdf={pdf}
                page={page}
                jump={page}
                scale="fit"
                rotation={0}
                view="single"
                labels={[]}
                annotations={[]}
                selected=""
                query=""
                area={false}
                onPage={(value) => {
                  if (!dirty) {
                    setPage(value);
                    setEquations([]);
                  }
                }}
                onSelect={() => {}}
                onAnnotation={() => {}}
              />
            </section>
            <section className="pdf-ocr-review">
              <header>
                {selected?.native
                  ? "Existing PDF text"
                  : "Recognized text / LaTeX"}{" "}
                · {selected?.reviewed ? "Reviewed" : "Needs review"}
              </header>
              <textarea
                aria-label="OCR research text"
                value={draft}
                maxLength={100000}
                disabled={!selected || busy}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDirty(true);
                  setEquations([]);
                }}
              />
              {selected && (
                <div className="pdf-thread-status">
                  <button
                    disabled={busy}
                    onClick={() => {
                      const values: { tex: string; display: boolean }[] = [];
                      const walk = (node: MarkdownNode) => {
                        if (values.length >= 20) return;
                        if (
                          ["mathBlock", "mathInline"].includes(node.type) &&
                          node.text &&
                          node.text.length <= 30000
                        )
                          values.push({
                            tex: node.text,
                            display: node.type === "mathBlock",
                          });
                        node.children?.forEach(walk);
                      };
                      walk(parseMarkdown(draft).ast);
                      setEquations(values);
                      if (!values.length)
                        setError(
                          "No complete $…$, $$…$$, \\(…\\) or \\[…\\] equations found in this page’s text.",
                        );
                    }}
                  >
                    Preview equations
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void work(async () => {
                        const result = await api<PdfOcrPage>(
                          `pdf-ocr/${id}/pages`,
                          {
                            method: "PATCH",
                            body: JSON.stringify({
                              page,
                              version: draftVersion,
                              text: draft,
                              reviewed: true,
                            }),
                          },
                        );
                        setDraftVersion(result.version);
                        setDirty(false);
                        await refresh();
                      })
                    }
                  >
                    Save & mark reviewed
                  </button>
                  {dirty && (
                    <button
                      onClick={() => {
                        setDraft(selected.reviewed_text ?? selected.text);
                        setDraftVersion(selected.version);
                        setDirty(false);
                      }}
                    >
                      Discard local edits
                    </button>
                  )}
                </div>
              )}
              {!!equations.length && (
                <div
                  className="pdf-ocr-equations"
                  aria-label="Recognized equation preview"
                >
                  <small>
                    First 20 equations · compare carefully with the scanned page
                  </small>
                  {equations.map((eq, index) => (
                    <div key={`${index}:${eq.tex}`}>
                      <span
                        className="math-render"
                        data-math-request={JSON.stringify({
                          ...eq,
                          macros: [],
                          physics: false,
                        })}
                        aria-busy="true"
                      >
                        <span className="math-pending">{eq.tex}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          <p className="muted">
            Corrections affect the research text only. The searchable PDF
            retains machine-recognized text and requires independent
            verification. Only reviewed pages are included in text exports.
          </p>
          <div className="pdf-compare-controls">
            <button
              disabled={!markdown || dirty}
              onClick={() =>
                download("reviewed-research.md", markdown, "text/markdown")
              }
            >
              Download reviewed Markdown
            </button>
            <button
              disabled={!markdown || dirty}
              onClick={() => onInsert(markdown, true)}
            >
              Insert reviewed text into note
            </button>
            <button
              disabled={
                !markdown ||
                markdown.length > 1_000_000 ||
                dirty ||
                busy ||
                !!createdNote
              }
              onClick={() =>
                void work(async () => {
                  const spaces = await api<
                    {
                      id: string;
                      group_id: string;
                      kind: string;
                      role: string;
                    }[]
                  >("spaces");
                  const personal = spaces.find(
                    (s) => s.kind === "personal" && s.role === "editor",
                  );
                  if (!personal)
                    throw new Error(
                      "No writable personal space is available. Download the reviewed Markdown instead.",
                    );
                  const key = `${personal.id}:${markdown}`;
                  if (noteRequest.current.key !== key)
                    noteRequest.current = {
                      key,
                      mutationId: crypto.randomUUID(),
                    };
                  const result = await post("resources", {
                    mutationId: noteRequest.current.mutationId,
                    spaceId: personal.id,
                    kind: "note",
                    name: `${meta.name.replace(/\.pdf$/i, "").slice(0, 180)} — OCR review`,
                    body: markdown,
                  });
                  setCreatedNote(result.id);
                })
              }
            >
              Create private research note
            </button>
            {createdNote && (
              <a href={`/workbench/notes/${createdNote}`}>Open research note</a>
            )}
            {Number(job.output_bytes) > 0 && (
              <>
                <a
                  className="button secondary"
                  href={`/api/v1/pdf-ocr/${id}/pdf`}
                >
                  Download searchable PDF
                </a>
                <button
                  disabled={busy || dirty}
                  onClick={() =>
                    void work(async () => {
                      const response = await fetch(`/api/v1/pdf-ocr/${id}/pdf`);
                      if (!response.ok)
                        throw new Error("Searchable PDF is unavailable.");
                      setPrepared(new Uint8Array(await response.arrayBuffer()));
                    })
                  }
                >
                  Save searchable PDF…
                </button>
              </>
            )}
            <button
              disabled={busy || dirty}
              onClick={() =>
                void work(async () => {
                  if (
                    !(await confirmAction(
                      "Delete this job’s private research text and searchable output? Copies already saved to your workspace are kept.",
                      {
                        title: "Remove OCR results?",
                        confirmLabel: "Remove results",
                      },
                    ))
                  )
                    return;
                  await api(`pdf-ocr/${id}`, { method: "DELETE" });
                  setId("");
                  setJob(null);
                  await refresh();
                })
              }
            >
              Remove private results
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
