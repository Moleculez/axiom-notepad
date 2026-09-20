"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfComparison } from "@axiom/shared/pdf-compare";
import type { PdfOcrJob } from "@axiom/shared/pdf-ocr";
import { api } from "../../lib/client";
import { openPaperSource, type PaperMeta } from "../../lib/research-store";
import { pdfRuntimeOptions } from "../../lib/pdf-runtime";
import PdfPages from "./PdfPages";
import Dialog from "../Dialog";
type FileChoice = { id: string; name: string; current_version_id: string };
export default function PdfCompare({
  pdf,
  meta,
  userId,
  onClose,
  returnFocus,
}: {
  pdf: PDFDocumentProxy;
  meta: PaperMeta;
  userId: string;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
}) {
  const [query, setQuery] = useState(""),
    [files, setFiles] = useState<FileChoice[]>([]),
    [file, setFile] = useState(meta.resource_id ?? "");
  const [versions, setVersions] = useState<{ id: string; ordinal: number }[]>(
      [],
    ),
    [version, setVersion] = useState(""),
    [other, setOther] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<[number, number]>([1, 1]),
    [scales, setScales] = useState<[number | "fit", number | "fit"]>([
      "fit",
      "fit",
    ]),
    [linked, setLinked] = useState(true),
    [swapped, setSwapped] = useState(false);
  const [pairs, setPairs] = useState<PdfComparison[]>([]),
    [index, setIndex] = useState(0),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const [ocrJobs, setOcrJobs] = useState<[PdfOcrJob[], PdfOcrJob[]]>([[], []]),
    [ocr, setOcr] = useState<[string, string]>(["", ""]),
    [scroll, setScroll] = useState<[number, number]>([0, 0]);
  const run = useRef(0),
    worker = useRef<Worker | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setOcr(["", ""]);
    setOcrJobs([[], []]);
    void Promise.all(
      [meta.id, version].map((id) =>
        id
          ? api<PdfOcrJob[]>(`pdf-ocr?version=${id}`, {
              signal: controller.signal,
            })
          : Promise.resolve([]),
      ),
    )
      .then(([left, right]) => setOcrJobs([left, right]))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [meta.id, version]);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ items: FileChoice[] }>(
      `resources?view=all&kind=file&mime=application%2Fpdf&limit=40&q=${encodeURIComponent(query)}`,
      { signal: controller.signal },
    )
      .then((v) => setFiles(v.items))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [query]);
  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    setVersions([]);
    setVersion("");
    void api<typeof versions>(`files/${file}/versions`, {
      signal: controller.signal,
    })
      .then((v) => {
        setVersions(v);
        setVersion(v.find((v) => v.id !== meta.id)?.id ?? v[0]?.id ?? "");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [file, meta.id]);
  useEffect(() => {
    setOther(null);
    setPairs([]);
    setError("");
    if (!version) return;
    let alive = true,
      task:
        ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    void Promise.all([openPaperSource(userId, version), import("pdfjs-dist")])
      .then(async ([source, lib]) => {
        if (!alive) return;
        task = lib.getDocument({
          ...pdfRuntimeOptions,
          ...(source.bytes
            ? { data: source.bytes.slice() }
            : { url: source.url, disableAutoFetch: true, disableStream: true }),
        });
        task.onPassword = () => {
          setError(
            "Open password-protected PDFs separately; comparison does not retain passwords.",
          );
          void task?.destroy();
        };
        const document = await task.promise;
        if (alive) {
          setOther(document);
          setPages([1, 1]);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      run.current++;
      worker.current?.terminate();
      void task?.destroy();
    };
  }, [version, userId]);
  const compare = async () => {
    if (!other) return;
    const token = ++run.current;
    worker.current?.terminate();
    setError("");
    setPairs([]);
    try {
      const extract = async (doc: PDFDocumentProxy, ocrId: string) => {
        if (doc.numPages > 2000)
          throw new Error("Comparison is limited to 2,000 pages per document.");
        const text: string[] = [];
        const reviewed = ocrId
          ? ((await api<PdfOcrJob>(`pdf-ocr/${ocrId}`)).pages?.filter(
              (p) => p.reviewed,
            ) ?? [])
          : [];
        const reviewedPages = new Map(
          reviewed.map((p) => [p.page, p.reviewed_text ?? p.text]),
        );
        let count = 0;
        for (let page = 1; page <= doc.numPages; page++) {
          if (token !== run.current)
            throw new DOMException("Cancelled", "AbortError");
          const p = await doc.getPage(page),
            c = await p.getTextContent();
          const native = c.items
            .flatMap((i) => ("str" in i ? [i.str] : []))
            .join(" ");
          const value = native.trim()
            ? native
            : (reviewedPages.get(page) ?? "");
          count += value.length;
          if (count > 8_000_000)
            throw new Error(
              "This PDF exceeds the 8-million-character extraction limit.",
            );
          text.push(value);
          setStatus(`Extracting text · ${page} / ${doc.numPages}`);
        }
        return text;
      };
      const left = await extract(pdf, ocr[0]),
        right = await extract(other, ocr[1]);
      if (token !== run.current) return;
      setStatus("Comparing text…");
      const w = new Worker(
        new URL("../../lib/tools/pdf-compare.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = w;
      const result = await new Promise<PdfComparison[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          w.terminate();
          reject(new Error("Comparison exceeded 30 seconds."));
        }, 30000);
        w.onmessage = (e) => {
          clearTimeout(timer);
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data.result);
        };
        w.onerror = () => {
          clearTimeout(timer);
          reject(new Error("Comparison worker stopped."));
        };
        w.postMessage({ left, right });
      });
      w.terminate();
      if (token !== run.current) return;
      setPairs(result);
      setIndex(0);
      const first = result.find((p) => p.status !== "same");
      if (first)
        setPages((old) => [first.left ?? old[0], first.right ?? old[1]]);
      setStatus(
        `${result.filter((p) => p.status !== "same").length} changed or unreadable page pairs. Text comparison does not detect image-only changes.`,
      );
    } catch (e) {
      if (token === run.current) setError((e as Error).message);
    }
  };
  const navigate = (side: 0 | 1, n: number) =>
    setPages((old) => {
      const next: [number, number] = [...old];
      next[side] = n;
      if (linked) {
        const pair = pairs.find((p) => p[side === 0 ? "left" : "right"] === n),
          mapped = pair?.[side === 0 ? "right" : "left"] ?? n;
        next[side === 0 ? 1 : 0] = Math.max(
          1,
          Math.min(side === 0 ? (other?.numPages ?? 1) : pdf.numPages, mapped),
        );
      }
      return next;
    });
  const changed = pairs.filter((p) => p.status !== "same"),
    active = changed[index];
  const selectChange = (next: number) => {
    setIndex(next);
    const pair = changed[next];
    if (pair) setPages((old) => [pair.left ?? old[0], pair.right ?? old[1]]);
  };
  return (
    <Dialog
      title="Compare PDFs"
      subtitle="Independent readers and extracted-text differences"
      wide
      className="pdf-compare-dialog"
      onClose={onClose}
      returnFocus={returnFocus}
    >
      <div className="pdf-compare-controls">
        <input
          aria-label="Find comparison PDF"
          placeholder="Find a PDF…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Comparison PDF"
          value={file}
          onChange={(e) => setFile(e.target.value)}
        >
          {!files.some((f) => f.id === meta.resource_id) && (
            <option value={meta.resource_id}>{meta.name}</option>
          )}
          {files.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Comparison version"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              Version {v.ordinal}
              {v.id === meta.id ? " · currently open" : ""}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={linked}
            onChange={(e) => setLinked(e.target.checked)}
          />
          Link pages & scrolling
        </label>
        <button onClick={() => setSwapped(!swapped)}>Swap panes</button>
        <button disabled={!other} onClick={() => void compare()}>
          Compare text
        </button>
        <button
          disabled={
            !status.startsWith("Extracting text") &&
            status !== "Comparing text…"
          }
          onClick={() => {
            run.current++;
            worker.current?.terminate();
            setStatus("Comparison cancelled.");
          }}
        >
          Stop
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p role="status" className="muted">
        {status ||
          "Choose a PDF or another version. No OCR runs automatically."}
      </p>
      <div className="pdf-compare-panes pdf-workbench">
        {(swapped ? [1, 0] : [0, 1]).map((n) => {
          const side = n as 0 | 1,
            doc = side === 0 ? pdf : other;
          return (
            <section key={side}>
              <header>
                <strong>
                  {side === 0
                    ? meta.name
                    : (files.find((f) => f.id === file)?.name ?? meta.name)}
                </strong>
                <label>
                  Page
                  <input
                    aria-label={`${side === 0 ? "Original" : "Comparison"} page`}
                    type="number"
                    min={1}
                    max={doc?.numPages ?? 1}
                    value={pages[side]}
                    onChange={(e) =>
                      navigate(
                        side,
                        Math.max(
                          1,
                          Math.min(
                            doc?.numPages ?? 1,
                            Number(e.target.value) || 1,
                          ),
                        ),
                      )
                    }
                  />
                </label>
                <select
                  aria-label={`${side === 0 ? "Original" : "Comparison"} zoom`}
                  value={scales[side]}
                  onChange={(e) =>
                    setScales((old) => {
                      const next: [number | "fit", number | "fit"] = [...old];
                      next[side] =
                        e.target.value === "fit"
                          ? "fit"
                          : Number(e.target.value);
                      return next;
                    })
                  }
                >
                  <option value="fit">Fit width</option>
                  {[0.5, 1, 1.5, 2].map((v) => (
                    <option key={v} value={v}>
                      {v * 100}%
                    </option>
                  ))}
                </select>
              </header>
              <label className="pdf-compare-ocr">
                Scanned-page text
                <select
                  aria-label={`${side === 0 ? "Original" : "Comparison"} OCR text`}
                  value={ocr[side]}
                  onChange={(e) => {
                    const next: [string, string] = [...ocr];
                    next[side] = e.target.value;
                    setOcr(next);
                    run.current++;
                    worker.current?.terminate();
                    setPairs([]);
                    setStatus("");
                  }}
                >
                  <option value="">Native text only</option>
                  {ocrJobs[side]
                    .filter((j) => j.completed_pages > 0)
                    .map((j) => (
                      <option key={j.id} value={j.id}>
                        Reviewed OCR · {new Date(j.created_at).toLocaleString()}
                      </option>
                    ))}
                </select>
              </label>
              {doc && (
                <PdfPages
                  pdf={doc}
                  page={pages[side]}
                  jump={pages[side]}
                  scale={scales[side]}
                  rotation={0}
                  view="single"
                  labels={[]}
                  annotations={[]}
                  selected=""
                  query=""
                  area={false}
                  onPage={(p) => navigate(side, p)}
                  scrollFraction={scroll[side]}
                  onScrollFraction={(fraction) => {
                    if (linked)
                      setScroll((old) => {
                        const otherSide = side === 0 ? 1 : 0;
                        if (Math.abs(old[otherSide] - fraction) < 0.002)
                          return old;
                        const next: [number, number] = [...old];
                        next[otherSide] = fraction;
                        return next;
                      });
                  }}
                  onSelect={() => {}}
                  onAnnotation={() => {}}
                />
              )}
            </section>
          );
        })}
      </div>
      {!!changed.length && (
        <section className="pdf-compare-diff">
          <header>
            <button
              disabled={index <= 0}
              onClick={() => selectChange(index - 1)}
            >
              Previous change
            </button>
            <span>
              {index + 1} / {changed.length} · {active?.status} ·{" "}
              {active?.left ?? "—"} ↔ {active?.right ?? "—"}
            </span>
            <button
              disabled={index >= changed.length - 1}
              onClick={() => selectChange(index + 1)}
            >
              Next change
            </button>
          </header>
          {active?.status === "unavailable" ? (
            <p>
              Readable text is missing on one or both pages. This is not
              evidence that the pages are identical; review them visually or run
              OCR separately.
            </p>
          ) : active?.diff ? (
            <p>
              {active.diff.spans.map((s, i) =>
                s.kind === "add" ? (
                  <ins key={i}>{s.text}</ins>
                ) : s.kind === "remove" ? (
                  <del key={i}>{s.text}</del>
                ) : (
                  <span key={i}>{s.text}</span>
                ),
              )}
            </p>
          ) : (
            <p>
              {active?.status === "added"
                ? "Page added in comparison PDF."
                : "Page removed from comparison PDF."}
            </p>
          )}
        </section>
      )}
    </Dialog>
  );
}
