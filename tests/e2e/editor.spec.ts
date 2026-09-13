import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInOwner } from "./auth";
import { editorDefaults } from "../../packages/shared/src/editor";
const origin =
  process.env.TEST_APP_URL || process.env.APP_URL || "http://localhost:8080";
let ownerState: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined;
async function api(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const r = await request.fetch("/api/v1/" + path, {
    method,
    data,
    headers: { origin, "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function fixture(
  browser: Browser,
  body = "# Research\n\nA useful result.\n\n",
  blockServiceWorkers = false,
) {
  const owner = await browser.newContext({
    baseURL: origin,
    storageState: ownerState,
  });
  if (!ownerState) {
    const r = await signInOwner(owner.request, origin);
    expect(r.ok(), await r.text()).toBeTruthy();
    ownerState = await owner.storageState();
  }
  const group = await api(owner.request, "groups", {
    name: "Editor verification " + randomUUID().slice(0, 8),
  });
  const invitation = await api(owner.request, "invitations", {
    groupId: group.id,
    email: `editor-${randomUUID()}@axiom.test`,
  });
  const member = await browser.newContext({
    baseURL: origin,
    serviceWorkers: blockServiceWorkers ? "block" : "allow",
  });
  await api(member.request, "register", {
    token: new URL(invitation.link).searchParams.get("invite"),
    name: "Editor Researcher",
    password: "AxiomEditorPassword2026!",
  });
  const note = await api(member.request, "notes", {
    groupId: group.id,
    title: "Editor interaction study",
    body,
  });
  const errors: string[] = [],
    page = await member.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?note=" + note.id);
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(
    page.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  const source = async () =>
    (await api(member.request, `notes/${note.id}`)).body as string;
  const close = async () => {
    expect(errors).toEqual([]);
    await owner.close();
    await member.close();
  };
  return { owner, member, page, note, source, close, errors };
}
test("source shortcut toggles once, preserves Markdown, and respects dialogs", async ({
  browser,
}) => {
  const f = await fixture(browser),
    { page } = f,
    original = await f.source();
  const editor = page.getByTestId("note-editor");
  await editor.click();
  await editor.press("ControlOrMeta+/");
  await expect(
    page.getByRole("button", { name: "Source", exact: true }),
  ).toHaveClass(/selected/);
  await editor.press("ControlOrMeta+/");
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toHaveClass(/selected/);
  await editor.press("ControlOrMeta+Shift+m");
  await expect(
    page.getByRole("button", { name: "Source", exact: true }),
  ).toHaveClass(/selected/);
  expect(await f.source()).toBe(original);
  await editor.press("ControlOrMeta+Shift+.");
  await page
    .getByRole("combobox", { name: "Find a command" })
    .press("ControlOrMeta+/");
  await expect(
    page.getByRole("button", { name: "Source", exact: true }),
  ).toHaveClass(/selected/);
  await page.keyboard.press("Escape");
  await f.close();
});
test("slash insertion is searchable, nested, cancellable, and one undo step", async ({
  browser,
}) => {
  const f = await fixture(browser),
    { page } = f,
    editor = page.getByTestId("note-editor");
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText("/math");
  await expect(page.locator(".native-slash")).toBeVisible();
  await page
    .locator(".native-slash")
    .getByText("Display equation", { exact: true })
    .click();
  await expect.poll(f.source).toContain("$$\n\n$$");
  await editor.press("ControlOrMeta+z");
  await expect.poll(f.source).toContain("/math");
  await editor.press("Escape");
  await expect(page.locator(".native-slash")).toHaveCount(0);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText("> /proof");
  await page
    .locator(".native-slash")
    .getByText("Proof", { exact: true })
    .click();
  await expect.poll(f.source).toContain("> > [!PROOF]");
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText("```python\n/math\n```\n");
  await editor.press("ArrowUp");
  await expect(page.locator(".native-slash")).toHaveCount(0);
  await f.close();
});
test("math previews, editable highlighted code and quote continuation", async ({
  browser,
}) => {
  const f = await fixture(
      browser,
      "# Results\n\n$$\nE=mc^2\n$$\n\n```python\ndef energy(m):\n    return m\n```\n\n> Evidence\n",
    ),
    { page } = f,
    editor = page.getByTestId("note-editor");
  await page
    .getByRole("button", { name: "Edit display equation", exact: true })
    .click();
  await expect(
    page.locator('.native-math-preview [data-math-state="ready"] svg'),
  ).toBeVisible();
  await editor.press("End");
  await editor.press("Shift+Home");
  await page.keyboard.insertText("x^2 + y^2");
  await expect.poll(f.source).toContain("$$\nx^2 + y^2\n$$");
  await expect(
    page.locator('.native-math-preview [data-math-state="ready"] svg'),
  ).toBeVisible();
  await editor.press("Escape");
  await page.locator(".native-code-block").hover();
  await expect(
    page.locator(".native-code-block .native-block-tools"),
  ).toBeVisible();
  await expect(
    page.locator(".research-editor .hljs-keyword").first(),
  ).toBeVisible();
  const language = page.getByLabel("Code language");
  await language.fill("julia");
  await language.press("Enter");
  await expect.poll(f.source).toContain("```julia");
  await page
    .locator("blockquote p")
    .filter({ hasText: "Evidence" })
    .click({ position: { x: 40, y: 10 } });
  await editor.press("End");
  await editor.press("Enter");
  await page.keyboard.insertText("Reproduced");
  await expect.poll(f.source).toContain("> Reproduced");
  await page.screenshot({
    path: "test-results/editor-blocks.png",
    fullPage: true,
  });
  await f.close();
});
test("tables synchronize keystrokes and support navigation, alignment and structure", async ({
  browser,
}) => {
  const f = await fixture(
      browser,
      "# Measurements\n\n| Quantity | Value |\n| --- | --- |\n| rate | 1 |\n| mass | 2 |\n\nEnd\n",
    ),
    { page } = f;
  await page
    .locator(".native-table-block td")
    .filter({ hasText: /^1$/ })
    .click();
  const input = page.locator('.native-table-block [data-active-cell="true"]');
  await input.fill("3");
  await expect.poll(f.source).toContain("| rate | 3 |");
  await expect(page.getByTestId("note-editor")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(input).toHaveText("mass");
  await page.keyboard.press("Tab");
  await expect(input).toHaveText("2");
  await page.keyboard.press("Tab");
  await expect(input).toHaveText("");
  await input.fill("speed");
  await page.keyboard.press("Tab");
  await input.fill("c");
  await page.keyboard.press("Shift+F10");
  await page
    .getByRole("menuitem", { name: "Align column right", exact: true })
    .click();
  await expect.poll(f.source).toContain("| --- | ---: |");
  await page.getByTestId("note-editor").press("Shift+F10");
  await page
    .getByRole("menuitem", { name: "Insert column right", exact: true })
    .click();
  await expect(
    page.locator(".native-table-block tr").first().locator("th"),
  ).toHaveCount(3);
  await page.getByTestId("note-editor").press("Shift+F10");
  await page.getByRole("menuitem", { name: /Insert row below/ }).click();
  await expect(page.locator(".native-table-block tr")).toHaveCount(5);
  await page.screenshot({
    path: "test-results/editor-table.png",
    fullPage: true,
  });
  await f.close();
});
test("keyboard overrides sync independently of appearance and survive reload", async ({
  browser,
}) => {
  const f = await fixture(browser, undefined, true),
    { page } = f;
  const appearance = await api(f.member.request, "me/preferences");
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Change shortcut for Bold", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Record keyboard shortcut" })
    .press("ControlOrMeta+Alt+Shift+b");
  const remoteAppearance = { ...appearance.preferences, proseSize: 23 };
  await api(
    f.member.request,
    "me/preferences",
    {
      preferences: remoteAppearance,
      version: appearance.version,
      mutationId: randomUUID(),
    },
    "PATCH",
  );
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/me/preferences-bundle") &&
      response.request().method() === "GET",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await api(f.member.request, "me/editor-preferences")).version,
    )
    .toBe(1);
  expect((await api(f.member.request, "me/preferences")).preferences).toEqual(
    remoteAppearance,
  );
  await page.reload();
  await expect(page.getByTestId("note-editor")).toBeVisible();
  const editor = page.getByTestId("note-editor");
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await editor.press("ControlOrMeta+Alt+Shift+b");
  await page.keyboard.insertText("bold research");
  await expect.poll(f.source).toContain("**bold research**");
  await f.close();
});
test("table cells remain usable when collaborators edit the same and adjacent cells", async ({
  browser,
}) => {
  const f = await fixture(
      browser,
      "| A | B |\n| --- | --- |\n| 1 | 2 |\n| keep | row |\n\nEnd\n",
    ),
    { page } = f;
  const other = await f.owner.newPage();
  other.on("pageerror", (e) => f.errors.push(e.message));
  await other.goto("/?note=" + f.note.id);
  await expect(
    other.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".native-table-block td")
    .filter({ hasText: /^1$/ })
    .click();
  await other
    .locator(".native-table-block td")
    .filter({ hasText: /^2$/ })
    .click();
  await page
    .locator('.native-table-block [data-active-cell="true"]')
    .fill("alpha");
  await other
    .locator('.native-table-block [data-active-cell="true"]')
    .fill("beta");
  await expect.poll(f.source).toContain("| alpha | beta |");
  await other
    .locator(".native-table-block td")
    .filter({ hasText: /^alpha$/ })
    .click();
  await page
    .locator('.native-table-block [data-active-cell="true"]')
    .fill("shared");
  await expect(
    other.locator('.native-table-block [data-active-cell="true"]'),
  ).toHaveText("shared");
  await other.keyboard.press("End");
  await other.keyboard.type(" result");
  await expect(
    page.locator('.native-table-block [data-active-cell="true"]'),
  ).toHaveText("shared result");
  await other.keyboard.press("Shift+F10");
  await other.getByRole("menuitem", { name: /Delete table row/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Recovered editor text", exact: true }),
  ).toHaveCount(0);
  await expect.poll(f.source).toContain("| keep | row |");
  await f.close();
});
test("editor preference API enforces versions, validation and account isolation", async ({
  browser,
}) => {
  const f = await fixture(browser);
  const id = randomUUID(),
    prefs = { ...editorDefaults, defaultCodeLanguage: "julia" };
  const saved = await api(
    f.member.request,
    "me/editor-preferences",
    { preferences: prefs, version: 0, mutationId: id },
    "PATCH",
  );
  expect(saved.version).toBe(1);
  expect(
    (
      await api(
        f.member.request,
        "me/editor-preferences",
        { preferences: prefs, version: 1, mutationId: id },
        "PATCH",
      )
    ).version,
  ).toBe(1);
  const stale = await f.member.request.patch("/api/v1/me/editor-preferences", {
    headers: { origin },
    data: { preferences: prefs, version: 0, mutationId: randomUUID() },
  });
  expect(stale.status()).toBe(409);
  const invalid = await f.member.request.patch(
    "/api/v1/me/editor-preferences",
    {
      headers: { origin },
      data: {
        preferences: {
          ...prefs,
          keybindings: { mac: { bold: ["Mod-k"] }, windowsLinux: {} },
        },
        version: 1,
        mutationId: randomUUID(),
      },
    },
  );
  expect(invalid.status()).toBe(422);
  expect(
    (await api(f.owner.request, "me/editor-preferences")).preferences
      .defaultCodeLanguage,
  ).not.toBe("julia");
  await f.close();
});

test("table TSV paste is one undo step and preserves surrounding Markdown", async ({
  browser,
}) => {
  const original =
    "Before **untouched**.\n\n| A | B |\n| --- | ---: |\n| old | 2 |\n\nAfter `unchanged`.\n";
  const f = await fixture(browser, original),
    { page } = f;
  await page
    .locator(".native-table-block td")
    .filter({ hasText: /^old$/ })
    .click();
  const input = page.locator('.native-table-block [data-active-cell="true"]');
  await input.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "alpha|beta\t3\ngamma\t4");
    const event = new ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    // Firefox creates an empty clipboard for synthetic events, ignoring the supplied DataTransfer.
    // Exercise the application's real paste handler with the same payload on all engines.
    if (event.clipboardData !== data)
      Object.defineProperty(event, "clipboardData", { value: data });
    el.dispatchEvent(event);
  });
  await expect.poll(f.source).toContain("alpha\\|beta");
  await expect.poll(f.source).toContain("| gamma | 4 |");
  expect(await f.source()).toMatch(
    /^Before \*\*untouched\*\*\.[\s\S]*After `unchanged`\.\n$/,
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(f.source).toBe(original);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const editor = page.getByTestId("note-editor");
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText("| A | B |\n| --- | --- |\n| short |\n");
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await page.locator(".native-table-block td").nth(1).click();
  await page
    .locator('.native-table-block [data-active-cell="true"]')
    .fill("materialized");
  await expect.poll(f.source).toContain("| short | materialized |");
  await f.close();
});

test("paired fences, LaTeX completion, find/replace and callout controls", async ({
  browser,
}) => {
  const f = await fixture(browser, ""),
    { page } = f,
    editor = page.getByTestId("note-editor");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await editor.click();
  await page.keyboard.insertText("```python");
  await editor.press("Enter");
  await expect.poll(f.source).toBe("```python\n\n```\n\n");
  await page.keyboard.insertText("def energy(m):");
  await editor.press("Enter");
  await page.keyboard.insertText("return m");
  await expect.poll(f.source).toContain("def energy(m):\n    return m");
  await editor.press("ControlOrMeta+a");
  await editor.press("ControlOrMeta+a"); // First selects code contents; second selects the document.
  await page.keyboard.insertText("$$");
  await editor.press("Enter");
  await page.keyboard.insertText("\\fra");
  await page
    .locator(".native-slash")
    .getByText("\\frac", { exact: true })
    .click();
  await expect.poll(f.source).toContain("\\frac{numerator}{denominator}");
  await editor.press("Escape");
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText("signal signal\n");
  await editor.press("ControlOrMeta+Shift+f");
  await page
    .locator('.native-find input[aria-label="Find in note"]')
    .fill("signal");
  await page
    .locator('.native-find input[aria-label="Replace with"]')
    .fill("result");
  await page.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect.poll(f.source).toBe("result result\n");
  await page
    .locator('.native-find input[aria-label="Find in note"]')
    .press("Escape");
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "> [!THEOREM] Stability\n> Stable result.\n\nEnd\n",
  );
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await page.locator(".native-callout-header").hover();
  await page.getByLabel("Callout title", { exact: true }).fill("Convergence");
  await page.getByLabel("Callout title", { exact: true }).press("Enter");
  await expect.poll(f.source).toContain("> [!THEOREM] Convergence");
  await page.getByLabel("Callout type", { exact: true }).selectOption("lemma");
  await expect.poll(f.source).toContain("> [!LEMMA] Convergence");
  await expect(page.locator(".callout").first()).toBeVisible();
  await f.close();
});

test("live code uses appearance settings and contains long lines on small screens", async ({
  browser,
}) => {
  const f = await fixture(
      browser,
      '# Code\n\n```python\nx = "' +
        "long_value_".repeat(35) +
        '"\nprint(x)\n```\n\nAfter code.\n',
    ),
    { page } = f;
  const record = await api(f.member.request, "me/preferences");
  await api(
    f.member.request,
    "me/preferences",
    {
      preferences: {
        ...record.preferences,
        mode: "dark",
        lineNumbers: true,
        codeWrap: false,
        uiSize: 22,
        proseSize: 30,
        codeSize: 24,
      },
      version: record.version,
      mutationId: randomUUID(),
    },
    "PATCH",
  );
  await page.reload();
  await expect(
    page.locator(".code-numbered .native-code-line").first(),
  ).toBeVisible();
  await expect(
    page.locator(".code-numbered .native-code-line").first(),
  ).toHaveAttribute("data-code-line", "1");
  const wrapper = page.locator(".native-code-body").first();
  await expect
    .poll(() => wrapper.evaluate((el) => el.scrollWidth > el.clientWidth + 20))
    .toBeTruthy();
  await page.setViewportSize({ width: 320, height: 760 });
  await expect
    .poll(() =>
      page
        .getByRole("textbox", { name: "Note title", exact: true })
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
    )
    .toBeTruthy();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    )
    .toBeTruthy();
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByLabel("Wrap code blocks", { exact: true }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".native-code-line .native-text")
        .first()
        .evaluate((el) => getComputedStyle(el).whiteSpace),
    )
    .toBe("pre-wrap");
  await expect
    .poll(() => wrapper.evaluate((el) => el.scrollWidth <= el.clientWidth + 2))
    .toBeTruthy();
  await page.screenshot({
    path: "test-results/editor-mobile-dark.png",
    fullPage: true,
  });
  await f.close();
});

test("shortcut collisions require an explicit choice and Cancel discards drafts", async ({
  browser,
}) => {
  const f = await fixture(browser),
    { page } = f;
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Change shortcut for Bold", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Record keyboard shortcut" })
    .press("ControlOrMeta+k");
  await expect(
    page.getByRole("button", { name: "Reassign shortcut", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Keep existing bindings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Disable shortcut for Bold", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await api(f.member.request, "me/editor-preferences")).version).toBe(
    0,
  );
  const editor = page.getByTestId("note-editor");
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await editor.press("ControlOrMeta+b");
  await page.keyboard.insertText("still bold");
  await expect.poll(f.source).toContain("**still bold**");
  await f.close();
});

test("editor preferences queue offline and merge independent remote settings", async ({
  browser,
}) => {
  const f = await fixture(browser, undefined, true),
    { page } = f;
  // A route failure models an unreachable preference service without disturbing note sync.
  await page.route("**/api/v1/me/preferences-bundle", (route) => route.abort());
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByLabel("Default code language", { exact: true }).fill("julia");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const remote = { ...editorDefaults, indentSize: 8 };
  await api(
    f.member.request,
    "me/editor-preferences",
    { preferences: remote, version: 0, mutationId: randomUUID() },
    "PATCH",
  );
  await page.unroute("**/api/v1/me/preferences-bundle");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(
      async () =>
        (await api(f.member.request, "me/editor-preferences")).preferences,
    )
    .toMatchObject({ defaultCodeLanguage: "julia", indentSize: 8 });
  await page.reload();
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(
    page.getByLabel("Default code language", { exact: true }),
  ).toHaveValue("julia");
  await expect(
    page.getByLabel("Code indentation", { exact: true }),
  ).toHaveValue("8");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await f.close();
});

test("table composition retains a draft when its row is remotely removed", async ({
  browser,
}) => {
  const f = await fixture(
      browser,
      "| A | B |\n| --- | --- |\n| composing | 2 |\n| keep | row |\n",
    ),
    { page } = f;
  const other = await f.owner.newPage();
  await other.goto("/?note=" + f.note.id);
  await expect(
    other.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".native-table-block td")
    .filter({ hasText: /^composing$/ })
    .click();
  const input = page.locator('.native-table-block [data-active-cell="true"]');
  await input.evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    el.textContent = "量子研究";
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "量子研究",
        isComposing: true,
      }),
    );
  });
  expect(await f.source()).toContain("composing");
  await other
    .locator(".native-table-block td")
    .filter({ hasText: /^composing$/ })
    .click();
  await other.keyboard.press("Shift+F10");
  await other.getByRole("menuitem", { name: /Delete table row/ }).click();
  await expect.poll(f.source).not.toContain("composing");
  await input.evaluate((el) =>
    el.dispatchEvent(
      new CompositionEvent("compositionend", {
        bubbles: true,
        data: "量子研究",
      }),
    ),
  );
  await expect(
    page.getByRole("textbox", { name: "Recovered editor text", exact: true }),
  ).toHaveValue(/\| 量子研究 \| 2 \|/);
  expect(await f.source()).not.toContain("量子研究");
  await f.close();
});

test("remote block header changes retain uncommitted local titles", async ({
  browser,
}) => {
  const f = await fixture(
      browser,
      "> [!THEOREM] Stability\n> A result.\n\nEnd\n",
    ),
    { page } = f;
  const other = await f.owner.newPage();
  await other.goto("/?note=" + f.note.id);
  await expect(
    other.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  await page.locator(".native-callout-header").hover();
  await page
    .getByLabel("Callout title", { exact: true })
    .fill("Uncommitted local title");
  await other.getByLabel("Callout type", { exact: true }).selectOption("lemma");
  await expect(
    page.getByRole("textbox", { name: "Recovered editor text", exact: true }),
  ).toHaveValue(/\[!THEOREM\] Uncommitted local title/);
  await expect.poll(f.source).toContain("> [!LEMMA] Stability");
  expect(await f.source()).not.toContain("Uncommitted local title");
  await f.close();
});

test("failed Markdown worker loads are visible while source edits remain durable", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Worker recovery\n\n", true),
    { page } = f;
  await page.route("**/*turbopack-worker*.js*", (route) => route.abort());
  // Block ordinary worker bundles as well when using a development build.
  await page.route("**/*markdown*worker*.js*", (route) => route.abort());
  await page.reload();
  await expect(
    page.getByText("Markdown preview stopped.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const editor = page.getByTestId("note-editor");
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText("Source survives preview failure.");
  await expect.poll(f.source).toContain("Source survives preview failure.");
  await f.close();
});

test("table ranges, contextual commands and keyboard resizing preserve Markdown and undo", async ({
  browser,
}) => {
  const original =
    "# Dataset\n\n| A | B | C |\n| --- | --- | --- |\n| alpha | beta | gamma |\n| delta | epsilon | zeta |\n\nEnd\n";
  const f = await fixture(browser, original),
    { page } = f;
  const grid = page.getByRole("table", { name: "Editable table" });
  await grid
    .getByRole("cell")
    .filter({ hasText: /^alpha$/ })
    .click();
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await expect(grid.locator('[aria-selected="true"]')).toHaveCount(4);
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Block actions" });
  await expect(menu).toBeVisible();
  await menu
    .getByRole("menuitem", { name: "Clear selected cells", exact: true })
    .click();
  await expect.poll(f.source).toContain("|  |  | gamma |");
  await expect.poll(f.source).toContain("|  |  | zeta |");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(f.source).toBe(original);
  const resize = page.getByRole("separator", { name: "Resize column 1" });
  await resize.focus();
  await resize.press("ArrowRight");
  expect(Number(await resize.getAttribute("aria-valuenow"))).toBeGreaterThan(
    80,
  );
  expect(await f.source()).toBe(original);
  await grid
    .getByRole("cell")
    .filter({ hasText: /^delta$/ })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Duplicate row", exact: true })
    .click();
  await expect
    .poll(async () => (await f.source()).match(/delta/g)?.length)
    .toBe(2);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  // A delayed viewport event must reposition, not dismiss, a newly opened menu.
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect(menu).toBeVisible();
  expect(
    await menu.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return (
        box.left >= 0 &&
        box.right <= innerWidth &&
        box.top >= 0 &&
        box.bottom <= innerHeight
      );
    }),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/refinement-table-menu-mobile.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await f.close();
});

test("code view overrides, line boundaries and block menus keep fences intact", async ({
  browser,
}) => {
  const original =
    "# Code study\n\n```python\nfirst = 1\nsecond = 2\n```\n\nAfter\n";
  const f = await fixture(browser, original),
    { page } = f;
  await page.locator(".native-code-block").hover();
  await page
    .getByRole("button", { name: "More code actions", exact: true })
    .click();
  await page
    .getByRole("menuitemcheckbox", {
      name: "Line numbers in this block",
      exact: true,
    })
    .click();
  await expect(page.locator(".code-numbered .native-code-line")).toHaveCount(2);
  expect(await f.source()).toBe(original);
  await page
    .locator(".native-code-line")
    .filter({ hasText: "first = 1" })
    .click();
  await page.keyboard.press("Alt+ArrowUp");
  expect(await f.source()).toBe(original);
  await page.keyboard.press("ControlOrMeta+a");
  expect(
    await page.evaluate(() => window.getSelection()?.toString()),
  ).toContain("first = 1");
  await page.keyboard.press("ArrowRight");
  await page.locator(".native-code-block").hover();
  await page
    .getByRole("button", { name: "More code actions", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: /Duplicate selection or block/ })
    .click();
  await expect
    .poll(async () => (await f.source()).match(/```python/g)?.length)
    .toBe(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(f.source).toBe(original);
  await f.close();
});

test("equation inspector and offline self-contained HTML use accessible local math", async ({
  browser,
}) => {
  const body =
    "# Equations\n\n$$\nE=mc^2\\label{energy}\n$$\n\n$$\n\\ce{2H2 + O2 -> 2H2O}\n$$\n\nSee \\eqref{missing}.\n";
  const f = await fixture(browser, body),
    { page } = f;
  const response = await f.member.request.get(
    `/api/v1/notes/${f.note.id}/export?format=html`,
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain("<svg");
  expect(html).toContain("<math");
  expect(html).not.toContain("data-math-request");
  expect(html).not.toMatch(/<script|https:\/\/cdn/);
  await page.goto(`/workbench/notes/${f.note.id}`);
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(
    page.locator('.research-editor [data-math-state="ready"] svg'),
  ).toHaveCount(2);
  if (
    !(await page.getByRole("button", { name: "equations panel" }).isVisible())
  )
    await page.getByRole("button", { name: "Toggle document panel" }).click();
  await page.getByRole("button", { name: "equations panel" }).click();
  await expect(
    page.getByRole("region", { name: "Equation inspector" }),
  ).toContainText("2 display equations");
  await expect(
    page.getByRole("button", {
      name: "Missing equation: missing",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Search equations").fill("energy");
  await expect(page.locator(".equation-list > button")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/refinement-equations.png",
    fullPage: true,
  });
  await f.close();
});

test("an unreadable comments response stays an error and does not crash the editor", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Research\n\nA useful result.\n\n", true);
  await f.page.route("**/api/v1/notes/*/comments", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html>Interrupted response</html>",
    }),
  );
  await f.page.reload();
  await expect(
    f.page.getByText(
      "The server returned an unreadable response. Please try again.",
    ),
  ).toBeVisible();
  const editor = f.page.getByTestId("note-editor");
  await expect(editor).toBeVisible();
  await editor.press("ControlOrMeta+End");
  await f.page.keyboard.type("Still editable");
  await expect.poll(f.source).toContain("Still editable");
  await f.close();
});

test("invalid math keeps a visibly stale preview without losing editable TeX", async ({
  browser,
}) => {
  const f = await fixture(browser, "$$\nE=mc^2\n$$\n\nEnd\n"),
    { page } = f;
  await page
    .getByRole("button", { name: "Edit display equation", exact: true })
    .click();
  await expect(
    page.locator('.native-math-preview [data-math-state="ready"] svg'),
  ).toBeVisible();
  const editor = page.getByTestId("note-editor");
  await expect(editor).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const node = window.getSelection()?.anchorNode;
        return (
          node?.nodeType === Node.TEXT_NODE
            ? node.parentElement
            : (node as Element | null)
        )?.closest(".native-math-source")?.textContent;
      }),
    )
    .toBe("E=mc^2");
  await editor.press("End");
  await editor.press("Shift+Home");
  await page.keyboard.insertText("\\frac{");
  await expect.poll(f.source).toBe("$$\n\\frac{\n$$\n\nEnd\n");
  await expect(
    page.locator('.native-math-preview [data-math-state="stale"] svg'),
  ).toBeVisible();
  await expect(page.locator(".native-math-diagnostic")).toBeVisible();
  await editor.press("End");
  await editor.press("Shift+Home");
  await page.keyboard.insertText("x^2");
  await expect(
    page.locator('.native-math-preview [data-math-state="ready"] svg'),
  ).toBeVisible();
  await expect.poll(f.source).toBe("$$\nx^2\n$$\n\nEnd\n");
  await page.getByLabel("Note title", { exact: true }).click();
  await page.locator(".native-math-preview svg").click();
  await expect(editor).toBeFocused();
  await editor.press("End");
  await page.keyboard.insertText("+1");
  await expect.poll(f.source).toBe("$$\nx^2+1\n$$\n\nEnd\n");
  await f.close();
});

test("HTML table paste sanitizes markup and preserves multiline cells in one undo", async ({
  browser,
}) => {
  const original = "| A | B |\n| --- | --- |\n| one | two |\n\nEnd\n";
  const f = await fixture(browser, original),
    { page } = f,
    unexpected: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("unsafe.invalid"))
      unexpected.push(request.url());
  });
  await page
    .locator(".native-table-block td")
    .filter({ hasText: /^one$/ })
    .click();
  await page
    .locator('.native-table-block [data-active-cell="true"]')
    .evaluate((el) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<table><tr><td><strong>Alpha</strong><br>Beta<script>alert(1)</script><img src="https://unsafe.invalid/x"></td><td><a href="javascript:alert(1)">safe text</a></td></tr></table>',
      );
      clipboardData.setData("text/plain", "Alpha\nBeta\tsafe text");
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });
      if (event.clipboardData !== clipboardData)
        Object.defineProperty(event, "clipboardData", { value: clipboardData });
      el.dispatchEvent(event);
    });
  await expect.poll(f.source).toContain("**Alpha**<br>Beta");
  expect(await f.source()).not.toMatch(/javascript:|<script|<img/);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(f.source).toBe(original);
  expect(unexpected).toEqual([]);
  await f.close();
});

test("subtle table handles reorder rows and columns with shared undo", async ({
  browser,
}) => {
  const original =
    "| Name | Value |\n| :--- | ---: |\n| first | 1 |\n| second | 2 |\n\nEnd\n";
  const f = await fixture(browser, original),
    { page } = f;
  const table = page.getByRole("table", { name: "Editable table" });
  await table.locator("tr").nth(1).hover();
  await page
    .locator('[data-move-axis="row"][data-move-index="1"]')
    .dragTo(table.locator("tr").nth(2).locator("td").first());
  await expect.poll(f.source).toContain("| second | 2 |\n| first | 1 |");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(f.source).toBe(original);
  await table.locator("th").first().hover();
  await page
    .locator('[data-move-axis="column"][data-move-index="0"]')
    .dragTo(table.locator("th").nth(1));
  await expect.poll(f.source).toContain("| Value | Name |\n| ---: | :--- |");
  await expect.poll(f.source).toContain("| 1 | first |");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(f.source).toBe(original);
  await f.close();
});
