import { test, expect } from "@playwright/test";
import { fixture, origin } from "./native-editor-helpers";

test.beforeAll(() => {
  if (origin !== "http://localhost:3002")
    throw new Error("Use the isolated settings candidate, not live accounts.");
});

test("split panels have independent scrolling, pointer and keyboard sizing, and persistent preview contents", async ({
  browser,
}, info) => {
  const f = await fixture(browser, "Unchanged research.");
  try {
    await f.page.goto("/workbench/settings/typography");
    const fields = f.page.getByLabel("Settings fields", { exact: true }),
      preview = f.page.getByLabel("Appearance settings preview", {
        exact: true,
      }),
      separator = f.page.getByRole("separator", {
        name: "Resize settings and preview",
      });
    const first = (await preview.boundingBox())!;
    await fields.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect((await preview.boundingBox())!.y).toBe(first.y);
    expect(await fields.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    await expect(
      f.page.getByRole("button", { name: "Apply", exact: true }),
    ).toBeInViewport();
    const handle = (await separator.boundingBox())!;
    await f.page.mouse.move(handle.x + handle.width / 2, handle.y + 80);
    await f.page.mouse.down();
    await f.page.mouse.move(handle.x + 100, handle.y + 80);
    await f.page.mouse.up();
    expect(
      Number(await separator.getAttribute("aria-valuenow")),
    ).toBeGreaterThan(44);
    await separator.press("Home");
    await expect(separator).toHaveAttribute("aria-valuenow", "32");
    await separator.press("End");
    await expect(separator).toHaveAttribute("aria-valuenow", "64");
    await separator.press("Enter");
    await expect(separator).toHaveAttribute("aria-valuenow", "44");
    await preview.getByRole("button", { name: "Source", exact: true }).click();
    await preview.locator(".cm-content").click();
    await f.page.keyboard.press("ControlOrMeta+a");
    await f.page.keyboard.insertText(
      "# An unsaved experiment\n\n**Keep** the scratch work.",
    );
    await f.page.getByRole("button", { name: "Hide live preview" }).click();
    await expect(preview).not.toBeVisible();
    await f.page.getByRole("button", { name: "Show live preview" }).click();
    await expect(preview.locator(".cm-content")).toContainText(
      "An unsaved experiment",
    );
    await f.page
      .getByRole("navigation", { name: "Settings categories" })
      .getByRole("link", { name: "Theme", exact: true })
      .click();
    await expect(preview.locator(".cm-content")).toContainText(
      "An unsaved experiment",
    );
    await preview.getByRole("button", { name: "Read", exact: true }).click();
    await expect(
      preview.locator("strong").filter({ hasText: "Keep" }),
    ).toHaveCount(1);
    await f.page.setViewportSize({ width: 1280, height: 800 });
    expect((await preview.boundingBox())!.x).toBeGreaterThan(
      (await fields.boundingBox())!.x + (await fields.boundingBox())!.width,
    );
    await f.page.screenshot({
      path: info.outputPath("settings-split-desktop.png"),
    });
    await f.page.setViewportSize({ width: 1024, height: 800 });
    await separator.press("End");
    expect(
      await f.page
        .locator(".settings-split")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
    ).toBe(true);
    expect(await f.source()).toBe("Unchanged research.");
  } finally {
    await f.close();
  }
});

test("field and category searches recover cleanly; shortcut filters, recording focus and resets remain usable", async ({
  browser,
}) => {
  const f = await fixture(browser, "Unchanged research.");
  try {
    await f.page.goto("/workbench/settings/typography");
    await f.page
      .getByLabel("Find settings category", { exact: true })
      .fill("not-a-setting");
    await expect(
      f.page.getByText("No matching categories.", { exact: false }),
    ).toBeVisible();
    await f.page.getByRole("button", { name: "Clear category search" }).click();
    await f.page
      .getByLabel("Search settings", { exact: true })
      .fill("not-a-setting");
    await expect(
      f.page.getByRole("heading", { name: "No matching settings" }),
    ).toBeVisible();
    await f.page.getByRole("button", { name: "Clear settings search" }).click();
    await f.page
      .getByRole("navigation", { name: "Settings categories" })
      .getByRole("link", { name: "Keyboard shortcuts", exact: true })
      .click();
    await expect(
      f.page.getByLabel("Live settings preview", { exact: true }),
    ).toHaveCount(0);
    await f.page.getByLabel("Customized only", { exact: true }).check();
    await expect(
      f.page.getByRole("heading", { name: "No customized shortcuts" }),
    ).toBeVisible();
    await f.page.getByRole("button", { name: "Show all commands" }).click();
    const change = f.page.getByRole("button", {
      name: "Change shortcut for Bold",
      exact: true,
    });
    await change.click();
    await expect(
      f.page.getByRole("group", { name: "Record keyboard shortcut" }),
    ).toBeFocused();
    await f.page.keyboard.press("Escape");
    await expect(change).toBeFocused();
    await f.page
      .getByRole("button", { name: "Disable shortcut for Bold", exact: true })
      .click();
    await f.page.getByLabel("Customized only", { exact: true }).check();
    await expect(f.page.locator(".shortcut-row")).toHaveCount(1);
    await f.page
      .getByRole("button", { name: "Reset shortcut for Bold", exact: true })
      .click();
    await expect(
      f.page.getByLabel("Search shortcuts", { exact: true }),
    ).toBeFocused();
    await expect(
      f.page.getByRole("heading", { name: "No customized shortcuts" }),
    ).toBeVisible();
  } finally {
    await f.close();
  }
});

test("profile drafts cancel, validate links, save and retain later input on a failed request", async ({
  browser,
}) => {
  const f = await fixture(browser, "Unchanged research.");
  try {
    await f.page.goto("/workbench/settings/typography");
    await f.page.getByLabel("Note font size value", { exact: true }).fill("24");
    await f.page
      .getByRole("navigation", { name: "Settings categories" })
      .getByRole("link", { name: "Profile", exact: true })
      .click();
    const pending = f.page.getByRole("region", {
      name: "Pending appearance and writing changes",
    });
    await expect(pending).toBeVisible();
    const name = f.page.getByLabel("Full name", { exact: true }),
      save = f.page.getByRole("button", { name: "Save profile", exact: true }),
      cancel = f.page.getByRole("button", {
        name: "Cancel changes",
        exact: true,
      });
    await expect(save).toBeDisabled();
    const original = await name.inputValue();
    await name.fill("Canceled identity");
    await cancel.click();
    await expect(name).toHaveValue(original);
    await expect(pending).toBeVisible();
    await f.page
      .getByRole("button", { name: "Discard preference changes", exact: true })
      .click();
    await expect(pending).toHaveCount(0);
    const links = f.page.getByLabel(
      "Research links (one per line, up to eight)",
      { exact: true },
    );
    await links.fill(
      Array.from(
        { length: 9 },
        (_, i) => `https://example.org/paper/${i}`,
      ).join("\n"),
    );
    await expect(links).toHaveAttribute("aria-invalid", "true");
    await expect(save).toBeDisabled();
    await cancel.click();
    await name.fill("Settings Researcher");
    await save.click();
    await expect(
      f.page.getByText("Profile saved.", { exact: true }),
    ).toBeVisible();
    await expect(save).toBeDisabled();
    await f.page.route("**/api/v1/me/profile", (route) =>
      route.request().method() === "PATCH" ? route.abort() : route.continue(),
    );
    await name.fill("Retryable identity");
    await save.click();
    await expect(save).toBeEnabled();
    await expect(name).toHaveValue("Retryable identity");
    await cancel.click();
    await expect(name).toHaveValue("Settings Researcher");
    await f.page.unroute("**/api/v1/me/profile");
    await f.page.reload();
    await expect(name).toHaveValue("Settings Researcher");
  } finally {
    await f.close();
  }
});

test("notification groups retain cancel and save behavior without changing other personal preferences", async ({
  browser,
}) => {
  const f = await fixture(browser, "Unchanged research.");
  try {
    const preferences = await (
      await f.member.request.get("/api/v1/me/preferences-bundle")
    ).text();
    await f.page.goto("/workbench/settings/notifications");
    const mentions = f.page.getByLabel("Mentions", { exact: true }),
      save = f.page.getByRole("button", {
        name: "Save preferences",
        exact: true,
      });
    await expect(save).toBeDisabled();
    const initial = await mentions.isChecked();
    await mentions.click();
    await f.page
      .getByRole("button", { name: "Cancel changes", exact: true })
      .click();
    expect(await mentions.isChecked()).toBe(initial);
    await mentions.click();
    await save.click();
    await expect(
      f.page.getByText("Notification preferences saved.", { exact: true }),
    ).toBeVisible();
    await expect(save).toBeDisabled();
    await f.page.reload();
    expect(await mentions.isChecked()).toBe(!initial);
    expect(
      await (
        await f.member.request.get("/api/v1/me/preferences-bundle")
      ).text(),
    ).toBe(preferences);
  } finally {
    await f.close();
  }
});
