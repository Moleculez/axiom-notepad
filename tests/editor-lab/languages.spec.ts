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
const menu = (page: Page) =>
  page.getByRole("listbox", { name: "Code language suggestions", exact: true });
async function start(
  page: Page,
  source = "",
  at = 0,
  mode: "write" | "source" = "write",
) {
  await page.evaluate(
    async ({ source, at, mode }) => {
      await window.editorLab.reset(source);
      if (mode !== "write") await window.editorLab.mode(0, mode);
      window.editorLab.focus(0, at);
    },
    { source, at, mode },
  );
}
async function field(page: Page, source = "```python\nx = 1\n```\n\nAfter") {
  await start(page, source, source.indexOf("x = 1") + 2);
  return openLanguage(page);
}
async function openLanguage(page: Page) {
  const block = page.locator('[data-pane="0"] .axiom-embedded').first();
  await block.hover();
  await block.getByRole("button", { name: "Change code language" }).click();
  return page.getByRole("combobox", { name: "Code language", exact: true });
}

test("a bare fence shows optional suggestions without intercepting Enter or empty deletion", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.type("``");
  await expect(menu(page)).toHaveCount(0);
  await page.keyboard.type("`");
  await expect(menu(page)).toBeVisible();
  await expect(
    menu(page).getByRole("option", { name: "Python", exact: true }),
  ).toBeVisible();
  await expect(menu(page).locator('[aria-selected="true"]')).toHaveCount(0);
  await shared(page, "```");
  await page.keyboard.press("Enter");
  await shared(page, "```python\n\n```\n\n");
  await expect(menu(page)).toHaveCount(0);
  await expect(
    page.locator('[data-pane="0"] .axiom-embedded .cm-content'),
  ).toBeFocused();
  await page.keyboard.press("Backspace");
  await shared(page, "```");
  await expect(menu(page)).toHaveCount(0);
});

for (const [opener, ending, content] of [
  ["```", "\n", ""],
  ["```", "\n", "x"],
  ["> ```", "\r\n", "x"],
  ["- ~~~~", "\n", "x"],
  ["```py", "\n", "x"],
] as const) {
  test(`changing a generated block's language still collapses to its original opener: ${opener} ${JSON.stringify(content)}`, async ({
    page,
  }) => {
    const before = "Before" + ending.repeat(2),
      after = ending.repeat(2) + "After",
      peer = "Peer" + ending.repeat(2);
    await start(page, before + after, before.length);
    await page.keyboard.type(opener);
    await page.keyboard.press("Enter");
    const input = await openLanguage(page);
    await input.fill("ju");
    await page.evaluate((peer) => window.editorLab.remote(1, 0, 0, peer), peer);
    await input.press("Tab");
    const body = page.locator('[data-pane="0"] .axiom-embedded .cm-content');
    await expect(body).toBeFocused();
    if (content) await page.keyboard.type(content);
    const populated = await page.evaluate(
      () => window.editorLab.snapshot()[0].source,
    );
    expect(populated).toContain("julia");
    const updates = await page.evaluate(
      () => window.editorLab.snapshot()[0].updates,
    );
    await page.keyboard.press("Backspace");
    await shared(page, peer + before + opener + after);
    await expect(body).toHaveCount(0);
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator('[data-pane="0"] .axiom-prose')).toBeFocused();
    expect(await page.evaluate(() => window.editorLab.domSelection(0))).toEqual(
      {
        anchor: peer.length + before.length + opener.length,
        head: peer.length + before.length + opener.length,
      },
    );
    expect(
      await page.evaluate(() => window.editorLab.snapshot()[0].updates),
    ).toBe(updates + 1);
    await page.keyboard.press("ControlOrMeta+z");
    await shared(page, populated);
    await expect(body).toBeFocused();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await shared(page, peer + before + opener + after);
    expect(await page.evaluate(() => window.editorLab.domSelection(0))).toEqual(
      {
        anchor: peer.length + before.length + opener.length,
        head: peer.length + before.length + opener.length,
      },
    );
    await expect(menu(page)).toHaveCount(0);
    await page.keyboard.press("Backspace");
    await shared(page, peer + before + opener.slice(0, -1) + after);
  });
}

test("deletion dismisses suggestions after peer rebasing but fresh typing can reopen them", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.type("```");
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await shared(page, "Peer\n\n```");
  await expect(menu(page)).toHaveCount(0);
  await page.keyboard.type("ju");
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Tab");
  await shared(page, "Peer\n\n```julia");
});

test("changing an imported or peer-owned block's language never claims its closing fence", async ({
  page,
}) => {
  for (const existing of ["imported", "peer header", "peer body"]) {
    if (existing === "imported") await start(page, "```python\nx\n```\n\n", 10);
    else {
      await start(page);
      await page.keyboard.type("```");
      await page.keyboard.press("Enter");
      if (existing === "peer header") {
        await page.evaluate(() => window.editorLab.remote(1, 3, 9, "rust"));
        await page.keyboard.type("x");
      } else await page.evaluate(() => window.editorLab.remote(1, 10, 10, "x"));
    }
    const input = await openLanguage(page);
    await input.fill("ju");
    await input.press("Tab");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await shared(page, "```julia\n\n```\n\n");
    await expect(
      page.locator('[data-pane="0"] .axiom-source-prose'),
    ).toHaveText("```julia\n\n```");
    await expect(menu(page)).toHaveCount(0);
  }
});

for (const prefix of ["```", "> ```", "- ```", "~~~~"]) {
  test(`Tab completes a language without changing its fence/container: ${prefix}`, async ({
    page,
  }) => {
    const before = "Before\r\n\r\n",
      after = "\r\n\r\nAfter";
    await start(page, before + after, before.length);
    await page.keyboard.type(prefix + "ju");
    await expect(
      menu(page).getByRole("option", { name: "Julia", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Tab");
    await shared(page, before + prefix + "julia" + after);
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator('[data-pane="0"] .axiom-prose')).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await shared(page, before + prefix + "ju" + after);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await shared(page, before + prefix + "julia" + after);
    await page.keyboard.press("Enter");
    await expect(
      page.locator('[data-pane="0"] .axiom-embedded .cm-content'),
    ).toBeFocused();
    await page.keyboard.press("Backspace");
    await shared(page, before + prefix + "julia" + after);
  });
}

test("arrows and pointer selection complete names while Escape leaves the typed info string unchanged", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.type("```c++");
  await page.keyboard.press("ArrowDown");
  const activeOption = await menu(page)
    .getByRole("option", { name: "C++", exact: true })
    .getAttribute("id");
  await expect(page.locator('[data-pane="0"] .axiom-prose')).toHaveAttribute(
    "aria-activedescendant",
    activeOption!,
  );
  await expect(
    menu(page).getByRole("option", { name: "C++", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await shared(page, "```cpp");
  await start(page);
  await page.keyboard.type("```tex");
  await menu(page).getByRole("option", { name: "LaTeX", exact: true }).click();
  await shared(page, "```latex");
  await expect(page.locator('[data-pane="0"] .axiom-prose')).toBeFocused();
  await start(page);
  await page.keyboard.type("```py");
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await shared(page, "```py");
  await page.keyboard.type("thon");
  await page.keyboard.press("Enter");
  await shared(page, "```python\n\n```\n\n");
});

test("Source header completion replaces the whole info string, never the body or closing fence", async ({
  page,
}) => {
  await start(page, "```python\nx = 1\n```", 5, "source");
  await expect(menu(page)).toBeVisible();
  await menu(page).getByRole("option", { name: "Python", exact: true }).click();
  await shared(page, "```python\nx = 1\n```");
  await page.evaluate(() => window.editorLab.focus(0, 19));
  await expect(menu(page)).toHaveCount(0);
  await page.evaluate(() => window.editorLab.focus(0, 12));
  await expect(menu(page)).toHaveCount(0);
});

test("custom language names remain allowed and popup ownership follows peer edits", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.type("```ju");
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await menu(page).getByRole("option", { name: "Julia", exact: true }).click();
  await shared(page, "Peer\n\n```julia");
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, "Peer\n\n```ju");
  await start(page);
  await page.keyboard.type("```my-custom-language");
  await expect(menu(page)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await shared(page, "```my-custom-language\n\n```\n\n");
});

test("language field searches aliases, accepts Tab in one undo step, and keeps its body caret", async ({
  page,
}) => {
  const input = await field(page);
  await expect(menu(page)).toBeVisible();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  await input.fill("jl");
  await expect(input).toBeFocused();
  await expect(
    menu(page).getByRole("option", { name: "Julia", exact: true }),
  ).toBeVisible();
  const updates = await page.evaluate(
    () => window.editorLab.snapshot()[0].updates,
  );
  await input.press("Tab");
  await shared(page, "```julia\nx = 1\n```\n\nAfter");
  await expect(input).toHaveCount(0);
  await expect(menu(page)).toHaveCount(0);
  await expect(
    page.locator('[data-pane="0"] .axiom-embedded .cm-content'),
  ).toBeFocused();
  expect(
    await page.evaluate(() => window.editorLab.snapshot()[0].updates),
  ).toBe(updates + 1);
  expect(await page.evaluate(() => window.editorLab.domSelection(0))).toEqual({
    anchor: 11,
    head: 11,
  });
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, "```python\nx = 1\n```\n\nAfter");
});

test("field pointer selection uses the shared catalog and escapes without committing a draft", async ({
  page,
}) => {
  let input = await field(page);
  await input.fill("tex");
  await menu(page).getByRole("option", { name: "LaTeX", exact: true }).click();
  await shared(page, "```latex\nx = 1\n```\n\nAfter");
  input = await field(page);
  await input.fill("ju");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(menu(page)).toHaveCount(0);
  await shared(page, "```python\nx = 1\n```\n\nAfter");
});

test("field keeps quoted CRLF syntax and never overwrites a peer language change", async ({
  page,
}) => {
  const source = "> ```python\r\n> x = 1\r\n> ```\r\n\r\nAfter";
  let input = await field(page, source);
  await input.fill("jl");
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\r\n\r\n"));
  await input.press("Enter");
  await shared(page, "Peer\r\n\r\n" + source.replace("python", "julia"));
  input = await field(page);
  await input.fill("julia");
  await page.evaluate(() => window.editorLab.remote(1, 3, 9, "rust"));
  await input.press("Enter");
  await shared(page, "```rust\nx = 1\n```\n\nAfter");
  expect(await page.evaluate(() => window.editorLab.recovery())).toContain(
    "```julia\nx = 1\n```\n\nAfter",
  );
  await expect(menu(page)).toHaveCount(0);
});

test("clearing a label, custom names, read-only revocation and blur are not forced to a suggestion", async ({
  page,
}) => {
  let input = await field(page);
  await input.fill("");
  await input.press("Enter");
  await shared(page, "```\nx = 1\n```\n\nAfter");
  input = await field(page);
  await input.fill("my-custom-language");
  await input.press("Enter");
  await shared(page, "```my-custom-language\nx = 1\n```\n\nAfter");
  input = await field(page);
  await input.fill("julia");
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await expect(menu(page)).toHaveCount(0);
  await expect(input).toHaveCount(0);
  await shared(page, "```python\nx = 1\n```\n\nAfter");
  input = await field(page);
  await input.fill("julia");
  await page.locator("#message").click();
  await expect(menu(page)).toHaveCount(0);
  await shared(page, "```python\nx = 1\n```\n\nAfter");
});

test("field suggestions stay within the desktop viewport and do not intercept composing Enter", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 650 });
  const input = await field(page);
  await input.fill("ma");
  const box = await menu(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1100);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(650);
  await input.dispatchEvent("compositionstart", { data: "" });
  await expect(menu(page)).toBeHidden();
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: false });
  await expect(input).toBeFocused();
  await shared(page, "```python\nx = 1\n```\n\nAfter");
  await input.dispatchEvent("compositionend", { data: "ma" });
  await expect(menu(page)).toBeVisible();
  await input.press("Escape");
});
