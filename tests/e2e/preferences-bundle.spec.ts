import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInOwner } from "./auth";
const origin =
  process.env.TEST_APP_URL || process.env.APP_URL || "http://localhost:8080";
let ownerState: Awaited<ReturnType<BrowserContext["storageState"]>>;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: origin });
  const login = await signInOwner(context.request, origin);
  expect(login.ok(), await login.text()).toBeTruthy();
  ownerState = await context.storageState();
  await context.close();
});
test.beforeEach(async ({ context }) => {
  await context.addCookies(ownerState.cookies);
});
async function read(context: BrowserContext) {
  return (
    await context.request.get("/api/v1/me/preferences-bundle", {
      headers: { "X-Axiom-Appearance-Schema": "5" },
    })
  ).json();
}
async function patch(
  context: BrowserContext,
  bundle: any,
  mutationId = randomUUID(),
) {
  return context.request.patch("/api/v1/me/preferences-bundle", {
    headers: { origin },
    data: {
      appearance: {
        preferences: bundle.appearance.preferences,
        version: bundle.appearance.version,
      },
      editor: bundle.editor,
      mutationId,
    },
  });
}
test("preference bundle is atomic, idempotent and rejects stale writers", async ({
  context,
}) => {
  const original = await read(context),
    input = structuredClone(original),
    id = randomUUID();
  input.appearance.preferences.proseSize = 23;
  input.editor.preferences.defaultCodeLanguage = "julia";
  const first = await patch(context, input, id);
  expect(first.ok(), await first.text()).toBeTruthy();
  const saved = await first.json();
  expect(await (await patch(context, input, id)).json()).toMatchObject(saved);
  const stale = structuredClone(saved);
  stale.editor.version = input.editor.version;
  stale.appearance.preferences.proseSize = 29;
  expect((await patch(context, stale)).status()).toBe(409);
  expect(await read(context)).toEqual(saved);
  const old = await context.request.patch("/api/v1/me/editor-preferences", {
    headers: { origin },
    data: {
      preferences: { schemaVersion: 1 },
      version: saved.editor.version,
      mutationId: randomUUID(),
    },
  });
  expect(old.status()).toBe(426);
  expect(
    (
      await patch(context, {
        appearance: {
          ...saved.appearance,
          preferences: original.appearance.preferences,
        },
        editor: { ...saved.editor, preferences: original.editor.preferences },
      })
    ).ok(),
  ).toBeTruthy();
});
test("routed settings retain drafts, apply together and cancel live previews", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/workbench/settings/typography");
  await expect(
    page.getByRole("heading", { name: "Typography", exact: true }),
  ).toBeVisible();
  const original = await read(context);
  await page.getByLabel("Note font size value", { exact: true }).fill("25");
  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("link", { name: "Code", exact: true })
    .click();
  await page.getByLabel("Default code language", { exact: true }).fill("julia");
  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("link", { name: "Typography", exact: true })
    .click();
  await expect(
    page.getByLabel("Note font size value", { exact: true }),
  ).toHaveValue("25");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByLabel("Appearance synchronization")).toContainText(
    "synced to your account",
  );
  expect(page.url()).toContain("/settings/typography");
  const applied = await read(context);
  expect(applied.appearance.preferences.proseSize).toBe(25);
  expect(applied.editor.preferences.defaultCodeLanguage).toBe("julia");
  await page.getByLabel("Note font size value", { exact: true }).fill("28");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByLabel("Note font size value", { exact: true }),
  ).toHaveValue("25");
  await page.getByLabel("Note font size value", { exact: true }).fill("26");
  await page
    .getByRole("navigation", { name: "App navigation" })
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Stay in settings" }).click();
  await expect(
    page.getByLabel("Note font size value", { exact: true }),
  ).toHaveValue("26");
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/workbench\/home/);
  expect(errors).toEqual([]);
  const latest = await read(context);
  await patch(context, {
    appearance: {
      ...latest.appearance,
      preferences: original.appearance.preferences,
    },
    editor: { ...latest.editor, preferences: original.editor.preferences },
  });
});

test("settings categories stay usable at narrow widths and retain keyboard focus", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workbench/settings/code");
  await expect(page.getByLabel("Code settings preview")).toBeVisible();
  const footerFits = async () => {
    for (const name of ["Apply", "Cancel", "Reset all", "Reset section"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(
        page.viewportSize()!.height,
      );
    }
  };
  await footerFits();
  expect(
    await page
      .getByLabel("Smart code indentation", { exact: true })
      .evaluate((el) => {
        const control = el.getBoundingClientRect(),
          label = el.closest("label")!.getBoundingClientRect();
        return control.left > label.left + label.width * 0.8;
      }),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/refinement-settings-code.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 760 });
  for (const category of [
    "theme",
    "typography",
    "layout",
    "writing",
    "tables",
    "math",
    "shortcuts",
  ]) {
    await page.goto(`/workbench/settings/${category}`);
    await expect(page.locator(".settings-routed")).toBeVisible();
    await footerFits();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBeTruthy();
  }
  await page.screenshot({
    path: "test-results/refinement-settings-mobile.png",
    fullPage: true,
  });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Apply", exact: true }).focus();
  await expect(
    page.getByRole("button", { name: "Apply", exact: true }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});

test("unavailable device storage leaves the preference draft unapplied", async ({
  page,
  context,
}) => {
  const original = await read(context);
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("axiom:preferences-bundle:"))
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return write.call(this, key, value);
    };
  });
  await page.goto("/workbench/settings/typography");
  await page.getByLabel("Note font size value", { exact: true }).fill("27");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByLabel("Appearance synchronization")).toContainText(
    "Device storage is unavailable",
  );
  expect(await read(context)).toEqual(original);
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await expect(
    page.getByRole("button", { name: "Stay in settings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stay in settings" }).click();
  await expect(
    page.getByLabel("Note font size value", { exact: true }),
  ).toHaveValue("27");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("two offline settings windows converge without an outbox feedback loop", async ({
  page,
  context,
}) => {
  const original = await read(context),
    other = await context.newPage();
  try {
    await page.goto("/workbench/settings/typography");
    await other.goto("/workbench/settings/code");
    await expect(page.getByLabel("Appearance synchronization")).toContainText(
      "synced",
    );
    await expect(other.getByLabel("Appearance synchronization")).toContainText(
      "synced",
    );
    await context.route("**/api/v1/me/preferences-bundle", (route) =>
      route.abort(),
    );
    await other.evaluate(() => {
      (window as any).preferenceEvents = 0;
      window.addEventListener("storage", (event) => {
        if (event.key?.startsWith("axiom:preferences-bundle:"))
          (window as any).preferenceEvents++;
      });
    });
    await page.getByLabel("Note font size value", { exact: true }).fill("26");
    await other
      .getByLabel("Default code language", { exact: true })
      .fill("julia");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await other.getByRole("button", { name: "Apply", exact: true }).click();
    await page.waitForTimeout(400); // Observe the event loop, not network settling.
    expect(
      await other.evaluate(() => (window as any).preferenceEvents),
    ).toBeLessThan(12);
    await context.unroute("**/api/v1/me/preferences-bundle");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await other.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect
      .poll(
        async () => {
          const result = await read(context);
          return [
            result.appearance.preferences.proseSize,
            result.editor.preferences.defaultCodeLanguage,
          ];
        },
        { timeout: 20000 },
      )
      .toEqual([26, "julia"]);
  } finally {
    await context.unroute("**/api/v1/me/preferences-bundle");
    await other.close();
    const latest = await read(context);
    await patch(context, {
      appearance: {
        ...latest.appearance,
        preferences: original.appearance.preferences,
      },
      editor: { ...latest.editor, preferences: original.editor.preferences },
    });
  }
});
