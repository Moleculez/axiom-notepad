"use client";
import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ErrorNotice } from "./ui";
import PdfPages from "../pdf/PdfPages";
import { pdfRuntimeOptions } from "../../lib/pdf-runtime";
export default function PdfQuickPreview({
  source,
  interactive = true,
  initialPage = 1,
}: {
  source: string;
  interactive?: boolean;
  initialPage?: number;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(initialPage),
    [scale, setScale] = useState<number | "fit" | "page">("page"),
    [error, setError] = useState("");
  useEffect(() => {
    setPage(Math.max(1, initialPage));
  }, [source, initialPage]);
  useEffect(() => {
    setPdf(null);
    setError("");
    let active = true;
    let loading:
      ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    void import("pdfjs-dist")
      .then((lib) => {
        if (!active) return;
        lib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        loading = lib.getDocument({
          ...pdfRuntimeOptions,
          url: source,
          disableAutoFetch: true,
          disableStream: true,
        });
        return loading.promise;
      })
      .then((doc) => {
        if (active && doc) {
          setPdf(doc);
          setPage((current) => Math.min(Math.max(1, current), doc.numPages));
        }
      })
      .catch(() => {
        if (active)
          setError(
            "This PDF preview could not be loaded. Try opening the original in the research reader.",
          );
      });
    return () => {
      active = false;
      void loading?.destroy();
    };
  }, [source]);
  return (
    <div className="pdf-quick-preview pdf-workbench pdf-preview-reader">
      <ErrorNotice message={error} />
      {interactive && (
        <div className="ws-actions">
          <button
            className="button secondary"
            disabled={!pdf || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous page
          </button>
          <span aria-live="polite">
            {pdf ? `${page} / ${pdf.numPages}` : "Loading PDF…"}
          </span>
          {pdf && (
            <label className="pdf-preview-page-input">
              Go to page{" "}
              <input
                aria-label="Preview page"
                type="number"
                min={1}
                max={pdf.numPages}
                value={page}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (
                    Number.isInteger(value) &&
                    value >= 1 &&
                    value <= pdf.numPages
                  )
                    setPage(value);
                }}
              />
            </label>
          )}
          <button
            className="button secondary"
            disabled={!pdf || page >= pdf.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next page
          </button>
          <select
            aria-label="Preview zoom"
            value={scale}
            onChange={(event) =>
              setScale(
                ["page", "fit"].includes(event.target.value)
                  ? (event.target.value as "page" | "fit")
                  : Number(event.target.value),
              )
            }
          >
            <option value="page">Fit page</option>
            <option value="fit">Fit width</option>
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value * 100}%
              </option>
            ))}
          </select>
        </div>
      )}
      {pdf && (
        <PdfPages
          pdf={pdf}
          page={page}
          jump={page}
          scale={scale}
          rotation={0}
          view="single"
          labels={[]}
          annotations={[]}
          selected=""
          query=""
          area={false}
          onPage={setPage}
          onSelect={() => {}}
          onAnnotation={() => {}}
        />
      )}
    </div>
  );
}
