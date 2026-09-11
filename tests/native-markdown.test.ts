import { describe, expect, test } from "vitest";
import {
  parseMarkdown,
  renderDocument,
  documentStatistics,
  textStatistics,
} from "../packages/markdown/src/index";

describe("researcher Markdown extensions", () => {
  test("empty table cells have distinct source insertion points", () => {
    const source = "| A | B |\n| --- | --- |\n|  |  |\n";
    const cells =
      parseMarkdown(source).ast.children![0].children!.at(-1)!.children!;
    expect(cells.map((cell) => [cell.from, cell.to])).toEqual([
      [26, 26],
      [29, 29],
    ]);
  });
  test("passive frontmatter does not become a divider and heading", () => {
    const source =
      "---\ntitle: Experiment\nunsafe: !!js/function alert(1)\n---\n\n# Experiment\n";
    const parsed = parseMarkdown(source);
    expect(parsed.ast.children![0].type).toBe("frontmatter");
    expect(parsed.outline.map((h) => h.text)).toEqual(["Experiment"]);
    const html = renderDocument(parsed);
    expect(html).toContain("Document metadata");
    expect(html).toContain("!!js/function");
    expect(parseMarkdown("---\n\nOrdinary divider").ast.children![0].type).toBe(
      "hr",
    );
  });
  test("TOC follows actual ancestors, including skipped heading levels", () => {
    const html = renderDocument(
      parseMarkdown(
        "[toc]\n\n## Root\n\n#### Child\n\n### Sibling child\n\n## Other\n",
      ),
    );
    expect(html).toContain('href="#root" style="margin-inline-start:0px"');
    expect(html).toContain('href="#child" style="margin-inline-start:16px"');
    expect(html).toContain(
      'href="#sibling-child" style="margin-inline-start:16px"',
    );
  });
  test("subscript, superscript, emoji and attribute-free underline render safely", () => {
    const html = renderDocument(
      parseMarkdown("H~2~O x^2^ :smile: <u>under **line**</u>"),
    );
    expect(html).toContain("H<sub>2</sub>O");
    expect(html).toContain("x<sup>2</sup>");
    expect(html).toContain("😄");
    expect(html).toContain("<u>under <strong>line</strong></u>");
    const unsafe = renderDocument(
      parseMarkdown(
        '<u onclick="alert(1)">text</u>\n\n<script>alert(1)</script>',
      ),
    );
    expect(unsafe).not.toContain("<u onclick");
    expect(unsafe).not.toContain("<script>");
    expect(renderDocument(parseMarkdown("`H~2~O :smile:`"))).toContain(
      "<code>H~2~O :smile:</code>",
    );
    expect(
      renderDocument(parseMarkdown("H~2~O x^2^ :smile:", "commonmark")),
    ).not.toContain("<sub>");
  });
  test("stats exclude math, code and metadata and count Unicode words", () => {
    const source =
      "---\ntitle: Metadata\n---\n\n# Research\n\nA **useful** result. $E=mc^2$\n\n```python\nprint('not prose')\n```\n\n- [x] Reproduce\n";
    const stats = documentStatistics(parseMarkdown(source), source);
    expect(stats.words).toBe(5);
    expect(stats.equations).toBe(1);
    expect(stats.codeBlocks).toBe(1);
    expect(stats.completedTasks).toBe(1);
    expect(textStatistics("研究 数据").words).toBe(2);
    expect(textStatistics("👩🏽‍🔬").characters).toBe(1);
  });
});
