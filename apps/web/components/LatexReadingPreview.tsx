"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { fonts, type Preferences } from "@axiom/shared/appearance";
import {
  documentExportOptionsSchema,
  exportPreferences,
  type DocumentExportResult,
  type MarkdownExportSnapshot,
} from "@axiom/shared/document-export";
import type { LatexOptions } from "@axiom/shared/latex-export";
import { api } from "../lib/client";
import {
  completeExport,
  previewExportHtml,
  readyExportFrame,
} from "../lib/document-export";
import { Button, HelpText, Notice } from "./ui/controls";
export default function LatexReadingPreview({
  noteId,
  snapshot,
  preferences,
  options,
  fingerprint,
}: {
  noteId: string;
  snapshot: MarkdownExportSnapshot;
  preferences: Preferences;
  options: LatexOptions;
  fingerprint: string;
}) {
  const [prepared, setPrepared] = useState<{
      html: string;
      warnings: string[];
      signal: AbortSignal;
    } | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null),
    html = useMemo(
      () => (prepared ? previewExportHtml(prepared.html) : ""),
      [prepared],
    );
  useEffect(() => {
    const controller = new AbortController();
    setPrepared(null);
    setError("");
    setReady(false);
    void (async () => {
      const reading = documentExportOptionsSchema.parse({
        style: "academic",
        colors: "paper",
        paper: options.paper,
        margin: options.margin,
        title: options.title,
        toc: options.toc,
      });
      const result = await api<DocumentExportResult>(
        `notes/${noteId}/export-preview`,
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            snapshot,
            preferences,
            options: reading,
            latex: { options, fingerprint },
          }),
        },
      );
      const completed = await completeExport(result, controller.signal, [
        "#ffffff",
        "#242827",
        "#335a70",
        "#cccec7",
        fonts[exportPreferences(preferences, reading).proseFont].family,
      ]);
      controller.signal.throwIfAborted();
      setPrepared({ ...completed, signal: controller.signal });
    })().catch((reason) => {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Reading preview unavailable.",
        );
    });
    return () => controller.abort();
  }, [noteId, snapshot, preferences, options, fingerprint, attempt]);
  return (
    <div className="latex-reading-preview">
      <HelpText>
        Reading layout only, not a compiled PDF. TeX controls final typography,
        citation layout and page breaks.
      </HelpText>
      {error ? (
        <Notice tone="danger" role="alert">
          {error}
          <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
            Retry preview
          </Button>
        </Notice>
      ) : (
        !ready && <HelpText role="status">Preparing reading preview…</HelpText>
      )}
      {prepared && (
        <iframe
          ref={frame}
          title="Manuscript reading preview"
          sandbox="allow-same-origin"
          srcDoc={html}
          onLoad={() => {
            if (frame.current)
              void readyExportFrame(frame.current, prepared.signal)
                .then(() => {
                  if (!prepared.signal.aborted) setReady(true);
                })
                .catch((reason) => {
                  if (!prepared.signal.aborted)
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Preview loading failed.",
                    );
                });
          }}
        />
      )}
      {!!prepared?.warnings.length && (
        <details>
          <summary>Reading preview notes ({prepared.warnings.length})</summary>
          <ul>
            {prepared.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
