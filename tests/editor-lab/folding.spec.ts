import { expect, test, type Page } from "@playwright/test";
const selectionWarnings = new WeakMap<Page, string[]>();
const pane = (page: Page) => page.locator('[data-pane="0"]');
const folds = (page: Page) => pane(page).locator(".axiom-folded-block");
const toggle = (page: Page, name: RegExp) =>
  pane(page)
    .getByRole("group", { name: "Block folding" })
    .getByRole("button", { name });
async function reset(page: Page, source: string) {
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
    window.editorLab.focus(0, 0);
  }, source);
  await pane(page).hover();
}
test.beforeEach(async ({ page }) => {
  const warnings: string[] = [];
  selectionWarnings.set(page, warnings);
  page.on("console", (message) => {
    if (message.text().includes("TextSelection endpoint"))
      warnings.push(message.text());
  });
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
  expect(selectionWarnings.get(page)).toEqual([]);
});
for (const [label, body] of [
  ["python code", "```python\ndef energy(m):\n    return m * c**2\n```"],
  ["equation", "$$\nE = mc^2\n$$"],
  ["list", "- Research\n- Reproduce"],
  ["quote", "> Evidence\n>\n> Context"],
  ["table", "| A | B |\n| --- | --- |\n| C | D |"],
  ["footnote n", "[^n]: Evidence\n\n    More context"],
  ["metadata", "---\ntitle: Research\nauthor: Ada\n---"],
]) {
  test(`fold ${label} locally and expand without a source edit or undo entry`, async ({
    page,
  }) => {
    const source = body + "\n\nAfter";
    await reset(page, source);
    const before = await page.evaluate(() => window.editorLab.snapshot());
    await toggle(page, new RegExp(`^Collapse ${label}`)).click();
    await expect(folds(page)).toHaveCount(1);
    await expect(page.locator('[data-pane="1"] .cm-content')).toContainText(
      body.split("\n")[0],
    );
    await toggle(page, new RegExp(`^Expand ${label}`)).press("ArrowRight");
    await expect(folds(page)).toHaveCount(0);
    const after = await page.evaluate(() => window.editorLab.snapshot());
    expect(
      after.map(({ source, undo, updates }) => ({
        source,
        undo,
        updates,
      })),
    ).toEqual(
      before.map(({ source, undo, updates }) => ({
        source,
        undo,
        updates,
      })),
    );
  });
}
for (const prefix of ["", "Before\n\n"]) {
  test(`folding ${prefix ? "the last block" : "the only block"} retains a valid caret and resumes editing`, async ({
    page,
  }) => {
    const body = "```py\nx = 1\ny = 2\n```",
      source = prefix + body;
    await reset(page, source);
    await page.evaluate(
      (at) => window.editorLab.focus(0, at),
      source.indexOf("x = 1"),
    );
    await toggle(page, /^Collapse py code/).click();
    await expect(folds(page)).toHaveCount(1);
    await expect(toggle(page, /^Expand py code/)).toBeFocused();
    await folds(page).getByRole("button").click();
    await expect(folds(page)).toHaveCount(0);
    await page.keyboard.type("# ");
    expect(
      await page.evaluate(() =>
        window.editorLab.snapshot().map((s) => s.source),
      ),
    ).toEqual([
      source.replace("x = 1", "# x = 1"),
      source.replace("x = 1", "# x = 1"),
    ]);
  });
}
test("a backward selection spanning a fold reveals the range and edits exact Markdown", async ({
  page,
}) => {
  const source = "Before\n\n- One\n- Two\n\nAfter";
  await reset(page, source);
  await toggle(page, /^Collapse list/).click();
  await page.evaluate(
    (end) => window.editorLab.focus(0, end, 0),
    source.length,
  );
  await expect(folds(page)).toHaveCount(0);
  await page.keyboard.type("Replacement");
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual(["Replacement", "Replacement"]);
});
test("nested folds survive parent toggles and peer edits; navigation reveals hidden content", async ({
  page,
}, info) => {
  let source =
    "Intro\n\n- Parent\n  - Child\n  - Sibling\n- Next\n\n```py\nx = 1\ny = 2\n```\n\nEnd";
  await reset(page, source);
  await toggle(page, /^Collapse list: Child/).click();
  await toggle(page, /^Collapse list: Parent/).click();
  await expect(folds(page)).toHaveCount(1);
  await toggle(page, /^Expand list: Parent/).click();
  await expect(folds(page)).toHaveCount(1);
  await expect(folds(page)).toContainText("Child");
  await expect
    .poll(async () => {
      const positions = await pane(page)
        .locator(".axiom-fold-toggle")
        .evaluateAll((buttons) =>
          buttons.map((b) => b.getBoundingClientRect().top),
        );
      return positions.every((top, i) => i === 0 || top >= positions[i - 1]);
    })
    .toBe(true);
  await toggle(page, /^Collapse py code/).click();
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Before\n\n"));
  source = "Before\n\n" + source;
  await expect(folds(page)).toHaveCount(2);
  const from = source.indexOf("x = 1") + 4;
  await page.evaluate(
    ({ from }) => window.editorLab.remote(1, from, from + 1, "22"),
    { from },
  );
  source = source.replace("x = 1", "x = 22");
  await expect(folds(page)).toContainText(["Child", "x = 22"]);
  await page.screenshot({ path: info.outputPath("monaco-style-folding.png") });
  await page.evaluate(
    (at) => window.editorLab.focus(0, at),
    source.indexOf("x = 22"),
  );
  await expect(folds(page)).toHaveCount(1);
  await page.keyboard.type("# ");
  source = source.replace("x = 22", "# x = 22");
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([source, source]);
});
test("folds stay local across mode switches, preference toggles and read-only access", async ({
  page,
}) => {
  const source = "```py\nx = 1\ny = 2\n```\n\nAfter";
  await reset(page, source);
  await toggle(page, /^Collapse py code/).click();
  await page.evaluate(() =>
    window.editorLab.appearance(0, { blockGuides: false }),
  );
  await expect(toggle(page, /^Expand py code/)).toBeVisible();
  await page.evaluate(() => window.editorLab.mode(0, "source"));
  await expect(pane(page).locator(".cm-content")).toContainText("y = 2");
  await expect(pane(page).locator(".axiom-folding-gutter")).toHaveCount(0);
  await page.evaluate(() => window.editorLab.mode(0, "write"));
  await expect(folds(page)).toHaveCount(1);
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await toggle(page, /^Expand py code/).click();
  await expect(folds(page)).toHaveCount(0);
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([source, source]);
});

test("folded footnote code maps to original Markdown and printing reveals the full document temporarily", async ({
  page,
}) => {
  const source =
    "[^n]: Evidence\n\n    ```py\n    x = 1\n    y = 2\n    ```\n\nAfter";
  await reset(page, source);
  await toggle(page, /^Collapse py code/).click();
  await expect(folds(page)).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(folds(page)).toHaveCount(0);
  await expect(pane(page).locator(".axiom-footnote")).toContainText("y = 2");
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(folds(page)).toHaveCount(1);
  await page.evaluate(() => window.editorLab.remote(1, 20, 21, "`"));
  await expect(folds(page)).toHaveCount(0);
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([source, source]);
});
