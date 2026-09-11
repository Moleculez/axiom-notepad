import { test, expect, type Page } from "@playwright/test";

const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  failures.set(page, []);
  page.on("pageerror", (error) => failures.get(page)!.push(error.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(({ page }) => expect(failures.get(page)).toEqual([]));

const shared = (page: Page, source: string) =>
  expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([source, source]);

for (const marker of ["***", "---", "___", "* * *"]) {
  test(`clicking ${marker} keeps a rendered divider; Backspace and undo operate on the whole block`, async ({
    page,
  }) => {
    const source = `Before.\r\n\r\n${marker}\r\n\r\nAfter.`;
    await page.evaluate((source) => window.editorLab.reset(source), source);
    const pane = page.locator('[data-pane="0"]'),
      divider = pane.getByRole("separator", { name: "Divider", exact: true });
    await divider.locator("hr").click();
    await expect(divider).toBeVisible();
    await expect(
      divider.locator(".cm-editor, .axiom-block-controls"),
    ).toHaveCount(0);
    await expect(
      pane.locator('.axiom-source-prose[data-source-kind="hr"]'),
    ).toHaveCount(0);
    await shared(page, source);
    expect(
      await page.evaluate(() =>
        window.editorLab.snapshot().map((s) => s.updates),
      ),
    ).toEqual([0, 0]);
    await page.keyboard.press("Backspace");
    await expect(divider).toHaveCount(0);
    await shared(page, source.replace(marker + "\r\n", ""));
    await page.keyboard.press("ControlOrMeta+z");
    await shared(page, source);
    await expect(divider).toBeVisible();
    await divider.dblclick();
    await expect(divider).toBeVisible();
    await shared(page, source);
  });
}

test("divider selection rebases around peer edits and retains the peer text on undo", async ({
  page,
}) => {
  const source = "Before\n\n***\n\nAfter";
  await page.evaluate((source) => window.editorLab.reset(source), source);
  const divider = page.locator('[data-pane="0"] .axiom-divider');
  await divider.click();
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await expect(divider).toBeVisible();
  await page.keyboard.press("Backspace");
  await shared(page, "Peer\n\nBefore\n\n\nAfter");
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, "Peer\n\n" + source);
});

test("keyboard focus, read-only mode and Source mode preserve the rendered divider contract", async ({
  page,
}) => {
  const source = "Before\n\n***\n\nAfter";
  await page.evaluate((source) => window.editorLab.reset(source), source);
  const pane = page.locator('[data-pane="0"]'),
    divider = pane.getByRole("separator", { name: "Divider", exact: true });
  await divider.focus();
  await expect(divider).toBeVisible();
  await page.keyboard.press("Delete");
  await shared(page, source.replace("***\n", ""));
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, source);
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await divider.click();
  await page.keyboard.press("Backspace");
  await expect(divider).toBeVisible();
  await shared(page, source);
  await page.evaluate(async () => {
    window.editorLab.readOnly(0, false);
    await window.editorLab.mode(0, "source");
  });
  await expect(pane.locator(".cm-content")).toContainText("***");
  await page.evaluate(() => window.editorLab.mode(0, "write"));
  await expect(divider).toBeVisible();
  await expect(
    pane.locator('.axiom-source-prose[data-source-kind="hr"]'),
  ).toHaveCount(0);
  await shared(page, source);
});
