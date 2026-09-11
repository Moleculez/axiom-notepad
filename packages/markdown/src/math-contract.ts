import type { DocumentIndex } from "./document-index";
import { macroDeclarations } from "./document-index";

export type MathRequest = {
  tex: string;
  display: boolean;
  macros: string[];
  physics: boolean;
};
export type MathResult = { html: string; css: string; error?: string };
export const MATH_INPUT_LIMIT = 30000;
export function mathRequest(
  tex: string,
  display: boolean,
  index: DocumentIndex,
): MathRequest {
  let text = tex;
  for (const declaration of macroDeclarations(tex).reverse())
    text = text.slice(0, declaration.from) + text.slice(declaration.to);
  text = text
    .replace(/\\label\s*\{[^}]+\}/g, "")
    .replace(
      /\\eqref\s*\{([^}]+)\}/g,
      (_match, label) => `\\text{(${index.labels.get(label) ?? "?"})}`,
    );
  return { tex: text, display, macros: index.macros, physics: index.physics };
}
