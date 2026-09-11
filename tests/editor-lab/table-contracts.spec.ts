import { test, expect, type Page } from "@playwright/test";

const basic = "| A | B |\n| --- | --- |\n| x | y |";
const pane = (page: Page) => page.locator('[data-pane="0"]');
const source = (page: Page) =>
  page.evaluate(() => window.editorLab.snapshot()[0].source);
const reset = (page: Page, text: string) =>
  page.evaluate((text) => window.editorLab.reset(text), text);
const focus = (page: Page, at: number) =>
  page.evaluate((at) => window.editorLab.focus(0, at), at);
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

test("leaving a table panel releases editing focus without moving or changing its source", async ({
  page,
}) => {
  await reset(page, basic.replace("x", "**value**"));
  await focus(page, basic.indexOf("x") + 4);
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("dialog", { name: "Table actions" }),
  ).toBeVisible();
  await page.locator("header").click();
  await expect(page.getByRole("dialog", { name: "Table actions" })).toHaveCount(
    0,
  );
  await expect(pane(page).locator(".axiom-table-shell")).toHaveAttribute(
    "data-active",
    "false",
  );
  await expect(pane(page).locator("td").first()).toHaveText("value");
  expect(await source(page)).toBe(basic.replace("x", "**value**"));
});

test("table link details follow preceding edits and reject overlapping replacements", async ({
  page,
}) => {
  const text =
    "| A | B |\n| --- | --- |\n| [paper](https://example.org) | value |\n";
  await reset(page, text);
  await focus(page, text.indexOf("paper") + 2);
  await page.keyboard.press("Shift+F10");
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await page
    .getByRole("button", { name: "Edit link details", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Link text", exact: true }),
  ).toHaveValue("paper");
  await page
    .getByRole("textbox", { name: "Link text", exact: true })
    .fill("study");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(() => source(page))
    .toBe(
      "Peer\n\n" +
        text.replace(
          "[paper](https://example.org)",
          "[study](<https://example.org>)",
        ),
    );
  await reset(page, text);
  await focus(page, text.indexOf("paper") + 2);
  await page.keyboard.press("Shift+F10");
  await page.evaluate(
    (at) => window.editorLab.remote(1, at, at + 5, "other"),
    text.indexOf("paper"),
  );
  await page
    .getByRole("button", { name: "Edit link details", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Link details", exact: true }),
  ).toHaveCount(0);
  await expect.poll(() => source(page)).toBe(text.replace("paper", "other"));
});

for (const prefix of ["> ", "  "])
  test(`nested ${JSON.stringify(prefix)} CRLF table appends and focuses new cells without touching its container`, async ({
    page,
  }) => {
    const lead = prefix === "  " ? "- Experiment\r\n\r\n" : "Before\r\n\r\n";
    const text =
      lead +
      basic
        .split("\n")
        .map((row) => prefix + row)
        .join("\r\n");
    await reset(page, text);
    const table = pane(page).locator(".axiom-table-shell");
    await table.hover();
    const add = table.getByRole("button", { name: "Add column at right" });
    await add.focus();
    await add.press("Enter");
    await page.keyboard.type("new");
    await expect
      .poll(() => source(page))
      .toBe(
        lead +
          ["| A | B |  |", "| --- | --- | --- |", "| x | y | new |"]
            .map((row) => prefix + row)
            .join("\r\n"),
      );
    await table.getByRole("button", { name: "Add row at bottom" }).click();
    await page.keyboard.type("last");
    await expect
      .poll(() => source(page))
      .toContain("\r\n" + prefix + "|  |  | last |");
    expect((await source(page)).endsWith("\n")).toBe(false);
  });

test("header-only tables allow a first row and hovered tables do not use another table's caret", async ({
  page,
}) => {
  const first = basic + "\n\n";
  await reset(page, first + "| C |\n| --- |");
  await focus(page, basic.indexOf("x"));
  const table = pane(page).locator(".axiom-table-shell").last();
  await table.getByRole("button", { name: "Add row at bottom" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.type("value");
  await expect
    .poll(() => source(page))
    .toBe(first + "| C |\n| --- |\n| value |");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => source(page)).toBe(first + "| C |\n| --- |");
});

test("keyboard tabs expose alignment, protected-header reasons and live read-only guards", async ({
  page,
}) => {
  await reset(page, basic);
  await focus(page, basic.indexOf("A"));
  await page.keyboard.press("Shift+F10");
  const panel = page.getByRole("dialog", {
    name: "Table actions",
    exact: true,
  });
  const remove = panel.getByRole("button", {
    name: "Delete table row",
    exact: true,
  });
  await expect(remove).toHaveAttribute("aria-disabled", "true");
  await remove.focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "header row is protected",
  );
  await panel.getByRole("tab", { name: "Row", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    panel.getByRole("tab", { name: "Column", exact: true }),
  ).toBeFocused();
  await panel
    .getByRole("button", { name: "Align column center", exact: true })
    .click();
  await expect
    .poll(() => source(page))
    .toBe(basic.replace("| --- |", "| :---: |"));
  await page.keyboard.press("Shift+F10");
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await expect(
    panel.getByRole("button", { name: "Insert row below", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    pane(page).getByRole("button", { name: "Add row at bottom" }),
  ).toBeHidden();
  const before = await source(page);
  await panel
    .getByRole("button", { name: "Insert row below", exact: true })
    .evaluate((el: HTMLButtonElement) => el.click());
  expect(await source(page)).toBe(before);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("wide-table scroll, resize, hover and menus create no document updates", async ({
  page,
}) => {
  const text = [
    Array.from({ length: 12 }, (_, i) => `C${i}`).join(" | "),
    Array(12).fill("---").join(" | "),
    Array(12).fill("value").join(" | "),
  ]
    .map((row) => "| " + row + " |")
    .join("\n");
  await reset(page, text);
  await focus(page, text.indexOf("value"));
  const before = await page.evaluate(() =>
    window.editorLab.snapshot().map((s) => s.updates),
  );
  const table = pane(page).locator(".axiom-table-shell");
  const scroller = table.locator(".axiom-table-scroll");
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  const cell = (await table.locator("th").first().boundingBox())!;
  await page.mouse.move(cell.x + cell.width - 2, cell.y + cell.height / 2);
  await page.mouse.down();
  await page.mouse.move(cell.x + cell.width + 44, cell.y + cell.height / 2);
  await page.mouse.up();
  expect(
    (await table.locator("th").first().boundingBox())!.width,
  ).toBeGreaterThan(cell.width + 25);
  await scroller.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await table
    .getByRole("button", { name: "Table actions", exact: true })
    .click();
  const panel = page.getByRole("dialog", {
    name: "Table actions",
    exact: true,
  });
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.x).toBeGreaterThanOrEqual(12);
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    ),
  ).toEqual(before);
  expect(await source(page)).toBe(text);
});

test("table structural chrome cannot interrupt an in-progress composition", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "CDP composition is not physical IME acceptance.",
  );
  await reset(page, basic);
  await focus(page, basic.indexOf("x") + 1);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.imeSetComposition", {
      text: "yan",
      selectionStart: 3,
      selectionEnd: 3,
    });
    await pane(page)
      .getByRole("button", { name: "Add row at bottom" })
      .evaluate((el: HTMLButtonElement) => el.click());
    expect(await source(page)).toBe(basic);
    await cdp.send("Input.insertText", { text: "研究" });
    await expect.poll(() => source(page)).toBe(basic.replace("x", "x研究"));
    expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
  } finally {
    await cdp.detach();
  }
});

for (const [kind, text, anchor, insert] of [
  ["codeBlock", "```python\nvalue = 1\n```", 14, "2"],
  ["mathBlock", "$$\nx + y\n$$", 4, "^2"],
] as const)
  test(`${kind} first-block hover controls retain the exact embedded caret after Escape`, async ({
    page,
  }) => {
    await reset(page, text);
    await focus(page, anchor);
    const block = pane(page).locator(`.axiom-embedded[data-kind="${kind}"]`);
    await block.hover();
    await block
      .getByRole("button", { name: "Block actions", exact: true })
      .click();
    await expect(
      page.getByRole("menu", { name: "Block actions" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.type(insert);
    await expect
      .poll(() => source(page))
      .toBe(text.slice(0, anchor) + insert + text.slice(anchor));
  });
