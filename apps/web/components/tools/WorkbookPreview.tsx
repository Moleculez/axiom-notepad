"use client";
import { useEffect, useState } from "react";
import type { FilePreviewManifest } from "@axiom/shared/file-preview";
import { DownloadFallback } from "./FilePreviewSurface";
import WorkbookGrid from "./WorkbookGrid";
import type { WorkbookSnapshot } from "@axiom/shared/workbook-preview";
import { ErrorNotice, Loading } from "../workspace/ui";
export default function WorkbookPreview({
  file,
}: {
  file: FilePreviewManifest;
}) {
  const [snapshot, setSnapshot] = useState<WorkbookSnapshot>({
      sheets: [],
      styles: [],
      warnings: [],
    }),
    [selected, setSelected] = useState(0),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  const sheets = snapshot.sheets;
  useEffect(() => {
    setLoaded(false);
    setError("");
    if (file.bytes > 25_000_000) return;
    const c = new AbortController();
    const worker = new Worker(
      new URL("../../lib/tools/workbook.worker.ts", import.meta.url),
      { type: "module" },
    );
    let timeout: ReturnType<typeof setTimeout>;
    worker.onmessage = (e) => {
      clearTimeout(timeout);
      setLoaded(true);
      if (e.data.error) setError(e.data.error);
      else {
        setSnapshot(e.data);
        const wanted = new URLSearchParams(location.hash.slice(1)).get("sheet");
        const index = e.data.sheets.findIndex(
          (s: { name: string }) => s.name === wanted,
        );
        setSelected(
          index >= 0
            ? index
            : Math.max(
                0,
                e.data.sheets.findIndex((s: { hidden: boolean }) => !s.hidden),
              ),
        );
      }
      worker.terminate();
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      setError("This workbook cannot be previewed safely.");
      worker.terminate();
    };
    void fetch(file.source, { signal: c.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("Workbook could not be loaded.");
        const data = await r.arrayBuffer();
        if (data.byteLength > 25_000_000)
          throw new Error("Workbook exceeds the 25 MB preview limit.");
        if (!c.signal.aborted) {
          worker.postMessage(data, [data]);
          timeout = setTimeout(() => {
            worker.terminate();
            setError(
              "Workbook preview exceeded its time limit. Download the original instead.",
            );
          }, 20000);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => {
      c.abort();
      clearTimeout(timeout);
      worker.terminate();
    };
  }, [file.source, file.bytes]);
  if (file.bytes > 25_000_000)
    return (
      <DownloadFallback
        file={file}
        message="Workbooks over 25 MB are download-only to protect browser memory."
      />
    );
  return (
    <>
      <div className="tool-controls">
        <label>
          Sheet{" "}
          <select
            aria-label="Workbook sheet"
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {sheets.map((s, i) => (
              <option key={i} value={i}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <span className="tool-spacer" />
        <small>
          Read-only · cached formula values · no macros or links executed
        </small>
      </div>
      <ErrorNotice message={error} />
      {!!snapshot.warnings.length && (
        <details className="workbook-notice">
          <summary>Preview information ({snapshot.warnings.length})</summary>
          {snapshot.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </details>
      )}
      {sheets[selected] ? (
        <>
          <WorkbookGrid
            key={selected}
            sheet={sheets[selected]}
            styles={snapshot.styles}
            resourceId={file.resourceId}
            versionId={file.versionId}
          />
          <nav className="workbook-sheet-tabs" aria-label="Workbook worksheets">
            {sheets.map((sheet, index) => (
              <button
                key={index}
                aria-pressed={index === selected}
                onClick={() => setSelected(index)}
              >
                {sheet.name}
                {sheet.hidden ? " (hidden in original)" : ""}
              </button>
            ))}
          </nav>
          {sheets[selected].truncated && (
            <p className="ws-note">
              This large sheet is limited to 50,000 rows and 256 columns in
              preview.
            </p>
          )}
        </>
      ) : (
        !error &&
        (loaded ? (
          <p className="ws-note">This workbook has no worksheets.</p>
        ) : (
          <Loading label="Decoding workbook in an isolated worker…" />
        ))
      )}
    </>
  );
}
