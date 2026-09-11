import { test, expect } from "@playwright/test";
import { signInOwner } from "../e2e/auth";

test("8080 serves the current management console without changing research", async ({
  page,
  context,
}, info) => {
  expect(
    (await signInOwner(context.request, "http://localhost:8080")).ok(),
  ).toBeTruthy();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/**", async (route) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method()))
      throw new Error("Live management smoke is read-only.");
    await route.continue();
  });
  await page.goto("/workbench/workspaces");
  await expect(
    page.getByRole("heading", { name: "Workspaces", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Find a workspace")
    .fill("__read_only_console_verification__");
  await expect(
    page.getByRole("heading", { name: "No matching workspaces" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("live-workspaces-8080.png") });
  await page
    .getByRole("navigation", { name: "Management navigation" })
    .getByRole("link", { name: "Audit", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Audit", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Search history")
    .fill("__read_only_console_verification__");
  await expect(
    page.getByRole("heading", { name: "No matching history" }),
  ).toBeVisible();
  await expect(page.getByText("File operations", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({ path: info.outputPath("live-audit-8080.png") });
  await page
    .getByRole("navigation", { name: "Management navigation" })
    .getByRole("link", { name: "Trash", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Trash", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Trash views" })
    .getByRole("link", { name: "Workspaces", exact: true })
    .click();
  await expect(page.getByLabel("Search workspaces")).toBeVisible();
  await page
    .getByLabel("Search workspaces")
    .fill("__read_only_console_verification__");
  await expect(
    page.getByRole("heading", { name: "No workspaces in Trash" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("live-trash-8080.png") });
  expect(errors).toEqual([]);
});
