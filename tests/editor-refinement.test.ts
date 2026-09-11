import { describe, expect, it } from "vitest";
import {
  MarkdownEngine,
  parseMarkdown,
  parseTSV,
  writeTSV,
  renderDocument,
  documentIndex,
} from "../packages/markdown/src/index";
import { renderMath } from "../packages/markdown/src/mathjax";
import { renderDocumentAsync } from "../packages/markdown/src/render-async";

describe("change-aware engine", () => {
  it("bounds repeated command lookups for 100 KB and 1 MB documents", () => {
    for (const size of [100000, 1000000]) {
      const block =
        "Research data remains reproducible and preserves independent observations.\n\n";
      let source = (
        "# Benchmark\n\n" + block.repeat(Math.ceil(size / block.length))
      ).slice(0, size);
      const engine = new MarkdownEngine();
      engine.parse(source);
      const timings: number[] = [];
      for (let i = 0; i < 20; i++) {
        source = source.slice(0, 22) + "x" + source.slice(22);
        const start = performance.now();
        engine.parse(source);
        timings.push(performance.now() - start);
        const cached = performance.now();
        for (let count = 0; count < 100; count++) engine.parse(source);
        expect(performance.now() - cached).toBeLessThan(100);
      }
      expect(Math.max(...timings)).toBeLessThan(500);
      console.info(
        `Markdown ${size} bytes: incremental p95 ${timings.sort((a, b) => a - b)[18].toFixed(1)} ms; ${engine.stats.incremental} incremental parses, ${engine.stats.reused} cache hits`,
      );
    }
  });
  it("reuses unchanged documents and incrementally reparses interior text", () => {
    const engine = new MarkdownEngine();
    const source =
      "# Research\n\nA stable paragraph.\n\n| Name | Value |\n| --- | --- |\n| Alpha | 42 |\n\n```python\nvalue = 2\n```\n";
    const before = engine.parse(source);
    expect(engine.parse(source)).toBe(before);
    const next = source.replace("Alpha", "Alphabeta");
    expect(engine.parse(next)).toEqual(parseMarkdown(next));
    expect(engine.stats.incremental).toBe(1);
    expect(engine.parse(next.replace("stable", "**stable**"))).toEqual(
      parseMarkdown(next.replace("stable", "**stable**")),
    );
    expect(before).toEqual(parseMarkdown(source));
  });
  it("is differential-equivalent across seeded edits and ambiguous boundaries", () => {
    let seed = 1742;
    const random = (max: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % max;
    };
    const samples = [
      "# One\n\nText with [a][ref].\n\n[ref]: https://example.org\n",
      "# Same\n\n# Same\n\nA **bold** idea $x$.\n\n> Note\n> Nested *text*.\n",
      "| A | B |\n| :--- | ---: |\n| hello | $x$ |\n\n$$\nE=mc^2\\label{e}\n$$\n\n```python\na = 3\n```\n",
      "Text[^n].\n\n[^n]: footnote\n\nEnd\n",
      "- Item one\n- Item two\n\nEnd\n",
    ];
    const insertions = [
      "test",
      " ",
      "42",
      "\n",
      "|",
      "```",
      "$$",
      "[ref]",
      "> ",
      "\\label{x}",
      "**",
      "é",
      "研究",
      "",
      ":",
    ];
    for (const initial of samples) {
      const engine = new MarkdownEngine();
      let source = initial;
      engine.parse(source);
      for (let i = 0; i < 160; i++) {
        const from = random(source.length + 1),
          count = random(4);
        source =
          source.slice(0, from) +
          insertions[random(insertions.length)] +
          source.slice(from + count);
        expect(engine.parse(source)).toEqual(parseMarkdown(source));
      }
    }
  });
});

describe("table clipboard", () => {
  it("round-trips spreadsheet quoting, tabs, quotes and multiline cells", () => {
    const grid = [
      ["α", "two\nlines", "a\tb"],
      ['say "yes"', "", "tail"],
    ];
    expect(parseTSV(writeTSV(grid))).toEqual(grid);
    expect(() => parseTSV('"unterminated')).toThrow();
    expect(() => parseTSV(Array(101).fill("x").join("\t"))).toThrow();
  });
  it("allows only attribute-free table breaks, never arbitrary HTML", () => {
    const html = renderDocument(
      parseMarkdown(
        '| A |\n| --- |\n| first<br>second<br onclick="alert(1)"> |\n',
      ),
    );
    expect(html).toContain("first<br />second");
    expect(html).not.toContain("<br onclick=");
    expect(html).toContain("&lt;br onclick=");
  });
});

describe("local bounded MathJax", () => {
  const math = (tex: string, physics = false, macros: string[] = []) =>
    renderMath({ tex, display: true, physics, macros });
  it("exports through an isolated server worker", async () => {
    const result = await renderDocumentAsync(
      parseMarkdown("# Energy\n\n$$\nE=mc^2\n$$\n"),
    );
    expect(result.html).toContain("<svg");
    expect(result.html).toContain("<math");
    expect(result.css).toContain("mjx");
  }, 20000);
  it("renders accessible SVG for AMS, chemistry and explicit physics", () => {
    for (const [tex, physics] of [
      [String.raw`\begin{aligned}E&=mc^2\\ F&=ma\end{aligned}`, false],
      [String.raw`\ce{2H2 + O2 -> 2H2O}`, false],
      [String.raw`\require{physics}\dv{x}{t}`, true],
    ] as const) {
      const result = math(tex, physics);
      expect(result.error).toBeUndefined();
      expect(result.html).toContain("<svg");
      expect(result.html).toContain("<math");
      expect(result.html).not.toMatch(/<script|(?:href|src)=["']https?:/);
    }
  });
  it("isolates macros and rejects unapproved packages and active resources", () => {
    expect(
      math(String.raw`\custom{2}`, false, [
        String.raw`\newcommand{\custom}[1]{#1^2}`,
      ]).error,
    ).toBeUndefined();
    expect(math(String.raw`\custom{2}`).error).toBeTruthy();
    for (const tex of [
      String.raw`\require{physics}\dv{x}{t}`,
      String.raw`\require{https://evil.test/x}`,
      String.raw`\href{javascript:alert(1)}{x}`,
      String.raw`\htmlClass{x}{y}`,
      "x".repeat(30001),
      String.raw`\def\loop{\loop}\loop`,
    ])
      expect(math(tex).error).toBeTruthy();
  });
  it("indexes missing and duplicate references without treating code as equations", () => {
    const index = documentIndex(
      parseMarkdown(
        "$$\nx\\label{same}\n$$\n\n$$\ny\\label{same}\n$$\n\nSee \\eqref{missing}.\n\n```tex\n\\label{ignored}\n```\n",
      ),
    );
    expect(index.equations).toHaveLength(2);
    expect(index.labels.get("same")).toBe(1);
    expect(index.diagnostics.map((d) => d.message)).toEqual([
      "Duplicate equation label: same",
      "Missing equation: missing",
    ]);
  });
});
