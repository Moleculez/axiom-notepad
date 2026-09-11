import { test, expect, type Page } from "@playwright/test";

const pane = (page: Page) => page.locator('[data-pane="0"]');
const image = (page: Page) => pane(page).locator(".axiom-image").first();
const sourceText = (page: Page) =>
  pane(page).locator(".axiom-image-source-text");
const original = "Caret\n\n![Figure](/figure.svg) after\n\nFollowing";
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.route("**/figure.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#6c8b99"/></svg>',
    }),
  );
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
});
async function reset(page: Page, source = original) {
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
    window.editorLab.images(true);
    window.editorLab.focus(0, 2);
  }, source);
  await expect(image(page)).toHaveAttribute("data-image-state", "ready");
}
async function shared(page: Page, source: string) {
  await expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([source, source]);
}
async function select(page: Page, from: number, to = from) {
  await page.evaluate(({ from, to }) => window.editorLab.focus(0, from, to), {
    from,
    to,
  });
}

test("left-click reveals ordinary prose above the retained preview and edits synchronize immediately", async ({
  page,
}) => {
  await reset(page);
  await image(page)
    .locator("img")
    .evaluate((img) => img.setAttribute("data-original", "true"));
  await image(page).click();
  await expect(sourceText(page)).toHaveText("![Figure](/figure.svg)");
  await expect(
    page.getByRole("dialog", { name: "Image source", exact: true }),
  ).toHaveCount(0);
  await expect(pane(page).locator(".axiom-prose")).toBeFocused();
  await expect(image(page).locator("img")).toHaveAttribute(
    "data-original",
    "true",
  );
  const textBox = await sourceText(page).boundingBox();
  const previewBox = await image(page).boundingBox();
  expect(previewBox!.y).toBeGreaterThanOrEqual(textBox!.y + textBox!.height);
  await select(page, original.indexOf("Figure"));
  await page.keyboard.insertText("New ");
  await shared(page, original.replace("Figure", "New Figure"));
  await expect(image(page).locator("img")).toHaveAttribute("alt", "New Figure");
  await expect(image(page).locator("img")).toHaveAttribute(
    "data-original",
    "true",
  );
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, original);
});

test("incomplete source stays live while its last valid preview survives until leaving", async ({
  page,
}) => {
  await reset(page);
  await image(page).click();
  await select(page, 7, 29);
  await page.keyboard.insertText("![unfinished");
  await shared(
    page,
    original.replace("![Figure](/figure.svg)", "![unfinished"),
  );
  await expect(image(page).locator("img")).toBeVisible();
  await expect(image(page)).toContainText("Last valid preview");
  await select(page, 2);
  await expect(image(page)).toHaveCount(0);
  await expect(pane(page).locator(".axiom-prose")).toContainText(
    "![unfinished",
  );
});

test("Escape collapses valid source without reverting edits and arrow exit does not insert text", async ({
  page,
}) => {
  await reset(page);
  await image(page).click();
  await select(page, original.indexOf("Figure"));
  await page.keyboard.insertText("New ");
  await page.keyboard.press("Escape");
  await expect(sourceText(page)).toHaveCount(0);
  await expect(image(page)).toHaveClass(/is-selected/);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("X");
  await shared(
    page,
    original.replace("Figure", "New Figure").replace(") after", ")X after"),
  );
});

test("Enter uses prose continuation instead of applying or closing a draft", async ({
  page,
}) => {
  const source = "Caret\n\n![Figure](/figure.svg)\n\nFollowing";
  await reset(page, source);
  await image(page).click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Next paragraph");
  const value = await page.evaluate(
    () => window.editorLab.snapshot()[0].source,
  );
  expect(value).toContain("![Figure](/figure.svg)\n");
  expect(value).toContain("Next paragraph");
  await shared(page, value);
  await expect(image(page)).toBeVisible();
});

test("deleting all image source removes only the image and undo restores it", async ({
  page,
}) => {
  await reset(page);
  await image(page).click();
  await select(page, 7, 29);
  await page.keyboard.press("Backspace");
  await shared(page, original.replace("![Figure](/figure.svg)", ""));
  await expect(image(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, original);
  await expect(image(page)).toBeVisible();
});

test("source activation and edits survive disjoint peer updates", async ({
  page,
}) => {
  await reset(page);
  await image(page).click();
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
  await expect(sourceText(page)).toHaveText("![Figure](/figure.svg)");
  await select(page, original.indexOf("Figure") + 6);
  await page.keyboard.insertText("New ");
  await shared(page, "Peer\n\n" + original.replace("Figure", "New Figure"));
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, "Peer\n\n" + original);
});

for (const prefix of ["> ", "> > ", "- ", "- > ", "[^id]:\n    "]) {
  test(`image prose remains inside its container: ${JSON.stringify(prefix)}`, async ({
    page,
  }) => {
    const source =
      "Caret\n\n" + prefix + "![Figure](/figure.svg) after\n\nFollowing";
    await reset(page, source);
    await image(page).click();
    await expect(sourceText(page)).toHaveText("![Figure](/figure.svg)");
    await select(page, source.indexOf("Figure"));
    await page.keyboard.insertText("New ");
    await shared(page, source.replace("Figure", "New Figure"));
    await expect(image(page).locator("img")).toHaveAttribute(
      "alt",
      "New Figure",
    );
    await page.keyboard.press("Escape");
    await expect(sourceText(page)).toHaveCount(0);
    await expect(image(page)).toBeVisible();
  });
}

test("multiline quoted source preserves CRLF and maps each visible line", async ({
  page,
}) => {
  const source =
    'Caret\r\n\r\n> ![multi\r\n> line](/figure.svg "Title") after\r\n\r\nFollowing';
  await reset(page, source);
  await image(page).click();
  expect((await sourceText(page).allTextContents()).join("")).toContain(
    "line](/figure.svg",
  );
  await select(page, source.indexOf("line]"));
  await page.keyboard.insertText("New ");
  await shared(page, source.replace("line]", "New line]"));
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, source);
});

test("table images edit in the same cell and keep table navigation", async ({
  page,
}) => {
  const source =
    "Caret\n\n| A | B |\n| --- | --- |\n| ![Figure](/figure.svg) | Other |\n\nFollowing";
  await reset(page, source);
  await image(page).click();
  await expect(sourceText(page)).toHaveText("![Figure](/figure.svg)");
  await expect(image(page).locator("xpath=ancestor::td")).toHaveCount(1);
  await select(page, source.indexOf("Figure"));
  await page.keyboard.insertText("New ");
  await shared(page, source.replace("Figure", "New Figure"));
  await page.keyboard.press("Tab");
  await expect(sourceText(page)).toHaveCount(0);
  await page.keyboard.type("X");
  await shared(
    page,
    source.replace("Figure", "New Figure").replace("Other", "XOther"),
  );
});

test("keyboard-selected images open with Enter or Space without changing the document", async ({
  page,
}) => {
  for (const key of ["Enter", "Space"]) {
    await reset(page);
    await select(page, 7, 29);
    await page.keyboard.press(key);
    await expect(sourceText(page)).toHaveText("![Figure](/figure.svg)");
    await shared(page, original);
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowLeft");
    await shared(page, original);
    expect(
      (await page.evaluate(() => window.editorLab.snapshot()))[0].selection,
    ).toEqual({ anchor: 7, head: 7 });
  }
});

test("reclicking the active preview preserves the source caret and typing location", async ({
  page,
}) => {
  await reset(page);
  await image(page).click();
  await select(page, original.indexOf("Figure") + 2);
  await image(page).click();
  await page.keyboard.type("X");
  await shared(page, original.replace("Figure", "FiXgure"));
});

for (const replacement of [
  "![Peer](/figure.svg)",
  "![Figure](/figure.svg)",
  "",
]) {
  test(`peer replacement never retains the old image editor: ${replacement}`, async ({
    page,
  }) => {
    await reset(page);
    await image(page).click();
    await select(page, original.indexOf("Figure") + 2);
    await page.evaluate(
      (insert) => window.editorLab.remote(1, 7, 29, insert),
      replacement,
    );
    await expect(sourceText(page)).toHaveCount(0);
    await shared(page, original.replace("![Figure](/figure.svg)", replacement));
  });
}

test("permission revocation closes editing without losing already-shared changes", async ({
  page,
}) => {
  await reset(page);
  await image(page).click();
  await select(page, original.indexOf("Figure"));
  await page.keyboard.insertText("New ");
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await expect(sourceText(page)).toHaveCount(0);
  await shared(page, original.replace("Figure", "New Figure"));
  await image(page).click();
  await page.keyboard.press("Backspace");
  await shared(page, original.replace("Figure", "New Figure"));
  await reset(page);
});

test("context menus retain active image source and restore its caret", async ({
  page,
}) => {
  await reset(page);
  await image(page).click();
  await select(page, original.indexOf("Figure"));
  await image(page).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Block actions" })).toBeVisible();
  await expect(sourceText(page)).toHaveText("![Figure](/figure.svg)");
  await page.keyboard.press("Escape");
  await page.keyboard.type("X");
  await shared(page, original.replace("Figure", "XFigure"));
});

test("copying an active image paragraph includes source exactly once", async ({
  page,
}) => {
  await reset(page);
  await image(page).click();
  await select(page, 7, original.indexOf("\n\nFollowing"));
  const copied = await pane(page)
    .locator(".axiom-prose")
    .evaluate((element) => {
      const clipboardData = new DataTransfer();
      const event = new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
      element.dispatchEvent(event);
      return clipboardData.getData("text/plain");
    });
  expect(copied).toBe("![Figure](/figure.svg) after");
  await shared(page, original);
});

test("only the clicked image reveals Markdown in a multi-image paragraph", async ({
  page,
}) => {
  const source =
    "Caret\n\n![First](/figure.svg) and ![Second](/figure.svg)\n\nFollowing";
  await reset(page, source);
  await image(page).click();
  await expect(sourceText(page)).toHaveText("![First](/figure.svg)");
  await expect(pane(page).locator(".axiom-image")).toHaveCount(2);
  await pane(page)
    .locator(".axiom-image:not(.axiom-image-edit-preview)")
    .click();
  await expect(sourceText(page)).toHaveText("![Second](/figure.svg)");
  await shared(page, source);
});

test("replacement loading retains the previous image and its dimensions", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/replacement.svg", async (route) => {
    requests++;
    await gate;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="green"/></svg>',
    });
  });
  try {
    await reset(page);
    await image(page).click();
    const before = await image(page).locator("img").boundingBox();
    await image(page)
      .locator("img")
      .evaluate((img) => img.setAttribute("data-original", "true"));
    await select(page, 7, 29);
    await page.keyboard.insertText("![New](/replacement.svg)");
    await shared(
      page,
      original.replace("![Figure](/figure.svg)", "![New](/replacement.svg)"),
    );
    await expect.poll(() => requests).toBe(1);
    await expect(image(page)).toHaveAttribute("data-image-state", "loading");
    await expect(image(page).locator("img")).toHaveAttribute(
      "data-original",
      "true",
    );
    const pending = await image(page).locator("img").boundingBox();
    expect(pending!.width).toBe(before!.width);
    expect(pending!.height).toBe(before!.height);
    release();
    await expect(image(page)).toHaveAttribute("data-image-state", "ready");
    await expect(image(page).locator("img")).toHaveAttribute(
      "src",
      "/replacement.svg",
    );
  } finally {
    release();
  }
});

test("a late superseded load cannot replace the current image", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/slow.svg", async (route) => {
    requested = true;
    await gate;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"/>',
    });
  });
  try {
    await reset(page);
    await image(page).click();
    await select(page, 7, 29);
    await page.keyboard.insertText("![Slow](/slow.svg)");
    await expect.poll(() => requested).toBe(true);
    await select(page, 7, 7 + "![Slow](/slow.svg)".length);
    await page.keyboard.insertText("![Latest](/figure.svg)");
    await expect(image(page)).toHaveAttribute("data-image-state", "ready");
    const response = page.waitForResponse("**/slow.svg");
    release();
    await (await response).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(image(page).locator("img")).toHaveAttribute(
      "src",
      "/figure.svg",
    );
    await expect(image(page).locator("img")).toHaveAttribute("alt", "Latest");
  } finally {
    release();
  }
});

test("failed replacement is labeled as previous content and becomes unavailable on leaving", async ({
  page,
}) => {
  await page.route("**/missing.svg", (route) =>
    route.fulfill({ status: 404, body: "Unavailable" }),
  );
  await reset(page);
  await image(page).click();
  await select(page, 7, 29);
  await page.keyboard.insertText("![New](/missing.svg)");
  await expect(image(page)).toHaveAttribute("data-image-state", "error");
  await expect(image(page).locator("img")).toBeVisible();
  await expect(image(page)).toContainText("Last valid preview");
  await select(page, 2);
  await expect(image(page)).toHaveAttribute("data-image-state", "error");
  await expect(image(page).locator("img")).toHaveCount(0);
  await expect(
    image(page).getByRole("button", { name: "Retry image loading" }),
  ).toBeVisible();
});

test("unsafe addresses and disabled previews never retain an old image as current", async ({
  page,
}) => {
  await reset(page);
  await image(page).click();
  await page.evaluate(() => window.editorLab.images(false));
  await expect(sourceText(page)).toHaveText("![Figure](/figure.svg)");
  await expect(image(page)).toHaveAttribute("data-image-state", "disabled");
  await expect(image(page).locator("img")).toHaveCount(0);
  await page.evaluate(() => window.editorLab.images(true));
  await select(page, 7, 29);
  await page.keyboard.insertText("![Unsafe](javascript:alert(1))");
  await expect(image(page)).toHaveAttribute("data-image-state", "blocked");
  await expect(image(page).locator("img")).toHaveCount(0);
  await shared(
    page,
    original.replace(
      "![Figure](/figure.svg)",
      "![Unsafe](javascript:alert(1))",
    ),
  );
});

test("reference-style images retain authored references and editable alt text", async ({
  page,
}) => {
  const source = 'Caret\n\n![Figure][fig]\n\n[fig]: /figure.svg "A title"';
  await reset(page, source);
  await image(page).click();
  await expect(sourceText(page)).toHaveText("![Figure][fig]");
  await select(page, source.indexOf("Figure"));
  await page.keyboard.insertText("New ");
  await shared(page, source.replace("Figure", "New Figure"));
  await expect(image(page).locator("img")).toHaveAttribute("alt", "New Figure");
});

test("source-mode image caret survives returning to Write and no-op activation creates no edits", async ({
  page,
}) => {
  await reset(page);
  const before = await page.evaluate(() =>
    window.editorLab.snapshot().map(({ updates, undo }) => ({ updates, undo })),
  );
  await image(page).click();
  await select(page, 2);
  expect(
    await page.evaluate(() =>
      window.editorLab
        .snapshot()
        .map(({ updates, undo }) => ({ updates, undo })),
    ),
  ).toEqual(before);
  await page.evaluate(async () => {
    await window.editorLab.mode(0, "source");
    window.editorLab.focus(0, 11);
    await window.editorLab.mode(0, "write");
  });
  await expect(sourceText(page)).toHaveText("![Figure](/figure.svg)");
  await page.keyboard.type("X");
  await shared(page, original.replace("Figure", "FiXgure"));
});

test("image-source composition rebases through a peer insertion", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "CDP composition is separate from physical IME acceptance.",
  );
  const source = "Caret\r\n\r\n> ![Figure](/figure.svg) after";
  await reset(page, source);
  await image(page).click();
  await select(page, source.indexOf("Figure") + 2);
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
  await shared(page, "Peer\r\n\r\n" + source.replace("Figure", "Fi研究gure"));
  await expect(image(page).locator("img")).toHaveAttribute("alt", "Fi研究gure");
  await page.keyboard.press("ControlOrMeta+z");
  await shared(page, "Peer\r\n\r\n" + source);
  await cdp.detach();
});

for (const [kind, markdown, body] of [
  ["codeBlock", "```js\nconst value = 1;\n```", "const"],
  ["mathBlock", "$$\nx + y\n$$", "x + y"],
]) {
  test(`open ${kind} menus keep controls visible and restore the typing caret`, async ({
    page,
  }) => {
    const source = original + "\n\n" + markdown;
    await reset(page, source);
    await select(page, source.indexOf(body));
    const block = pane(page).locator(`.axiom-embedded[data-kind="${kind}"]`);
    const button = block.getByRole("button", {
      name: "Block actions",
      exact: true,
    });
    await button.click();
    await expect(
      page.getByRole("menu", { name: "Block actions" }),
    ).toBeVisible();
    await page.mouse.move(1300, 10);
    await expect(block).toHaveAttribute("data-panel-open", "true");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(block.locator(".axiom-block-controls")).toHaveCSS(
      "opacity",
      "1",
    );
    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.type("Z");
    await shared(page, source.replace(body, "Z" + body));
  });
}
