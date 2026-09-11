"use client";
import { useEffect, useState } from "react";
import type { FilePreviewManifest } from "@axiom/shared/file-preview";
import { DataGrid, DownloadFallback } from "./FilePreviewSurface";
import { ErrorNotice, Loading } from "../workspace/ui";
type Sheet = { name: string; rows: string[][]; truncated: boolean };
export default function WorkbookPreview({
  file,
}: {
  file: FilePreviewManifest;
}) {
  const [sheets, setSheets] = useState<Sheet[]>([]),
    [selected, setSelected] = useState(0),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  useEffect(() => {
    if (file.bytes > 25_000_000) return;
    const c = new AbortController();
    const worker = new Worker(
      new URL("../../lib/tools/workbook.worker.ts", import.meta.url),
      { type: "module" },
    );
    let timeout: ReturnType<typeof setTimeout>;
    worker.onmessage = (e) => {
      clearTimeout(timeout);
      if (e.data.error) setError(e.data.error);
      else setSheets(e.data.sheets);
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
        <input
          aria-label="Search workbook sheet"
          placeholder="Find in sheet…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="tool-spacer" />
        <small>
          Read-only · cached formula values · no macros or links executed
        </small>
      </div>
      <ErrorNotice message={error} />
      {sheets[selected] ? (
        <>
          <DataGrid
            key={selected}
            rows={sheets[selected].rows}
            search={search}
          />
          {sheets[selected].truncated && (
            <p className="ws-note">
              This large sheet is limited to 50,000 rows and 256 columns in
              preview.
            </p>
          )}
        </>
      ) : (
        !error && <Loading label="Decoding workbook in an isolated worker…" />
      )}
    </>
  );
}
