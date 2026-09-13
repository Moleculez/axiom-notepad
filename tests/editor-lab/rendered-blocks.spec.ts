import { test, expect, type Page } from "@playwright/test";

const pane = (page: Page) => page.locator('[data-pane="0"]');
const image = (page: Page) => pane(page).locator(".axiom-image").first();
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#6c8b99"/><text x="40" y="95" fill="white" font-size="24">Research figure</text></svg>';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.route("**/figure.svg", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: svg }),
  );
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
});
async function reset(page: Page, source: string, at = 2) {
  await page.evaluate(
    async ({ source, at }) => {
      await window.editorLab.reset(source);
      window.editorLab.images(true);
      window.editorLab.focus(0, at);
    },
    { source, at },
  );
}
async function shared(page: Page, source: string, at?: number) {
  await expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([source, source]);
  if (at !== undefined) {
    await expect
      .poll(() => page.evaluate(() => window.editorLab.snapshot()[0].selection))
      .toEqual({ anchor: at, head: at });
    await expect
      .poll(() => page.evaluate(() => window.editorLab.domSelection(0)))
      .toEqual({ anchor: at, head: at });
  }
}

for (const [markdown, selector] of [
  ["## Result", "h2"],
  ["> **Quoted result**", "blockquote"],
  ["> [!NOTE] Context\n> **Body**", ".axiom-callout"],
  ["- **List item**", "li"],
  ["![Figure](/figure.svg)", ".axiom-image"],
  ["[Paper](https://example.org)", ".axiom-inline-link"],
  ["---", "hr"],
]) {
  test(`hover and context actions preserve the editing caret and rendered block: ${selector}`, async ({
    page,
  }) => {
    const source = "Caret\n\n" + markdown;
    await reset(page, source);
    const target = pane(page).locator(selector).first();
    const before = await page.evaluate(() => window.editorLab.snapshot());
    const html = await target.innerHTML();
    await target.hover();
    await target.click({ button: "right" });
    await expect(
      page.getByRole("menu", { name: "Block actions" }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.editorLab.snapshot())).toEqual(
      before,
    );
    await expect(target).not.toHaveClass(/axiom-source-prose/);
    await expect(pane(page).locator(".axiom-image-source-text")).toHaveCount(0);
    if (selector !== ".axiom-image")
      expect(await target.innerHTML()).toBe(html);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await target.hover();
    expect(await page.evaluate(() => window.editorLab.snapshot())).toEqual(
      before,
    );
    await shared(page, source, 2);
    await page.keyboard.type("X");
    await shared(page, "CaXret\n\n" + markdown, 3);
  });
}

test("context actions target the clicked block, rebase through peers, and reject stale blocks", async ({
  page,
}) => {
  await reset(page, "Caret\n\n## Result");
  await pane(page).locator("h2").click({ button: "right" });
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await page
    .getByRole("menuitem", {
      name: "Duplicate selection or block",
      exact: true,
    })
    .click();
  expect(
    (await page.evaluate(() => window.editorLab.snapshot()[0].source)).match(
      /## Result/g,
    ),
  ).toHaveLength(2);
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, "Peer\n\nCaret\n\n## Result");
  await reset(page, "Caret\n\n## Result");
  await pane(page).locator("h2").click({ button: "right" });
  await page.evaluate(() => window.editorLab.remote(1, 10, 16, "Changed"));
  await page
    .getByRole("menuitem", {
      name: "Duplicate selection or block",
      exact: true,
    })
    .click();
  await shared(page, "Caret\n\n## Changed");
  await expect(page.locator("#message")).toContainText("changed");
});

test("macOS Control-click inspects a heading without revealing it", async ({
  page,
}) => {
  test.skip(
    !(await page.evaluate(() =>
      /Mac|iPhone|iPad|iPod/.test(navigator.platform),
    )),
    "Control-click is a context gesture on macOS only.",
  );
  const source = "Caret\n\n## Result";
  await reset(page, source);
  await pane(page)
    .locator("h2")
    .click({ modifiers: ["Control"] });
  await expect(page.getByRole("menu", { name: "Block actions" })).toBeVisible();
  await expect(pane(page).locator("h2")).not.toHaveClass(/axiom-source-prose/);
  await page.keyboard.press("Escape");
  await shared(page, source, 2);
});

test("consecutive quote exits and parent paste retain their depth after a peer edit", async ({
  page,
}) => {
  await reset(page, "> > > Child", 11);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await pane(page)
    .locator(".axiom-prose")
    .evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text/plain", "Parent\nNext");
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "clipboardData", { value: data });
      element.dispatchEvent(event);
    });
  const expected = "Peer\n\n> > > Child\n> >\n>\n> Parent\n> Next";
  await shared(page, expected, expected.length);
  await expect(
    pane(page).locator("blockquote blockquote").first(),
  ).not.toContainText("Parent");
});

for (const prefix of ["", "Before ", "> Before ", "- Before "]) {
  test(`image selection, deletion and undo retain source and loaded preview: ${prefix}`, async ({
    page,
  }) => {
    const source = "Caret\n\n" + prefix + "![Figure](/figure.svg) after";
    await reset(page, source);
    await expect(image(page)).toHaveAttribute("data-image-state", "ready");
    await image(page)
      .locator("img")
      .evaluate((img) => img.setAttribute("data-original", "true"));
    await image(page).click();
    await expect(pane(page).locator(".axiom-image-source-text")).toHaveText(
      "![Figure](/figure.svg)",
    );
    await expect(image(page)).toHaveClass(/axiom-image-edit-preview/);
    await expect(image(page).locator("img")).toHaveAttribute(
      "data-original",
      "true",
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await shared(page, source.replace("![Figure](/figure.svg)", ""));
    await page.keyboard.press("ControlOrMeta+z");
    await shared(page, source);
    await expect(image(page)).toHaveAttribute("data-image-state", "ready");
    await image(page).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowRight");
    const at = source.indexOf(") after") + 1;
    await shared(page, source, at);
    await page.keyboard.type("X");
    await shared(page, source.slice(0, at) + "X" + source.slice(at), at + 1);
  });
}

test("image details preserve the rendered image on cancel and update metadata without reloading", async ({
  page,
}) => {
  const source = "Caret\n\n![Figure](/figure.svg)";
  await reset(page, source);
  await expect(image(page)).toHaveAttribute("data-image-state", "ready");
  await image(page)
    .locator("img")
    .evaluate((img) => img.setAttribute("data-original", "true"));
  await image(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit image details" }).click();
  await page.getByLabel("Alternative text", { exact: true }).fill("Draft");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await shared(page, source, 2);
  await expect(image(page).locator("img")).toHaveAttribute(
    "data-original",
    "true",
  );
  await image(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit image details" }).click();
  await page
    .getByLabel("Alternative text", { exact: true })
    .fill("Updated figure");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(image(page).locator("img")).toHaveAttribute(
    "alt",
    "Updated figure",
  );
  await expect(image(page).locator("img")).toHaveAttribute(
    "data-original",
    "true",
  );
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, source);
});

test("failed images retain a rendered fallback and can retry without changing Markdown", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/retry.svg", (route) =>
    ++requests === 1
      ? route.fulfill({ status: 404, body: "missing" })
      : route.fulfill({ contentType: "image/svg+xml", body: svg }),
  );
  const source = "Caret\n\n![Missing figure](/retry.svg)";
  await reset(page, source);
  await expect(image(page)).toHaveAttribute("data-image-state", "error");
  await image(page).click();
  await expect(image(page)).toContainText("Image unavailable");
  await page.getByRole("button", { name: "Retry image loading" }).click();
  await expect(image(page)).toHaveAttribute("data-image-state", "ready");
  await shared(page, source);
});

test("unsafe and disabled images keep placeholders while allowing explicit source editing", async ({
  page,
}) => {
  await reset(page, "Caret\n\n![Unsafe](javascript:alert%281%29)");
  await expect(image(page)).toHaveAttribute("data-image-state", "blocked");
  await image(page).click();
  await expect(image(page).locator("img")).toHaveCount(0);
  await reset(page, "Caret\n\n![Figure](/figure.svg)");
  await page.evaluate(() => window.editorLab.images(false));
  await expect(image(page)).toHaveAttribute("data-image-state", "disabled");
  await image(page).click();
  await expect(image(page)).toContainText("Image preview disabled");
});

test("loading images ignore late results after changing the destination", async ({
  page,
}) => {
  let finish: (() => Promise<void>) | undefined;
  await page.route("**/slow.svg", (route) => {
    finish = () => route.fulfill({ contentType: "image/svg+xml", body: svg });
  });
  await reset(page, "Caret\n\n![Figure](/slow.svg)");
  await expect(image(page)).toHaveAttribute("data-image-state", "loading");
  await image(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit image details" }).click();
  await page.getByLabel("Destination", { exact: true }).fill("/figure.svg");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(image(page)).toHaveAttribute("data-image-state", "ready");
  await finish?.();
  await expect(image(page).locator("img")).toHaveAttribute(
    "src",
    "/figure.svg",
  );
  await expect(image(page)).toHaveAttribute("data-image-state", "ready");
});

test("read-only images remain selected without deletion or details changes", async ({
  page,
}) => {
  const source = "Caret\n\n![Figure](/figure.svg)";
  await reset(page, source);
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await image(page).click();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  await shared(page, source);
  await image(page).click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Edit image details" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(image(page)).toHaveAttribute("data-image-state", "ready");
});

test("an image selection and loaded element survive peer edits above before deletion and undo", async ({
  page,
}) => {
  const source = "Caret\n\n![Figure](/figure.svg) after";
  await reset(page, source);
  await expect(image(page)).toHaveAttribute("data-image-state", "ready");
  await image(page)
    .locator("img")
    .evaluate((img) => img.setAttribute("data-original", "true"));
  await image(page).click();
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await expect(image(page).locator("img")).toHaveAttribute(
    "data-original",
    "true",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Delete");
  await shared(page, "Peer\n\n" + source.replace("![Figure](/figure.svg)", ""));
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, "Peer\n\n" + source);
});

test("Source-to-Write preserves the image-source caret and pastes at that exact position", async ({
  page,
}) => {
  const source = "Caret\n\nBefore ![Figure](/figure.svg) after";
  await reset(page, source);
  await page.evaluate(async () => {
    await window.editorLab.mode(0, "source");
    window.editorLab.focus(0, 25);
    await window.editorLab.mode(0, "write");
  });
  await expect(image(page)).toHaveClass(/axiom-image-edit-preview/);
  await pane(page)
    .locator(".axiom-prose")
    .evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text/plain", "replacement");
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "clipboardData", { value: data });
      element.dispatchEvent(event);
    });
  await shared(page, source.slice(0, 25) + "replacement" + source.slice(25));
});

test("copying a context target preserves the original caret and text selection", async ({
  page,
}) => {
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as unknown as { copied: string }).copied = value;
        },
      },
    }),
  );
  await reset(page, "Caret\n\n## Result");
  await page.evaluate(() => window.editorLab.focus(0, 1, 4));
  await pane(page).locator("h2").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Copy block Markdown", exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe("## Result");
  expect(
    await page.evaluate(() => window.editorLab.snapshot()[0].selection),
  ).toEqual({ anchor: 1, head: 4 });
  await page.keyboard.type("X");
  await shared(page, "CXt\n\n## Result", 2);
});

test("table context menus inspect the clicked cell without activating another source unit", async ({
  page,
}) => {
  const source = "Caret\n\n| A | B |\n|---|---|\n| one | two |";
  await reset(page, source);
  await pane(page).locator("td").last().click({ button: "right" });
  await expect(
    page.getByRole("dialog", { name: "Table actions" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.editorLab.snapshot()[0].selection),
  ).toEqual({ anchor: 2, head: 2 });
  await page.keyboard.press("Escape");
  await shared(page, source, 2);
});

for (const [child, parent] of [
  ["> > ", "> "],
  ["> > > ", "> > "],
  ["- > > ", "  > "],
  ["> - > > ", ">   > "],
]) {
  for (const ending of ["\n", "\r\n"]) {
    test(`nested prose exits to its real parent before typing: ${child} ${JSON.stringify(ending)}`, async ({
      page,
    }) => {
      const before = "Before" + ending.repeat(2);
      const initial = before + child + "Child";
      await reset(page, initial, initial.length);
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      const exited = initial + ending + parent.trimEnd() + ending + parent;
      await shared(page, exited, exited.length);
      await page.keyboard.type("Parent");
      await shared(page, exited + "Parent", exited.length + 6);
      await expect(
        pane(page).locator("blockquote").filter({ hasText: "Child" }).last(),
      ).not.toContainText("Parent");
      await page.keyboard.press("ControlOrMeta+z");
      await shared(page, exited, exited.length);
      await page.keyboard.press("ControlOrMeta+z");
      const continued =
        initial +
        ending +
        child.replace(/(?:[-+*]|\d+[.)])[ \t]+/g, (m) => " ".repeat(m.length));
      await shared(page, continued, continued.length);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await shared(page, exited, exited.length);
    });
  }
}
