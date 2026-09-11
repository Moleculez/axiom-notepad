import type { Diagnostic, MarkdownNode, ParsedDocument } from "./types";
import { sectionNumbers } from "./section-numbers";

export type EquationEntry = {
  from: number;
  to: number;
  number: number;
  label?: string;
  tex: string;
};
export type DocumentIndex = {
  sections: Map<string, string>;
  equations: EquationEntry[];
  labels: Map<string, number>;
  references: { label: string; from: number; to: number }[];
  footnotes: string[];
  macros: string[];
  physics: boolean;
  diagnostics: Diagnostic[];
};
const indexes = new WeakMap<ParsedDocument, DocumentIndex>();

// Balanced declarations support arguments and nested braces without executing
// TeX during indexing. The renderer still applies expansion and size limits.
export function macroDeclarations(tex: string) {
  const declarations: { from: number; to: number; text: string }[] = [];
  const pattern =
    /\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator)\*?\s*(?:\{\\[A-Za-z]+\}|\\[A-Za-z]+)\s*(?:\[\d\]\s*)?(?:\[[^\]\n]*\]\s*)?\{/g;
  for (let match; (match = pattern.exec(tex)) && declarations.length < 200;) {
    let depth = 1,
      end = pattern.lastIndex;
    for (; end < tex.length && depth; end++) {
      if (tex[end] === "\\") {
        end++;
        continue;
      }
      if (tex[end] === "{") depth++;
      if (tex[end] === "}") depth--;
    }
    if (!depth) {
      declarations.push({
        from: match.index,
        to: end,
        text: tex.slice(match.index, end),
      });
      pattern.lastIndex = end;
    }
  }
  return declarations;
}
export function documentIndex(document: ParsedDocument): DocumentIndex {
  const existing = indexes.get(document);
  if (existing) return existing;
  const result: DocumentIndex = {
    sections: sectionNumbers(document.outline),
    equations: [],
    labels: new Map(),
    references: [],
    footnotes: [],
    macros: [],
    physics: false,
    diagnostics: [],
  };
  const visit = (node: MarkdownNode) => {
    if (node.type === "mathBlock" || node.type === "mathInline") {
      const tex = node.text ?? "";
      result.physics ||= /\\require\s*\{physics\}/.test(tex);
      if (node.type === "mathBlock") {
        const label = /\\label\s*\{([^}]+)\}/.exec(tex)?.[1];
        const equation = {
          from: node.from,
          to: node.to,
          number: result.equations.length + 1,
          label,
          tex,
        };
        result.equations.push(equation);
        if (label) {
          if (result.labels.has(label))
            result.diagnostics.push({
              from: node.from,
              to: node.to,
              message: `Duplicate equation label: ${label}`,
              severity: "warning",
            });
          else result.labels.set(label, equation.number);
        }
        result.macros.push(
          ...macroDeclarations(tex).map((declaration) => declaration.text),
        );
      }
      for (const match of tex.matchAll(/\\eqref\s*\{([^}]+)\}/g))
        result.references.push({
          label: match[1],
          from: node.from + match.index,
          to: node.from + match.index + match[0].length,
        });
    }
    if (node.type === "equationRef")
      result.references.push({
        label: node.key ?? "",
        from: node.from,
        to: node.to,
      });
    if (node.type === "footnoteRef" && !result.footnotes.includes(node.key!))
      result.footnotes.push(node.key!);
    node.children?.forEach(visit);
  };
  [
    ...(document.ast.children ?? []),
    ...(document.definitions ?? []).filter(
      (node) => node.type === "footnoteDefinition",
    ),
  ]
    .sort((a, b) => a.from - b.from)
    .forEach(visit);
  for (const reference of result.references)
    if (!result.labels.has(reference.label))
      result.diagnostics.push({
        from: reference.from,
        to: reference.to,
        severity: "warning",
        message: `Missing equation: ${reference.label}`,
      });
  indexes.set(document, result);
  return result;
}
