import { test, expect, type APIRequestContext } from "@playwright/test";
import { signInOwner } from "./auth";
import type { LocaleRecord } from "../../packages/shared/src/locale-preferences";
import { readFile } from "node:fs/promises";
import { createTranslator, locales } from "../../packages/i18n/src/index";
import { IntlMessageFormat } from "intl-messageformat";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
const origin = "http://localhost:3004";
const endpoint = "/api/v1/me/locale";
async function record(request: APIRequestContext): Promise<LocaleRecord> {
  const response = await request.get(endpoint);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  return response.json();
}
async function setLocale(
  request: APIRequestContext,
  locale: LocaleRecord["locale"],
) {
  const current = await record(request);
  const response = await request.patch(endpoint, {
    headers: { origin },
    data: { locale, version: current.version, mutationId: crypto.randomUUID() },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<LocaleRecord>;
}
test.beforeEach(async ({ page }) => {
  expect((await signInOwner(page.request, origin)).status()).toBe(200);
  await setLocale(page.request, "en");
});
test.afterEach(async ({ page }) => {
  await setLocale(page.request, "en");
});

test("account language previews, cancels and saves without a route change", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workbench/settings/language");
  const panel = page.locator(".language-settings");
  const choice = panel.getByRole("combobox");
  await expect(choice).toBeEnabled();
  await expect(choice).toHaveValue("en");
  const before = await record(page.request),
    url = page.url();
  await choice.selectOption("zh-Hans");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  expect(await record(page.request)).toEqual(before);
  await panel.locator("footer button").first().click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(choice).toHaveValue("en");
  await choice.selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await panel.locator("footer button").last().click();
  await expect.poll(async () => (await record(page.request)).locale).toBe("ar");
  await expect(panel.locator("footer button").last()).toBeDisabled();
  expect(page.url()).toBe(url);
  await page.screenshot({
    path: info.outputPath("account-language-arabic.png"),
  });
  await page.reload();
  await expect(choice).toHaveValue("ar");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  expect(errors).toEqual([]);
});

test("real account writes have exact retry, validation and concurrent conflict semantics", async ({
  page,
}) => {
  const before = await record(page.request);
  const input = {
    locale: "es",
    version: before.version,
    mutationId: crypto.randomUUID(),
  };
  const first = await page.request.patch(endpoint, {
    headers: { origin },
    data: input,
  });
  expect(first.status()).toBe(200);
  const accepted = await first.json();
  const retry = await page.request.patch(endpoint, {
    headers: { origin },
    data: input,
  });
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toEqual(accepted);
  const concurrent = await Promise.all(
    ["fr", "id"].map((locale) =>
      page.request.patch(endpoint, {
        headers: { origin },
        data: {
          locale,
          version: accepted.version,
          mutationId: crypto.randomUUID(),
        },
      }),
    ),
  );
  expect(concurrent.map((response) => response.status()).sort()).toEqual([
    200, 409,
  ]);
  const conflict = await concurrent
    .find((response) => response.status() === 409)!
    .json();
  expect(conflict.code).toBe("locale_conflict");
  expect(conflict.current.version).toBe(accepted.version + 1);
  const invalid = await page.request.patch(endpoint, {
    headers: { origin },
    data: {
      locale: "ja",
      version: conflict.current.version,
      mutationId: crypto.randomUUID(),
    },
  });
  expect(invalid.status()).toBe(400);
  expect((await record(page.request)).version).toBe(conflict.current.version);
});

test("automatic Arabic sign-in keeps email and mathematics independent of chrome", async ({
  browser,
}, info) => {
  const context = await browser.newContext({ locale: "ar-SA" });
  const fresh = await context.newPage();
  const errors: string[] = [];
  fresh.on("pageerror", (error) => errors.push(error.message));
  try {
    await fresh.goto(`${origin}/workbench/home`);
    await expect(fresh.locator(".auth-layout")).toBeVisible();
    await expect(fresh.locator("html")).toHaveAttribute("lang", "ar");
    await expect(fresh.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(fresh.locator(".auth-form-card h2")).not.toHaveText(
      "Welcome back.",
    );
    const email = fresh.locator('.auth-form-card input[type="email"]');
    await expect(
      fresh.locator('.auth-form-card input[type="password"]'),
    ).not.toHaveAttribute("placeholder", "Enter your password");
    await email.fill("researcher@example.com");
    await expect(email).toHaveValue("researcher@example.com");
    for (const target of [email, fresh.locator(".auth-equation > div")])
      expect(
        await target.evaluate((node) => getComputedStyle(node).direction),
      ).toBe("ltr");
    await fresh.screenshot({
      path: info.outputPath("language-arabic-sign-in.png"),
    });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("translated profiles retain authored values across all ten languages", async ({
  page,
}) => {
  const response = await page.request.get("/api/v1/me/profile");
  expect(response.status()).toBe(200);
  const before = await response.json();
  for (const { id } of locales) {
    await setLocale(page.request, id);
    await page.goto("/workbench/settings/profile");
    await expect(page.locator("html")).toHaveAttribute("lang", id);
    const catalog = JSON.parse(
      await readFile(`packages/i18n/src/messages/${id}.json`, "utf8"),
    );
    const t = createTranslator(id, catalog);
    await expect(
      page.getByRole("heading", {
        name: t("Your researcher profile"),
        exact: true,
      }),
    ).toBeVisible();
    const form = page.locator(".ws-settings-form");
    await expect(
      form.getByRole("heading", { name: t("Research profile"), exact: true }),
    ).toBeVisible();
    await expect(form.getByLabel(t("Full name"), { exact: true })).toHaveValue(
      before.name,
    );
    await expect(
      form.getByLabel(t("Institution or affiliation"), { exact: true }),
    ).toHaveValue(before.affiliation);
    await expect(form.getByLabel(t("Biography"), { exact: true })).toHaveValue(
      before.biography,
    );
    // Engines may ship different CLDR defaults (for example Bengali digits).
    // Assert the entire message using the browser's actual numbering system,
    // without forcing Latin digits or weakening the count/translation check.
    const numberingSystem = await page.evaluate(
      (locale) =>
        new Intl.NumberFormat(locale).resolvedOptions().numberingSystem,
      id,
    );
    const linksCounter = new IntlMessageFormat(
      catalog["{used, number} / {limit, number} links"],
      `${id}-u-nu-${numberingSystem}`,
      undefined,
      { ignoreTag: true },
    );
    await expect(form).toContainText(
      String(linksCounter.format({ used: before.links.length, limit: 8 })),
    );
    const save = form.getByRole("button", {
      name: t("Save profile"),
      exact: true,
    });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeVisible();
    await expect(save).toBeDisabled();
  }
  expect(await (await page.request.get("/api/v1/me/profile")).json()).toEqual(
    before,
  );
});

test.describe("localized group dialog with read-only theme fixtures", () => {
  // Browser routing cannot override requests intercepted by a service worker.
  // Only this layout fixture blocks registration; the account flows above keep
  // their normal worker behavior. Offline acceptance belongs to its own gates.
  test.use({ serviceWorkers: "block" });

  test("Arabic group creation remains keyboard accessible at large text without creating a group", async ({
    page,
  }, info) => {
    await setLocale(page.request, "ar");
    const t = createTranslator(
      "ar",
      JSON.parse(await readFile("packages/i18n/src/messages/ar.json", "utf8")),
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1024, height: 900 });
    const bundleEndpoint = "/api/v1/me/preferences-bundle";
    const headers = { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) };
    const before = await (
      await page.request.get(bundleEndpoint, { headers })
    ).json();
    for (const mode of ["light", "dark"] as const) {
      // Exercise the real theme application without saving appearance changes.
      // The isolated account can have an explicit mode that overrides media.
      await page.route(`**${bundleEndpoint}`, async (route) => {
        expect(route.request().method()).toBe("GET");
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        const bundle = await response.json();
        bundle.appearance.preferences.mode = mode;
        bundle.appearance.preferences.uiSize = 20;
        await route.fulfill({ response, json: bundle });
      });
      await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
      await page.goto("/workbench/settings/groups");
      await expect(page.locator("html")).toHaveAttribute("lang", "ar");
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await expect(
        page.getByRole("heading", {
          name: t("Your research groups"),
          exact: true,
        }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator("html")
            .evaluate((root) =>
              getComputedStyle(root).getPropertyValue("--size-ui").trim(),
            ),
        )
        .toBe("1.25rem");
      await page
        .getByRole("button", { name: t("Create group"), exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: t("Create a research group"),
        exact: true,
      });
      await expect(dialog).toBeVisible();
      const name = dialog.getByLabel(t("Group name"), { exact: true });
      await expect(name).toBeFocused();
      await name.fill("Settings — مختبر α研究");
      await expect(name).toHaveValue("Settings — مختبر α研究");
      await expect(
        dialog.getByRole("button", { name: t("Create group"), exact: true }),
      ).toBeEnabled();
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1024);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`group-dialog-arabic-${mode}-large.png`),
      });
      await name.press("Escape");
      await expect(dialog).not.toBeVisible();
      await page.unroute(`**${bundleEndpoint}`);
    }
    expect(
      await (await page.request.get(bundleEndpoint, { headers })).json(),
    ).toEqual(before);
    expect(errors).toEqual([]);
  });
});
