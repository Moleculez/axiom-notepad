import { test, expect, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (e) => errors.get(page)!.push(e.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
});
const prose = (page: Page) => page.locator('[data-pane="0"] .axiom-prose');
async function reset(page: Page, source: string, at = source.length) {
  await page.evaluate(
    async ({ source, at }) => {
      await window.editorLab.reset(source);
      window.editorLab.focus(0, at);
    },
    { source, at },
  );
}
async function exact(page: Page, source: string, at = source.length) {
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
test("space creates an empty quote immediately and body input stays literal and uninterrupted", async ({
  page,
}) => {
  await reset(page, "\n\nOutside", 0);
  await page.keyboard.type(">");
  await exact(page, ">\n\nOutside", 1);
  await expect(prose(page).locator("blockquote")).toHaveCount(0);
  await page.keyboard.type(" ");
  await exact(page, "> \n\nOutside", 2);
  await expect(
    prose(page).locator("blockquote .axiom-source-prose"),
  ).toBeVisible();
  const quoteBox = (await prose(page).locator("blockquote").boundingBox())!;
  const bodyBox = (await prose(page)
    .locator("blockquote .axiom-source-prose")
    .boundingBox())!;
  expect(bodyBox.x).toBeGreaterThan(quoteBox.x + 10);
  let body = "";
  for (const letter of "**A result** and $x$") {
    await page.keyboard.type(letter);
    body += letter;
    await exact(page, "> " + body + "\n\nOutside", body.length + 2);
    await expect(
      prose(page).locator("blockquote .axiom-source-prose"),
    ).toHaveText(body, { useInnerText: false });
  }
  const before = await page.evaluate(() =>
    window.editorLab.snapshot().map((s) => s.updates),
  );
  await prose(page).getByText("Outside", { exact: true }).click();
  await expect(prose(page).locator("blockquote strong")).toHaveText("A result");
  await prose(page).locator("blockquote").click();
  await expect(
    prose(page).locator("blockquote .axiom-source-prose"),
  ).toHaveText(body);
  expect(
    await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    ),
  ).toEqual(before);
});
test("quoted-body composition rebases without revealing or duplicating prefixes", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "CDP composition is not physical IME acceptance.",
  );
  await reset(page, "> **text**\r\n> tail", 6);
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
  await exact(page, "Peer\r\n\r\n> **te研究xt**\r\n> tail", 16);
  await expect(
    prose(page).locator("blockquote .axiom-source-prose"),
  ).toHaveText("**te研究xt**\ntail", { useInnerText: false });
  await cdp.detach();
});
test("permission changes block quote typing and boundary commands", async ({
  page,
}) => {
  await reset(page, "> text", 2);
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await expect(prose(page)).toHaveAttribute("contenteditable", "false");
  // A disabled contenteditable is no longer a native keyboard focus target;
  // WebKit's Backspace then navigates browser history. Exercise the editor's
  // permission guards directly instead of asserting a browser-global shortcut.
  expect(
    await prose(page).evaluate((el) =>
      ["deleteContentBackward", "insertText"].map((inputType) => {
        const event = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType,
          data: inputType === "insertText" ? "ignored" : null,
        });
        el.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ),
  ).toEqual([true, true]);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual(["> text", "> text"]);
});
test("bare and unspaced quote markers remain literal, including nested pending input", async ({
  page,
}) => {
  await reset(page, "");
  await page.keyboard.type(">unspaced");
  await exact(page, ">unspaced");
  await expect(prose(page).locator("blockquote")).toHaveCount(0);
  await reset(page, "> ");
  await page.keyboard.type(">");
  await exact(page, "> >");
  await expect(prose(page).locator("blockquote")).toHaveCount(1);
  await page.keyboard.type(" ");
  await exact(page, "> > ");
  await expect(prose(page).locator("blockquote")).toHaveCount(2);
  await page.keyboard.type("nested");
  await exact(page, "> > nested");
});
test("Backspace unwraps one quote level and undo restores source and caret", async ({
  page,
}) => {
  const source = "> > first\r\n> > second\r\n\r\nOutside";
  await reset(page, source, 4);
  await page.keyboard.press("Backspace");
  await exact(page, "> first\r\n> second\r\n\r\nOutside", 2);
  await page.keyboard.press("Backspace");
  await exact(page, "first\r\nsecond\r\n\r\nOutside", 0);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await exact(page, "> first\r\n> second\r\n\r\nOutside", 2);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await exact(page, source, 4);
  await reset(page, "> ");
  await page.keyboard.press("Backspace");
  await exact(page, "", 0);
  await page.keyboard.type("body");
  await exact(page, "body");
});
test("Enter continues and exits quotes; line joins do not leave stray prefixes", async ({
  page,
}) => {
  await reset(page, "> first");
  await page.keyboard.press("Enter");
  await exact(page, "> first\n> ");
  await page.keyboard.type("second");
  await exact(page, "> first\n> second");
  await page.evaluate(() => window.editorLab.focus(0, 10));
  await page.keyboard.press("Backspace");
  await exact(page, "> firstsecond", 7);
  await page.evaluate(() => window.editorLab.focus(0, 13));
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("after");
  await exact(page, "> firstsecond\n\nafter");
});
test("multiline clipboard input and peer prefix edits retain source authority", async ({
  page,
}) => {
  await reset(page, "> > alpha\r\n> > beta", 9);
  await prose(page).evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "\nx\ny");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    el.dispatchEvent(event);
  });
  const source = "> > alpha\r\n> > x\r\n> > y\r\n> > beta";
  await exact(page, source, source.indexOf("y") + 1);
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Before\r\n\r\n"));
  await exact(page, "Before\r\n\r\n" + source, source.indexOf("y") + 11);
  await page.keyboard.type("Z");
  await exact(
    page,
    "Before\r\n\r\n" + source.replace("y", "yZ"),
    source.indexOf("y") + 12,
  );
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await exact(page, "Before\r\n\r\n" + source, source.indexOf("y") + 11);
});
