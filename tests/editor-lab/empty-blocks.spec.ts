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

for (const [kind, block] of [
  ["codeBlock", "```python\nx\n```"],
  ["codeBlock", "~~~julia\nx\n~~~"],
  ["mathBlock", "$$\nx\n$$"],
  ["mathBlock", "$$x$$"],
  ["mathBlock", "> $$\r\n> x\r\n> $$"],
  ["codeBlock", "> ```py\r\n> x\r\n> ```"],
] as const) {
  test(`deleting the last character reveals source and retains focus: ${block}`, async ({
    page,
  }) => {
    const source = `Before\n\n${block}\n\nAfter`,
      at = source.indexOf("x");
    await page.evaluate(
      async ({ source, at }) => {
        await window.editorLab.reset(source);
        window.editorLab.focus(0, at + 1);
      },
      { source, at },
    );
    const pane = page.locator('[data-pane="0"]');
    await expect(pane.locator(".axiom-embedded .cm-content")).toBeFocused();
    await page.keyboard.press("Backspace");
    const raw = pane.locator(`.axiom-source-prose[data-source-kind="${kind}"]`);
    await expect(raw).toBeVisible();
    await expect(pane.locator(".axiom-embedded .cm-editor")).toHaveCount(0);
    await expect(pane.locator(".axiom-prose")).toBeFocused();
    const empty = source.slice(0, at) + source.slice(at + 1);
    await shared(page, empty);
    expect(
      await page.evaluate(() => window.editorLab.snapshot()[0].selection.head),
    ).toBe(at);
    await page.keyboard.press("ControlOrMeta+z");
    await shared(page, source);
    await expect(pane.locator(".axiom-embedded .cm-content")).toBeFocused();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await shared(page, empty);
    await expect(raw).toBeVisible();
    await page.keyboard.press("Backspace");
    await shared(
      page,
      block.startsWith("> ")
        ? empty.replace("> \r\n", "")
        : empty.slice(0, at - 1) + empty.slice(at),
    );
    await expect(pane.locator(".axiom-embedded .cm-editor")).toHaveCount(0);
  });
}

for (const kind of ["code", "math"] as const) {
  test(`Backspace exits an already empty ${kind} input without writing or trapping the caret`, async ({
    page,
  }) => {
    const block = kind === "code" ? "```py\n\n```" : "$$\n\n$$";
    const source = `${block}\n\nAfter`,
      at = block.indexOf("\n") + 1;
    await page.evaluate(
      async ({ source, at }) => {
        await window.editorLab.reset(source);
        window.editorLab.focus(0, at);
      },
      { source, at },
    );
    const pane = page.locator('[data-pane="0"]');
    await expect(pane.locator(".axiom-embedded .cm-content")).toBeFocused();
    await page.keyboard.press("Backspace");
    await expect(
      pane.locator(`.axiom-source-prose[data-source-kind="${kind}Block"]`),
    ).toBeVisible();
    await expect(pane.locator(".axiom-prose")).toBeFocused();
    await shared(page, source);
    expect(
      await page.evaluate(() =>
        window.editorLab.snapshot().map((s) => s.updates),
      ),
    ).toEqual([0, 0]);
    await page.keyboard.press("Backspace");
    await shared(page, source.slice(0, at - 1) + source.slice(at));
  });
}

test("select-all deletion hands off a multiline block and peer edits remain outside local undo", async ({
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
  const raw = page.locator(
    '[data-pane="0"] .axiom-source-prose[data-source-kind="codeBlock"]',
  );
  await expect(raw).toBeVisible();
  const empty = source.replace("first\nlast", "");
  await shared(page, empty);
  await expect(
    page.locator('[data-pane="1"] .axiom-embedded .cm-editor'),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '[data-pane="1"] .axiom-source-prose[data-source-kind="codeBlock"]',
    ),
  ).toHaveCount(0);
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await expect(raw).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, "Peer\n\n" + source);
});

for (const [kind, opener, closer] of [
  ["codeBlock", "```py", "```"],
  ["mathBlock", "$$", "$$"],
] as const) {
  test(`whitespace remains editable and forward Delete hands off only at zero: ${kind}`, async ({
    page,
  }) => {
    const source = `${opener}\nab \n${closer}\n\nAfter`,
      at = opener.length + 1;
    await page.evaluate(
      async ({ source, at }) => {
        await window.editorLab.reset(source);
        window.editorLab.focus(0, at);
      },
      { source, at },
    );
    const pane = page.locator('[data-pane="0"]');
    await page.keyboard.press("Delete");
    await expect(pane.locator(".axiom-embedded .cm-content")).toBeFocused();
    await page.keyboard.press("Delete");
    await shared(page, `${opener}\n \n${closer}\n\nAfter`);
    await expect(pane.locator(".axiom-embedded .cm-content")).toBeFocused();
    await page.keyboard.press("Delete");
    await shared(page, `${opener}\n\n${closer}\n\nAfter`);
    await expect(
      pane.locator(`.axiom-source-prose[data-source-kind="${kind}"]`),
    ).toBeVisible();
    await page.keyboard.type("y");
    await shared(page, `${opener}\ny\n${closer}\n\nAfter`);
    await expect(pane.locator(".axiom-embedded .cm-content")).toBeFocused();
  });

  test(`new empty ${kind} blocks still accept text and owned-pair deletion can exit them`, async ({
    page,
  }) => {
    await page.evaluate(async () => {
      await window.editorLab.reset("");
      window.editorLab.autoPair(0, true);
      window.editorLab.focus(0, 0);
    });
    await page.keyboard.type(opener);
    await page.keyboard.press("Enter");
    const pane = page.locator('[data-pane="0"]');
    await expect(pane.locator(".axiom-embedded .cm-content")).toBeFocused();
    await page.keyboard.type("(");
    await shared(page, `${opener}\n()\n${closer}\n\n`);
    await page.keyboard.press("Backspace");
    await shared(page, opener);
    await expect(pane.locator(".axiom-source-prose")).toHaveText(opener);
    await expect(pane.locator(".axiom-prose")).toBeFocused();
    await expect(pane.locator(".axiom-embedded .cm-editor")).toHaveCount(0);
  });
}

test("read-only empty blocks never enter a deletion handoff", async ({
  page,
}) => {
  const source = "$$\n\n$$\n\nAfter";
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
    window.editorLab.focus(0, 3);
    window.editorLab.readOnly(0, true);
  }, source);
  await page.keyboard.press("Delete");
  await shared(page, source);
  await expect(
    page.locator(
      '[data-pane="0"] .axiom-source-prose[data-source-kind="mathBlock"]',
    ),
  ).toHaveCount(0);
});
