import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";

let f: Awaited<ReturnType<typeof fixture>>,
  space: { id: string; name: string },
  folder: { id: string },
  nested: { id: string };
test.beforeAll(async ({ browser }) => {
  if (origin !== "http://localhost:3004")
    throw new Error("Discovery acceptance requires isolated staging on 3004.");
  f = await fixture(browser, "# Discovery fixture\n");
  const spaces = await (await f.member.request.get("/api/v1/spaces")).json();
  space = spaces.find(
    (item: { group_id: string; kind: string }) =>
      item.group_id === f.group.id && item.kind === "team",
  );
  const create = async (name: string, kind: string, parentId?: string) => {
    const r = await f.member.request.post("/api/v1/resources", {
      headers: { origin },
      data: {
        name,
        kind,
        parentId,
        spaceId: space.id,
        body: kind === "note" ? "# Research evidence" : undefined,
        mutationId: randomUUID(),
      },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  folder = await create("01 Experiments", "folder");
  nested = await create("02 Evidence", "folder", folder.id);
  await create("Quantum derivation", "note", nested.id);
  await create("Quantum overview", "note");
});
test.afterAll(async () => {
  await f?.close();
});

test("palette scopes, keyboard selection, empty state and focus restoration", async ({}, info) => {
  const page = f.page;
  await page.goto("/workbench/home");
  const trigger = page.getByRole("button", {
    name: "Search workspace",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Search & commands",
    exact: true,
  });
  const input = dialog.getByRole("combobox", { name: "Global search" });
  await expect(input).toBeFocused();
  await dialog.getByRole("button", { name: "Files", exact: true }).click();
  await input.fill("Quantum");
  const results = dialog.getByRole("option");
  await expect(results).toHaveCount(2);
  await expect(results.first()).toContainText(space.name);
  const first = await input.getAttribute("aria-activedescendant");
  await input.press("ArrowDown");
  await expect(input).toBeFocused();
  await expect(input).not.toHaveAttribute("aria-activedescendant", first!);
  await page.screenshot({
    path: info.outputPath("search-files.png"),
    animations: "disabled",
  });
  await input.fill("no-such-file-7713");
  await expect(dialog.getByText(/No matches for/)).toBeVisible();
  await expect(results).toHaveCount(0);
  // A command prefix works even after selecting the Files scope.
  await input.fill("> settings");
  await expect(results).toHaveCount(1);
  await input.press("Enter");
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("palette remains contained with dark colors and large interface typography", async ({}, info) => {
  const page = f.page;
  await page.setViewportSize({ width: 1050, height: 720 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/workbench/home");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Search workspace", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Search & commands",
    exact: true,
  });
  const input = dialog.getByRole("combobox", { name: "Global search" });
  await dialog.evaluate((node) => node.style.setProperty("--size-ui", "22px"));
  await expect(input).toHaveCSS("font-size", "22px");
  const before = await input.boundingBox();
  await input.fill("> planning");
  // The workspace destination and the accessible group's planning destination
  // both match since portfolios were added to Search & commands.
  await expect(dialog.getByRole("option")).toHaveCount(2);
  await expect(
    dialog
      .getByRole("group", { name: "Group planning", exact: true })
      .getByRole("option"),
  ).toHaveCount(1);
  expect(Math.abs((await input.boundingBox())!.y - before!.y)).toBeLessThan(1);
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  await expect(dialog.locator(".discovery-footer")).toBeInViewport();
  await page.screenshot({
    path: info.outputPath("search-dark-large.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test("sidebar filtering, direct-folder reveal, row menus and collapse/keyboard expansion", async ({}, info) => {
  const page = f.page;
  await page.goto(
    `/workbench/workspaces/${space.id}/files?folder=${nested.id}`,
  );
  const sidebar = page.getByRole("complementary", {
    name: "Workspace navigation",
  });
  const row = sidebar.locator(`[data-tree-resource="${nested.id}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/active/);
  await row.hover();
  await row
    .getByRole("button", { name: "Actions for 02 Evidence", exact: true })
    .click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  const filter = sidebar.getByRole("textbox", { name: "Filter workspaces" });
  await filter.fill("no matching workspace");
  await expect(sidebar.getByRole("status")).toHaveText(
    "No matching workspaces.",
  );
  await filter.press("Escape");
  await expect(row).toBeVisible();
  await sidebar
    .getByRole("button", { name: "Collapse all folders", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  const root = sidebar
    .getByRole("link", { name: space.name, exact: true })
    .locator("..");
  await root.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    sidebar.locator(`[data-tree-resource="${folder.id}"]`),
  ).toBeVisible();
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press("Home");
  await expect(sidebar.locator(".ws-tree-row").first()).toBeFocused();
  await page.screenshot({
    path: info.outputPath("sidebar-explorer.png"),
    animations: "disabled",
  });
  await page.reload();
  await expect(
    sidebar.locator(`[data-tree-resource="${nested.id}"]`),
  ).toBeVisible();
});
