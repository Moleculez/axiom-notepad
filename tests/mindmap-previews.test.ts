import { describe, expect, it } from "vitest";
import { projectMindmap } from "../packages/mindmap/src";
import { renderMindmapPreview } from "../apps/web/components/mindmap/MindmapPreview";

const preview = (
  source: string,
  context = {},
  research = true,
  images = true,
) =>
  renderMindmapPreview(
    source,
    projectMindmap(source).nodes[1],
    context,
    research,
    { images },
  );

describe("mind-map visual rendering policies", () => {
  const image = '# Media\n\n![A & B](figure.png "Study")\n';
  it("renders complete Mermaid placeholders for the shared renderer", () => {
    const result = preview(
      "# Diagram\n\n```mermaid\nflowchart LR\nA --> B\nB --> C\nC --> D\nD --> E\nE --> F\n```\n",
    );
    expect(result.preview.kind).toBe("diagram");
    expect(result.html).toContain("data-mermaid=");
    expect(result.html).toContain("E --&gt; F");
    expect(result.html).not.toContain("language-mermaid");
  });
  it("resolves authorized local images without changing canonical source", () => {
    const result = preview(image, {
      resolveImage: (href: string) =>
        href === "figure.png" ? "blob:local-example" : undefined,
    });
    expect(result.html).toContain('src="blob:local-example"');
    expect(result.html).toContain('alt="A &amp; B"');
    expect(result.preview.markdown).toBe(
      image.slice(projectMindmap(image).nodes[1].from),
    );
    expect(image).not.toContain("blob:");
  });
  it("keeps unavailable registry assets unavailable, without an external fallback", () => {
    const result = preview(
      "# Media\n\n![Missing](https://external.invalid/missing.png)\n",
      { resolveImage: () => undefined },
    );
    expect(result.html).toContain("image-unavailable");
    expect(result.html).not.toContain("<img");
    expect(result.html).not.toContain("external.invalid");
  });
  it("honors the host's disabled-image and compact preview policies", () => {
    expect(preview(image, { disableImages: true }).html).not.toContain("<img");
    expect(preview(image, {}, false).html).not.toContain("<img");
    expect(
      preview("# Media\n\nText ![Figure](figure.png) here\n", {}, false).html,
    ).not.toContain("<img");
  });
  it("renders inline images too and rejects unsafe untrusted addresses", () => {
    expect(
      preview(
        "# Media\n\nEvidence ![Figure](https://example.invalid/figure.png) discussed here\n",
      ).html,
    ).toContain('<img src="https://example.invalid/figure.png"');
    const result = preview("# Media\n\n![Unsafe](javascript:alert)\n");
    expect(result.html).not.toContain('src="javascript:');
    expect(result.html).not.toContain("<img");
  });
  it("exports only an escaped image summary, with no fetch or private URL", () => {
    const result = preview(
      image,
      {
        resolveImage: () => {
          throw new Error("Export must not resolve media");
        },
      },
      true,
      false,
    );
    expect(result.html).toBe("<p>A &amp; B</p>");
    expect(result.html).not.toContain("<img");
    expect(result.html).not.toContain("figure.png");
  });
});
