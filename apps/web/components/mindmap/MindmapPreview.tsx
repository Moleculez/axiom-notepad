import { memo, useLayoutEffect, useMemo, useRef } from "react";
import {
  parseMarkdown,
  parseMarkdownFragment,
  renderDocument,
  escapeHtml,
  safeUrl,
  type RenderContext,
} from "@axiom/markdown";
import { mindmapBlockPreview, type MindmapNode } from "@axiom/mindmap";
import { languageLogo } from "../../lib/icons/languages";
import { DiagramPreviews } from "../../lib/editor-vnext/diagrams";
import {
  reconcileMindmapHtml,
  installMindmapImages,
} from "../../lib/tools/mindmap-media";
import {
  Image as ImageIcon,
  FileText,
  Sigma,
  Table2,
  Quote,
  BookOpen,
} from "lucide-react";

/** Renderers own descendants; React never rewrites loaded visuals on a pan. */
export function MindmapRenderedHtml({
  html,
  markdown,
  onLink,
  className = "",
}: {
  html: string;
  markdown?: string;
  onLink?: (href: string) => void;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    previous = useRef<string | null>(null),
    previousMarkdown = useRef<string | undefined>(undefined),
    diagrams = useRef<DiagramPreviews | null>(null);
  useLayoutEffect(() => {
    const root = host.current;
    if (!root) return;
    const renderer = new DiagramPreviews(),
      images = installMindmapImages(root);
    diagrams.current = renderer;
    // Root appearance changes include palette/font overrides, not just dark mode.
    // Observe only theme attributes; pan/zoom transforms never queue a redraw.
    const appearance = new MutationObserver(() => {
      if (root.querySelector("[data-mermaid]")) renderer.render(root);
    });
    appearance.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-theme", "data-theme-pack"],
    });
    renderer.render(root);
    return () => {
      images();
      appearance.disconnect();
      renderer.destroy();
      diagrams.current = null;
      previous.current = null;
      previousMarkdown.current = undefined;
    };
  }, []);
  useLayoutEffect(() => {
    if (
      !host.current ||
      (previous.current === html && previousMarkdown.current === markdown)
    )
      return;
    previous.current = html;
    previousMarkdown.current = markdown;
    reconcileMindmapHtml(host.current, html, markdown);
    diagrams.current?.render(host.current);
    window.dispatchEvent(
      new CustomEvent("axiom:prepare-math", { detail: host.current }),
    );
  }, [html, markdown]);
  return (
    <div
      ref={host}
      className={className}
      onClick={(e) => {
        const link = (e.target as Element).closest<HTMLAnchorElement>("a");
        if (link && onLink) {
          e.preventDefault();
          e.stopPropagation();
          onLink(mindmapLinkTarget(link));
        }
      }}
    />
  );
}

/** Resolved URLs are navigation output, not the logical identity of a wiki link. */
export function mindmapLinkTarget(link: HTMLAnchorElement) {
  return link.dataset.noteTarget ?? link.getAttribute("href") ?? "";
}

export function renderMindmapPreview(
  source: string,
  node: MindmapNode,
  context: RenderContext,
  research = true,
  options: { images?: boolean } = {},
) {
  const owner = context.document ?? parseMarkdown(source);
  const preview = mindmapBlockPreview(source, node, research, owner);
  const html =
    preview.kind === "supporting" ||
    (preview.kind === "image" && options.images === false)
      ? `<p>${escapeHtml(preview.kind === "image" ? preview.alt || "Image" : preview.markdown)}</p>`
      : preview.markdown
        ? renderDocument(parseMarkdownFragment(preview.markdown, owner), {
            ...context,
            document: owner,
            fragment: true,
            disableImages:
              context.disableImages || !research || options.images === false,
            resolveImage:
              context.resolveImage ??
              ((href) => safeUrl(href, true) || undefined),
            visuals: false,
            blockMarks: false,
            reviewRanges: undefined,
          })
        : "";
  return { preview, html };
}

export default memo(function MindmapPreview({
  source,
  node,
  context,
  research,
  onLink,
}: {
  source: string;
  node: MindmapNode;
  context: RenderContext;
  research: boolean;
  onLink: (href: string) => void;
}) {
  const value =
    node.kind === "heading" || node.kind === "item" || node.kind === "root"
      ? node.labelSource
      : source.slice(node.from, node.to);
  const rendered = useMemo(
    () => renderMindmapPreview(source, node, context, research),
    [
      value,
      node.kind,
      node.blockType,
      node.label,
      node.presentationOnly,
      research,
      context.document,
      context,
    ],
  );
  const logo = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (logo.current && ["code", "diagram"].includes(rendered.preview.kind))
      logo.current.replaceChildren(
        languageLogo(rendered.preview.language ?? ""),
      );
  }, [rendered.preview.kind, rendered.preview.language]);
  return (
    <div
      className={`mindmap-rich-label mindmap-preview-${rendered.preview.kind}`}
      data-block-preview={rendered.preview.kind}
    >
      {rendered.preview.caption && (
        <div className="mindmap-block-caption">
          {rendered.preview.kind === "equation" && (
            <Sigma size={14} aria-hidden="true" />
          )}
          {rendered.preview.kind === "table" && (
            <Table2 size={14} aria-hidden="true" />
          )}
          {rendered.preview.kind === "quote" && (
            <Quote size={14} aria-hidden="true" />
          )}
          {["media", "image"].includes(rendered.preview.kind) &&
            (rendered.preview.caption === "Image" ? (
              <ImageIcon size={14} aria-hidden="true" />
            ) : (
              <FileText size={14} aria-hidden="true" />
            ))}
          {rendered.preview.kind === "supporting" && (
            <BookOpen size={14} aria-hidden="true" />
          )}
          {["code", "diagram"].includes(rendered.preview.kind) && (
            <span
              ref={logo}
              aria-hidden="true"
              className="mindmap-language-logo"
            />
          )}
          <span>{rendered.preview.caption}</span>
        </div>
      )}
      {rendered.preview.kind === "media" ? (
        <span className="mindmap-media-label">
          {node.label.replace(/^(Image|Attachment)\s*·?\s*/, "") ||
            "Open attachment"}
        </span>
      ) : (
        <MindmapRenderedHtml
          html={rendered.html}
          markdown={rendered.preview.markdown}
          onLink={onLink}
        />
      )}
    </div>
  );
});
