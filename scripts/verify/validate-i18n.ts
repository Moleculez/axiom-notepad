import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { locales, englishMessages } from "../../packages/i18n/src/index";
import {
  validateCatalog,
  validateTranslationCoverage,
  type CatalogDiagnostic,
} from "./i18n-contract";
import { requiredTranslations } from "../../packages/i18n/src/translation-coverage";
import {
  validateI18nUiSource,
  type I18nUiDiagnostic,
} from "./i18n-ui-contract";
const uiErrors: I18nUiDiagnostic[] = [];
let uiChecked = 0;
async function inspectUi(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspectUi(path);
    else if (/\.(ts|tsx)$/.test(path) && !path.endsWith(".d.ts")) {
      uiChecked++;
      uiErrors.push(
        ...validateI18nUiSource(path, await readFile(path, "utf8")),
      );
    }
  }
}
for (const root of ["apps/web/components", "apps/web/lib", "apps/showcase/src"])
  await inspectUi(root);
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
if (errors.length || uiErrors.length) {
  console.error(
    [
      ...errors.map(
        (error) => `${error.locale}: ${error.id}: ${error.message}`,
      ),
      ...uiErrors.map(
        (error) => `${error.file}:${error.line}: ${error.message}`,
      ),
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log(
    `${locales.length} catalogs: ${Object.keys(englishMessages).length} matching message IDs; ICU syntax, parameter types and HTML boundaries validated.`,
  );
  console.log(
    `${uiChecked} UI modules checked for unregistered literal translation bindings.`,
  );
  console.log(
    `${Object.values(requiredTranslations).flat().length} required translations per non-English language protected against fallback regressions across ${Object.keys(requiredTranslations).length} UI areas.`,
  );
  for (const locale of locales.filter((locale) => locale.id !== "en"))
    console.log(
      `${locale.id}: ${coverage[locale.id].localized} localized messages; ${coverage[locale.id].englishFallbacks.length} matching-English messages (includes technical/proper names).`,
    );
  console.log(
    "Coverage is not linguistic acceptance. Remaining copy is recorded in data/i18n/coverage.json.",
  );
}
