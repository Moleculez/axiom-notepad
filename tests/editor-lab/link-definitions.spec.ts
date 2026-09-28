import { test, expect, type Page } from "@playwright/test";
const original =
  'Read the [paper][ref] and [ref][].\n\n[ref]: https://example.org "Research paper"\n\nAfter.\n';
const failures = new WeakMap<Page, string[]>();
const pane = (page: Page) => page.locator('[data-pane="0"]');
const card = (page: Page) =>
  pane(page).getByRole("group", { name: "Link definition", exact: true });
const reset = (page: Page, source = original) =>
  page.evaluate((source) => window.editorLab.reset(source), source);
const shared = (page: Page, source: string) =>
  expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([source, source]);
test.beforeEach(async ({ page }) => {
  failures.set(page, []);
  page.on("pageerror", (error) => failures.get(page)!.push(error.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
  await reset(page);
});
test.afterEach(({ page }) => {
  expect(failures.get(page)).toEqual([]);
});

test("rich fields stay rendered, commit once, navigate and undo", async ({
  page,
}) => {
  await expect(
    card(page).getByLabel("Destination", { exact: true }),
  ).toHaveValue("https://example.org");
  await card(page).hover();
  await card(page)
    .locator(".editor-properties-title")
    .click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Link definition actions" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card(page).locator(".cm-editor")).toHaveCount(0);
  const url = card(page).getByLabel("Destination", { exact: true });
  await url.fill("https://example.org/new");
  await shared(page, original); // Drafts don't reparse the document per character.
  await page.keyboard.press("Enter");
  await expect(card(page).getByLabel("Title", { exact: true })).toBeFocused();
  await shared(
    page,
    original.replace("https://example.org", "https://example.org/new"),
  );
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, original);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await shared(
    page,
    original.replace("https://example.org", "https://example.org/new"),
  );
  await card(page)
    .getByRole("button", { name: "Open destination", exact: true })
    .click();
  expect(
    await page.evaluate(() => window.editorLab.hostEvents()),
  ).toContainEqual({
    kind: "link",
    index: 0,
    target: "https://example.org/new",
  });
});

test("renaming updates all uses in one undo step; Escape discards drafts", async ({
  page,
}) => {
  const id = card(page).getByLabel("Reference ID", { exact: true });
  await id.fill("study");
  await page.keyboard.press("Enter");
  await shared(
    page,
    original
      .replaceAll("[ref]", "[study]")
      .replace("[study][]", "[ref][study]"),
  );
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, original);
  await card(page).getByLabel("Title", { exact: true }).fill("Discard me");
  await page.keyboard.press("Escape");
  await shared(page, original);
  await expect(card(page).getByLabel("Title", { exact: true })).toHaveValue(
    "Research paper",
  );
  await card(page)
    .getByRole("button", { name: "Go to next reference use (2)" })
    .click();
  expect(
    await page.evaluate(() => window.editorLab.snapshot()[0].selection.head),
  ).toBe(original.indexOf("[paper]"));
});

test("peer insertion keeps a field focused; conflicting peer edits retain recovery", async ({
  page,
}) => {
  const url = card(page).getByLabel("Destination", { exact: true });
  await url.fill("https://local.example");
  await page.evaluate(() =>
    window.editorLab.remote(1, 0, 0, "Peer paragraph.\n\n"),
  );
  await expect(url).toBeFocused();
  await expect(url).toHaveValue("https://local.example");
  await page.keyboard.press("Enter");
  await shared(
    page,
    "Peer paragraph.\n\n" +
      original.replace("https://example.org", "https://local.example"),
  );
  await reset(page);
  await card(page).getByLabel("Title", { exact: true }).fill("Local title");
  await page.evaluate(() => {
    const text = window.editorLab.snapshot()[1].source;
    const at = text.indexOf("Research paper");
    window.editorLab.remote(1, at, at + "Research paper".length, "Peer title");
  });
  await page.keyboard.press("Enter");
  await shared(page, original.replace("Research paper", "Peer title"));
  expect(
    (await page.evaluate(() => window.editorLab.recovery())).some((s) =>
      s.includes("Local title"),
    ),
  ).toBe(true);
});

test("validation, read-only revocation and empty Backspace never damage neighbors", async ({
  page,
}) => {
  const url = card(page).getByLabel("Destination", { exact: true });
  await url.fill("javascript:alert(1)");
  await page.keyboard.press("Enter");
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await shared(page, original);
  await page.keyboard.press("Escape");
  await url.fill("https://unsaved.example");
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await expect(url).toHaveAttribute("readonly", "");
  await shared(page, original);
  expect(
    (await page.evaluate(() => window.editorLab.recovery())).some((s) =>
      s.includes("https://unsaved.example"),
    ),
  ).toBe(true);
  await reset(page, "Before\n\n[ref]: <>\n\nAfter\n");
  await card(page).getByLabel("Destination", { exact: true }).click();
  await page.keyboard.press("Backspace");
  await expect(card(page)).toHaveCount(0);
  await shared(page, "Before\n\n[ref]: \n\nAfter\n");
  await page.keyboard.type("draft");
  await expect(
    card(page).getByLabel("Destination", { exact: true }),
  ).toHaveValue("draft");
  await page.keyboard.press("Enter");
  await shared(page, "Before\n\n[ref]: draft\n\nAfter\n");
});

test("multiline titles and keyboard exit preserve paragraphs without source flashes", async ({
  page,
}) => {
  const source =
    "[ref]:\r\n  <https://example.org/a b>\r\n  'Long\r\n  title'\r\n\r\nAfter\r\n";
  await reset(page, source);
  await card(page).getByLabel("Title", { exact: true }).click();
  await page.keyboard.press("Escape");
  await shared(page, source);
  await card(page).getByLabel("Destination", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.type("New paragraph");
  expect(
    await page.evaluate(() => window.editorLab.snapshot()[0].source),
  ).toContain("New paragraph\r\n\r\nAfter");
});

test("Tab and source switching commit drafts; local anchors navigate", async ({
  page,
}) => {
  await reset(page, "# Target\n\n[ref]: #target\n\nAfter\n");
  const url = card(page).getByLabel("Destination", { exact: true });
  await url.fill("https://example.org");
  await page.keyboard.press("Tab");
  await shared(page, "# Target\n\n[ref]: https://example.org\n\nAfter\n");
  await card(page).getByLabel("Title", { exact: true }).fill("Keep this draft");
  await page.evaluate(() => window.editorLab.mode(0, "source"));
  await shared(
    page,
    '# Target\n\n[ref]: https://example.org "Keep this draft"\n\nAfter\n',
  );
  await reset(page, "# Target\n\n[ref]: #target\n\nAfter\n");
  await card(page).hover();
  await card(page)
    .getByRole("button", { name: "Open destination", exact: true })
    .click();
  expect(
    await page.evaluate(() => window.editorLab.snapshot()[0].selection.head),
  ).toBe(0);
  expect(await page.evaluate(() => window.editorLab.hostEvents())).toEqual([]);
});

test("peer deletion retains the local draft instead of recreating a deleted block", async ({
  page,
}) => {
  await card(page).getByLabel("Title", { exact: true }).fill("Local draft");
  await page.evaluate(() => {
    const text = window.editorLab.snapshot()[1].source;
    window.editorLab.remote(
      1,
      text.indexOf("[ref]:"),
      text.indexOf("\n\nAfter"),
      "",
    );
  });
  await expect(card(page)).toHaveCount(0);
  expect(
    (await page.evaluate(() => window.editorLab.recovery())).some((s) =>
      s.includes('"Local draft"'),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => window.editorLab.snapshot()[0].source),
  ).not.toContain("[ref]:");
});

test("an input composition Enter cannot commit the definition early", async ({
  page,
}) => {
  const title = card(page).getByLabel("Title", { exact: true });
  await title.focus();
  await title.dispatchEvent("compositionstart", { data: "" });
  await title.fill("研究結果");
  await title.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await shared(page, original);
  await title.dispatchEvent("compositionend", { data: "研究結果" });
  await page.keyboard.press("Tab");
  await shared(page, original.replace("Research paper", "研究結果"));
});
