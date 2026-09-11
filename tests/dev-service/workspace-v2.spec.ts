import { test, expect, type BrowserContext } from "@playwright/test";
import { signInOwner } from "../e2e/auth";

let cookies: Awaited<ReturnType<BrowserContext["cookies"]>>;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:8080",
  });
  try {
    expect(
      (await signInOwner(context.request, "http://localhost:8080")).ok(),
    ).toBe(true);
    cookies = await context.cookies();
  } finally {
    await context.close();
  }
});
test.beforeEach(async ({ context, page }) => {
  await context.addCookies(cookies);
  await page.route("**/api/v1/**", async (route) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      await route.abort("blockedbyclient");
      throw new Error("Workspace visual acceptance must not change live data.");
    }
    await route.continue();
  });
});

test("8080 shows the current workspace tabs, group hub and file toolbar", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/workbench/groups");
  await expect(
    page.getByRole("heading", { name: "Your groups" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Join with invitation" }),
  ).toBeVisible();
  await expect(page.locator(".ws-app-nav,.ws-document-tabs")).toHaveCount(0);
  const appbar = page.getByRole("banner");
  await expect(
    appbar.getByRole("button", { name: "Create", exact: true }),
  ).toHaveCount(0);
  await expect(
    appbar.getByRole("button", { name: "Search workspace", exact: true }),
  ).toBeVisible();
  await expect(
    appbar.getByRole("button", { name: "File transfers", exact: true }),
  ).toBeVisible();
  const session = await (await page.request.get("/api/v1/me")).json(),
    avatar = appbar.locator(".ws-account-avatar");
  await expect(avatar).toBeVisible();
  if (session.user.image?.startsWith("/api/v1/people/")) {
    await expect(avatar.locator("img")).toHaveAttribute(
      "src",
      session.user.image,
    );
    await expect
      .poll(() =>
        avatar
          .locator("img")
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
  } else {
    await expect(avatar.locator("img")).toHaveCount(0);
    await expect(avatar).not.toBeEmpty();
  }
  await page.screenshot({ path: info.outputPath("workspace-groups-tabs.png") });
  await page.getByRole("button", { name: "New application tab" }).click();
  await page
    .getByRole("button", { name: /Explorer Notes, folders and files/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Upload folder", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".ws-explorer-main .ws-page-heading summary"),
  ).toHaveText("New");
  await expect(
    page.getByRole("button", { name: "Choose file columns" }),
  ).toBeVisible();
  await expect(
    page.getByText("Loading files and notes…", { exact: true }),
  ).not.toBeVisible();
  await expect(page.locator(".ws-list-footer")).not.toContainText("Refreshing");
  await expect(
    page.getByRole("region", { name: "Selection actions", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Search files and notes" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("workspace-explorer-toolbar.png"),
  });
  expect(errors).toEqual([]);
});

test("8080 previews all six coordinated theme families without saving", async ({
  page,
}, info) => {
  const before = await (
    await page.request.get("/api/v1/me/preferences-bundle")
  ).text();
  await page.goto("/workbench/settings/theme");
  await expect(page.locator(".theme-family-card")).toHaveCount(6);
  for (const family of [
    "Neutral",
    "Zinc",
    "Stone",
    "Material Indigo",
    "Material Sage",
    "Material Teal",
  ]) {
    const button = page.getByRole("button", {
      name: `Use ${family} theme family`,
      exact: true,
    });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    for (const mode of ["light", "dark"]) {
      await page.getByLabel("Color mode", { exact: true }).selectOption(mode);
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await button.scrollIntoViewIfNeeded();
      await page.screenshot({
        animations: "disabled",
        path: info.outputPath(
          `theme-${family.toLowerCase().replaceAll(" ", "-")}-${mode}.png`,
        ),
      });
    }
  }
  await page.getByText("Advanced appearance", { exact: true }).click();
  await page
    .getByLabel("Navigation surfaces", { exact: true })
    .selectOption("solid");
  await expect(page.locator(".ws-appbar")).toHaveCSS("backdrop-filter", "none");
  expect(
    await (await page.request.get("/api/v1/me/preferences-bundle")).text(),
  ).toBe(before);
});

test("close all tabs includes pinned tabs and retains reopen history after reload", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workbench/groups");
  const tabs = page.getByRole("tablist", { name: "Application tabs" });
  await tabs.getByRole("tab", { name: "Groups", exact: true }).click({
    button: "right",
  });
  await page.getByRole("menuitem", { name: "Pin tab", exact: true }).click();
  for (const destination of [
    /Home Recent work and your day/,
    /People Your collaborators/,
  ]) {
    await page.getByRole("button", { name: "New application tab" }).click();
    await page.getByRole("button", { name: destination }).click();
  }
  await expect(tabs.getByRole("tab")).toHaveCount(4);
  // Invoke from a background pinned tab; the active page reopens first.
  await tabs.getByRole("tab", { name: "Groups", exact: true }).click({
    button: "right",
  });
  await expect(
    page.getByRole("menuitem", { name: "Close all tabs", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("close-all-tabs-menu.png") });
  await page
    .getByRole("menuitem", { name: "Close all tabs", exact: true })
    .click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(tabs.getByRole("tab")).toHaveCount(1);
  await expect(
    tabs.getByRole("tab", { name: "New tab", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\/workbench\/new$/);
  await page.reload();
  await expect(tabs.getByRole("tab")).toHaveCount(1);
  await tabs
    .getByRole("tab", { name: "New tab", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Reopen closed tab", exact: true })
    .click();
  await expect(
    tabs.getByRole("tab", { name: "People", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+Alt+Shift+t");
  await expect(
    tabs.getByRole("tab", { name: "Home", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+Alt+Shift+t");
  await expect(tabs.locator('[role="tab"][aria-selected="true"]')).toHaveText(
    "New tab",
  );
  await page.keyboard.press("ControlOrMeta+Alt+Shift+t");
  await expect(
    tabs
      .locator(".application-tab.pinned")
      .getByRole("tab", { name: "Groups", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tab")).toHaveCount(5);
  expect(errors).toEqual([]);
});

test("close all tabs confirms retained settings drafts before closing any tabs", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workbench/settings/profile");
  const affiliation = page.getByLabel("Institution or affiliation"),
    tabs = page.getByRole("tablist", { name: "Application tabs" });
  await expect(affiliation).toBeVisible();
  const original = await affiliation.inputValue();
  await affiliation.fill("Unsaved close-all verification draft");
  await page.getByRole("button", { name: "New application tab" }).click();
  await page.getByRole("button", { name: /Groups Create, join/ }).click();
  await tabs
    .getByRole("tab", { name: "Groups", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close all tabs", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Keep your unsaved settings?",
  });
  await expect(dialog).toBeVisible();
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  await page.screenshot({
    path: info.outputPath("close-all-unsaved-settings.png"),
  });
  await dialog.getByRole("button", { name: "Stay in settings" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(affiliation).toHaveValue("Unsaved close-all verification draft");
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  await tabs
    .getByRole("tab", { name: "Settings", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close all tabs", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(tabs.getByRole("tab")).toHaveCount(1);
  await expect(page).toHaveURL(/\/workbench\/new$/);
  await page.keyboard.press("ControlOrMeta+Alt+Shift+t");
  await expect(affiliation).toHaveValue(original);
  expect(errors).toEqual([]);
});

test("close all tabs waits for navigation guards and keeps tabs opened after the request", async ({
  page,
}) => {
  await page.goto("/workbench/groups");
  const tabs = page.getByRole("tablist", { name: "Application tabs" });
  await expect(
    tabs.getByRole("tab", { name: "Groups", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.addEventListener(
      "axiom:before-navigate",
      (event) => {
        event.preventDefault();
        const { proceed } = (event as CustomEvent<{ proceed: () => void }>)
          .detail;
        window.addEventListener("test:confirm-close-all", proceed, {
          once: true,
        });
      },
      { once: true },
    );
  });
  await tabs
    .getByRole("tab", { name: "Groups", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close all tabs", exact: true })
    .click();
  await expect(
    tabs.getByRole("tab", { name: "Groups", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/workbench\/groups$/);
  await page.getByRole("button", { name: "New application tab" }).click();
  const newTabId = await tabs
    .locator(".application-tab.active")
    .getAttribute("data-tab-id");
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("test:confirm-close-all")),
  );
  await expect(tabs.getByRole("tab")).toHaveCount(1);
  await expect(tabs.locator(".application-tab.active")).toHaveAttribute(
    "data-tab-id",
    newTabId!,
  );
});

test("8080 action menus use visible icons and dividers across tabs, workspaces and Explorer", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const checkMenu = async (name: string, sections: boolean) => {
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const items = menu.locator('button[role^="menuitem"]');
    expect(await items.count()).toBeGreaterThan(0);
    for (const item of await items.all()) {
      await expect(item.locator(":scope > svg.action-icon")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      await expect(item.locator(":scope > .action-label")).not.toBeEmpty();
    }
    if (sections)
      expect(await menu.getByRole("separator").count()).toBeGreaterThan(0);
    await expect(
      menu.locator(
        '[role="separator"]:first-child,[role="separator"]:last-child,[role="separator"] + [role="separator"]',
      ),
    ).toHaveCount(0);
    const box = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
    expect(box!.y + box!.height).toBeLessThanOrEqual(1000);
    await page.screenshot({
      path: info.outputPath(name + ".png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  };
  await page.goto("/workbench/groups");
  await page
    .getByRole("tab", { name: "Groups", exact: true })
    .click({ button: "right" });
  await checkMenu("tabs-icons-dividers", true);
  await page
    .getByRole("list", { name: "Spaces and folders" })
    .getByRole("link")
    .first()
    .click({ button: "right" });
  await checkMenu("workspace-icons-dividers", true);
  await page.goto("/workbench/explorer");
  await page.getByRole("button", { name: "Choose file columns" }).click();
  await checkMenu("explorer-column-icons", false);
  const items = page.getByLabel("Explorer items", { exact: true });
  await items.click({ button: "right", position: { x: 4, y: 4 } });
  await checkMenu("explorer-background-icons", true);
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--size-ui", "24px"),
  );
  await page
    .getByRole("list", { name: "Spaces and folders" })
    .getByRole("link")
    .first()
    .click({ button: "right" });
  await checkMenu("workspace-menu-large-text", true);
  await page.evaluate(() =>
    document.documentElement.style.removeProperty("--size-ui"),
  );
  const account = page.locator(".ws-account-menu");
  await account.locator("summary").click();
  await expect(account.getByRole("separator")).toHaveCount(1);
  for (const item of await account.locator("div > a,div > button").all())
    await expect(item.locator(":scope > svg")).toBeVisible();
  await page.screenshot({ path: info.outputPath("account-icons-divider.png") });
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});
