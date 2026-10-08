import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { interfaceStyles } from "../../packages/shared/src/interface-styles";
import { fixture, origin } from "./native-editor-helpers";
import { settledInterfaceChrome } from "./interface-style-helpers";

test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "MCP settings acceptance requires isolated staging on 3004.",
    );
});

async function assertSetupGeometry(page: Page) {
  const card = page.locator(".connections-settings > .settings-card").first();
  expect(
    await card.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  const copy = card.getByRole("button", { name: "Copy MCP server URL" });
  expect(
    await copy.evaluate((element) => {
      const button = element.getBoundingClientRect();
      const icon = element.querySelector("svg")!.getBoundingClientRect();
      return Math.abs(
        (button.top + button.bottom) / 2 - (icon.top + icon.bottom) / 2,
      );
    }),
  ).toBeLessThan(1);
  const sizes = await card
    .locator(".connection-capabilities > div")
    .evaluateAll((rows) =>
      rows.map((row) => {
        const term = row.querySelector("dt")!;
        const detail = row.querySelector("dd")!;
        return {
          overlap:
            term.getBoundingClientRect().right >
            detail.getBoundingClientRect().left + 1,
          clipped: row.scrollWidth > row.clientWidth + 1,
        };
      }),
    );
  expect(sizes.every((row) => !row.overlap && !row.clipped)).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("MCP setup reports canonical identity, checks OAuth routing and remains tidy in every interface style", async ({
  browser,
}, info) => {
  test.setTimeout(240000);
  const f = await fixture(
    browser,
    "# MCP acceptance\n\nResearch remains unchanged.\n",
  );
  const page = f.page;
  try {
    const before = await (
      await f.member.request.get("/api/v1/connections")
    ).json();
    const status = await (
      await f.member.request.get("/api/v1/connections/mcp-status")
    ).json();
    expect(status.endpoint).toBe(origin + "/mcp");
    expect(status.writesRequireReview).toBe(true);
    expect(status.check).toBeUndefined();
    await page.goto("/workbench/settings/connections");
    const card = page.locator(".connections-settings > .settings-card").first();
    await expect(card.locator(".connection-endpoint code")).toHaveText(
      origin + "/mcp",
    );
    await expect(card.getByText("Endpoint ready", { exact: true })).toHaveCount(
      0,
    );
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            (window as Window & { mcpCopiedUrl?: string }).mcpCopiedUrl = value;
          },
        },
      });
    });
    const copy = card.getByRole("button", { name: "Copy MCP server URL" });
    await copy.focus();
    await expect(copy).toBeFocused();
    await copy.press("Enter");
    expect(
      await page.evaluate(
        () => (window as Window & { mcpCopiedUrl?: string }).mcpCopiedUrl,
      ),
    ).toBe(status.endpoint);
    const check = card.getByRole("button", {
      name: "Check connection",
      exact: true,
    });
    await check.focus();
    const response = page.waitForResponse((value) =>
      value.url().includes("connections/mcp-status?check=1"),
    );
    await check.press("Enter");
    expect((await (await response).json()).check).toMatchObject({
      healthy: true,
      code: "ready",
      httpStatus: 401,
    });
    await expect(card.getByRole("status")).toContainText("Endpoint ready");
    const after = await (
      await f.member.request.get("/api/v1/connections")
    ).json();
    expect(after.connections).toEqual(before.connections);
    expect(after.approvals).toEqual(before.approvals);

    for (const { id } of interfaceStyles) {
      for (const mode of ["light", "dark"] as const) {
        const current = await (
          await f.member.request.get("/api/v1/me/preferences-bundle")
        ).json();
        const update = await f.member.request.patch(
          "/api/v1/me/preferences-bundle",
          {
            headers: { origin },
            data: {
              appearance: {
                version: current.appearance.version,
                preferences: {
                  ...current.appearance.preferences,
                  interfaceStyle: id,
                  mode,
                  uiSize: mode === "dark" ? 22 : 15,
                  radius: 0,
                  shadows: "none",
                  motion: "none",
                },
              },
              editor: current.editor,
              mutationId: randomUUID(),
            },
          },
        );
        expect(update.ok(), await update.text()).toBe(true);
        await page.setViewportSize({
          width: mode === "dark" ? 1100 : 1440,
          height: 1000,
        });
        await page.goto("/workbench/settings/connections");
        await expect(page.locator("html")).toHaveAttribute(
          "data-interface-style",
          id,
        );
        await expect(card.locator(".connection-endpoint code")).toHaveText(
          origin + "/mcp",
        );
        await settledInterfaceChrome(page);
        await assertSetupGeometry(page);
        await card.screenshot({
          path: info.outputPath(`mcp-setup-${id}-${mode}.png`),
        });
      }
    }
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await check.focus();
    await expect(check).toBeFocused();
    await assertSetupGeometry(page);
    const selectedInk = await page
      .locator(".settings-rail .ws-side-link.active")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        let background = style.backgroundColor;
        if (background === "rgba(0, 0, 0, 0)" || background === "transparent")
          background = getComputedStyle(element.parentElement!).backgroundColor;
        return {
          color: style.color,
          background,
          adjustment: style.getPropertyValue("forced-color-adjust"),
          supportsAdjustment:
            CSS.supports("forced-color-adjust", "none") &&
            matchMedia("(forced-colors: active)").matches,
        };
      });
    expect(
      selectedInk.color,
      "Selected settings label must remain readable in forced colors",
    ).not.toBe(selectedInk.background);
    if (selectedInk.supportsAdjustment)
      expect(selectedInk.adjustment).toBe("none");
    await check.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("mcp-setup-forced-colors-keyboard.png"),
    });
    expect(await f.source()).toBe(
      "# MCP acceptance\n\nResearch remains unchanged.\n",
    );
  } finally {
    await f.close();
  }
});
