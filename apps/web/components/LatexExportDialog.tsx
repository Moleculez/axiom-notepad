"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

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
  useInterfaceLocale();
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
      title={uiText("Export document")}
      subtitle={uiText(
        "A frozen, editable research project. No compiler or external service runs; your note is not changed.",
      )}
      size="visual"
      className="document-export-dialog"
      onClose={onClose}
    >
      <div className="document-export-layout">
        <div className="document-export-settings">
          <label>
            <I18nText id="Format" />
            <NativeSelect
              aria-label={uiText("Format")}
              value="latex"
              onChange={(e) =>
                onFormat(e.target.value as "html" | "pdf" | "md" | "zip")
              }
              disabled={busy}
            >
              <option value="html">
                <I18nText id="Standalone HTML" />
              </option>
              <option value="pdf">
                <I18nText id="Print / Save as PDF" />
              </option>
              <option value="md">
                <I18nText id="Markdown source" />
              </option>
              <option value="zip">
                <I18nText id="Markdown + assets (ZIP)" />
              </option>
              <option value="latex">
                <I18nText id="LaTeX research project (ZIP)" />
              </option>
            </NativeSelect>
          </label>
          <label>
            <I18nText id="File name" />
            <TextInput
              aria-label={uiText("File name")}
              maxLength={150}
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
            />
          </label>
          <fieldset disabled={busy}>
            <legend>
              <I18nText id="Academic article" />
            </legend>
            <label>
              <I18nText id="Bibliography" />
              <NativeSelect
                aria-label={uiText("Bibliography backend")}
                value={options.backend}
                onChange={(e) =>
                  update("backend", e.target.value as LatexOptions["backend"])
                }
              >
                <option value="biber">
                  <I18nText id="BibLaTeX / Biber · Unicode" />
                </option>
                <option value="bibtex">
                  <I18nText id="natbib / BibTeX · classic" />
                </option>
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Citations" />
              <NativeSelect
                aria-label={uiText("Citation style")}
                value={options.citations}
                onChange={(e) =>
                  update(
                    "citations",
                    e.target.value as LatexOptions["citations"],
                  )
                }
              >
                <option value="numeric">
                  <I18nText id="Numbered" />
                </option>
                <option value="author-year">
                  <I18nText id="Author–year" />
                </option>
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Authors" />
              <TextInput
                aria-label={uiText("Paper authors")}
                value={options.authors}
                maxLength={2000}
                onChange={(e) => update("authors", e.target.value)}
                placeholder={uiText("Optional · not taken from your account")}
              />
            </label>
            <label>
              <I18nText id="Date" />
              <TextInput
                aria-label={uiText("Paper date")}
                value={options.date}
                maxLength={100}
                onChange={(e) => update("date", e.target.value)}
                placeholder={uiText("Optional")}
              />
            </label>
            <div className="document-export-fields">
              <label>
                <I18nText id="Paper" />
                <NativeSelect
                  aria-label={uiText("Paper")}
                  value={options.paper}
                  onChange={(e) =>
                    update("paper", e.target.value as "A4" | "Letter")
                  }
                >
                  <option>A4</option>
                  <option>
                    <I18nText id="Letter" />
                  </option>
                </NativeSelect>
              </label>
              <label>
                <I18nText id="Margins (mm)" />
                <TextInput
                  aria-label={uiText("Margins (mm)")}
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
              <I18nText id="Include document title" />
            </label>
            <label className="document-export-check">
              <Checkbox
                checked={options.toc}
                onChange={(e) => update("toc", e.target.checked)}
              />
              <I18nText id="Add table of contents" />
            </label>
            <HelpText>
              <I18nText id="XeLaTeX · 11-point Latin Modern. CJK support is included when needed. The project contains local compile instructions, original source and exact attached versions—not linked notes." />
            </HelpText>
          </fieldset>
          <HelpText>
            <I18nText id="Original files can contain EXIF or other metadata. Comments, private annotations, bookmarks and account details are excluded." />
          </HelpText>
        </div>
        <section
          className="document-export-preview"
          aria-label={uiText("LaTeX project review")}
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
              <I18nText id="Refresh snapshot" />
            </Button>
          </div>
          {changed && (
            <Notice tone="warning">
              <I18nText id="The document has changed. Refresh to include newer edits." />
            </Notice>
          )}
          <ActionRow
            className="latex-review-tabs"
            aria-label={uiText("Project review views")}
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
                  ? uiText("TeX")
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
                <I18nText id="Copy" />{" "}
                {view === "bibliography" ? uiText("BibTeX") : uiText("TeX")}
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
                    ? uiText("Generated LaTeX source")
                    : uiText("Generated bibliography")
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
                <h3>
                  <I18nText id="Project files" />
                </h3>
                <ul>
                  {Object.keys(prepared.files).map((path) => (
                    <li key={path}>
                      <code>{path}</code>
                    </li>
                  ))}
                  <li>
                    <code>
                      <I18nText id="export-manifest.json" />
                    </code>
                    <small>
                      <I18nText id="Checksums, citation mapping and export diagnostics" />
                    </small>
                  </li>
                  {prepared.assets.map((a) => (
                    <li key={a.id}>
                      <code>{a.originalPath}</code>
                      {a.figurePath && <code>{a.figurePath}</code>}
                      <small>
                        {a.name} <I18nText id="· immutable version ·" />{" "}
                        {(a.bytes / 1024).toFixed(1)} <I18nText id="KiB" />
                      </small>
                    </li>
                  ))}
                  {prepared.diagrams.map((d) => (
                    <li key={d.from}>
                      <code>{d.path}</code>
                      <small>
                        <I18nText id="Rendered locally when preparing the archive" />
                      </small>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <h3>
                  <I18nText id="Research checks" />
                </h3>
                {!prepared.diagnostics.length && !diagramWarnings.length && (
                  <HelpText>
                    <I18nText id="No issues found in the supported export subset. Local compilation remains a separate check." />
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
                          ? uiText("Error")
                          : d.severity === "info"
                            ? "Information"
                            : "Review"}
                      </strong>
                      <span>{d.message}</span>
                      <small>
                        {d.to > d.from
                          ? `Source characters ${d.from + 1}–${d.to}`
                          : uiText("Bibliography / project")}
                      </small>
                    </li>
                  ))}
                  {diagramWarnings.map((message) => (
                    <li key={message}>
                      <strong>
                        <I18nText id="Review" />
                      </strong>
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
                <I18nText id="I reviewed the warnings and understand that unsupported content uses a source-preserving fallback." />
              </span>
            </label>
          )}
        </section>
      </div>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
          <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
            <I18nText id="Retry review" />
          </Button>
        </Notice>
      )}
      <DialogFooter>
        <HelpText>
          {job && !job.ready
            ? uiText("Background archive · Settings → Exports")
            : uiText("Editable project only · no automatic compilation")}
        </HelpText>
        <Button variant="secondary" onClick={onClose}>
          <I18nText id="Close" />
        </Button>
        {job?.ready ? (
          <a
            className="button primary"
            href={`/api/v1/exports/${job.id}/download`}
            download={exportFilename(filename, "zip")}
          >
            <Download size={16} />
            <I18nText id="Download project" />
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
            <I18nText id="Prepare project" />
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
