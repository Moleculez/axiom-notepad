import { test, expect } from "@playwright/test";
import { fixture, caret, replaceSource, origin } from "./native-editor-helpers";

test("native lists are semantic, nested, editable and preserve source across modes", async ({
  browser,
}) => {
  const body =
    "# Results\n\n- Alpha\n    - Beta\n        - Gamma\n- Delta\n\n3. Three\n4. Four\n\n- [ ] Reproduce\n\n> Evidence\n>\n> - Dataset\n\n";
  const f = await fixture(browser, body),
    editor = f.page.getByTestId("note-editor");
  await expect(editor.locator("ul ul ul li")).toHaveText("Gamma");
  await expect(editor.locator("ol")).toHaveAttribute("start", "3");
  await expect(editor.locator("blockquote ul li")).toHaveText("Dataset");
  const indents = await editor
    .locator("ul ul ul li")
    .evaluate((el) => [
      el.getBoundingClientRect().left,
      el.closest("ul")!.parentElement!.getBoundingClientRect().left,
    ]);
  expect(indents[0]).toBeGreaterThan(indents[1]);
  await f.page.getByRole("button", { name: "Source", exact: true }).click();
  await f.page.getByRole("button", { name: "Write", exact: true }).click();
  expect(await f.source()).toBe(body);
  await caret(editor.locator("p").filter({ hasText: /^Delta$/ }));
  await f.page.keyboard.press("Enter");
  await f.page.keyboard.insertText("Epsilon");
  await expect.poll(f.source).toContain("- Delta\n- Epsilon");
  await expect(
    editor.locator("li").filter({ hasText: /^Epsilon$/ }),
  ).toBeVisible();
  await editor.getByRole("checkbox", { name: "Complete task" }).check();
  await expect.poll(f.source).toContain("- [x] Reproduce");
  await f.close();
});

test("character-by-character Write input synchronizes to a source peer and retains its caret after remote edits", async ({
  browser,
}) => {
  const body = "# Shared research\n\nAlpha\n\nFollowing text\n";
  const f = await fixture(browser, body),
    peer = await f.owner.newPage();
  await peer.goto("/workbench/notes/" + f.note.id);
  await expect(peer.locator(".ws-document-status")).toContainText(
    "Saved on server",
  );
  await peer.getByRole("button", { name: "Source", exact: true }).click();
  const peerEditor = peer.getByTestId("note-editor");
  const editor = f.page.getByTestId("note-editor");
  await caret(editor.locator("p").filter({ hasText: /^Alpha$/ }));
  let typed = "";
  for (const char of " **bold** &amp; tail") {
    await f.page.keyboard.type(char);
    typed += char;
    const expected = body.replace("Alpha", "Alpha" + typed);
    await expect.poll(f.source).toBe(expected);
    await expect.poll(() => peerEditor.textContent()).toBe(expected);
  }
  await caret(peerEditor.locator(".native-source-block"), 0);
  await peer.keyboard.type("Remote\n\n");
  // Source Enter is literal; keep the peer operation disjoint from the active paragraph.
  const expected = "Remote\n\n" + body.replace("Alpha", "Alpha" + typed);
  await expect.poll(f.source).toBe(expected);
  await f.page.keyboard.type("!");
  await expect.poll(f.source).toBe(expected.replace(typed, typed + "!"));
  await expect
    .poll(() => peerEditor.textContent())
    .toBe(expected.replace(typed, typed + "!"));
  await f.page.keyboard.press("ControlOrMeta+z");
  await expect.poll(f.source).toContain("Remote\n\n# Shared research");
  await expect.poll(f.source).not.toContain("!");
  await peer.close();
  await f.close();
});
test("native table cells edit in place, context actions are undoable and Tab adds a row", async ({
  browser,
}) => {
  const body = "| Method | Score |\n| --- | ---: |\n| Baseline | 0.91 |\n\n";
  const f = await fixture(browser, body),
    editor = f.page.getByTestId("note-editor");
  await expect(editor.locator("table")).toBeVisible();
  const widths = await editor
    .locator("table")
    .evaluate((table) => [
      table.getBoundingClientRect().width,
      table.querySelector("thead")!.getBoundingClientRect().width,
    ]);
  expect(Math.abs(widths[0] - widths[1])).toBeLessThan(2);
  await expect(editor.locator(".native-block-tools")).toHaveCount(0);
  await caret(editor.getByRole("cell", { name: "Row 2, column 1" }));
  await f.page.keyboard.insertText(" improved");
  await expect.poll(f.source).toContain("Baseline improved");
  await editor
    .getByRole("cell", { name: "Row 2, column 1" })
    .click({ button: "right" });
  await f.page.getByRole("menuitem", { name: "Insert column right" }).click();
  await expect(editor.locator("thead th")).toHaveCount(3);
  await editor.press("ControlOrMeta+z");
  await expect(editor.locator("thead th")).toHaveCount(2);
  await caret(editor.getByRole("cell", { name: "Row 2, column 2" }));
  await f.page.keyboard.press("Tab");
  await expect(editor.locator("tbody tr")).toHaveCount(2);
  await f.page.keyboard.insertText("New method");
  await expect.poll(f.source).toContain("New method");
  await f.close();
});
test("native code and math preserve fences, quiet controls and scoped selection", async ({
  browser,
}) => {
  const body = "```python\nx = 1\n```\n\n$$\nE=mc^2\n$$\n\nTail\n";
  const f = await fixture(browser, body),
    editor = f.page.getByTestId("note-editor");
  await expect(editor.locator(".native-code-body")).toHaveText("x = 1");
  await expect(editor.locator(".native-code-body .hljs-number")).toHaveText(
    "1",
  );
  await editor.locator(".native-code-body").click();
  await editor.press("ControlOrMeta+a");
  await f.page.keyboard.insertText("y = 2");
  await expect.poll(f.source).toBe(body.replace("x = 1", "y = 2"));
  await editor.getByRole("button", { name: "Edit display equation" }).click();
  await expect(editor.getByLabel("Equation TeX source")).toBeVisible();
  await editor.press("ControlOrMeta+a");
  await f.page.keyboard.insertText("a^2+b^2=c^2");
  await expect.poll(f.source).toContain("$$\na^2+b^2=c^2\n$$");
  await expect(editor.locator(".native-math-preview svg")).toBeVisible();
  await editor.press("ControlOrMeta+Enter");
  await expect(editor.getByLabel("Equation TeX source")).toHaveCount(0);
  await f.page.screenshot({
    path: "test-results/native-workbench-editor.png",
    fullPage: true,
  });
  await f.close();
});
test("native slash creation and Unicode deletion have exact-source undo", async ({
  browser,
}) => {
  const f = await fixture(browser, "\n"),
    editor = f.page.getByTestId("note-editor");
  await editor.click();
  await f.page.keyboard.insertText("/math");
  await f.page.getByRole("option", { name: "Display equation" }).click();
  await expect.poll(f.source).toContain("$$\n\n$$");
  await editor.press("ControlOrMeta+z");
  await expect.poll(f.source).toContain("/math");
  await editor.press("Escape");
  await replaceSource(f.page, "A👩🏽‍🔬");
  await editor.press("Backspace");
  await expect.poll(f.source).toBe("A");
  await editor.press("ControlOrMeta+z");
  await expect.poll(f.source).toBe("A👩🏽‍🔬");
  await f.close();
});
test("Workbench footer stays visible at both ends of a long document", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    "# Long research note\n\n" +
      "A paragraph about reproducibility.\n\n".repeat(150),
  );
  const scroll = f.page.locator(".ws-document-scroll"),
    footer = f.page.locator(".ws-note-footer");
  const before = await footer.boundingBox();
  expect(before).not.toBeNull();
  await scroll.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const after = await footer.boundingBox();
  expect(Math.abs(before!.y - after!.y)).toBeLessThan(1);
  await expect(footer).toBeInViewport();
  await f.page.setViewportSize({ width: 390, height: 844 });
  await expect(f.page.locator(".ws-document-context")).toHaveCount(0);
  await expect(footer).toBeInViewport();
  await f.close();
});

test("Workbench collaborators publish cursors from table, code and math surfaces", async ({
  browser,
}) => {
  const f = await fixture(
      browser,
      "# Collaboration\n\n| A | B |\n| --- | --- |\n| Alpha | Beta |\n\n```python\nx = 1\n```\n\n$$\nE=mc^2\n$$\n\n",
    ),
    other = await f.owner.newPage();
  await other.goto("/workbench/notes/" + f.note.id);
  await expect(other.getByTestId("note-editor")).toBeVisible();
  await expect(
    other.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  const a = f.page.getByTestId("note-editor"),
    b = other.getByTestId("note-editor");
  await caret(a.getByRole("cell", { name: "Row 2, column 1" }));
  await f.page.keyboard.insertText(" local");
  await caret(b.getByRole("cell", { name: "Row 2, column 2" }));
  await other.keyboard.insertText(" remote");
  await expect(a.getByRole("cell", { name: "Row 2, column 2" })).toContainText(
    "remote",
  );
  await expect(b.getByRole("cell", { name: "Row 2, column 1" })).toContainText(
    "local",
  );
  await expect(f.page.locator(".native-peer-caret")).toHaveCount(1);
  const cell = await a
      .getByRole("cell", { name: "Row 2, column 2" })
      .boundingBox(),
    cursor = await f.page.locator(".native-peer-caret").boundingBox();
  expect(cursor!.y).toBeGreaterThanOrEqual(cell!.y);
  expect(cursor!.y).toBeLessThan(cell!.y + cell!.height);
  await b.locator(".native-code-body").click();
  await expect
    .poll(async () => {
      const code = await a.locator(".native-code-body").boundingBox(),
        caret = await f.page.locator(".native-peer-caret").boundingBox();
      return (
        !!code && !!caret && caret.y >= code.y && caret.y < code.y + code.height
      );
    })
    .toBe(true);
  await b.getByRole("button", { name: "Edit display equation" }).click();
  await expect(f.page.locator(".native-peer-block")).toBeVisible();
  await expect(a.locator(".native-math-source")).toHaveCount(0);
  await f.page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(
    f.page.getByRole("dialog", { name: "Sharing & collaboration" }),
  ).toBeVisible();
  await expect(
    f.page.getByRole("list", { name: "People with access" }),
  ).toContainText("editor");
  await f.page.keyboard.press("Escape");
  await other.close();
  await f.close();
});

test("native source and Write modes converge after offline concurrent edits and local undo", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Reproducibility\n\nAlpha\n\nBeta\n"),
    other = await f.owner.newPage();
  await other.goto("/workbench/notes/" + f.note.id);
  await expect(
    other.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  const a = f.page.getByTestId("note-editor"),
    b = other.getByTestId("note-editor");
  await f.member.setOffline(true);
  await expect(f.page.getByText(/Saved locally · offline/)).toBeVisible();
  await caret(a.locator("p").filter({ hasText: /^Alpha$/ }));
  await f.page.keyboard.insertText(" offline");
  await other.getByRole("button", { name: "Source", exact: true }).click();
  await b.click();
  await b.press("ControlOrMeta+End");
  await other.keyboard.insertText("Remote evidence");
  await f.member.setOffline(false);
  await expect(
    f.page.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  await expect.poll(f.source).toContain("Alpha offline");
  await expect.poll(f.source).toContain("Remote evidence");
  await a.press("ControlOrMeta+z");
  await expect.poll(f.source).not.toContain("offline");
  await expect.poll(f.source).toContain("Remote evidence");
  await other.close();
  await f.close();
});

test("another device for the same account remains visible", async ({
  browser,
}) => {
  const f = await fixture(browser, "Shared session test\n"),
    device = await browser.newContext({
      baseURL: origin,
      storageState: await f.member.storageState(),
      serviceWorkers: "block",
    });
  const page = await device.newPage();
  await page.goto("/workbench/notes/" + f.note.id);
  await expect(
    page.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  await page.getByTestId("note-editor").click();
  await expect(
    f.page.getByRole("button", { name: /Jump to .*your other session/ }),
  ).toBeVisible();
  await expect(f.page.locator(".native-peer-caret")).toBeVisible();
  await device.close();
  await f.close();
});

test("composition commits only its cell text and retains a draft if that row disappears", async ({
  browser,
}) => {
  const f = await fixture(
      browser,
      "| A | B |\n| --- | --- |\n| composing | keep |\n| next | row |\n",
    ),
    editor = f.page.getByTestId("note-editor");
  const cell = editor.getByRole("cell", { name: "Row 2, column 1" });
  await caret(cell);
  await cell.evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    el.querySelector(".native-text")!.textContent = "量子研究";
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "量子研究",
        isComposing: true,
      }),
    );
    el.dispatchEvent(
      new CompositionEvent("compositionend", {
        bubbles: true,
        data: "量子研究",
      }),
    );
  });
  await expect.poll(f.source).toContain("| 量子研究 | keep |");
  await caret(cell);
  await cell.evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    el.querySelector(".native-text")!.textContent = "未提交草稿";
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "未提交草稿",
        isComposing: true,
      }),
    );
  });
  const other = await f.owner.newPage();
  await other.goto("/workbench/notes/" + f.note.id);
  await expect(
    other.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  await other
    .getByRole("cell", { name: "Row 2, column 1" })
    .click({ button: "right" });
  await other.getByRole("menuitem", { name: "Delete table row" }).click();
  await expect.poll(f.source).not.toContain("量子研究");
  await cell.evaluate((el) =>
    el.dispatchEvent(
      new CompositionEvent("compositionend", {
        bubbles: true,
        data: "未提交草稿",
      }),
    ),
  );
  await expect(
    f.page.getByRole("button", { name: "Download recovered text" }),
  ).toBeVisible();
  expect(
    await f.page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([key]) => key.startsWith("axiom:editor-recovery:"))
        .map(([, value]) => value)
        .join("\n"),
    ),
  ).toContain("未提交草稿");
  expect(await f.source()).toContain("| next | row |");
  expect(await f.source()).not.toContain("未提交草稿");
  await other.close();
  await f.close();
});

test("typed fences, code-line operations, rich paste and keyboard resizing preserve structure", async ({
  browser,
}) => {
  const f = await fixture(browser, "\n"),
    editor = f.page.getByTestId("note-editor");
  await editor.click();
  await f.page.keyboard.type("```python");
  await editor.press("Enter");
  await f.page.keyboard.type("x = 1");
  await editor.press("Enter");
  await f.page.keyboard.type("y = 2");
  await expect.poll(f.source).toContain("```python\nx = 1\ny = 2\n```");
  await editor.press("Alt+ArrowUp");
  await expect.poll(f.source).toContain("```python\ny = 2\nx = 1\n```");
  await editor.press("ControlOrMeta+Enter");
  await f.page.keyboard.insertText("| Method | Result |");
  await editor.press("Enter");
  await expect(editor.locator("table")).toBeVisible();
  await caret(editor.getByRole("cell", { name: "Row 2, column 1" }));
  await editor.evaluate((el) => {
    const data = new DataTransfer();
    data.setData(
      "text/html",
      "<table><tr><td><strong>Rich</strong></td><td>safe<script>bad()</script></td></tr><tr><td>x</td><td>y</td></tr></table>",
    );
    data.setData("text/plain", "Rich\tsafe\nx\ty");
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    if (event.clipboardData !== data)
      Object.defineProperty(event, "clipboardData", { value: data });
    el.dispatchEvent(event);
  });
  await expect.poll(f.source).toContain("**Rich**");
  expect(await f.source()).not.toContain("bad()");
  const before = await f.source(),
    resize = editor.getByRole("separator", { name: "Resize column 1" });
  const initialWidth = await resize.evaluate(
    (el) => el.closest("th")!.getBoundingClientRect().width,
  );
  await resize.focus();
  await resize.press("ArrowRight");
  expect(Number(await resize.getAttribute("aria-valuenow"))).toBeGreaterThan(
    initialWidth,
  );
  expect(await f.source()).toBe(before);
  await f.close();
});

test("TeX snippet fields and missing Markdown table cells remain source mapped", async ({
  browser,
}) => {
  const f = await fixture(
      browser,
      "$$\nx\n$$\n\n| A | B | C |\n| --- | --- | --- |\n| short |\n",
    ),
    editor = f.page.getByTestId("note-editor");
  await editor.getByRole("button", { name: "Edit display equation" }).click();
  await editor.press("ControlOrMeta+a");
  await f.page.keyboard.insertText("\\frac");
  await f.page.getByRole("option", { name: "\\frac", exact: true }).click();
  expect(await f.page.evaluate(() => getSelection()?.toString())).toBe(
    "numerator",
  );
  await f.page.keyboard.insertText("x");
  await f.page.keyboard.press("Tab");
  expect(await f.page.evaluate(() => getSelection()?.toString())).toBe(
    "denominator",
  );
  await f.page.keyboard.insertText("y");
  await f.page.keyboard.press("Tab");
  await f.page.keyboard.insertText("+1");
  await expect.poll(f.source).toContain("\\frac{x}{y}+1");
  await editor.getByRole("cell", { name: "Row 2, column 3" }).click();
  await f.page.keyboard.insertText("materialized");
  await expect.poll(f.source).toContain("| short |  | materialized |");
  await editor.press("ControlOrMeta+z");
  await expect.poll(f.source).toContain("| short |\n");
  await f.close();
});

test("uncommitted callout titles survive a competing header change", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    "> [!THEOREM] Stability\n> A result.\n\nEnd\n",
  );
  const other = await f.owner.newPage();
  await other.goto("/workbench/notes/" + f.note.id);
  await expect(
    other.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  await f.page.locator(".native-callout-header").hover();
  await f.page.getByLabel("Callout title").fill("Uncommitted local title");
  await other.locator(".native-callout-header").hover();
  await other.getByLabel("Callout type").selectOption("lemma");
  await expect(
    f.page.getByRole("button", { name: "Download recovered text" }),
  ).toBeVisible();
  expect(
    await f.page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([key]) => key.startsWith("axiom:editor-recovery:"))
        .map(([, value]) => value)
        .join("\n"),
    ),
  ).toContain("> [!THEOREM] Uncommitted local title");
  await expect.poll(f.source).toContain("> [!LEMMA] Stability");
  expect(await f.source()).not.toContain("Uncommitted");
  await other.close();
  await f.close();
});

test("empty formatting, selected-cell Delete and print preparation preserve the document", async ({
  browser,
}) => {
  const f = await fixture(
      browser,
      "| A | B |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |\n\nTail\n\n",
    ),
    editor = f.page.getByTestId("note-editor");
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await editor.press("ControlOrMeta+b");
  await f.page.keyboard.insertText("Bold result");
  await expect.poll(f.source).toContain("**Bold result**");
  await caret(editor.getByRole("cell", { name: "Row 2, column 1" }), 0);
  await f.page.keyboard.press("Alt+Shift+ArrowRight");
  await f.page.keyboard.press("Alt+Shift+ArrowDown");
  await expect(editor.locator('[aria-selected="true"]')).toHaveCount(4);
  await f.page.keyboard.press("Backspace");
  await expect.poll(f.source).not.toContain("alpha");
  expect(await f.source()).toContain("|  |  |");
  await editor.press("ControlOrMeta+z");
  await expect.poll(f.source).toContain("| alpha | beta |");
  const before = await f.source();
  await f.page.evaluate(() =>
    window.dispatchEvent(new Event("axiom:prepare-print")),
  );
  await expect(f.page.locator(".read-mount.print-only")).toContainText(
    "Bold result",
  );
  expect(await f.source()).toBe(before);
  await f.page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await f.close();
});

test("Chromium browser-owned IME commits Unicode into the native table surface", async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Chrome protocol IME injection; DOM composition recovery is tested on all engines.",
  );
  const f = await fixture(
      browser,
      "| A | B |\n| --- | --- |\n| research | keep |\n",
    ),
    editor = f.page.getByTestId("note-editor");
  await caret(editor.getByRole("cell", { name: "Row 2, column 1" }));
  const cdp = await f.member.newCDPSession(f.page);
  await cdp.send("Input.imeSetComposition", {
    text: "量子",
    selectionStart: 2,
    selectionEnd: 2,
  });
  expect(await f.source()).not.toContain("量子");
  await cdp.send("Input.insertText", { text: "量子研究" });
  await expect.poll(f.source).toContain("| research量子研究 | keep |");
  await editor.press("ControlOrMeta+z");
  await expect.poll(f.source).toContain("| research | keep |");
  await cdp.detach();
  await f.close();
});

test("nested code and equations keep container prefixes out of editable content", async ({
  browser,
}) => {
  const f = await fixture(
      browser,
      "> ```python\n> if x:\n>     y = 1\n> ```\n\n> $$\n> x+y\n> $$\n\n",
    ),
    editor = f.page.getByTestId("note-editor");
  await expect(editor.locator(".native-code-body")).toHaveText(
    "if x:\n    y = 1",
  );
  await caret(editor.locator(".native-code-line").first(), "if x:".length);
  await f.page.keyboard.press("Enter");
  await f.page.keyboard.insertText("z = 2");
  await expect.poll(f.source).toContain("> if x:\n>     z = 2\n>     y = 1");
  await editor.getByRole("button", { name: "Edit display equation" }).click();
  await expect(editor.locator(".native-math-source")).toHaveText("x+y");
  await caret(editor.locator(".native-math-source"));
  await f.page.keyboard.press("Enter");
  await f.page.keyboard.insertText("+z");
  await expect.poll(f.source).toContain("> x+y\n> +z\n> $$");
  await editor.press("ControlOrMeta+a");
  await f.page.keyboard.insertText("a+b\nc+d");
  await expect.poll(f.source).toContain("> $$\n> a+b\n> c+d\n> $$");
  await f.close();
});

test("blocked worker construction leaves source editing and durable synchronization available", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Worker permissions\n\n");
  await f.page.addInitScript(() => {
    window.Worker = new Proxy(window.Worker, {
      construct() {
        throw new DOMException(
          "Worker blocked for verification",
          "SecurityError",
        );
      },
    });
  });
  await f.page.reload();
  await expect(
    f.page.getByText("Markdown preview stopped.", { exact: false }),
  ).toBeVisible();
  await expect(
    f.page.getByText("Statistics unavailable", { exact: true }),
  ).toBeVisible();
  const editor = f.page.getByTestId("note-editor");
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await f.page.keyboard.insertText("Durable without a worker.");
  await expect.poll(f.source).toContain("Durable without a worker.");
  await f.close();
});
