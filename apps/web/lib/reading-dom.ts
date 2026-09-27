const rangeAttribute = /^data-(?:reading|visual|math|task)-(?:from|to)$/;
const rangeSelector =
  "[data-reading-from],[data-visual-from],[data-math-from],[data-task-from]";
export const readingBlockKey = (html: string) =>
  html.replace(/ data-(?:reading|visual|math|task)-(?:from|to)="\d+"/g, "");

/** Retain unchanged blocks, including decoded images, math/diagram DOM and text
 * nodes. Positional metadata is refreshed separately after upstream insertions. */
export function reconcileReadingBlocks(
  root: HTMLElement,
  html: string,
  originals: WeakMap<Element, string>,
) {
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = html;
  const available = new Map<string, Element[]>();
  for (const child of [...root.children]) {
    const key = originals.get(child);
    if (key === undefined) continue;
    const bucket = available.get(key) ?? [];
    bucket.push(child);
    available.set(key, bucket);
  }
  const scroller = root.closest<HTMLElement>(".document-scroll");
  const top = scroller?.getBoundingClientRect().top ?? 0;
  const anchor = [...root.children].find(
    (node) => node.getBoundingClientRect().bottom > top,
  );
  const offset = anchor?.getBoundingClientRect().top;
  let cursor: ChildNode | null = root.firstChild;
  for (const fresh of [...template.content.children]) {
    const key = readingBlockKey(fresh.outerHTML);
    const retained = available.get(key)?.shift();
    const node = retained ?? fresh;
    if (retained) {
      const previous = [retained, ...retained.querySelectorAll(rangeSelector)];
      const next = [fresh, ...fresh.querySelectorAll(rangeSelector)];
      next.forEach((element, index) => {
        for (const attribute of [...element.attributes])
          if (rangeAttribute.test(attribute.name))
            previous[index]?.setAttribute(attribute.name, attribute.value);
      });
    }
    originals.set(node, key);
    if (node !== cursor) root.insertBefore(node, cursor);
    cursor = node.nextSibling;
  }
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
  if (scroller && anchor?.isConnected && offset !== undefined)
    scroller.scrollTop += anchor.getBoundingClientRect().top - offset;
}

export function hasReadingSelection(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount)
    return false;
  return selection.getRangeAt(0).intersectsNode(root);
}
