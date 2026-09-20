export type AppPrompt = {
  title: string;
  message: string;
  input: boolean;
  confirmLabel: string;
  destructive?: boolean;
  defaultValue?: string;
  resolve: (value: string | null) => void;
};
function ask(options: Omit<AppPrompt, "resolve">) {
  return new Promise<string | null>((resolve) => {
    const event = new CustomEvent<AppPrompt>("axiom:prompt", {
      cancelable: true,
      detail: { ...options, resolve },
    });
    // No host must never silently authorize a destructive action.
    if (window.dispatchEvent(event)) resolve(null);
  });
}
export async function confirmAction(
  message: string,
  options: {
    title?: string;
    confirmLabel?: string;
    destructive?: boolean;
  } = {},
) {
  return (
    (await ask({
      message,
      title: options.title ?? "Confirm action",
      confirmLabel: options.confirmLabel ?? "Continue",
      destructive: options.destructive,
      input: false,
    })) !== null
  );
}
export function promptText(message: string) {
  return ask({
    title: "Save library filter",
    message,
    confirmLabel: "Save filter",
    input: true,
  });
}
export function promptValue(
  message: string,
  options: { title: string; defaultValue?: string },
) {
  return ask({
    message,
    title: options.title,
    defaultValue: options.defaultValue,
    confirmLabel: "Save",
    input: true,
  });
}
