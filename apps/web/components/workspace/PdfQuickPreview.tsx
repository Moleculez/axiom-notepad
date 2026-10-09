"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { ActionRow, Button, TextInput, NativeSelect } from "../ui/controls";
import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ErrorNotice } from "./ui";
import PdfPages from "../pdf/PdfPages";
import { pdfRuntimeOptions } from "../../lib/pdf-runtime";
import { isStaticRuntime, runtimeAsset } from "../../lib/runtime-assets";
export default function PdfQuickPreview({
  source,
  interactive = true,
  initialPage = 1,
}: {
  source: string;
  interactive?: boolean;
  initialPage?: number;
}) {
  useInterfaceLocale();
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
        lib.GlobalWorkerOptions.workerSrc = isStaticRuntime
          ? runtimeAsset("tool-assets/pdfjs/pdf.worker.min.mjs")
          : new URL(
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
        <ActionRow>
          <Button
            className="button secondary"
            disabled={!pdf || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <I18nText id="Previous page" />
          </Button>
          <span aria-live="polite">
            {pdf ? `${page} / ${pdf.numPages}` : uiText("Loading PDF…")}
          </span>
          {pdf && (
            <label className="pdf-preview-page-input">
              <I18nText id="Go to page" />{" "}
              <TextInput
                aria-label={uiText("Preview page")}
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
          <Button
            className="button secondary"
            disabled={!pdf || page >= pdf.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <I18nText id="Next page" />
          </Button>
          <NativeSelect
            aria-label={uiText("Preview zoom")}
            value={scale}
            onChange={(event) =>
              setScale(
                ["page", "fit"].includes(event.target.value)
                  ? (event.target.value as "page" | "fit")
                  : Number(event.target.value),
              )
            }
          >
            <option value="page">
              <I18nText id="Fit page" />
            </option>
            <option value="fit">
              <I18nText id="Fit width" />
            </option>
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
              <option key={value} value={value}>
                {value * 100}%
              </option>
            ))}
          </NativeSelect>
        </ActionRow>
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
