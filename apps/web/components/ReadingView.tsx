"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { footnoteTooltips } from "../lib/footnote-tooltips";
import { DiagramPreviews } from "../lib/editor-vnext/diagrams";
import { openContextMenu } from "../lib/context-menu";
import {
  hasReadingSelection,
  reconcileReadingBlocks,
} from "../lib/reading-dom";
import { readingLinkRoute } from "../lib/reading-links";
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
  onInternalAnchor,
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
  /** Embedded readers can route all hash anchors within their host view. */
  onInternalAnchor?: (target: string) => void;
  personalPrint?: boolean;
  active?: boolean;
  blockMarks?: boolean;
  source?: string;
  visual?: VisualContext;
  visualAnchor?: VisualContext["anchor"];
}) {
  const [printing, setPrinting] = useState(false);
  const [pending, setPending] = useState(false);
  const latest = useRef({ parsed, context, source, visual, visualAnchor });
  latest.current = { parsed, context, source, visual, visualAnchor };
  const displayed = useRef(latest.current);
  const originals = useRef(new WeakMap<Element, string>());
  const diagrams = useRef<DiagramPreviews | null>(null);
  const headingMenu = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      headingMenu.current?.();
    },
    [],
  );
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
      document: () => displayed.current.parsed,
      context: () => displayed.current.context,
    });
    footnotes.current = previews;
    return () => {
      previews.destroy();
      footnotes.current = null;
    };
  }, [active]);
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
    diagrams.current = new DiagramPreviews();
    const visuals = !printing
      ? installMarkdownVisuals(root.current, {
          parsed: () => displayed.current.parsed,
          source: () => displayed.current.source,
          context: () => displayed.current.visual,
          anchor: (from, to) =>
            displayed.current.visualAnchor?.(from, to) ??
            displayed.current.visual?.anchor?.(from, to),
        })
      : undefined;
    return () => {
      visuals?.();
      diagrams.current?.destroy();
      diagrams.current = null;
    };
  }, [active, printing]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let applied = false;
    const apply = () => {
      if (applied) return;
      if (active && !printing && hasReadingSelection(element)) {
        setPending(true);
        return;
      }
      displayed.current = latest.current;
      reconcileReadingBlocks(element, html, originals.current);
      applied = true;
      diagrams.current?.render(element);
      footnotes.current?.refresh();
      for (const pre of element.querySelectorAll("pre")) {
        if (
          !active ||
          printing ||
          !pre.querySelector("code") ||
          pre.querySelector(".reading-code-copy")
        )
          continue;
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "reading-code-copy";
        copy.textContent = "Copy";
        copy.setAttribute("aria-label", "Copy code");
        pre.append(copy);
      }
      setPending(false);
    };
    apply();
    document.addEventListener("selectionchange", apply);
    return () => document.removeEventListener("selectionchange", apply);
  }, [html, active, printing, context.theme]);
  return (
    <>
      {pending && (
        <p className="muted reading-update-status" role="status">
          Updates are waiting while you select text.
        </p>
      )}
      <div
        className={`reading-view prose document-presentation ${personalPrint ? "print-personal" : ""}`}
        ref={root}
        onContextMenu={(event) => {
          const heading = (event.target as Element).closest<HTMLElement>(
            "h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]",
          );
          if (!heading) return;
          event.preventDefault();
          headingMenu.current?.();
          headingMenu.current = openContextMenu({
            owner: heading,
            x: event.clientX,
            y: event.clientY,
            label: "Section actions",
            items: [
              {
                label: "Copy section link",
                icon: "link",
                action: () => {
                  const url = new URL(
                    visual?.resourceId
                      ? `/workbench/notes/${visual.resourceId}`
                      : location.href,
                    location.origin,
                  );
                  url.hash = heading.id;
                  void navigator.clipboard.writeText(url.href).catch(() => {});
                },
              },
            ],
          });
        }}
        onClick={(event) => {
          const copy = (event.target as Element).closest<HTMLButtonElement>(
            ".reading-code-copy",
          );
          if (copy) {
            const code =
              copy.closest("pre")?.querySelector("code")?.textContent ?? "";
            void navigator.clipboard
              .writeText(code)
              .then(() => {
                copy.textContent = "Copied";
                setTimeout(() => {
                  copy.textContent = "Copy";
                }, 1500);
              })
              .catch(() => {
                copy.textContent = "Select to copy";
              });
            return;
          }
          const link = (event.target as Element).closest<HTMLElement>(
            '[data-note-target], a[href^="/api/v1/attachments/"], a[href^="#"]',
          );
          if (link) {
            const target =
              link.dataset.noteTarget ?? link.getAttribute("href")!;
            const route = readingLinkRoute(
              target,
              displayed.current.parsed.outline,
              !!onInternalAnchor,
            );
            if (route === "native") return;
            event.preventDefault();
            if (route === "internal") onInternalAnchor!(target);
            else onLink(target);
          }
        }}
      />
    </>
  );
}
