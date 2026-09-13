"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRevisionVisit } from "../../lib/revision-visit";
import type { Suggestion } from "@axiom/shared/revisions";
const SuggestionEditor = dynamic(
  () => import("../revisions/SuggestionEditor"),
  { ssr: false },
);
const SuggestionReview = dynamic(
  () => import("../revisions/SuggestionReview"),
  { ssr: false },
);
import {
  ArrowLeft,
  Braces,
  Eye,
  Download,
  History,
  FilePenLine,
  PanelLeftClose,
  Undo2,
  Redo2,
  Save,
  Columns2,
  Rows2,
  Settings2,
  Check,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import type { ToolProject } from "@axiom/shared/research-tools";
import { mathProjectSettings } from "@axiom/shared/research-tools";
import { useToolDocument } from "../../lib/tools/use-tool-document";
import { downloadBlob, downloadText } from "../../lib/tools/download";
import {
  captureMathPreview,
  mathImageBlob,
  type MathImageFormat,
} from "../../lib/tools/math-export";
import { post, api } from "../../lib/client";
import {
  ErrorNotice,
  Loading,
  useWorkspace,
  useLocation,
  WorkspaceLink,
} from "../workspace/ui";
import StudioSource, { type StudioSourceHandle } from "./StudioSource";
import MathPalette from "./MathPalette";
import MathPreviewActions from "./MathPreviewActions";
import Dialog from "../Dialog";
import MathAssistant from "./MathAssistant";
import ResourceDiscussion from "./ResourceDiscussion";
import ResourceSharing from "../workspace/ResourceSharing";
import { retainDraft } from "../../lib/editor-recovery";
import {
  readMathBridge,
  storeMathBridge,
  type MathNoteBridge,
} from "../../lib/tools/math-note-bridge";
const MathVisual = dynamic(() => import("./MathVisual"), { ssr: false });
const ResourceHistory = dynamic(() => import("../revisions/ResourceHistory"), {
  ssr: false,
});
export default function MathStudio({ project }: { project: ToolProject }) {
  const reviewLocation = useLocation(),
    requestedReview = reviewLocation.params.get("review");
  const { session, notify, navigate, refresh } = useWorkspace(),
    document = useToolDocument(
      project.resource_id,
      project.generation ?? 1,
      session.user,
      project.role === "editor",
    );
  const [mode, setMode] = useState<"source" | "visual">("source"),
    [review, setReview] = useState(false),
    [proposal, setProposal] = useState<Suggestion | "new" | null>(null),
    [noteBridge, setNoteBridge] = useState<MathNoteBridge | null>(null),
    [palette, setPalette] = useState(true),
    [visualRecovery, setVisualRecovery] = useState<string | null>(null),
    [panel, setPanel] = useState<
      "history" | "settings" | "export" | "assistant" | "discussion" | null
    >(null),
    [error, setError] = useState(""),
    [stacked, setStacked] = useState(false),
    [busy, setBusy] = useState(false);
  const previousVisit = useRevisionVisit(session.user.id, project.resource_id);
  useEffect(() => {
    if (
      requestedReview === "suggestions" &&
      reviewLocation.path.endsWith("/" + project.resource_id)
    )
      setReview(true);
  }, [requestedReview, reviewLocation.path, project.resource_id]);
  const validatedSettings = mathProjectSettings.safeParse(project.settings);
  const defaults = validatedSettings.success
    ? validatedSettings.data
    : mathProjectSettings.parse({});
  const [macros, setMacros] = useState(defaults.macros),
    [foreground, setForeground] = useState(defaults.foreground),
    [background, setBackground] = useState(defaults.background),
    [transparent, setTransparent] = useState(defaults.transparent),
    [fontSize, setFontSize] = useState(defaults.fontSize),
    [numbered, setNumbered] = useState(defaults.numbered),
    [scale, setScale] = useState(3),
    [imageFormat, setImageFormat] = useState<MathImageFormat>("png");
  const savedSettings = useRef({ value: defaults, version: project.version }),
    settingsWrite = useRef<Promise<void> | null>(null);
  const sourceEditor = useRef<StudioSourceHandle>(null),
    preview = useRef<HTMLDivElement>(null);
  const settingsGeneration = useRef(project.generation);
  useEffect(() => {
    // Ordinary collaborator refreshes must not overwrite an open settings draft.
    // Restoring a revision is a new document generation and restores its settings.
    if (settingsGeneration.current === project.generation) return;
    settingsGeneration.current = project.generation;
    const restored = mathProjectSettings.parse(project.settings ?? {});
    setMacros(restored.macros);
    setForeground(restored.foreground);
    setBackground(restored.background);
    setTransparent(restored.transparent);
    setFontSize(restored.fontSize);
    setNumbered(restored.numbered);
    savedSettings.current = { value: restored, version: project.version };
  }, [project.generation, project.settings, project.version]);
  useEffect(() => {
    setNoteBridge(readMathBridge(session.user.id, project.resource_id));
  }, [project.resource_id, session.user.id]);
  const request = useMemo(
    () =>
      JSON.stringify({
        tex: document.source,
        display: true,
        macros: macros.split("\n").filter(Boolean),
        physics: true,
      }),
    [document.source, macros],
  );
  const insert = (value: string, fields: [number, number][] = []) => {
    if (!document.binding || document.readOnly) return;
    if (mode === "source" && sourceEditor.current) {
      sourceEditor.current.insert(value, fields);
      return;
    }
    const selection = document.binding.selection(),
      from = Math.min(selection.anchor, selection.head),
      to = Math.max(selection.anchor, selection.head);
    document.binding.transact({
      kind: "command",
      changes: [{ from, to, insert: value }],
      selection: { anchor: from + value.length, head: from + value.length },
    });
  };
  const snapshot = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await flushProject();
      await post(`resources/${project.resource_id}/history`, {
        label: `Checkpoint · ${new Date().toLocaleString()}`,
        mutationId: crypto.randomUUID(),
      });
      notify("Named checkpoint saved to project history.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const persistSettings = async () => {
    const value = mathProjectSettings.parse({
      macros,
      foreground,
      background,
      transparent,
      fontSize,
      numbered,
    });
    // Settings share the checkpoint boundary with source. Serialize overlapping
    // saves and retain the CAS version so a collaborator is never overwritten.
    while (settingsWrite.current) await settingsWrite.current;
    if (JSON.stringify(value) === JSON.stringify(savedSettings.current.value))
      return;
    const write = api(`tools/${project.resource_id}/settings`, {
      method: "PATCH",
      body: JSON.stringify({
        version: savedSettings.current.version,
        settings: value,
      }),
    }).then(() => {
      savedSettings.current = {
        value,
        version: savedSettings.current.version + 1,
      };
    });
    settingsWrite.current = write;
    try {
      await write;
    } finally {
      if (settingsWrite.current === write) settingsWrite.current = null;
    }
  };
  const flushProject = async () => {
    await document.flush();
    await persistSettings();
  };
  const saveSettings = async () => {
    try {
      await persistSettings();
      notify("Project rendering settings saved.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const exportMath = async (format: string) => {
    setError("");
    try {
      const name = project.name.replace(/\.tex$/i, "");
      if (format === "tex") {
        downloadText(
          (macros ? macros + "\n" : "") + document.source,
          name + ".tex",
          "application/x-tex",
        );
        return;
      }
      const settings = { foreground, background, transparent, scale };
      const { svg: xml, math } = captureMathPreview(
        preview.current,
        request,
        settings,
      );
      if (format === "svg" || format === "png" || format === "jpeg")
        downloadBlob(
          await mathImageBlob(xml, format, settings),
          name + "." + (format === "jpeg" ? "jpg" : format),
        );
      else if (format === "mathml") {
        if (!math) throw new Error("MathML is unavailable for this equation.");
        downloadText(
          new XMLSerializer().serializeToString(math),
          name + ".mml",
          "application/mathml+xml",
        );
      } else if (format === "docx" || format === "omml") {
        if (!math)
          throw new Error("MathML is unavailable for editable Office export.");
        const office = await import("../../lib/tools/math-office");
        if (format === "docx")
          downloadBlob(
            await office.mathDocx(math, document.source),
            name + ".docx",
          );
        else
          downloadText(
            office.mathMLToOMML(math),
            name + ".omml",
            "application/xml",
          );
      } else if (format === "html")
        downloadText(
          `<!doctype html><html lang="en"><meta charset="utf-8"><title>Equation</title><body>${xml}</body></html>`,
          name + ".html",
          "text/html",
        );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === "Slash" && !e.isComposing) {
        e.preventDefault();
        setMode((m) => (m === "source" ? "visual" : "source"));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <main
      className={`research-studio math-studio ${stacked ? "is-stacked" : ""}`}
    >
      <header className="studio-header">
        <WorkspaceLink
          to={`/explorer?space=${project.space_id}${project.parent_id ? `&folder=${project.parent_id}` : ""}`}
          className="icon-button"
          aria-label="Back to folder"
        >
          <ArrowLeft size={18} />
        </WorkspaceLink>
        <div className="studio-title">
          <span>Math Studio</span>
          <h1>{project.name}</h1>
        </div>
        <span className="tool-spacer" />
        <ResourceSharing resourceId={project.resource_id} />
        {noteBridge && (
          <button
            className="button secondary"
            disabled={!document.binding}
            onClick={() => {
              try {
                storeMathBridge(session.user.id, {
                  ...noteBridge,
                  result: document.binding!.source,
                });
                navigate(`/notes/${noteBridge.noteId}`);
              } catch (e) {
                setError(
                  `Could not prepare the return to your note: ${(e as Error).message}. Copy or export the LaTeX instead.`,
                );
              }
            }}
          >
            Review in note
          </button>
        )}
        <div className="studio-presence">
          {document.peers.map((p) => (
            <span
              title={p.name}
              key={p.clientId}
              style={{ background: p.color }}
            >
              {p.name.slice(0, 1)}
            </span>
          ))}
        </div>
        <button
          className="icon-button"
          title="Checkpoint history"
          aria-label="Checkpoint history"
          onClick={() => setPanel("history")}
        >
          <History size={17} />
        </button>
        {project.role !== "viewer" && (
          <button
            className="icon-button"
            aria-label="Review suggestions"
            title="Review and suggest changes to the equation"
            onClick={() => setReview(true)}
          >
            <FilePenLine size={17} />
          </button>
        )}
        <button
          className="icon-button"
          title="Rendering settings"
          aria-label="Rendering settings"
          onClick={() => setPanel("settings")}
        >
          <Settings2 size={17} />
        </button>
        <button
          className="button secondary"
          disabled={document.readOnly || busy}
          onClick={() => void snapshot()}
        >
          <Save size={15} />
          {busy ? "Saving…" : "Checkpoint"}
        </button>
        <button
          className="icon-button"
          aria-label="OCR and math assistant"
          title="OCR and math assistant"
          onClick={() => setPanel("assistant")}
        >
          <Sparkles size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="Project discussion"
          title="Project discussion"
          onClick={() => setPanel("discussion")}
        >
          <MessageSquare size={17} />
        </button>
        <button className="button primary" onClick={() => setPanel("export")}>
          <Download size={15} />
          Export
        </button>
      </header>
      <ErrorNotice message={error || document.error} />
      {visualRecovery !== null && (
        <div className="tool-recovery">
          <span>A conflicting visual draft is retained. </span>
          <button
            className="button secondary"
            onClick={() => downloadText(visualRecovery, "visual-draft.tex")}
          >
            Download visual draft
          </button>
          <button
            className="button ghost"
            onClick={() => setVisualRecovery(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {document.recovery !== null && (
        <div className="tool-recovery">
          <p>
            Previous access changed. The retained source is available for
            export; it will not be replayed into the shared project.
          </p>
          <button
            className="button secondary"
            onClick={() =>
              downloadText(document.recovery!, "recovered-equation.tex")
            }
          >
            Download retained draft
          </button>
          <button className="button secondary" onClick={document.reopen}>
            Reopen current version
          </button>
        </div>
      )}
      <div className="studio-body">
        {palette && (
          <MathPalette
            userId={session.user.id}
            readOnly={document.readOnly}
            insert={insert}
            onError={setError}
          />
        )}
        <section className="math-workspace">
          <div className="tool-controls">
            <button
              className="icon-button"
              aria-label="Toggle symbol palette"
              title="Toggle symbol palette"
              onClick={() => setPalette(!palette)}
            >
              <PanelLeftClose size={16} />
            </button>
            <div className="studio-segmented">
              <button
                aria-pressed={mode === "source"}
                onClick={() => setMode("source")}
              >
                <Braces size={14} />
                Source
              </button>
              <button
                aria-pressed={mode === "visual"}
                onClick={() => setMode("visual")}
              >
                <Eye size={14} />
                Visual
              </button>
            </div>
            <span className="tool-separator" />
            <button
              className="icon-button"
              title="Undo"
              aria-label="Undo"
              disabled={document.readOnly}
              onClick={() => document.binding?.history(false)}
            >
              <Undo2 size={16} />
            </button>
            <button
              className="icon-button"
              title="Redo"
              aria-label="Redo"
              disabled={document.readOnly}
              onClick={() => document.binding?.history(true)}
            >
              <Redo2 size={16} />
            </button>
            <span className="tool-spacer" />
            <button
              className="icon-button"
              aria-label="Toggle preview layout"
              title="Toggle preview layout"
              onClick={() => setStacked(!stacked)}
            >
              {stacked ? <Columns2 size={16} /> : <Rows2 size={16} />}
            </button>
          </div>
          <div className="math-split">
            <section className="math-input-pane">
              {document.binding ? (
                mode === "source" ? (
                  <StudioSource
                    ref={sourceEditor}
                    macros={macros}
                    binding={document.binding}
                    readOnly={document.readOnly}
                  />
                ) : (
                  <MathVisual
                    binding={document.binding}
                    readOnly={document.readOnly}
                    onRetain={(value) => {
                      setVisualRecovery(value);
                      try {
                        retainDraft(
                          session.user.id,
                          project.resource_id,
                          value,
                        );
                      } catch {
                        setError(
                          "Recovery storage is full. Download the retained visual draft before closing this page.",
                        );
                      }
                    }}
                  />
                )
              ) : (
                <Loading />
              )}
            </section>
            <section className="math-preview-pane">
              <MathPreviewActions
                preview={preview}
                format={imageFormat}
                onFormat={setImageFormat}
                request={request}
                latex={(macros ? macros + "\n" : "") + document.source}
                settings={{ foreground, background, transparent, scale }}
                onScale={setScale}
                onTransparent={setTransparent}
                onExport={exportMath}
                onPanel={setPanel}
                onError={setError}
                notify={notify}
              />
              <div
                className={`math-publication ${transparent && imageFormat !== "jpeg" ? "transparency-grid" : ""}`}
                style={{
                  backgroundColor: background,
                  color: foreground,
                  fontSize,
                }}
                ref={preview}
              >
                <div
                  className="math-render"
                  data-math-request={request}
                  key={request}
                  aria-busy="true"
                />
                {numbered && <span className="math-studio-number">(1)</span>}
              </div>
              <p className="math-preview-note">
                AMS · chemistry · physics · local rendering
              </p>
            </section>
          </div>
        </section>
      </div>
      <footer className="studio-status">
        <span>
          <Check size={13} />
          {document.status}
        </span>
        <span>
          {document.source.length.toLocaleString()} characters ·{" "}
          {document.readOnly ? "Read-only" : "Live collaboration"} · ⌘ / Source
          / Visual
        </span>
      </footer>
      {panel === "history" && (
        <ResourceHistory
          previousVisit={previousVisit}
          resourceId={project.resource_id}
          canEdit={!document.readOnly}
          capture={() => ({
            body: document.binding?.source ?? document.source,
            settings: {
              macros,
              foreground,
              background,
              transparent,
              fontSize,
              numbered,
            },
          })}
          flush={flushProject}
          onClose={() => setPanel(null)}
          onRestore={() => {
            refresh();
            setPanel(null);
          }}
        />
      )}
      {panel && panel !== "history" && (
        <Dialog
          title={
            panel === "export"
              ? "Export equation"
              : panel === "settings"
                ? "Rendering settings"
                : panel === "assistant"
                  ? "OCR & mathematical assistance"
                  : panel === "discussion"
                    ? "Project discussion"
                    : "Checkpoint history"
          }
          onClose={() => setPanel(null)}
          size={panel === "assistant" ? "wide" : undefined}
        >
          {panel === "assistant" ? (
            <MathAssistant
              resourceId={project.resource_id}
              source={document.source}
              readOnly={document.readOnly}
              onInsert={insert}
            />
          ) : panel === "discussion" ? (
            <ResourceDiscussion
              resourceId={project.resource_id}
              canComment={project.role !== "viewer"}
            />
          ) : panel === "export" ? (
            <>
              <p>
                Exports are generated locally. Your original LaTeX remains
                editable.
              </p>
              <label>
                Raster resolution
                <select
                  value={scale}
                  onChange={(e) => setScale(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}×
                    </option>
                  ))}
                </select>
              </label>
              <div className="tool-export-grid">
                {[
                  "svg",
                  "png",
                  "jpeg",
                  "tex",
                  "mathml",
                  "html",
                  "omml",
                  "docx",
                ].map((f) => (
                  <button
                    className="button secondary"
                    key={f}
                    onClick={() => void exportMath(f)}
                  >
                    <Download size={15} />
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </>
          ) : panel === "settings" ? (
            <div className="tool-settings-fields">
              <label>
                Equation size{" "}
                <input
                  type="range"
                  min={16}
                  max={64}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                />
                <span>{fontSize} px</span>
              </label>
              <label>
                Ink color
                <input
                  type="color"
                  value={foreground}
                  onChange={(e) => setForeground(e.target.value)}
                />
                <code>{foreground}</code>
              </label>
              <label>
                Paper color
                <input
                  type="color"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                />
                <code>{background}</code>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={transparent}
                  onChange={(e) => setTransparent(e.target.checked)}
                />
                Transparent SVG / PNG background
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={numbered}
                  onChange={(e) => setNumbered(e.target.checked)}
                />
                Show equation number
              </label>
              <label className="tool-setting-stack">
                TeX macro definitions
                <textarea
                  rows={5}
                  spellCheck={false}
                  maxLength={15000}
                  value={macros}
                  onChange={(e) => setMacros(e.target.value)}
                  placeholder={"\\newcommand{\\vect}[1]{\\mathbf{#1}}"}
                />
              </label>
              <button
                className="button primary"
                disabled={document.readOnly}
                onClick={() => void saveSettings()}
              >
                Save project settings
              </button>
            </div>
          ) : null}
          <ErrorNotice message={error} />
        </Dialog>
      )}
      {review && (
        <SuggestionReview
          noteId={project.resource_id}
          generation={project.generation ?? 1}
          canEdit={project.role === "editor"}
          onClose={() => setReview(false)}
          onCompose={(value) => {
            if (!document.binding) {
              notify(
                "Wait for the equation to connect before suggesting edits.",
              );
              return;
            }
            setProposal(value ?? "new");
          }}
        />
      )}
      {proposal && document.binding && (
        <SuggestionEditor
          noteId={project.resource_id}
          generation={project.generation ?? 1}
          title={project.name}
          accepted={document.binding}
          format="latex"
          proposal={proposal === "new" ? undefined : proposal}
          onClose={() => setProposal(null)}
        />
      )}
    </main>
  );
}
