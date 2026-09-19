import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInOwner } from "./auth";
const origin = process.env.TEST_APP_URL;
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Files scrolling acceptance requires isolated staging on port 3004.",
    );
});
test("workspace Files scrolls list and grid to the final item without clipping the page", async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1200, height: 720 },
    serviceWorkers: "block",
  });
  try {
    const signedIn = await signInOwner(context.request, origin!);
    expect(signedIn.ok(), await signedIn.text()).toBeTruthy();
    const post = async (path: string, data: unknown) => {
      const response = await context.request.post(`/api/v1/${path}`, {
        headers: { origin: origin! },
        data,
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    };
    const group = await post("groups", {
      name: `Files scroll ${randomUUID().slice(0, 6)}`,
    });
    const workspace = await post("spaces", {
      groupId: group.id,
      name: "Scrollable research files",
      audience: "group",
      mutationId: randomUUID(),
    });
    const files: { id: string }[] = [];
    for (let start = 0; start < 44; start += 4)
      files.push(
        ...(await Promise.all(
          Array.from({ length: 4 }, (_, i) =>
            post("resources", {
              spaceId: workspace.space_id,
              kind: "note",
              name: `Research ${String(start + i + 1).padStart(2, "0")}`,
              body: "# Scroll fixture",
              mutationId: randomUUID(),
            }),
          ),
        )),
      );
    const page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/workbench/workspaces/${workspace.space_id}/files`);
    const scroller = page.locator(".section-files .ws-explorer-main");
    await expect(scroller.locator(".ws-resource-row")).toHaveCount(44);
    const tabs = page.getByRole("navigation", { name: "Workspace sections" });
    const tabsBefore = await tabs.boundingBox();
    await expect
      .poll(() => scroller.evaluate((node) => getComputedStyle(node).overflowY))
      .toBe("auto");
    await expect
      .poll(() =>
        scroller.evaluate((node) => node.scrollHeight - node.clientHeight),
      )
      .toBeGreaterThan(500);
    const wheelToBottom = async () => {
      const box = (await scroller.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 10000);
      await expect
        .poll(() => scroller.evaluate((node) => node.scrollTop))
        .toBeGreaterThan(100);
      // Firefox caps a single wheel gesture to roughly one viewport, even when
      // its requested delta is larger. Exercise repeated real wheel scrolling.
      await expect
        .poll(
          async () => {
            await page.mouse.wheel(0, 10000);
            return scroller.evaluate(
              (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
            );
          },
          { intervals: [100, 200] },
        )
        .toBeLessThan(2);
      await expect(
        scroller.locator(`[data-resource-id="${files.at(-1)!.id}"]`),
      ).toBeInViewport();
      await expect(scroller.locator(".ws-list-footer")).toBeInViewport();
      expect((await tabs.boundingBox())?.y).toBe(tabsBefore?.y);
      expect(
        (await scroller.boundingBox())!.y +
          (await scroller.boundingBox())!.height,
      ).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    };
    await wheelToBottom();
    await page.screenshot({
      path: info.outputPath("workspace-files-list-bottom.png"),
    });
    await page.getByRole("button", { name: "Grid view", exact: true }).click();
    await expect(scroller.locator(".ws-resource-grid")).toBeVisible();
    await page.setViewportSize({ width: 1200, height: 600 });
    await wheelToBottom();
    await page.screenshot({
      path: info.outputPath("workspace-files-grid-bottom.png"),
    });
    await scroller
      .getByRole("button", { name: "Details for Research 44", exact: true })
      .click();
    await expect(page.locator(".section-files .ws-inspector")).toBeVisible();
    await wheelToBottom();
    const inspector = await page
      .locator(".section-files .ws-inspector")
      .boundingBox();
    expect(inspector!.y + inspector!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height + 1,
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
