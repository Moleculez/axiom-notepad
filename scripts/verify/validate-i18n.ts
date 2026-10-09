import { readFile, mkdir, writeFile } from "node:fs/promises";
import { locales, englishMessages } from "../../packages/i18n/src/index";
import {
  validateCatalog,
  validateTranslationCoverage,
  type CatalogDiagnostic,
} from "./i18n-contract";
import { requiredTranslations } from "../../packages/i18n/src/translation-coverage";
const errors: CatalogDiagnostic[] = [],
  coverage: Record<
    string,
    { messages: number; localized: number; englishFallbacks: string[] }
  > = {};
for (const locale of locales) {
  const catalog = JSON.parse(
    await readFile(`packages/i18n/src/messages/${locale.id}.json`, "utf8"),
  );
  errors.push(...validateCatalog(locale.id, catalog));
  errors.push(...validateTranslationCoverage(locale.id, catalog));
  const englishFallbacks =
    locale.id === "en"
      ? []
      : Object.entries(englishMessages)
          .filter(([id, value]) => catalog[id] === value)
          .map(([id]) => id);
  coverage[locale.id] = {
    messages: Object.keys(englishMessages).length,
    localized: Object.keys(englishMessages).length - englishFallbacks.length,
    englishFallbacks,
  };
}
await mkdir("data/i18n", { recursive: true });
await writeFile(
  "data/i18n/coverage.json",
  JSON.stringify(coverage, null, 2) + "\n",
);
if (errors.length) {
  console.error(
    errors
      .map((error) => `${error.locale}: ${error.id}: ${error.message}`)
      .join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log(
    `Ten catalogs: ${Object.keys(englishMessages).length} matching message IDs; ICU syntax, parameter types and HTML boundaries validated.`,
  );
  console.log(
    `${Object.values(requiredTranslations).flat().length} required translations per non-English language protected against fallback regressions across six UI areas.`,
  );
  for (const locale of locales.filter((locale) => locale.id !== "en"))
    console.log(
      `${locale.id}: ${coverage[locale.id].localized} localized messages; ${coverage[locale.id].englishFallbacks.length} matching-English messages (includes technical/proper names).`,
    );
  console.log(
    "Coverage is not linguistic acceptance. Remaining copy is recorded in data/i18n/coverage.json.",
  );
}
