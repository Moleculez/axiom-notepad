import { test, expect, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));
const menu = (page: Page) =>
  page.locator(
    '.axiom-code-completions, [aria-label="Code suggestions"], .cm-tooltip-autocomplete',
  );
const body = (page: Page) =>
  page.locator('[data-pane="0"] .axiom-embedded .cm-content');
const shared = (page: Page, source: string) =>
  expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([source, source]);
async function start(page: Page, text = "", language = "python") {
  const source = "```" + language + "\n" + text + "\n```\n\nAfter";
  await page.evaluate(
    async ({ source, at }) => {
      await window.editorLab.reset(source);
      window.editorLab.focus(0, at);
    },
    { source, at: 4 + language.length + text.length },
  );
  await expect(body(page)).toBeFocused();
}

test("typing keywords and local names never opens code suggestions, including Ctrl+Space", async ({
  page,
}) => {
  for (const [language, prefix] of [
    ["python", "pri"],
    ["julia", "pri"],
    ["javascript", "fun"],
    ["custom", "res"],
  ]) {
    await start(page, "research_value = 1\n", language);
    await page.keyboard.type(prefix);
    await expect(menu(page)).toHaveCount(0);
    await page.keyboard.press("Control+Space");
    await expect(menu(page)).toHaveCount(0);
    await shared(
      page,
      "```" + language + "\nresearch_value = 1\n" + prefix + "\n```\n\nAfter",
    );
    await expect(body(page)).toBeFocused();
  }
});

test("Tab indents, Shift-Tab outdents and Enter inserts a newline without completing code", async ({
  page,
}) => {
  await start(page, "pri");
  await page.keyboard.press("Tab");
  await shared(page, "```python\n    pri\n```\n\nAfter");
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, "```python\npri\n```\n\nAfter");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await shared(page, "```python\n    pri\n```\n\nAfter");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await shared(page, "```python\npri\n\n```\n\nAfter");
  await expect(body(page)).toBeFocused();
  await expect(menu(page)).toHaveCount(0);
});

test("snippet prefixes remain authored text rather than expanding templates", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.type("def");
  await page.keyboard.press("Control+Space");
  await page.keyboard.press("Tab");
  await shared(page, "```python\n    def\n```\n\nAfter");
  await page.keyboard.type(" energy(mass):");
  await shared(page, "```python\n    def energy(mass):\n```\n\nAfter");
  await expect(menu(page)).toHaveCount(0);
});

test("ordinary code typing retains its caret when a peer inserts a code block above", async ({
  page,
}) => {
  await start(page, "research_value = 1\n");
  await page.keyboard.type("res");
  await page.evaluate(() =>
    window.editorLab.remote(1, 0, 0, "```python\npeer_value = 1\n```\n\n"),
  );
  await expect(body(page).last()).toBeFocused();
  await page.keyboard.type("ult");
  await shared(
    page,
    "```python\npeer_value = 1\n```\n\n```python\nresearch_value = 1\nresult\n```\n\nAfter",
  );
  await expect(menu(page)).toHaveCount(0);
});

test("quoted CRLF code keeps its source prefixes and indentation without snippets", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.editorLab.reset("> ```py\r\n> \r\n> ```\r\n\r\nAfter");
    window.editorLab.focus(0, 11);
  });
  await page.keyboard.type("def");
  await page.keyboard.press("Tab");
  await shared(page, "> ```py\r\n>     def\r\n> ```\r\n\r\nAfter");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await shared(page, "> ```py\r\n> def\r\n> \r\n> ```\r\n\r\nAfter");
  await expect(menu(page)).toHaveCount(0);
});

test("language-name autocomplete remains available while code-body completion stays disabled", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.editorLab.reset("");
    window.editorLab.focus(0, 0);
  });
  await page.keyboard.type("```py");
  const languages = page.getByRole("listbox", {
    name: "Code language suggestions",
    exact: true,
  });
  await expect(
    languages.getByRole("option", { name: "Python", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.type("pri");
  await expect(menu(page)).toHaveCount(0);
  const block = page.locator('[data-pane="0"] .axiom-embedded');
  await block.hover();
  await block.getByRole("button", { name: "Change code language" }).click();
  const input = page.getByRole("combobox", {
    name: "Code language",
    exact: true,
  });
  await input.fill("ju");
  await input.press("Tab");
  await shared(page, "```julia\npri\n```\n\n");
  await expect(body(page)).toBeFocused();
  await expect(menu(page)).toHaveCount(0);
});

test("empty-block Backspace removes fences without reopening completion", async ({
  page,
}) => {
  for (const text of ["", "def"]) {
    await page.evaluate(async () => {
      await window.editorLab.reset("");
      window.editorLab.focus(0, 0);
    });
    await page.keyboard.type("```");
    await page.keyboard.press("Enter");
    await page.keyboard.type(text);
    await page.keyboard.press("Control+Space");
    await expect(menu(page)).toHaveCount(0);
    for (let i = 0; i < text.length + 1; i++)
      await page.keyboard.press("Backspace");
    await shared(page, "\n\n");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.keyboard.type("Plain");
    await shared(page, "Plain\n\n");
  }
});

test("source mode and read-only blocks also have no code completion", async ({
  page,
}) => {
  await start(page, "pri");
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await page.keyboard.press("Control+Space");
  await page.keyboard.press("Tab");
  await shared(page, "```python\npri\n```\n\nAfter");
  await expect(menu(page)).toHaveCount(0);
  await start(page, "def");
  await page.evaluate(() => window.editorLab.mode(0, "source"));
  await page.keyboard.press("Control+Space");
  await page.keyboard.press("Tab");
  await shared(page, "```python\n    def\n```\n\nAfter");
  await expect(menu(page)).toHaveCount(0);
});

test("math completion and its fields remain available but never capture code indentation", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.editorLab.reset("$$\n\n$$\n\n```python\npri\n```");
    window.editorLab.focus(0, 3);
  });
  await page.keyboard.type("\\frac");
  await expect(
    page.getByRole("option", { name: "\\frac", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.type("x");
  await page.keyboard.press("Tab");
  await page.keyboard.type("y");
  await page.evaluate(() => {
    const source = window.editorLab.snapshot()[0].source;
    window.editorLab.focus(0, source.indexOf("pri") + 3);
  });
  await page.keyboard.press("Tab");
  await shared(page, "$$\n\\frac{x}{y}\n$$\n\n```python\n    pri\n```");
  await expect(body(page).last()).toBeFocused();
  await expect(menu(page)).toHaveCount(0);
});
