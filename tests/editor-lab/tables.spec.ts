import { test, expect, type Page } from "@playwright/test";

const body = "| A | B |\n| --- | --- |\n| alpha | beta |\n\nAfter";
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
  await page.evaluate((source) => window.editorLab.reset(source), body);
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));
const pane = (page: Page) => page.locator('[data-pane="0"]');
const sources = (page: Page) =>
  page.evaluate(() => window.editorLab.snapshot().map((s) => s.source));

test("edge controls append to the hovered table, keep typography stable and share undo", async ({
  page,
}) => {
  const table = pane(page).locator(".axiom-table-shell");
  const cell = table.locator("td").first();
  const before = await cell.boundingBox();
  const box = (await table.locator(".axiom-table-scroll").boundingBox())!;
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
  await expect(
    table.getByRole("button", { name: "Add column at right" }),
  ).toBeVisible();
  await table.getByRole("button", { name: "Add column at right" }).click();
  await expect(table.locator("th")).toHaveCount(3);
  await page.keyboard.type("new");
  await expect
    .poll(() => sources(page))
    .toEqual([
      "| A | B |  |\n| --- | --- | --- |\n| alpha | beta | new |\n\nAfter",
      "| A | B |  |\n| --- | --- | --- |\n| alpha | beta | new |\n\nAfter",
    ]);
  await table.getByRole("button", { name: "Add row at bottom" }).click();
  await page.keyboard.type("last");
  await expect
    .poll(async () => (await sources(page))[0])
    .toContain("|  |  | last |");
  await expect(table.locator("tr")).toHaveCount(3);
  expect(before!.height).toBeGreaterThan(20);
  expect(
    await table
      .locator("table")
      .evaluate((el) => getComputedStyle(el).borderRadius),
  ).toBe("0px");
  const after = await cell.boundingBox();
  await table.hover();
  expect((await cell.boundingBox())?.height).toBe(after?.height);
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(table.locator("tr")).toHaveCount(2);
});

test("compact Row/Column/Table panel preserves its caret on cancel and shows tooltips", async ({
  page,
}) => {
  const table = pane(page).locator(".axiom-table-shell");
  await page.evaluate(
    (at) => window.editorLab.focus(0, at),
    body.indexOf("alpha") + 5,
  );
  const before = await page.evaluate(() => window.editorLab.snapshot()[0]);
  await table
    .getByRole("button", { name: "Table actions", exact: true })
    .click();
  const panel = page.getByRole("dialog", {
    name: "Table actions",
    exact: true,
  });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("tab")).toHaveCount(3);
  expect((await panel.boundingBox())!.height).toBeLessThan(280);
  await panel
    .getByRole("button", { name: "Insert row below", exact: true })
    .hover();
  await expect(page.getByRole("tooltip")).toContainText("Insert row below");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.keyboard.type("!");
  await expect
    .poll(async () => (await sources(page))[0])
    .toBe(body.replace("alpha", "alpha!"));
  expect(before.source).toBe(body);
});

test("table menus rebase around cell and preceding peer edits but reject replacement", async ({
  page,
}) => {
  await page.evaluate(
    (at) => window.editorLab.focus(0, at),
    body.indexOf("alpha"),
  );
  const table = pane(page).locator(".axiom-table-shell");
  await table
    .getByRole("button", { name: "Table actions", exact: true })
    .click();
  const panel = page.getByRole("dialog", {
    name: "Table actions",
    exact: true,
  });
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await panel
    .getByRole("button", { name: "Insert row below", exact: true })
    .click();
  await expect(table.locator("tr")).toHaveCount(3);
  await expect.poll(async () => (await sources(page))[0]).toContain("Peer\n\n");
  await table
    .getByRole("button", { name: "Table actions", exact: true })
    .click();
  await page.evaluate(() => {
    const source = window.editorLab.snapshot()[0].source;
    const at = source.indexOf("| alpha");
    window.editorLab.remote(1, at, at, "| peer | row |\n");
  });
  await expect(
    panel.getByRole("button", { name: "Insert row below", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  const before = await sources(page);
  await panel
    .getByRole("button", { name: "Insert row below", exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  expect(await sources(page)).toEqual(before);
});
