import { expect, test, type Page } from "@playwright/test";
import type {} from "./reading-preview";

const pane = (page: Page) => page.locator('[data-pane="0"]');
const reference = (page: Page) =>
  pane(page).locator('[data-footnote-key="a"]').first();
const tip = (page: Page) => page.locator(".footnote-tooltip");
const source =
  "Caret\n\nA result[^a] and another[^a].\n\n[^a]: **Important** _details_, \\(E=mc^2\\), [a paper](https://example.org) and an image ![figure](/figure.svg).\n\n    More information.\n\n    - First point\n    - Second point";
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
async function reset(page: Page, text = source, legacy = false) {
  await page.evaluate(
    async ({ text, legacy }) => {
      await window.editorLab.reset(text, legacy);
      window.editorLab.focus(0, 2);
    },
    { text, legacy },
  );
}
async function stable(page: Page, text = source, at = 2) {
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([text, text]);
  expect(
    await page.evaluate(() => window.editorLab.snapshot()[0].selection),
  ).toEqual({ anchor: at, head: at });
  expect(await page.evaluate(() => window.editorLab.domSelection(0))).toEqual({
    anchor: at,
    head: at,
  });
}

for (const mode of ["write", "source"] as const) {
  for (const ending of ["\n", "\r\n"]) {
    test(`Enter keeps new footnote paragraphs in its preview (${mode}, ${JSON.stringify(ending)})`, async ({
      page,
    }) => {
      const original =
        "Caret" +
        ending +
        ending +
        "A result[^a]." +
        ending +
        ending +
        "[^a]: First.";
      await reset(page, original);
      await page.evaluate(
        async ({ mode, at }) => {
          await window.editorLab.mode(0, mode);
          window.editorLab.focus(0, at);
        },
        { mode, at: original.length },
      );
      await page.keyboard.press("Enter");
      const continued = original + ending + "    " + ending + "    ";
      expect(
        await page.evaluate(() => window.editorLab.domSelection(0)),
      ).toEqual({ anchor: continued.length, head: continued.length });
      await page.evaluate(() => window.editorLab.execute(0, "undo"));
      expect(
        await page.evaluate(() => window.editorLab.snapshot()[0].source),
      ).toBe(original);
      await page.evaluate(() => window.editorLab.execute(0, "redo"));
      expect(
        await page.evaluate(() => window.editorLab.domSelection(0)),
      ).toEqual({ anchor: continued.length, head: continued.length });
      await page.keyboard.type("Second paragraph.");
      const expected =
        original + ending + "    " + ending + "    Second paragraph.";
      expect(
        await page.evaluate(() =>
          window.editorLab.snapshot().map((s) => s.source),
        ),
      ).toEqual([expected, expected]);
      await page.evaluate(async () => {
        await window.editorLab.mode(0, "write");
        window.editorLab.focus(0, 2);
      });
      await reference(page).hover();
      await expect(tip(page)).toContainText("Second paragraph.");
      await expect(tip(page).locator("p")).toHaveCount(2);
    });
  }
}

for (const mode of ["write", "source"] as const) {
  for (const open of ["$$", "\\["]) {
    test(`typed display equations remain in a multiline footnote (${mode}, ${open})`, async ({
      page,
    }) => {
      const original = "Caret\n\nA result[^a].\n\n[^a]: First.";
      await reset(page, original);
      await page.evaluate(
        async ({ mode, at }) => {
          await window.editorLab.mode(0, mode);
          window.editorLab.focus(0, at);
        },
        { mode, at: original.length },
      );
      await page.keyboard.press("Enter");
      await page.keyboard.insertText(open);
      await page.keyboard.press("Enter");
      await page.keyboard.insertText("x=1");
      await page.keyboard.press("Enter");
      await page.keyboard.insertText("y=2");
      const text = await page.evaluate(
        () => window.editorLab.snapshot()[0].source,
      );
      expect(text).toContain(
        "    " +
          open +
          "\n    x=1\n    y=2\n    " +
          (open === "$$" ? "$$" : "\\]"),
      );
      expect(
        await page.evaluate(() => window.editorLab.snapshot()[1].source),
      ).toBe(text);
      await page.evaluate(async () => {
        await window.editorLab.mode(0, "write");
        window.editorLab.focus(0, 2);
      });
      await reference(page).hover();
      await expect(
        tip(page).locator(".math-block [data-math-request]"),
      ).toHaveCount(1);
      await expect(tip(page)).toContainText("y=2");
    });
  }
}

test("empty nested items leave the list first, then leave the footnote without capturing the next paragraph", async ({
  page,
}) => {
  const original = "Caret\n\nA result[^a].\n\n[^a]: First.\n\n    - ";
  await reset(page, original);
  await page.evaluate((at) => window.editorLab.focus(0, at), original.length);
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.editorLab.snapshot()[0].source)).toBe(
    original.slice(0, -2),
  );
  await page.keyboard.type("Still inside.");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Outside.");
  await page.evaluate(() => window.editorLab.focus(0, 2));
  await reference(page).hover();
  await expect(tip(page)).toContainText("Still inside.");
  await expect(tip(page)).not.toContainText("Outside.");
  await expect(
    pane(page)
      .locator("p")
      .filter({ hasText: /^Outside\.$/ }),
  ).toBeVisible();
});

test("wrapped unindented footnote prose is included without absorbing a following paragraph", async ({
  page,
}) => {
  await reset(
    page,
    "Caret\n\nA result[^a].\n\n[^a]: First.\nSecond **line**.\nThird line.\n\nOutside.",
  );
  await reference(page).hover();
  await expect(tip(page)).toContainText("Third line.");
  await expect(tip(page).locator("strong")).toHaveText("line");
  await expect(tip(page)).not.toContainText("Outside.");
});

test("the rollback Source editor retains footnote continuation and CRLF", async ({
  page,
}) => {
  const original = "Caret\r\n\r\nA result[^a].\r\n\r\n[^a]: First.";
  await reset(page, original, true);
  await page.evaluate(async (at) => {
    await window.editorLab.mode(1, "source");
    window.editorLab.focus(1, at);
  }, original.length);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second paragraph.");
  const expected = original + "\r\n    \r\n    Second paragraph.";
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([expected, expected]);
  await page.evaluate(() => window.editorLab.focus(0, 2));
  await reference(page).hover();
  await expect(tip(page)).toContainText("Second paragraph.");
});

test("hover shows formatted content without moving the caret, revealing source or writing history", async ({
  page,
}) => {
  await reset(page);
  const before = await page.evaluate(() => window.editorLab.snapshot());
  await reference(page).hover();
  await expect(tip(page)).toBeVisible();
  await expect(tip(page).locator("strong")).toHaveText("Important");
  await expect(tip(page).locator("em")).toHaveText("details");
  await expect(
    tip(page).locator(".math-inline [data-math-request]"),
  ).toHaveCount(1);
  await expect(tip(page).locator("li")).toHaveCount(2);
  await expect(tip(page)).toContainText("More information");
  await expect(tip(page)).toContainText("Image disabled");
  await expect(
    tip(page).locator(
      "a, button, [id], [tabindex], [contenteditable], [data-footnote-key], img",
    ),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.editorLab.snapshot())).toEqual(
    before,
  );
  await stable(page);
  await tip(page).hover();
  await page.waitForTimeout(220);
  await expect(tip(page)).toBeVisible();
  await tip(page).click();
  await stable(page);
  await page.keyboard.press("Escape");
  await expect(tip(page)).toHaveCount(0);
  await page.keyboard.type("X");
  await stable(page, "CaXret" + source.slice(5), 3);
});

test("brief pointer passes do not open a preview and leaving both surfaces dismisses it", async ({
  page,
}) => {
  await reset(page);
  await reference(page).dispatchEvent("pointerover", { pointerType: "mouse" });
  await reference(page).dispatchEvent("pointerout", { pointerType: "mouse" });
  await page.waitForTimeout(350);
  await expect(tip(page)).toHaveCount(0);
  await reference(page).hover();
  await expect(tip(page)).toBeVisible();
  await page.mouse.move(8, 8);
  await expect(tip(page)).toHaveCount(0);
  await stable(page);
});

test("keyboard focus, description cleanup and Enter retain accessible navigation", async ({
  page,
}) => {
  await reset(page);
  await reference(page).evaluate((element) =>
    element.setAttribute("aria-describedby", "existing-description"),
  );
  await reference(page).focus();
  await expect(tip(page)).toBeVisible();
  await expect(reference(page)).toBeFocused();
  await expect(reference(page)).toHaveAttribute(
    "aria-describedby",
    /existing-description footnote-tip-/,
  );
  await page.keyboard.press("Escape");
  await expect(tip(page)).toHaveCount(0);
  await expect(reference(page)).toBeFocused();
  await expect(reference(page)).toHaveAttribute(
    "aria-describedby",
    "existing-description",
  );
  await page.keyboard.press("Enter");
  await expect(
    pane(page).locator(
      '.axiom-footnote[data-footnote-definition="a"] .axiom-source-prose',
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.editorLab.snapshot()[0].selection.head),
  ).toBe(source.indexOf("**Important**"));
  expect(
    await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    ),
  ).toEqual([0, 0]);
});

test("click still navigates, while active overlays suppress hover without being dismissed", async ({
  page,
}) => {
  await reset(page);
  await reference(page).hover();
  await expect(tip(page)).toBeVisible();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu", { name: "Block actions" })).toBeVisible();
  await expect(tip(page)).toHaveCount(0);
  await page.mouse.move(8, 8);
  // The top-layer menu may cover the reference. Move the physical pointer,
  // rather than asking Playwright to wait for the covered element to receive it.
  const box = (await reference(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(350);
  await expect(tip(page)).toHaveCount(0);
  await expect(page.getByRole("menu", { name: "Block actions" })).toBeVisible();
  await page.keyboard.press("Escape");
  await reference(page).click();
  await expect(
    pane(page).locator(
      '.axiom-footnote[data-footnote-definition="a"] .axiom-source-prose',
    ),
  ).toBeVisible();
  expect(await page.evaluate(() => window.editorLab.snapshot()[0].source)).toBe(
    source,
  );
});

test("an open preview refreshes after peer edits and closes when the reference is removed", async ({
  page,
}) => {
  await reset(page);
  await reference(page).hover();
  await expect(tip(page)).toContainText("Important");
  const at = source.indexOf("Important");
  await page.evaluate(
    (at) => window.editorLab.remote(1, at, at + 9, "Updated"),
    at,
  );
  await expect(tip(page)).toContainText("Updated");
  await expect(tip(page)).not.toContainText("Important");
  await stable(page, source.replace("Important", "Updated"));
  const ref = source.indexOf("[^a]");
  await page.evaluate((at) => window.editorLab.remote(1, at, at + 4, ""), ref);
  await expect(tip(page)).toHaveCount(0);
  await expect(reference(page)).toHaveCount(1);
});

test("secondary clicks inspect a footnote without revealing its definition or moving the caret", async ({
  page,
}) => {
  await reset(page);
  await reference(page).hover();
  await expect(tip(page)).toBeVisible();
  await reference(page).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Block actions" })).toBeVisible();
  await expect(tip(page)).toHaveCount(0);
  await expect(
    pane(page).locator(
      '.axiom-source-prose[data-source-kind="footnoteDefinition"]',
    ),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await stable(page);
});

test("long content scrolls without moving the editor and keeps its bounds after resize", async ({
  page,
}) => {
  const text =
    "Caret\n\nResult[^a].\n\n[^a]: First paragraph.\n\n" +
    Array.from(
      { length: 24 },
      (_, i) => "    Paragraph " + i + " with readable research details.",
    ).join("\n\n");
  await reset(page, text);
  await reference(page).hover();
  await expect(tip(page)).toBeVisible();
  const box = (await tip(page).boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(320);
  expect(
    await tip(page).evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  await tip(page).hover();
  await page.mouse.wheel(0, 240);
  await expect
    .poll(() => tip(page).evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await stable(page, text);
  await page.setViewportSize({ width: 1000, height: 650 });
  await expect
    .poll(async () => {
      const rect = await tip(page).boundingBox();
      return (
        !!rect &&
        rect.x >= 12 &&
        rect.y >= 12 &&
        rect.x + rect.width <= 989 &&
        rect.y + rect.height <= 639
      );
    })
    .toBe(true);
});

test("scrolling a reference out of its clipped pane dismisses the tooltip", async ({
  page,
}) => {
  const text =
    "Caret\n\nResult[^a].\n\n" +
    "Many paragraphs.\n\n".repeat(60) +
    "[^a]: A definition.";
  await reset(page, text);
  await reference(page).hover();
  await expect(tip(page)).toBeVisible();
  await pane(page)
    .locator(".axiom-editor")
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  await expect(tip(page)).toHaveCount(0);
});

test("Write, Read, Source and read-only views keep preview state local", async ({
  page,
}) => {
  await reset(page);
  await reference(page).hover();
  await expect(tip(page)).toBeVisible();
  await page.evaluate(() => window.editorLab.mode(0, "source"));
  await expect(tip(page)).toHaveCount(0);
  await expect(reference(page)).toHaveCount(0);
  await page.evaluate(() => window.editorLab.mode(0, "read"));
  await reference(page).hover();
  await expect(tip(page)).toContainText("Important");
  await page.evaluate(() => window.editorLab.mode(0, "write"));
  await page.evaluate(() => {
    window.editorLab.focus(0, 2);
    window.editorLab.readOnly(0, true);
  });
  await reference(page).hover();
  await expect(tip(page)).toContainText("Important");
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([source, source]);
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(tip(page)).toHaveCount(0);
});

test("the native rollback editor uses the same formatted previews", async ({
  page,
}) => {
  await reset(page, source, true);
  const legacyRef = page
    .locator('[data-pane="1"] [data-footnote-key="a"]')
    .first();
  await legacyRef.hover();
  await expect(tip(page).locator("strong")).toHaveText("Important");
  await legacyRef.focus();
  await expect(legacyRef).toBeFocused();
  await page.keyboard.press("Enter");
  expect(
    await page.evaluate(() => window.editorLab.snapshot()[1].selection.head),
  ).toBe(source.indexOf("[^a]:"));
  expect(
    await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    ),
  ).toEqual([0, 0]);
});

test("React reading panes resolve identical footnote keys independently and clean up on unmount", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const module = "/tests/editor-lab/reading-preview.ts";
    await import(module);
    window.footnoteReadingLab.mount([
      "First[^a].\n\n[^a]: **First document**.",
      "Second[^a].\n\n[^a]: _Second document_.",
    ]);
  });
  const first = page.locator('[data-reader="0"] a[data-footnote-key]');
  const second = page.locator('[data-reader="1"] a[data-footnote-key]');
  await first.hover();
  await expect(tip(page)).toHaveText("First document.");
  await second.hover();
  await expect(tip(page)).toHaveCount(1);
  await expect(tip(page)).toHaveText("Second document.");
  await expect(first).not.toHaveAttribute("aria-describedby");
  await page.evaluate(() =>
    window.footnoteReadingLab.update(
      1,
      "Second[^a].\n\n[^a]: Changed definition.",
    ),
  );
  await expect(tip(page)).toHaveCount(0);
  await page.mouse.move(8, 8);
  await second.hover();
  await expect(tip(page)).toHaveText("Changed definition.");
  await page.evaluate(() => window.footnoteReadingLab.destroy());
  await expect(tip(page)).toHaveCount(0);
});
