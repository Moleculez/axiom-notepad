import { test, expect, type Page } from "@playwright/test";
const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  failures.set(page, []);
  page.on("pageerror", (e) => failures.get(page)!.push(e.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(({ page }) => {
  expect(failures.get(page)).toEqual([]);
});
const reset = (page: Page, source: string) =>
  page.evaluate((source) => window.editorLab.reset(source), source);
const shared = async (page: Page, text: string) =>
  expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([text, text]);

test("Source slash commands and TeX suggestions use the active caret and shared history", async ({
  page,
}) => {
  await reset(page, "");
  await page.evaluate(async () => {
    await window.editorLab.mode(0, "source");
    window.editorLab.focus(0, 0);
  });
  await page.keyboard.type("/math");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await shared(page, "/math");
  await reset(page, "$$\n\n$$\n");
  await page.evaluate(async () => {
    await window.editorLab.mode(0, "source");
    window.editorLab.focus(0, 3);
  });
  await page.keyboard.type("\\frac");
  await expect(
    page.getByRole("option", { name: "\\frac", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await shared(page, "$$\n\\frac{numerator}{denominator}\n$$\n");
});
test("embedded mathematics suggestions are placed beside the CM caret", async ({
  page,
}) => {
  await reset(page, "$$\n\n$$\n");
  await page.evaluate(() => window.editorLab.focus(0, 3));
  await page.keyboard.type("\\frac");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  await expect
    .poll(async () => {
      const a = await menu.boundingBox(),
        b = await page.locator('[data-pane="0"] .cm-cursor').boundingBox();
      return a && b ? Math.abs(a.y - (b.y + b.height)) : 999;
    })
    .toBeLessThan(15);
});
test("dividers metadata and definitions have contextual editable views without normalization", async ({
  page,
}) => {
  const original =
    '---\r\ntitle: Research\r\n---\r\n\r\nBefore.\r\n\r\n---\r\n\r\nA result[^a] with [source][paper].\r\n\r\n[^a]: Qualification.\r\n\r\n[paper]: https://example.org "Paper"\r\n';
  await reset(page, original);
  const pane = page.locator('[data-pane="0"]');
  await expect(pane.locator("hr")).toHaveCount(1);
  await expect(
    pane.getByRole("button", { name: "Edit document metadata", exact: true }),
  ).toBeVisible();
  await expect(
    pane.locator('.axiom-footnote[data-footnote-definition="a"]'),
  ).toContainText("Qualification.");
  await expect(pane.locator('[data-kind="referenceDefinition"]')).toContainText(
    "https://example.org",
  );
  await shared(page, original);
  expect(
    await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    ),
  ).toEqual([0, 0]);
  await pane
    .getByRole("button", { name: "Edit document metadata", exact: true })
    .click();
  await expect(
    pane.locator('.axiom-source-prose[data-source-kind="frontmatter"]'),
  ).toBeVisible();
  await page.evaluate(
    (at) => window.editorLab.focus(0, at),
    original.indexOf("Research") + 8,
  );
  await page.keyboard.type(" ");
  await shared(page, original.replace("Research\r\n", "Research \r\n"));
});
test("Mermaid renders in Write and Read and keeps last valid output on invalid edits", async ({
  page,
}) => {
  const text = "```mermaid\ngraph LR\nA --> B\n```\n";
  await reset(page, text);
  const preview = page.locator('[data-pane="0"] [data-mermaid]');
  await expect(preview.locator("svg")).toBeVisible();
  await shared(page, text);
  await page.evaluate(() =>
    window.editorLab.remote(1, 11, 26, "not a valid diagram"),
  );
  await expect(preview).toHaveAttribute("data-preview-state", "stale");
  await expect(preview.locator("svg")).toBeVisible();
  await expect(preview.getByRole("status")).toContainText("Last valid preview");
  await reset(page, text);
  await page.evaluate(() => window.editorLab.mode(0, "read"));
  await expect(
    page.locator('[data-pane="0"] [data-mermaid] svg'),
  ).toBeVisible();
});

test("inline TOC and footnote navigation remain in Write mode without changing source", async ({
  page,
}) => {
  const text =
    "[TOC]\n\n# Overview\n\nText[^a].\n\n## Result\n\n[^a]: A note.\n";
  await reset(page, text);
  const pane = page.locator('[data-pane="0"]');
  await pane.locator(".document-toc a").filter({ hasText: "Result" }).click();
  expect(
    await page.evaluate(() => window.editorLab.snapshot()[0].selection.head),
  ).toBe(text.indexOf("## Result"));
  await pane.locator('a[href="#fn-a"]').click();
  await expect(
    pane.locator(
      '.axiom-footnote[data-footnote-definition="a"] .axiom-source-prose',
    ),
  ).toHaveText("A note.");
  expect(
    await page.evaluate(() => window.editorLab.snapshot()[0].selection.head),
  ).toBe(text.indexOf("A note."));
  await shared(page, text);
});
test("link fields cancel cleanly, commit once, and retain drafts if permission changes", async ({
  page,
}) => {
  const text = 'Before [paper](https://example.org "Original") after.\n';
  await reset(page, text);
  const link = page.locator('[data-pane="0"] .axiom-inline-link');
  await link.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit link details" }).click();
  await page
    .getByRole("textbox", { name: "Title (optional)", exact: true })
    .fill("Updated");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await shared(
    page,
    'Before [paper](<https://example.org> "Updated") after.\n',
  );
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await shared(page, text);
  // The paragraph remains literal source after returning from its fields.
  // Keyboard context menus use the same source-backed link range.
  await page.evaluate(
    (at) => window.editorLab.focus(0, at),
    text.indexOf("paper") + 1,
  );
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Edit link details" }).click();
  await page
    .getByRole("textbox", { name: "Title (optional)", exact: true })
    .fill("Retained draft");
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([
    'Before [paper](<https://example.org> "Retained draft") after.\n',
  ]);
  await shared(page, text);
});
test("no left block handles remain and keyboard block moves undo exactly", async ({
  page,
}) => {
  const text = "Alpha\n\nBeta\n\nGamma";
  await reset(page, text);
  const pane = page.locator('[data-pane="0"]');
  await pane.locator(".axiom-prose > p").filter({ hasText: "Beta" }).hover();
  const handle = page.getByRole("button", { name: "Move or manage block" });
  await expect(handle).toHaveCount(0);
  await expect(
    pane.locator(".axiom-block-handle, .axiom-block-drop-line"),
  ).toHaveCount(0);
  await page.evaluate(() => window.editorLab.focus(0, 7));
  await page.evaluate(() => window.editorLab.execute(0, "moveUp"));
  await shared(page, "Beta\n\nAlpha\n\nGamma");
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await shared(page, text);
});

test("a code-language draft survives permission revocation", async ({
  page,
}) => {
  const text = "```python\nx = 1\n```\n";
  await reset(page, text);
  const block = page.locator('[data-pane="0"] .axiom-embedded');
  await block.hover();
  await block.getByRole("button", { name: "Change code language" }).click();
  await block
    .getByRole("combobox", { name: "Code language", exact: true })
    .fill("julia");
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([
    "```julia\nx = 1\n```\n",
  ]);
  await shared(page, text);
});
test("concurrent field edits preserve the remote source and the local draft", async ({
  page,
}) => {
  const text = '[paper](https://example.org "Original")';
  await reset(page, text);
  await page
    .locator('[data-pane="0"] .axiom-inline-link')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit link details" }).click();
  await page
    .getByRole("textbox", { name: "Title (optional)", exact: true })
    .fill("Local draft");
  await page.evaluate(() => window.editorLab.remote(1, 28, 36, "Remote"));
  const remote = await page.evaluate(
    () => window.editorLab.snapshot()[0].source,
  );
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "source or permission changed",
  );
  await shared(page, remote);
  expect((await page.evaluate(() => window.editorLab.recovery()))[0]).toContain(
    "Local draft",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});
test("citation targets and bibliography update when document references change", async ({
  page,
}) => {
  const text =
    "A finding [@missing].\n\nA qualification[^a].\n\n[^a]: Keep this note.\n";
  await reset(page, text);
  const pane = page.locator('[data-pane="0"]');
  await expect(pane.locator(".axiom-reference-footer")).toContainText(
    "missing — add this reference",
  );
  await expect(pane.locator(".axiom-reference-footer .footnotes")).toHaveCount(
    0,
  );
  await pane.locator('a[href="#ref-missing"]').click();
  await expect(pane.locator("#ref-missing")).toBeFocused();
  await shared(page, text);
});
test("diagram resource syntax never loads remote images", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("external-diagram.test"))
      requests.push(request.url());
  });
  const text =
    '```mermaid\nflowchart LR\nA@{ img: "https://external-diagram.test/track.svg" }\n```\n';
  await reset(page, text);
  await expect(page.locator('[data-pane="0"] [data-mermaid]')).toHaveAttribute(
    "data-preview-state",
    "error",
  );
  expect(requests).toEqual([]);
  await shared(page, text);
});
test("Select All is cell-scoped first and typing replaces mixed-block selections safely", async ({
  page,
}) => {
  const text =
    "# Results\n\n$$\nx=1\n$$\n\n| A | B |\n| --- | --- |\n| rate | 1 |\n\n> A qualification.\n";
  await reset(page, text);
  await page.locator('[data-pane="0"] td').filter({ hasText: /^1$/ }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("2");
  await shared(page, text.replace("| rate | 1 |", "| rate | 2 |"));
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await shared(page, text);
  await page.evaluate(() => window.editorLab.focus(0, 0));
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("Replacement");
  await shared(page, "Replacement");
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await shared(page, text);
  await page.evaluate(
    (length) => window.editorLab.focus(0, length, 0),
    text.length,
  );
  await expect(page.locator('[data-pane="0"] .axiom-prose')).toBeFocused();
  await page.keyboard.insertText("Backward replacement");
  await shared(page, "Backward replacement");
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await shared(page, text);
});
test("context block titles edit only their title range and undo exactly", async ({
  page,
}) => {
  const text =
    "Before.\r\n\r\n> [!THEOREM] Stability\r\n> The energy is conserved.\r\n";
  await reset(page, text);
  await page
    .locator('[data-pane="0"] .axiom-callout')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit block title" }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Energy bound");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await shared(page, text.replace("Stability", "Energy bound"));
  await page.evaluate(() => window.editorLab.execute(0, "undo"));
  await shared(page, text);
});
test("switching from Source to Write retains an explicitly focused selection", async ({
  page,
}) => {
  await reset(page, "Boundary conditions matter.\n\nMore context.");
  await page.evaluate(async () => {
    await window.editorLab.mode(0, "source");
    window.editorLab.focus(0, 0, 27);
    await window.editorLab.mode(0, "write");
  });
  await expect(page.locator('[data-pane="0"] .axiom-prose')).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("Boundary conditions matter.");
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "Comment on selection", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .locator('[data-pane="0"] .axiom-prose > p')
    .first()
    .click({ button: "right", position: { x: 40, y: 12 } });
  await expect(
    page.getByRole("menuitem", { name: "Comment on selection", exact: true }),
  ).toBeVisible();
});
test("structural selection composition rebases around an unrelated peer edit", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "CDP composition does not establish physical IME acceptance.",
  );
  const text = "# Summary\n\n$$\nx=1\n$$\n\nTail.";
  await reset(page, text);
  await page.evaluate(
    (to) => window.editorLab.focus(0, 0, to),
    text.indexOf("\n\nTail."),
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "yan",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await page.evaluate(
    (at) => window.editorLab.remote(1, at, at, " Peer."),
    text.length,
  );
  await cdp.send("Input.insertText", { text: "研究" });
  await shared(page, "研究\n\nTail. Peer.");
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
  await cdp.detach();
});
