/** Retain the typeset element while its source positions move, or while the
 * worker renders a new equation. Never replace a ready preview with raw TeX
 * merely because the surrounding document was reprojected. */
export function paintMathPreview(
  host: HTMLElement,
  html: string,
  keepLast = true,
) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const next = template.content.firstElementChild;
  const current = host.firstElementChild;
  const pending = next?.querySelector<HTMLElement>("[data-math-request]");
  const rendered = current?.querySelector<HTMLElement>("[data-math-request]");
  if (
    !next ||
    !current ||
    !pending ||
    !rendered ||
    next.tagName !== current.tagName
  ) {
    host.replaceChildren(template.content);
    return;
  }
  // Source offsets and equation labels are navigation metadata, not TeX input.
  for (const attr of Array.from(current.attributes))
    if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  for (const attr of Array.from(next.attributes))
    if (current.getAttribute(attr.name) !== attr.value)
      current.setAttribute(attr.name, attr.value);
  const oldNumber = current.querySelector(".equation-number");
  const newNumber = next.querySelector(".equation-number");
  if (oldNumber && newNumber) oldNumber.textContent = newNumber.textContent;
  else if (newNumber) current.append(newNumber);
  else oldNumber?.remove();
  if (rendered.dataset.mathRequest !== pending.dataset.mathRequest) {
    if (
      !keepLast ||
      !["ready", "stale", "pending"].includes(rendered.dataset.mathState ?? "")
    )
      rendered.replaceChildren(...Array.from(pending.childNodes));
    rendered.dataset.mathState = "pending";
    rendered.setAttribute("aria-busy", "true");
    rendered.dataset.mathRequest = pending.dataset.mathRequest;
  }
}
