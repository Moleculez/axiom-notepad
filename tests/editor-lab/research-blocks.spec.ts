import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/editor-lab/index.html");
  await page.waitForFunction(() => !!window.editorLabReady);
  await page.evaluate(() => window.editorLabReady);
});
const rich = (page: Page) => page.locator('[data-pane="0"] .axiom-prose');
async function reset(page: Page, source: string, at = source.length) {
  await page.evaluate(
    async ({ source, at }) => {
      await window.editorLab.reset(source);
      window.editorLab.focus(0, at);
    },
    { source, at },
  );
}
async function exact(page: Page, source: string) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.editorLab.snapshot().map((session) => session.source),
      ),
    )
    .toEqual([source, source]);
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
}

for (const prefix of ["- ", "* ", "1. ", "- [ ] "]) {
  test(`marker stays rendered through typing and refocusing: ${prefix}`, async ({
    page,
  }) => {
    await reset(page, "\n\nOutside", 0);
    await page.keyboard.type(prefix);
    await expect(rich(page).locator("li")).toHaveCount(1);
    await expect(rich(page).locator("li .axiom-source-prose")).toHaveText("");
    if (prefix.includes("["))
      await expect(rich(page).getByRole("checkbox")).toBeVisible();
    await page.keyboard.type("alpha");
    await exact(page, prefix + "alpha\n\nOutside");
    await rich(page).getByText("Outside", { exact: true }).click();
    await rich(page).locator("li p").click();
    await expect(rich(page).locator("li .axiom-source-prose")).toHaveText(
      "alpha",
    );
    expect(
      await rich(page)
        .locator("li")
        .evaluate((node) => getComputedStyle(node).listStyleType),
    ).not.toBe(prefix.includes("[") ? "disc" : "none");
  });
}

test("Mod Enter breaks within an item; Enter makes a sibling and double Enter exits", async ({
  page,
}) => {
  await reset(page, "1. alpha");
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.type("second line");
  await exact(page, "1. alpha  \n   second line");
  await expect(rich(page).locator("li")).toHaveCount(1);
  await expect(rich(page).locator("li p")).toHaveText("alpha  \nsecond line", {
    useInnerText: false,
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("beta");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("outside");
  await exact(page, "1. alpha  \n   second line\n2. beta\n\noutside");
  await expect(rich(page).locator(":scope > p").last()).toHaveText("outside");
});

test("blank nested items remain items, outdent one level, and preserve caret through peer edits", async ({
  page,
}) => {
  await reset(page, "- parent\n- ");
  await page.keyboard.press("Tab");
  await expect(rich(page).locator("ul ul li")).toHaveCount(1);
  await page.keyboard.type("child");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(rich(page).locator("ul ul ul li")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.keyboard.type("sibling");
  await exact(page, "- parent\n    - child\n    - sibling");
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Intro\n\n"));
  await page.keyboard.type("!");
  await exact(page, "Intro\n\n- parent\n    - child\n    - sibling!");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("parent level");
  await exact(
    page,
    "Intro\n\n- parent\n    - child\n    - sibling!\n- parent level",
  );
});

test("Backspace at a nested item start outdents one complete level", async ({
  page,
}) => {
  const source = "- parent\n    - child\n        - grandchild";
  await reset(page, source, source.indexOf("grandchild"));
  await page.keyboard.press("Backspace");
  await page.keyboard.type("new ");
  await exact(page, "- parent\n    - child\n    - new grandchild");
  await expect(rich(page).locator("ul ul li")).toHaveCount(2);
});

test("Backspace on a root quoted item removes its list marker without eating the quote rail", async ({
  page,
}) => {
  const source = "> - alpha";
  await reset(page, source, source.indexOf("alpha"));
  await page.keyboard.press("Backspace");
  await page.keyboard.type("new ");
  await exact(page, "> new alpha");
  await expect(rich(page).locator("blockquote")).toHaveCount(1);
  await expect(rich(page).locator("li")).toHaveCount(0);
});

test("Enter on a blank final table row exits without leaving an extra empty row", async ({
  page,
}) => {
  const source = "| A | B |\n| --- | --- |\n| x | y |";
  await reset(page, source, source.indexOf("x") + 1);
  await page.keyboard.press("Enter");
  await expect(rich(page).locator("tr")).toHaveCount(3);
  await page.keyboard.press("Enter");
  await page.keyboard.type("after table");
  await expect(rich(page).locator("tr")).toHaveCount(2);
  await expect(rich(page).locator(":scope > p").last()).toHaveText(
    "after table",
  );
  expect(
    await page.evaluate(() => window.editorLab.snapshot()[0].source),
  ).toContain("x | y");
});

test("TOC is navigable static content; left/right clicks never expose its Markdown", async ({
  page,
}) => {
  const source = "[TOC]\n\n# Research\n\n## Results\n\nBody";
  await reset(page, source);
  const toc = rich(page).getByRole("navigation", { name: "Table of contents" });
  await toc.getByRole("link", { name: "Results" }).click();
  await expect(rich(page).locator("h2")).toBeVisible();
  await toc.click({ button: "right" });
  await page.keyboard.press("Escape");
  await toc.getByText("Contents", { exact: true }).click();
  await expect(
    rich(page).locator(
      '.axiom-toc .cm-content, .axiom-source-prose[data-source-kind="toc"]',
    ),
  ).toHaveCount(0);
  await exact(page, source);
  await page.keyboard.press("Backspace");
  await expect(toc).toHaveCount(0);
});

test("metadata is an editable, shared property table with preserved complex YAML", async ({
  page,
}, info) => {
  const source =
    "---\ntitle: Research\nauthors:\n  - Ada\n  - Emmy\ntags: [ai, math]\n---\n\nBody";
  await reset(page, source);
  const table = rich(page).getByRole("table", { name: "Document metadata" });
  await expect(table).toBeVisible();
  const title = table.getByRole("textbox", {
    name: "Value for title",
    exact: true,
  });
  await title.fill("Revised research");
  await table.getByRole("textbox", { name: "Value for tags" }).click();
  await exact(page, source.replace("Research", "Revised research"));
  await expect(table.locator("pre")).toContainText("Emmy");
  await title.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Add property", exact: true })
    .click();
  await expect(
    table.getByRole("textbox", { name: "Value for property", exact: true }),
  ).toBeFocused();
  await page.keyboard.type("new value");
  await rich(page).getByText("Body", { exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.editorLab.snapshot()[0].source))
    .toContain("property: new value");
  await page.screenshot({ path: info.outputPath("metadata-table.png") });
});

test("metadata insertion focuses a value; renamed fields stay editable and empty Enter exits", async ({
  page,
}) => {
  await reset(page, "Body", 0);
  await page.evaluate(() => window.editorLab.execute(0, "metadata"));
  const table = rich(page).getByRole("table", { name: "Document metadata" });
  await expect(
    table.getByRole("textbox", { name: "Value for title", exact: true }),
  ).toBeFocused();
  const key = table.getByRole("textbox", {
    name: "Property name: title",
    exact: true,
  });
  await key.fill("subject");
  await page.keyboard.press("Tab");
  const value = table.getByRole("textbox", {
    name: "Value for subject",
    exact: true,
  });
  await expect(value).toBeFocused();
  await value.fill("Physics");
  await table
    .getByRole("textbox", { name: "Value for tags", exact: true })
    .fill("");
  await page.keyboard.press("Enter");
  await page.keyboard.type("After metadata");
  await expect(rich(page).locator(":scope > p").first()).toContainText(
    "After metadata",
  );
  await expect
    .poll(() => page.evaluate(() => window.editorLab.snapshot()[0].source))
    .toContain("subject: Physics");
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
});

test("overlapping peer edits retain a full metadata draft without overwriting the peer", async ({
  page,
}) => {
  const source = "---\ntitle: Original\n---\n\nBody";
  await reset(page, source);
  await rich(page)
    .getByRole("textbox", { name: "Value for title", exact: true })
    .fill("Local draft");
  await page.evaluate(
    (from) =>
      window.editorLab.remote(1, from, from + "Original".length, "Peer title"),
    source.indexOf("Original"),
  );
  await rich(page).getByText("Body", { exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.editorLab.snapshot().map((session) => session.source),
      ),
    )
    .toEqual([
      source.replace("Original", "Peer title"),
      source.replace("Original", "Peer title"),
    ]);
  expect(await page.evaluate(() => window.editorLab.recovery())).toContain(
    source.replace("Original", "Local draft"),
  );
});

test("a rendered equation keeps the same typeset DOM through edits above and inside it", async ({
  page,
}) => {
  const source = "Before\n\n$$\nx^2\n$$\n\nAfter";
  await reset(page, source, 6);
  // The lab has no TeX worker. Seed the already-rendered state to isolate the
  // view lifecycle; production acceptance separately exercises the real worker.
  await page.locator('[data-pane="0"] [data-math-request]').evaluate((node) => {
    node.innerHTML = '<svg data-render-identity="stable"><text>x²</text></svg>';
    (node as HTMLElement).dataset.mathState = "ready";
    node.setAttribute("aria-busy", "false");
    (window as any).equationIdentity = node.firstElementChild;
  });
  await page.keyboard.type(" text above");
  expect(
    await page.evaluate(
      () =>
        document.querySelector('[data-pane="0"] [data-render-identity]') ===
        (window as any).equationIdentity,
    ),
  ).toBeTruthy();
  const text = await page.evaluate(() => window.editorLab.snapshot()[0].source);
  await page.evaluate(
    (at) => window.editorLab.focus(0, at),
    text.indexOf("x^2") + 3,
  );
  await page.keyboard.type("+y^2");
  await expect(
    page.locator('[data-pane="0"] [data-math-request]'),
  ).toHaveAttribute("data-math-state", "pending");
  expect(
    await page.evaluate(
      () =>
        document.querySelector('[data-pane="0"] [data-render-identity]') ===
        (window as any).equationIdentity,
    ),
  ).toBeTruthy();
  await exact(page, text.replace("x^2", "x^2+y^2"));
});
