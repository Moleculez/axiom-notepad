import previews from "./math-symbol-data.json";

/** Generated exclusively from the trusted catalog using bundled MathJax fonts. */
export function mathSymbolPreview(id: string): string | undefined {
  return Object.hasOwn(previews, id)
    ? previews[id as keyof typeof previews]
    : undefined;
}
export function mathSymbolIcon(id: string) {
  const span = document.createElement("span");
  span.className = "math-symbol-icon";
  span.dataset.mathSymbol = id;
  span.setAttribute("aria-hidden", "true");
  const svg = mathSymbolPreview(id);
  if (svg) span.innerHTML = svg;
  else span.textContent = "∑";
  return span;
}
