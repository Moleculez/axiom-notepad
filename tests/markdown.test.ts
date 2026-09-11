import { describe, it, expect } from "vitest";
import {
  parseMarkdown,
  renderDocument,
  createEdit,
  plainText,
  safeUrl,
} from "../packages/markdown/src/index";
import { readFileSync, existsSync } from "node:fs";
for (const dialect of ["commonmark", "gfm"] as const) {
  const path = `tests/fixtures/${dialect}.json`;
  describe(`${dialect} conformance`, () => {
    it("has the official fixtures", () => expect(existsSync(path)).toBe(true));
    const tests: {
      markdown: string;
      html: string;
      example: number;
      section: string;
    }[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
    for (const fixture of tests)
      it(`${fixture.example}: ${fixture.section}`, () =>
        expect(
          renderDocument(parseMarkdown(fixture.markdown, dialect), {
            conformance: true,
          }),
        ).toBe(fixture.html));
  });
}
describe("research dialect", () => {
  it("renders task gutters with intact nested and loose content", () => {
    const source =
      "- [ ] **Parent**\n\n  Second paragraph.\n\n  - [x] Child\n\n- Regular item";
    const doc = parseMarkdown(source);
    const before = JSON.stringify(doc);
    const html = renderDocument(doc);
    expect(html.match(/class="document-task"/g)).toHaveLength(2);
    expect(html).toContain(
      '<div class="document-task-content"><p><strong>Parent</strong></p>\n<p>Second paragraph.</p>',
    );
    expect(html).toContain('aria-label="Completed task"');
    expect(html).toContain('aria-label="Incomplete task"');
    expect(html).toContain("<p>Child</p>\n</div></li>");
    expect(html).toContain("<li>\n<p>Regular item</p>");
    expect(renderDocument(doc, { conformance: true })).not.toContain(
      "document-task",
    );
    expect(JSON.stringify(doc)).toBe(before);
  });
  it("keeps clipboard task HTML independent of application layout styles", () => {
    const html = renderDocument(parseMarkdown("- [x] **Task**"), {
      taskLayout: "inline",
    });
    expect(html).not.toContain("document-task");
    expect(html).toContain('checked="" /> <strong>Task</strong>');
  });
  it("keeps document-wide citations and footnote numbers in visual fragments", () => {
    const doc = parseMarkdown(
      "First [@a][^x].\n\n> [!NOTE]\n> Second [@b][^y].\n\n[^x]: One.\n[^y]: Two.",
    );
    const fragment = { ...doc, ast: doc.ast.children![1], citations: [] };
    const html = renderDocument(fragment, { document: doc, fragment: true });
    expect(html).toContain(">[2]</a>");
    expect(html).toContain('href="#fn-y">2</a>');
    expect(html).not.toContain('class="footnotes"');
  });
  it("separates block text for search and rejects network-path URL tricks", () => {
    expect(plainText(parseMarkdown("# Alpha\n\nBeta **gamma**").ast)).toBe(
      "Alpha\nBeta gamma",
    );
    expect(safeUrl("\\\\untrusted.example/x")).toBe("");
    expect(safeUrl("/\\untrusted.example/x")).toBe("");
  });
  it("bounds pathological inline and block nesting without losing source text", () => {
    for (const source of [
      "[".repeat(100000),
      "![".repeat(2000) + "x" + "](a)".repeat(2000),
      "> ".repeat(200) + "text",
      "*a ".repeat(4000) + "a*".repeat(4000),
    ]) {
      const start = performance.now();
      const doc = parseMarkdown(source);
      expect(performance.now() - start).toBeLessThan(2000);
      expect(doc.diagnostics.length).toBeGreaterThan(0);
      expect(() => renderDocument(doc)).not.toThrow();
    }
  });
  it("handles long research notes and lazy block continuations in bounded time", () => {
    for (const source of [
      "## Observation\n\n$x^2$ in [[Research]].\n\n".repeat(5000),
      "> First line\n" + "continuation\n".repeat(10000),
      "- First line\n" + "continuation\n".repeat(10000),
    ]) {
      const start = performance.now();
      expect(plainText(parseMarkdown(source).ast)).toContain(
        source.startsWith("##") ? "Observation" : "continuation",
      );
      expect(performance.now() - start).toBeLessThan(2000);
    }
  });
  it("extracts source ranges, outline, links, and citations", () => {
    const p = parseMarkdown(
      "# Energy\n\nSee [[Hamiltonian]] and [@dirac1930].\n\n$$\nE=mc^2\\label{energy}\n$$\n",
    );
    expect(p.outline[0].text).toBe("Energy");
    expect(p.links[0].target).toBe("Hamiltonian");
    expect(p.citations).toEqual(["dirac1930"]);
    expect(renderDocument(p)).toContain("eq-energy");
  });
  it("preserves escaped and fenced syntax", () => {
    expect(renderDocument(parseMarkdown("`$x$` and \\$x$\n"))).not.toContain(
      "data-math-request",
    );
  });
  it("escapes untrusted HTML and blocks unsafe links", () => {
    const html = renderDocument(
      parseMarkdown("<script>alert(1)</script>\n\n[x](javascript:alert(1))\n"),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
  });
  it("does not mutate source for visual commands", () => {
    expect(createEdit("bold", "hello", 0, 5)).toEqual({
      from: 0,
      to: 5,
      insert: "**hello**",
    });
  });
  it("renders callouts, footnotes, and incomplete equations safely", () => {
    const html = renderDocument(
      parseMarkdown(
        "> [!THEOREM] Energy\n> Conserved.\n\nFootnote[^a].\n\n[^a]: Details.\n\n$$\n\\badcommand\n$$\n",
      ),
    );
    expect(html).toContain("callout-theorem");
    expect(html).toContain("footnotes");
    expect(html).toContain("data-math-request");
    expect(html).toContain("\\badcommand");
  });
});
