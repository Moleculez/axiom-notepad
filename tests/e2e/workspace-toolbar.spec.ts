import { expect, test } from "@playwright/test";
import { fixture, origin } from "./native-editor-helpers";

let f: Awaited<ReturnType<typeof fixture>>;
test.beforeAll(async ({ browser }) => {
  if (origin !== "http://localhost:3004" && origin !== "http://localhost:3002")
    throw new Error("Use isolated staging for toolbar acceptance.");
  f = await fixture(
    browser,
    "# Navigation acceptance\n\nA retained research draft.\n",
  );
});
test.afterAll(async () => {
  await f?.close();
});

test("single toolbar, global history, pinned recent work and commands", async ({}, info) => {
  const page = f.page,
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workbench/home");
  await expect(
    page.getByRole("tablist", { name: "Application tabs" }),
  ).toHaveCount(0);
  const toolbar = page.getByRole("banner");
  await expect(
    toolbar.getByRole("navigation", { name: "Current location" }),
  ).toBeVisible();
  const command = async (name: string) => {
    await toolbar.getByRole("button", { name: "Search workspace" }).click();
    await page
      .getByRole("combobox", { name: "Global search" })
      .fill("> " + name);
    await page
      .getByRole("group", { name: "Commands", exact: true })
      .getByRole("option")
      .click();
  };
  await command("Groups");
  await expect(page).toHaveURL(/\/groups$/);
  await command("People");
  await expect(page).toHaveURL(/\/people$/);
  await toolbar.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page).toHaveURL(/\/groups$/);
  await toolbar
    .getByRole("button", { name: "Go forward", exact: true })
    .click();
  await expect(page).toHaveURL(/\/people$/);
  await toolbar
    .getByRole("button", { name: "Recent work", exact: true })
    .click();
  const recent = page.getByRole("region", { name: "Recent work switcher" });
  await recent.getByRole("button", { name: "Pin Groups", exact: true }).click();
  await expect(
    recent.getByRole("region", { name: "Pinned work" }),
  ).toContainText("Groups");
  await recent
    .locator(".workspace-recent-open")
    .filter({ hasText: "Groups" })
    .click();
  await expect(page).toHaveURL(/\/groups$/);
  await expect(recent).not.toBeVisible();
  await page.reload();
  await expect(
    toolbar.getByRole("button", { name: "Recent work", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Alt+r");
  await expect(
    recent.getByRole("region", { name: "Pinned work" }),
  ).toContainText("Groups");
  await page.keyboard.press("Escape");
  await expect(
    toolbar.getByRole("button", { name: "Recent work", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: info.outputPath("workspace-toolbar.png"),
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("time-zone suggestions work by mouse and keyboard, and Settings drafts survive navigation", async ({}, info) => {
  const page = f.page;
  await page.goto("/workbench/settings/profile");
  const zone = page.getByRole("combobox", { name: "Time zone", exact: true });
  await zone.fill("new york");
  const option = page.getByRole("option", { name: /America\/New York/ });
  await expect(option).toBeVisible();
  await page.screenshot({
    path: info.outputPath("timezone-suggestions.png"),
    animations: "disabled",
  });
  await zone.press("Enter");
  await expect(zone).toHaveValue("America/New_York");
  await expect(page.getByRole("listbox", { name: "Time zones" })).toHaveCount(
    0,
  );
  await zone.fill("shanghai");
  await page.getByRole("option", { name: /Asia\/Shanghai/ }).click();
  await expect(zone).toHaveValue("Asia/Shanghai");
  await zone.fill("Not/AZone");
  await zone.press("Tab");
  await expect(zone).toHaveAttribute("aria-invalid", "true");
  await zone.fill("UTC");
  await zone.press("Enter");
  const affiliation = page.getByLabel("Institution or affiliation");
  await affiliation.fill("Retained navigation draft");
  await page
    .getByRole("banner")
    .getByRole("link", { name: "Open inbox" })
    .click();
  await expect(page).toHaveURL(/\/inbox$/);
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(affiliation).toHaveValue("Retained navigation draft");
  await expect(zone).toHaveValue("UTC");
});

test("workspace calendar uses the same zone picker and saves a selected IANA value", async ({}) => {
  const spaces = await (await f.owner.request.get("/api/v1/spaces")).json();
  const space = spaces.find(
    (item: { group_id: string; kind: string }) =>
      item.group_id === f.group.id && item.kind === "team",
  );
  const page = await f.owner.newPage();
  try {
    await page.goto(`/workbench/workspaces/${space.id}/settings/general`);
    const zone = page.getByRole("combobox", { name: "Time zone", exact: true });
    await zone.fill("paris");
    await zone.press("Enter");
    await expect(zone).toHaveValue("Europe/Paris");
    await page
      .getByRole("button", { name: "Save calendar", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await (
              await f.owner.request.get(
                `/api/v1/spaces/${space.id}/planning-settings`,
              )
            ).json()
          ).calendar.timezone,
      )
      .toBe("Europe/Paris");
  } finally {
    await page.close();
  }
});

test("Explorer filtering keeps its input mounted and supports global history", async () => {
  const page = f.page;
  await page.goto("/workbench/explorer?view=all");
  const search = page.getByRole("textbox", { name: "Search files and notes" });
  await search.fill("study");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=study/);
  await expect(search).toBeFocused();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(page).not.toHaveURL(/q=/);
});
