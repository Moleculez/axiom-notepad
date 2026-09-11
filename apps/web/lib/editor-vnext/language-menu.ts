import {
  codeLanguageSuggestions,
  type CodeLanguage,
} from "@axiom/editor/code-languages";
import { claimEditorOverlay } from "../editor-popover";
import { languageLogo } from "../icons/languages";

export function languageOption(
  language: Pick<CodeLanguage, "label" | "value">,
  select: () => void,
) {
  const option = document.createElement("button"),
    label = document.createElement("span"),
    code = document.createElement("code");
  option.type = "button";
  option.role = "option";
  option.tabIndex = -1;
  option.className = "axiom-language-option";
  option.setAttribute("aria-label", language.label);
  label.textContent = language.label;
  label.className = "action-label";
  code.textContent = language.value;
  code.setAttribute("aria-hidden", "true");
  option.append(languageLogo(language.value), label, code);
  option.addEventListener("mousedown", (event) => event.preventDefault());
  option.addEventListener("click", select);
  return option;
}

/** First-party combobox list: focus stays in the field, never in a suggestion.
 * It inherits the editor's tokens and escapes clipped code/scratchpad surfaces. */
export function languageMenu(
  input: HTMLInputElement,
  choose: (value: string) => void,
) {
  const popup = document.createElement("div"),
    list = document.createElement("div"),
    hint = document.createElement("div");
  const id = "axiom-languages-" + crypto.randomUUID();
  popup.className = "axiom-completions axiom-language-completions";
  list.id = id;
  list.role = "listbox";
  list.setAttribute("aria-label", "Code language suggestions");
  hint.className = "axiom-completion-hint";
  hint.textContent = "↑↓ choose · Enter / Tab apply · Esc cancel";
  popup.append(list, hint);
  input.role = "combobox";
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", id);
  input.setAttribute("aria-expanded", "false");
  input.autocomplete = "off";
  input.spellcheck = false;
  const abort = new AbortController(),
    { signal } = abort;
  let choices: CodeLanguage[] = [],
    active = -1,
    composing = false,
    closed = false,
    frame = 0;
  const hide = () => {
    if (popup.hasAttribute("popover") && popup.matches(":popover-open"))
      popup.hidePopover();
    popup.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const place = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (closed || popup.hidden || !input.isConnected) return;
      const box = input.getBoundingClientRect();
      popup.style.left =
        Math.max(12, Math.min(box.left, innerWidth - popup.offsetWidth - 12)) +
        "px";
      popup.style.top =
        Math.max(
          12,
          box.bottom + popup.offsetHeight + 12 <= innerHeight
            ? box.bottom + 6
            : box.top - popup.offsetHeight - 6,
        ) + "px";
    });
  };
  const paint = () => {
    list.replaceChildren(
      ...choices.map((choice, index) => {
        const option = languageOption(choice, () => choose(choice.value));
        option.id = id + "-" + index;
        option.setAttribute("aria-selected", String(active === index));
        return option;
      }),
    );
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", id + "-" + active);
      list.children[active]?.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  const update = (initial = false) => {
    if (closed || composing) return hide();
    const query = initial ? "" : input.value;
    choices = codeLanguageSuggestions(query, input.value);
    active = query && choices.length ? 0 : -1;
    if (!choices.length) return hide();
    popup.hidden = false;
    if (popup.hasAttribute("popover") && !popup.matches(":popover-open"))
      popup.showPopover();
    input.setAttribute("aria-expanded", "true");
    paint();
    place();
  };
  if (typeof popup.showPopover === "function")
    popup.setAttribute("popover", "manual");
  (input.closest(".axiom-editor") ?? document.body).append(popup);
  const release = claimEditorOverlay(hide);
  window.addEventListener("scroll", place, {
    signal,
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", place, { signal, passive: true });
  input.addEventListener("input", () => update(), { signal });
  input.addEventListener(
    "compositionstart",
    () => {
      composing = true;
      hide();
    },
    { signal },
  );
  input.addEventListener(
    "compositionend",
    () => {
      composing = false;
      update();
    },
    { signal },
  );
  update(true);
  return {
    keydown(event: KeyboardEvent) {
      // Allow native IME handling, but do not let the enclosing field commit.
      if (composing || event.isComposing) return true;
      if (popup.hidden) return false;
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        active =
          active < 0
            ? event.key === "ArrowDown"
              ? 0
              : choices.length - 1
            : (active +
                (event.key === "ArrowDown" ? 1 : choices.length - 1) +
                choices.length) %
              choices.length;
        paint();
        return true;
      }
      if (
        (event.key === "Tab" && !event.shiftKey) ||
        (event.key === "Enter" && active >= 0)
      ) {
        event.preventDefault();
        choose(choices[Math.max(0, active)].value);
        return true;
      }
      return false;
    },
    destroy() {
      if (closed) return;
      closed = true;
      abort.abort();
      cancelAnimationFrame(frame);
      release();
      popup.remove();
      input.removeAttribute("aria-activedescendant");
      input.setAttribute("aria-expanded", "false");
    },
  };
}
