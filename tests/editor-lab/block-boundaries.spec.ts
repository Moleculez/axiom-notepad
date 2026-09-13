import { test, expect, type Page } from "@playwright/test";

const rich = (page: Page) => page.locator('[data-pane="0"] .axiom-prose');
const exact = (page: Page, source: string) =>
  expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([source, source]);
async function reset(page: Page, source: string, at = source.length) {
  await page.evaluate(
    async ({ source, at }) => {
      await window.editorLab.reset(source);
      window.editorLab.focus(0, at);
    },
    { source, at },
  );
}
test.beforeEach(async ({ page }) => {
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
});

for (const marker of ["-", "*", "+", "1.", "12)"]) {
  test("only a space activates the marker: " + marker, async ({ page }) => {
    await reset(page, "\n\nAfter", 0);
    await page.keyboard.type(marker);
    await expect(rich(page).locator("li")).toHaveCount(0);
    await expect(rich(page).locator(".axiom-source-prose").first()).toHaveText(
      marker,
    );
    await page.keyboard.type(" ");
    await expect(rich(page).locator("li")).toHaveCount(1);
    await page.keyboard.type("alpha");
    await exact(page, marker + " alpha\n\nAfter");
    await expect(rich(page).locator("li p")).toHaveText("alpha");
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.keyboard.type("second");
    await expect(rich(page).locator("li")).toHaveCount(1);
  });
}

test("quote exit inserts a real separator before subsequent typing", async ({
  page,
}) => {
  await reset(page, "> 1\n> 2");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("3");
  await exact(page, "> 1\n> 2\n\n3");
  await expect(rich(page).locator("blockquote")).not.toContainText("3");
  await expect(rich(page).locator(":scope > p").last()).toHaveText("3");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await exact(page, "> 1\n> 2\n> ");
});

test("empty nested list exits into a parent item, then outside the list", async ({
  page,
}) => {
  await reset(page, "> - parent\n>   - [ ] child");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("sibling");
  await exact(page, "> - parent\n>   - [ ] child\n> - sibling");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("quote paragraph");
  await exact(
    page,
    "> - parent\n>   - [ ] child\n> - sibling\n>\n> quote paragraph",
  );
  await expect(rich(page).locator("blockquote > p").last()).toHaveText(
    "quote paragraph",
  );
});

for (const [source, expected] of [
  ["- parent\n    - ", "- parent\n\n  prose"],
  ["> - parent\n>   - ", "> - parent\n>\n>   prose"],
  ["# ", "prose"],
  ["- [ ] ", "prose"],
  ["> ", "prose"],
  ["> [!NOTE]\n> ", "prose"],
  ["[^n]:\n    ", "prose"],
]) {
  test(
    "empty Backspace removes just its structure: " + source,
    async ({ page }) => {
      await reset(page, source);
      await page.keyboard.press("Backspace");
      await page.keyboard.type("prose");
      await exact(page, expected);
      await page.keyboard.press("ControlOrMeta+z");
      await page.keyboard.press("ControlOrMeta+z");
      await exact(page, source);
    },
  );
}

test("empty-cell Backspace preserves a populated table but removes an entirely empty one", async ({
  page,
}) => {
  const populated = "| A | B |\n| --- | --- |\n|  |  |";
  await reset(page, populated, populated.lastIndexOf("|  |") + 2);
  await page.keyboard.press("Backspace");
  await exact(page, populated);
  await expect(rich(page).locator("table")).toHaveCount(1);
  const empty = "|  |  |\n| --- | --- |\n|  |  |";
  await reset(page, empty, 2);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("outside");
  await exact(page, "outside");
});

test("range guides are local view decorations without layout, caret or document changes", async ({
  page,
}, info) => {
  const source =
    "---\ntitle: Research\nauthors:\n  - Ada\n  - Emmy\n---\n\n# Research\n\n- Parent\n  - [ ] Child with a wrapping observation\n\n> A quote\n>\n> > Nested perspective\n\n| A | B |\n| --- | --- |\n| x | y |\n\n$$\nx^2\n$$";
  await reset(page, source, source.indexOf("Child") + 5);
  await expect(rich(page).locator(".axiom-block-guide-active")).toHaveCount(1);
  expect(
    await rich(page).locator(".axiom-block-guide").count(),
  ).toBeGreaterThan(8);
  await expect(rich(page).locator("td.axiom-block-guide")).toHaveCount(0);
  const before = await page.evaluate(() => ({
    snapshot: window.editorLab.snapshot()[0],
    caret: window.editorLab.domSelection(0),
    boxes: Array.from(
      document.querySelectorAll('[data-pane="0"] .axiom-prose > *'),
      (n) => {
        const r = n.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      },
    ),
  }));
  await page.evaluate(() =>
    window.editorLab.appearance(0, { blockGuides: false }),
  );
  await expect(rich(page).locator(".axiom-block-guide")).toHaveCount(0);
  const after = await page.evaluate(() => ({
    snapshot: window.editorLab.snapshot()[0],
    caret: window.editorLab.domSelection(0),
    boxes: Array.from(
      document.querySelectorAll('[data-pane="0"] .axiom-prose > *'),
      (n) => {
        const r = n.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      },
    ),
  }));
  expect(after).toEqual(before);
  await page.evaluate(() =>
    window.editorLab.appearance(0, { blockGuides: true }),
  );
  await expect(rich(page).locator(".axiom-block-guide-active")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("block-guides-and-metadata.png"),
  });
  await page.evaluate(() => window.editorLab.mode(0, "read"));
  await expect(page.locator('[data-pane="0"] .axiom-block-guide')).toHaveCount(
    0,
  );
  await exact(page, source);
});
