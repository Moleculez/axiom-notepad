import { test, expect, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));
const shared = (page: Page, source: string) =>
  expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([source, source]);
const caret = (page: Page, at: number) =>
  expect
    .poll(() => page.evaluate(() => window.editorLab.domSelection(0)))
    .toEqual({ anchor: at, head: at });

for (const [opener, ending] of [
  ["$$", "\n"],
  ["```", "\n"],
  ["```python", "\n"],
  ["~~~~julia", "\n"],
  ["> $$", "\r\n"],
  ["> > ```py", "\r\n"],
  ["- $$", "\n"],
  ["- ```py", "\n"],
] as const) {
  test(`Enter and empty deletion restore just the authored opener with caret/history: ${opener}`, async ({
    page,
  }) => {
    const prefix = "Before" + ending.repeat(2),
      suffix = ending.repeat(2) + "After";
    await page.evaluate(
      async ({ source, at }) => {
        await window.editorLab.reset(source);
        window.editorLab.focus(0, at);
      },
      { source: prefix + suffix, at: prefix.length },
    );
    await page.keyboard.type(opener);
    const draft = prefix + opener + suffix;
    await shared(page, draft);
    await page.keyboard.press("Enter");
    const pane = page.locator('[data-pane="0"]'),
      input = pane.locator(".axiom-embedded .cm-content");
    await expect(input).toBeFocused();
    const completed = await page.evaluate(
      () => window.editorLab.snapshot()[0].source,
    );
    const updates = await page.evaluate(
      () => window.editorLab.snapshot()[0].updates,
    );
    await page.keyboard.press("Backspace");
    await shared(page, draft);
    await expect(input).toHaveCount(0);
    await expect(pane.locator(".axiom-prose")).toBeFocused();
    await caret(page, prefix.length + opener.length);
    expect(
      await page.evaluate(() => window.editorLab.snapshot()[0].updates),
    ).toBe(updates + 1);
    await page.keyboard.press("ControlOrMeta+z");
    await shared(page, completed);
    await expect(input).toBeFocused();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await shared(page, draft);
    await caret(page, prefix.length + opener.length);
    // Re-entry does not add blank lines, and typing before emptying is the same handoff.
    await page.keyboard.press("Enter");
    await shared(page, completed);
    await expect(input).toBeFocused();
    await page.keyboard.type("x");
    const populated = await page.evaluate(
      () => window.editorLab.snapshot()[0].source,
    );
    const writtenUpdates = await page.evaluate(
      () => window.editorLab.snapshot()[0].updates,
    );
    await page.keyboard.press("Backspace");
    await shared(page, draft);
    await caret(page, prefix.length + opener.length);
    expect(
      await page.evaluate(() => window.editorLab.snapshot()[0].updates),
    ).toBe(writtenUpdates + 1);
    await page.keyboard.press("ControlOrMeta+z");
    await shared(page, populated);
    await expect(input).toBeFocused();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await shared(page, draft);
    await page.keyboard.press("Backspace");
    await shared(page, prefix + opener.slice(0, -1) + suffix);
    await expect(input).toHaveCount(0);
  });
}

for (const opener of ["$$", "```py"]) {
  test(`multiline deletion rebases through peer edits above and leaves them outside undo: ${opener}`, async ({
    page,
  }) => {
    await page.evaluate(async () => {
      await window.editorLab.reset("");
      window.editorLab.focus(0, 0);
    });
    await page.keyboard.type(opener);
    await page.keyboard.press("Enter");
    await page.keyboard.type("first");
    await page.keyboard.press("Enter");
    await page.keyboard.type("last");
    const populated = await page.evaluate(
      () => window.editorLab.snapshot()[0].source,
    );
    await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await shared(page, "Peer\n\n" + opener);
    await caret(page, 6 + opener.length);
    await page.keyboard.press("ControlOrMeta+z");
    await shared(page, "Peer\n\n" + populated);
  });

  test(`peer-owned body or replacement closer uses lossless full-source handoff: ${opener}`, async ({
    page,
  }) => {
    for (const part of ["body", "closer"]) {
      await page.evaluate(async () => {
        await window.editorLab.reset("");
        window.editorLab.focus(0, 0);
      });
      await page.keyboard.type(opener);
      await page.keyboard.press("Enter");
      const empty = await page.evaluate(
        () => window.editorLab.snapshot()[0].source,
      );
      if (part === "body") {
        await page.evaluate(() => {
          const at = window.editorLab.snapshot()[0].selection.head;
          window.editorLab.remote(1, at, at, "peer");
        });
        await page.keyboard.press("ControlOrMeta+a");
      } else {
        await page.evaluate(() => {
          const source = window.editorLab.snapshot()[0].source;
          const at = source.lastIndexOf(source.startsWith("$$") ? "$$" : "```");
          window.editorLab.remote(1, at, at + 1, source[at]);
        });
      }
      await page.keyboard.press("Backspace");
      await shared(page, empty);
      await expect(
        page.locator('[data-pane="0"] .axiom-embedded .cm-content'),
      ).toHaveCount(0);
      await expect(
        page.locator('[data-pane="0"] .axiom-source-prose'),
      ).toContainText(opener);
    }
  });
}

test("forward Delete collapses only at zero and a later fence cannot capture the restored draft", async ({
  page,
}) => {
  const suffix = "\n\nAfter\n\n```js\nkeep\n```";
  await page.evaluate(async (suffix) => {
    await window.editorLab.reset(suffix);
    window.editorLab.focus(0, 0);
  }, suffix);
  await page.keyboard.type("```");
  await page.keyboard.press("Enter");
  await page.keyboard.type("ab ");
  await page.keyboard.press("Home");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Delete");
  await shared(page, "```python\n \n```\n\n" + suffix);
  await page.keyboard.press("Delete");
  await shared(page, "```" + suffix);
  await caret(page, 3);
  const pane = page.locator('[data-pane="0"]');
  await expect(pane.locator(".axiom-source-prose").first()).toHaveText("```");
  await expect(pane.locator(".axiom-embedded .cm-content")).toHaveCount(1);
  await expect(pane.locator(".axiom-embedded .cm-content")).toHaveText("keep");
});

for (const opener of ["$$", "```py"]) {
  test(`read-only permissions retain focus and prevent collapsing a freshly completed fence: ${opener}`, async ({
    page,
  }) => {
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
    await expect(
      page.locator('[data-pane="0"] .axiom-embedded .cm-content'),
    ).toBeFocused();
    await page.keyboard.press("Backspace");
    await shared(page, source);
    await page.keyboard.press("Delete");
    await shared(page, source);
  });
}
