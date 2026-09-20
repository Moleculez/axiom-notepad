"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Annotation, AnnotationData } from "@axiom/shared/research";
import { importPdfAnnotation } from "@axiom/shared/pdf-annotations";
import { PDF_EDIT_MAX_BYTES } from "@axiom/shared/pdf-reader";
import Dialog, { DialogFooter } from "../Dialog";

export default function PdfAnnotationTransfer({
  pdf,
  annotations,
  sha256,
  name,
  mode,
  onImport,
  onClose,
}: {
  pdf: PDFDocumentProxy;
  annotations: Annotation[];
  sha256: string;
  name: string;
  mode: "import" | "export";
  onImport: (items: AnnotationData[], signal: AbortSignal) => Promise<void>;
  onClose: () => void;
}) {
  const [candidates, setCandidates] = useState<AnnotationData[]>([]),
    [selected, setSelected] = useState(new Set<number>()),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [prepared, setPrepared] = useState(false),
    [includePrivate, setIncludePrivate] = useState(false);
  const alive = useRef(true),
    worker = useRef<Worker | null>(null),
    stop = useRef<(() => void) | null>(null),
    cancellation = useRef(new AbortController());
  useEffect(() => {
    alive.current = true;
    cancellation.current = new AbortController();
    return () => {
      alive.current = false;
      cancellation.current.abort();
      stop.current?.();
      worker.current?.terminate();
    };
  }, []);
  const inspect = async () => {
    setBusy(true);
    setError("");
    try {
      const known = new Set(annotations.map((a) => a.data.imported?.sourceId)),
        found: AnnotationData[] = [];
      let skipped = 0;
      for (let n = 1; n <= pdf.numPages; n++) {
        if (!alive.current) return;
        const page = await pdf.getPage(n),
          native = await page.getAnnotations();
        for (const raw of native) {
          if (["Link", "Widget"].includes(raw.subtype)) continue;
          const candidate = importPdfAnnotation(raw, n, page.view, sha256);
          if (!candidate || known.has(candidate.imported!.sourceId)) {
            skipped++;
            continue;
          }
          known.add(candidate.imported!.sourceId);
          found.push(candidate);
          if (found.length > 500)
            throw new Error(
              "More than 500 importable annotations. Import a smaller document instead; nothing was saved.",
            );
        }
        if (alive.current) setStatus(`Inspecting page ${n} of ${pdf.numPages}`);
      }
      if (!alive.current) return;
      setCandidates(found);
      setSelected(new Set(found.map((_, i) => i)));
      setPrepared(true);
      setStatus(
        `${found.length} new annotations · ${skipped} already imported or unsupported`,
      );
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const chosen = annotations.filter((a) => includePrivate || a.shared);
  const exportCopy = async () => {
    setBusy(true);
    setError("");
    try {
      const source = new Uint8Array(await pdf.getData());
      if (!alive.current) return;
      if (source.byteLength > PDF_EDIT_MAX_BYTES)
        throw new Error("Annotated exports support at most 100 MiB.");
      const w = new Worker(
        new URL("../../lib/tools/pdf-worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = w;
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        const timer = setTimeout(() => {
          w.terminate();
          reject(
            new Error("Export exceeded 60 seconds. Export fewer annotations."),
          );
        }, 60000);
        stop.current = () => {
          clearTimeout(timer);
          w.terminate();
          reject(new Error("Export cancelled."));
        };
        w.onmessage = (event) => {
          clearTimeout(timer);
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data.bytes);
        };
        w.onerror = () => {
          clearTimeout(timer);
          reject(
            new Error("The export worker stopped. Your original is unchanged."),
          );
        };
        w.postMessage({ sources: [source], annotations: chosen }, [
          source.buffer,
        ]);
      });
      if (!alive.current) return;
      const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        ),
        link = document.createElement("a");
      link.href = url;
      link.download = name.replace(/\.pdf$/i, "") + "-annotated.pdf";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setStatus("Annotated copy downloaded. The source PDF is unchanged.");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      worker.current?.terminate();
      worker.current = null;
      stop.current = null;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Dialog
      title={
        mode === "import" ? "Import PDF annotations" : "Export annotated PDF"
      }
      size="wide"
      onClose={onClose}
    >
      <p className="muted">
        {mode === "import"
          ? "Preview embedded highlights, underlines, strikeouts, rectangles and notes. Imports are private copies owned by you; the original author is retained as a label."
          : "Download a new PDF with portable annotations. Original PDF annotations remain embedded. Readers of the exported file can see everything you include."}
      </p>
      {mode === "export" && (
        <label>
          <input
            type="checkbox"
            checked={includePrivate}
            onChange={(e) => setIncludePrivate(e.target.checked)}
            disabled={busy}
          />{" "}
          Include my private annotations in this downloaded copy
        </label>
      )}
      {mode === "export" && (
        <p>
          {chosen.length} of {annotations.length} filtered annotations included.
          Source PDF comments may already contain private material; review
          before sharing.
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <p role="status">{status}</p>
      {mode === "import" && prepared && (
        <div className="pdf-import-list">
          {candidates.map((data, index) => (
            <label key={data.imported!.sourceId}>
              <input
                type="checkbox"
                checked={selected.has(index)}
                disabled={busy}
                onChange={() =>
                  setSelected((old) => {
                    const next = new Set(old);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  })
                }
              />
              <span>
                <strong>
                  Page {data.page} · {data.kind}
                </strong>
                <small>{data.imported?.author || "Unspecified author"}</small>
                <span>{data.body || "Text markup"}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <DialogFooter>
        <button className="button secondary" onClick={onClose}>
          {busy ? "Cancel" : "Close"}
        </button>
        {mode === "export" ? (
          <button
            className="button primary"
            disabled={busy || !chosen.length}
            onClick={() => void exportCopy()}
          >
            {busy ? "Preparing…" : "Download annotated copy"}
          </button>
        ) : !prepared ? (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void inspect()}
          >
            {busy ? "Inspecting…" : "Inspect embedded annotations"}
          </button>
        ) : (
          <button
            className="button primary"
            disabled={busy || !selected.size}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onImport(
                  candidates.filter((_, i) => selected.has(i)),
                  cancellation.current.signal,
                );
                if (alive.current) onClose();
              } catch (e) {
                if (alive.current) setError((e as Error).message);
              } finally {
                if (alive.current) setBusy(false);
              }
            }}
          >
            Import {selected.size} privately
          </button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
