import { test, expect, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.waitForFunction(() => !!window.editorLabReady);
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page), "Uncaught editor exceptions").toEqual([]);
});
async function reset(page: Page, source: string, legacy = false) {
  await page.evaluate(
    ({ source, legacy }) => window.editorLab.reset(source, legacy),
    { source, legacy },
  );
}
async function focus(page: Page, at: number, head = at, pane = 0) {
  await page.evaluate(
    ({ pane, at, head }) => window.editorLab.focus(pane, at, head),
    { pane, at, head },
  );
}
async function source(page: Page, value: string) {
  await expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([value, value]);
}

test("opening, selecting and switching modes is an exact zero-update round trip", async ({
  page,
}) => {
  const original =
    "# Heading ###\r\n\r\n* alternate __bold__ &amp; \\*escape\\*\r\n\r\n[ref]: /paper 'Title'\r\n\r\n[read][ref]\r\n\r\n{{unknown}}\r\n";
  await reset(page, original);
  for (const mode of ["source", "write", "read", "write"] as const) {
    await page.evaluate((mode) => window.editorLab.mode(0, mode), mode);
    await focus(page, 12, 24);
  }
  await source(page, original);
  expect(
    await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    ),
  ).toEqual([0, 0]);
});

for (const value of [
  "> quotation",
  "- item",
  "- [ ] alpha",
  "1. numbered",
  "# heading",
  "`inline`",
  "**bold**",
  "$x^2$",
]) {
  test(`uninterrupted per-key typing: ${value}`, async ({ page }) => {
    await reset(page, "");
    await focus(page, 0);
    let expected = "";
    for (const letter of value) {
      await page.keyboard.type(letter);
      expected += letter;
      await source(page, expected);
      expect(
        await page.evaluate(
          () => window.editorLab.snapshot()[0].selection.head,
        ),
      ).toBe(expected.length);
    }
  });
}

test("active prose reveals all literal syntax and edits real delimiters", async ({
  page,
}) => {
  await reset(page, "**one** and _two_");
  await focus(page, 3);
  await expect(page.locator('[data-pane="0"] .ProseMirror')).toHaveText(
    "**one** and _two_",
  );
  await focus(page, 1);
  await page.keyboard.press("Delete");
  await source(page, "*one** and _two_");
});

test("list continuation, empty-item exit and undo preserve typed content", async ({
  page,
}) => {
  await reset(page, "- alpha");
  await focus(page, 7);
  await page.keyboard.press("Enter");
  await page.keyboard.type("beta");
  await source(page, "- alpha\n- beta");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("after");
  await source(page, "- alpha\n- beta\n\nafter");
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await source(page, "- alpha\n- beta\n\n");
});

test("paired code fence commits on Enter and embeds a stable CM surface", async ({
  page,
}) => {
  await reset(page, "");
  await focus(page, 0);
  await page.keyboard.type("```python");
  await page.keyboard.press("Enter");
  await expect(
    page.locator('[data-pane="0"] .axiom-embedded .cm-content'),
  ).toBeFocused();
  await page.keyboard.type("x = 1");
  await source(page, "```python\nx = 1\n```\n\n");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("2");
  await source(page, "```python\nx = 2\n```\n\n");
  await page.evaluate(() => window.editorLab.execute(0, "finishBlock"));
  await page.keyboard.type("after");
  await expect
    .poll(() => page.evaluate(() => window.editorLab.snapshot()[0].source))
    .toContain("```\n\nafter");
});

test("math fence remains editable and can be exited by command", async ({
  page,
}) => {
  await reset(page, "");
  await focus(page, 0);
  await page.keyboard.type("$$");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x^2 + y^2");
  await source(page, "$$\nx^2 + y^2\n$$\n\n");
  await page.evaluate(() => window.editorLab.execute(0, "finishBlock"));
  await page.keyboard.type("result");
  await expect
    .poll(() => page.evaluate(() => window.editorLab.snapshot()[0].source))
    .toContain("$$\n\nresult");
});

test("table cells preserve pipes, support Tab, and expose row/column context actions", async ({
  page,
}) => {
  const original = "| A | B |\n| :--- | ---: |\n| x | y |\n";
  await reset(page, original);
  await focus(page, original.indexOf("x") + 1);
  await page.keyboard.type("1");
  await page.keyboard.press("Tab");
  await page.keyboard.type("2");
  await source(page, original.replace("x", "x1").replace("y", "2y"));
  await page.locator('[data-pane="0"] td').first().click({ button: "right" });
  await page
    .getByRole("button", { name: "Insert row below", exact: true })
    .click();
  await expect(page.locator('[data-pane="0"] tr')).toHaveCount(3);
  await expect(page.getByRole("dialog", { name: "Table actions" })).toHaveCount(
    0,
  );
});

test("source, rich and embedded edits share one author-local undo with remote changes retained", async ({
  page,
}) => {
  await reset(page, "hello\n\n```py\nx\n```\n");
  await focus(page, 5);
  await page.keyboard.type("!");
  await page.evaluate(() => window.editorLab.mode(0, "source"));
  await focus(page, 0);
  await page.keyboard.type("local ");
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "peer "));
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  const value = await page.evaluate(
    () => window.editorLab.snapshot()[0].source,
  );
  expect(value).toContain("peer ");
  expect(value).not.toContain("local ");
  await source(page, value);
});

test("new and legacy clients converge on the same Y.Text document", async ({
  page,
}) => {
  await reset(page, "Research", true);
  await focus(page, 8);
  await page.keyboard.type(" A");
  await focus(page, 0, 0, 1);
  await page.keyboard.type("B ");
  await source(page, "B Research A");
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await source(page, "B Research");
});

test("Unicode grapheme deletion and cross-block replacement retain exact boundaries", async ({
  page,
}) => {
  await reset(page, "a👩🏽‍🔬b\n\nsecond\n\nthird");
  await focus(page, "a👩🏽‍🔬".length);
  await page.keyboard.press("Backspace");
  await source(page, "ab\n\nsecond\n\nthird");
  await focus(page, 1, 15);
  await page.keyboard.type("NEW");
  await source(page, "aNEWrd");
});

test("slash commands create real source-backed blocks", async ({ page }) => {
  await reset(page, "");
  await focus(page, 0);
  await page.keyboard.type("/quote");
  await expect(
    page.getByRole("listbox", { name: "Markdown commands and completions" }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("observation");
  await expect
    .poll(() => page.evaluate(() => window.editorLab.snapshot()[0].source))
    .toContain("> observation");
});

test("read-only permissions prevent edits and undo on every surface", async ({
  page,
}) => {
  const original = "immutable\n\n```py\nx = 1\n```\n";
  await reset(page, original);
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await focus(page, 4);
  await page.keyboard.type("BAD");
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await page.evaluate(() => window.editorLab.mode(0, "source"));
  await focus(page, 0);
  await page.keyboard.type("BAD");
  await source(page, original);
});

test("IME in rich prose rebases around a simultaneous remote insertion", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Chromium CDP composition is separate from physical IME acceptance.",
  );
  await reset(page, "**text** and tail");
  await focus(page, 4);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "yan",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer "));
  await cdp.send("Input.imeSetComposition", {
    text: "研究",
    selectionStart: 2,
    selectionEnd: 2,
  });
  await cdp.send("Input.insertText", { text: "研究" });
  await source(page, "Peer **te研究xt** and tail");
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
  await cdp.detach();
});

test("overlapping remote deletion retains the IME draft instead of overwriting a peer", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Uses Chromium CDP composition.");
  await reset(page, "alpha beta");
  await focus(page, 6, 10);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "yan",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await page.evaluate(() => window.editorLab.remote(1, 6, 10, "peer"));
  await cdp.send("Input.insertText", { text: "研究" });
  await source(page, "alpha peer");
  await expect
    .poll(() => page.evaluate(() => window.editorLab.recovery().join("\n")))
    .toContain("研究");
  await cdp.detach();
});

test("a mode change during rich composition waits for the committed text", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Uses Chromium CDP composition.");
  await reset(page, "Research");
  await focus(page, 8);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "yan",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await page.evaluate(() => window.editorLab.mode(0, "source"));
  await cdp.send("Input.insertText", { text: "研究" });
  await source(page, "Research研究");
  await expect(
    page.locator(
      '[data-pane="0"] .axiom-editor-content > .cm-editor .cm-content',
    ),
  ).toBeFocused();
  await page.keyboard.type("!");
  await source(page, "Research研究!");
  await cdp.detach();
});

test("embedded CM composition does not interrupt code or overwrite following lines", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Uses Chromium CDP composition.");
  const original = "> ```py\n> first\n> second\n> ```\n";
  await reset(page, original);
  await focus(page, original.indexOf("first") + 2);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "yan",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await cdp.send("Input.imeSetComposition", {
    text: "研究",
    selectionStart: 2,
    selectionEnd: 2,
  });
  await cdp.send("Input.insertText", { text: "研究" });
  await source(page, original.replace("first", "fi研究rst"));
  await page.keyboard.type("!");
  await source(page, original.replace("first", "fi研究!rst"));
  await cdp.detach();
});

test("shift-click selects a cell rectangle and deletion clears only those cells", async ({
  page,
}) => {
  const original =
    "| A | B | C |\n| --- | --- | --- |\n| x | y | z |\n| p | q | r |\n";
  await reset(page, original);
  await focus(page, original.indexOf("x"));
  await page
    .locator('[data-pane="0"] tbody tr')
    .nth(2)
    .locator("td")
    .nth(1)
    .click({ modifiers: ["Shift"] });
  await expect(
    page.locator('[data-pane="0"] .axiom-cell-selected'),
  ).toHaveCount(4);
  await page.keyboard.press("Backspace");
  await source(
    page,
    original
      .replace("x", "")
      .replace("y", "")
      .replace("p", "")
      .replace("q", ""),
  );
});

for (const mode of ["write", "source"] as const)
  test(`CM ${mode} composition rebases around remote edits and commits once`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Uses Chromium CDP composition.");
    const original = "> ```py\n> first\n> second\n> ```\n";
    await reset(page, original);
    await page.evaluate((mode) => window.editorLab.mode(0, mode), mode);
    await focus(page, original.indexOf("first") + 2);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", {
      text: "yan",
      selectionStart: 3,
      selectionEnd: 3,
    });
    await source(page, original);
    await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
    await cdp.send("Input.imeSetComposition", {
      text: "研究",
      selectionStart: 2,
      selectionEnd: 2,
    });
    await cdp.send("Input.insertText", { text: "研究" });
    await source(page, "Peer\n\n" + original.replace("first", "fi研究rst"));
    expect(
      await page.evaluate(() => window.editorLab.snapshot()[0].updates),
    ).toBe(2);
    await page.evaluate(() => window.editorLab.execute(0, "undo"));
    await source(page, "Peer\n\n" + original);
    await cdp.detach();
  });

for (const mode of ["write", "source", "code"] as const)
  test(`owned delimiter pairs in ${mode} do not consume imported or remote characters`, async ({
    page,
  }) => {
    const original = mode === "code" ? "```py\n\n```\n" : "";
    const at = mode === "code" ? 6 : 0;
    await reset(page, original);
    await page.evaluate((mode) => {
      window.editorLab.autoPair(0, true);
      return window.editorLab.mode(0, mode === "source" ? "source" : "write");
    }, mode);
    await focus(page, at);
    await page.keyboard.type("(");
    await source(page, original.slice(0, at) + "()" + original.slice(at));
    await page.keyboard.press("Backspace");
    await source(page, original);
    await page.keyboard.type("(x)");
    await source(page, original.slice(0, at) + "(x)" + original.slice(at));
    await focus(page, at + 2);
    await page.keyboard.type(")");
    await source(page, original.slice(0, at) + "(x))" + original.slice(at));
    await reset(page, original);
    await page.evaluate((mode) => {
      window.editorLab.autoPair(0, true);
      return window.editorLab.mode(0, mode === "source" ? "source" : "write");
    }, mode);
    await focus(page, at);
    await page.keyboard.type("(");
    await page.evaluate(
      (at) => window.editorLab.remote(1, at + 1, at + 2, ")"),
      at,
    );
    await focus(page, at + 1);
    await page.keyboard.type(")");
    await source(page, original.slice(0, at) + "())" + original.slice(at));
  });

test("automatic pairing still permits literal code and math fence headers", async ({
  page,
}) => {
  for (const header of ["```python", "$$"]) {
    await reset(page, "");
    await page.evaluate(() => window.editorLab.autoPair(0, true));
    await focus(page, 0);
    await page.keyboard.type(header);
    await source(page, header);
    await page.keyboard.press("Enter");
    await expect(
      page.locator('[data-pane="0"] .axiom-embedded .cm-content'),
    ).toBeFocused();
    await page.keyboard.type("x");
    await expect
      .poll(() => page.evaluate(() => window.editorLab.snapshot()[0].source))
      .toContain("\nx\n");
  }
});

test("table shortcuts take precedence and missing cells are materialized only when edited", async ({
  page,
}) => {
  const original = "| A | B |\n| --- | --- |\n| x |\n";
  await reset(page, original);
  await page.locator('[data-pane="0"] td').nth(1).click();
  await page.keyboard.type("y");
  await expect
    .poll(() => page.evaluate(() => window.editorLab.snapshot()[0].source))
    .toContain("| x | y |");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator('[data-pane="0"] tr')).toHaveCount(3);
});

test("distinct omitted table cells retain their clicked identity without normalizing the row on focus", async ({
  page,
}) => {
  const original = "| A | B | C | D |\n| --- | --- | --- | --- |\n| x |\n";
  await reset(page, original);
  await page.locator('[data-pane="0"] td').nth(3).click();
  await source(page, original);
  await page.keyboard.type("fourth");
  await expect(page.locator('[data-pane="0"] td')).toHaveText([
    "x",
    "",
    "",
    "fourth",
  ]);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await source(page, original);
});

test("find and replace stay in visual mode and remain one source-based undo action", async ({
  page,
}) => {
  await reset(page, "**Alpha** and alpha\n\n```py\nalpha = 1\n```\n");
  await focus(page, 0);
  await page.evaluate(() => window.editorLab.execute(0, "replace"));
  const panel = page.getByRole("search", { name: "Find in note" });
  await panel.getByRole("searchbox", { name: "Find in note" }).fill("alpha");
  await expect(panel.getByRole("status")).toContainText("3");
  await expect(page.locator('[data-pane="0"] .axiom-editor')).toHaveAttribute(
    "data-mode",
    "write",
  );
  await panel.getByLabel("Replace with", { exact: true }).fill("beta");
  await panel
    .getByRole("button", { name: "Replace all matches", exact: true })
    .click();
  await source(page, "**beta** and beta\n\n```py\nbeta = 1\n```\n");
  await panel.getByRole("button", { name: "Close find" }).click();
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await source(page, "**Alpha** and alpha\n\n```py\nalpha = 1\n```\n");
});

test("arrow keys enter and leave embedded code and math without changing Markdown", async ({
  page,
}) => {
  for (const fence of ["```python", "$$"]) {
    const close = fence.startsWith("`") ? "```" : "$$";
    const original = `Before\n\n${fence}\nx\n${close}\n\nAfter\n`;
    await reset(page, original);
    await focus(page, 6);
    await page.keyboard.press("ArrowDown");
    await expect(
      page.locator('[data-pane="0"] .axiom-embedded .cm-content'),
    ).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.locator('[data-pane="0"] .ProseMirror')).toBeFocused();
    await focus(page, original.indexOf("\nx\n") + 2);
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[data-pane="0"] .ProseMirror')).toBeFocused();
    expect(
      await page.evaluate(() => window.editorLab.snapshot()[0].selection.head),
    ).toBe(original.indexOf("After"));
    await source(page, original);
  }
});

test("a code language label commits once and dismisses without reentrant blur errors", async ({
  page,
}) => {
  await reset(page, "```python\nx = 1\n```\n");
  const block = page.locator('[data-pane="0"] .axiom-embedded');
  await block.hover();
  await block.getByRole("button", { name: "Change code language" }).click();
  await block.getByRole("combobox", { name: "Code language" }).fill("julia");
  await block.getByRole("combobox", { name: "Code language" }).press("Enter");
  await source(page, "```julia\nx = 1\n```\n");
  await expect(
    block.getByRole("combobox", { name: "Code language" }),
  ).toHaveCount(0);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await source(page, "```python\nx = 1\n```\n");
});

test("the source shortcut retains selection and keyboard table menus use the current cell", async ({
  page,
}) => {
  await reset(page, "**alpha** and beta");
  await focus(page, 4);
  await page.keyboard.press("ControlOrMeta+/");
  await expect(page.locator('[data-pane="0"] .axiom-editor')).toHaveAttribute(
    "data-mode",
    "source",
  );
  await page.keyboard.type("!");
  await source(page, "**al!pha** and beta");
  await page.keyboard.press("ControlOrMeta+/");
  await expect(page.locator('[data-pane="0"] .axiom-editor')).toHaveAttribute(
    "data-mode",
    "write",
  );
  const table = "| A | B |\n| --- | --- |\n| x | y |\n";
  await reset(page, table);
  await focus(page, table.indexOf("y"));
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("dialog", { name: "Table actions" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Column", exact: true }).click();
  await page
    .getByRole("button", { name: "Insert column right", exact: true })
    .click();
  await expect(page.locator('[data-pane="0"] th')).toHaveCount(3);
});

test("spreadsheet paste grows a table, rectangle copy exports TSV, and undo restores exact source", async ({
  page,
}) => {
  const original = "| A  | B |\n| :--- | ---: |\n| x | y |\n";
  await reset(page, original);
  await focus(page, original.indexOf("x"));
  const editor = page.locator('[data-pane="0"] .ProseMirror');
  await editor.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "p\tq\nr\ts");
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
    });
    // Firefox intentionally does not adopt constructor clipboardData. This
    // exercises the handler contract; physical system clipboard is a separate gate.
    Object.defineProperty(event, "clipboardData", { value: data });
    element.dispatchEvent(event);
  });
  await expect(page.locator('[data-pane="0"] tr')).toHaveCount(3);
  await expect(page.locator('[data-pane="0"] td')).toHaveText([
    "p",
    "q",
    "r",
    "s",
  ]);
  const pasted = await page.evaluate(
    () => window.editorLab.snapshot()[0].source,
  );
  expect(pasted.startsWith("| A  | B |\n| :--- | ---: |\n")).toBe(true);
  await focus(page, pasted.indexOf("p"));
  await page
    .locator('[data-pane="0"] td')
    .last()
    .click({ modifiers: ["Shift"] });
  const copied = await editor.evaluate((element) => {
    const data = new DataTransfer();
    const event = new ClipboardEvent("copy", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", { value: data });
    element.dispatchEvent(event);
    return data.getData("text/plain");
  });
  expect(copied).toBe("p\tq\nr\ts");
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await source(page, original);
});

test("table resizing is local display state and never writes or normalizes the note", async ({
  page,
}) => {
  const original = "| A | B |\n| --- | --- |\n| alpha | beta |\n";
  await reset(page, original);
  const cell = page.locator('[data-pane="0"] th').first();
  const before = await cell.boundingBox();
  await page.mouse.move(before!.x + before!.width - 1, before!.y + 12);
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width + 65, before!.y + 12);
  await page.mouse.up();
  expect((await cell.boundingBox())!.width).toBeGreaterThan(before!.width + 30);
  await source(page, original);
  expect(
    await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    ),
  ).toEqual([0, 0]);
});
