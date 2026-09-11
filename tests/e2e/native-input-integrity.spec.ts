import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import type {} from "./native-input-harness";

let bundle: string;
let css: string;
test.beforeAll(async () => {
  bundle = (
    await build({
      entryPoints: ["tests/e2e/native-input-harness.ts"],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
    })
  ).outputFiles[0].text;
  css = await readFile("apps/web/app/native-editor.css", "utf8");
});
test.beforeEach(async ({ page }) => {
  await page.setContent(
    '<main id="host" style="margin:40px auto;max-width:800px"></main>',
  );
  await page.addStyleTag({
    content: `:root { --text:#20232a;--paper:white;--muted:#6b7280;--accent:#4263eb;--line:#d8dce4;--font-code:monospace;--size-code:15px;--weight-code:400;--selection:#dce7ff } body {font:18px/1.65 system-ui} ${css}`,
  });
  await page.addScriptTag({ content: bundle });
});

async function mount(
  page: Page,
  source = "",
  at = source.length,
  autoPair = false,
  mode: "write" | "source" = "write",
) {
  await page.evaluate(
    ({ source, at, autoPair, mode }) =>
      window.nativeTest.mount(source, at, autoPair, mode),
    { source, at, autoPair, mode },
  );
  await state(page, source, at);
}
async function state(page: Page, source: string, head: number, anchor = head) {
  await expect
    .poll(() => page.evaluate(() => window.nativeTest.state()), {
      timeout: 2000,
    })
    .toEqual({ source, selection: { anchor, head }, dom: { anchor, head } });
}
async function typeExactly(
  page: Page,
  value: string,
  prefix = "",
  suffix = "",
) {
  let typed = "";
  for (const char of value) {
    await page.keyboard.type(char);
    typed += char;
    await state(page, prefix + typed + suffix, prefix.length + typed.length);
  }
}

test("literal prose input preserves every key and source caret through Markdown transitions", async ({
  page,
}) => {
  for (const text of [
    "> ab",
    "- ab",
    "1. ab",
    "# ab",
    "- [ ] alpha",
    "> - [x] task",
    "> > nested quote",
    "### Heading ###",
    "alpha beta gamma",
    " leading  spaces ",
    "**bold** tail",
    "*italic* tail",
    "~~strike~~ tail",
    "==mark== tail",
    "`code` tail",
    "$x$ tail",
    "[text](https://example.test) tail",
    "![alt](image.png) tail",
    "[[Related note]] tail",
    "[@einstein] tail",
    "[^1] tail",
    "x^2^ tail",
    "H~2~O tail",
    "a_b_c",
    "a & b",
    "&amp; &lt; &gt;",
    "\\> literal",
    "\\\\name",
    "𝛼 é 👩🏽‍🔬 tail",
    "[toc]",
    "***",
    "---",
  ]) {
    await mount(page);
    await typeExactly(page, text);
  }
});

test("source mode uses identity UTF-16 maps, including entity and escape interiors", async ({
  page,
}) => {
  for (const source of [
    "&amp;",
    "\\\\name",
    "a &lt; b",
    "𝛼 é",
    "# h\n\n> quote",
  ]) {
    for (let at = 0; at <= source.length; at++) {
      // A real caret never splits a surrogate pair; Yjs repairs invalid UTF-16.
      if (/^[\uDC00-\uDFFF]$/.test(source[at] ?? "")) continue;
      await mount(page, source, at, false, "source");
      await page.keyboard.type("X");
      await state(page, source.slice(0, at) + "X" + source.slice(at), at + 1);
    }
  }
});

test("opening code and math fences stay source and commit before following content", async ({
  page,
}) => {
  for (const prefix of ["", "> ", "- item\n\n  "]) {
    for (const header of ["```python", "~~~js", "$$"]) {
      const following = "\n\nFollowing text";
      await mount(page, prefix + following, prefix.length);
      await typeExactly(page, header, prefix, following);
      await expect(page.locator(".native-content")).toContainText(
        "Following text",
      );
      const container = prefix === "" ? "" : prefix === "> " ? "> " : "  ";
      const fence = header === "$$" ? "$$" : header.slice(0, 3);
      const start = prefix + header + "\n" + container;
      const end = "\n" + container + fence + "\n\n" + following;
      await page.keyboard.press("Enter");
      await state(page, start + end, start.length);
      await typeExactly(page, "x = 1", start, end);
      await expect(
        page.locator(
          header === "$$" ? ".native-math-source" : ".native-code-body",
        ),
      ).toBeVisible();
    }
  }
});

test("Enter continues and exits task, list and quote paragraphs", async ({
  page,
}) => {
  for (const [prefix, next] of [
    ["> ", "> "],
    ["- ", "- "],
    ["4. ", "5. "],
    ["- [x] ", "- [ ] "],
  ]) {
    await mount(page);
    await typeExactly(page, prefix + "alpha");
    await page.keyboard.press("Enter");
    await state(
      page,
      prefix + "alpha\n" + next,
      prefix.length + 6 + next.length,
    );
    await page.keyboard.press("Enter");
    await state(page, prefix + "alpha\n", prefix.length + 6);
  }
});

test("typed pipe header creates a grid with editable first body cell", async ({
  page,
}) => {
  await mount(page, "\n\nFollowing text", 0);
  await typeExactly(page, "| A | B |", "", "\n\nFollowing text");
  await page.keyboard.press("Enter");
  const start = "| A | B |\n| --- | --- |\n| ";
  const end = " |  |\n\n\n\nFollowing text";
  await state(page, start + end, start.length);
  await typeExactly(page, "cell &amp; `code` $x$ tail", start, end);
  await expect(page.locator("table")).toBeVisible();
});

test("missing table cells materialize without selecting their neighbour's padding", async ({
  page,
}) => {
  const source = "| A | B |\n| --- | --- |\n| short |\n";
  await mount(page, source, 2);
  await page.getByTestId("note-editor").evaluate((element) => element.blur());
  await page.locator("td").nth(1).click();
  await expect(page.locator('td[data-active-cell="true"]')).toHaveAttribute(
    "data-column",
    "1",
  );
  await state(page, source, 32);
  await page.locator('td[data-active-cell="true"]').fill("materialized");
  await state(page, "| A | B |\n| --- | --- |\n| short | materialized |\n", 46);
});

test("whole-note replacement is not escaped as a single cell when the note ends in a table", async ({
  page,
}) => {
  const source = "| A | B |\n| --- | --- |\n| x | y |";
  await mount(page, source, source.indexOf("x"));
  await page.keyboard.press("ControlOrMeta+a");
  const replacement = "# New note\n\n> **quoted**\n\n| C | D |";
  await page.keyboard.insertText(replacement);
  await state(page, replacement, replacement.length);
  await page.keyboard.type("!");
  await state(page, replacement + "!", replacement.length + 1);
});

test("composition replacement includes unchanged edges of a selected range", async ({
  page,
}) => {
  const source = "Before alpha tail after";
  await mount(page, source, 7);
  await page.evaluate(() => window.nativeTest.focus(17, 7));
  await page.keyboard.insertText("theta tail");
  await state(page, "Before theta tail after", 17);
  await page.keyboard.type("!");
  await state(page, "Before theta tail! after", 18);
});

test("automatic pairs consume only owned closers and preserve unowned text", async ({
  page,
}) => {
  await mount(page, ")", 0, true);
  await page.keyboard.type(")");
  await state(page, "))", 1);
  await mount(page, "", 0, true);
  for (const [key, source, at] of [
    ["(", "()", 1],
    ["x", "(x)", 2],
    [")", "(x)", 3],
    [" ", "(x) ", 4],
  ] as const) {
    await page.keyboard.type(key);
    await state(page, source, at);
  }
  await mount(page, "", 0, true);
  await page.keyboard.type("(");
  await page.keyboard.press("Backspace");
  await state(page, "", 0);
  await mount(page, "()", 1, true);
  await page.keyboard.press("Backspace");
  await state(page, ")", 0);
});

test("caret-local syntax retains surrounding formatting and exact range selection", async ({
  page,
}) => {
  const source =
    "# Heading\n\n**one** &amp; tail\n\n*two* tail\n\n> quote\n>\n> **second**";
  const at = source.indexOf("one") + 1;
  await mount(page, source, at);
  await expect(page.locator(".native-editing-paragraph")).toHaveCount(0);
  await expect(page.locator("strong").first()).toHaveText("**one**");
  await expect(
    page.locator(".native-content > p:not(.native-gap)").first(),
  ).toHaveText("**one** & tail");
  await expect(page.locator("h1")).toHaveText("Heading");
  await expect(page.locator("em")).toHaveText("two");
  await page.evaluate(({ from, to }) => window.nativeTest.focus(from, to), {
    from: 11,
    to: source.indexOf("\n\n*two"),
  });
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(
    "**one** & tail",
  );
  await page.evaluate((at) => window.nativeTest.focus(at), at);
  await page.keyboard.press("ArrowRight");
  await state(page, source, at + 1);
  await page.keyboard.press("Shift+ArrowRight");
  await state(page, source, at + 2, at + 1);
  await page.keyboard.type("X");
  await state(
    page,
    source.slice(0, at + 1) + "X" + source.slice(at + 2),
    at + 2,
  );
});

test("paired fences work with automatic pairs enabled, including nested list headers", async ({
  page,
}) => {
  for (const prefix of ["", "> ", "- ", "> - "]) {
    const suffix = "\n\nFollowing text";
    for (const fence of ["```", "$$"]) {
      await mount(page, prefix + suffix, prefix.length, true);
      const char = fence[0];
      await page.keyboard.type(char);
      await state(page, prefix + char + char + suffix, prefix.length + 1);
      await page.keyboard.type(char);
      await state(page, prefix + char + char + suffix, prefix.length + 2);
      if (fence === "```") {
        await page.keyboard.type(char);
        await state(page, prefix + fence + suffix, prefix.length + 3);
      }
      await page.keyboard.press("Enter");
      const container = prefix.replace(/- /, "  ");
      const start =
        prefix + fence + (fence === "```" ? "python" : "") + "\n" + container;
      const end = "\n" + container + fence + "\n\n" + suffix;
      await state(page, start + end, start.length);
      await typeExactly(page, "x = 1", start, end);
    }
  }
});

test("Backspace unwraps structural prefixes and nonempty fences in one undoable action", async ({
  page,
}) => {
  for (const initial of ["> ", "- ", "1. ", "# ", "- [ ] "]) {
    await mount(page, initial);
    await page.keyboard.press("Backspace");
    await state(page, "", 0);
  }
  for (const fence of ["```", "$$"]) {
    const source = fence + "\n\n" + fence + "\n\nFollowing text";
    await mount(page, source, fence.length + 1);
    await page.keyboard.press("Backspace");
    await state(page, "\nFollowing text", 0);
    await page.keyboard.press("ControlOrMeta+z");
    await state(page, source, fence.length + 1);
    await page.keyboard.type("x");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Backspace");
    await state(page, "x\n\nFollowing text", 0);
  }
});

test("existing fence headers can be edited without duplicating their body or closer", async ({
  page,
}) => {
  const source = "```py\nx = 1\n```\n\nFollowing text";
  await mount(page, source, 5);
  await typeExactly(page, "thon", "```py", "\nx = 1\n```\n\nFollowing text");
  await page.keyboard.press("Enter");
  await state(page, source.replace("py", "python"), 10);
  await expect(page.locator(".native-code-body")).toHaveText("x = 1");
});

test("metadata, callout titles, definitions, dividers and TOC remain editable", async ({
  page,
}) => {
  await mount(page);
  await typeExactly(page, "---");
  await page.keyboard.press("Enter");
  await state(page, "---\n\n---\n\n", 4);
  await typeExactly(page, "title: Research", "---\n", "\n---\n\n");
  await mount(page, "---\ntitle: Existing\n---\n\nFollowing text", 3);
  await page.keyboard.press("Enter");
  await state(page, "---\ntitle: Existing\n---\n\nFollowing text", 4);
  for (const value of [
    "> [!NOTE] Title",
    "[^ref]: Footnote",
    "[link]: https://example.test",
    "[toc]",
    "***",
  ]) {
    await mount(page, "\n\nFollowing text", 0);
    await typeExactly(page, value, "", "\n\nFollowing text");
    await page.keyboard.press("Enter");
    const inserted = value.startsWith("> ") ? "\n> " : "\n\n";
    await state(
      page,
      value + inserted + "\n\nFollowing text",
      value.length + inserted.length,
    );
    await typeExactly(page, "body", value + inserted, "\n\nFollowing text");
  }
});

test("remote insertions rebase the source caret and invalidate conflicting owned pairs", async ({
  page,
}) => {
  await mount(page, "**alpha** tail", 5, true);
  await page.evaluate(() => window.nativeTest.remote(0, 0, "Remote\n\n"));
  await state(page, "Remote\n\n**alpha** tail", 13);
  await page.keyboard.type("X");
  await state(page, "Remote\n\n**alpXha** tail", 14);
  await page.keyboard.press("ControlOrMeta+z");
  await state(page, "Remote\n\n**alpha** tail", 13);
  await mount(page, "", 0, true);
  await page.keyboard.type("(");
  await page.evaluate(() => window.nativeTest.remote(1, 1, "remote"));
  await state(page, "(remote)", 7);
  await page.keyboard.type(")");
  await state(page, "(remote))", 8);
});

test("inline typing at the top, middle and end preserves following paragraphs and cell escapes", async ({
  page,
}) => {
  for (const [prefix, suffix] of [
    ["", " trailing\n\nFollowing text"],
    ["Intro\n\n", "\n\nFollowing text"],
    ["- parent\n    - ", "\n- following"],
    ["> ", "\n> following"],
  ]) {
    await mount(page, prefix + suffix, prefix.length);
    await typeExactly(page, "**bold** &amp; `code` $x$ tail", prefix, suffix);
  }
  const source = "| A | B |\n| --- | --- |\n| x | y |";
  const from = source.indexOf("x") + 1;
  await mount(page, source, from);
  await typeExactly(page, "\\|pipe", source.slice(0, from), source.slice(from));
  await expect(page.locator("td")).toHaveCount(2);
});

test("mode switches preserve exact source and the active caret after real typing", async ({
  page,
}) => {
  await mount(page);
  await typeExactly(page, "> **alpha** &amp; tail");
  const source = "> **alpha** &amp; tail";
  await page.keyboard.press("ControlOrMeta+/");
  await state(page, source, source.length);
  await page.keyboard.press("ControlOrMeta+/");
  await state(page, source, source.length);
  await page.keyboard.press("Shift+Enter");
  await state(page, source + "  \n> ", source.length + 5);
  await typeExactly(page, "soft", source + "  \n> ");
});

test("a new fence before an existing code block owns its closer, not the following block", async ({
  page,
}) => {
  const following = "\n\n```js\nexisting\n```\n\nFollowing text";
  await mount(page, following, 0);
  await typeExactly(page, "```python", "", following);
  await expect(page.locator(".native-code-body")).toHaveText("existing");
  await page.keyboard.press("Enter");
  await state(page, "```python\n\n```\n\n" + following, 10);
  await typeExactly(page, "new", "```python\n", "\n```\n\n" + following);
  await expect(page.locator(".native-code-body")).toHaveText([
    "new",
    "existing",
  ]);
});

test("clicking a nested equation opens the TeX body, not a hidden quote prefix", async ({
  page,
}) => {
  const source = "Before\n\n> $$\n> x+y\n> $$\n\nAfter";
  await mount(page, source, 2);
  await page.getByRole("button", { name: "Edit display equation" }).click();
  const from = source.indexOf("x+y");
  await state(page, source, from);
  await expect(page.locator(".native-math-source")).toHaveText("x+y");
  await page.keyboard.type("z+");
  await state(page, source.replace("x+y", "z+x+y"), from + 2);
});

test("an equation preview replacement between pointer down and up cannot swallow its activation", async ({
  page,
}) => {
  const source = "Before\n\n> $$\n> x+y\n> $$\n\nAfter";
  await mount(page, source, 2);
  const preview = page.getByRole("button", { name: "Edit display equation" });
  await preview.evaluate((el) => {
    el.innerHTML =
      '<span style="display:block;min-height:40px">Pending equation</span>';
  });
  const box = (await preview.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // The bounded MathJax worker can finish between the two native events.
  // Firefox may suppress click when the original descendant was removed.
  await preview.evaluate((el) => {
    el.innerHTML =
      '<span style="display:block;min-height:40px">Rendered equation</span>';
  });
  await page.mouse.up();
  const from = source.indexOf("x+y");
  await state(page, source, from);
  await page.keyboard.type("z+");
  await state(page, source.replace("x+y", "z+x+y"), from + 2);
});

test("drag selection freezes paragraph rendering and reveals both endpoints on release", async ({
  page,
}) => {
  const source = "**alpha** tail\n\n*beta* tail";
  await mount(page, source, 2);
  const boxes = await page
    .locator(".native-content > p:not(.native-gap)")
    .evaluateAll((paragraphs) =>
      [0, 1].map((index) => {
        const text =
          paragraphs[index].querySelector(".native-text")!.firstChild!;
        const range = document.createRange();
        range.setStart(text, 2);
        range.collapse(true);
        const box = range.getBoundingClientRect();
        return { x: box.x, y: box.y + box.height / 2 };
      }),
    );
  await page.mouse.move(boxes[0].x, boxes[0].y);
  await page.mouse.down();
  await page.mouse.move(boxes[1].x, boxes[1].y, { steps: 5 });
  await expect(page.locator(".native-revealed")).toHaveCount(1);
  await page.mouse.up();
  const head = source.indexOf("beta") + 2;
  await state(page, source, head, 2);
  await expect(page.locator(".native-revealed")).toHaveCount(2);
  await page.keyboard.type("X");
  await state(page, source.slice(0, 2) + "X" + source.slice(head), 3);
});

test("IME in live prose preserves entities and a remotely rebased caret", async ({
  page,
}) => {
  const source = "**alpha** &amp; tail";
  await mount(page, source, 5);
  await page.getByTestId("note-editor").evaluate((root) => {
    root.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    const selection = document.getSelection()!,
      text = selection.focusNode as Text,
      offset = selection.focusOffset;
    text.insertData(offset, "研究");
    selection.collapse(text, offset + 2);
    root.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertCompositionText",
        data: "研究",
        isComposing: true,
      }),
    );
    window.nativeTest.remote(0, 0, "Remote\n\n");
    root.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "研究" }),
    );
  });
  await state(page, "Remote\n\n**alp研究ha** &amp; tail", 15);
  await page.keyboard.type("X");
  await state(page, "Remote\n\n**alp研究Xha** &amp; tail", 16);
});

test("held Backspace and Delete traverse mixed blocks without stuck input or lost caret", async ({
  page,
}) => {
  const source =
    "one\n\n# two\n\n> three\n\n- four\n\n```text\nfive\n```\n\n$$\nsix\n$$\n\nend";
  for (const key of ["Backspace", "Delete"]) {
    await mount(page, source, key === "Backspace" ? source.length : 0);
    for (let index = 0; index < 100; index++) {
      await page.keyboard.down(key);
      const current = await page.evaluate(() => window.nativeTest.state());
      await state(
        page,
        current.source,
        current.selection.head,
        current.selection.anchor,
      );
      if (!current.source) break;
    }
    await page.keyboard.up(key);
    await state(page, "", 0);
    await typeExactly(page, "Research continues: **α** + `x`.");
  }
});

test("nested literal line joins and word deletion preserve fences and table separators", async ({
  page,
}) => {
  for (const source of [
    "> ```js\n> alpha\n> beta\n> ```",
    "- ```js\n  alpha\n  beta\n  ```",
    "> $$\n> alpha\n> beta\n> $$",
  ]) {
    const at = source.indexOf("beta");
    await mount(page, source, at);
    await page.keyboard.press("Backspace");
    const expected =
      source.slice(0, source.indexOf("alpha") + 5) + source.slice(at);
    await state(page, expected, source.indexOf("alpha") + 5);
    await page.keyboard.press("ControlOrMeta+z");
    await state(page, source, at);
  }
  const table = "| A | B |\n| --- | --- |\n| alpha | beta |";
  await mount(page, table, table.indexOf("alpha") + 5);
  await page.getByTestId("note-editor").evaluate((el) =>
    el.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteWordBackward",
      }),
    ),
  );
  await state(page, table.replace("alpha", ""), table.indexOf("alpha"));
});
