"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  RotateCw,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import {
  PDF_EDIT_MAX_BYTES,
  PDF_EDIT_MAX_PAGES,
  pdfPageRange,
  type PdfPageChoice,
} from "@axiom/shared/pdf-reader";
import Dialog from "../Dialog";
import { pdfRuntimeOptions } from "../../lib/pdf-runtime";
import PdfSaveCopy from "./PdfSaveCopy";
import type { PaperMeta } from "../../lib/research-store";
import type { Annotation } from "@axiom/shared/research";
type Choice = PdfPageChoice & { id: string };
export default function PdfOrganizer({
  pdf,
  name,
  bytes,
  onClose,
  meta,
  annotations = [],
  returnFocus,
}: {
  pdf: PDFDocumentProxy;
  name: string;
  bytes: number;
  onClose: () => void;
  meta?: PaperMeta;
  annotations?: Annotation[];
  returnFocus?: () => HTMLElement | null;
}) {
  const [pages, setPages] = useState<Choice[]>(() =>
    Array.from(
      { length: Math.min(pdf.numPages, PDF_EDIT_MAX_PAGES) },
      (_, i) => ({
        source: 0,
        page: i + 1,
        rotation: 0,
        id: crypto.randomUUID(),
      }),
    ),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [history, setHistory] = useState<Choice[][]>([]),
    [range, setRange] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [names, setNames] = useState([name]);
  const [prepared, setPrepared] = useState<Uint8Array | null>(null);
  const sources = useRef<Uint8Array[]>([]),
    worker = useRef<Worker | null>(null),
    exportTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    drag = useRef<string | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      worker.current?.terminate();
      clearTimeout(exportTimer.current);
      sources.current = [];
    };
  }, []);
  const disabled =
    bytes > PDF_EDIT_MAX_BYTES || pdf.numPages > PDF_EDIT_MAX_PAGES;
  const change = (next: Choice[]) => {
    if (!next.length) {
      setError("Keep at least one page.");
      return;
    }
    if (next.length > PDF_EDIT_MAX_PAGES) {
      setError("The output is limited to 2,000 pages.");
      return;
    }
    setHistory((h) => [...h.slice(-19), pages]);
    setPages(next);
    setError("");
  };
  const move = (id: string, offset: number) => {
    const i = pages.findIndex((p) => p.id === id),
      to = i + offset;
    if (to < 0 || to >= pages.length) return;
    const next = [...pages];
    [next[i], next[to]] = [next[to], next[i]];
    change(next);
  };
  const original = async () => {
    if (!sources.current.length)
      sources.current = [new Uint8Array(await pdf.getData())];
    return sources.current;
  };
  const merge = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const existing = await original();
      if (
        existing.reduce((n, s) => n + s.length, file.size) > PDF_EDIT_MAX_BYTES
      )
        throw new Error("The combined source PDFs must fit within 100 MiB.");
      const bytes = new Uint8Array(await file.arrayBuffer()),
        lib = await import("pdfjs-dist");
      const loading = lib.getDocument({
        ...pdfRuntimeOptions,
        data: bytes.slice(),
      });
      try {
        const doc = await loading.promise;
        if (pages.length + doc.numPages > PDF_EDIT_MAX_PAGES)
          throw new Error("The combined file exceeds 2,000 pages.");
        if (!mounted.current) return;
        const source = existing.length;
        sources.current = [...existing, bytes];
        setNames((n) => [...n, file.name]);
        change([
          ...pages,
          ...Array.from({ length: doc.numPages }, (_, i) => ({
            id: crypto.randomUUID(),
            source,
            page: i + 1,
            rotation: 0,
          })),
        ]);
      } finally {
        await loading.destroy();
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const exportCopy = async (save = false) => {
    setBusy(true);
    setError("");
    try {
      const sources = (await original()).map((bytes) => bytes.slice());
      if (!mounted.current) return;
      const w = new Worker(
        new URL("../../lib/tools/pdf-worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = w;
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        const timeout = (exportTimer.current = setTimeout(() => {
          w.terminate();
          reject(
            new Error(
              "PDF export exceeded its 60-second processing limit. Try fewer pages.",
            ),
          );
        }, 60000));
        w.onmessage = (e) => {
          clearTimeout(timeout);
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data.bytes);
        };
        w.onerror = () => {
          clearTimeout(timeout);
          reject(
            new Error("The PDF worker stopped. Your original is unchanged."),
          );
        };
        w.postMessage(
          { sources, pages },
          sources.map((s) => s.buffer),
        );
      });
      if (!mounted.current) return;
      if (save) {
        setPrepared(bytes);
        return;
      }
      const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = name.replace(/\.pdf$/i, "") + "-arranged.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      worker.current?.terminate();
      worker.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  if (prepared && meta)
    return (
      <PdfSaveCopy
        bytes={prepared}
        meta={meta}
        pages={pages}
        annotations={annotations}
        onClose={() => setPrepared(null)}
      />
    );
  return (
    <Dialog
      title="Organize PDF pages"
      onClose={onClose}
      returnFocus={returnFocus}
      wide
    >
      <p className="muted">
        Arrange a new copy. The original, its annotations, and existing
        citations stay unchanged. Document outlines, internal destinations and
        Axiom annotations are not transferred into this copy.
      </p>
      {disabled && (
        <p role="alert">
          Page operations support up to 100 MiB and 2,000 pages. This original
          exceeds that limit.
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="pdf-organizer-actions">
        <input
          aria-label="Select page range"
          value={range}
          onChange={(e) => setRange(e.target.value)}
          placeholder="Select positions, e.g. 1, 3-5"
        />
        <button
          disabled={busy || disabled}
          onClick={() => {
            try {
              const indices = pdfPageRange(range, pages.length);
              setSelected(new Set(indices.map((n) => pages[n - 1].id)));
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Select
        </button>
        <button
          disabled={busy || !selected.size}
          onClick={() => change(pages.filter((p) => selected.has(p.id)))}
        >
          Keep selected
        </button>
        <button
          disabled={busy || !selected.size}
          onClick={() => change(pages.filter((p) => !selected.has(p.id)))}
        >
          <Trash2 size={15} />
          Remove selected
        </button>
        <button
          disabled={busy || !history.length}
          onClick={() => {
            setPages(history.at(-1)!);
            setHistory(history.slice(0, -1));
            setSelected(new Set());
          }}
        >
          <Undo2 size={15} />
          Undo
        </button>
        <label className="button secondary">
          <Upload size={15} />
          Merge PDF
          <input
            className="sr-only"
            type="file"
            accept="application/pdf"
            disabled={busy || disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void merge(file);
            }}
          />
        </label>
      </div>
      <div className="pdf-organizer-grid">
        {pages.map((p, index) => (
          <article
            className={selected.has(p.id) ? "selected" : ""}
            key={p.id}
            draggable={!busy}
            onDragStart={(e) => {
              drag.current = p.id;
              e.dataTransfer.setData("text/plain", p.id);
            }}
            onDragEnd={() => {
              drag.current = null;
            }}
            onDragOver={(e) => {
              if (drag.current && !busy) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!drag.current || busy || drag.current === p.id) return;
              const source = pages.find((p) => p.id === drag.current);
              if (!source) return;
              const next = pages.filter((p) => p !== source);
              next.splice(
                next.findIndex((p) => p.id === e.currentTarget.dataset.id),
                0,
                source,
              );
              change(next);
              drag.current = null;
            }}
            data-id={p.id}
          >
            <label>
              <input
                type="checkbox"
                disabled={busy}
                aria-label={`Select page position ${index + 1}`}
                checked={selected.has(p.id)}
                onChange={(e) =>
                  setSelected((old) => {
                    const next = new Set(old);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    return next;
                  })
                }
              />
              <strong>{index + 1}</strong>
            </label>
            <span title={names[p.source]}>{names[p.source]}</span>
            <small>
              Original page {p.page} · +{p.rotation}°
            </small>
            <div className="pdf-organizer-page-actions">
              <button
                className="icon-button"
                disabled={busy || index === 0}
                aria-label={`Move page ${index + 1} earlier`}
                title="Move earlier"
                onClick={() => move(p.id, -1)}
              >
                <ArrowLeft size={14} />
              </button>
              <button
                className="icon-button"
                disabled={busy || index === pages.length - 1}
                aria-label={`Move page ${index + 1} later`}
                title="Move later"
                onClick={() => move(p.id, 1)}
              >
                <ArrowRight size={14} />
              </button>
              <button
                className="icon-button"
                disabled={busy}
                aria-label={`Rotate page ${index + 1}`}
                title="Rotate clockwise"
                onClick={() =>
                  change(
                    pages.map((item) =>
                      item.id === p.id
                        ? { ...item, rotation: (item.rotation + 90) % 360 }
                        : item,
                    ),
                  )
                }
              >
                <RotateCw size={14} />
              </button>
              <button
                className="icon-button"
                disabled={busy}
                aria-label={`Duplicate page ${index + 1}`}
                title="Duplicate"
                onClick={() =>
                  change([
                    ...pages.slice(0, index + 1),
                    { ...p, id: crypto.randomUUID() },
                    ...pages.slice(index + 1),
                  ])
                }
              >
                <Copy size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="dialog-footer">
        <span>
          {pages.length} output pages · {selected.size} selected
        </span>
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        {meta?.resource_id && (
          <button
            className="button secondary"
            disabled={busy || disabled}
            onClick={() => void exportCopy(true)}
          >
            Save to workspace…
          </button>
        )}
        <button
          className="button primary"
          disabled={busy || disabled}
          onClick={() => void exportCopy()}
        >
          <Download size={15} />
          {busy ? "Processing…" : "Download arranged copy"}
        </button>
      </div>
    </Dialog>
  );
}
