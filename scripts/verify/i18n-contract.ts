import {
  parse,
  TYPE,
  type MessageFormatElement,
} from "@formatjs/icu-messageformat-parser";
import {
  englishMessages,
  localeIds,
  type Locale,
} from "../../packages/i18n/src/index";
import {
  requiredTranslations,
  matchingEnglishTranslations,
} from "../../packages/i18n/src/translation-coverage";
export type CatalogDiagnostic = { locale: string; id: string; message: string };
function parameters(
  elements: readonly MessageFormatElement[],
  result = new Map<string, string>(),
) {
  for (const element of elements) {
    if (
      [
        TYPE.argument,
        TYPE.number,
        TYPE.date,
        TYPE.time,
        TYPE.select,
        TYPE.plural,
      ].includes(element.type) &&
      "value" in element
    ) {
      const kind =
        element.type === TYPE.plural
          ? "number"
          : element.type === TYPE.number
            ? "number"
            : element.type === TYPE.date || element.type === TYPE.time
              ? "date"
              : "value";
      const before = result.get(element.value);
      if (before && before !== kind)
        throw new Error(`Inconsistent parameter ${element.value}`);
      result.set(element.value, kind);
    }
    if ("options" in element)
      for (const option of Object.values(element.options))
        parameters(option.value, result);
    if (element.type === TYPE.tag) parameters(element.children, result);
  }
  return [...result].sort(([a], [b]) => a.localeCompare(b));
}
export function validateCatalog(
  locale: Locale,
  catalog: Record<string, string>,
): CatalogDiagnostic[] {
  const errors: CatalogDiagnostic[] = [];
  if (!localeIds.includes(locale))
    errors.push({ locale, id: "", message: "Unsupported locale" });
  const expected = Object.keys(englishMessages).sort(),
    keys = Object.keys(catalog).sort();
  for (const id of expected)
    if (!Object.hasOwn(catalog, id))
      errors.push({ locale, id, message: "Missing message" });
  for (const id of keys) {
    if (!Object.hasOwn(englishMessages, id)) {
      errors.push({ locale, id, message: "Unknown message ID" });
      continue;
    }
    const text = catalog[id];
    if (typeof text !== "string" || !text.trim()) {
      errors.push({ locale, id, message: "Empty or invalid message" });
      continue;
    }
    try {
      const original = parse(
        englishMessages[id as keyof typeof englishMessages],
        { ignoreTag: true },
      );
      const translated = parse(text, { ignoreTag: true });
      if (
        JSON.stringify(parameters(original)) !==
        JSON.stringify(parameters(translated))
      )
        errors.push({
          locale,
          id,
          message: "ICU parameters or parameter types changed",
        });
      if (
        /<\/?(?:script|iframe|img|style)\b/i.test(text) &&
        !/<\/?(?:script|iframe|img|style)\b/i.test(id)
      )
        errors.push({
          locale,
          id,
          message: "Translations must not introduce HTML",
        });
    } catch (error) {
      errors.push({ locale, id, message: `Malformed ICU: ${String(error)}` });
    }
  }
  return errors;
}

export function validateTranslationCoverage(
  locale: Locale,
  catalog: Record<string, string>,
): CatalogDiagnostic[] {
  if (locale === "en") return [];
  return Object.entries(requiredTranslations).flatMap(([scope, ids]) =>
    ids.flatMap((id) =>
      !catalog[id]?.trim() ||
      (catalog[id] === englishMessages[id] &&
        !matchingEnglishTranslations[id]?.includes(locale))
        ? [
            {
              locale,
              id,
              message: `Required ${scope} translation is missing or reverted to English`,
            },
          ]
        : [],
    ),
  );
}
