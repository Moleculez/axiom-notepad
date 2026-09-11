import { actionIcon, type ActionIconName } from "../icons/actions";
import { editorCommandIcons } from "../icons/editor-commands";

/** Block chrome and menu actions share one source-independent icon catalog. */
export function blockIcon(name: string) {
  const icon = Object.hasOwn(editorCommandIcons, name)
    ? editorCommandIcons[name as keyof typeof editorCommandIcons]
    : ((
        { plus: "plus", more: "more", copy: "copy", edit: "edit" } as Record<
          string,
          ActionIconName
        >
      )[name] ?? "code");
  return actionIcon(icon);
}

export function iconButton(label: string, icon: string, action: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "editor-icon-button";
  button.setAttribute("aria-label", label);
  button.dataset.tooltip = label;
  button.append(blockIcon(icon));
  button.addEventListener("click", () => {
    if (button.getAttribute("aria-disabled") !== "true") action();
  });
  let timer: ReturnType<typeof setTimeout>;
  const hide = () => {
    clearTimeout(timer);
    if (tooltipOwner === button) hideTooltip?.();
  };
  button.addEventListener("pointerenter", () => {
    timer = setTimeout(() => showTooltip(button), 300);
  });
  button.addEventListener("focus", () => {
    clearTimeout(timer);
    showTooltip(button);
  });
  for (const event of ["pointerleave", "blur", "pointerdown", "click"])
    button.addEventListener(event, hide);
  return button;
}

let tooltipOwner: HTMLElement | undefined;
let hideTooltip: (() => void) | undefined;
function showTooltip(button: HTMLElement) {
  hideTooltip?.();
  if (!button.isConnected || !button.dataset.tooltip) return;
  const tooltip = document.createElement("div");
  tooltip.className = "editor-icon-tooltip";
  tooltip.role = "tooltip";
  tooltip.id = "editor-tip-" + crypto.randomUUID();
  tooltip.textContent = button.dataset.tooltip;
  const abort = new AbortController();
  const observer = new MutationObserver(() => {
    if (!button.isConnected) hideTooltip?.();
  });
  tooltipOwner = button;
  button.setAttribute("aria-describedby", tooltip.id);
  if (typeof tooltip.showPopover === "function")
    tooltip.setAttribute("popover", "manual");
  (tooltip.hasAttribute("popover")
    ? document.body
    : (button.closest("dialog") ?? document.body)
  ).append(tooltip);
  if (tooltip.hasAttribute("popover")) tooltip.showPopover();
  const box = button.getBoundingClientRect(),
    tip = tooltip.getBoundingClientRect();
  tooltip.style.left =
    Math.max(
      8,
      Math.min(
        box.left + (box.width - tip.width) / 2,
        innerWidth - tip.width - 8,
      ),
    ) + "px";
  tooltip.style.top =
    (box.top - tip.height > 10 ? box.top - tip.height - 6 : box.bottom + 6) +
    "px";
  hideTooltip = () => {
    tooltip.remove();
    observer.disconnect();
    abort.abort();
    button.removeAttribute("aria-describedby");
    hideTooltip = undefined;
    tooltipOwner = undefined;
  };
  observer.observe(document.body, { childList: true, subtree: true });
  for (const event of ["scroll", "resize", "keydown"])
    window.addEventListener(event, () => hideTooltip?.(), {
      signal: abort.signal,
      capture: true,
    });
}

export function disableIcon(button: HTMLButtonElement, reason?: string) {
  button.setAttribute("aria-disabled", String(!!reason));
  button.dataset.tooltip = reason || button.getAttribute("aria-label") || "";
  if (reason) button.setAttribute("aria-description", reason);
  else button.removeAttribute("aria-description");
}
