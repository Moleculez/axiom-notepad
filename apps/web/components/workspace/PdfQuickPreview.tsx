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
          <button
            className="button secondary"
            disabled={!pdf || page >= pdf.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next page
          </button>
        </div>
      )}
      {pdf && (
        <PdfPages
          pdf={pdf}
          page={page}
          jump={page}
          scale="page"
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
