import { codeLanguages } from "@axiom/editor/code-languages";
import { actionIcon, type ActionIconName } from "./actions";
import data from "./language-data.json";

type LanguageIcon = {
  brand?: keyof typeof data.logos;
  fallback: ActionIconName;
};
const mappings = data.mappings as Readonly<Record<string, LanguageIcon>>;
const canonical = new Map(
  codeLanguages.flatMap((language) =>
    [language.value, ...language.aliases].map(
      (alias) => [alias.toLowerCase(), language.value] as const,
    ),
  ),
);
const sources = new Map<string, string>();

/** Presentation only: never normalizes or rewrites a document's info string. */
export function languageIconSpec(
  value: string,
): LanguageIcon & { canonical: string } {
  const key =
    canonical.get(value.trim().toLowerCase()) ?? value.trim().toLowerCase();
  return {
    canonical: key,
    ...(Object.hasOwn(mappings, key)
      ? mappings[key]
      : { fallback: "fileCode" as const }),
  };
}

export function languageLogo(value: string) {
  const { canonical, brand, fallback } = languageIconSpec(value);
  const frame = document.createElement("span");
  frame.className = "language-logo";
  frame.dataset.language = canonical;
  frame.setAttribute("aria-hidden", "true");
  frame.append(actionIcon(fallback));
  if (brand) {
    frame.dataset.brand = brand;
    let src = sources.get(brand);
    if (!src) {
      // Fixed, reviewed SVG data stays in hashed JS assets and offline caches.
      src = "data:image/svg+xml," + encodeURIComponent(data.logos[brand].svg);
      sources.set(brand, src);
    }
    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    image.addEventListener(
      "error",
      () => {
        image.remove();
        delete frame.dataset.brand;
      },
      { once: true },
    );
    image.src = src;
    frame.append(image);
  }
  return frame;
}
