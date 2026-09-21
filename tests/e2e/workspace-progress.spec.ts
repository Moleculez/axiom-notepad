import { expect, test } from "@playwright/test";
import { fixture, origin } from "./native-editor-helpers";

test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Progress acceptance requires isolated staging on 3004.");
});
test.use({ trace: "off" });

test("toolbar loading preserves the shell and settles after success, failure and navigation cancellation", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Loading evidence\n");
  let release = () => {};
  try {
    const page = f.page;
    const response = await f.member.request.get("/api/v1/dashboard"),
      dashboard = await response.json();
    expect(response.ok()).toBeTruthy();
    let status = 200,
      intercepted = 0;
    let gate = new Promise<void>((done) => {
      release = done;
    });
    await page.route("**/api/v1/dashboard", async (route) => {
      const pending = gate,
        result = status;
      intercepted++;
      await pending;
      await route
        .fulfill({
          status: result,
          json:
            result === 200
              ? dashboard
              : { error: "Loading verification unavailable." },
        })
        .catch(() => {}); // The old request may have been cancelled by navigation.
    });
    const toolbar = await page.locator(".ws-appbar").elementHandle(),
      initial = (await page.locator(".ws-appbar").boundingBox())!,
      bar = page.getByRole("progressbar", { name: "Workspace loading" });
    await page.getByRole("link", { name: "Axiom home", exact: true }).click();
    await expect.poll(() => intercepted).toBe(1);
    await expect(bar).toBeVisible();
    await expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(await toolbar!.evaluate((node) => node.isConnected)).toBe(true);
    expect((await page.locator(".ws-appbar").boundingBox())!.height).toBe(
      initial.height,
    );
    const bounds = (await bar.boundingBox())!;
    expect(bounds.height).toBe(3);
    expect(
      Math.abs(bounds.y + bounds.height - (initial.y + initial.height)),
    ).toBeLessThan(2);
    await expect(page.locator("#workspace-content .ws-loading")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("toolbar-loading.png"),
    });
    release();
    await expect(bar).toBeHidden();

    // Retry keeps the shell. Failure remains visible in the page, not in a stuck bar.
    await page.getByRole("link", { name: "Axiom home", exact: true }).focus();
    await page.locator('.ws-sidebar a[href="/workbench/trash"]').click();
    await expect(page).toHaveURL(/\/trash$/);
    status = 503;
    gate = new Promise<void>((done) => {
      release = done;
    });
    await page.getByRole("link", { name: "Axiom home", exact: true }).click();
    await expect(bar).toBeVisible();
    release();
    await expect(
      page.getByText("Loading verification unavailable.", { exact: true }),
    ).toBeVisible();
    await expect(bar).toBeHidden();
    status = 200;
    gate = new Promise<void>((done) => {
      release = done;
    });
    await page
      .locator(".ws-home")
      .getByRole("button", { name: "Retry", exact: true })
      .click();
    await expect(bar).toBeVisible();
    release();
    await expect(
      page.getByText("Loading verification unavailable.", { exact: true }),
    ).toHaveCount(0);
    await expect(bar).toBeHidden();

    await page.locator('.ws-sidebar a[href="/workbench/trash"]').click();
    await expect(page).toHaveURL(/\/trash$/);
    gate = new Promise<void>((done) => {
      release = done;
    });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await page.getByRole("link", { name: "Axiom home", exact: true }).click();
    await expect(bar).toBeVisible();
    await expect(page.locator(".workspace-progress-fill")).toHaveCSS(
      "animation-name",
      "none",
    );
    await page.screenshot({
      path: test.info().outputPath("toolbar-loading-reduced-dark.png"),
      animations: "disabled",
    });
    await page.locator('.ws-sidebar a[href="/workbench/trash"]').click();
    // The old dashboard request is deliberately still pending: release/unmount
    // must stop its indicator without waiting for a response that may never arrive.
    await expect(bar).toBeHidden();
    release();
    expect(await toolbar!.evaluate((node) => node.isConnected)).toBe(true);
  } finally {
    release();
    await f.close();
  }
});

test("background settings refresh keeps cards mounted and custom reduced motion uses a static bar", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Settings loading evidence\n");
  let release = () => {};
  try {
    const page = f.page;
    await page.goto("/workbench/settings/connections");
    const heading = page.getByRole("heading", {
      name: "Requests for approval",
      exact: true,
    });
    await expect(heading).toBeVisible();
    const existing = await heading.elementHandle(),
      before = await heading.boundingBox(),
      data = await (await f.member.request.get("/api/v1/connections")).json();
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let refreshes = 0;
    await page.route("**/api/v1/connections", async (route) => {
      refreshes++;
      await gate;
      await route.fulfill({ json: data }).catch(() => {});
    });
    await expect.poll(() => refreshes, { timeout: 15000 }).toBeGreaterThan(0);
    const bar = page.getByRole("progressbar", { name: "Workspace loading" });
    await expect(bar).toBeVisible();
    expect(await existing!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(heading).toBeVisible();
    expect(await heading.boundingBox()).toEqual(before);
    await page.evaluate(() => {
      document.documentElement.dataset.motion = "none";
    });
    await expect(page.locator("html")).toHaveAttribute("data-motion", "none");
    await expect(page.locator(".workspace-progress-fill")).toHaveCSS(
      "animation-name",
      "none",
    );
    await expect(page.locator(".workspace-progress")).toHaveCSS(
      "pointer-events",
      "none",
    );
    release();
    await expect(bar).toBeHidden();
    expect(await existing!.evaluate((node) => node.isConnected)).toBe(true);
  } finally {
    release();
    await f.close();
  }
});
