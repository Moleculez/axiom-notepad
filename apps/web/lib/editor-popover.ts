let dismissCurrent: (() => void) | undefined;
let pinned = 0;
const activity = new Set<(active: boolean) => void>();
export const editorOverlayActive = () => !!dismissCurrent || pinned > 0;
/** Pinned research cards may own nested code/math menus, but suppress hover previews. */
export function retainEditorCard() {
  pinned++; changed();
  return () => { pinned=Math.max(0,pinned-1); changed(); };
}
export function onEditorOverlayChange(listener: (active: boolean) => void) {
  activity.add(listener);
  return () => {
    activity.delete(listener);
  };
}
const changed = () =>
  activity.forEach((listener) => listener(editorOverlayActive()));

/** One owned overlay at a time across workspace menus and editor panels. */
export function claimEditorOverlay(dismiss: () => void) {
  dismissCurrent?.();
  dismissCurrent = dismiss;
  changed();
  return () => {
    if (dismissCurrent === dismiss) {
      dismissCurrent = undefined;
      changed();
    }
  };
}

export function openEditorPopover(options: {
  owner: HTMLElement;
  anchor: () => DOMRect;
  label: string;
  restore: () => void;
  onClose?: () => void;
}) {
  const element = document.createElement("div");
  element.className = "editor-action-panel";
  element.role = "dialog";
  element.setAttribute("aria-label", options.label);
  element.tabIndex = -1;
  const abort = new AbortController();
  let closed = false;
  let frame = 0;
  const close = (focus = false) => {
    if (closed) return;
    closed = true;
    abort.abort();
    observer.disconnect();
    resize.disconnect();
    cancelAnimationFrame(frame);
    element.remove();
    release();
    options.onClose?.();
    if (focus && options.owner.isConnected) options.restore();
  };
  const release = claimEditorOverlay(() => close());
  const place = () => {
    if (closed) return;
    if (!options.owner.isConnected) return close();
    const anchor = options.anchor();
    const viewport = window.visualViewport;
    const width = viewport?.width ?? innerWidth;
    const height = viewport?.height ?? innerHeight;
    element.style.maxHeight = Math.max(100, height - 24) + "px";
    const rect = element.getBoundingClientRect();
    element.style.left =
      Math.max(
        12,
        Math.min(anchor.right - rect.width, width - rect.width - 12),
      ) + "px";
    element.style.top =
      Math.max(
        12,
        Math.min(
          anchor.bottom + 6 + rect.height <= height - 12
            ? anchor.bottom + 6
            : anchor.top - rect.height - 6,
          height - rect.height - 12,
        ),
      ) + "px";
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  };
  const observer = new MutationObserver(() => {
    if (!options.owner.isConnected) close();
  });
  const resize = new ResizeObserver(schedule);
  if (typeof element.showPopover === "function")
    element.setAttribute("popover", "manual");
  (element.hasAttribute("popover")
    ? document.body
    : (options.owner.closest("dialog") ?? document.body)
  ).append(element);
  if (element.hasAttribute("popover")) element.showPopover();
  observer.observe(document.body, { childList: true, subtree: true });
  resize.observe(element);
  resize.observe(options.owner);
  const { signal } = abort;
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!element.contains(event.target as Node)) close();
    },
    { signal, capture: true },
  );
  window.addEventListener("scroll", schedule, {
    signal,
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", schedule, { signal, passive: true });
  window.visualViewport?.addEventListener("resize", schedule, {
    signal,
    passive: true,
  });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  });
  element.addEventListener("mousedown", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    if (!button) return;
    // Safari does not focus pointer-activated buttons. Own the focus handoff
    // before the browser can blur/remove the panel between down and click.
    event.preventDefault();
    button.focus({ preventScroll: true });
  });
  element.addEventListener("focusout", (event) => {
    if (
      event.relatedTarget instanceof Node &&
      element.contains(event.relatedTarget)
    )
      return;
    requestAnimationFrame(() => {
      if (!closed && !element.contains(document.activeElement)) close();
    });
  });
  return { element, close, place };
}
