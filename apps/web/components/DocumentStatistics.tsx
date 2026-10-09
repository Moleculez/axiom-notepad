"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { documentStatistics, type ParsedDocument } from "@axiom/markdown";
import { formatNumber } from "@axiom/i18n";
import { currentLocale, t } from "@axiom/i18n/client";

export default function DocumentStatistics({
  source,
  parsed,
}: {
  source: string;
  parsed: ParsedDocument;
}) {
  useInterfaceLocale();
  const [open, setOpen] = useState(false),
    [selection, setSelection] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const worker = useRef<Worker | null>(null),
    version = useRef(0);
  const [counts, setCounts] = useState<{
    statistics: ReturnType<typeof documentStatistics>;
    selected: ReturnType<typeof documentStatistics> | null;
  } | null>(() =>
    source.length < 5000
      ? { statistics: documentStatistics(parsed, source), selected: null }
      : null,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let instance: Worker | undefined;
    const unavailable = () => {
      setFailed(true);
      setCounts(null);
      instance?.terminate();
      worker.current = null;
    };
    try {
      instance = new Worker(new URL("./statistics.worker.ts", import.meta.url));
      worker.current = instance;
      instance.onmessage = (event) => {
        if (event.data.version === version.current) setCounts(event.data);
      };
      instance.onerror = (event) => {
        event.preventDefault();
        unavailable();
      };
    } catch {
      unavailable();
    }
    return () => {
      instance?.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    const current = ++version.current;
    const timer = setTimeout(
      () =>
        worker.current?.postMessage({ source, selection, version: current }),
      180,
    );
    return () => clearTimeout(timer);
  }, [source, selection]);
  const statistics = counts?.statistics,
    selected = counts?.selected;
  useEffect(() => {
    const parent = host.current?.closest(".ws-document, .editor-area");
    const changed = (event: Event) =>
      setSelection((event as CustomEvent<string>).detail);
    parent?.addEventListener("axiom:editor-selection", changed);
    return () => parent?.removeEventListener("axiom:editor-selection", changed);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (
        !host.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = host.current?.getBoundingClientRect(),
        popup = panel.current;
      if (!anchor || !popup) return;
      popup.style.left =
        Math.max(8, Math.min(anchor.left, innerWidth - popup.offsetWidth - 8)) +
        "px";
      popup.style.bottom = Math.max(8, innerHeight - anchor.top + 10) + "px";
      popup.style.maxHeight =
        Math.max(80, Math.min(600, anchor.top - 24)) + "px";
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open, counts]);
  const number = (value: number) => formatNumber(currentLocale(), value);
  return (
    <div
      className="document-statistics"
      ref={host}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          host.current?.querySelector("button")?.focus();
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={uiText("Document statistics")}
      >
        {selected
          ? `${t("{count, number} selected", { count: selected.words })} · `
          : ""}
        {statistics
          ? t("{count, plural, one {# word} other {# words}}", {
              count: statistics.words,
            })
          : failed
            ? uiText("Statistics unavailable")
            : uiText("Counting…")}
      </button>
      {open &&
        statistics &&
        createPortal(
          <section
            ref={panel}
            className="document-statistics-popover"
            aria-label={uiText("Document statistics")}
          >
            <h3>
              <I18nText id="Document statistics" />
            </h3>
            <dl>
              {[
                ["Words", number(statistics.words)],
                ["Characters", number(statistics.characters)],
                ["Without spaces", number(statistics.nonSpace)],
                [
                  "Reading time",
                  statistics.words
                    ? t("About {minutes, number} min", {
                        minutes: statistics.readingMinutes,
                      })
                    : "—",
                ],
                ["Equations", number(statistics.equations)],
                ["Code blocks", number(statistics.codeBlocks)],
                ["Tables", number(statistics.tables)],
                [
                  "Tasks complete",
                  `${number(statistics.completedTasks)} / ${number(statistics.tasks)}`,
                ],
                ["Source lines", number(statistics.lines)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{uiText(label)}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {selected && (
              <p>
                <I18nText
                  id="Selection: {words, number} words · {characters, number} source characters"
                  values={{
                    words: selected.words,
                    characters: selected.sourceCharacters,
                  }}
                />
              </p>
            )}
            <p className="muted">
              <I18nText id="Words use language-aware segmentation. Markdown markers, metadata, code blocks and equations are excluded. Reading time uses 200 words per minute; technical material may take longer." />
            </p>
          </section>,
          document.body,
        )}
    </div>
  );
}
