import { test, expect, type Page } from "@playwright/test";

const version = "12345678-1234-1234-1234-123456789abc";
const source = `Caret here\n\n[Attachment](/api/v1/attachments/${version})`;
const panel = (page: Page) =>
  page.getByRole("dialog", { name: "Linked file actions" });
const link = (page: Page) =>
  page
    .locator('[data-pane="0"] .axiom-inline-link')
    .filter({ hasText: "Attachment" });
const errors = new WeakMap<Page, string[]>();
const reads = new WeakMap<Page, string[]>();

async function setup(page: Page, mime = "image/png", missing = false) {
  const requests: string[] = [];
  reads.set(page, requests);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice(
      "/api/v1/".length,
    );
    requests.push(path);
    const data: Record<string, unknown> = {
      "media-assets": missing
        ? []
        : [{ resourceId: "test-file", versionId: version, mime, bytes: 512 }],
      "resources/test-file": {
        id: "test-file",
        name: "Research attachment",
        kind: "file",
        current_version_id: version,
        mime,
        bytes: 512,
        space_id: "research",
        parent_id: "figures",
        reference_code: "FIG-1",
      },
      "resources/test-file/location": {
        space: { name: "Research" },
        ancestors: [{ name: "Figures" }],
      },
      "files/test-file/versions": [
        {
          id: version,
          ordinal: 1,
          mime,
          bytes: 512,
          created_at: "2026-09-28T00:00:00Z",
        },
      ],
      "files/test-file/usage": { references: 2, annotations: 1, citations: 0 },
    };
    await route.fulfill({
      status: path in data ? 200 : 404,
      json: data[path] ?? {},
    });
  });
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(async (source) => {
    await window.editorLabReady;
    await window.editorLab.reset(source);
    window.editorLab.focus(0, 5);
    const fixture = "/tests/editor-lab/linked-file-actions.ts";
    await import(/* @vite-ignore */ fixture);
    window.linkedFileActionsLab.mount();
  }, source);
}

test.beforeEach(({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(
    reads
      .get(page)
      ?.filter(
        (path) =>
          ![
            "media-assets",
            "resources/test-file",
            "resources/test-file/location",
            "files/test-file/versions",
            "files/test-file/usage",
          ].includes(path),
      ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      window.editorLab.snapshot().map((entry) => entry.source),
    ),
  ).toEqual([source, source]);
});

for (const mime of ["image/png", "application/pdf"]) {
  test(`${mime}: hover shows actions without a viewer or file-content downloads`, async ({
    page,
  }) => {
    await setup(page, mime);
    await link(page).hover();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole("heading")).toHaveText(
      "Research attachment",
    );
    await expect(
      panel(page).locator("img, video, audio, iframe, canvas, .tool-preview"),
    ).toHaveCount(0);
    expect(reads.get(page)).toEqual(["media-assets", "resources/test-file"]);
    const box = await panel(page).boundingBox();
    expect(box!.width).toBeLessThanOrEqual(320);
    expect(box!.height).toBeLessThan(240);
    await panel(page)
      .getByRole("button", { name: "Open", exact: true })
      .click();
    await expect(panel(page)).toHaveCount(0);
    expect(
      await page.evaluate(() => window.linkedFileActionsLab.opened),
    ).toEqual([{ resource: { id: "test-file", kind: "file" }, split: false }]);

    await page.locator("body > header").hover();
    await link(page).hover();
    await panel(page)
      .getByRole("button", { name: "Open beside", exact: true })
      .click();
    expect(
      await page.evaluate(() => window.linkedFileActionsLab.opened.at(-1)),
    ).toEqual({ resource: { id: "test-file", kind: "file" }, split: true });
  });
}

test("keyboard access retains details, versions and reveal; Escape dismisses", async ({
  page,
}) => {
  await setup(page);
  await link(page).focus();
  await expect(panel(page).getByRole("heading")).toHaveText(
    "Research attachment",
  );
  const details = panel(page).locator("summary");
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toContainText("Research / Figures");
  await expect(panel(page).getByLabel("File version")).toHaveValue(version);
  await expect(
    panel(page).getByRole("button", { name: "Link", exact: true }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "Code", exact: true }),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Reveal", exact: true })
    .click();
  expect(
    await page.evaluate(() => window.linkedFileActionsLab.navigated),
  ).toEqual(["/workspaces/research/files?folder=figures"]);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});

test("missing attachments remain permission-checked without content requests", async ({
  page,
}) => {
  await setup(page, "application/pdf", true);
  await link(page).hover();
  await expect(panel(page)).toContainText("missing or inaccessible");
  await expect(
    panel(page).getByRole("button", { name: "Open", exact: true }),
  ).toHaveCount(0);
  expect(reads.get(page)).toEqual(["media-assets"]);
  await panel(page).getByRole("button", { name: "Close file actions" }).click();
  await expect(panel(page)).toHaveCount(0);
});
