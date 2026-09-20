import { test, expect, type Locator } from "@playwright/test";
import type { Resource, Space } from "@axiom/shared/workspace";
import { fixture, origin } from "./native-editor-helpers";

test("file, folder, workspace and Trash menus have semantic icons and separated sections", async ({
  browser,
}, info) => {
  // This acceptance creates disposable resources; never use the live dev data.
  expect(new URL(origin).port).toBe("3004");
  const f = await fixture(browser, "Menu presentation must not change notes.");
  const { page } = f;
  const api = async (path: string, data?: unknown) => {
    const response = await f.member.request.fetch(`/api/v1/${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: { origin },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const check = async (menu: Locator, screenshot: string) => {
    await expect(menu).toBeVisible();
    const items = menu.locator('button[role^="menuitem"]');
    expect(await items.count()).toBeGreaterThan(0);
    expect(await items.count()).toBeLessThanOrEqual(8);
    await expect(menu.locator(".editor-menu-group")).toHaveCount(0);
    for (const item of await items.all()) {
      await expect(item.locator(":scope > svg.action-icon")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      await expect(item.locator(":scope > .action-label")).not.toBeEmpty();
    }
    expect(await menu.getByRole("separator").count()).toBeGreaterThan(0);
    await expect(
      menu.locator(
        '[role="separator"]:first-child,[role="separator"]:last-child,[role="separator"] + [role="separator"]',
      ),
    ).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${screenshot}.png`) });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  };
  try {
    const spaces: Space[] = await api("spaces"),
      personal = spaces.find((space) => space.kind === "personal")!,
      team = spaces.find(
        (space) => space.kind === "team" && space.group_id === f.group.id,
      )!;
    const folder: Resource = await api("resources", {
      spaceId: personal.id,
      kind: "folder",
      name: "Menu acceptance folder",
    });
    await page.goto(`/workbench/explorer?space=${personal.id}`);
    await expect(
      page.getByRole("button", { name: "Upload", exact: true }),
    ).toBeVisible();
    await page
      .locator('.ws-page input[type="file"]:not([webkitdirectory])')
      .first()
      .setInputFiles({
        name: "menu-acceptance.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Disposable isolated menu acceptance fixture."),
      });
    let file: Resource | undefined;
    await expect
      .poll(async () => {
        file = (await api(`resources?spaceId=${personal.id}`)).items.find(
          (resource: Resource) => resource.name === "menu-acceptance.txt",
        );
        return !!file;
      })
      .toBe(true);
    const folderRow = page.locator(`[data-resource-id="${folder.id}"]`);
    await folderRow.click({ button: "right" });
    await check(page.getByRole("menu"), "folder-icons-dividers");
    await expect(folderRow).toBeFocused();
    const fileRow = page.locator(`[data-resource-id="${file!.id}"]`);
    await fileRow.click({ button: "right" });
    const rootMenu = page.getByRole("menu");
    await rootMenu
      .getByRole("menuitem", { name: "Details", exact: true })
      .focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page
        .getByRole("menuitem", { name: "Version history…", exact: true })
        .locator("svg"),
    ).toHaveAttribute("data-icon", "history");
    await expect(page.locator('[role="menu"][data-depth="1"]')).toBeVisible();
    await expect(page.locator('[role="menu"][data-depth="2"]')).toHaveCount(0);
    await page.keyboard.press("ArrowLeft");
    await check(page.getByRole("menu"), "file-icons-dividers");
    await expect(fileRow).toBeFocused();
    await page
      .getByRole("button", {
        name: `Workspace actions for ${team.name}`,
        exact: true,
      })
      .click();
    const menu = page.getByRole("menu");
    await menu.getByRole("menuitem", { name: "New", exact: true }).click();
    await expect(
      page
        .locator('[role="menu"][data-depth="1"]')
        .getByRole("menuitem", { name: "New note…", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[role="menu"][data-depth="1"] [aria-haspopup="menu"]'),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await check(menu, "team-workspace-icons-dividers");

    await api(`resources/${folder.id}/trash`, { version: folder.version });
    await page.goto(`/workbench/explorer?view=trash&space=${personal.id}`);
    const trashRow = page.getByRole("row").filter({ hasText: folder.name });
    await trashRow.click({ button: "right" });
    const trashMenu = page.getByRole("menu", { name: "Trash actions" });
    await expect(trashMenu.getByRole("separator")).toHaveCount(1);
    await expect(
      trashMenu.getByRole("menuitem", { name: "Delete 1 permanently…" }),
    ).toHaveAttribute("data-tone", "danger");
    await check(trashMenu, "trash-icons-divider");
    // Dismissing the menu must not restore or delete anything.
    await expect(trashRow).toBeVisible();
    expect(await f.source()).toBe("Menu presentation must not change notes.");
  } finally {
    await f.close();
  }
});
