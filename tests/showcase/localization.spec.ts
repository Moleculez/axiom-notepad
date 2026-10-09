import { test, expect, type Page } from "@playwright/test";
import { locales } from "../../packages/i18n/src/locales";

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

test("all ten languages, automatic matching and recovery names are available", async ({
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
  await expect(language.locator("option")).toHaveCount(11);
  for (const locale of locales) {
    await language.selectOption(locale.id);
    await expect(page.locator("html")).toHaveAttribute("lang", locale.id);
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
  await language.selectOption("ar");
  expect(
    await settings(page)
      .locator(".reading-view")
      .evaluate((element) => getComputedStyle(element).direction),
  ).toBe("ltr");
  await page.screenshot({ path: info.outputPath("language-arabic-light.png") });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
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
  const context = await browser.newContext({ locale: "de-DE" });
  const fallback = await context.newPage();
  await fallback.goto("http://127.0.0.1:3010/axiom-notepad/#editor");
  await expect(fallback.locator("html")).toHaveAttribute("lang", "en");
  await context.close();
  await page.goto(`./#editor&note=${note}`);
  await expect(page.locator(".axiom-editor")).toBeVisible();
  const language = await openLanguage(page);
  await page.route("**/locales/es.json*", (route) => route.abort());
  await language.selectOption("es");
  await expect(settings(page).getByRole("alert")).toBeVisible();
  await expect(language).toHaveValue("auto");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull();
  await language.selectOption("fr");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});

test("Arabic controls remain usable in dark mode, large text and accessibility modes", async ({
  page,
  browserName,
}, info) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(({ key }) => localStorage.setItem(key, "ar"), {
    key,
  });
  await page.goto(`./#editor&note=${note}`);
  await expect(page.locator(".axiom-editor")).toBeVisible();
  const language = await openLanguage(page);
  await expect(language).toHaveValue("ar");
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
    path: info.outputPath("language-arabic-dark-large.png"),
  });
  await page.emulateMedia({ forcedColors: "active" });
  await settings(page).getByRole("tab").first().click();
  await expect(language).toBeVisible();
  await page.screenshot({
    path: info.outputPath("language-arabic-forced-colors.png"),
  });
});

test("localized table scopes and destructive dialog focus use stable identities", async ({
  page,
}) => {
  await page.addInitScript(({ key }) => localStorage.setItem(key, "ar"), {
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
