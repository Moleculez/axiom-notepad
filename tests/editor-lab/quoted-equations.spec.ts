import { expect, test, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (e) => errors.get(page)!.push(e.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.waitForFunction(() => !!window.editorLabReady);
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
});
const prose = (page: Page) => page.locator('[data-pane="0"] .axiom-prose');
const tex = (page: Page) =>
  page.locator('[data-pane="0"] .axiom-embedded .cm-content');
async function reset(
  page: Page,
  source: string,
  at = source.length,
  head = at,
) {
  await page.evaluate(
    async ({ source, at, head }) => {
      await window.editorLab.reset(source);
      window.editorLab.focus(0, at, head);
    },
    { source, at, head },
  );
}
async function exact(page: Page, source: string, at: number, head = at) {
  await expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([source, source]);
  await expect
    .poll(() => page.evaluate(() => window.editorLab.snapshot()[0].selection))
    .toEqual({ anchor: at, head });
  await expect
    .poll(() => page.evaluate(() => window.editorLab.domSelection(0)))
    .toEqual({ anchor: at, head });
}
async function paste(page: Page, value: string) {
  await tex(page).evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", { value: data });
    element.dispatchEvent(event);
  }, value);
}

test("typed quoted equations keep their caret through Enter, deletion, finishing, and quote exit", async ({
  page,
}) => {
  await reset(page, "");
  let source = "> Before";
  await page.keyboard.type(source);
  await exact(page, source, source.length);
  await page.keyboard.press("Enter");
  source += "\n> ";
  await exact(page, source, source.length);
  await page.keyboard.type("$$");
  source += "$$";
  await exact(page, source, source.length);
  await expect(prose(page).locator(".axiom-embedded")).toHaveCount(0);
  await page.keyboard.press("Enter");
  const before = source + "\n> ",
    after = "\n> $$\n> ";
  let body = "";
  await exact(page, before + after, before.length);
  await expect(tex(page)).toBeFocused();
  for (const c of "E=mc^2") {
    await page.keyboard.type(c);
    body += c;
    await exact(page, before + body + after, before.length + body.length);
  }
  await page.keyboard.press("Enter");
  body += "\n> ";
  await exact(page, before + body + after, before.length + body.length);
  await page.keyboard.type("+x");
  body += "+x";
  await exact(page, before + body + after, before.length + body.length);
  await page.keyboard.press("Backspace");
  body = body.slice(0, -1);
  await exact(page, before + body + after, before.length + body.length);
  await page.keyboard.type("1");
  body += "1";
  await page.keyboard.press("ControlOrMeta+Enter");
  source = before + body + after;
  await exact(page, source, source.length);
  await expect(
    prose(page).locator("blockquote [data-math-request]"),
  ).toBeVisible();
  await page.keyboard.type("Result");
  source += "Result";
  await exact(page, source, source.length);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  source += "\n\n";
  await exact(page, source, source.length);
  await page.keyboard.type("Outside");
  source += "Outside";
  await exact(page, source, source.length);
  await expect(prose(page).locator("blockquote")).not.toContainText("Outside");
});

for (const [initial, prefix] of [
  ["> > ", "> > "],
  ["> - ", ">   "],
  ["- > ", "  > "],
  ["> [!THEOREM] Energy\n> ", "> "],
])
  test(`shortcut insertion and finishing preserve the container: ${initial}`, async ({
    page,
  }) => {
    await reset(page, initial);
    await page.keyboard.press("ControlOrMeta+Alt+b");
    const before = initial + "$$\n" + prefix,
      after = "\n" + prefix + "$$\n" + prefix;
    await exact(page, before + after, before.length);
    await expect(tex(page)).toBeFocused();
    await page.keyboard.type("x=1");
    await exact(page, before + "x=1" + after, before.length + 3);
    await page.keyboard.press("ControlOrMeta+Enter");
    const next = before + "x=1" + after;
    await exact(page, next, next.length);
    await page.keyboard.type("Continue");
    await exact(page, next + "Continue", next.length + 8);
    await expect(
      prose(page).locator(
        ":is(blockquote, .axiom-callout) [data-math-request]",
      ),
    ).toBeVisible();
  });

test("slash and context menu insert equations inside a quote without block handles", async ({
  page,
}) => {
  for (const method of ["slash", "menu"]) {
    await reset(page, "> ");
    if (method === "slash") {
      await page.keyboard.type("/math");
      await page
        .getByRole("option", { name: "Display equation", exact: true })
        .click();
    } else {
      await page.keyboard.press("Shift+F10");
      await page
        .getByRole("menuitem", { name: "Display equation", exact: true })
        .click();
    }
    await exact(page, "> $$\n> \n> $$\n> ", 7);
    await expect(tex(page)).toBeFocused();
    await page.keyboard.type("x");
    await exact(page, "> $$\n> x\n> $$\n> ", 8);
    await expect(
      page.locator(".axiom-block-handle, .axiom-block-drop-line"),
    ).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
});

for (const ending of ["\n", "\r\n"])
  test(`multiline paste and TeX completions preserve prefixes and ${JSON.stringify(ending)}`, async ({
    page,
  }) => {
    const prefix = "> > ",
      before = prefix + "$$" + ending + prefix,
      after = ending + prefix + "$$";
    await reset(page, before + after, before.length);
    await paste(page, "a+b\nc+d");
    let body = "a+b" + ending + prefix + "c+d";
    await exact(page, before + body + after, before.length + body.length);
    await page.keyboard.press("Enter");
    body += ending + prefix;
    await exact(page, before + body + after, before.length + body.length);
    await page.keyboard.type("\\matrix");
    await page.getByRole("option", { name: "\\matrix", exact: true }).click();
    const snippet = [
      "\\begin{bmatrix}",
      "a & b " + "\\".repeat(2),
      "c & d",
      "\\end{bmatrix}",
    ].join(ending + prefix);
    let source = before + body + snippet + after;
    let at = (before + body).length + snippet.indexOf("a & b");
    await exact(page, source, at, at + 1);
    await page.keyboard.type("1");
    source = source.slice(0, at) + "1" + source.slice(at + 1);
    await exact(page, source, at + 1);
    await page.keyboard.press("Tab");
    at = source.indexOf(" & b") + 3;
    await exact(page, source, at, at + 1);
    await page.keyboard.type("2");
    source = source.slice(0, at) + "2" + source.slice(at + 1);
    await page.keyboard.press("Tab");
    at = source.indexOf("c & d");
    await exact(page, source, at, at + 1);
    await page.keyboard.type("3");
    source = source.slice(0, at) + "3" + source.slice(at + 1);
    await exact(page, source, at + 1);
  });

test("equation labels, author-local undo, and remote edits retain the quote", async ({
  page,
}) => {
  const original = "> $$\n> E=mc^2\n> $$\n> After";
  await reset(page, original, original.indexOf("E=") + 6);
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  let source = "Peer\n\n" + original,
    at = source.indexOf("E=") + 6;
  await exact(page, source, at);
  await page.keyboard.press("Shift+F10");
  await page
    .getByRole("menuitem", { name: "Add or edit equation label", exact: true })
    .click();
  source = source.replace("E=mc^2", "E=mc^2\n> \\label{}");
  at = source.indexOf("label{") + 6;
  await exact(page, source, at);
  await page.keyboard.type("energy");
  source = source.replace("label{}", "label{energy}");
  await exact(page, source, at + 6);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  source = source.replace("label{energy}", "label{}");
  await exact(page, source, at);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await exact(
    page,
    "Peer\n\n" + original,
    ("Peer\n\n" + original).indexOf("E=") + 6,
  );
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await page.keyboard.type("Forbidden");
  await expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual(["Peer\n\n" + original, "Peer\n\n" + original]);
});

test("a one-line quoted equation accepts a label without breaking its delimiters", async ({
  page,
}) => {
  await reset(page, "> $$x=1$$\n> After", 7);
  await page.evaluate(() => window.editorLab.execute(0, "equationLabel"));
  await exact(page, "> $$x=1 \\label{}$$\n> After", 15);
  await page.keyboard.type("one");
  await exact(page, "> $$x=1 \\label{one}$$\n> After", 18);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(
    prose(page).locator("blockquote [data-math-request]"),
  ).toBeVisible();
});

test("cross-container insertion is rejected with an explanation and exact source", async ({
  page,
}) => {
  const source = "> Quoted\n\nOutside";
  await reset(page, source, 2, source.length);
  await page.keyboard.press("ControlOrMeta+Alt+b");
  await exact(page, source, 2, source.length);
  await expect(page.locator("#message")).toContainText(
    "within one quote or list item",
  );
});

test("clicking an equation focuses TeX, and a one-line equation expands safely on Enter", async ({
  page,
}) => {
  const source = "> Before\n> $$x=1$$\n> After";
  await reset(page, source);
  await prose(page)
    .getByRole("button", { name: "Edit display equation", exact: true })
    .click();
  const at = source.indexOf("x=1");
  await exact(page, source, at);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  const expanded = "> Before\n> $$\n> x=1\n> \n> $$\n> After";
  await exact(page, expanded, expanded.indexOf("\n> \n") + 3);
  await page.keyboard.type("+2");
  await exact(
    page,
    expanded.replace("\n> \n", "\n> +2\n"),
    expanded.indexOf("\n> \n") + 5,
  );
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await exact(page, source, at + 3);
});

test("an empty paragraph after a nested equation exits only one quote level", async ({
  page,
}) => {
  const source = "> > $$\n> > x\n> > $$";
  await reset(page, source, source.indexOf("x"));
  await page.keyboard.press("ControlOrMeta+Enter");
  await exact(page, source + "\n> > ", source.length + 5);
  await page.keyboard.press("Enter");
  await exact(page, source + "\n>\n> ", source.length + 5);
  await page.keyboard.type("Outer");
  await exact(page, source + "\n>\n> Outer", source.length + 10);
  await expect(prose(page).locator("blockquote blockquote")).not.toContainText(
    "Outer",
  );
});

test("imported adjacent empty fences gain a body without damaging their closing marker", async ({
  page,
}) => {
  await reset(page, "> $$\n> $$", 7);
  await page.keyboard.type("x");
  await exact(page, "> $$\n> x\n> $$", 8);
  await page.keyboard.press("Enter");
  await exact(page, "> $$\n> x\n> \n> $$", 11);
  await page.keyboard.type("+y");
  await exact(page, "> $$\n> x\n> +y\n> $$", 13);
});

test("a multiline snippet expands single-line quoted math and retains editable fields", async ({
  page,
}) => {
  await reset(page, "> $$$$", 4);
  await page.keyboard.type("\\matrix");
  await page.getByRole("option", { name: "\\matrix", exact: true }).click();
  let source = [
    "> $$",
    "> \\begin{bmatrix}",
    "> a & b " + "\\".repeat(2),
    "> c & d",
    "> \\end{bmatrix}",
    "> $$",
  ].join("\n");
  const at = source.indexOf("a & b");
  await exact(page, source, at, at + 1);
  await page.keyboard.type("1");
  source = source.replace("a & b", "1 & b");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const next = source.indexOf("c & d");
  await exact(page, source, next, next + 1);
  await page.keyboard.type("3");
  source = source.replace("c & d", "3 & d");
  await exact(page, source, next + 1);
});
