"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { footnoteTooltips } from "../lib/footnote-tooltips";
import { DiagramPreviews } from "../lib/editor-vnext/diagrams";
import {
  installMarkdownVisuals,
  type VisualContext,
} from "../lib/visual-surface";
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
  blockMarks = false,
  source = "",
  visual,
  visualAnchor,
}: {
  parsed: ParsedDocument;
  context: RenderContext;
  onLink: (target: string) => void;
  personalPrint?: boolean;
  active?: boolean;
  blockMarks?: boolean;
  source?: string;
  visual?: VisualContext;
  visualAnchor?: VisualContext["anchor"];
}) {
  const [printing, setPrinting] = useState(false);
  const latest = useRef({ parsed, context, source, visual, visualAnchor });
  latest.current = { parsed, context, source, visual, visualAnchor };
  const footnotes = useRef<ReturnType<typeof footnoteTooltips> | null>(null);
  const root = useRef<HTMLDivElement>(null),
    html = useMemo(
      () =>
        active || printing
          ? renderDocument(parsed, {
              ...context,
              visuals: active && !printing,
              scrollTables: true,
              blockMarks: blockMarks && active && !printing,
            })
          : "",
      [parsed, context, active, printing, blockMarks],
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
    if ((!active && !printing) || !root.current) return;
    const diagrams = new DiagramPreviews();
    diagrams.render(root.current);
    const visuals = !printing
      ? installMarkdownVisuals(root.current, {
          parsed: () => latest.current.parsed,
          source: () => latest.current.source,
          context: () => latest.current.visual,
          anchor: (from, to) =>
            latest.current.visualAnchor?.(from, to) ??
            latest.current.visual?.anchor?.(from, to),
        })
      : undefined;
    return () => {
      visuals?.();
      diagrams.destroy();
    };
  }, [html, active, printing, context.theme]);
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
