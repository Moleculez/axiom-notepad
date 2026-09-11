import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  mathSymbols,
  mathSymbolFields,
} from "../packages/editor/src/math-symbols";
import {
  mathSourceSuggestions,
  mathSourceInsertion,
} from "../packages/editor/src/math-source-completions";
import {
  mathTemplates,
  matchesMathLibrary,
} from "../apps/web/lib/tools/math-library";

describe("Math Studio source completion", () => {
  const suggest = (source: string, explicit = false) =>
    mathSourceSuggestions(source, source.length, explicit);
  it("completes a bare LaTeX document without Markdown fences", () => {
    const result = suggest("x + \\fr")!;
    expect(result.from).toBe(4);
    expect(result.to).toBe(7);
    expect(result.options[0]).toMatchObject({
      label: "\\frac",
      value: "\\frac{numerator}{denominator}",
      fields: [
        [6, 15],
        [17, 28],
      ],
    });
    expect(suggest("\\")!.options.length).toBe(mathSymbols.length);
    expect(suggest("\\Gamma")!.options[0].label).toBe("\\Gamma");
  });
  it("does not suggest for prose, escaped commands, comments, or an unknown command", () => {
    for (const value of [
      "alpha",
      "\\\\alpha",
      "% \\alp",
      "x \\\\% \\fr",
      "\\unknowncommand",
    ])
      expect(suggest(value)).toBeNull();
    expect(suggest("x \\% + \\alp")!.options[0].label).toBe("\\alpha");
    expect(suggest("x \\\\\\alp")!.options[0].label).toBe("\\alpha");
    expect(suggest("% commented\n\\alp")!.options[0].label).toBe("\\alpha");
    expect(suggest("x + ", true)!.options.length).toBe(mathSymbols.length);
  });
  it("replaces the rest of a command and offers paired environments", () => {
    expect(mathSourceSuggestions("\\fraction", 3)).toMatchObject({
      from: 0,
      to: 9,
    });
    const result = mathSourceSuggestions("\\begin{pm}", 9)!;
    expect(result.to).toBe(10);
    expect(result.options[0]).toMatchObject({
      label: "\\begin{pmatrix}",
      value: "\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}",
    });
  });
  it("includes configured macros without evaluating them or duplicating built-ins", () => {
    const macros =
      "\\newcommand{\\RR}{\\mathbb{R}}\n\\def\\Rset{R}\n\\renewcommand{\\frac}[2]{#1/#2}";
    expect(
      mathSourceSuggestions("\\R", 2, false, macros)!
        .options.filter((item) => item.title === "Project macro")
        .map((item) => item.label),
    ).toEqual(["\\RR", "\\Rset"]);
    expect(
      mathSourceSuggestions("\\fr", 3, false, macros)!.options.filter(
        (item) => item.label === "\\frac",
      ),
    ).toHaveLength(1);
  });
  it("preserves every catalog insertion and selects its first field", () => {
    for (const symbol of mathSymbols) {
      const fields = mathSymbolFields(symbol);
      const insertion = mathSourceInsertion(symbol.insert, fields, 0);
      const state = EditorState.create().update(insertion).state;
      expect(state.doc.toString(), symbol.id).toBe(symbol.insert);
      expect(insertion.ranges.at(-1)).toEqual({
        from: symbol.insert.length,
        to: symbol.insert.length,
      });
      if (fields.length)
        expect(
          [state.selection.main.from, state.selection.main.to],
          symbol.id,
        ).toEqual(fields[0]);
    }
  });
  it("keeps escaped literal braces and template expressions intact", () => {
    for (const value of [
      "\\left\\{x\\right\\}",
      ...mathTemplates.map((template) => template.tex),
    ]) {
      const state = EditorState.create().update(
        mathSourceInsertion(value, [], 0),
      ).state;
      expect(state.doc.toString()).toBe(value);
    }
  });
});
describe("Math library search", () => {
  it("matches commands, diacritics, descriptions and multiword topics", () => {
    expect(matchesMathLibrary("\\alp", "alpha", "Greek")).toBe(true);
    expect(matchesMathLibrary("schrodinger", "Schrödinger equation")).toBe(
      true,
    );
    expect(
      matchesMathLibrary(
        "machine learning",
        "Gradient descent",
        "Machine learning",
      ),
    ).toBe(true);
    expect(matchesMathLibrary("unlikely symbol", "alpha", "Greek")).toBe(false);
  });
});
