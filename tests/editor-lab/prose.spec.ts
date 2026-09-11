import { test, expect, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (e) => errors.get(page)!.push(e.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.waitForFunction(() => !!window.editorLabReady);
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page), "Uncaught editor exceptions").toEqual([]);
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
});
async function reset(page: Page, source = "", at = 0) {
  await page.evaluate(
    async ({ source, at }) => {
      await window.editorLab.reset(source);
      window.editorLab.focus(0, at);
    },
    { source, at },
  );
}
async function exact(page: Page, source: string, at: number) {
  await expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([source, source]);
  await expect
    .poll(() => page.evaluate(() => window.editorLab.snapshot()[0].selection))
    .toEqual({ anchor: at, head: at });
  await expect
    .poll(() => page.evaluate(() => window.editorLab.domSelection(0)))
    .toEqual({ anchor: at, head: at });
}
const prose = (page: Page) => page.locator('[data-pane="0"] .axiom-prose');

for (const [text, preview] of [
  ["# A heading", "h1"],
  ["### A **result** ###", "h3"],
  ["- unordered", "ul"],
  ["1. ordered", "ol"],
  ["- [ ] a task", "ul"],
  ["**strong** and _emphasis_", "strong"],
])
  test(`literal typing, departure and return: ${text}`, async ({ page }) => {
    await reset(page, "\n\nOutside");
    let typed = "";
    for (const letter of text) {
      await page.keyboard.type(letter);
      typed += letter;
      await exact(page, typed + "\n\nOutside", typed.length);
      await expect(
        prose(page).locator(".axiom-source-prose").first(),
      ).toHaveText(typed, { useInnerText: false });
    }
    const updates = await page.evaluate(
      () => window.editorLab.snapshot()[0].updates,
    );
    await prose(page)
      .locator("p")
      .filter({ hasText: /^Outside$/ })
      .click();
    await expect(prose(page).locator(preview)).toBeVisible();
    await expect(prose(page).locator(".axiom-source-prose")).toHaveText(
      "Outside",
    );
    // Clicking rendered prose is a view transition, never a source transaction.
    // List-container coordinates can hit the dedicated checkbox gutter.
    const rendered = prose(page).locator(preview);
    const content =
      preview === "ul" || preview === "ol"
        ? rendered.locator("p").first()
        : rendered;
    await content.click({ position: { x: 10, y: 10 } });
    await expect(prose(page).locator(".axiom-source-prose").first()).toHaveText(
      text,
      { useInnerText: false },
    );
    expect(
      await page.evaluate(() => window.editorLab.snapshot()[0].updates),
    ).toBe(updates);
  });

test("repeated Enter creates visible, individually editable blank paragraphs", async ({
  page,
}) => {
  await reset(page);
  let previousY = (await prose(page).locator("p").last().boundingBox())!.y;
  for (let i = 1; i <= 3; i++) {
    await page.keyboard.press("Enter");
    await exact(page, "\n\n".repeat(i), i * 2);
    await expect(prose(page).locator("p")).toHaveCount(i + 1);
    const box = await prose(page).locator("p").last().boundingBox();
    expect(box!.y).toBeGreaterThan(previousY + 10);
    previousY = box!.y;
  }
  await prose(page).locator("p").nth(1).click();
  await page.keyboard.type("middle");
  await exact(page, "\n\nmiddle\n\n\n\n", 8);
  await expect(prose(page).locator("p")).toHaveCount(4);
});

test("Enter between existing paragraphs leaves a visible editable blank", async ({
  page,
}) => {
  await reset(page, "alpha\n\nomega", 5);
  await page.keyboard.press("Enter");
  await exact(page, "alpha\n\n\n\nomega", 7);
  await expect(prose(page).locator("p")).toHaveCount(3);
  await page.keyboard.type("middle");
  await exact(page, "alpha\n\nmiddle\n\nomega", 13);
});

test("Shift Enter stays in the same source paragraph with a real hard break", async ({
  page,
}) => {
  await reset(page, "alpha", 5);
  await page.keyboard.press("Shift+Enter");
  await exact(page, "alpha  \n", 8);
  await expect(prose(page).locator("p")).toHaveCount(1);
  await page.keyboard.type("beta");
  await exact(page, "alpha  \nbeta", 12);
  await expect(prose(page).locator("p")).toHaveCount(1);
  await page.locator('[data-pane="1"] .cm-content').click();
  await expect(prose(page).locator("p br")).toHaveCount(1);
});

for (const key of ["Enter", "Shift+Enter"])
  test(`${key} leaves a heading and renders only the completed heading`, async ({
    page,
  }) => {
    await reset(page, "# Heading", 9);
    await page.keyboard.press(key);
    await exact(page, "# Heading\n\n", 11);
    await expect(prose(page).locator("h1")).toHaveText("Heading");
    await page.keyboard.type("body");
    await exact(page, "# Heading\n\nbody", 15);
  });

for (const [initial, next] of [
  ["- first", "- "],
  ["9. first", "10. "],
  ["- [x] first", "- [ ] "],
])
  test(`Enter continues the active item and exits an empty item: ${initial}`, async ({
    page,
  }) => {
    await reset(page, initial, initial.length);
    await page.keyboard.press("Enter");
    const continued = initial + "\n" + next;
    await exact(page, continued, continued.length);
    await expect(prose(page).locator(".axiom-source-prose")).toHaveText(next, {
      useInnerText: false,
    });
    await page.keyboard.type("second");
    await exact(page, continued + "second", continued.length + 6);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("after");
    const final = continued + "second\n\nafter";
    await exact(page, final, final.length);
    await expect(prose(page).locator("li")).toHaveCount(2);
  });

test("quote continuation keeps the body literal with hidden prefixes, then exits", async ({
  page,
}) => {
  await reset(page, "> first", 7);
  await page.keyboard.press("Enter");
  await exact(page, "> first\n> ", 10);
  await expect(prose(page).locator(".axiom-source-prose")).toHaveText(
    "first\n",
    { useInnerText: false },
  );
  await page.keyboard.type("second");
  await exact(page, "> first\n> second", 16);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("after");
  const final = "> first\n> second\n\nafter";
  await exact(page, final, final.length);
  await expect(prose(page).locator("blockquote")).toBeVisible();
});

for (const text of ["# Title", "- item", "- [ ] task"])
  test(`Backspace in visible source deletes only the character: ${text}`, async ({
    page,
  }) => {
    const at = text.indexOf(" ") + 1;
    await reset(page, text, at);
    await page.keyboard.press("Backspace");
    const next = text.slice(0, at - 1) + text.slice(at);
    await exact(page, next, at - 1);
    await page.keyboard.type("X");
    await exact(page, next.slice(0, at - 1) + "X" + next.slice(at - 1), at);
  });

test("blank paragraph Backspace removes one gap and undo restores its caret", async ({
  page,
}) => {
  await reset(page, "alpha\n\n\n\n", 9);
  await page.keyboard.press("Backspace");
  await exact(page, "alpha\n\n", 7);
  await expect(prose(page).locator("p")).toHaveCount(2);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await exact(page, "alpha\n\n\n\n", 9);
  await expect(prose(page).locator("p")).toHaveCount(3);
});

test("context menu ownership does not hide the active source or its caret", async ({
  page,
}) => {
  await reset(page, "# Heading\n\nOther", 6);
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(prose(page).locator(".axiom-source-prose")).toHaveText(
    "# Heading",
  );
  await page.keyboard.press("Escape");
  await exact(page, "# Heading\n\nOther", 6);
  await expect(
    page.locator(".axiom-block-handle, .axiom-block-drop-line"),
  ).toHaveCount(0);
});

test("remote edits rebase active prose without stealing the caret or local undo", async ({
  page,
}) => {
  const text = "Before\n\n# Heading\n\nAfter";
  await reset(page, text, 17);
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await exact(page, "Peer\n\n" + text, 23);
  await expect(prose(page).locator(".axiom-source-prose")).toHaveText(
    "# Heading",
  );
  await page.keyboard.type("!");
  await exact(page, "Peer\n\n" + text.replace("Heading", "Heading!"), 24);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await exact(page, "Peer\n\n" + text, 23);
});

test("a peer edit during mouse selection rebases the released browser caret", async ({
  page,
}) => {
  const text = "Start\n\nSecond paragraph\n\nEnd";
  await reset(page, text);
  const box = (await prose(page)
    .locator("p")
    .filter({ hasText: /^Second paragraph$/ })
    .boundingBox())!;
  await page.mouse.move(box.x + 48, box.y + 14);
  await page.mouse.down();
  const original = await page.evaluate(() => window.editorLab.domSelection(0));
  expect(original!.head).toBeGreaterThan(7);
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await page.mouse.up();
  await exact(page, "Peer\n\n" + text, original!.head + 6);
  await page.keyboard.type("X");
  await exact(
    page,
    "Peer\n\n" +
      text.slice(0, original!.head) +
      "X" +
      text.slice(original!.head),
    original!.head + 7,
  );
});

test("IME inside active heading source keeps literal markers and rebases a peer edit", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Uses Chromium CDP composition; physical IME acceptance is separate.",
  );
  const text = "# Heading\n\nAfter";
  await reset(page, text, 4);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "yan",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await cdp.send("Input.imeSetComposition", {
    text: "研究",
    selectionStart: 2,
    selectionEnd: 2,
  });
  await cdp.send("Input.insertText", { text: "研究" });
  await exact(page, "Peer\n\n# He研究ading\n\nAfter", 12);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await exact(page, "Peer\n\n" + text, 10);
  await cdp.detach();
});

test("only the active nested item reveals its full prefixes", async ({
  page,
}) => {
  const text = "- Parent\n  - Child\n  - Sibling\n- Next\n\nAfter";
  await reset(page, text, text.indexOf("Child") + 5);
  await expect(prose(page).locator(".axiom-source-prose")).toHaveText(
    "  - Child",
    { useInnerText: false },
  );
  await page.keyboard.type("!");
  await exact(page, text.replace("Child", "Child!"), text.indexOf("Child") + 6);
  await expect(
    prose(page)
      .locator("li")
      .filter({ hasText: /^Sibling$/ }),
  ).toBeVisible();
});

for (const [first, prefix] of [
  ["alpha", ""],
  ["> first", "> "],
  ["- first", "- "],
  ["- [x] first", "- [ ] "],
])
  test(`CRLF Enter retains line endings and continues ${first}`, async ({
    page,
  }) => {
    const text = first + "\r\n\r\nAfter";
    await reset(page, text, first.length);
    await page.keyboard.press("Enter");
    const insert = prefix ? "\r\n" + prefix : "\r\n\r\n";
    const next = first + insert;
    await exact(page, next + "\r\n\r\nAfter", next.length);
    await page.keyboard.type("next");
    await exact(page, next + "next\r\n\r\nAfter", next.length + 4);
    await page.evaluate(() => window.editorLab.execute(0, "undo"));
    await exact(page, next + "\r\n\r\nAfter", next.length);
  });
