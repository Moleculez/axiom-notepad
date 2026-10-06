"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, Download, RefreshCw } from "lucide-react";
import {
  Button,
  Checkbox,
  NativeSelect,
  TextInput,
  ActionRow,
  HelpText,
  Notice,
} from "./ui/controls";
import Dialog, { DialogFooter } from "./Dialog";
import { api } from "../lib/client";
import { abortable } from "../lib/document-export";
import {
  exportFilename,
  type MarkdownExportSnapshot,
} from "@axiom/shared/document-export";
import {
  latexOptionsSchema,
  type LatexOptions,
  type LatexPreview,
} from "@axiom/shared/latex-export";
import type { Preferences } from "@axiom/shared/appearance";
import LatexReadingPreview from "./LatexReadingPreview";
type View = "tex" | "reading" | "bibliography" | "files" | "checks";
export default function LatexExportDialog({
  noteId,
  spaceId,
  snapshot,
  preferences,
  changed,
  onRefresh,
  onFormat,
  onClose,
}: {
  noteId: string;
  spaceId?: string;
  snapshot: MarkdownExportSnapshot;
  changed: boolean;
  preferences: Preferences;
  onRefresh: () => void;
  onFormat: (format: "html" | "pdf" | "md" | "zip") => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<LatexOptions>(() =>
    latexOptionsSchema.parse({}),
  );
  const [prepared, setPrepared] = useState<LatexPreview | null>(null),
    [view, setView] = useState<View>("tex");
  const [error, setError] = useState(""),
    [status, setStatus] = useState("Preparing project review…"),
    [attempt, setAttempt] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false),
    [job, setJob] = useState<{ id: string; ready: boolean } | null>(null);
  const [diagramWarnings, setDiagramWarnings] = useState<string[]>([]),
    [filename, setFilename] = useState(snapshot.title);
  const jobController = useRef<AbortController | null>(null),
    identity = useRef(crypto.randomUUID()),
    preparing = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    jobController.current?.abort();
    setPrepared(null);
    setJob(null);
    setAcknowledged(false);
    setError("");
    setDiagramWarnings([]);
    setStatus("Preparing project review…");
    identity.current = crypto.randomUUID();
    const timer = setTimeout(() => {
      void api<LatexPreview>(`notes/${noteId}/latex-preview`, {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ snapshot, options }),
      })
        .then((result) => {
          if (!controller.signal.aborted) {
            setPrepared(result);
            setStatus("Review ready · editable TeX project");
          }
        })
        .catch((reason) => {
          if (!controller.signal.aborted) {
            setError(
              reason instanceof Error ? reason.message : "Preparation failed.",
            );
            setStatus("Review unavailable");
          }
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
      jobController.current?.abort();
    };
  }, [noteId, snapshot, options, attempt]);
  const update = <K extends keyof LatexOptions>(
    key: K,
    value: LatexOptions[K],
  ) => setOptions((old) => ({ ...old, [key]: value }));
  const warnings =
      prepared?.diagnostics.filter((d) => d.severity === "warning") ?? [],
    errors = prepared?.diagnostics.filter((d) => d.severity === "error") ?? [];
  const prepare = async () => {
    if (!prepared || !spaceId || preparing.current) return;
    preparing.current = true;
    const abort = new AbortController();
    jobController.current?.abort();
    jobController.current = abort;
    setError("");
    try {
      setStatus("Preparing local diagram figures…");
      const { prepareLatexDiagrams } = await import("../lib/latex-diagrams");
      const rasters = await prepareLatexDiagrams(prepared, abort.signal);
      setDiagramWarnings(rasters.warnings);
      // A failed diagram is an explicit review boundary, not a silent omission.
      if (rasters.warnings.length && !acknowledged) {
        setView("checks");
        setStatus("Review diagram warnings before continuing");
        return;
      }
      setStatus("Preparing archive…");
      const created = await api<{ id: string }>("exports", {
        method: "POST",
        signal: abort.signal,
        body: JSON.stringify({
          mutationId: identity.current,
          spaceId,
          resourceIds: [noteId],
          markdownSnapshot: snapshot,
          latex: {
            options,
            fingerprint: prepared.fingerprint,
            acknowledgeWarnings: acknowledged,
            diagrams: rasters.diagrams,
          },
        }),
      });
      setJob({ id: created.id, ready: false });
      const start = Date.now();
      while (Date.now() - start < 180_000) {
        await abortable(
          new Promise((resolve) => setTimeout(resolve, 1500)),
          abort.signal,
        );
        const rows = await api<
          { id: string; status: string; error?: string }[]
        >("exports", { signal: abort.signal });
        const result = rows.find((j) => j.id === created.id);
        if (result?.status === "failed") {
          identity.current = crypto.randomUUID();
          throw new Error(result.error || "Archive preparation failed.");
        }
        if (result?.status === "ready") {
          setJob({ id: created.id, ready: true });
          setStatus("Project ready to download");
          return;
        }
      }
      setStatus("Still preparing · find this project in Settings → Exports");
    } catch (reason) {
      if (!abort.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Export failed.");
        setStatus("Preparation interrupted");
        setJob(null);
      }
    } finally {
      preparing.current = false;
    }
  };
  const busy =
    (!!job && !job.ready) ||
    status === "Preparing local diagram figures…" ||
    status === "Preparing archive…";
  return (
    <Dialog
      title="Export document"
      subtitle="A frozen, editable research project. No compiler or external service runs; your note is not changed."
      size="visual"
      className="document-export-dialog"
      onClose={onClose}
    >
      <div className="document-export-layout">
        <div className="document-export-settings">
          <label>
            Format
            <NativeSelect
              aria-label="Format"
              value="latex"
              onChange={(e) =>
                onFormat(e.target.value as "html" | "pdf" | "md" | "zip")
              }
              disabled={busy}
            >
              <option value="html">Standalone HTML</option>
              <option value="pdf">Print / Save as PDF</option>
              <option value="md">Markdown source</option>
              <option value="zip">Markdown + assets (ZIP)</option>
              <option value="latex">LaTeX research project (ZIP)</option>
            </NativeSelect>
          </label>
          <label>
            File name
            <TextInput
              aria-label="File name"
              maxLength={150}
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
            />
          </label>
          <fieldset disabled={busy}>
            <legend>Academic article</legend>
            <label>
              Bibliography
              <NativeSelect
                aria-label="Bibliography backend"
                value={options.backend}
                onChange={(e) =>
                  update("backend", e.target.value as LatexOptions["backend"])
                }
              >
                <option value="biber">BibLaTeX / Biber · Unicode</option>
                <option value="bibtex">natbib / BibTeX · classic</option>
              </NativeSelect>
            </label>
            <label>
              Citations
              <NativeSelect
                aria-label="Citation style"
                value={options.citations}
                onChange={(e) =>
                  update(
                    "citations",
                    e.target.value as LatexOptions["citations"],
                  )
                }
              >
                <option value="numeric">Numbered</option>
                <option value="author-year">Author–year</option>
              </NativeSelect>
            </label>
            <label>
              Authors
              <TextInput
                aria-label="Paper authors"
                value={options.authors}
                maxLength={2000}
                onChange={(e) => update("authors", e.target.value)}
                placeholder="Optional · not taken from your account"
              />
            </label>
            <label>
              Date
              <TextInput
                aria-label="Paper date"
                value={options.date}
                maxLength={100}
                onChange={(e) => update("date", e.target.value)}
                placeholder="Optional"
              />
            </label>
            <div className="document-export-fields">
              <label>
                Paper
                <NativeSelect
                  aria-label="Paper"
                  value={options.paper}
                  onChange={(e) =>
                    update("paper", e.target.value as "A4" | "Letter")
                  }
                >
                  <option>A4</option>
                  <option>Letter</option>
                </NativeSelect>
              </label>
              <label>
                Margins (mm)
                <TextInput
                  aria-label="Margins (mm)"
                  type="number"
                  min={8}
                  max={40}
                  value={options.margin}
                  onChange={(e) =>
                    update(
                      "margin",
                      Math.max(8, Math.min(40, Number(e.target.value) || 20)),
                    )
                  }
                />
              </label>
            </div>
            <label className="document-export-check">
              <Checkbox
                checked={options.title}
                onChange={(e) => update("title", e.target.checked)}
              />
              Include document title
            </label>
            <label className="document-export-check">
              <Checkbox
                checked={options.toc}
                onChange={(e) => update("toc", e.target.checked)}
              />
              Add table of contents
            </label>
            <HelpText>
              XeLaTeX · 11-point Latin Modern. CJK support is included when
              needed. The project contains local compile instructions, original
              source and exact attached versions—not linked notes.
            </HelpText>
          </fieldset>
          <HelpText>
            Original files can contain EXIF or other metadata. Comments, private
            annotations, bookmarks and account details are excluded.
          </HelpText>
        </div>
        <section
          className="document-export-preview"
          aria-label="LaTeX project review"
        >
          <div className="document-export-preview-toolbar">
            <span role="status">{status}</span>
            <Button
              variant="secondary"
              onClick={() => {
                onRefresh();
                setAttempt((n) => n + 1);
              }}
              disabled={busy}
            >
              <RefreshCw size={14} />
              Refresh snapshot
            </Button>
          </div>
          {changed && (
            <Notice tone="warning">
              The document has changed. Refresh to include newer edits.
            </Notice>
          )}
          <ActionRow
            className="latex-review-tabs"
            aria-label="Project review views"
          >
            {(
              ["tex", "reading", "bibliography", "files", "checks"] as const
            ).map((v) => (
              <Button
                key={v}
                variant="ghost"
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {v === "tex"
                  ? "TeX"
                  : v === "reading"
                    ? "Reading"
                    : v === "bibliography"
                      ? "Bibliography"
                      : v === "files"
                        ? "Files"
                        : `Checks${prepared ? ` (${prepared.diagnostics.length + diagramWarnings.length})` : ""}`}
              </Button>
            ))}
            {prepared && (view === "tex" || view === "bibliography") && (
              <Button
                variant="ghost"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(
                      prepared.files[
                        view === "bibliography" ? "references.bib" : "main.tex"
                      ],
                    )
                    .then(
                      () => setStatus("Source copied"),
                      () =>
                        setError(
                          "Clipboard unavailable. Download the project instead.",
                        ),
                    )
                }
              >
                <Copy size={14} />
                Copy {view === "bibliography" ? "BibTeX" : "TeX"}
              </Button>
            )}
          </ActionRow>
          <div className="latex-review-content" tabIndex={0}>
            {!prepared ? (
              <HelpText>
                {error || "Preparing source and dependency review…"}
              </HelpText>
            ) : view === "tex" || view === "bibliography" ? (
              <pre
                aria-label={
                  view === "tex"
                    ? "Generated LaTeX source"
                    : "Generated bibliography"
                }
              >
                {prepared.files[view === "tex" ? "main.tex" : "references.bib"]}
              </pre>
            ) : view === "reading" ? (
              <LatexReadingPreview
                noteId={noteId}
                snapshot={snapshot}
                preferences={preferences}
                options={options}
                fingerprint={prepared.fingerprint}
              />
            ) : view === "files" ? (
              <>
                <h3>Project files</h3>
                <ul>
                  {Object.keys(prepared.files).map((path) => (
                    <li key={path}>
                      <code>{path}</code>
                    </li>
                  ))}
                  <li>
                    <code>export-manifest.json</code>
                    <small>
                      Checksums, citation mapping and export diagnostics
                    </small>
                  </li>
                  {prepared.assets.map((a) => (
                    <li key={a.id}>
                      <code>{a.originalPath}</code>
                      {a.figurePath && <code>{a.figurePath}</code>}
                      <small>
                        {a.name} · immutable version ·{" "}
                        {(a.bytes / 1024).toFixed(1)} KiB
                      </small>
                    </li>
                  ))}
                  {prepared.diagrams.map((d) => (
                    <li key={d.from}>
                      <code>{d.path}</code>
                      <small>Rendered locally when preparing the archive</small>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <h3>Research checks</h3>
                {!prepared.diagnostics.length && !diagramWarnings.length && (
                  <HelpText>
                    No issues found in the supported export subset. Local
                    compilation remains a separate check.
                  </HelpText>
                )}
                <ul>
                  {prepared.diagnostics.map((d, i) => (
                    <li
                      key={`${d.code}:${d.from}:${i}`}
                      data-severity={d.severity}
                    >
                      <strong>
                        {d.severity === "error"
                          ? "Error"
                          : d.severity === "info"
                            ? "Information"
                            : "Review"}
                      </strong>
                      <span>{d.message}</span>
                      <small>
                        {d.to > d.from
                          ? `Source characters ${d.from + 1}–${d.to}`
                          : "Bibliography / project"}
                      </small>
                    </li>
                  ))}
                  {diagramWarnings.map((message) => (
                    <li key={message}>
                      <strong>Review</strong>
                      <span>{message}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          {(warnings.length > 0 || diagramWarnings.length > 0) && (
            <label className="latex-review-consent">
              <Checkbox
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span>
                I reviewed the warnings and understand that unsupported content
                uses a source-preserving fallback.
              </span>
            </label>
          )}
        </section>
      </div>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
          <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
            Retry review
          </Button>
        </Notice>
      )}
      <DialogFooter>
        <HelpText>
          {job && !job.ready
            ? "Background archive · Settings → Exports"
            : "Editable project only · no automatic compilation"}
        </HelpText>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        {job?.ready ? (
          <a
            className="button primary"
            href={`/api/v1/exports/${job.id}/download`}
            download={exportFilename(filename, "zip")}
          >
            <Download size={16} />
            Download project
          </a>
        ) : (
          <Button
            variant="primary"
            pending={busy}
            disabled={
              !prepared ||
              !spaceId ||
              !filename.trim() ||
              !!errors.length ||
              ((warnings.length > 0 || diagramWarnings.length > 0) &&
                !acknowledged) ||
              !!job
            }
            onClick={() => void prepare()}
          >
            <Download size={16} />
            Prepare project
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
