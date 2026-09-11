"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { footnoteTooltips } from "../lib/footnote-tooltips";
import {
  renderDocument,
  type ParsedDocument,
  type RenderContext,
} from "@axiom/markdown";
export default function ReadingView({
  parsed,
  context,
  onLink,
  personalPrint = false,
  active = true,
}: {
  parsed: ParsedDocument;
  context: RenderContext;
  onLink: (target: string) => void;
  personalPrint?: boolean;
  active?: boolean;
}) {
  const [printing, setPrinting] = useState(false);
  const latest = useRef({ parsed, context });
  latest.current = { parsed, context };
  const footnotes = useRef<ReturnType<typeof footnoteTooltips> | null>(null);
  const root = useRef<HTMLDivElement>(null),
    html = useMemo(
      () =>
        active || printing
          ? renderDocument(parsed, { ...context, scrollTables: true })
          : "",
      [parsed, context, active, printing],
    );
  useEffect(() => {
    if (!active || !root.current) return;
    const previews = footnoteTooltips({
      root: root.current,
      document: () => latest.current.parsed,
      context: () => latest.current.context,
    });
    footnotes.current = previews;
    return () => {
      previews.destroy();
      footnotes.current = null;
    };
  }, [active]);
  useEffect(() => {
    footnotes.current?.refresh();
  }, [parsed, context]);
  useEffect(() => {
    const prepare = () => flushSync(() => setPrinting(true)),
      done = () => setPrinting(false);
    window.addEventListener("beforeprint", prepare);
    window.addEventListener("axiom:prepare-print", prepare);
    window.addEventListener("afterprint", done);
    return () => {
      window.removeEventListener("beforeprint", prepare);
      window.removeEventListener("axiom:prepare-print", prepare);
      window.removeEventListener("afterprint", done);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const nodes = root.current?.querySelectorAll<HTMLElement>("[data-mermaid]");
    if (nodes?.length)
      void import("mermaid").then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: context.theme === "dark" ? "dark" : "neutral",
          flowchart: { htmlLabels: false },
          maxTextSize: 30000,
          suppressErrorRendering: true,
        });
        for (const node of nodes) {
          try {
            const { svg } = await mermaid.render(
              "reading-" + crypto.randomUUID(),
              node.dataset.mermaid!,
            );
            if (active && node.isConnected) node.innerHTML = svg;
          } catch {
            node.classList.add("diagram-error");
          }
        }
      });
    return () => {
      active = false;
    };
  }, [html, context.theme]);
  return (
    <div
      className={`reading-view prose ${personalPrint ? "print-personal" : ""}`}
      ref={root}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => {
        const link = (event.target as Element).closest<HTMLElement>(
          '[data-note-target], a[href^="/api/v1/attachments/"], a[href^="#"]',
        );
        if (link) {
          const target = link.dataset.noteTarget ?? link.getAttribute("href")!;
          // Equation references and footnotes retain native in-document anchors.
          if (
            target.startsWith("#") &&
            !parsed.outline.some((h) => "#" + h.id === target)
          )
            return;
          event.preventDefault();
          onLink(target);
        }
      }}
    />
  );
}
