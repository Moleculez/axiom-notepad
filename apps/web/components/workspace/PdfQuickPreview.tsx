"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ErrorNotice } from "./ui";
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
    [error, setError] = useState(""),
    [text, setText] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    setPage(Math.max(1, initialPage));
  }, [source, initialPage]);
  useEffect(() => {
    setPdf(null);
    setText("");
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
          url: source,
          enableXfa: false,
          disableAutoFetch: true,
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
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    void pdf
      .getPage(Math.min(page, pdf.numPages))
      .then(async (p) => {
        if (!active || !canvas.current) return;
        const viewport = p.getViewport({
          scale: Math.min(1.5, 850 / p.getViewport({ scale: 1 }).width),
        });
        const el = canvas.current;
        el.width = Math.ceil(viewport.width);
        el.height = Math.ceil(viewport.height);
        render = p.render({ canvas: el, viewport });
        await render.promise;
        const content = await p.getTextContent();
        if (active)
          setText(
            content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ")
              .slice(0, 20000),
          );
      })
      .catch((e) => {
        if (active && e.name !== "RenderingCancelledException")
          setError("This page cannot be previewed.");
      });
    return () => {
      active = false;
      render?.cancel();
    };
  }, [pdf, page]);
  return (
    <div className="pdf-quick-preview">
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
      <canvas ref={canvas} aria-label={`PDF page ${page}`} role="img" />
      <p className="sr-only">{text}</p>
    </div>
  );
}
