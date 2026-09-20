import { claimEditorOverlay } from "./editor-popover";
import { actionIcon, appendActionLabel } from "./icons/actions";
import { compactMenu, type ContextAction, type MenuEntry } from "./menu-model";
export type { ContextAction, MenuEntry } from "./menu-model";
/** One overlay owns every submenu: opening a child must never dismiss its parent. */
export function openContextMenu({
  owner,
  x,
  y,
  items,
  label = "Block actions",
  restore,
  onClose,
}: {
  owner: HTMLElement;
  x: number;
  y: number;
  items: ContextAction[];
  label?: string;
  restore?: () => void;
  onClose?: () => void;
}) {
  const opener =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const panels: {
    element: HTMLDivElement;
    trigger?: HTMLButtonElement;
    anchor: { x: number; y: number };
  }[] = [];
  let closed = false,
    hover: ReturnType<typeof setTimeout> | undefined;
  const removeAfter = (depth: number) => {
    clearTimeout(hover);
    for (const p of panels.splice(depth)) {
      p.trigger?.setAttribute("aria-expanded", "false");
      p.element.remove();
    }
  };
  const close = (focus = false) => {
    if (closed) return;
    closed = true;
    removeAfter(0);
    observer.disconnect();
    document.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("resize", resized);
    window.visualViewport?.removeEventListener("resize", resized);
    release();
    onClose?.();
    if (focus) {
      if (restore) restore();
      else if (opener?.isConnected) opener.focus({ preventScroll: true });
    }
  };
  const release = claimEditorOverlay(() => close());
  const outside = (event: PointerEvent) => {
    if (!panels.some((p) => p.element.contains(event.target as Node))) close();
  };
  const resized = () => {
    removeAfter(1);
    place(0);
  };
  const observer = new MutationObserver(() => {
    if (!owner.isConnected) close();
  });
  const place = (depth: number) => {
    const p = panels[depth];
    if (!p) return;
    const viewport = window.visualViewport,
      width = viewport?.width ?? innerWidth,
      height = viewport?.height ?? innerHeight;
    p.element.style.maxHeight = Math.max(80, height - 24) + "px";
    const box = p.element.getBoundingClientRect();
    let px = p.anchor.x,
      py = p.anchor.y;
    if (p.trigger) {
      const r = p.trigger.getBoundingClientRect();
      px = r.right + 4;
      py = r.top - 5;
      if (px + box.width > width - 12) px = r.left - box.width - 4;
    }
    p.element.style.left =
      Math.max(12, Math.min(px, width - box.width - 12)) + "px";
    p.element.style.top =
      Math.max(12, Math.min(py, height - box.height - 12)) + "px";
  };
  const build = (
    actions: MenuEntry[],
    depth: number,
    trigger?: HTMLButtonElement,
  ) => {
    removeAfter(depth);
    const menu = document.createElement("div");
    menu.className = "editor-context-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", trigger?.textContent || label);
    menu.dataset.depth = String(depth);
    panels.push({ element: menu, trigger, anchor: { x, y } });
    trigger?.setAttribute("aria-expanded", "true");
    const enabled = () =>
      Array.from(
        menu.querySelectorAll<HTMLButtonElement>(
          ":scope > button:not(:disabled)",
        ),
      );
    for (const item of actions) {
      if (item.kind === "separator") {
        const divider = document.createElement("div");
        divider.className = "action-menu-separator";
        divider.setAttribute("role", "separator");
        menu.append(divider);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute(
        "role",
        item.checked === undefined ? "menuitem" : "menuitemcheckbox",
      );
      button.tabIndex = -1;
      if (item.checked !== undefined)
        button.setAttribute("aria-checked", String(item.checked));
      button.disabled = !!item.disabled;
      if (item.id) button.dataset.action = item.id;
      if (item.tone) button.dataset.tone = item.tone;
      if (item.disabled && item.disabledReason) {
        button.title = item.disabledReason;
        button.setAttribute("aria-description", item.disabledReason);
      }
      appendActionLabel(button, item.icon, item.label);
      if (
        item.shortcut ||
        item.checked !== undefined ||
        item.kind === "submenu"
      ) {
        const trailing = document.createElement("span");
        trailing.className = "action-trailing";
        if (item.shortcut) {
          const hint = document.createElement("kbd");
          hint.textContent = item.shortcut;
          trailing.append(hint);
        }
        if (item.checked) trailing.append(actionIcon("check"));
        if (item.kind === "submenu") {
          trailing.append(actionIcon("chevronRight"));
          button.setAttribute("aria-haspopup", "menu");
          button.setAttribute("aria-expanded", "false");
        }
        button.append(trailing);
      }
      const child = (focus = false) => {
        if (item.kind !== "submenu" || button.disabled) return;
        if (panels[depth + 1]?.trigger !== button)
          build(item.children, depth + 1, button);
        if (focus)
          panels[depth + 1]?.element
            .querySelector<HTMLButtonElement>("button:not(:disabled)")
            ?.focus();
      };
      button.addEventListener("pointerenter", () => {
        clearTimeout(hover);
        if (item.kind === "submenu") hover = setTimeout(() => child(), 180);
        else hover = setTimeout(() => removeAfter(depth + 1), 220);
      });
      button.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" && item.kind === "submenu") {
          e.preventDefault();
          e.stopPropagation();
          child(true);
        }
      });
      button.addEventListener("click", () => {
        if (item.kind === "submenu") child(true);
        else {
          close(true);
          if (owner.isConnected) item.action();
        }
      });
      menu.append(button);
    }
    menu.addEventListener("pointerenter", () => clearTimeout(hover));
    menu.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" && depth) {
        event.preventDefault();
        event.stopPropagation();
        removeAfter(depth);
        trigger?.focus();
        return;
      }
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        if (depth && event.key === "Escape") {
          removeAfter(depth);
          trigger?.focus();
        } else close(true);
        return;
      }
      const buttons = enabled(),
        current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (!buttons.length) return;
      let index = current;
      if (event.key === "ArrowDown") index = (current + 1) % buttons.length;
      else if (event.key === "ArrowUp")
        index = (current - 1 + buttons.length) % buttons.length;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = buttons.length - 1;
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        const match = [
          ...buttons.slice(current + 1),
          ...buttons.slice(0, current + 1),
        ].find((b) =>
          b
            .querySelector(".action-label")
            ?.textContent?.toLowerCase()
            .startsWith(event.key.toLowerCase()),
        );
        if (match) index = buttons.indexOf(match);
        else return;
      } else return;
      event.preventDefault();
      event.stopPropagation();
      buttons[index]?.focus();
    });
    if (typeof menu.showPopover === "function")
      menu.setAttribute("popover", "manual");
    (menu.hasAttribute("popover")
      ? document.body
      : (owner.closest("dialog") ?? document.body)
    ).append(menu);
    if (menu.hasAttribute("popover")) menu.showPopover();
    place(depth);
  };
  build(compactMenu(items), 0);
  panels[0]?.element
    .querySelector<HTMLButtonElement>("button:not(:disabled)")
    ?.focus({ preventScroll: true });
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("resize", resized);
  window.visualViewport?.addEventListener("resize", resized);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => close();
}
