import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
async function api(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const response = await request.fetch("/api/v1/" + path, {
    method,
    data,
    headers: { origin },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
test.beforeAll(() => {
  if (origin !== "http://localhost:3002")
    throw new Error(
      "Use isolated staging for productivity workflow verification.",
    );
});
test("group settings guard unsaved text, reject stale revisions, and preserve the last project lead", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Existing research\n"),
    request = f.owner.request;
  try {
    const page = await f.owner.newPage();
    await page.goto(`/workbench/admin/${f.group.id}/settings`);
    await page
      .getByLabel("Group description")
      .fill("Reproducible science, shared thoughtfully.");
    await page
      .getByRole("navigation", { name: "Management navigation" })
      .getByRole("link", { name: "People & access", exact: true })
      .click();
    const guard = page.getByRole("dialog", { name: "Unsaved group settings" });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Keep editing" }).click();
    const before = await api(request, `group-admin/${f.group.id}/overview`);
    await page
      .getByRole("button", { name: "Save group settings", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await api(request, `group-admin/${f.group.id}/overview`))
            .description,
      )
      .toBe("Reproducible science, shared thoughtfully.");
    expect(
      (
        await request.patch(`/api/v1/spaces/${before.space_id}`, {
          headers: { origin },
          data: {
            version: before.version,
            name: "Stale rename",
            mutationId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(409);
    const members = (await api(request, `group-admin/${f.group.id}/members`))
      .items;
    const member = members.find((m: any) => m.name === "Native Researcher"),
      owner = members.find((m: any) => m.role === "owner");
    const project = await api(request, "projects", {
      groupId: f.group.id,
      name: "Lead continuity",
    });
    await api(request, `projects/${project.id}/members`, {
      userId: member.id,
      canManage: true,
      role: "editor",
    });
    await api(request, `projects/${project.id}/members`, {
      userId: owner.id,
      canManage: false,
      role: "editor",
    });
    const removal = await api(
      request,
      `group-admin/${f.group.id}/members`,
      {
        items: [{ id: member.id, version: member.version }],
        remove: true,
        mutationId: randomUUID(),
      },
      "PATCH",
    );
    expect(removal.results[0]).toMatchObject({
      ok: false,
      error: expect.stringContaining("another lead"),
    });
    await page.screenshot({
      path: test.info().outputPath("group-settings.png"),
    });
    await page.close();
  } finally {
    await f.close();
  }
});
test("Trash context menus lead to centered confirmations and report completed background deletion", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Preserved source\n"),
    request = f.owner.request;
  try {
    const team = (await api(request, "spaces")).find(
      (s: any) => s.group_id === f.group.id && s.kind === "team",
    );
    const folder = await api(request, "resources", {
      spaceId: team.id,
      kind: "folder",
      name: "Disposable UI fixture",
    });
    await api(request, `resources/${folder.id}/trash`, {
      version: folder.version,
    });
    const page = await f.owner.newPage();
    await page.goto(`/workbench/explorer?view=trash&space=${team.id}`);
    const row = page
      .getByRole("row")
      .filter({ hasText: "Disposable UI fixture" });
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete 1 permanently…" }).click();
    const dialog = page.getByRole("dialog", { name: "Review Trash operation" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox(),
      viewport = page.viewportSize()!;
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(
      4,
    );
    await expect(
      dialog.getByRole("button", { name: "Delete 1 eligible item" }),
    ).toBeDisabled();
    await dialog
      .getByLabel("Confirm permanent Trash deletion")
      .fill("DELETE FOREVER");
    await dialog
      .getByRole("button", { name: "Delete 1 eligible item" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Trash operation results" }),
    ).toContainText("1 completed · 0 remaining · 0 retained");
    await page.screenshot({
      path: test.info().outputPath("trash-results.png"),
    });
    await page.close();
    expect(await f.source()).toBe("# Preserved source\n");
  } finally {
    await f.close();
  }
});
test("semantic palettes and maximum typography retain visible controls and pinned Apply", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Typography fixture\n");
  try {
    await f.page.goto("/workbench/settings/theme");
    await f.page.getByText("Visual theme editor", { exact: true }).click();
    const colors = await f.page
      .locator(".palette-preview")
      .evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).backgroundColor),
      );
    expect(colors[0]).not.toBe(colors[1]);
    await f.page.getByLabel("Palette to customize").selectOption("dark");
    await expect(
      f.page.getByLabel("Accent & links color picker"),
    ).toBeVisible();
    await f.page.screenshot({
      path: test.info().outputPath("theme-controls.png"),
    });
    await f.page.emulateMedia({ forcedColors: "active" });
    const picker = f.page.getByLabel("Accent & links color picker");
    await expect(picker).toBeVisible();
    const swatch = await picker.boundingBox();
    expect(swatch!.width).toBeGreaterThanOrEqual(30);
    expect(swatch!.width).toBeLessThanOrEqual(44);
    expect(swatch!.height).toBeGreaterThanOrEqual(30);
    // WebKit emulates the media query but does not implement this CSS property.
    // Test the override where supported without skipping the rest of the UI.
    if (
      await f.page.evaluate(() => CSS.supports("forced-color-adjust", "none"))
    )
      expect(
        await picker.evaluate((el) =>
          getComputedStyle(el).getPropertyValue("forced-color-adjust"),
        ),
      ).toBe("none");
    else
      test.info().annotations.push({
        type: "browser limitation",
        description:
          "forced-color-adjust is unsupported; swatch visibility and size are still checked.",
      });
    await f.page.emulateMedia({ forcedColors: "none" });
    await f.page.getByRole("link", { name: "Typography", exact: true }).click();
    for (const label of [
      "Interface font size value",
      "Note font size value",
      "Code font size value",
    ]) {
      const control = f.page.getByLabel(label);
      await control.fill((await control.getAttribute("max"))!);
      await control.press("Enter");
    }
    const apply = f.page.getByRole("button", { name: "Apply", exact: true });
    await expect(apply).toBeVisible();
    const box = await apply.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      f.page.viewportSize()!.height,
    );
    await f.page.screenshot({
      path: test.info().outputPath("large-typography.png"),
    });
    await f.page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await f.source()).toBe("# Typography fixture\n");
  } finally {
    await f.close();
  }
});
