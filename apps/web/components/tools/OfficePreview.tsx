"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, HelpText, IconButton, SearchField } from "../ui/controls";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Link,
  Maximize,
  Minimize,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import type { FilePreviewManifest } from "@axiom/shared/file-preview";
import {
  officeBlockText,
  officePlainText,
  type OfficeBlock,
  type OfficeSnapshot,
} from "@axiom/shared/office-preview";
import { ErrorNotice, Loading } from "../workspace/ui";
const PdfPreview = dynamic(() => import("../workspace/PdfQuickPreview"), {
  ssr: false,
});
function Marked({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts: React.ReactNode[] = [],
    lower = text.toLocaleLowerCase(),
    term = query.toLocaleLowerCase();
  let offset = 0,
    index = lower.indexOf(term);
  while (index >= 0 && parts.length < 200) {
    parts.push(
      text.slice(offset, index),
      <mark key={index}>{text.slice(index, index + query.length)}</mark>,
    );
    offset = index + query.length;
    index = lower.indexOf(term, offset);
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}
function Block({ block, query }: { block: OfficeBlock; query: string }) {
  if (block.kind === "table")
    return (
      <div className="office-table-scroll" data-office-block={block.id}>
        <table>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>
                    <Marked text={cell} query={query} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <div
      data-office-block={block.id}
      className={
        block.heading
          ? `office-heading level-${block.heading}`
          : block.list
            ? "office-list-item"
            : "office-paragraph"
      }
      role={block.heading ? "heading" : undefined}
      aria-level={block.heading}
    >
      <Marked text={block.text} query={query} />
    </div>
  );
}
export default function OfficePreview({
  file,
  onConvert,
}: {
  file: FilePreviewManifest;
  onConvert: () => Promise<void>;
}) {
  useInterfaceLocale();
  const office = file.office!,
    source = office.originalSource;
  const [snapshot, setSnapshot] = useState<OfficeSnapshot | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [mode, setMode] = useState<"reading" | "pages">(
      office.pdfSource ? "pages" : "reading",
    ),
    [slide, setSlide] = useState(0),
    [query, setQuery] = useState(""),
    [navigator, setNavigator] = useState(true),
    [limit, setLimit] = useState(100),
    [fullscreen, setFullscreen] = useState(false),
    [converting, setConverting] = useState(false);
  const stage = useRef<HTMLDivElement>(null),
    reading = useRef<HTMLDivElement>(null),
    jumpFrame = useRef(0);
  useEffect(() => {
    setSnapshot(null);
    setError("");
    if (file.bytes > 50_000_000) {
      setError(
        "Reading view is limited to 50 MB. Download the original instead.",
      );
      return;
    }
    const controller = new AbortController(),
      worker = new Worker(
        new URL("../../lib/tools/office.worker.ts", import.meta.url),
        { type: "module" },
      );
    const timeout = setTimeout(() => {
      controller.abort();
      worker.terminate();
      setError(
        "Office reading view exceeded its 30-second limit. Download the original or use private conversion.",
      );
    }, 30000);
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      if (controller.signal.aborted) return;
      if (event.data.error) setError(event.data.error);
      else {
        const data = event.data as OfficeSnapshot;
        setSnapshot(data);
        const hash = new URLSearchParams(location.hash.slice(1));
        if (hash.has("slide")) setMode("reading");
        setSlide(
          Math.max(
            0,
            Math.min(
              data.slides.length - 1,
              (Number(hash.get("slide")) || 1) - 1,
            ),
          ),
        );
        const index = data.blocks.findIndex(
          (block) => block.id === hash.get("block"),
        );
        if (index >= 0) {
          setMode("reading");
          setLimit(Math.max(100, index + 1));
          jumpFrame.current = requestAnimationFrame(() =>
            reading.current
              ?.querySelector<HTMLElement>(
                `[data-office-block="${data.blocks[index].id}"]`,
              )
              ?.scrollIntoView({ block: "start" }),
          );
        }
      }
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      worker.terminate();
      if (!controller.signal.aborted)
        setError("This Office document could not be safely decoded.");
    };
    void fetch(source, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("The original document could not be loaded.");
        const data = await response.arrayBuffer();
        if (data.byteLength > 50_000_000)
          throw new Error("Office reading view is limited to 50 MB.");
        if (!controller.signal.aborted)
          worker.postMessage({ data, format: office.format }, [data]);
      })
      .catch((e) => {
        clearTimeout(timeout);
        worker.terminate();
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      clearTimeout(timeout);
      worker.terminate();
      cancelAnimationFrame(jumpFrame.current);
    };
  }, [source, file.bytes, office.format]);
  useEffect(() => {
    const update = () =>
      setFullscreen(document.fullscreenElement === stage.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  useEffect(() => {
    if (file.status === "failed") setConverting(false);
    if (converting && office.pdfSource) {
      setConverting(false);
      setMode("pages");
    }
  }, [converting, office.pdfSource, file.status]);
  const term = query.trim(),
    blocks =
      snapshot?.format === "pptx"
        ? (snapshot.slides[slide]?.blocks ?? [])
        : (snapshot?.blocks ?? []);
  const matches = useMemo(
    () =>
      snapshot?.format === "docx"
        ? snapshot.blocks
            .filter(
              (block) =>
                term &&
                officeBlockText(block)
                  .toLocaleLowerCase()
                  .includes(term.toLocaleLowerCase()),
            )
            .slice(0, 200)
        : [],
    [snapshot, term],
  );
  const headings =
    snapshot?.blocks.filter(
      (block) => block.kind === "paragraph" && block.heading,
    ) ?? [];
  const jump = (id: string) => {
    const index = snapshot?.blocks.findIndex((block) => block.id === id) ?? -1;
    if (index < 0) return;
    setMode("reading");
    setLimit((old) => Math.max(old, index + 1));
    cancelAnimationFrame(jumpFrame.current);
    jumpFrame.current = requestAnimationFrame(() => {
      const block = reading.current?.querySelector<HTMLElement>(
        `[data-office-block="${id}"]`,
      );
      block?.scrollIntoView({ block: "start" });
      block?.setAttribute("tabindex", "-1");
      block?.focus({ preventScroll: true });
    });
  };
  const copy = async (link = false) => {
    try {
      if (link) {
        const url = new URL(
          `/workbench/files/${file.resourceId}`,
          location.origin,
        );
        url.searchParams.set("version", file.versionId);
        const first =
          snapshot?.format === "docx"
            ? [
                ...(reading.current?.querySelectorAll<HTMLElement>(
                  "[data-office-block]",
                ) ?? []),
              ].find(
                (node) =>
                  node.getBoundingClientRect().bottom >
                  (reading.current?.getBoundingClientRect().top ?? 0),
              )
            : null;
        url.hash = new URLSearchParams(
          snapshot?.format === "pptx"
            ? { slide: String(slide + 1) }
            : { block: first?.dataset.officeBlock ?? blocks[0]?.id ?? "" },
        ).toString();
        await window.navigator.clipboard.writeText(url.href);
      } else
        await window.navigator.clipboard.writeText(
          blocks.slice(0, limit).map(officeBlockText).join("\n\n"),
        );
      setNotice(
        link
          ? "Reading link copied. Access permissions are unchanged."
          : "Visible section text copied.",
      );
    } catch {
      setNotice("Clipboard access was denied.");
    }
  };
  return (
    <div className="office-viewer" ref={stage}>
      <div className="office-toolbar">
        <IconButton
          className="icon-button"
          aria-label={uiText("Toggle document navigator")}
          aria-pressed={navigator}
          title={uiText("Toggle document navigator")}
          onClick={() => setNavigator(!navigator)}
        >
          {navigator ? (
            <PanelLeftClose size={17} />
          ) : (
            <PanelLeftOpen size={17} />
          )}
        </IconButton>
        <div
          className="office-mode"
          role="group"
          aria-label={uiText("Document view")}
        >
          <button
            aria-pressed={mode === "reading"}
            onClick={() => setMode("reading")}
          >
            {office.format === "pptx"
              ? uiText("Slide text")
              : uiText("Reading")}
          </button>
          <button
            aria-pressed={mode === "pages"}
            onClick={() => setMode("pages")}
          >
            {office.format === "pptx" ? uiText("Slides") : uiText("Pages")}
          </button>
        </div>
        <SearchField
          wrapperClassName="office-search"
          aria-label={uiText("Search document text")}
          placeholder={uiText("Find in text…")}
          value={query}
          maxLength={200}
          onChange={(e) => {
            setQuery(e.target.value);
            setNavigator(true);
            setMode("reading");
          }}
        />
        <span className="tool-spacer" />
        <IconButton
          className="icon-button"
          aria-label={uiText("Copy reading link")}
          title={uiText("Copy reading link")}
          disabled={!snapshot}
          onClick={() => void copy(true)}
        >
          <Link size={16} />
        </IconButton>
        <IconButton
          className="icon-button"
          aria-label={uiText("Copy displayed text")}
          title={uiText("Copy displayed text")}
          disabled={!snapshot}
          onClick={() => void copy()}
        >
          <Copy size={16} />
        </IconButton>
        <a
          className="icon-button"
          aria-label={uiText("Download original")}
          title={uiText("Download original")}
          href={`/api/v1/files/${file.resourceId}/download?version=${file.versionId}`}
        >
          <Download size={16} />
        </a>
        <IconButton
          className="icon-button"
          aria-label={
            fullscreen
              ? uiText("Exit document fullscreen")
              : uiText("Document fullscreen")
          }
          title={fullscreen ? uiText("Exit fullscreen") : uiText("Fullscreen")}
          onClick={() => {
            const action =
              document.fullscreenElement === stage.current
                ? document.exitFullscreen()
                : stage.current?.requestFullscreen?.();
            if (action)
              void action.catch(() =>
                setNotice(
                  "Fullscreen is unavailable in this browser or window.",
                ),
              );
            else
              setNotice("Fullscreen is unavailable in this browser or window.");
          }}
        >
          {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </IconButton>
      </div>
      <ErrorNotice message={error} />
      {notice && (
        <p className="office-notice" role="status">
          {notice}
          <button className="text-button" onClick={() => setNotice("")}>
            <I18nText id="Dismiss" />
          </button>
        </p>
      )}
      <div className={`office-layout ${navigator ? "with-navigator" : ""}`}>
        {navigator && (
          <nav
            className="office-navigator"
            aria-label={uiText("Document navigator")}
          >
            <span className="office-section-label">
              {term
                ? uiText("Search results")
                : office.format === "pptx"
                  ? "Slides"
                  : "Outline"}
            </span>
            {snapshot?.format === "pptx"
              ? snapshot.slides
                  .map((item, index) => ({ item, index }))
                  .filter(
                    ({ item }) =>
                      !term ||
                      `${item.title}\n${item.blocks.map(officeBlockText).join("\n")}\n${item.notes}`
                        .toLocaleLowerCase()
                        .includes(term.toLocaleLowerCase()),
                  )
                  .map(({ item, index }) => (
                    <button
                      key={item.id}
                      aria-current={index === slide ? "location" : undefined}
                      onClick={() => {
                        setSlide(index);
                        setMode("reading");
                        reading.current?.scrollTo(0, 0);
                      }}
                    >
                      <small>
                        {String(index + 1).padStart(2, "0")}
                        {item.hidden ? uiText(" · hidden") : ""}
                      </small>
                      <span>
                        <Marked text={item.title} query={term} />
                      </span>
                    </button>
                  ))
              : (term ? matches : headings).map((block) => (
                  <button
                    key={block.id}
                    style={{
                      paddingInlineStart:
                        12 +
                        ((block.kind === "paragraph" ? block.heading : 1) ??
                          1) *
                          8,
                    }}
                    onClick={() => jump(block.id)}
                  >
                    <span>
                      <Marked
                        text={officeBlockText(block).slice(0, 180)}
                        query={term}
                      />
                    </span>
                  </button>
                ))}
            {snapshot?.format === "docx" &&
              !(term ? matches : headings).length && (
                <HelpText>
                  {term
                    ? uiText("No text matches.")
                    : uiText("No headings in this document.")}
                </HelpText>
              )}
            {snapshot?.format === "pptx" &&
              term &&
              !snapshot.slides.some((item) =>
                `${item.title}\n${item.blocks.map(officeBlockText).join("\n")}\n${item.notes}`
                  .toLocaleLowerCase()
                  .includes(term.toLocaleLowerCase()),
              ) && (
                <HelpText>
                  <I18nText id="No matching slides." />
                </HelpText>
              )}
            {matches.length === 200 && (
              <HelpText>
                <I18nText id="First 200 matching blocks. Refine your search." />
              </HelpText>
            )}
          </nav>
        )}
        <div className="office-main">
          {mode === "pages" ? (
            office.pdfSource ? (
              <PdfPreview source={office.pdfSource} />
            ) : (
              <div className="office-conversion">
                <h3>
                  {office.format === "pptx"
                    ? uiText("Slide-layout preview")
                    : uiText("Page-layout preview")}
                </h3>
                <p>{file.message}</p>
                <Button
                  className="button secondary"
                  disabled={
                    file.status === "queued" ||
                    converting ||
                    !office.converterAvailable ||
                    file.bytes > 50_000_000
                  }
                  onClick={() => {
                    setConverting(true);
                    void onConvert().catch(() => setConverting(false));
                  }}
                >
                  {file.status === "queued"
                    ? uiText("Converting privately…")
                    : uiText("Generate private preview")}
                </Button>
                {!office.converterAvailable && (
                  <small>
                    <I18nText id="Private conversion is not configured. Reading view remains available; no files are sent to public services." />
                  </small>
                )}
                <button
                  className="text-button"
                  onClick={() => setMode("reading")}
                >
                  <I18nText id="Return to reading view" />
                </button>
              </div>
            )
          ) : !snapshot && !error ? (
            <Loading
              label={uiText("Reading document in an isolated worker…")}
            />
          ) : (
            snapshot && (
              <>
                {snapshot.format === "pptx" && (
                  <div className="office-slide-controls">
                    <IconButton
                      className="icon-button"
                      aria-label={uiText("Previous slide")}
                      disabled={slide <= 0}
                      onClick={() => setSlide(slide - 1)}
                    >
                      <ChevronLeft size={17} />
                    </IconButton>
                    <span>
                      <I18nText id="Slide" />{" "}
                      {snapshot.slides.length ? slide + 1 : 0}{" "}
                      <I18nText id="of" /> {snapshot.slides.length}
                      {snapshot.slides[slide]?.hidden
                        ? uiText(" · hidden in original")
                        : ""}
                    </span>
                    <IconButton
                      className="icon-button"
                      aria-label={uiText("Next slide")}
                      disabled={slide >= snapshot.slides.length - 1}
                      onClick={() => setSlide(slide + 1)}
                    >
                      <ChevronRight size={17} />
                    </IconButton>
                  </div>
                )}
                <div
                  className="office-reading"
                  ref={reading}
                  tabIndex={0}
                  aria-label={
                    snapshot.format === "pptx"
                      ? uiText("Slide text")
                      : uiText("Document text")
                  }
                >
                  <article>
                    {blocks.slice(0, limit).map((block) => (
                      <Block key={block.id} block={block} query={term} />
                    ))}
                    {!blocks.length && (
                      <HelpText>
                        <I18nText id="No extractable text. Use the page preview or download the original." />
                      </HelpText>
                    )}
                    {blocks.length > limit && (
                      <Button
                        className="button secondary"
                        onClick={() => setLimit(limit + 100)}
                      >
                        <I18nText id="Show 100 more blocks" />
                      </Button>
                    )}
                    {snapshot.format === "pptx" &&
                      snapshot.slides[slide]?.notes && (
                        <section className="office-speaker-notes">
                          <h3>
                            <I18nText id="Speaker notes" />
                          </h3>
                          <p>
                            <Marked
                              text={snapshot.slides[slide].notes}
                              query={term}
                            />
                          </p>
                        </section>
                      )}
                    {!!snapshot.footnotes.length && (
                      <details className="office-notes">
                        <summary>
                          <I18nText id="Footnotes & endnotes (" />
                          {snapshot.footnotes.length})
                        </summary>
                        {snapshot.footnotes.map((note, index) => (
                          <div key={`${note.id}-${index}`}>
                            <strong>{note.id}</strong>
                            <p>
                              <Marked text={note.text} query={term} />
                            </p>
                          </div>
                        ))}
                      </details>
                    )}
                    {!!snapshot.comments.length && (
                      <details className="office-notes">
                        <summary>
                          <I18nText id="Original document comments (" />
                          {snapshot.comments.length})
                        </summary>
                        <HelpText>
                          <I18nText id="Imported author labels, not workspace identities. Comment anchors and threads are not reconstructed." />
                        </HelpText>
                        {snapshot.comments.map((comment, index) => (
                          <div key={`${comment.id}-${index}`}>
                            <strong>
                              {comment.author || "Unknown author"}
                            </strong>
                            <p>
                              <Marked text={comment.text} query={term} />
                            </p>
                          </div>
                        ))}
                      </details>
                    )}
                  </article>
                </div>
              </>
            )
          )}
        </div>
      </div>
      <footer className="office-status">
        <details>
          <summary>
            <I18nText id="Read-only ·" />{" "}
            {mode === "reading"
              ? uiText("text extraction")
              : uiText("private conversion")}
          </summary>
          {(snapshot?.warnings ?? ["Original files remain unchanged."]).map(
            (warning) => (
              <p key={warning}>{warning}</p>
            ),
          )}
        </details>
        {snapshot && (
          <button
            className="text-button"
            onClick={() => {
              const blob = new Blob([officePlainText(snapshot)], {
                  type: "text/plain;charset=utf-8",
                }),
                url = URL.createObjectURL(blob),
                a = document.createElement("a");
              a.href = url;
              a.download =
                file.name.replace(/\.(docx|pptx)$/i, "") + "-text.txt";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <I18nText id="Export text" />
          </button>
        )}
      </footer>
    </div>
  );
}
