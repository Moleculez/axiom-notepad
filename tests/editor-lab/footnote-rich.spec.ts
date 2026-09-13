import { expect, test, type Page } from "@playwright/test";

const pane = (page: Page) => page.locator('[data-pane="0"]');
const note = (page: Page) =>
  pane(page).locator('.axiom-footnote[data-footnote-definition="a"]');
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
async function reset(page: Page, source: string, at = source.length) {
  await page.evaluate(
    async ({ source, at }) => {
      await window.editorLab.reset(source);
      window.editorLab.focus(0, at);
    },
    { source, at },
  );
}
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
async function paste(page: Page, text: string, html = "") {
  await page.evaluate(
    ({ text, html }) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      if (html) clipboardData.setData("text/html", html);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
      document.activeElement!.dispatchEvent(event);
    },
    { text, html },
  );
}

for (const ending of ["\n", "\r\n"]) {
  test(`typing an opener waits for Enter, then edits real child paragraphs (${JSON.stringify(ending)})`, async ({
    page,
  }) => {
    const before = "Result[^a]." + ending.repeat(2),
      suffix = ending.repeat(2) + "After";
    await reset(page, before + suffix, before.length);
    await page.evaluate(() => window.editorLab.autoPair(0, true));
    await page.keyboard.type("[^a]:");
    await expect(note(page)).toHaveCount(0);
    await expect(
      pane(page).locator('[data-source-kind="footnoteHeader"]'),
    ).toHaveText("[^a]:");
    await caret(page, before.length + 5);
    await page.keyboard.press("Enter");
    await expect(note(page)).toBeVisible();
    await expect(note(page).locator(".axiom-footnote-title")).toHaveText(
      "[^a]",
    );
    await expect(note(page).locator(".axiom-footnote-body > p")).toHaveCount(1);
    const opened = before + "[^a]:" + ending + "    " + suffix;
    await shared(page, opened);
    await caret(page, opened.length - suffix.length);
    await page.keyboard.type("First **paragraph**.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second paragraph.");
    const expected =
      before +
      "[^a]:" +
      ending +
      "    First **paragraph**." +
      ending +
      "    " +
      ending +
      "    Second paragraph." +
      suffix;
    await shared(page, expected);
    await expect(note(page).locator(".axiom-footnote-body > p")).toHaveCount(2);
    await expect(note(page).locator("strong")).toHaveText("paragraph");
    await expect(note(page).locator(".axiom-source-prose")).toHaveText(
      "Second paragraph.",
    );
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Outside");
    await expect(note(page)).not.toContainText("Outside");
    await expect(
      pane(page).locator(".axiom-prose > .axiom-source-prose"),
    ).toHaveText("Outside");
  });
}

test("an empty footnote is removed without losing history", async ({
  page,
}) => {
  const before = "Result[^a].\n\n",
    suffix = "\n\nAfter";
  await reset(page, before + suffix, before.length);
  await page.keyboard.type("[^a]:");
  await page.keyboard.press("Enter");
  const opened = before + "[^a]:\n    " + suffix;
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await shared(page, opened);
  await expect(note(page)).toBeVisible();
  await page.keyboard.press("Backspace");
  await shared(page, before + suffix);
  await expect(note(page)).toHaveCount(0);
  await caret(page, before.length);
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, opened);
  await expect(note(page)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await shared(page, before + suffix);
  await expect(note(page)).toHaveCount(0);
  await page.keyboard.type("Plain text");
  await shared(page, before + "Plain text" + suffix);
});

test("first body boundary is protected and a body selection never removes the ID", async ({
  page,
}) => {
  const source = "Before\n\n[^a]: First\n\n    Second\n\nAfter",
    at = source.indexOf("First");
  await reset(page, source, at);
  await page.keyboard.press("Backspace");
  await shared(page, source);
  await caret(page, at);
  await page.evaluate(({ at, to }) => window.editorLab.focus(0, at, to), {
    at,
    to: source.indexOf("Second") + 6,
  });
  await page.keyboard.press("Backspace");
  await shared(page, "Before\n\n[^a]: \n\nAfter");
  await expect(note(page)).toBeVisible();
  await page.keyboard.press("Backspace");
  await shared(page, "Before\n\n\n\nAfter");
  await expect(note(page)).toHaveCount(0);
});

test("imported bodies map exact Source-mode caret positions and hidden marker positions", async ({
  page,
}) => {
  const source =
    "Before\r\n\r\n[^a]: First\r\n\r\n\tSecond  \r\n\tThird\r\n\r\nAfter";
  await reset(page, source, 2);
  for (const requested of [
    source.indexOf("[^a]:") + 3,
    source.indexOf("Second") - 1,
    source.indexOf("Third") + 2,
  ]) {
    await page.evaluate(async (at) => {
      await window.editorLab.mode(0, "source");
      window.editorLab.focus(0, at);
    }, requested);
    await caret(page, requested);
    await page.evaluate(() => window.editorLab.mode(0, "write"));
    const expected =
      requested < source.indexOf("First")
        ? source.indexOf("First")
        : requested < source.indexOf("Second")
          ? source.indexOf("Second")
          : requested;
    await caret(page, expected);
    await shared(page, source);
    await expect(note(page).locator(".axiom-footnote-body")).not.toContainText(
      "[^a]:",
    );
  }
});

for (const opener of ["$$", "\\[", "```", "```julia", "> $$"]) {
  test(`nested ${opener} completes, edits and removes empty structure within the definition`, async ({
    page,
  }) => {
    const before = "Before\n\n[^a]: First\n\n    ",
      suffix = "\n\nAfter";
    await reset(page, before + suffix, before.length);
    await page.keyboard.type(opener);
    await expect(note(page).locator(".cm-content")).toHaveCount(0);
    await page.keyboard.press("Enter");
    const input = note(page).locator(".axiom-embedded .cm-content");
    await expect(input).toBeFocused();
    const empty = await page.evaluate(
      () => window.editorLab.snapshot()[0].source,
    );
    await page.keyboard.type("x=1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("y=2");
    await expect(input).toHaveText("x=1y=2");
    const populated = await page.evaluate(
      () => window.editorLab.snapshot()[0].source,
    );
    expect(populated).toContain(
      opener.startsWith(">") ? "    > x=1\n    > y=2" : "    x=1\n    y=2",
    );
    expect(populated.endsWith(suffix)).toBe(true);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await shared(page, empty);
    await expect(input).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await shared(page, populated);
    await expect(input).toBeFocused();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await shared(page, empty);
    await page.keyboard.press("Backspace");
    await expect(input).toHaveCount(0);
    await expect(note(page)).toBeVisible();
    await page.keyboard.type("Plain text");
    await expect(note(page)).toContainText("Plain text");
  });
}

test("nested quote exit types in the parent, not the child, then returns to the footnote", async ({
  page,
}) => {
  const source = "Before\n\n[^a]: > Parent\n    > > Child";
  await reset(page, source);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("More parent");
  await expect(note(page).locator("blockquote > blockquote")).not.toContainText(
    "More parent",
  );
  await expect(
    note(page).locator("blockquote > .axiom-source-prose"),
  ).toHaveText("More parent");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Footnote body");
  await expect(
    note(page).locator(".axiom-footnote-body > .axiom-source-prose"),
  ).toHaveText("Footnote body");
});

test("first-line table controls, cell edits and TSV growth retain a single definition", async ({
  page,
}) => {
  const source =
    "Before\n\n[^a]: | A | B |\n    | --- | --- |\n    | C | D |\n\nAfter";
  await reset(page, source, source.indexOf("A |"));
  await expect(note(page).locator("table")).toHaveCount(1);
  await page.keyboard.type("x");
  await paste(page, "1\t2\n3\t4\n5\t6");
  await expect(note(page).locator("table tr")).toHaveCount(3);
  const next = await page.evaluate(() => window.editorLab.snapshot()[0].source);
  expect(next.match(/\[\^a\]:/g)).toHaveLength(1);
  expect(next.endsWith("\n\nAfter")).toBe(true);
  await page.evaluate(() => window.editorLab.execute(0, "rowAfter"));
  await expect(note(page).locator("table tr")).toHaveCount(4);
  await page.evaluate(() => window.editorLab.execute(0, "columnAfter"));
  await expect(
    note(page).locator("table tr").first().locator("th"),
  ).toHaveCount(3);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await expect(
    note(page).locator("table tr").first().locator("th"),
  ).toHaveCount(2);
});

for (const command of ["math", "table"]) {
  test(`slash ${command} creates a child block in the footnote`, async ({
    page,
  }) => {
    const source = "Before\n\n[^a]: First\n\n    ";
    await reset(page, source);
    await page.keyboard.type("/" + command);
    await expect(pane(page).getByRole("listbox")).toBeVisible();
    if (command === "math")
      await pane(page)
        .getByRole("option", { name: "Display equation", exact: true })
        .click();
    else await page.keyboard.press("Enter");
    await expect(
      note(page).locator(
        command === "table" ? "table" : '[data-kind="mathBlock"]',
      ),
    ).toBeVisible();
    const next = await page.evaluate(
      () => window.editorLab.snapshot()[0].source,
    );
    expect(next.match(/\[\^a\]:/g)).toHaveLength(1);
    expect(next).not.toContain("/" + command);
  });
}

test("rich paste, hard breaks, undo and peer edits retain the body and source caret", async ({
  page,
}) => {
  const source = "Before\r\n\r\n[^a]: First\r\n\r\n\tBody\r\n\r\nAfter",
    at = source.indexOf("Body") + 4;
  await reset(page, source, at);
  await paste(
    page,
    "\nSecond\nThird",
    "<p>Second <strong>bold</strong>.</p><p>Third</p>",
  );
  const pasted = await page.evaluate(
    () => window.editorLab.snapshot()[0].source,
  );
  expect(pasted).toContain("Second **bold**.");
  expect(pasted).toContain("\r\n\tThird");
  expect(pasted.endsWith("\r\n\r\nAfter")).toBe(true);
  await caret(page, pasted.indexOf("Third") + 5);
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Continuation");
  const after = await page.evaluate(
    () => window.editorLab.snapshot()[0].source,
  );
  expect(after).toContain("Third  \r\n\tContinuation");
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\r\n\r\n"));
  await page.keyboard.type("!");
  await shared(
    page,
    "Peer\r\n\r\n" + after.replace("Continuation", "Continuation!"),
  );
  await caret(page, "Peer\r\n\r\n".length + after.indexOf("Continuation") + 13);
});

test("hover, title clicks and context menus keep the container rendered and do not write source", async ({
  page,
}) => {
  const source = "Before\n\n[^a]: First\n\n    Second",
    at = 2;
  await reset(page, source, at);
  const title = note(page).locator(".axiom-footnote-title");
  await title.hover();
  await caret(page, at);
  await title.click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Block actions" })).toBeVisible();
  await expect(note(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await caret(page, at);
  await title.click();
  await caret(page, source.indexOf("First"));
  await expect(note(page).locator(".axiom-source-prose")).toHaveText("First");
  expect(
    await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    ),
  ).toEqual([0, 0]);
  await shared(page, source);
});

test("peer edits update body and hover preview while permission changes prevent typing", async ({
  page,
}) => {
  const source = "Before\n\nResult[^a].\n\n[^a]: First\n\n    Second";
  await reset(page, source, 2);
  const ref = pane(page).locator('[data-footnote-key="a"]').first();
  await ref.hover();
  await expect(page.locator(".footnote-tooltip")).toContainText("Second");
  await page.evaluate(
    (at) => window.editorLab.remote(1, at, at + 6, "Updated"),
    source.indexOf("Second"),
  );
  await expect(page.locator(".footnote-tooltip")).toContainText("Updated");
  await expect(note(page)).toContainText("Updated");
  await ref.click();
  await caret(page, source.indexOf("First"));
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  // Read-only contenteditable is not a keyboard target in WebKit; Backspace
  // would be browser Back. Exercise the editor's permission guards directly.
  expect(
    await pane(page)
      .locator(".axiom-prose")
      .evaluate((element) =>
        ["insertText", "deleteContentBackward"].map((inputType) => {
          const event = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType,
            data: inputType === "insertText" ? "NO" : null,
          });
          element.dispatchEvent(event);
          return event.defaultPrevented;
        }),
      ),
  ).toEqual([true, true]);
  await shared(page, source.replace("Second", "Updated"));
});

test("list Tab and Shift-Tab change only the inner item indentation", async ({
  page,
}) => {
  const source = "Before\n\n[^a]: - First\n    - Second\n\nAfter",
    at = source.indexOf("Second") + 6;
  await reset(page, source, at);
  await page.keyboard.press("Tab");
  await shared(page, source.replace("    - Second", "        - Second"));
  await page.keyboard.press("Shift+Tab");
  await shared(page, source);
  await page.keyboard.press("Shift+Tab");
  await shared(page, source);
  await page.keyboard.type("!");
  await shared(page, source.replace("Second", "Second!"));
  await expect(note(page)).toContainText("Second!");
});

test("first-line language completion and empty code deletion preserve the definition", async ({
  page,
}) => {
  const source = "Before\n\n[^a]: ";
  await reset(page, source);
  await page.keyboard.type("```");
  await expect(
    pane(page).getByRole("listbox", { name: "Code language suggestions" }),
  ).toBeVisible();
  await page.keyboard.type("ju");
  await page.keyboard.press("Tab");
  await shared(page, source + "```julia");
  await page.keyboard.press("Enter");
  await expect(note(page).locator(".axiom-embedded .cm-content")).toBeFocused();
  const empty = await page.evaluate(
    () => window.editorLab.snapshot()[0].source,
  );
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await shared(page, empty);
  await expect(note(page).locator(".axiom-embedded .cm-content")).toBeFocused();
  await page.keyboard.press("Backspace");
  await expect(note(page).locator(".cm-content")).toHaveCount(0);
  await expect(pane(page).getByRole("listbox")).toHaveCount(0);
  await page.keyboard.type("Plain");
  await expect(note(page)).toContainText("Plain");
});

test("composition in a footnote rebases once over a peer edit without losing prefixes", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "CDP composition is separate from physical IME acceptance.",
  );
  const source =
      "Before\r\n\r\n[^a]: First\r\n\r\n    > **text**\r\n    > tail",
    at = source.indexOf("text") + 2;
  await reset(page, source, at);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "yan",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\r\n\r\n"));
  await cdp.send("Input.imeSetComposition", {
    text: "研究",
    selectionStart: 2,
    selectionEnd: 2,
  });
  await cdp.send("Input.insertText", { text: "研究" });
  await shared(page, "Peer\r\n\r\n" + source.replace("text", "te研究xt"));
  await caret(page, at + 10);
  await expect(note(page).locator("blockquote .axiom-source-prose")).toHaveText(
    "**te研究xt**\ntail",
    { useInnerText: false },
  );
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, "Peer\r\n\r\n" + source);
  await cdp.detach();
});

test("a peer can populate or rename the footnote without retaining a stale draft title", async ({
  page,
}) => {
  const before = "Before\n\n";
  await reset(page, before);
  await page.keyboard.type("[^a]:");
  await page.evaluate(() => {
    const at = window.editorLab.snapshot()[0].source.length;
    window.editorLab.remote(1, at, at, "\n    Peer body");
  });
  await expect(note(page)).toBeVisible();
  await expect(note(page)).toContainText("Peer body");
  await page.evaluate(
    (at) => window.editorLab.remote(1, at, at + 1, "b"),
    before.length + 2,
  );
  await expect(note(page)).toHaveCount(0);
  await expect(
    pane(page).locator(
      '.axiom-footnote[data-footnote-definition="b"] .axiom-footnote-title',
    ),
  ).toHaveText("[^b]");
  await shared(page, before + "[^b]:\n    Peer body");
});

test("slash media actions use the body range and image/link interactions keep the footnote", async ({
  page,
}) => {
  const source = "Before\n\n[^a]: First\n\n    ";
  await reset(page, source);
  await page.keyboard.type("/image");
  await pane(page)
    .getByRole("option", { name: "Image or attachment", exact: true })
    .click();
  expect(
    await page.evaluate(() => window.editorLab.hostEvents()),
  ).toContainEqual({
    kind: "prepare",
    index: 0,
    from: source.length,
    to: source.length + 6,
  });
  await shared(page, source + "/image");
  const withMedia =
    source + "![Figure](/figure.svg)\n\n    [Paper](https://example.org)";
  await reset(page, withMedia, 2);
  await note(page).locator('[data-kind="image"]').click();
  await expect(note(page).locator(".axiom-image-source-text")).toHaveText(
    "![Figure](/figure.svg)",
  );
  await expect(note(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await note(page)
    .locator('.axiom-inline-link[data-target="https://example.org"]')
    .click({ modifiers: ["ControlOrMeta"] });
  expect(
    await page.evaluate(() => window.editorLab.hostEvents()),
  ).toContainEqual({ kind: "link", index: 0, target: "https://example.org" });
  await shared(page, withMedia);
});
