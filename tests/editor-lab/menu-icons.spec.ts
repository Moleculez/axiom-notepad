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
  page.getByRole("menu", { name: "Block actions", exact: true });
const languageMenu = (page: Page) =>
  page.getByRole("listbox", { name: "Code language suggestions", exact: true });
const snapshot = (page: Page) =>
  page.evaluate(() =>
    window.editorLab
      .snapshot()
      .map(({ source, updates }) => ({ source, updates })),
  );

test("context icons and dividers preserve names, checkmarks, shortcuts and keyboard selection", async ({
  page,
}) => {
  const before = await snapshot(page);
  await page.evaluate(async () => {
    const path = "/apps/web/lib/context-menu.ts";
    const { openContextMenu } = await import(path);
    openContextMenu({
      owner: document.querySelector('[data-pane="0"]'),
      x: 400,
      y: 150,
      items: [
        {
          label: "Copy",
          icon: "copy",
          group: "Clipboard",
          shortcut: "⌘C",
          action: () => {},
        },
        {
          label: "Disabled operation",
          icon: "trash",
          disabled: true,
          action: () => {},
        },
        {
          label: "Wrap lines",
          icon: "codeWrap",
          group: "Code display",
          checked: true,
          shortcut: "Alt W",
          action: () => {
            document.querySelector("#message")!.textContent = "Wrapped";
          },
        },
      ],
    });
  });
  await expect(menu(page).getByRole("separator")).toHaveCount(1);
  await expect(
    menu(page).getByRole("menuitem", { name: "Copy ⌘C", exact: true }),
  ).toBeFocused();
  const checked = menu(page).getByRole("menuitemcheckbox", {
    name: "Wrap lines Alt W",
    exact: true,
  });
  await expect(checked).toBeChecked();
  await expect(
    checked.locator(':scope > svg[data-icon="codeWrap"]'),
  ).toHaveCount(1);
  await expect(
    checked.locator('.action-trailing svg[data-icon="check"]'),
  ).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(checked).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("w");
  await expect(checked).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator("#message")).toHaveText("Wrapped");
  expect(await snapshot(page)).toEqual(before);
});

test("real block menus keep their source unchanged and never render adjacent separators", async ({
  page,
}) => {
  const source =
    "# Heading\n\n> Quoted body\n\n```python\nx = 1\n```\n\n$$\nx^2\n$$\n\nText[^a].\n\n[^a]: A footnote.\n";
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
  }, source);
  for (const needle of [
    "Heading",
    "Quoted body",
    "x = 1",
    "x^2",
    "A footnote",
  ]) {
    await page.evaluate(
      (at) => window.editorLab.focus(0, at),
      source.indexOf(needle) + 1,
    );
    const before = await snapshot(page);
    await page.keyboard.press("Shift+F10");
    await expect(menu(page)).toBeVisible();
    const items = menu(page).locator('button[role^="menuitem"]');
    expect(await items.count()).toBeGreaterThan(0);
    for (const item of await items.all()) {
      await expect(item.locator(":scope > .action-icon")).toHaveCount(1);
      await expect(item.locator(":scope > .action-label")).not.toBeEmpty();
    }
    await expect(
      menu(page).locator(
        '[role="separator"]:first-child,[role="separator"]:last-child,[role="separator"] + [role="separator"]',
      ),
    ).toHaveCount(0);
    await items.first().hover();
    await page.keyboard.press("Escape");
    expect(await snapshot(page)).toEqual(before);
  }
});

for (const pane of [0, 1]) {
  test(`slash commands in ${pane ? "native rollback" : "vNext"} use semantic icons and remain selectable`, async ({
    page,
  }) => {
    await page.evaluate(async (pane) => {
      await window.editorLab.reset("", true);
      window.editorLab.focus(pane, 0);
    }, pane);
    await page.keyboard.type("/heading");
    const choices = page.getByRole("listbox");
    const heading = choices.getByRole("option", {
      name: "Heading 2",
      exact: true,
    });
    await expect(heading.locator('svg[data-icon="heading2"]')).toHaveCount(1);
    const box = await heading.locator("svg").boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(choices).toHaveCount(0);
    await expect
      .poll(async () => (await snapshot(page)).map((s) => s.source))
      .toEqual(["## ", "## "]);
  });
}

for (const mode of ["write", "source"] as const) {
  test(`${mode} fence suggestions show logos and selecting the logo completes only the language`, async ({
    page,
  }) => {
    await page.evaluate(async (mode) => {
      await window.editorLab.reset("");
      await window.editorLab.mode(0, mode);
      window.editorLab.focus(0, 0);
    }, mode);
    await page.keyboard.type("```py");
    const option = languageMenu(page).getByRole("option", {
      name: "Python",
      exact: true,
    });
    await expect(
      option.locator('.language-logo[data-brand="python"] img'),
    ).toBeVisible();
    await expect
      .poll(() =>
        option
          .locator("img")
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
      )
      .toBe(true);
    await option.locator("img").click();
    await expect
      .poll(async () => (await snapshot(page)).map((s) => s.source))
      .toEqual(["```python", "```python"]);
    await expect(languageMenu(page)).toHaveCount(0);
  });
}

for (const variant of ["light", "dark", "large", "forced"] as const) {
  test(`language field logos remain readable in ${variant} appearance and offline`, async ({
    page,
  }, info) => {
    if (variant === "forced")
      await page.emulateMedia({ forcedColors: "active" });
    await page.evaluate(async (variant) => {
      const path = "/packages/shared/src/appearance.ts";
      const { defaults, appearanceVariables } = await import(path);
      const root = document.documentElement;
      const dark = variant === "dark";
      for (const [key, value] of Object.entries(
        appearanceVariables(defaults, dark),
      ))
        root.style.setProperty(key, String(value));
      root.dataset.theme = dark ? "dark" : "light";
      if (variant === "large") root.style.setProperty("--size-ui", "24px");
      await window.editorLab.reset("```python\nx = 1\n```\n\nAfter");
      window.editorLab.focus(0, 12);
    }, variant);
    const block = page.locator('[data-pane="0"] .axiom-embedded').first();
    await block.hover();
    await block.getByRole("button", { name: "Change code language" }).click();
    const input = page.getByRole("combobox", {
      name: "Code language",
      exact: true,
    });
    await expect(input).toBeFocused();
    const before = await snapshot(page);
    const logos = languageMenu(page).locator(".language-logo");
    await expect(logos).toHaveCount(12);
    const failed = await languageMenu(page)
      .locator("img")
      .evaluateAll((images) =>
        images.some(
          (image) =>
            !(image as HTMLImageElement).src.startsWith("data:image/svg+xml,"),
        ),
      );
    expect(failed).toBe(false);
    if (variant === "forced") {
      await expect(logos.first().locator("img")).not.toBeVisible();
      await expect(logos.first().locator("svg")).toBeVisible();
    } else await expect(logos.first().locator("img")).toBeVisible();
    const box = await page.locator(".axiom-language-completions").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
    await page.screenshot({
      path: info.outputPath(`language-logos-${variant}.png`),
    });
    expect(await snapshot(page)).toEqual(before);
    await page.context().setOffline(true);
    await input.fill("ju");
    const julia = languageMenu(page).getByRole("option", {
      name: "Julia",
      exact: true,
    });
    await expect(
      julia.locator('.language-logo[data-brand="julia"]'),
    ).toHaveCount(1);
    await input.press("Tab");
    await expect
      .poll(async () => (await snapshot(page))[0].source)
      .toContain("```julia\n");
    await page.context().setOffline(false);
  });
}
