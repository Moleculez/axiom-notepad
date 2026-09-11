/** Measure optical alignment on an inert clone, never mutate the editor DOM.
 * A zero-height inline box exposes the first baseline; 1cap supplies the
 * paragraph font's cap height. Line-box centering misses inline code/math. */
export function measureTaskLayout(input: HTMLInputElement) {
  const surface = input.closest<HTMLElement>(".axiom-prose, .prose")!,
    task = input.closest<HTMLElement>(".document-task")!,
    paragraph = task.querySelector<HTMLParagraphElement>(
      ":scope > .document-task-content > p",
    )!,
    index = [...surface.querySelectorAll("p")].indexOf(paragraph),
    clone = surface.cloneNode(true) as HTMLElement;
  clone.contentEditable = "false";
  clone.setAttribute("aria-hidden", "true");
  clone.inert = true;
  clone.style.cssText = `position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;box-sizing:border-box;width:${surface.getBoundingClientRect().width}px;max-width:none;height:auto;`;
  clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  clone
    .querySelectorAll("[contenteditable]")
    .forEach((el) => el.removeAttribute("contenteditable"));
  const copy = clone.querySelectorAll("p")[index],
    baseline = document.createElement("span"),
    cap = document.createElement("span");
  baseline.style.cssText =
    "display:inline-block;vertical-align:baseline;width:0;height:0;min-height:0;padding:0;border:0;margin:0;";
  cap.style.cssText = "position:absolute;width:1cap;height:1cap;";
  copy.prepend(baseline, cap);
  surface.parentElement!.append(clone);
  try {
    const control = input.getBoundingClientRect(),
      text = paragraph.getBoundingClientRect(),
      css = getComputedStyle(paragraph),
      firstBaseline =
        text.y +
        baseline.getBoundingClientRect().y -
        copy.getBoundingClientRect().y;
    return {
      text: paragraph.textContent,
      offset:
        control.y +
        control.height / 2 -
        firstBaseline +
        cap.getBoundingClientRect().height / 2,
      gap: text.x - control.right,
      margin: getComputedStyle(input).margin,
      layout: getComputedStyle(task).display,
      size: control.width,
      hitSize: parseFloat(getComputedStyle(input, "::before").width),
      textSize: parseFloat(css.fontSize),
      wrapped: text.height > parseFloat(css.lineHeight) + 1,
    };
  } finally {
    clone.remove();
  }
}
