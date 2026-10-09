import { test, expect, type Page } from "@playwright/test";
import { locales, localeTag } from "../../packages/i18n/src/locales";
import { createTranslator } from "../../packages/i18n/src/index";
import { readFile } from "node:fs/promises";

const note = "3f000000-0000-4000-8000-000000000001";
const key = "axiom:locale:showcase:v1";
const settings = (page: Page) => page.locator(".demo-settings-dialog");
async function openLanguage(page: Page) {
  await page
    .locator(".demo-header-actions button")
    .filter({ has: page.locator(".lucide-palette") })
    .click();
  await settings(page).getByRole("tab").first().click();
  return settings(page).getByRole("combobox");
}
async function savedSource(page: Page): Promise<string> {
  return page.evaluate(
    (id) =>
      new Promise<string>((resolve, reject) => {
        const opening = indexedDB.open("axiom-showcase-v1", 1);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const read = db
            .transaction("documents", "readonly")
            .objectStore("documents")
            .get(id);
          read.onerror = () => {
            reject(read.error);
            db.close();
          };
          read.onsuccess = () => {
            resolve(read.result?.source ?? "");
            db.close();
          };
        };
      }),
    note,
  );
}

test("all twelve languages, automatic matching and recovery names are available", async ({
  page,
}, info) => {
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:3010/") &&
      /^https?:/.test(request.url())
    )
      external.push(request.url());
  });
  await page.goto(`./#editor&note=${note}`);
  await expect(page.locator(".axiom-editor")).toBeVisible();
  const source = await savedSource(page);
  const url = page.url();
  const language = await openLanguage(page);
  await expect(language.locator("option")).toHaveCount(13);
  for (const locale of locales) {
    await language.selectOption(locale.id);
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      localeTag(locale.id),
    );
    await expect(page.locator("html")).toHaveAttribute("dir", locale.direction);
    await expect(language).toHaveValue(locale.id);
    await expect(language.locator(`option[value="${locale.id}"]`)).toHaveText(
      locale.name,
    );
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      locale.id,
    );
    expect(page.url()).toBe(url);
    expect(await savedSource(page)).toBe(source);
  }
  await language.selectOption("de");
  expect(
    await settings(page)
      .locator(".reading-view")
      .evaluate((element) => getComputedStyle(element).direction),
  ).toBe("ltr");
  await page.screenshot({ path: info.outputPath("language-german-light.png") });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator(".axiom-editor")).toBeVisible();
  expect(await savedSource(page)).toBe(source);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("a language switch preserves the mounted source editor, selection and undo", async ({
  page,
}) => {
  await page.goto(`./#editor&note=${note}`);
  await expect(page.locator(".axiom-editor")).toBeVisible();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const source = page.locator(".demo-document-scroll .cm-content");
  await source.focus();
  await source.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "# Mixed 日本語 العربية\n\nCanonical Markdown\n\n```python\nx = 1\n```\n",
  );
  await expect.poll(() => savedSource(page)).toContain("Canonical Markdown");
  await source.press("ControlOrMeta+End");
  await page.keyboard.insertText("keep history");
  await expect.poll(() => savedSource(page)).toContain("keep history");
  const edited = await savedSource(page);
  const originalElement = await source.elementHandle();
  const language = await openLanguage(page);
  await language.selectOption("zh-Hans");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await settings(page).locator(".dialog-heading button").click();
  expect(await originalElement?.evaluate((node) => node.isConnected)).toBe(
    true,
  );
  expect(await savedSource(page)).toBe(edited);
  await source.focus();
  await source.press("ControlOrMeta+z");
  await expect.poll(() => savedSource(page)).not.toContain("keep history");
  await source.press("ControlOrMeta+Shift+z");
  await expect.poll(() => savedSource(page)).toBe(edited);
  expect(
    await source.evaluate((element) => getComputedStyle(element).direction),
  ).toBe("ltr");
});

test("unsupported browser locales fall back and a failed catalog leaves the selection recoverable", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({ locale: "it-IT" });
  const fallback = await context.newPage();
  await fallback.goto("http://127.0.0.1:3010/axiom-notepad/#editor");
  await expect(fallback.locator("html")).toHaveAttribute("lang", "en-US");
  await context.close();
  await page.goto(`./#editor&note=${note}`);
  await expect(page.locator(".axiom-editor")).toBeVisible();
  const language = await openLanguage(page);
  await page.route("**/locales/es.json*", (route) => route.abort());
  await language.selectOption("es");
  await expect(settings(page).getByRole("alert")).toBeVisible();
  await expect(language).toHaveValue("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull();
  await language.selectOption("fr");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});

test("German controls remain usable in dark mode, large text and accessibility modes", async ({
  page,
  browserName,
}, info) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(({ key }) => localStorage.setItem(key, "de"), {
    key,
  });
  await page.goto(`./#editor&note=${note}`);
  await expect(page.locator(".axiom-editor")).toBeVisible();
  const language = await openLanguage(page);
  await expect(language).toHaveValue("de");
  await expect(language).toBeVisible();
  await language.focus();
  // Native macOS tab navigation includes non-text controls with Option-Tab.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  expect(
    await settings(page).evaluate((dialog) =>
      dialog.contains(document.activeElement),
    ),
  ).toBe(true);
  await settings(page).getByRole("tab").nth(1).click();
  await settings(page)
    .locator('.preference-number input[type="number"]')
    .first()
    .fill("20");
  await page.keyboard.press("Tab");
  await page.screenshot({
    path: info.outputPath("language-german-dark-large.png"),
  });
  await page.emulateMedia({ forcedColors: "active" });
  await settings(page).getByRole("tab").first().click();
  await expect(language).toBeVisible();
  await page.screenshot({
    path: info.outputPath("language-german-forced-colors.png"),
  });
});

test("localized table scopes and destructive dialog focus use stable identities", async ({
  page,
}) => {
  await page.addInitScript(({ key }) => localStorage.setItem(key, "de"), {
    key,
  });
  await page.goto(`./#editor&note=${note}`);
  const editor = page.locator(".axiom-editor");
  await expect(editor).toBeVisible();
  const table = editor.locator(".axiom-table-shell");
  await table.locator("th").first().click();
  await table.locator(".axiom-table-controls button").last().click();
  const panel = page.locator(".editor-action-panel");
  await expect(panel).toBeVisible();
  const scope = panel.locator('[role="tab"][data-scope="Column"]');
  await scope.click();
  await expect(scope).toHaveAttribute("aria-selected", "true");
  await expect(panel.locator('[role="tab"][aria-selected="true"]')).toHaveCount(
    1,
  );
  await expect(scope).not.toHaveText("Column");
  await scope.press("Escape");
  await expect(panel).toHaveCount(0);
  await openLanguage(page);
  await settings(page).getByRole("tab").last().click();
  await settings(page).locator(".demo-local-reset button").click();
  const confirmation = page.locator("dialog:not(.demo-settings-dialog)");
  await expect(confirmation.locator("[data-dialog-cancel]")).toBeFocused();
  await confirmation.locator("[data-dialog-cancel]").click();
  await expect(confirmation).toHaveCount(0);
  await expect(settings(page)).toBeVisible();
});

for (const locale of ["ja", "ko", "de"] as const) {
  test(`${locale} reading settings translate choices while preserving source and canonical values`, async ({
    page,
    browserName,
  }, info) => {
    const t = createTranslator(
      locale,
      JSON.parse(
        await readFile(`packages/i18n/src/messages/${locale}.json`, "utf8"),
      ),
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`./#editor&note=${note}`);
    await expect(page.locator(".axiom-editor")).toBeVisible();
    const source = await savedSource(page);
    const url = page.url();
    const language = await openLanguage(page);
    await language.selectOption(locale);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const dialog = settings(page);
    await expect(dialog).toHaveAccessibleName(t("Appearance & editor"));
    for (const mode of ["light", "dark"] as const) {
      await dialog.getByRole("tab").nth(1).click();
      await dialog
        .locator(".demo-mode-switch button")
        .nth(mode === "light" ? 0 : 1)
        .click();
      const size = dialog.getByRole("spinbutton", {
        name: t("{label} value", { label: t("Interface font size") }),
        exact: true,
      });
      await size.fill("20");
      await size.press("Tab");
      await dialog.getByRole("tab").nth(6).click();
      await expect(dialog.getByRole("tabpanel")).toContainText(
        t("Configure document navigation and position indicators."),
      );
      await expect(
        dialog.getByRole("button", {
          name: t("Reset {category} settings", { category: t("Minimap") }),
          exact: true,
        }),
      ).toBeVisible();
      const side = dialog.getByRole("combobox", {
        name: t("Minimap side"),
        exact: true,
      });
      await expect(side.locator('option[value="right"]')).toHaveText(
        t("Right"),
      );
      await side.selectOption("left");
      await expect(side).toHaveValue("left");
      const rendering = dialog.getByRole("combobox", {
        name: t("Minimap rendering"),
        exact: true,
      });
      await expect(rendering.locator('option[value="text"]')).toHaveText(
        t("Miniature text"),
      );
      await rendering.selectOption("blocks");
      await expect(rendering).toHaveValue("blocks");
      await expect(
        dialog.getByRole("switch", {
          name: t("Show search results in minimap"),
          exact: true,
        }),
      ).toBeVisible();
      await side.focus();
      await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
      expect(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
      const fields = dialog.locator(".demo-settings-fields");
      expect(
        await fields.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      const footer = dialog.locator(".dialog-footer");
      await expect(footer.getByRole("status")).toHaveText(
        t("Saved on this device"),
      );
      await expect(footer).toBeInViewport();
      const bounds = (await footer.boundingBox())!;
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(901);
      await page.screenshot({
        path: info.outputPath(`showcase-minimap-${locale}-${mode}-large.png`),
      });
      await dialog.getByRole("tab").nth(4).click();
      const indentation = dialog.getByRole("combobox", {
        name: t("Indentation"),
        exact: true,
      });
      await indentation.selectOption("8");
      await expect(indentation).toHaveValue("8");
      await expect(indentation.locator('option[value="8"]')).toHaveText(
        t("{count, number} spaces", { count: 8 }),
      );
      await expect(
        dialog.getByRole("switch", {
          name: t("Wrap code blocks"),
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("switch", {
          name: t("Navigate cells with Tab"),
          exact: true,
        }),
      ).toBeVisible();
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(page.url()).toBe(url);
      expect(await savedSource(page)).toBe(source);
    }
    await page.emulateMedia({ forcedColors: "active" });
    await page.screenshot({
      path: info.outputPath(`showcase-reading-${locale}-forced-colors.png`),
    });
    expect(errors).toEqual([]);
  });
}
