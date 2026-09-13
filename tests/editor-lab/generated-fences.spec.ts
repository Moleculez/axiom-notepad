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
const input = (page: Page) =>
  page.locator('[data-pane="0"] .axiom-embedded .cm-content');

for (const [opener, ending] of [
  ["$$", "\n"],
  ["```", "\n"],
  ["```python", "\n"],
  ["~~~~julia", "\n"],
  ["> $$", "\r\n"],
  ["> > ```py", "\r\n"],
  ["- $$", "\n"],
  ["- ```py", "\n"],
]) {
  test(
    "generated empty fences remove as one operation and retain the parent: " +
      opener,
    async ({ page }) => {
      const before = "Before" + ending.repeat(2),
        suffix = ending.repeat(2) + "After";
      await page.evaluate(
        async ({ source, at }) => {
          await window.editorLab.reset(source);
          window.editorLab.focus(0, at);
        },
        { source: before + suffix, at: before.length },
      );
      await page.keyboard.type(opener);
      await page.keyboard.press("Enter");
      await expect(input(page)).toBeFocused();
      const complete = await page.evaluate(
        () => window.editorLab.snapshot()[0].source,
      );
      const updates = await page.evaluate(
        () => window.editorLab.snapshot()[0].updates,
      );
      await page.keyboard.press("Backspace");
      await expect(input(page)).toHaveCount(0);
      const removed = await page.evaluate(
        () => window.editorLab.snapshot()[0].source,
      );
      expect(removed.startsWith(before)).toBe(true);
      expect(removed.endsWith(suffix)).toBe(true);
      expect(removed).not.toContain("$$");
      expect(removed).not.toContain("```");
      expect(removed).not.toContain("~~~");
      if (opener.startsWith(">"))
        expect(removed).toContain(
          opener.slice(0, opener.indexOf(opener.includes("`") ? "`" : "$")),
        );
      if (opener.startsWith("-")) expect(removed).toContain("- ");
      expect(
        await page.evaluate(() => window.editorLab.snapshot()[0].updates),
      ).toBe(updates + 1);
      await page.keyboard.press("ControlOrMeta+z");
      await shared(page, complete);
      await expect(input(page)).toBeFocused();
      await page.keyboard.type("x");
      const populated = await page.evaluate(
        () => window.editorLab.snapshot()[0].source,
      );
      await page.keyboard.press("Backspace");
      await shared(page, complete);
      await expect(input(page)).toBeFocused();
      await page.keyboard.press("Backspace");
      await shared(page, removed);
      await page.keyboard.press("ControlOrMeta+z");
      await shared(page, complete);
      await page.keyboard.press("ControlOrMeta+z");
      await shared(page, populated);
    },
  );
}
for (const opener of ["$$", "```py"]) {
  test(
    "peer changes remain outside local literal deletion undo: " + opener,
    async ({ page }) => {
      await page.evaluate(async () => {
        await window.editorLab.reset("");
        window.editorLab.focus(0, 0);
      });
      await page.keyboard.type(opener);
      await page.keyboard.press("Enter");
      const empty = await page.evaluate(
        () => window.editorLab.snapshot()[0].source,
      );
      await page.keyboard.type("first");
      await page.keyboard.press("Enter");
      await page.keyboard.type("last");
      const populated = await page.evaluate(
        () => window.editorLab.snapshot()[0].source,
      );
      await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
      await shared(page, "Peer\n\n" + empty);
      await page.keyboard.press("Backspace");
      await shared(page, "Peer\n\n\n\n");
      await page.keyboard.press("ControlOrMeta+z");
      await shared(page, "Peer\n\n" + empty);
      await page.keyboard.press("ControlOrMeta+z");
      await shared(page, "Peer\n\n" + populated);
    },
  );
  test(
    "a replaced closer does not prevent deliberate empty-block removal: " +
      opener,
    async ({ page }) => {
      await page.evaluate(async () => {
        await window.editorLab.reset("");
        window.editorLab.focus(0, 0);
      });
      await page.keyboard.type(opener);
      await page.keyboard.press("Enter");
      const source = await page.evaluate(
        () => window.editorLab.snapshot()[0].source,
      );
      await page.evaluate(() => {
        const source = window.editorLab.snapshot()[0].source;
        const at = source.lastIndexOf(source.startsWith("$$") ? "$$" : "```");
        window.editorLab.remote(1, at, at + 1, source[at]);
      });
      await page.keyboard.press("Backspace");
      await shared(page, "\n\n");
      await page.keyboard.press("ControlOrMeta+z");
      await shared(page, source);
    },
  );
  test(
    "read-only permissions protect newly generated fences: " + opener,
    async ({ page }) => {
      await page.evaluate(async () => {
        await window.editorLab.reset("");
        window.editorLab.focus(0, 0);
      });
      await page.keyboard.type(opener);
      await page.keyboard.press("Enter");
      const source = await page.evaluate(
        () => window.editorLab.snapshot()[0].source,
      );
      await page.evaluate(() => window.editorLab.readOnly(0, true));
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Delete");
      await shared(page, source);
    },
  );
}
test("removing an empty block cannot capture a later authored fence", async ({
  page,
}) => {
  const suffix = "\n\nAfter\n\n```js\nkeep\n```";
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
    window.editorLab.focus(0, 0);
  }, suffix);
  await page.keyboard.type("```");
  await page.keyboard.press("Enter");
  await page.keyboard.type("ab ");
  await page.keyboard.press("Home");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Delete");
  await expect(input(page).first()).toBeFocused();
  await page.keyboard.press("Backspace");
  await shared(page, "\n\n" + suffix);
  await expect(input(page)).toHaveCount(1);
  await expect(input(page)).toHaveText("keep");
});
