import { describe, expect, test } from "vitest";
import {
  documentIndex,
  parseMarkdown,
  renderDocument,
  renderFootnoteContent,
} from "../packages/markdown/src";

describe("footnote preview rendering", () => {
  test("reference metadata escapes the key without changing numbering or navigation", () => {
    const parsed = parseMarkdown(
      'First[^a] then[^b"c] and again[^a].\n\n[^a]: One.\n[^b"c]: Two.',
    );
    const html = renderDocument(parsed);
    expect(html).toContain('data-footnote-key="a" href="#fn-a">1</a>');
    expect(html).toContain(
      'data-footnote-key="b&quot;c" href="#fn-b&quot;c">2</a>',
    );
    expect(html.match(/data-footnote-key="a"/g)).toHaveLength(2);
    expect(renderDocument(parsed, { conformance: true })).not.toContain(
      "data-footnote-key",
    );
  });
  test("renders only the chosen definition with full document math and citation context", () => {
    const parsed = parseMarkdown(
      "First[^a] then[^b] [@first].\n\n\\[x\\label{energy}\\]\n\n[^a]: Another definition.\n[^b]: **Body** with _emphasis_, \\(E=mc^2\\) and [@second].\n\n    > Evidence\n\n    - One\n    - Two\n\n    \\[\n    y=2\\label{next}\n    \\]",
    );
    const before = JSON.stringify(parsed);
    const html = renderFootnoteContent(parsed, "b", {
      references: { second: { title: "Paper" } },
    })!;
    expect(html).toContain("<strong>Body</strong>");
    expect(html).toContain("<em>emphasis</em>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<ul>");
    expect(html).toContain("&quot;display&quot;:false");
    expect(html).toContain("&quot;display&quot;:true");
    expect(html).toContain("Paper");
    expect(html).not.toContain("Another definition");
    expect(html).not.toContain('class="footnotes"');
    expect(html).not.toContain('class="bibliography"');
    expect(documentIndex(parsed).labels.get("energy")).toBe(1);
    expect(JSON.stringify(parsed)).toBe(before);
  });
  test("same key resolves against the current document, never a global cache", () => {
    const a = parseMarkdown("Note[^a].\n\n[^a]: **First document**.");
    const b = parseMarkdown("Note[^a].\n\n[^a]: _Second document_.");
    expect(renderFootnoteContent(a, "a")).toContain(
      "<strong>First document</strong>",
    );
    expect(renderFootnoteContent(b, "a")).toContain("<em>Second document</em>");
    expect(renderFootnoteContent(a, "missing")).toBeNull();
    expect(renderFootnoteContent(a, "constructor")).toBeNull();
  });
  test("sanitization and scratchpad image restrictions also apply inside previews", () => {
    const parsed = parseMarkdown(
      "Note[^a].\n\n[^a]: Text <script>alert(1)</script> ![Figure](/figure.svg) [unsafe](javascript:alert)",
    );
    const html = renderFootnoteContent(parsed, "a", {
      disableImages: true,
      conformance: true,
    })!;
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).toContain("Image disabled");
  });
  test("tables and multi-paragraph definitions retain all content and line endings", () => {
    const source =
      "Note[^a].\r\n\r\n[^a]: First.\r\n\r\n    | A | B |\r\n    | --- | --- |\r\n    | 1 | 2 |\r\n\r\n    Last.";
    const parsed = parseMarkdown(source);
    const html = renderFootnoteContent(parsed, "a")!;
    expect(html).toContain("<table>");
    expect(html).toContain("<p>First.</p>");
    expect(html).toContain("<p>Last.</p>");
    expect(renderDocument(parsed)).toContain('href="#fn-a"');
  });
});
