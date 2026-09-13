/** Original Axiom connected-knowledge mark. All app/export geometry lives here. */
export const brandVersion = "connected-1";
export const brandPaths = [
  "M15 7H9a3 3 0 0 0-3 3v22a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V14L15 7Z M15 7v7h7",
  "M35 13h-6a3 3 0 0 0-3 3v22a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V20l-7-7Z M35 13v7h7",
  "M18 25h12",
] as const;
export const brandColors = {
  ink: "#334d64",
  paper: "#f9f8f4",
  mineral: "#216c78",
} as const;
export function brandSvg({
  color = brandColors.ink,
  tile = false,
  background = brandColors.paper,
}: { color?: string; tile?: boolean; background?: string } = {}) {
  // Parameters are build-time colors only; no untrusted SVG input is accepted.
  for (const value of [color, background])
    if (!/^#[0-9a-f]{6}$/i.test(value))
      throw new Error("Use a six-digit brand color.");
  const geometry = `<g fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${brandPaths.map((d) => `<path d="${d}"/>`).join("")}</g><circle cx="24" cy="25" r="3.8" fill="${color}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tile ? 64 : 48} ${tile ? 64 : 48}" role="img" aria-label="Axiom"><title>Axiom — connected knowledge</title>${tile ? `<rect width="64" height="64" fill="${background}"/><g transform="translate(8 8)">${geometry}</g>` : geometry}</svg>\n`;
}
