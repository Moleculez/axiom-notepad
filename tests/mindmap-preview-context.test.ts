import { describe, expect, it } from "vitest";
import { projectMindmap } from "../packages/mindmap/src";
import { parseMarkdown } from "../packages/markdown/src";
import {
  mindmapLinkTarget,
  renderMindmapPreview,
} from "../apps/web/components/mindmap/MindmapPreview";

describe("mind-map owner context", () => {
  it("renders reference images with authorized resolution and safe export summaries", () => {
    const source = "# Evidence\n\n![Figure][asset]\n\n[asset]: figure.png\n";
    const node = projectMindmap(source).nodes[1],
      context = {
        document: parseMarkdown(source),
        resolveImage: (href: string) =>
          href === "figure.png" ? "blob:authorized" : undefined,
      };
    const result = renderMindmapPreview(source, node, context);
    expect(result.preview.kind).toBe("image");
    expect(result.html).toContain('src="blob:authorized"');
    expect(
      renderMindmapPreview(source, node, context, true, { images: false }).html,
    ).toBe("<p>Figure</p>");
  });

  it("recognizes inherited footnotes and global citation numbering in separate nodes", () => {
    const source =
        "# Research\n\n[@alpha]\n\n[@beta] Evidence[^detail].\n\n[^detail]: Details\n",
      context = { document: parseMarkdown(source) },
      nodes = projectMindmap(source).nodes;
    expect(renderMindmapPreview(source, nodes[2], context).html).toContain(
      'href="#ref-beta" title="Unresolved citation: beta">[2]</a>',
    );
    expect(renderMindmapPreview(source, nodes[2], context).html).toContain(
      'data-footnote-key="detail"',
    );
  });

  it("retains table alignment, inline math, emphasis and contextual links in bounded excerpts", () => {
    const source =
        "# Research\n\n| Equation | Evidence |\n| :---: | ---: |\n| $x^2$ | **bold** [Paper]\n\n[Paper]: https://example.test/paper\n",
      node = projectMindmap(source).nodes.find((n) => n.blockType === "table")!;
    const result = renderMindmapPreview(source, node, {
      document: parseMarkdown(source),
    });
    expect(result.html).toContain('align="center"');
    expect(result.html).toContain('align="right"');
    expect(result.html).toContain('class="math-inline"');
    expect(result.html).toContain("<strong>bold</strong>");
    expect(result.html).toContain('href="https://example.test/paper"');
  });

  it("does not cut inline delimiters in exceptionally long table cells", () => {
    const source = `# Table\n\n| A |\n| --- |\n| **${"x".repeat(260)}** |\n`,
      node = projectMindmap(source).nodes[1],
      result = renderMindmapPreview(source, node, {});
    expect(result.preview.markdown.length).toBeLessThan(100);
    expect(result.html).not.toContain("<strong>");
    expect(result.html).toContain("…");
  });

  it("prioritizes logical note identity over resolved navigation URLs", () => {
    const link = {
      dataset: { noteTarget: "Related study#Methods" },
      getAttribute: () => "/workbench/notes/related#methods",
    } as unknown as HTMLAnchorElement;
    expect(mindmapLinkTarget(link)).toBe("Related study#Methods");
    expect(
      mindmapLinkTarget({
        dataset: {},
        getAttribute: () => "https://example.test",
      } as unknown as HTMLAnchorElement),
    ).toBe("https://example.test");
  });
});
