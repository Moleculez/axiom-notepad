import { describe, expect, it } from "vitest";
import {
  buildLatexProject,
  escapeTex,
  safeMath,
  latexOptionsSchema,
} from "../packages/shared/src/latex-export";
import {
  researchWritingSource,
  researchWritingReferences,
} from "./fixtures/research-writing";
const snapshot = (source = researchWritingSource) => ({
  source,
  title: "Research & reproducibility",
  generation: 1,
});
describe("canonical-source LaTeX projects", () => {
  it("hoists safe document macros once and uses them in subsequent equations", () => {
    const p = buildLatexProject(
      snapshot(
        "$$\n\\newcommand{\\RR}{\\mathbb{R}}\n$$\n\nA scalar $x\\in\\RR$.\n\n$$\nx^2 \\in \\RR\n$$",
      ),
    );
    expect(p.diagnostics).toEqual([]);
    expect(p.files["main.tex"].match(/\\newcommand\{\\RR\}/g)).toHaveLength(1);
    expect(p.files["main.tex"].indexOf("\\newcommand{\\RR}")).toBeLessThan(
      p.files["main.tex"].indexOf("\\begin{document}"),
    );
    expect(p.files["main.tex"]).toContain("x^2 \\in \\RR");
  });
  it("preserves recursive or conflicting macros as inert source with a diagnostic", () => {
    const source = "$$\n\\newcommand{\\loop}{\\loop}\n\\loop\n$$";
    const p = buildLatexProject(snapshot(source));
    expect(p.diagnostics.some((d) => d.code === "unsupported-macros")).toBe(
      true,
    );
    expect(p.files["main.tex"]).not.toContain("\\newcommand{\\loop}");
    expect(p.files["original.md"]).toBe(source);
  });
  it.each(["biber", "bibtex"] as const)(
    "exports a complete editable %s project without rewriting source",
    (backend) => {
      const source = researchWritingSource.replaceAll("\n", "\r\n");
      const p = buildLatexProject(
        snapshot(source),
        { backend },
        researchWritingReferences,
      );
      expect(p.files["original.md"]).toBe(source);
      expect(p.files["main.tex"]).toContain(
        "\\documentclass[11pt,a4paper]{article}",
      );
      expect(p.files["main.tex"]).toContain("{FandolSong-Regular.otf}");
      expect(p.files["main.tex"]).toContain("\\label{eq:energy}");
      expect(p.files["main.tex"]).toContain("\\eqref{eq:energy}");
      expect(p.files["main.tex"]).toContain("\\begin{tabularx}");
      expect(p.files["main.tex"]).toContain("\\footnote[1]");
      expect(p.files["references.bib"]).toContain("Energy \\& mass");
      expect(p.files["references.bib"]).toContain("volume = {18}");
      expect(p.files["references-original.bib"]).toContain(
        "@article(einstein1905",
      );
      expect(p.files["COMPILE.md"]).toContain("-no-shell-escape");
      expect(p.diagnostics).toEqual([]);
    },
  );
  it("uses native Biber aliases and generated-only classic citation mapping", () => {
    const a = { ...researchWritingReferences[0], cite_key: "oldKey" },
      b = { ...a, cite_key: "otherKey" };
    const p = buildLatexProject(snapshot("[@oldKey; @otherKey]"), {}, [a, b]);
    expect(p.files["references.bib"].match(/@article/g)).toHaveLength(1);
    expect(p.files["references.bib"]).toContain("ids = {oldKey,otherKey}");
    expect(p.files["main.tex"]).toContain("\\autocite{oldKey}");
    expect(
      buildLatexProject(snapshot("[@oldKey]"), { backend: "bibtex" }, [a])
        .files["main.tex"],
    ).toContain("\\citep{einstein1905}");
  });
  it("does not overwrite a canonical key shadowed by note-local evidence", () => {
    const alias = { ...researchWritingReferences[0], cite_key: "oldKey" },
      local = {
        ...researchWritingReferences[0],
        identity: "note:local",
        title: "Independent result",
      };
    const p = buildLatexProject(snapshot("[@oldKey; @einstein1905]"), {}, [
      alias,
      local,
    ]);
    expect(p.citationMap.oldKey).toBe("oldKey");
    expect(p.citationMap.einstein1905).toBe("einstein1905");
    expect(p.files["references.bib"].match(/@article/g)).toHaveLength(2);
  });
  it("includes citation dependencies, but ignores citation-looking code", () => {
    const refs = [
      ...researchWritingReferences,
      {
        ...researchWritingReferences[0],
        cite_key: "parent",
        canonical_key: "parent",
        identity: "parent",
      },
      {
        ...researchWritingReferences[0],
        cite_key: "child",
        canonical_key: "child",
        identity: "child",
        bibtex: "@inproceedings{child,title={A result},crossref={parent}}",
      },
    ];
    const p = buildLatexProject(
      snapshot("[@child]\n\n```txt\n[@einstein1905]\n```"),
      {},
      refs,
    );
    expect(p.referenceKeys).toEqual(["child", "parent"]);
    expect(p.files["references.bib"]).not.toContain("@article{einstein1905");
  });
  it("reports unresolved citations/equations, retaining visible placeholders", () => {
    const p = buildLatexProject(snapshot("[@missing] and \\eqref{unknown}"));
    expect(p.diagnostics.some((d) => d.code === "missing-citation")).toBe(true);
    expect(
      p.diagnostics.some((d) => d.message.includes("Missing equation")),
    ).toBe(true);
    expect(p.files["main.tex"]).toContain("Unresolved: missing");
  });
  it("reports case-fold key conflicts rather than generating duplicate entries", () => {
    const refs = ["Key", "key"].map((key) => ({
      ...researchWritingReferences[0],
      cite_key: key,
      canonical_key: key,
      identity: key,
    }));
    expect(
      buildLatexProject(snapshot("[@Key; @key]"), {}, refs).diagnostics.some(
        (d) => d.severity === "error",
      ),
    ).toBe(true);
  });
  it("retains raw HTML and unsafe equations as inert external code files", () => {
    const source =
      "<script>alert('x')</script>\n\n$$\n\\input{/private/secret}\n$$\n";
    const p = buildLatexProject(snapshot(source));
    expect(p.files["original.md"]).toBe(source);
    expect(p.files["main.tex"]).not.toContain("\\input{");
    expect(
      Object.values(p.files).some((v) =>
        v.includes("\\input{/private/secret}"),
      ),
    ).toBe(true);
    expect(p.diagnostics.some((d) => d.code === "unsupported-block")).toBe(
      true,
    );
  });
  it.each([
    "\\write18{bad}",
    "^^5cinput{bad}",
    "\\providecommand{\\input}{}\\input{bad}",
    "\\begin{filecontents}{bad}x\\end{filecontents}",
    "\\renewcommand{\\begin}{}",
    "\\csname input\\endcsname{bad}",
  ])("rejects unsafe TeX %s", (tex) => expect(safeMath(tex)).toBe(false));
  it("allows bounded custom math commands without activating arbitrary preambles", () =>
    expect(safeMath("\\newcommand{\\energy}{E}\\energy = mc^2")).toBe(true));
  it("keeps original code containing environment terminators out of executable TeX", () => {
    const p = buildLatexProject(
      snapshot("```tex\n\\end{Verbatim}\n\\write18{bad}\n```"),
    );
    expect(p.files["main.tex"]).not.toContain("\\write18");
    expect(
      Object.values(p.files).filter(
        (v) => v === "\\end{Verbatim}\n\\write18{bad}\n",
      ),
    ).toHaveLength(1);
  });
  it("has explicit missing-image and nonportable-link diagnostics without remote fetching", () => {
    const p = buildLatexProject(
      snapshot(
        "![Remote](https://example.org/image.png) [unsafe](javascript:alert) [[Other note]]",
      ),
    );
    expect(p.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(["image-unavailable", "link-target", "note-link"]),
    );
    expect(p.files["main.tex"]).not.toContain(
      "includegraphics[width=\\linewidth",
    );
  });
  it("preserves Mermaid source and declares an optional local figure", () => {
    const p = buildLatexProject(
      snapshot("```mermaid\nflowchart LR\nA-->B\n```"),
    );
    expect(p.diagrams).toHaveLength(1);
    expect(p.files[p.diagrams[0].path]).toBeUndefined();
    expect(p.files["main.tex"]).toContain(
      "\\IfFileExists{figures/diagram-0.png}",
    );
  });
  it("escapes special text characters and defaults without account information", () => {
    expect(escapeTex("a_b & {c} \\")).toBe(
      "a\\_b \\& \\{c\\} \\textbackslash{}",
    );
    expect(latexOptionsSchema.parse({})).toMatchObject({
      backend: "biber",
      authors: "",
      date: "",
      margin: 20,
    });
  });
});
