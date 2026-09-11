import { expect, test, type Page } from "@playwright/test";

const pane = (page: Page) => page.locator('[data-pane="0"]');
const tex = (page: Page) => pane(page).locator(".axiom-embedded .cm-content");
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
async function reset(page: Page, source: string, at?: number) {
  await page.evaluate(
    async ({ source, at }) => {
      await window.editorLab.reset(source);
      window.editorLab.autoPair(0, true);
      if (at !== undefined) window.editorLab.focus(0, at);
    },
    { source, at },
  );
}
async function shared(page: Page, source: string, at?: number, head = at) {
  await expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([source, source]);
  if (at !== undefined) {
    await expect
      .poll(() => page.evaluate(() => window.editorLab.snapshot()[0].selection))
      .toEqual({ anchor: at, head });
    await expect
      .poll(() => page.evaluate(() => window.editorLab.domSelection(0)))
      .toEqual({ anchor: at, head });
  }
}

test("parenthesized inline math stays source while typing and renders on departure", async ({
  page,
}) => {
  await reset(page, "\n\nOutside", 0);
  let source = "";
  for (const char of "Inline \\(x+1\\) and \\(y^2\\)") {
    await page.keyboard.type(char);
    source += char;
    await shared(page, source + "\n\nOutside", source.length);
    await expect(pane(page).locator(".axiom-source-prose")).toHaveText(source);
  }
  await pane(page)
    .locator("p")
    .filter({ hasText: /^Outside$/ })
    .click();
  await expect(
    pane(page).locator(".math-inline [data-math-request]"),
  ).toHaveCount(2);
  await shared(page, source + "\n\nOutside");
  await page.evaluate(async () => {
    await window.editorLab.mode(0, "source");
    await window.editorLab.mode(0, "read");
  });
  await expect(
    pane(page).locator(".math-inline [data-math-request]"),
  ).toHaveCount(2);
  await shared(page, source + "\n\nOutside");
});

for (const prefix of ["", "> ", "> > ", "> - ", "- > "]) {
  test(
    "typed bracket fences create and collapse without losing their opener: " +
      JSON.stringify(prefix),
    async ({ page }) => {
      await reset(page, prefix, prefix.length);
      for (const char of "\\[") await page.keyboard.type(char);
      const opener = prefix + "\\[",
        bodyPrefix = prefix.replace(/[-+] /g, "  "),
        before = opener + "\n" + bodyPrefix,
        after = "\n" + bodyPrefix + "\\]\n" + (bodyPrefix || "\n");
      await shared(page, opener, opener.length);
      await expect(tex(page)).toHaveCount(0);
      await page.keyboard.press("Enter");
      await expect(tex(page)).toBeFocused();
      await shared(page, before + after, before.length);
      await page.keyboard.type("x");
      await shared(page, before + "x" + after, before.length + 1);
      await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
      await shared(
        page,
        "Peer\n\n" + before + "x" + after,
        6 + before.length + 1,
      );
      await page.keyboard.press("Backspace");
      await shared(page, "Peer\n\n" + opener, 6 + opener.length);
      await expect(tex(page)).toHaveCount(0);
      await page.keyboard.press("ControlOrMeta+z");
      await shared(page, "Peer\n\n" + before + "x" + after);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await shared(page, "Peer\n\n" + opener, 6 + opener.length);
      await page.keyboard.press("Enter");
      await expect(tex(page)).toBeFocused();
      await shared(page, "Peer\n\n" + before + after, 6 + before.length);
    },
  );
}

for (const prefix of ["", "> "])
  for (const ending of ["\n", "\r\n"])
    test(
      "one-line bracket equations expand only for authored multiline edits " +
        JSON.stringify([prefix, ending]),
      async ({ page }) => {
        const source = prefix + "\\[x\\]" + ending.repeat(2) + "End";
        await reset(page, source, source.length);
        await pane(page)
          .getByRole("button", { name: "Edit display equation", exact: true })
          .click();
        await expect(tex(page)).toBeFocused();
        await tex(page).press("ControlOrMeta+End");
        await page.keyboard.press("Enter");
        await page.keyboard.type("y");
        const result =
          prefix +
          "\\[" +
          ending +
          prefix +
          "x" +
          ending +
          prefix +
          "y" +
          ending +
          prefix +
          "\\]" +
          ending.repeat(2) +
          "End";
        await shared(page, result, result.indexOf("y") + 1);
        await expect(tex(page)).toHaveText("xy", { useInnerText: false });
        await page.keyboard.press("ControlOrMeta+Enter");
        await page.keyboard.type("Continue");
        await expect(pane(page).locator(".axiom-source-prose")).toContainText(
          "Continue",
        );
        expect(
          await page.evaluate(() => window.editorLab.snapshot()[0].source),
        ).toContain("\\]");
      },
    );

for (const ending of ["\n", "\r\n"])
  test(
    "task checkboxes preserve nested rendered text and the typing caret " +
      JSON.stringify(ending),
    async ({ page }) => {
      let source = [
        "Caret",
        "",
        "- [ ] **Parent**",
        "  - [ ] _Child_",
        "",
        "> 3. [X] **Quoted**",
        "",
        "End",
      ].join(ending);
      await reset(page, source, 2);
      const checks = pane(page).locator('input[type="checkbox"]');
      await expect(checks).toHaveCount(3);
      for (const [index, oldMarker, nextMarker] of [
        [0, "- [ ] **Parent**", "- [x] **Parent**"],
        [1, "- [ ] _Child_", "- [x] _Child_"],
        [2, "3. [X] **Quoted**", "3. [ ] **Quoted**"],
      ] as const) {
        await checks.nth(index).hover();
        await checks.nth(index).click();
        source = source.replace(oldMarker, nextMarker);
        await shared(page, source, 2);
        await expect(
          pane(page).locator(".axiom-task .axiom-source-prose"),
        ).toHaveCount(0);
        await expect(pane(page).locator(".axiom-task strong")).toHaveCount(2);
        await expect(pane(page).locator(".axiom-task em")).toHaveCount(1);
      }
      await page.keyboard.type("X");
      source = source.slice(0, 2) + "X" + source.slice(2);
      await shared(page, source, 3);
      await page.keyboard.press("ControlOrMeta+z");
      source = source.slice(0, 2) + source.slice(3);
      await shared(page, source, 2);
      await page.keyboard.press("ControlOrMeta+z");
      source = source.replace("3. [ ]", "3. [X]");
      await shared(page, source, 2);
      await expect(checks.nth(2)).toBeChecked();
      await expect(
        pane(page).locator(".axiom-task .axiom-source-prose"),
      ).toHaveCount(0);
    },
  );

test("checking the first task without an editing caret never opens source; Space remains accessible", async ({
  page,
}) => {
  await reset(page, "- [ ] **Task**");
  const checkbox = pane(page).getByRole("checkbox");
  await checkbox.click();
  await shared(page, "- [x] **Task**");
  await expect(pane(page).locator(".axiom-source-prose")).toHaveCount(0);
  await expect(checkbox).toHaveAccessibleName("Mark task incomplete");
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeFocused();
  await expect(checkbox).not.toBeChecked();
  await shared(page, "- [ ] **Task**");
  await expect(pane(page).locator(".axiom-source-prose")).toHaveCount(0);
  await checkbox.press("Space");
  await shared(page, "- [x] **Task**");
  await expect(checkbox).toBeFocused();
  // Deliberately clicking the text still opens its normal source-prose editor.
  await pane(page).locator(".axiom-task strong").click();
  await expect(pane(page).locator(".axiom-source-prose")).toContainText(
    "- [x] **Task**",
  );
});

test("checkbox activation preserves a text range elsewhere", async ({
  page,
}) => {
  const source = "Caret\n\n- [ ] **Task**";
  await reset(page, source, 1);
  await page.evaluate(() => window.editorLab.focus(0, 1, 4));
  await pane(page).getByRole("checkbox").click();
  await shared(page, source.replace("[ ]", "[x]"), 1, 4);
  await page.keyboard.type("X");
  await shared(page, "CXt\n\n- [x] **Task**", 2);
});

test("task controls respect permissions and peer changes while pressed", async ({
  page,
}) => {
  const original = "Caret\n\n- [ ] **Task**";
  for (const change of ["prefix", "replace", "toggle", "permission"] as const) {
    await reset(page, original, 2);
    const checkbox = pane(page).getByRole("checkbox");
    const box = (await checkbox.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.evaluate((change) => {
      if (change === "prefix") window.editorLab.remote(1, 0, 0, "Peer ");
      else if (change === "permission") window.editorLab.readOnly(0, true);
      else window.editorLab.remote(1, 10, 11, change === "toggle" ? "x" : " ");
    }, change);
    await page.mouse.up();
    const expected =
      change === "prefix"
        ? "Peer " + original.replace("[ ]", "[x]")
        : change === "toggle"
          ? original.replace("[ ]", "[x]")
          : original;
    await shared(page, expected);
    await expect(
      pane(page).locator(".axiom-task .axiom-source-prose"),
    ).toHaveCount(0);
    if (change === "permission") {
      await expect(checkbox).toBeDisabled();
      await checkbox.dispatchEvent("change");
      await shared(page, original);
    } else {
      await shared(page, expected, change === "prefix" ? 7 : 2);
      expect(
        await page.evaluate(() => window.editorLab.snapshot()[0].undo),
      ).toBe(change === "prefix" ? 1 : 0);
    }
  }
});
