/** Persistent values, never translated labels or URL segments. */
export const locales = [
  { id: "en", name: "English", direction: "ltr" },
  { id: "zh-Hans", name: "简体中文", direction: "ltr" },
  { id: "es", name: "Español", direction: "ltr" },
  { id: "fr", name: "Français", direction: "ltr" },
  { id: "ar", name: "العربية", direction: "rtl" },
  { id: "hi", name: "हिन्दी", direction: "ltr" },
  { id: "pt-BR", name: "Português (Brasil)", direction: "ltr" },
  { id: "ru", name: "Русский", direction: "ltr" },
  { id: "bn", name: "বাংলা", direction: "ltr" },
  { id: "id", name: "Bahasa Indonesia", direction: "ltr" },
] as const;
export type Locale = (typeof locales)[number]["id"];
export type LocaleChoice = Locale | "auto";
export const localeIds = locales.map((locale) => locale.id);
export const localeChoices = ["auto", ...localeIds] as const;
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && localeIds.includes(value as Locale);
}
export function isLocaleChoice(value: unknown): value is LocaleChoice {
  return value === "auto" || isLocale(value);
}
export function matchLocale(language: string): Locale | undefined {
  const value = language.trim().replace(/_/g, "-").toLowerCase();
  // Traditional Chinese must not silently become Simplified Chinese.
  if (/^zh(?:-(?:tw|hk|mo|hant))(?:-|$)/.test(value)) return undefined;
  if (/^zh(?:-|$)/.test(value)) return "zh-Hans";
  if (/^pt(?:-|$)/.test(value)) return "pt-BR";
  return locales.find(
    (locale) =>
      value === locale.id.toLowerCase() || value.startsWith(locale.id + "-"),
  )?.id;
}
export function resolveLocale(
  choice: LocaleChoice,
  languages: readonly string[] = [],
): Locale {
  if (choice !== "auto") return choice;
  for (const language of languages) {
    const match = matchLocale(language);
    if (match) return match;
  }
  return "en";
}
export const localeDirection = (locale: Locale) =>
  locales.find((entry) => entry.id === locale)!.direction;
