import type { MessageId, MessageValues } from "@axiom/i18n";
import { label } from "@axiom/i18n/client";
import { bindAttribute, bindText } from "@axiom/i18n/dom";
import type { FoldDescription } from "@axiom/editor/folding";

export const foldKindMessages = {
  list: "List",
  blockquote: "Quote",
  callout: "Callout",
  theorem: "Theorem",
  proof: "Proof",
  codeBlock: "Code",
  mathBlock: "Equation",
  table: "Table",
  frontmatter: "Metadata",
  footnoteDefinition: "Footnote",
} as const satisfies Record<string, MessageId>;

export function foldCaption(value: FoldDescription): {
  message: MessageId;
  values: MessageValues;
} {
  if (value.kind === "codeBlock" && value.language)
    return {
      message: "{language} code",
      values: { language: value.language },
    } as const;
  if (value.kind === "footnoteDefinition")
    return { message: "Footnote {key}", values: { key: value.key } } as const;
  const kind = value.kind as keyof typeof foldKindMessages;
  return {
    message: Object.hasOwn(foldKindMessages, kind)
      ? foldKindMessages[kind]
      : "Content block",
    values: {},
  } as const;
}

export function bindFoldCaption(element: HTMLElement, value: FoldDescription) {
  const caption = foldCaption(value);
  bindText(element, caption.message, caption.values);
}

export function bindFoldAction(
  button: HTMLButtonElement,
  value: FoldDescription,
  expanded: boolean,
) {
  // Destructure data so weak bindings never retain a node view or an editor.
  const caption = foldCaption(value),
    summary = value.summary.slice(0, 45);
  const message = expanded
    ? summary
      ? "Collapse {label}: {summary}"
      : "Collapse {label}"
    : summary
      ? "Expand {label}: {summary}"
      : "Expand {label}";
  const values = () => ({
    label: label(caption.message, caption.values),
    summary,
  });
  bindAttribute(button, "aria-label", message, values);
  bindAttribute(button, "title", message, values);
}
