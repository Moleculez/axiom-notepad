import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

/** Fresh guest contexts only. No dotenv, accounts, existing drafts or API calls. */
const base = new URL(
  process.env.SHOWCASE_CAPTURE_URL ?? "http://127.0.0.1:3010/axiom-notepad/",
);
if (
  base.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(base.hostname) ||
  !["3010", "3011"].includes(base.port) ||
  base.pathname !== "/axiom-notepad/"
)
  throw new Error(
    "Capture requires a local showcase preview on port 3010 or 3011.",
  );
const output = "docs/assets/showcase";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  for (const mode of ["light", "dark"] as const) {
    const context = await browser.newContext({
      baseURL: base.href,
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
      colorScheme: mode,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("websocket", (socket) => errors.push(socket.url()));
      page.on("request", (request) => {
        const url = request.url();
        if (
          /^https?:/.test(url) &&
          (!url.startsWith(base.origin) ||
            /\/api\/|\/sync(?:\b|\/)|\.env/.test(url))
        )
          errors.push(url);
      });
      page.on("response", (response) => {
        if (response.status() >= 400)
          errors.push(`${response.status()} ${response.url()}`);
      });
      await page.goto("./#editor&note=3f000000-0000-4000-8000-000000000001");
      if (
        (await page.locator('script[src*="/@vite/"]').count()) ||
        (await page
          .locator('script[src="/axiom-notepad/src/main.tsx"]')
          .count())
      )
        throw new Error(
          "Build first, then capture with showcase:preview, not showcase:dev.",
        );
      await expect(page.locator(".axiom-editor")).toBeVisible();
      await page
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
      const settings = page.getByRole("dialog", {
        name: "Appearance & editor",
      });
      await settings.getByRole("button", { name: mode, exact: true }).click();
      await settings.getByRole("button", { name: "Done", exact: true }).click();
      await page.locator(".demo-document-scroll").evaluate((pane) => {
        const heading = [...pane.querySelectorAll("h2")].find((item) =>
          item.textContent?.includes("A shared representation"),
        );
        if (!heading)
          throw new Error("The reviewed research sample is missing.");
        pane.scrollTop +=
          heading.getBoundingClientRect().top -
          pane.getBoundingClientRect().top -
          30;
      });
      await expect(
        page.locator('.demo-document-scroll [data-math-state="ready"]').first(),
      ).toBeVisible();
      const capture = async (name: string) => {
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(
          () =>
            ![
              ...document.querySelectorAll(
                '[data-math-request]:not([data-math-state="ready"]):not([data-math-state="error"]), [data-preview-state="loading"], [data-preview-state="pending"]',
              ),
            ].some((element) => {
              const rect = element.getBoundingClientRect();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                rect.top < innerHeight &&
                rect.bottom > 0
              );
            }),
        );
        await expect(
          page.getByText("Saved on this device", { exact: true }).first(),
        ).toBeVisible();
        expect(errors).toEqual([]);
        await sharp(await page.screenshot())
          .webp({ quality: 86 })
          .toFile(`${output}/static-${name}-${mode}.webp`);
      };
      await capture("editor");
      await page
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
      await settings
        .getByRole("tab", { name: "Typography", exact: true })
        .click();
      await capture("settings");
      await settings.getByRole("button", { name: "Done", exact: true }).click();
      await page.getByRole("link", { name: "Canvas", exact: true }).click();
      await expect(page.locator(".canvas-board .canvas-card")).toHaveCount(4);
      await expect(
        page.locator('[data-canvas-node="model"] [data-math-state="ready"]'),
      ).toBeVisible();
      await capture("canvas");
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(
  "Captured the built static editor, settings and Canvas with fresh fictional samples.",
);
