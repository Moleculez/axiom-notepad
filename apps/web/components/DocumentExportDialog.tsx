"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  Button,
  Checkbox,
  Slider,
  NativeSelect,
  TextInput,
} from "./ui/controls";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Printer, RefreshCw } from "lucide-react";
import { fonts, paletteFor, type Preferences } from "@axiom/shared/appearance";
import {
  defaultDocumentExportOptions,
  exportFilename,
  exportPreferences,
  type DocumentExportOptions,
  type DocumentExportResult,
  type MarkdownExportSnapshot,
} from "@axiom/shared/document-export";
import { api, ApiError, download } from "../lib/client";
import {
  abortable,
  completeExport,
  readyExportFrame,
  previewExportHtml,
} from "../lib/document-export";
import Dialog, { DialogFooter } from "./Dialog";
import LatexExportDialog from "./LatexExportDialog";

type Format = "html" | "pdf" | "md" | "zip" | "latex";
export default function DocumentExportDialog({
  noteId,
  spaceId,
  current,
  preferences,
  dark,
  onClose,
}: {
  noteId: string;
  spaceId?: string;
  current: MarkdownExportSnapshot;
  preferences: Preferences;
  dark: boolean;
  onClose: () => void;
}) {
  useInterfaceLocale();
  const [snapshot, setSnapshot] = useState(current);
  const [format, setFormat] = useState<Format>("html");
  const [filename, setFilename] = useState(current.title);
  const [options, setOptions] = useState<DocumentExportOptions>({
    ...defaultDocumentExportOptions,
    dark,
  });
  const [appearance, setAppearance] = useState(preferences);
  const [prepared, setPrepared] = useState<
    (DocumentExportResult & { key: number; signal: AbortSignal }) | null
  >(null);
  const sequence = useRef(0);
  const preview = useMemo(
    () => (prepared ? previewExportHtml(prepared.html) : ""),
    [prepared],
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("Preparing document…");
  const [attempt, setAttempt] = useState(0);
  const [zip, setZip] = useState<{ id: string; ready: boolean } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const jobController = useRef<AbortController | null>(null);
  const changed =
    current.source !== snapshot.source ||
    current.title !== snapshot.title ||
    current.generation !== snapshot.generation;
  const change = <K extends keyof DocumentExportOptions>(
    key: K,
    value: DocumentExportOptions[K],
  ) => setOptions((old) => ({ ...old, [key]: value }));
  useEffect(() => {
    if (format !== "html" && format !== "pdf") {
      setPrepared(null);
      setReady(false);
      setProgress("");
      return;
    }
    const abort = new AbortController();
    setReady(false);
    setError("");
    setPrepared(null);
    setProgress("Preparing document…");
    const timer = setTimeout(() => {
      void (async () => {
        let result: DocumentExportResult;
        for (let retry = 0; ; retry++) {
          try {
            result = await api<DocumentExportResult>(
              `notes/${noteId}/export-preview`,
              {
                method: "POST",
                signal: abort.signal,
                body: JSON.stringify({
                  snapshot,
                  options,
                  preferences: appearance,
                }),
              },
            );
            break;
          } catch (error) {
            if (
              !(error instanceof ApiError) ||
              error.status !== 429 ||
              retry >= 3
            )
              throw error;
            setProgress("Equation renderer is busy; retrying shortly…");
            await abortable(
              new Promise((resolve) => setTimeout(resolve, 750 * (retry + 1))),
              abort.signal,
            );
          }
        }
        setProgress("Rendering diagrams…");
        const p = exportPreferences(appearance, options);
        const colors =
          options.colors === "paper"
            ? ["#ffffff", "#242827", "#335a70", "#cccec7"]
            : (() => {
                const c = paletteFor(p, options.dark);
                return [c.paper, c.text, c.accent, c.line];
              })();
        const resultWithDiagrams = await completeExport(result, abort.signal, [
          ...colors,
          fonts[p.proseFont].family,
        ]);
        abort.signal.throwIfAborted();
        setProgress("Loading embedded fonts and images…");
        setPrepared({
          ...resultWithDiagrams,
          key: ++sequence.current,
          signal: abort.signal,
        });
      })().catch((err: unknown) => {
        if (!abort.signal.aborted) {
          setError(err instanceof Error ? err.message : "Export failed.");
          setProgress("");
        }
      });
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [noteId, snapshot, appearance, options, attempt, format]);
  useEffect(
    () => () => {
      jobController.current?.abort();
    },
    [],
  );
  const refresh = () => {
    jobController.current?.abort();
    setZip(null);
    setSnapshot(current);
    setAppearance(preferences);
    setOptions((old) => ({ ...old, dark }));
  };
  const archive = async () => {
    if (!spaceId) return;
    const abort = new AbortController();
    jobController.current?.abort();
    jobController.current = abort;
    setError("");
    try {
      const job = await api<{ id: string }>("exports", {
        method: "POST",
        signal: abort.signal,
        body: JSON.stringify({
          mutationId: crypto.randomUUID(),
          spaceId,
          resourceIds: [noteId],
          markdownSnapshot: snapshot,
        }),
      });
      setZip({ id: job.id, ready: false });
      const start = Date.now();
      while (Date.now() - start < 180_000) {
        await abortable(
          new Promise((resolve) => setTimeout(resolve, 1500)),
          abort.signal,
        );
        const jobs = await api<
          { id: string; status: string; error?: string }[]
        >("exports", { signal: abort.signal });
        const status = jobs.find((item) => item.id === job.id);
        if (status?.status === "failed")
          throw new Error(status.error || "Archive preparation failed.");
        if (status?.status === "ready") {
          setZip({ id: job.id, ready: true });
          return;
        }
      }
      throw new Error(
        "The archive is still preparing. You can find it in Settings → Exports when ready.",
      );
    } catch (err) {
      if (!abort.signal.aborted) {
        setError(err instanceof Error ? err.message : "Archive failed.");
        setZip(null);
      }
    }
  };
  const action = () => {
    if (format === "md")
      download(
        exportFilename(filename, "md"),
        snapshot.source,
        "text/markdown;charset=utf-8",
      );
    else if (format === "zip") void archive();
    else if (format === "html" && ready && prepared)
      download(
        exportFilename(filename, "html"),
        prepared.html,
        "text/html;charset=utf-8",
      );
    else if (format === "pdf" && ready && frame.current?.contentWindow) {
      const doc = frame.current.contentDocument;
      if (doc) doc.title = filename.trim() || snapshot.title;
      frame.current.contentWindow.focus();
      frame.current.contentWindow.print();
    }
  };
  if (format === "latex")
    return (
      <LatexExportDialog
        noteId={noteId}
        spaceId={spaceId}
        snapshot={snapshot}
        preferences={appearance}
        changed={changed}
        onRefresh={refresh}
        onFormat={setFormat}
        onClose={onClose}
      />
    );
  return (
    <Dialog
      title={uiText("Export document")}
      subtitle={uiText(
        "A private snapshot of the document currently on screen. Your note is not changed.",
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
              value={format}
              onChange={(e) => {
                const next = e.target.value as Format;
                setFormat(next);
                change("colors", next === "pdf" ? "paper" : "document");
              }}
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
          <fieldset disabled={format === "md" || format === "zip"}>
            <legend>
              <I18nText id="Presentation" />
            </legend>
            <label>
              <I18nText id="Style" />
              <NativeSelect
                aria-label={uiText("Style")}
                value={options.style}
                onChange={(e) =>
                  change(
                    "style",
                    e.target.value as DocumentExportOptions["style"],
                  )
                }
              >
                <option value="document">
                  <I18nText id="Match document" />
                </option>
                <option value="academic">
                  <I18nText id="Academic" />
                </option>
                <option value="minimal">
                  <I18nText id="Minimal" />
                </option>
              </NativeSelect>
            </label>
            <label>
              <I18nText id="Colors" />
              <NativeSelect
                aria-label={uiText("Colors")}
                value={options.colors}
                disabled={format === "pdf"}
                onChange={(e) =>
                  change("colors", e.target.value as "paper" | "document")
                }
              >
                <option value="document">
                  <I18nText id="Document colors" />
                </option>
                <option value="paper">
                  <I18nText id="Light paper" />
                </option>
              </NativeSelect>
            </label>
            <label className="document-export-check">
              <Checkbox
                checked={options.title}
                onChange={(e) => change("title", e.target.checked)}
              />
              <I18nText id="Include document title" />
            </label>
            <label className="document-export-check">
              <Checkbox
                checked={options.toc}
                onChange={(e) => change("toc", e.target.checked)}
              />
              <I18nText id="Add table of contents" />
            </label>
            <label>
              <I18nText id="Text scale" />{" "}
              <output>{Math.round(options.scale * 100)}%</output>
              <Slider
                aria-label={uiText("Text scale")}
                aria-valuetext={`${Math.round(options.scale * 100)}%`}

                min="0.7"
                max="1.4"
                step="0.05"
                value={options.scale}
                onChange={(e) => change("scale", Number(e.target.value))}
              />
            </label>
          </fieldset>
          {format === "pdf" && (
            <fieldset>
              <legend>
                <I18nText id="Page setup" />
              </legend>
              <div className="document-export-fields">
                <label>
                  <I18nText id="Paper" />
                  <NativeSelect
                    aria-label={uiText("Paper")}
                    value={options.paper}
                    onChange={(e) =>
                      change("paper", e.target.value as "A4" | "Letter")
                    }
                  >
                    <option>A4</option>
                    <option>
                      <I18nText id="Letter" />
                    </option>
                  </NativeSelect>
                </label>
                <label>
                  <I18nText id="Orientation" />
                  <NativeSelect
                    aria-label={uiText("Orientation")}
                    value={options.orientation}
                    onChange={(e) =>
                      change(
                        "orientation",
                        e.target.value as "portrait" | "landscape",
                      )
                    }
                  >
                    <option value="portrait">
                      <I18nText id="Portrait" />
                    </option>
                    <option value="landscape">
                      <I18nText id="Landscape" />
                    </option>
                  </NativeSelect>
                </label>
              </div>
              <label>
                <I18nText id="Margins (mm)" />
                <TextInput
                  aria-label={uiText("Margins (mm)")}
                  type="number"
                  min={8}
                  max={40}
                  value={options.margin}
                  onChange={(e) =>
                    change(
                      "margin",
                      Math.max(8, Math.min(40, Number(e.target.value) || 20)),
                    )
                  }
                />
              </label>
              <p className="muted">
                <I18nText id="Choose “Save as PDF” in your browser. Disable browser headers and footers. The preview shows document styling; final page breaks appear in the print dialog." />
              </p>
            </fieldset>
          )}
          {format === "zip" && (
            <p className="muted">
              <I18nText id="Includes this Markdown snapshot, its accessible attached file versions and bibliography. Linked notes are not recursively exported. A workspace worker prepares the archive." />
            </p>
          )}
          <p className="muted">
            <I18nText id="Comments, private annotations, bookmarks and account details are excluded. System fonts use bundled equivalents; unsupported scripts may use your device fonts." />
          </p>
        </div>
        <section
          className="document-export-preview"
          aria-label={uiText("Export preview")}
        >
          <div className="document-export-preview-toolbar">
            <span>
              {ready
                ? uiText("Preview ready")
                : progress || "Preview unavailable"}
            </span>
            <Button className="button secondary" onClick={refresh}>
              <RefreshCw size={14} />
              <I18nText id="Refresh snapshot" />
            </Button>
          </div>
          {changed && (
            <p className="document-export-notice" role="status">
              <I18nText id="The document has changed. Refresh to include newer edits." />
            </p>
          )}
          {progress && <progress aria-label={uiText("Preparing export")} />}
          {prepared && (
            <iframe
              key={prepared.key}
              ref={frame}
              title={uiText("Document export preview")}
              sandbox="allow-same-origin allow-modals"
              srcDoc={preview}
              onLoad={() => {
                const currentFrame = frame.current,
                  signal = prepared.signal;
                if (!currentFrame || signal.aborted) return;
                void readyExportFrame(currentFrame, signal)
                  .then(() => {
                    if (!signal.aborted && frame.current === currentFrame) {
                      setReady(true);
                      setProgress("");
                    }
                  })
                  .catch((err: unknown) => {
                    if (!signal.aborted && frame.current === currentFrame) {
                      setError(
                        err instanceof Error ? err.message : "Preview failed.",
                      );
                      setProgress("");
                    }
                  });
              }}
            />
          )}
          {(format === "md" || format === "zip") && (
            <pre className="latex-review-content">{snapshot.source}</pre>
          )}
        </section>
      </div>
      {error || prepared?.warnings.length ? (
        <div
          className="document-export-warnings"
          role={error ? "alert" : "status"}
        >
          {error && <p>{error}</p>}
          {prepared?.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {error && (
            <Button
              className="button secondary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <I18nText id="Retry preview" />
            </Button>
          )}
        </div>
      ) : null}
      <DialogFooter>
        <span className="muted">
          {zip && !zip.ready
            ? uiText("Preparing archive in the background…")
            : uiText("Only accessible content is exported.")}
        </span>
        <Button className="button secondary" onClick={onClose}>
          <I18nText id="Close" />
        </Button>
        {zip?.ready && format === "zip" ? (
          <a
            className="button primary"
            href={`/api/v1/exports/${zip.id}/download`}
            download={exportFilename(filename, "zip")}
          >
            <Download size={16} />
            <I18nText id="Download ZIP" />
          </a>
        ) : (
          <Button
            className="button primary"
            disabled={
              !filename.trim() ||
              ((format === "html" || format === "pdf") && !ready) ||
              (format === "zip" && (!spaceId || !!zip))
            }
            onClick={action}
          >
            {format === "pdf" ? <Printer size={16} /> : <Download size={16} />}
            {format === "pdf"
              ? uiText("Print / Save PDF")
              : format === "zip"
                ? "Prepare ZIP"
                : "Download"}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
