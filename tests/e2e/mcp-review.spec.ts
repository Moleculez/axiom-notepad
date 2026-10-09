import { test, expect, type Page } from "@playwright/test";
import { signInOwner } from "./auth";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
import type { WorkspaceChangeSet } from "../../packages/shared/src/productivity";
import { createTranslator } from "../../packages/i18n/src/index";
import { readFile } from "node:fs/promises";

const origin = "http://localhost:3004";
const id = "10000000-0000-4000-8000-000000000003";
test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => {
  expect((await signInOwner(page.request, origin)).status()).toBe(200);
});

async function reviewFixture(page: Page, status = "queued") {
  const spaces = await (await page.request.get("/api/v1/spaces")).json();
  const spaceId = spaces[0].id;
  const value: WorkspaceChangeSet = {
    id,
    title: "file create",
    status,
    version: 1,
    space_ids: [spaceId],
    connection_id: "10000000-0000-4000-8000-000000000004",
    actions: [
      {
        id: "10000000-0000-4000-8000-000000000005",
        entity_id: "10000000-0000-4000-8000-000000000006",
        selected: true,
        state: "pending",
        data: {
          key: "note",
          action: "file_create",
          spaceId,
          title: "A private research note",
          explanation: "Requested by a synthetic client",
          dependsOn: [],
          payload: {
            type: "markdown",
            name: "A private research note",
            source: "# Research\n\nCanonical source stays unchanged.\n",
          },
        },
      },
    ],
  };
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/") && request.method() !== "GET")
      writes.push(request.method() + " " + new URL(request.url()).pathname);
  });
  await page.route("**/api/v1/assistant/change-sets**", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith("change-sets")
        ? [value]
        : value,
    });
  });
  await page.route("**/api/v1/connections", (route) =>
    route.fulfill({
      json: {
        connections: [
          {
            id: value.connection_id,
            name: "Synthetic MCP client",
            scopes: ["workspace:read", "workspace:write"],
            space_ids: [spaceId],
          },
        ],
        approvals: [],
        activity: [],
      },
    }),
  );
  await page.route("**/api/v1/me/locale", (route) =>
    route.fulfill({ json: { locale: "en", version: 0, mutationId: null } }),
  );
  return { value, writes };
}

async function geometry(page: Page) {
  const dialog = page.locator(".change-set-dialog");
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  const footer = dialog.locator(".dialog-footer");
  expect(
    await footer.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= innerHeight;
    }),
  ).toBe(true);
  for (const button of await footer.getByRole("button").all()) {
    await expect(button).toBeVisible();
    expect(
      await button.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
  }
}

test("approved queued requests never ask for another approval and refresh into authoritative results", async ({
  page,
}, info) => {
  const { value, writes } = await reviewFixture(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto(
    `/workbench/settings/connections?review=${id}&context=history`,
  );
  const dialog = page.locator(".change-set-dialog");
  await expect(dialog).toContainText(
    "Approval received. Waiting for background processing.",
  );
  await expect(dialog).not.toContainText(
    "Nothing applies without your approval",
  );
  await expect(
    dialog.getByRole("button", { name: "Approve & apply", exact: true }),
  ).toHaveCount(0);
  await page.clock.fastForward(60_000);
  await expect(dialog).toContainText(
    "Background processing may be paused or unavailable.",
  );
  const refresh = dialog.getByRole("button", {
    name: "Refresh status",
    exact: true,
  });
  await refresh.focus();
  await expect(refresh).toBeFocused();
  await refresh.press("Enter");
  await expect(dialog).toContainText("Approval received");
  await geometry(page);
  await page.screenshot({ path: info.outputPath("queued-change-request.png") });
  value.status = "complete";
  value.actions[0].state = "complete";
  value.actions[0].result = { id: value.actions[0].entity_id };
  await refresh.click();
  await expect(dialog).toContainText("Approved changes have been applied.");
  await expect(dialog).not.toContainText("Background processing may be paused");
  await expect(
    dialog.getByRole("button", { name: "Open result", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Stop remaining actions", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Approve & apply", exact: true }),
  ).toHaveCount(0);
  await geometry(page);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(
    `${origin}/workbench/settings/connections?context=history`,
  );
  await page.reload();
  await expect(page.locator(".change-set-dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "View request", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("review")).toBe(id);
  expect(new URL(page.url()).searchParams.get("context")).toBe("history");
  await expect(dialog).toContainText("Approved changes have been applied.");
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("queued review is readable in Japanese, Korean and German at large text in both color modes", async ({
  page,
}, info) => {
  await reviewFixture(page);
  await page.setViewportSize({ width: 1100, height: 1050 });
  for (const locale of ["ja", "ko", "de"] as const) {
    const t = createTranslator(
      locale,
      JSON.parse(
        await readFile(`packages/i18n/src/messages/${locale}.json`, "utf8"),
      ),
    );
    await page.route("**/api/v1/me/locale", (route) =>
      route.fulfill({ json: { locale, version: 0, mutationId: null } }),
    );
    for (const mode of ["light", "dark"] as const) {
      await page.route("**/api/v1/me/preferences-bundle", async (route) => {
        expect(route.request().method()).toBe("GET");
        const response = await route.fetch({
          headers: {
            ...route.request().headers(),
            "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA),
          },
        });
        const bundle = await response.json();
        bundle.appearance.preferences.mode = mode;
        bundle.appearance.preferences.uiSize = 20;
        bundle.appearance.preferences.motion = "none";
        await route.fulfill({ response, json: bundle });
      });
      await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
      await page.goto(`/workbench/settings/connections?review=${id}`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      const dialog = page.locator(".change-set-dialog");
      await expect(dialog).toContainText(
        t("Approval received. Waiting for background processing."),
      );
      await expect(
        dialog.getByRole("button", { name: t("Refresh status"), exact: true }),
      ).toBeVisible();
      await geometry(page);
      await dialog.screenshot({
        path: info.outputPath(`queued-review-${locale}-${mode}.png`),
      });
      await page.unroute("**/api/v1/me/preferences-bundle");
    }
    await page.unroute("**/api/v1/me/locale");
  }
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await geometry(page);
  await page.screenshot({
    path: info.outputPath("queued-review-forced-colors.png"),
  });
});
