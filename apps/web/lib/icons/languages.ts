import { codeLanguages } from "@axiom/editor/code-languages";
import { actionIcon, type ActionIconName } from "./actions";
import data from "./language-mappings.json";

type LanguageIcon = {
  fallback: ActionIconName;
};
const mappings = data as Readonly<Record<string, ActionIconName>>;
const canonical = new Map(
  codeLanguages.flatMap((language) =>
    [language.value, ...language.aliases].map(
      (alias) => [alias.toLowerCase(), language.value] as const,
    ),
  ),
);

/** Presentation only: never normalizes or rewrites a document's info string. */
export function languageIconSpec(
  value: string,
): LanguageIcon & { canonical: string } {
  const key =
    canonical.get(value.trim().toLowerCase()) ?? value.trim().toLowerCase();
  return {
    canonical: key,
    ...(Object.hasOwn(mappings, key)
      ? { fallback: mappings[key] }
      : { fallback: "fileCode" as const }),
  };
}

export function languageLogo(value: string) {
  const { canonical, fallback } = languageIconSpec(value);
  const frame = document.createElement("span");
  frame.className = "language-logo";
  frame.dataset.language = canonical;
  frame.setAttribute("aria-hidden", "true");
  frame.append(actionIcon(fallback));
  return frame;
}
