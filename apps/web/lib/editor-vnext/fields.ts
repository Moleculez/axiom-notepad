export type EditorField = {
  key: string;
  label: string;
  value: string;
  validate?: (value: string) => string | undefined;
};
/** A small first-party modal; native dialog owns focus trapping and Escape. */
export function sourceFields(options: {
  title: string;
  fields: EditorField[];
  apply: (values: Record<string, string>) => string | void;
  recover: (values: Record<string, string>) => void;
  restore: () => void;
}) {
  const dialog = document.createElement("dialog"),
    form = document.createElement("form"),
    heading = document.createElement("h3"),
    message = document.createElement("p"),
    actions = document.createElement("div");
  dialog.className = "axiom-field-dialog";
  dialog.setAttribute("aria-label", options.title);
  heading.textContent = options.title;
  message.role = "status";
  message.className = "axiom-preview-message";
  actions.className = "axiom-field-actions";
  const inputs = new Map<string, HTMLInputElement>();
  form.append(heading);
  for (const field of options.fields) {
    const label = document.createElement("label"),
      input = document.createElement("input"),
      name = document.createElement("span");
    name.textContent = field.label;
    input.value = field.value;
    input.maxLength = 4000;
    input.setAttribute("aria-label", field.label);
    input.autocomplete = "off";
    input.addEventListener("input", () => input.setCustomValidity(""));
    label.append(name, input);
    form.append(label);
    inputs.set(field.key, input);
  }
  const values = () =>
    Object.fromEntries([...inputs].map(([key, input]) => [key, input.value]));
  const dirty = () =>
    options.fields.some(
      (field) => inputs.get(field.key)!.value !== field.value,
    );
  let closed = false;
  const close = (recover = false, restore = true) => {
    if (closed) return;
    closed = true;
    if (recover && dirty()) options.recover(values());
    dialog.close();
    dialog.remove();
    if (restore) options.restore();
  };
  const cancel = document.createElement("button"),
    apply = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.className = "button secondary";
  apply.type = "submit";
  apply.textContent = "Apply";
  apply.className = "button primary";
  cancel.addEventListener("click", () => close());
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    for (const field of options.fields) {
      const input = inputs.get(field.key)!;
      const error = field.validate?.(input.value);
      if (error) {
        input.setCustomValidity(error);
        input.reportValidity();
        return;
      }
    }
    const error = dirty() ? options.apply(values()) : undefined;
    if (error) {
      message.textContent = error;
      return;
    }
    close();
  });
  actions.append(cancel, apply);
  form.append(message, actions);
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  inputs.values().next().value?.focus();
  return { close, revoke: () => close(true) };
}
