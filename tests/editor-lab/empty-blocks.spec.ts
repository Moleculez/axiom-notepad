import { test, expect, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
});
const shared = (page: Page, source: string) =>
  expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([source, source]);
const pane = (page: Page) => page.locator('[data-pane="0"]');

for (const block of [
  "```python\nx\n```",
  "~~~julia\nx\n~~~",
  "$$\nx\n$$",
  "$$x$$",
  "> $$\r\n> x\r\n> $$",
  "> ```py\r\n> x\r\n> ```",
]) {
  test(
    "last-character deletion stays rich; the next Backspace removes the block: " +
      block,
    async ({ page }) => {
      const source = "Before\n\n" + block + "\n\nAfter";
      await page.evaluate(
        async ({ source, at }) => {
          await window.editorLab.reset(source);
          window.editorLab.focus(0, at);
        },
        { source, at: source.indexOf("x") + 1 },
      );
      const input = pane(page).locator(".axiom-embedded .cm-content");
      await expect(input).toBeFocused();
      await page.keyboard.press("Backspace");
      await expect(input).toBeFocused();
      await expect(input).toHaveText("");
      await expect(
        pane(page).locator('.axiom-source-prose[data-source-kind$="Block"]'),
      ).toHaveCount(0);
      const empty = await page.evaluate(
        () => window.editorLab.snapshot()[0].source,
      );
      await shared(page, empty);
      await page.keyboard.press("Backspace");
      await shared(
        page,
        "Before\n\n" + (block.startsWith("> ") ? "> " : "") + "\n\nAfter",
      );
      await expect(input).toHaveCount(0);
      await expect(pane(page).locator(".axiom-prose")).toBeFocused();
      await page.keyboard.press("ControlOrMeta+z");
      await shared(page, empty);
      await expect(input).toBeFocused();
      await page.keyboard.press("ControlOrMeta+z");
      await shared(page, source);
    },
  );
}

for (const opener of ["```py", "$$", "\\["]) {
  test(
    "already-empty Backspace removes both fences in one shared undo: " + opener,
    async ({ page }) => {
      const closer =
        opener === "\\[" ? "\\]" : opener.startsWith("`") ? "```" : "$$";
      const source = opener + "\n\n" + closer + "\n\nAfter";
      await page.evaluate(
        async ({ source, at }) => {
          await window.editorLab.reset(source);
          window.editorLab.focus(0, at);
        },
        { source, at: opener.length + 1 },
      );
      await page.keyboard.press("Backspace");
      await shared(page, "\n\nAfter");
      await page.keyboard.type("Plain");
      await shared(page, "Plain\n\nAfter");
      await page.keyboard.press("ControlOrMeta+z");
      await page.keyboard.press("ControlOrMeta+z");
      await shared(page, source);
    },
  );
}

test("select-all removes only literal contents and remote changes remain outside local undo", async ({
  page,
}) => {
  const source = "Before\n\n```py\nfirst\nlast\n```\n\nAfter";
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
    await window.editorLab.mode(1, "write");
    window.editorLab.focus(0, source.indexOf("first") + 2);
  }, source);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  const empty = source.replace("first\nlast", "");
  await shared(page, empty);
  await expect(pane(page).locator(".axiom-embedded .cm-content")).toBeFocused();
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await page.keyboard.press("Backspace");
  await shared(page, "Peer\n\nBefore\n\n\n\nAfter");
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, "Peer\n\n" + empty);
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, "Peer\n\n" + source);
});

for (const opener of ["```py", "$$"]) {
  test(
    "forward Delete and owned pairs keep an empty rich input available: " +
      opener,
    async ({ page }) => {
      const closer = opener.startsWith("`") ? "```" : "$$";
      const source = opener + "\nab \n" + closer + "\n\nAfter";
      await page.evaluate(
        async ({ source, at }) => {
          await window.editorLab.reset(source);
          window.editorLab.focus(0, at);
          window.editorLab.autoPair(0, true);
        },
        { source, at: opener.length + 1 },
      );
      for (let i = 0; i < 4; i++) await page.keyboard.press("Delete");
      await shared(page, opener + "\n\n" + closer + "\n\nAfter");
      const input = pane(page).locator(".axiom-embedded .cm-content");
      await expect(input).toBeFocused();
      await page.keyboard.type("(");
      await page.keyboard.press("Backspace");
      await expect(input).toBeFocused();
      await expect(input).toHaveText("");
      await page.keyboard.press("Backspace");
      await shared(page, "\n\nAfter");
    },
  );
}

test("read-only empty blocks are not removed", async ({ page }) => {
  const source = "$$\n\n$$\n\nAfter";
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
    window.editorLab.focus(0, 3);
    window.editorLab.readOnly(0, true);
  }, source);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  await shared(page, source);
});
