import { test, expect } from "@playwright/test";
import { fixture } from "./native-editor-helpers";

test("account choices dismiss the dropdown even when the destination is already selected", async ({
  browser,
}) => {
  const f = await fixture(browser, "Account navigation preserves this note.");
  try {
    const menu = f.page.locator(".ws-account-menu");
    const trigger = menu.locator("summary");
    for (const [label, path] of [
      ["Account settings", "profile"],
      ["Account settings", "profile"],
      ["Appearance & editor", "appearance"],
      ["Appearance & editor", "appearance"],
    ]) {
      await trigger.click();
      await expect(menu).toHaveJSProperty("open", true);
      await menu.getByRole("link", { name: label, exact: true }).click();
      await expect(f.page).toHaveURL(
        new RegExp(`/workbench/settings/${path}$`),
      );
      await expect(menu).toHaveJSProperty("open", false);
      await expect(
        menu.getByRole("link", { name: label, exact: true }),
      ).toBeHidden();
    }
    await trigger.click();
    await expect(menu).toHaveJSProperty("open", true);
    await trigger.click();
    await expect(menu).toHaveJSProperty("open", false);
    expect(await f.source()).toBe("Account navigation preserves this note.");
  } finally {
    await f.close();
  }
});

test("account dropdown dismisses outside, on Escape and when keyboard focus leaves", async ({
  browser,
  browserName,
}) => {
  const f = await fixture(browser, "Dismissing menus preserves this note.");
  // macOS WebKit uses Option+Tab to include links with its default keyboard
  // settings: https://support.apple.com/en-gb/guide/safari/cpsh003/mac
  const tab =
    browserName === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab";
  try {
    await f.page.goto("/workbench/explorer");
    const menu = f.page.locator(".ws-account-menu");
    const trigger = menu.locator("summary");
    await trigger.click();
    // Plain content clicks must dismiss without requiring a focusable target.
    await f.page.locator(".ws-page-heading h1").click();
    await expect(menu).toHaveJSProperty("open", false);
    await trigger.click();
    // The outside action must still work on the first click.
    await f.page
      .getByRole("button", { name: "Search workspace", exact: true })
      .click();
    await expect(menu).toHaveJSProperty("open", false);
    await expect(
      f.page.getByRole("dialog", { name: "Search & commands" }),
    ).toBeVisible();
    await f.page.keyboard.press("Escape");
    // Start a new interaction as soon as the native dialog closes; delayed
    // React cleanup must not steal focus back from the account dropdown.
    await expect(
      f.page.getByRole("dialog", { name: "Search & commands" }),
    ).toBeHidden();
    await trigger.focus();
    await f.page.keyboard.press("Enter");
    await expect(menu).toHaveJSProperty("open", true);
    await f.page.keyboard.press(tab);
    await expect(
      menu.getByRole("link", { name: "Account settings", exact: true }),
    ).toBeFocused();
    await f.page.keyboard.press("Escape");
    await expect(menu).toHaveJSProperty("open", false);
    await expect(trigger).toBeFocused();
    await f.page.keyboard.press("Enter");
    await expect(menu).toHaveJSProperty("open", true);
    await f.page.keyboard.press(tab);
    await expect(
      menu.getByRole("link", { name: "Account settings", exact: true }),
    ).toBeFocused();
    await f.page.keyboard.press("Enter");
    await expect(f.page).toHaveURL(/\/workbench\/settings\/profile$/);
    await expect(menu).toHaveJSProperty("open", false);
    await trigger.click();
    await menu.getByRole("button", { name: "Sign out", exact: true }).focus();
    await f.page.keyboard.press(tab);
    await expect(menu).toHaveJSProperty("open", false);
    await expect(trigger).not.toBeFocused();
    expect(await f.source()).toBe("Dismissing menus preserves this note.");
  } finally {
    await f.close();
  }
});

test("sign-out confirmation closes the account menu and returns focus on cancellation", async ({
  browser,
}) => {
  const f = await fixture(browser, "Opening confirmation does not sign out.");
  try {
    const menu = f.page.locator(".ws-account-menu");
    const trigger = menu.locator("summary");
    await trigger.click();
    await menu.getByRole("button", { name: "Sign out", exact: true }).click();
    const dialog = f.page.getByRole("dialog", {
      name: "Sign out of this device?",
    });
    await expect(dialog).toBeVisible();
    await expect(menu).toHaveJSProperty("open", false);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await f.source()).toBe("Opening confirmation does not sign out.");
  } finally {
    await f.close();
  }
});

test("workspace management and browser history dismiss an open account dropdown", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    "Administration navigation preserves notes.",
  );
  try {
    const page = await f.owner.newPage();
    await page.goto("/workbench/home");
    const menu = page.locator(".ws-account-menu");
    const trigger = menu.locator("summary");
    await trigger.click();
    await menu
      .getByRole("link", { name: "Manage workspaces", exact: true })
      .click();
    await expect(page).toHaveURL(/\/workbench\/workspaces$/);
    await expect(menu).toHaveJSProperty("open", false);
    await trigger.click();
    await page.goBack();
    await expect(page).toHaveURL(/\/workbench\/home$/);
    await expect(menu).toHaveJSProperty("open", false);
    expect(await f.source()).toBe("Administration navigation preserves notes.");
  } finally {
    await f.close();
  }
});
