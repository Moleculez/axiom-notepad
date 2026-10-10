import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { createTranslator } from "../../packages/i18n/src/index";
import type {} from "./main";

const source =
  "---\ntitle: Settings {draft}\n---\n\n```Python\n# Source Summary\nvalue = 1\n```\n\nAfter";

for (const locale of ["ja", "ko", "de"] as const)
  test(`${locale} labels update without remounting fields, committing drafts or editing folds`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/locales/*.json*", async (route) => {
      const name = new URL(route.request().url()).pathname.split("/").pop()!;
      expect(name).toMatch(/^(?:ja|ko|de)\.json$/);
      await route.fulfill({
        contentType: "application/json",
        body: await readFile(`packages/i18n/src/messages/${name}`, "utf8"),
      });
    });
    const catalog = JSON.parse(
      await readFile(`packages/i18n/src/messages/${locale}.json`, "utf8"),
    );
    const t = createTranslator(locale, catalog);
    await page.goto("/tests/editor-lab/index.html");
    await page.evaluate(() => window.editorLabReady);
    const pane = page.locator('[data-pane="0"]');
    for (const dark of [false, true]) {
      await page.evaluate(
        async ({ source, dark }) => {
          const appearanceModule = "/packages/shared/src/appearance.ts";
          const { defaults, appearanceVariables } = await import(
            appearanceModule
          );
          const localeModule = "/packages/i18n/src/client.ts";
          const { localeRuntime, applyDocumentLocale } = await import(
            localeModule
          );
          await localeRuntime.choose("en");
          applyDocumentLocale("en");
          const preferences = {
            ...defaults,
            uiSize: 20,
            proseSize: 24,
            radius: 0,
            shadows: "none",
            motion: "reduced",
          };
          for (const [key, value] of Object.entries(
            appearanceVariables(preferences, dark),
          ))
            document.documentElement.style.setProperty(key, String(value));
          document.documentElement.dataset.theme = dark ? "dark" : "light";
          document.documentElement.style.colorScheme = dark ? "dark" : "light";
          await window.editorLab.reset(source);
          window.editorLab.appearance(0, preferences);
          window.editorLab.appearance(1, preferences);
          window.editorLab.focus(0, source.lastIndexOf("After"));
        },
        { source, dark },
      );
      await pane.hover();
      await pane
        .locator(".axiom-folding-gutter")
        .getByRole("button", { name: /^Collapse Python code/i })
        .click();
      await expect(pane.locator(".axiom-folded-block")).toHaveCount(1);
      const field = pane.locator('.axiom-metadata input[data-field="value"]');
      await field.fill("Uncommitted 日本語 {draft}");
      const element = await field.elementHandle();
      const before = await page.evaluate(() => window.editorLab.snapshot());
      const caret = await field.evaluate((input: HTMLInputElement) => ({
        start: input.selectionStart,
        end: input.selectionEnd,
      }));
      await page.evaluate(async (locale) => {
        const path = "/packages/i18n/src/client.ts";
        const { localeRuntime, applyDocumentLocale } = await import(path);
        if (!(await localeRuntime.choose(locale)))
          throw new Error("Fixture catalog did not load");
        applyDocumentLocale(locale);
      }, locale);
      await expect(field).toHaveAccessibleName(
        t("Value for {name}", { name: "title" }),
      );
      await expect(field).toHaveAttribute("placeholder", t("Empty"));
      await expect(field).toBeFocused();
      await expect(field).toHaveValue("Uncommitted 日本語 {draft}");
      expect(
        await element?.evaluate(
          (element) =>
            element.isConnected && element === document.activeElement,
        ),
      ).toBe(true);
      expect(
        await field.evaluate((input: HTMLInputElement) => ({
          start: input.selectionStart,
          end: input.selectionEnd,
        })),
      ).toEqual(caret);
      expect(await page.evaluate(() => window.editorLab.snapshot())).toEqual(
        before,
      );
      const folded = pane.locator(".axiom-folded-block");
      await expect(folded.locator(".axiom-fold-label")).toHaveText(
        t("{language} code", { language: "Python" }),
      );
      await expect(folded.getByRole("button")).toHaveAttribute(
        "title",
        t("{count, plural, one {Expand # line} other {Expand # lines}}", {
          count: 4,
        }),
      );
      await expect(field).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await pane.locator(".axiom-metadata").screenshot({
        path: info.outputPath(
          `metadata-${locale}-${dark ? "dark" : "light"}-large.png`,
        ),
      });
      await field.press("Escape");
      await expect(field).toHaveValue("Settings {draft}");
      await folded.getByRole("button").click();
      await expect(folded).toHaveCount(0);
      expect(
        (await page.evaluate(() => window.editorLab.snapshot())).map(
          ({ source, undo, updates }) => ({ source, undo, updates }),
        ),
      ).toEqual(
        before.map(({ source, undo, updates }) => ({ source, undo, updates })),
      );
    }
    await page.emulateMedia({ forcedColors: "active" });
    const field = pane.locator('.axiom-metadata input[data-field="value"]');
    await field.focus();
    await expect(field).toBeFocused();
    await expect(field).toHaveAccessibleName(
      t("Value for {name}", { name: "title" }),
    );
    await pane.locator(".axiom-metadata").screenshot({
      path: info.outputPath(`metadata-${locale}-forced-colors.png`),
    });
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
  });
