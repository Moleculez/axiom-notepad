import {
  renderFootnoteContent,
  type ParsedDocument,
  type RenderContext,
} from "@axiom/markdown";
import { editorOverlayActive, onEditorOverlayChange } from "./editor-popover";

let dismissVisible: (() => void) | undefined;
const referenceSelector = "[data-footnote-key]";

/** Firefox cannot focus links inside editable prose. Make the non-editable
 * atom the keyboard link and retain its native anchor for pointer navigation. */
export function paintFootnoteReference(anchor: HTMLElement, html: string) {
  const fragment = document.createElement("span");
  fragment.innerHTML = html;
  const reference =
    fragment.querySelector<HTMLAnchorElement>(referenceSelector);
  anchor.removeAttribute("data-footnote-key");
  if (reference) {
    anchor.dataset.footnoteKey = reference.dataset.footnoteKey!;
    anchor.tabIndex = 0;
    anchor.role = "link";
    anchor.setAttribute("aria-label", "Footnote " + reference.textContent);
    reference.removeAttribute("data-footnote-key");
    reference.tabIndex = -1;
    reference.setAttribute("aria-hidden", "true");
  }
  anchor.replaceChildren(...fragment.childNodes);
}

/** Read-only, document-scoped previews. Neither the tooltip nor its metadata is
 * editable source; no selection, focus, history or provider API is involved. */
export function footnoteTooltips(options: {
  root: HTMLElement;
  document: () => ParsedDocument;
  context: () => RenderContext;
}) {
  const { root } = options;
  const lifetime = new AbortController();
  let anchor: HTMLElement | null = null;
  let tooltip: HTMLDivElement | null = null;
  let body: HTMLDivElement | null = null;
  let opened: AbortController | null = null;
  let resize: ResizeObserver | null = null;
  let removed: MutationObserver | null = null;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let pointerOnReference = false;
  let pointerOnTooltip = false;
  let focused = false;
  let previousHTML: string | null = null;
  let key = "";
  let destroyed = false;

  const blocked = () =>
    editorOverlayActive() || !!document.querySelector("dialog[open]");
  const reference = (target: EventTarget | null) => {
    const link =
      target instanceof Element
        ? target.closest<HTMLElement>(referenceSelector)
        : null;
    return link && root.contains(link) ? link : null;
  };
  const close = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    cancelAnimationFrame(frame);
    if (anchor && tooltip) {
      const ids = (anchor.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter((id) => id && id !== tooltip!.id);
      if (ids.length) anchor.setAttribute("aria-describedby", ids.join(" "));
      else anchor.removeAttribute("aria-describedby");
    }
    opened?.abort();
    resize?.disconnect();
    removed?.disconnect();
    tooltip?.remove();
    if (dismissVisible === close) dismissVisible = undefined;
    anchor = tooltip = body = null;
    opened = resize = removed = null;
    previousHTML = null;
    pointerOnReference = pointerOnTooltip = focused = false;
  };
  const valid = () =>
    !!anchor &&
    anchor.isConnected &&
    root.contains(anchor) &&
    anchor.dataset.footnoteKey === key &&
    !blocked();

  const place = () => {
    if (!tooltip || !anchor) return;
    if (!valid()) return close();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0,
      top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? innerWidth),
      bottom = top + (viewport?.height ?? innerHeight);
    const box = anchor.getBoundingClientRect();
    let visibleLeft = left,
      visibleRight = right,
      visibleTop = top,
      visibleBottom = bottom;
    for (
      let parent = anchor.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent),
        rect = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        visibleLeft = Math.max(visibleLeft, rect.left);
        visibleRight = Math.min(visibleRight, rect.right);
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        visibleTop = Math.max(visibleTop, rect.top);
        visibleBottom = Math.min(visibleBottom, rect.bottom);
      }
    }
    if (
      box.width === 0 ||
      box.height === 0 ||
      box.right <= visibleLeft ||
      box.left >= visibleRight ||
      box.bottom <= visibleTop ||
      box.top >= visibleBottom
    )
      return close();
    tooltip.style.maxWidth = Math.max(1, right - left - 24) + "px";
    tooltip.style.maxHeight =
      Math.max(1, Math.min(320, bottom - top - 24)) + "px";
    const size = tooltip.getBoundingClientRect();
    tooltip.style.left =
      Math.max(
        left + 12,
        Math.min(
          box.left + (box.width - size.width) / 2,
          right - size.width - 12,
        ),
      ) + "px";
    tooltip.style.top =
      Math.max(
        top + 12,
        Math.min(
          box.top - size.height - 8 >= top + 12
            ? box.top - size.height - 8
            : box.bottom + 8,
          bottom - size.height - 12,
        ),
      ) + "px";
  };
  const schedulePlace = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  };
  const refresh = () => {
    if (!tooltip || !body || !anchor) return;
    if (!valid()) return close();
    const html = renderFootnoteContent(
      options.document(),
      key,
      options.context(),
    );
    if (html === null) return close();
    if (html !== previousHTML) {
      // This is already sanitized renderer output, never raw user HTML. Strip
      // copied anchor identities and make every preview child non-interactive.
      body.innerHTML = html || '<p class="muted">Empty footnote</p>';
      for (const element of body.querySelectorAll<HTMLElement>("*")) {
        if (element.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
        for (const name of [
          "id",
          "tabindex",
          "contenteditable",
          "data-footnote-key",
          "data-task-from",
          "data-math-from",
          "data-note-target",
          "aria-labelledby",
          "aria-describedby",
          "title",
        ])
          element.removeAttribute(name);
        if (element instanceof HTMLInputElement) element.disabled = true;
        if (element.matches("a, button, summary")) {
          const span = document.createElement("span");
          span.className = "footnote-preview-link";
          span.append(...element.childNodes);
          element.replaceWith(span);
        }
      }
      previousHTML = html;
    }
    // Popovers inherit their owner before promotion to the top layer. Reuse
    // document tokens explicitly because the fallback portal lives under body.
    const style = getComputedStyle(anchor);
    for (let i = 0; i < style.length; i++) {
      const name = style[i];
      if (name.startsWith("--"))
        tooltip.style.setProperty(name, style.getPropertyValue(name));
    }
    schedulePlace();
  };
  const hideSoon = () => {
    clearTimeout(hideTimer);
    if (!pointerOnReference && !pointerOnTooltip && !focused) {
      clearTimeout(showTimer);
      hideTimer = setTimeout(close, 160);
    }
  };
  const show = () => {
    if (destroyed || !valid() || tooltip) return;
    if (
      renderFootnoteContent(options.document(), key, options.context()) === null
    )
      return close();
    dismissVisible?.();
    dismissVisible = close;
    tooltip = document.createElement("div");
    tooltip.className = "footnote-tooltip";
    tooltip.role = "tooltip";
    tooltip.id = "footnote-tip-" + crypto.randomUUID();
    body = document.createElement("div");
    body.className = "footnote-tooltip-content prose";
    tooltip.append(body);
    const ids = new Set(
      (anchor!.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter(Boolean),
    );
    ids.add(tooltip.id);
    anchor!.setAttribute("aria-describedby", [...ids].join(" "));
    opened = new AbortController();
    const { signal } = opened;
    tooltip.addEventListener(
      "pointerenter",
      () => {
        pointerOnTooltip = true;
        clearTimeout(hideTimer);
      },
      { signal },
    );
    tooltip.addEventListener(
      "pointerleave",
      () => {
        pointerOnTooltip = false;
        hideSoon();
      },
      { signal },
    );
    // Reading/scrolling a tooltip cannot blur an editor or select its text.
    for (const type of ["pointerdown", "mousedown", "click", "contextmenu"])
      tooltip.addEventListener(
        type,
        (event) => {
          event.preventDefault();
          event.stopPropagation();
        },
        { signal },
      );
    if (typeof tooltip.showPopover === "function")
      tooltip.setAttribute("popover", "manual");
    document.body.append(tooltip);
    if (tooltip.hasAttribute("popover")) tooltip.showPopover();
    refresh();
    place();
    if (!tooltip) return;
    resize = new ResizeObserver(schedulePlace);
    resize.observe(tooltip);
    resize.observe(anchor!);
    removed = new MutationObserver(() => {
      if (!valid()) close();
    });
    removed.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    window.addEventListener(
      "scroll",
      (event) => {
        if (!(event.target instanceof Node && tooltip?.contains(event.target)))
          schedulePlace();
      },
      { capture: true, passive: true, signal },
    );
    window.addEventListener("resize", schedulePlace, { passive: true, signal });
    window.visualViewport?.addEventListener("resize", schedulePlace, {
      passive: true,
      signal,
    });
    window.visualViewport?.addEventListener("scroll", schedulePlace, {
      passive: true,
      signal,
    });
  };
  const activate = (link: HTMLElement, immediate: boolean) => {
    if (blocked()) return;
    if (link !== anchor) {
      close();
      anchor = link;
      key = link.dataset.footnoteKey!;
    }
    if (immediate) focused = true;
    else pointerOnReference = true;
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    if (tooltip) return;
    if (immediate) show();
    else showTimer = setTimeout(show, 300);
  };
  const { signal } = lifetime;
  root.addEventListener(
    "pointerover",
    (event) => {
      const link = reference(event.target);
      if (
        link &&
        !(
          event.relatedTarget instanceof Node &&
          link.contains(event.relatedTarget)
        )
      )
        activate(link, false);
    },
    { signal },
  );
  root.addEventListener(
    "pointerout",
    (event) => {
      if (
        reference(event.target) !== anchor ||
        (event.relatedTarget instanceof Node &&
          anchor?.contains(event.relatedTarget))
      )
        return;
      pointerOnReference = false;
      hideSoon();
    },
    { signal },
  );
  root.addEventListener(
    "focusin",
    (event) => {
      const link = reference(event.target);
      if (link) activate(link, true);
    },
    { signal },
  );
  root.addEventListener(
    "focusout",
    (event) => {
      if (reference(event.target) !== anchor) return;
      focused = false;
      hideSoon();
    },
    { signal },
  );
  root.addEventListener(
    "keydown",
    (event) => {
      // A focused footnote is a native link, not a prose Enter/typing target.
      const link = reference(event.target);
      if (link) {
        event.stopPropagation();
        if (event.key === "Enter" && !(link instanceof HTMLAnchorElement)) {
          event.preventDefault();
          link.querySelector<HTMLAnchorElement>("a[href]")?.click();
        }
      }
    },
    { signal, capture: true },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && tooltip) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    },
    { signal, capture: true },
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!tooltip?.contains(event.target as Node)) close();
    },
    { signal, capture: true },
  );
  root.addEventListener("click", () => close(), { signal, capture: true });
  window.addEventListener("blur", close, { signal });
  window.addEventListener("beforeprint", close, { signal });
  window.addEventListener("axiom:prepare-print", close, { signal });
  const unsubscribe = onEditorOverlayChange((active) => {
    if (active) close();
  });
  const observer = new MutationObserver(refresh);
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-footnote-key"],
  });
  return {
    refresh,
    close,
    destroy: () => {
      destroyed = true;
      close();
      observer.disconnect();
      lifetime.abort();
      unsubscribe();
    },
  };
}
