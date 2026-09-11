/** The pre-v4 LaTeX preset signature, also used to upgrade existing accounts.
 * Independent of appearance schemas to avoid a schema/preset import cycle. */
export const latexArticleTypography = {
  proseWeight: "400",
  headingWeight: "700",
  codeWeight: "400",
  letterSpacing: 0,
  wordSpacing: 0,
  fullWidth: false,
  proseFont: "latinModern",
  headingFont: "latinModern",
  proseSize: 19,
  codeSize: 14,
  codeFont: "plexMono",
  lineHeight: 1.65,
  paragraphSpacing: 0.8,
  readingWidth: 70,
  headingScale: 0.9,
} as const;

export function legacyDocumentDecorations(value: object): "none" | "latex" {
  return Object.entries(latexArticleTypography).every(
    ([key, expected]) => (value as Record<string, unknown>)[key] === expected,
  )
    ? "latex"
    : "none";
}
