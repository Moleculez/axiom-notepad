import { test, expect, type Page, type Locator } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

const exact = async (page: Page, source: string, at: number) => {
  await expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([source, source]);
  await expect
    .poll(() => page.evaluate(() => window.editorLab.snapshot()[0].selection))
    .toEqual({ anchor: at, head: at });
  await expect
    .poll(() => page.evaluate(() => window.editorLab.domSelection(0)))
    .toEqual({ anchor: at, head: at });
};
const typography = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      size: style.fontSize,
      family: style.fontFamily,
      weight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      color: style.color,
      marginTop: style.marginTop,
      marginBottom: style.marginBottom,
      minHeight: style.minHeight,
    };
  });

for (const level of [1, 2, 3, 4, 5, 6]) {
  test(`H${level} keeps heading typography and editable hashes while typing, leaving and returning`, async ({
    page,
  }) => {
    await page.evaluate(async () => {
      // Device appearance tokens must apply equally to active and resting headings.
      document.documentElement.style.setProperty(
        "--font-heading",
        "Georgia, serif",
      );
      document.documentElement.style.setProperty("--weight-heading", "600");
      document.documentElement.style.setProperty("--heading-scale", "1.15");
      await window.editorLab.reset("");
      window.editorLab.focus(0, 0);
    });
    const pane = page.locator('[data-pane="0"]');
    const source = "#".repeat(level) + " A research result";
    let typed = "";
    for (const character of source) {
      await page.keyboard.type(character);
      typed += character;
      await exact(page, typed, typed.length);
      await expect(pane.locator(".axiom-source-prose")).toHaveText(typed, {
        useInnerText: false,
      });
    }
    const active = pane.locator(`h${level}.axiom-source-prose`);
    await expect(active).toHaveText(source);
    await expect(active.locator(".axiom-syntax")).toHaveText(
      "#".repeat(level) + " ",
      { useInnerText: false },
    );
    const before = await typography(active);
    expect(before.family).toBe("Georgia, serif");
    expect(before.weight).toBe("600");
    expect((await typography(active.locator(".axiom-syntax"))).size).toBe(
      before.size,
    );
    await page.keyboard.press("Enter");
    await exact(page, source + "\n\n", source.length + 2);
    const resting = pane.locator(`h${level}:not(.axiom-source-prose)`);
    await expect(resting).toHaveText("A research result");
    expect(await typography(resting)).toEqual(before);
    await page.keyboard.type("Body");
    await exact(page, source + "\n\nBody", source.length + 6);
    const updates = await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    );
    await resting.click();
    await expect(active).toHaveText(source);
    expect(await typography(active)).toEqual(before);
    expect(
      await page.evaluate(() =>
        window.editorLab.snapshot().map((s) => s.updates),
      ),
    ).toEqual(updates);
  });
}

test("deleting a heading marker resets paragraph styling and undo restores the heading", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.editorLab.reset("# Heading");
    window.editorLab.focus(0, 1);
  });
  const pane = page.locator('[data-pane="0"]');
  await expect(pane.locator("h1.axiom-source-prose")).toHaveText("# Heading");
  await page.keyboard.press("Backspace");
  await exact(page, " Heading", 0);
  await expect(pane.locator("p.axiom-source-prose")).toHaveText(" Heading", {
    useInnerText: false,
  });
  await expect(pane.locator("h1")).toHaveCount(0);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await exact(page, "# Heading", 1);
  await expect(pane.locator("h1.axiom-source-prose")).toHaveText("# Heading");
});

test("peer heading-level edits retain the local caret and Source mode stays literal", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.editorLab.reset("# Heading\n\nAfter");
    window.editorLab.focus(0, 5);
  });
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "##"));
  await exact(page, "### Heading\n\nAfter", 7);
  const pane = page.locator('[data-pane="0"]');
  await expect(pane.locator("h3.axiom-source-prose")).toHaveText("### Heading");
  await page.keyboard.type("X");
  await exact(page, "### HeaXding\n\nAfter", 8);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await exact(page, "### Heading\n\nAfter", 7);
  const before = await page.evaluate(() =>
    window.editorLab.snapshot().map((s) => s.updates),
  );
  await page.evaluate(() => window.editorLab.mode(0, "source"));
  await expect(pane.locator(".cm-content")).toContainText("### Heading");
  await expect(pane.locator("h3")).toHaveCount(0);
  await page.evaluate(() => window.editorLab.mode(0, "write"));
  await expect(pane.locator("h3.axiom-source-prose")).toHaveText("### Heading");
  expect(
    await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    ),
  ).toEqual(before);
});
