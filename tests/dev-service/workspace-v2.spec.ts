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

test("8080 shows the unified toolbar, group hub and file toolbar", async ({
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
  await page.getByRole("button", { name: "Search workspace" }).click();
  await page.getByLabel("Global search").fill("> Explorer");
  await page
    .getByRole("group", { name: "Commands", exact: true })
    .getByRole("option")
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

test("recent-work navigation retains unsaved settings without saving to live data", async ({
  page,
}) => {
  await page.goto("/workbench/settings/profile");
  const affiliation = page.getByLabel("Institution or affiliation");
  await affiliation.fill("Unsaved recent-work verification draft");
  await page
    .getByRole("banner")
    .getByRole("link", { name: "Open inbox" })
    .click();
  await expect(page).toHaveURL(/\/inbox$/);
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(affiliation).toHaveValue(
    "Unsaved recent-work verification draft",
  );
  await page.getByRole("button", { name: "Recent work", exact: true }).click();
  const recent = page.getByRole("region", { name: "Recent work switcher" });
  await recent.getByRole("button", { name: "Pin Inbox", exact: true }).click();
  await expect(
    recent.getByRole("region", { name: "Pinned work" }),
  ).toContainText("Inbox");
  await page.keyboard.press("Escape");
  await expect(recent).not.toBeVisible();
});

test("8080 action menus use visible icons and dividers across workspaces and Explorer", async ({
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
