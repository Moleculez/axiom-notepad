import { test, expect } from "@playwright/test";
import { brandVersion } from "../../packages/shared/src/brand";
import { fixture, origin } from "./native-editor-helpers";

test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Use isolated branding acceptance on port 3004.");
});

test("authentication and installed-app assets share the new identity", async ({
  page,
  request,
}) => {
  await page.goto("/workbench/home");
  const brand = page.locator(".auth-story .brand");
  await expect(brand).toHaveAccessibleName("Axiom.");
  await expect(
    brand.locator('[data-brand="connected-knowledge"]'),
  ).toBeVisible();
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  for (const icon of manifest.icons) {
    expect(icon.src).toContain(brandVersion);
    const response = await request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain(icon.type);
  }
  const apple = page.locator('link[rel="apple-touch-icon"]');
  await expect(apple).toHaveAttribute(
    "href",
    `/icons/180.png?v=${brandVersion}`,
  );
  const response = await request.get((await apple.getAttribute("href"))!);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/png");
  expect((await request.get("/icons/999.png")).status()).toBe(404);
  expect(
    manifest.shortcuts.every((s: { url: string }) => !s.url.includes("tools")),
  ).toBe(true);
  const social = await request.get("/brand/social-preview.png");
  expect(social.ok()).toBe(true);
  expect(social.headers()["content-type"]).toContain("image/png");
});

for (const mode of ["light", "dark"] as const)
  test(`workspace mark stays centered and accessible in ${mode}`, async ({
    browser,
  }, info) => {
    const f = await fixture(
      browser,
      "# Identity check\n\nResearch stays intact.",
    );
    try {
      await f.page.emulateMedia({ colorScheme: mode });
      const brand = f.page.getByRole("link", {
        name: "Axiom home",
        exact: true,
      });
      const icon = brand.locator(".brand-mark");
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute("aria-hidden", "true");
      const geometry = await icon.evaluate((el) => {
        const a = el.getBoundingClientRect(),
          b = el.querySelector("svg")!.getBoundingClientRect();
        return {
          dx: a.x + a.width / 2 - b.x - b.width / 2,
          dy: a.y + a.height / 2 - b.y - b.height / 2,
          width: b.width,
          height: b.height,
        };
      });
      expect(Math.abs(geometry.dx)).toBeLessThan(0.5);
      expect(Math.abs(geometry.dy)).toBeLessThan(0.5);
      expect(geometry.width).toBe(geometry.height);
      await f.page.keyboard.press("Tab");
      await brand.focus();
      await expect(brand).toBeFocused();
      await f.page.screenshot({ path: info.outputPath(`brand-${mode}.png`) });
      await f.page.emulateMedia({ forcedColors: "active" });
      await expect(icon.locator("svg")).toBeVisible();
      expect(await f.source()).toBe(
        "# Identity check\n\nResearch stays intact.",
      );
    } finally {
      await f.close();
    }
  });
