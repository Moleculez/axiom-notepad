import { parse } from "@formatjs/icu-messageformat-parser";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { locales } from "../../packages/i18n/src/locales";
import { englishMessages } from "../../packages/i18n/src/index";
import { catalogsRevision } from "./catalogs.mjs";
export async function buildCatalogs() {
  await mkdir("apps/web/public/locales", { recursive: true });
  for (const locale of locales) {
    const source: Record<string, string> = JSON.parse(
      await readFile(`packages/i18n/src/messages/${locale.id}.json`, "utf8"),
    );
    // English is already bundled. Do not download or offline-cache it again in
    // every language; missing entries resolve through the typed English catalog.
    const ast = Object.fromEntries(
      Object.entries(source)
        .filter(
          ([id, message]) =>
            locale.id !== "en" &&
            message !== englishMessages[id as keyof typeof englishMessages],
        )
        .map(([id, message]) => [
          id,
          parse(message, { ignoreTag: true, requiresOtherClause: true }),
        ]),
    );
    await writeFile(
      `apps/web/public/locales/${locale.id}.json`,
      JSON.stringify(ast) + "\n",
    );
  }
  console.log(
    `Compiled ${locales.length} ICU catalogs (${catalogsRevision()}) for production and showcase.`,
  );
}
if (process.argv[1]?.endsWith("/i18n/build.ts")) await buildCatalogs();
