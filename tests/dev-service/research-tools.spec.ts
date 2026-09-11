import { test, expect, type BrowserContext } from "@playwright/test";
import { signInOwner } from "../e2e/auth";
let cookies: Awaited<ReturnType<BrowserContext["cookies"]>>;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:8080",
  });
  expect(
    (await signInOwner(context.request, "http://localhost:8080")).ok(),
  ).toBeTruthy();
  cookies = await context.cookies();
  await context.close();
});
test("8080 exposes the current tool pages without writing live research data", async ({
  page,
  context,
}, info) => {
  await context.addCookies(cookies);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/v1/**", async (route) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) {
      await route.abort();
      throw new Error("Live tool-page acceptance must remain read-only.");
    }
    await route.continue();
  });
  await page.goto("/workbench/tools");
  await expect(
    page.getByRole("heading", { name: "Tools", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tool-launcher")).toHaveCount(5);
  await expect(page.locator(".tools-hub .ws-loading")).toBeHidden();
  await page.screenshot({ path: info.outputPath("research-tools-hub.png") });
  await page.getByRole("link", { name: /Math Studio Write LaTeX/ }).click();
  await expect(
    page.getByRole("heading", { name: "New math project" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create project", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: info.outputPath("math-studio-create.png") });
  await page.goto("/workbench/tools/viewer");
  await expect(
    page.getByRole("heading", { name: "File viewer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "File viewer", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const search = page.locator(".viewer-file-picker .tool-search");
  await expect(search).toHaveCSS("flex-direction", "row");
  const icon = (await search.locator("svg").boundingBox())!,
    input = (await search.locator("input").boundingBox())!;
  expect(
    Math.abs(icon.y + icon.height / 2 - input.y - input.height / 2),
  ).toBeLessThan(2);
  await page.screenshot({ path: info.outputPath("research-file-viewer.png") });
  expect(errors).toEqual([]);
});
