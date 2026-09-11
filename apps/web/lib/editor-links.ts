import { safeUrl } from "@axiom/markdown";

/** Own a modifier-click before an editable surface can replace its link DOM.
 * Pointer release is needed on macOS, where Control-click may omit click entirely.
 * Opening on release preserves drag cancellation; click must not open it twice.
 */
export function installEditorLinkNavigation(
  root: HTMLElement,
  resolve: (event: MouseEvent) => string | null,
  open: (target: string) => void,
  signal: AbortSignal,
) {
  let pressed: {
    target: string;
    opened: boolean;
    range?: Range;
    backward: boolean;
  } | null = null;
  const consume = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const activate = (target: string) => {
    if (safeUrl(target)) open(target);
  };
  const options = { signal, capture: true };
  const down = (event: MouseEvent) => {
    pressed = null;
    if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return;
    const target = resolve(event);
    if (target === null) return;
    const selection = root.ownerDocument.getSelection();
    const range = selection?.rangeCount
      ? selection.getRangeAt(0).cloneRange()
      : undefined;
    pressed = {
      target,
      opened: false,
      range,
      backward:
        !!range &&
        !selection!.isCollapsed &&
        selection!.anchorNode === range.endContainer &&
        selection!.anchorOffset === range.endOffset,
    };
    consume(event);
  };
  const up = (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      !pressed ||
      pressed.opened ||
      resolve(event) !== pressed.target
    )
      return;
    consume(event);
    pressed.opened = true;
    activate(pressed.target);
  };
  // Prevent the pointer default, not only mousedown: WebKit otherwise selects
  // the word beneath Control-click even when contextmenu is cancelled.
  root.addEventListener("pointerdown", down, options);
  root.addEventListener("pointerup", up, options);
  root.addEventListener("mousedown", down, options);
  root.addEventListener("mouseup", up, options);
  root.addEventListener(
    "pointercancel",
    () => {
      pressed = null;
    },
    options,
  );
  root.addEventListener(
    "click",
    (event) => {
      if (event.button !== 0) return;
      if (pressed && event.detail > 0) {
        pressed = null;
        consume(event);
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = resolve(event);
      if (target !== null) {
        consume(event);
        activate(target);
      }
    },
    options,
  );
  root.addEventListener(
    "contextmenu",
    (event) => {
      if (event.button !== 0 || !event.ctrlKey || !pressed) return;
      consume(event);
      // WebKit selects a word before delivering this event, despite cancelling
      // pointerdown. Restore the live DOM range before selectionchange can be
      // interpreted as an editing gesture. A real right-click is unaffected.
      const selection = root.ownerDocument.getSelection();
      const { range, backward } = pressed;
      if (range?.startContainer.isConnected && range.endContainer.isConnected) {
        selection?.setBaseAndExtent(
          backward ? range.endContainer : range.startContainer,
          backward ? range.endOffset : range.startOffset,
          backward ? range.startContainer : range.endContainer,
          backward ? range.startOffset : range.endOffset,
        );
      } else if (!range) selection?.removeAllRanges();
    },
    options,
  );
}

/** Consume external (or unsafe) destinations before the host searches note names.
 * Call synchronously from the user's click so browsers allow the new tab.
 */
export function openExternalEditorLink(target: string): boolean {
  const href = safeUrl(target).trim();
  if (!href) return true;
  if (!/^(?:https?|mailto):/i.test(href)) return false;
  try {
    const url = new URL(href);
    window.open(url.href, "_blank", "noopener,noreferrer");
  } catch {
    // A malformed external URL is not a note title or a navigation request.
  }
  return true;
}
