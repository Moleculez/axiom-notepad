import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { signInOwner } from "../e2e/auth";
import { measureTaskLayout } from "../helpers/task-layout";

const origin = "http://localhost:8080";
let cookies: Awaited<ReturnType<BrowserContext["cookies"]>>;
const fingerprint = createHash("sha256");
for (const file of [
  "apps/web/next.config.ts",
  "apps/web/lib/editor-view.ts",
  "apps/web/lib/editor-vnext/view.ts",
  "apps/web/lib/editor-vnext/language-menu.ts",
  "apps/web/lib/editor-vnext/image-view.ts",
  "apps/web/lib/editor-vnext/image-source.ts",
  "apps/web/lib/footnote-tooltips.ts",
  "apps/web/lib/editor-links.ts",
  "apps/web/lib/native-editor/view.ts",
  "apps/web/lib/native-editor/completions.ts",
  "apps/web/components/workspace/Workbench.tsx",
  "packages/shared/src/editor.ts",
  "apps/web/app/editor-vnext.css",
  "apps/web/app/editor-paper.css",
  "apps/web/lib/editor-vnext/chrome.ts",
  "apps/web/lib/editor-vnext/table-panel.ts",
  "apps/web/lib/editor-popover.ts",
  "packages/editor/src/table-target.ts",
  "packages/shared/src/appearance.ts",
  "packages/shared/src/document-style.ts",
  "packages/shared/assets/document-decorations.css",
  "packages/shared/assets/document-tasks.css",
  "packages/editor/src/quote-prose.ts",
  "packages/editor/src/bridge.ts",
  "apps/web/lib/appearance.ts",
  "apps/web/app/layout.tsx",
  "packages/shared/assets/latin-modern/fonts.css",
  "packages/shared/assets/latin-modern/axiom-lm-regular.woff2",
  "packages/shared/assets/latin-modern/axiom-lm-italic.woff2",
  "packages/shared/assets/latin-modern/axiom-lm-bold.woff2",
  "packages/shared/assets/latin-modern/axiom-lm-bolditalic.woff2",
  "apps/web/components/ReadingView.tsx",
  "apps/web/components/SettingsEditorPreview.tsx",
  "apps/web/components/SettingsSplitPanel.tsx",
  "apps/web/components/AppearanceSettings.tsx",
  "apps/web/components/EditorSettings.tsx",
  "apps/web/components/workspace/Settings.tsx",
  "apps/web/app/settings.css",
  "packages/shared/src/html-export.ts",
  "packages/markdown/src/render.ts",
  "packages/markdown/src/section-numbers.ts",
  "packages/markdown/src/document-index.ts",
  "apps/web/lib/native-editor/render.ts",
  "apps/web/lib/native-editor/projection.ts",
  "packages/editor/src/prose-projection.ts",
  "packages/editor/src/projection.ts",
  "packages/editor/src/rich-surface.ts",
  "packages/editor/src/line-endings.ts",
  "packages/editor/src/binding.ts",
  "packages/editor/src/text-surface.ts",
  "packages/editor/src/literal.ts",
  "packages/editor/src/generated-fences.ts",
  "packages/editor/src/code-languages.ts",
  "packages/editor/src/transactions.ts",
  "packages/editor/src/footnotes.ts",
  "packages/editor/src/footnote-projection.ts",
  "packages/markdown/src/footnotes.ts",
  "packages/markdown/src/parser.ts",
  "packages/markdown/src/editing.ts",
  "packages/markdown/src/containers.ts",
  "packages/editor/src/schema.ts",
  "packages/shared/src/editor-looks.ts",
]) {
  fingerprint.update(file).update(await readFile(file));
}
const sourceFingerprint = fingerprint.digest("hex");
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: origin });
  try {
    const login = await signInOwner(context.request, origin);
    expect(
      login.status(),
      "The existing local seed account must be available",
    ).toBe(200);
    cookies = await context.cookies();
  } finally {
    await context.close();
  }
});

test.beforeEach(async ({ context, page }) => {
  await context.addCookies(cookies);
  // The smoke must not update any existing research content or preferences.
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
      !path.endsWith("/sync-token") &&
      !path.endsWith("/opened") &&
      !path.startsWith("/api/v1/me/reading")
    ) {
      await route.abort("blockedbyclient");
      throw new Error(
        `Dev smoke refused a ${request.method()} content/settings mutation`,
      );
    }
    await route.continue();
  });
});

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Lazy equation/diagram workers finish after the editor itself is visible.
  // Capture their rendered output, not a transient TeX placeholder.
  for (const [selector, attribute] of [
    ["[data-math-request]", "data-math-state"],
    ["[data-mermaid]", "data-preview-state"],
  ]) {
    for (const preview of await page.locator(selector).all()) {
      const visible = await preview.evaluate((element) => {
        const box = element.getBoundingClientRect();
        let left = Math.max(0, box.left),
          right = Math.min(innerWidth, box.right);
        let top = Math.max(0, box.top),
          bottom = Math.min(innerHeight, box.bottom);
        // Lazy previews below a nested scratchpad's clip are not on screen,
        // even when their un-clipped DOM rectangle overlaps the viewport.
        for (
          let parent = element.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          const css = getComputedStyle(parent),
            clip = parent.getBoundingClientRect();
          if (/auto|scroll|hidden|clip/.test(css.overflowX)) {
            left = Math.max(left, clip.left);
            right = Math.min(right, clip.right);
          }
          if (/auto|scroll|hidden|clip/.test(css.overflowY)) {
            top = Math.max(top, clip.top);
            bottom = Math.min(bottom, clip.bottom);
          }
        }
        return right > left && bottom > top;
      });
      if (visible) await expect(preview).toHaveAttribute(attribute, "ready");
    }
  }
  const path = info.outputPath(name + ".png");
  await page.screenshot({ path, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
  await info.attach(name + "-provenance", {
    contentType: "application/json",
    body: JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        origin: new URL(page.url()).origin,
        route: new URL(page.url()).pathname.replace(
          /notes\/[^/]+/,
          "notes/[existing-note]",
        ),
        engine: await page
          .locator("[data-engine]")
          .evaluateAll(
            (elements) => elements[0]?.getAttribute("data-engine") ?? null,
          ),
        sourceFingerprint,
        viewport: page.viewportSize(),
        scope:
          "Notes and saved account settings unchanged; scratchpad and account edits are disposable previews",
      },
      null,
      2,
    ),
  });
}

test("8080 serves the latest editor in Write, Source and Read without changing the note", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const me = await (await page.request.get("/api/v1/me")).json();
  const workspace = await (
    await page.request.get(`/api/v1/workspace?groupId=${me.groups[0].id}`)
  ).json();
  const note = workspace.notes.find(
    (item: { title: string; deleted_at: string | null }) =>
      item.title === "Variational principles & learning" && !item.deleted_at,
  );
  expect(
    Boolean(note),
    "Use the existing seed note; this test never seeds live data",
  ).toBe(true);
  const savedHash = async () =>
    digest(
      (await (await page.request.get(`/api/v1/notes/${note.id}`)).json()).body,
    );
  const before = await savedHash();
  await page.goto(`/workbench/notes/${note.id}`);
  await expect(
    page.locator('.axiom-editor[data-engine="milkdown"]'),
  ).toBeVisible();
  await expect(page.locator(".ws-document-status")).toContainText(
    "Saved on server",
  );
  await expect(page.locator(".axiom-prose")).toBeVisible();
  await capture(page, info, "editor-write");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator(".cm-editor")).toBeVisible();
  await capture(page, info, "editor-source");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(page.locator(".ws-note-footer")).toBeVisible();
  await capture(page, info, "editor-read");
  await page.locator(".ws-document-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const footer = await page.locator(".ws-note-footer").boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(1000);
  await capture(page, info, "editor-research");
  expect(
    await savedHash(),
    "Mode switches must preserve the saved Markdown",
  ).toBe(before);
  expect(errors).toEqual([]);
});

test("current theme gallery and typography preview render on 8080 without saving preferences", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const preferences = async () =>
    digest(
      await (await page.request.get("/api/v1/me/preferences-bundle")).text(),
    );
  const before = await preferences();
  await page.goto("/workbench/settings/theme");
  await expect(
    page.locator('.settings-scratchpad [data-engine="milkdown"]'),
  ).toBeVisible();
  await expect(page.locator(".palette-gallery .palette-card")).toHaveCount(16);
  for (const [theme, mode] of [
    ["Pearl", "light"],
    ["Carbon", "dark"],
  ]) {
    await page
      .getByRole("button", { name: `Use ${theme} theme`, exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    await capture(page, info, `settings-theme-${mode}`);
  }
  await page.getByRole("link", { name: "Typography", exact: true }).click();
  await page
    .getByRole("button", { name: "Use Journal document style", exact: true })
    .click();
  await expect(
    page.getByLabel("Note font size value", { exact: true }),
  ).toHaveValue("19");
  await capture(page, info, "settings-typography");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await preferences(),
    "Appearance preview must not update the account",
  ).toBe(before);
  expect(errors).toEqual([]);
});

test("code-body autocomplete stays disabled in the disposable scratchpad", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workbench/settings/code");
  const scratchpad = page.locator(".settings-scratchpad");
  await expect(scratchpad.locator('[data-engine="milkdown"]')).toBeVisible();
  const input = scratchpad.locator(".axiom-embedded .cm-content").first();
  await input.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("research_value = 1\n");
  await page.keyboard.type("res");
  const menu = page.getByRole("listbox", {
    name: "Code suggestions",
    exact: true,
  });
  await expect(menu).toHaveCount(0);
  await page.keyboard.press("Control+Space");
  await expect(menu).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(input.locator(".cm-line").last()).toHaveText("    res");
  await capture(page, info, "editor-code-body-no-autocomplete");
  await page.keyboard.press("Shift+Tab");
  await expect(input.locator(".cm-line").last()).toHaveText("res");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("def");
  await page.keyboard.press("Tab");
  await expect(input).toHaveText("    def");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(input.locator(".cm-line")).toHaveCount(2);
  await expect(input.locator(".cm-line").first()).toHaveText("def");
  await capture(page, info, "editor-code-no-snippet-expansion");
  await expect(input).toBeFocused();
  await expect(menu).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("table menus, code and mathematics use the latest engine in the disposable settings scratchpad", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workbench/settings/tables");
  const scratchpad = page.locator(".settings-scratchpad");
  await expect(scratchpad.locator('[data-engine="milkdown"]')).toBeVisible();
  await page
    .getByTestId("settings-scratchpad")
    .locator("td")
    .first()
    .click({ button: "right" });
  await expect(
    page.getByRole("dialog", { name: "Table actions" }),
  ).toBeVisible();
  await capture(page, info, "editor-table-context-menu");
  await page.keyboard.press("Escape");
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  const source = scratchpad.locator(".cm-content");
  await source.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("Scratch only\n\n- [ ] Try a task\n");
  await scratchpad.getByRole("button", { name: "Write", exact: true }).click();
  await expect(page.getByTestId("settings-scratchpad")).toContainText(
    "Scratch only",
  );
  await scratchpad
    .getByRole("button", { name: "Reset sample", exact: true })
    .click();
  await expect(page.getByTestId("settings-scratchpad")).toContainText("Energy");
  for (const category of ["code", "math"]) {
    await page.goto(`/workbench/settings/${category}`);
    await expect(scratchpad.locator('[data-engine="milkdown"]')).toBeVisible();
    await scratchpad.scrollIntoViewIfNeeded();
    if (category === "math")
      await expect(
        scratchpad.locator('[data-math-state="ready"] svg').first(),
      ).toBeVisible();
    await capture(page, info, `editor-${category}-preview`);
    if (category === "code") {
      const block = scratchpad
        .locator('.axiom-embedded[data-kind="codeBlock"]')
        .first();
      await block.hover();
      await block.getByRole("button", { name: "Change code language" }).click();
      const language = block.getByRole("combobox", {
        name: "Code language",
        exact: true,
      });
      await language.fill("ma");
      await expect(
        page.locator('.language-logo[data-brand="matlab"] img'),
      ).toBeVisible();
      await expect(
        page.locator('.language-logo[data-brand="wolfram"] img'),
      ).toBeVisible();
      await expect(
        page
          .getByRole("listbox", { name: "Code language suggestions" })
          .getByRole("option", { name: "MATLAB", exact: true }),
      ).toBeVisible();
      await capture(page, info, "editor-code-language-suggestions");
      await language.fill("ju");
      await language.press("Tab");
      await expect(
        block.getByRole("button", { name: "Change code language" }),
      ).toHaveText("julia");
      await page.keyboard.press("ControlOrMeta+z");
      await expect(
        block.getByRole("button", { name: "Change code language" }),
      ).toHaveText("python");
    }
    await scratchpad
      .getByRole("button", { name: "Source", exact: true })
      .click();
    await scratchpad.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    const block = category === "code" ? "```py\nx\n```" : "$$\nx\n$$";
    await page.keyboard.insertText(block + "\n\nOutside");
    await scratchpad
      .getByRole("button", { name: "Write", exact: true })
      .click();
    if (category === "math")
      await scratchpad
        .getByRole("button", { name: "Edit display equation", exact: true })
        .click();
    const input = scratchpad.locator(".axiom-embedded .cm-content");
    await input.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await expect(
      scratchpad.locator(
        `.axiom-source-prose[data-source-kind="${category}Block"]`,
      ),
    ).toBeVisible();
    await expect(input).toHaveCount(0);
    await expect(scratchpad.locator(".axiom-prose")).toBeFocused();
    await capture(page, info, `editor-${category}-empty-source`);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(input).toContainText("x");
    // A fence made by typing + Enter is different from the imported sample:
    // empty deletion reverses only our autocomplete and keeps just the opener.
    await scratchpad
      .getByRole("button", { name: "Source", exact: true })
      .click();
    await scratchpad.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await scratchpad
      .getByRole("button", { name: "Write", exact: true })
      .click();
    await scratchpad.locator(".axiom-blank-paragraph").first().click();
    const opener = category === "code" ? "```" : "$$";
    await page.keyboard.type(opener);
    if (category === "code") {
      await expect(
        page.getByRole("listbox", { name: "Code language suggestions" }),
      ).toBeVisible();
      await capture(page, info, "editor-fence-language-suggestions");
    }
    await page.keyboard.press("Enter");
    await expect(input).toBeFocused();
    if (category === "code") {
      const generated = scratchpad.locator(
        '.axiom-embedded[data-kind="codeBlock"]',
      );
      await generated.hover();
      await generated
        .getByRole("button", { name: "Change code language" })
        .click();
      const language = generated.getByRole("combobox", {
        name: "Code language",
        exact: true,
      });
      await language.fill("ju");
      await language.press("Tab");
      await expect(
        generated.getByRole("button", { name: "Change code language" }),
      ).toHaveText("julia");
      await expect(input).toBeFocused();
    }
    await page.keyboard.press("Backspace");
    await expect(input).toHaveCount(0);
    await expect(scratchpad.locator(".axiom-source-prose")).toHaveText(opener);
    await expect(scratchpad.locator(".axiom-prose")).toBeFocused();
    await expect(
      page.getByRole("listbox", { name: "Code language suggestions" }),
    ).toHaveCount(0);
    await capture(page, info, `editor-${category}-generated-opener`);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(input).toBeFocused();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(scratchpad.locator(".axiom-source-prose")).toHaveText(opener);
    await expect(
      page.getByRole("listbox", { name: "Code language suggestions" }),
    ).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(input).toBeFocused();
    await page.keyboard.type("x");
    await page.keyboard.press("Backspace");
    await expect(scratchpad.locator(".axiom-source-prose")).toHaveText(opener);
    await scratchpad
      .getByRole("button", { name: "Source", exact: true })
      .click();
    await expect(scratchpad.locator(".cm-content")).toHaveText(opener);
  }
  expect(errors).toEqual([]);
});

test("LaTeX Article and paper palettes preview with compact table controls without saving", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const preferences = async () =>
    digest(
      await (
        await page.request.get("/api/v1/me/preferences-bundle", {
          headers: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
        })
      ).text(),
    );
  const before = await preferences();
  await page.goto("/workbench/settings/typography");
  await page
    .getByRole("button", {
      name: "Use LaTeX Article document style",
      exact: true,
    })
    .click();
  await page.getByRole("link", { name: "Theme", exact: true }).click();
  const scratchpad = page.locator(".settings-scratchpad");
  const text =
    "## Energy and uncertainty\n\nAn **explicit model**, with room for *uncertainty*.\n\n| Quantity | Estimate |\n| :--- | ---: |\n| Energy | $E = mc^2$ |\n| Uncertainty | $\\sigma^2$ |\n\n```python\nenergy = mass * c**2\n```\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n";
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  await scratchpad.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
  await scratchpad.getByRole("button", { name: "Write", exact: true }).click();
  for (const [theme, name] of [
    ["Paper Ink", "paper-ink"],
    ["Night Paper", "night-paper"],
  ]) {
    await page
      .getByRole("button", { name: `Use ${theme} theme`, exact: true })
      .click();
    await scratchpad.scrollIntoViewIfNeeded();
    await scratchpad.locator("h2").scrollIntoViewIfNeeded();
    await expect(scratchpad.locator("h2")).toHaveCSS(
      "font-family",
      /Axiom Latin Modern/,
    );
    await capture(page, info, `editor-latex-${name}`);
  }
  const table = scratchpad.locator(".axiom-table-shell");
  await table.locator("td").first().click({ button: "right" });
  const panel = page.getByRole("dialog", {
    name: "Table actions",
    exact: true,
  });
  await panel.getByRole("tab", { name: "Column", exact: true }).click();
  await panel
    .getByRole("button", { name: "Insert column right", exact: true })
    .hover();
  await expect(page.getByRole("tooltip")).toContainText("Insert column right");
  await capture(page, info, "editor-table-column-panel");
  await page.keyboard.press("Escape");
  const equation = scratchpad.locator('.axiom-embedded[data-kind="mathBlock"]');
  await equation.scrollIntoViewIfNeeded();
  await expect(equation.locator('[data-math-state="ready"] svg')).toBeVisible();
  // SVG layout may be taller than its pending source placeholder.
  await equation.scrollIntoViewIfNeeded();
  await capture(page, info, "editor-latex-code-math");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await preferences(),
    "Unsaved previews must not change account settings",
  ).toBe(before);
  expect(errors).toEqual([]);
});

test("LaTeX section rules and immediate quotes preview without saving", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const before = await (
    await page.request.get("/api/v1/me/preferences-bundle")
  ).text();
  await page.goto("/workbench/settings/typography");
  await page
    .getByRole("button", {
      name: "Use LaTeX Article document style",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("Document decorations", { exact: true }),
  ).toHaveValue("latex");
  const scratchpad = page.locator(".settings-scratchpad");
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  await scratchpad.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "## A careful derivation\n\n### Assumptions\n\nState the model explicitly.\n\n### Evidence\n\nPreserve each observation.\n\n## A reproducible result\n\n### Verification\n\n***\n\n> Preserve the evidence.\n\nOutside",
  );
  await scratchpad.getByRole("button", { name: "Write", exact: true }).click();
  await scratchpad.scrollIntoViewIfNeeded();
  await scratchpad.locator("h2").first().scrollIntoViewIfNeeded();
  expect(
    await scratchpad
      .locator("[data-section-number]")
      .evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-section-number")),
      ),
  ).toEqual(["1", "1.1", "1.2", "2", "2.1"]);
  await expect(scratchpad.locator("hr")).toHaveCSS("height", "4px");
  await capture(page, info, "editor-latex-section-rules");
  const divider = scratchpad.getByRole("separator", {
    name: "Divider",
    exact: true,
  });
  await divider.click();
  await expect(divider.locator("hr")).toBeVisible();
  await expect(
    divider.locator(".cm-editor, .axiom-block-controls"),
  ).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await expect(divider).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(divider.locator("hr")).toBeVisible();
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  await scratchpad.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("## A quotation in progress\n\n\n\nOutside");
  await scratchpad.getByRole("button", { name: "Write", exact: true }).click();
  await scratchpad.locator(".axiom-blank-paragraph").first().click();
  await page.keyboard.type(">");
  await expect(scratchpad.locator("blockquote")).toHaveCount(0);
  await page.keyboard.type(" ");
  await expect(
    scratchpad.locator("blockquote .axiom-source-prose"),
  ).toBeVisible();
  await page.keyboard.type("**Evidence** remains literal while writing.");
  await expect(scratchpad.locator("blockquote .axiom-source-prose")).toHaveText(
    "**Evidence** remains literal while writing.",
  );
  await capture(page, info, "editor-live-quote-body");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await (await page.request.get("/api/v1/me/preferences-bundle")).text(),
  ).toBe(before);
  expect(errors).toEqual([]);
});

test("settings split panes resize, preserve scratch work and cancel account drafts without saving", async ({
  page,
}, info) => {
  const before = await (
    await page.request.get("/api/v1/me/preferences-bundle")
  ).text();
  await page.goto("/workbench/settings/typography");
  const fields = page.getByLabel("Settings fields", { exact: true }),
    preview = page.getByLabel("Appearance settings preview", { exact: true }),
    separator = page.getByRole("separator", {
      name: "Resize settings and preview",
    });
  await expect(preview).toBeVisible();
  const left = (await fields.boundingBox())!,
    right = (await preview.boundingBox())!;
  expect(right.x).toBeGreaterThan(left.x + left.width);
  const top = right.y;
  await fields.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect((await preview.boundingBox())!.y).toBeCloseTo(top, 0);
  await expect(
    page.getByRole("button", { name: "Apply", exact: true }),
  ).toBeInViewport();
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "46");
  await page.keyboard.press("Enter");
  await expect(separator).toHaveAttribute("aria-valuenow", "44");
  await page.getByLabel("Note font size value", { exact: true }).fill("24");
  await page.getByLabel("Note font size value", { exact: true }).blur();
  await expect(preview.locator(".axiom-prose")).toHaveCSS("font-size", "24px");
  await capture(page, info, "settings-split-typography");
  await preview.getByRole("button", { name: "Source", exact: true }).click();
  await preview.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("# Private experiment\n\nThis is disposable.");
  await page.getByRole("button", { name: "Hide live preview" }).click();
  await expect(preview).not.toBeVisible();
  await page.getByRole("button", { name: "Show live preview" }).click();
  await expect(preview.locator(".cm-content")).toContainText(
    "Private experiment",
  );
  await preview.getByRole("button", { name: "Read", exact: true }).click();
  await expect(preview.locator("h1")).toHaveText("Private experiment");
  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("link", { name: "Theme", exact: true })
    .click();
  await expect(preview.locator("h1")).toHaveText("Private experiment");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await (await page.request.get("/api/v1/me/preferences-bundle")).text(),
  ).toBe(before);
  await page.goto("/workbench/settings/code");
  await expect(
    page.getByLabel("Code settings preview", { exact: true }),
  ).toBeVisible();
  await capture(page, info, "settings-split-code");
  await page.goto("/workbench/settings/shortcuts");
  await page
    .getByLabel("Search shortcuts", { exact: true })
    .fill("no-command-matches-this-query");
  await expect(
    page.getByRole("heading", { name: "No matching commands" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show all commands" }).click();
  await capture(page, info, "settings-shortcuts");
  const profile = await (await page.request.get("/api/v1/me/profile")).text();
  await page.goto("/workbench/settings/profile");
  await expect(
    page.getByRole("button", { name: "Save profile", exact: true }),
  ).toBeDisabled();
  const originalName = await page
    .getByLabel("Full name", { exact: true })
    .inputValue();
  await page
    .getByLabel("Full name", { exact: true })
    .fill("Disposable profile draft");
  await page
    .getByRole("button", { name: "Cancel changes", exact: true })
    .click();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    originalName,
  );
  await capture(page, info, "settings-profile");
  expect(await (await page.request.get("/api/v1/me/profile")).text()).toBe(
    profile,
  );
  const notifications = await (
    await page.request.get("/api/v1/me/notification-settings")
  ).text();
  await page.goto("/workbench/settings/notifications");
  await page.getByLabel("Mentions", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save preferences", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Cancel changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save preferences", exact: true }),
  ).toBeDisabled();
  await capture(page, info, "settings-notifications");
  expect(
    await (await page.request.get("/api/v1/me/notification-settings")).text(),
  ).toBe(notifications);
});

test("8080 keeps active prose literal and blank paragraphs visible in the disposable scratchpad", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workbench/settings/tables");
  const scratchpad = page.locator(".settings-scratchpad");
  await expect(scratchpad.locator('[data-engine="milkdown"]')).toBeVisible();
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  await scratchpad.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("\n\nOutside this paragraph");
  await scratchpad.getByRole("button", { name: "Write", exact: true }).click();
  const editor = page.getByTestId("settings-scratchpad");
  await editor.locator(".axiom-blank-paragraph").first().click();
  await page.keyboard.type("# A careful derivation");
  await expect(editor.locator(".axiom-source-prose")).toHaveText(
    "# A careful derivation",
  );
  const activeHeading = editor.locator("h1.axiom-source-prose");
  await expect(activeHeading).toHaveText("# A careful derivation");
  const activeTypography = await activeHeading.evaluate((element) => {
    const style = getComputedStyle(element);
    return [
      style.fontSize,
      style.fontFamily,
      style.fontWeight,
      style.lineHeight,
    ];
  });
  await capture(page, info, "editor-active-heading-source");
  await page.keyboard.press("Enter");
  await expect(editor.locator("h1")).toHaveText("A careful derivation");
  expect(
    await editor.locator("h1").evaluate((element) => {
      const style = getComputedStyle(element);
      return [
        style.fontSize,
        style.fontFamily,
        style.fontWeight,
        style.lineHeight,
      ];
    }),
  ).toEqual(activeTypography);
  await page.keyboard.type("- [ ] Verify each assumption");
  await expect(editor.locator(".axiom-source-prose")).toHaveText(
    "- [ ] Verify each assumption",
  );
  await capture(page, info, "editor-active-task-source");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("> Keep the argument reproducible.");
  await expect(editor.locator(".axiom-source-prose")).toHaveText(
    "Keep the argument reproducible.",
  );
  await editor
    .locator("p")
    .filter({ hasText: /^Outside this paragraph$/ })
    .click();
  await expect(editor.locator("blockquote")).toBeVisible();
  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(
    editor.locator(".axiom-block-handle, .axiom-block-drop-line"),
  ).toHaveCount(0);
  await capture(page, info, "editor-prose-rendered-on-departure");
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  await scratchpad.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await scratchpad.getByRole("button", { name: "Write", exact: true }).click();
  await editor.click();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Enter");
  await expect(editor.locator("p.axiom-blank-paragraph")).toHaveCount(4);
  await capture(page, info, "editor-visible-blank-paragraphs");
  expect(errors).toEqual([]);
});

test("8080 keeps context targets rendered and continues nested prose in its parent", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workbench/settings/tables");
  const scratchpad = page.locator(".settings-scratchpad");
  await expect(scratchpad.locator('[data-engine="milkdown"]')).toBeVisible();
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  await scratchpad.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    "Caret here\n\n## Rendered heading\n\n![Research figure](/figure.svg)\n\n> > Child result",
  );
  await page.keyboard.press("ControlOrMeta+Home");
  await scratchpad.getByRole("button", { name: "Write", exact: true }).click();
  const editor = page.getByTestId("settings-scratchpad");
  await editor
    .locator("p")
    .filter({ hasText: /^Caret here$/ })
    .click();
  await editor.locator("h2").click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Block actions" })).toBeVisible();
  await expect(editor.locator("h2")).toHaveText("Rendered heading");
  await capture(page, info, "editor-rendered-context-target");
  await page.keyboard.press("Escape");
  const image = editor.locator(".axiom-image");
  await image.click();
  await expect(image).toHaveClass(/axiom-image-edit-preview/);
  // Settings intentionally do not fetch image URLs; the real loaded-image
  // lifecycle is exercised separately with controlled laboratory fixtures.
  await expect(image).toHaveAttribute("data-image-state", "disabled");
  const imageSource = editor.locator(".axiom-image-source-text");
  await expect(imageSource).toHaveText("![Research figure](/figure.svg)");
  await expect(
    page.getByRole("dialog", { name: "Image source", exact: true }),
  ).toHaveCount(0);
  expect(
    await imageSource.evaluate((input) => ({
      outline: getComputedStyle(input).outlineStyle,
      radius: getComputedStyle(input).borderRadius,
    })),
  ).toEqual({ outline: "none", radius: "0px" });
  const sourceBox = (await imageSource.boundingBox())!;
  expect((await image.boundingBox())!.y).toBeGreaterThanOrEqual(
    sourceBox.y + sourceBox.height,
  );
  await capture(page, info, "editor-selected-image-preview");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");
  await expect(image).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(image).toBeVisible();
  await editor.locator("blockquote blockquote p").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Parent continuation");
  await expect(editor.locator("blockquote blockquote")).toHaveText(
    "Child result",
  );
  await expect(editor.locator("blockquote > .axiom-source-prose")).toHaveText(
    "Parent continuation",
  );
  await capture(page, info, "editor-nested-quote-parent");
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  expect(
    (await scratchpad.locator(".cm-line").allTextContents()).join("\n"),
  ).toContain("> > Child result\n>\n> Parent continuation");
  expect(errors).toEqual([]);
});

test("8080 previews formatted footnotes in light and dark themes without changing notes or preferences", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const preferences = async () =>
    digest(
      await (
        await page.request.get("/api/v1/me/preferences-bundle", {
          headers: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
        })
      ).text(),
    );
  const before = await preferences();
  await page.goto("/workbench/settings/theme");
  const scratchpad = page.locator(".settings-scratchpad");
  let source =
    "# Checking a derivation\n\nThis result includes an assumption[^assumption].\n\nContinue writing here.\n\n[^assumption]: **Small-velocity approximation.** Retain terms through \\(v^2/c^2\\).\n\n    \\[\n    E\\approx mc^2 + \\frac{1}{2}mv^2\n    \\]\n\n    - Check dimensions.\n    - Keep uncertainties explicit.\n\n    See the [original derivation](https://example.org).";
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  await scratchpad.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(source);
  await scratchpad.getByRole("button", { name: "Write", exact: true }).click();
  await scratchpad.locator(".axiom-footnote-title").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Continuation stays inside this footnote.");
  source += "\n    \n    Continuation stays inside this footnote.";
  const ref = scratchpad.locator("[data-footnote-key]").first();
  const tooltip = page.locator(".footnote-tooltip");
  const caret = () =>
    page.evaluate(() => {
      const selection = document.getSelection();
      return {
        text: selection?.anchorNode?.textContent,
        offset: selection?.anchorOffset,
      };
    });
  for (const [theme, name] of [
    ["Paper Ink", "light"],
    ["Night Paper", "dark"],
  ]) {
    await page
      .getByRole("button", { name: "Use " + theme + " theme", exact: true })
      .click();
    await scratchpad
      .locator("p")
      .filter({ hasText: /^Continue writing here\.$/ })
      .click();
    const selected = await caret();
    await ref.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator("strong")).toHaveText(
      "Small-velocity approximation.",
    );
    await expect(tooltip).toContainText(
      "Continuation stays inside this footnote.",
    );
    await expect(tooltip.locator('[data-math-state="ready"]')).toHaveCount(2);
    await expect(tooltip.locator(".math-inline svg").first()).toBeVisible();
    await expect(tooltip.locator(".math-block svg").first()).toBeVisible();
    expect(await caret()).toEqual(selected);
    await expect(
      tooltip.locator("a, [data-footnote-key], [tabindex]"),
    ).toHaveCount(0);
    await capture(page, info, "editor-footnote-tooltip-" + name);
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
  }
  await scratchpad.getByRole("button", { name: "Read", exact: true }).click();
  await ref.focus();
  await expect(tooltip).toBeVisible();
  await expect(tooltip.locator('[data-math-state="ready"]')).toHaveCount(2);
  await capture(page, info, "editor-footnote-tooltip-reading");
  await page.keyboard.press("Escape");
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  expect(await scratchpad.locator(".cm-line").allTextContents()).toEqual(
    source.split("\n"),
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await preferences()).toBe(before);
  expect(errors).toEqual([]);
});

test("8080 authors a titled rich footnote with equations in the disposable scratchpad", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const preferences = async () =>
    digest(
      await (
        await page.request.get("/api/v1/me/preferences-bundle", {
          headers: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
        })
      ).text(),
    );
  const before = await preferences();
  await page.goto("/workbench/settings/theme");
  const scratchpad = page.locator(".settings-scratchpad");
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  await scratchpad.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("Measurements[^uncertainty].\n\n");
  await scratchpad.getByRole("button", { name: "Write", exact: true }).click();
  await scratchpad.locator(".axiom-prose").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("[^uncertainty]:");
  await expect(
    scratchpad.locator('[data-source-kind="footnoteHeader"]'),
  ).toHaveText("[^uncertainty]:");
  await page.keyboard.press("Enter");
  const footnote = scratchpad.locator(
    '.axiom-footnote[data-footnote-definition="uncertainty"]',
  );
  await expect(footnote.locator(".axiom-footnote-title")).toHaveText(
    "[^uncertainty]",
  );
  await page.keyboard.type("Independent measurements combine in quadrature.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("$$");
  await page.keyboard.press("Enter");
  await expect(footnote.locator(".axiom-embedded .cm-content")).toBeFocused();
  await page.keyboard.insertText("\\sigma^2 = \\sum_i \\sigma_i^2");
  await capture(page, info, "editor-footnote-rich-math");
  await page.keyboard.press("Escape");
  await page.keyboard.type("Report units and assumptions with the result.");
  await expect(
    footnote.locator(".axiom-footnote-body > .axiom-source-prose"),
  ).toHaveText("Report units and assumptions with the result.");
  for (const [theme, name] of [
    ["Paper Ink", "light"],
    ["Night Paper", "dark"],
  ]) {
    await page
      .getByRole("button", { name: "Use " + theme + " theme", exact: true })
      .click();
    await footnote.locator(".axiom-footnote-title").click();
    await expect(footnote.locator('[data-math-state="ready"]')).toHaveCount(1);
    await capture(page, info, "editor-footnote-rich-" + name);
  }
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  const source = (await scratchpad.locator(".cm-line").allTextContents()).join(
    "\n",
  );
  expect(source.match(/\[\^uncertainty\]:/g)).toHaveLength(1);
  expect(source).toContain(
    "[^uncertainty]:\n    Independent measurements combine in quadrature.",
  );
  expect(source).toContain(
    "    $$\n    \\sigma^2 = \\sum_i \\sigma_i^2\n    $$",
  );
  expect(source).toContain("    Report units and assumptions with the result.");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await preferences()).toBe(before);
  expect(errors).toEqual([]);
});

test("8080 supports TeX delimiters and rendered task toggles in the disposable scratchpad", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workbench/settings/math");
  const scratchpad = page.locator(".settings-scratchpad");
  await expect(scratchpad.locator('[data-engine="milkdown"]')).toBeVisible();
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  await scratchpad.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  const source =
    "# TeX delimiter compatibility\n\nInline \\(p=mv\\) and \\(E_k=\\frac{1}{2}mv^2\\).\n\n> \\[\n> E=mc^2\\label{energy}\n> \\]\n\n- [ ] **Check units**\n- [x] \\(\\frac{a}{b}\\) _Verify assumptions_\n\nContinue here.";
  await page.keyboard.insertText(source);
  await scratchpad.getByRole("button", { name: "Write", exact: true }).click();
  await scratchpad
    .locator("p")
    .filter({ hasText: /^Continue here\.$/ })
    .click();
  await expect(scratchpad.locator(".math-inline")).toHaveCount(3);
  const block = scratchpad.locator('.axiom-embedded[data-kind="mathBlock"]');
  await expect(block).toHaveCount(1);
  await expect(block.locator('[data-math-state="ready"] svg')).toBeVisible();
  for (const inline of await scratchpad.locator(".math-inline").all()) {
    await expect(inline.locator('[data-math-state="ready"]')).toBeVisible();
    // MathJax may split inline output into multiple SVG fragments at operators.
    await expect(
      inline.locator('[data-math-state="ready"] svg').first(),
    ).toBeVisible();
  }
  const caret = () =>
    page.evaluate(() => {
      const selection = document.getSelection();
      return {
        text: selection?.anchorNode?.textContent,
        offset: selection?.anchorOffset,
      };
    });
  const before = await caret();
  const checkbox = scratchpad.getByRole("checkbox").first();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  expect(await caret()).toEqual(before);
  await expect(
    scratchpad.locator(".axiom-task .axiom-source-prose"),
  ).toHaveCount(0);
  await expect(scratchpad.locator(".axiom-task strong")).toHaveText(
    "Check units",
  );
  for (const task of await scratchpad.getByRole("checkbox").all()) {
    const alignment = await task.evaluate(measureTaskLayout);
    expect(Math.abs(alignment.offset), alignment.text ?? "task").toBeLessThan(
      0.75,
    );
    expect(alignment.layout).toBe("grid");
    expect(alignment.margin).toBe("0px");
    expect(alignment.gap).toBeCloseTo(alignment.textSize * 0.65, 1);
    expect(alignment.hitSize).toBeGreaterThanOrEqual(24);
  }
  await capture(page, info, "editor-tex-delimiters-tasks");
  await block
    .getByRole("button", { name: "Edit display equation", exact: true })
    .click();
  const input = block.locator(".cm-content");
  await expect(input).toBeFocused();
  await input.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("\\text{for }m>0");
  await expect(input).not.toContainText("> \\text");
  await expect(block.locator('[data-math-state="ready"] svg')).toBeVisible();
  await capture(page, info, "editor-bracket-equation-editing");
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  expect(await scratchpad.locator(".cm-line").allTextContents()).toEqual(
    source
      .replace("[ ]", "[x]")
      .replace("\\label{energy}\n", "\\label{energy}\n> \\text{for }m>0\n")
      .split("\n"),
  );
  expect(errors).toEqual([]);
});

test("8080 renders and edits equations inside quotes in the disposable scratchpad", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/workbench/settings/math");
  const scratchpad = page.locator(".settings-scratchpad");
  await expect(scratchpad.locator('[data-engine="milkdown"]')).toBeVisible();
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  await scratchpad.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  const source =
    "# Quoted derivations\n\n> [!THEOREM] Relativistic energy\n> Within an inertial frame,\n> $$\n> E^2 = p^2 c^2 + m^2 c^4\\label{dispersion}\n> $$\n> The rest state gives $E=mc^2$.\n>\n> > In the nonrelativistic limit,\n> > $$\n> > K \\approx \\frac{p^2}{2m}\n> > $$\n\nContinue the discussion outside the quote.";
  await page.keyboard.insertText(source);
  await scratchpad.getByRole("button", { name: "Write", exact: true }).click();
  const blocks = scratchpad.locator('.axiom-embedded[data-kind="mathBlock"]');
  await expect(blocks).toHaveCount(2);
  await scratchpad.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  for (const block of await blocks.all()) {
    await block.scrollIntoViewIfNeeded();
    await expect(block.locator('[data-math-state="ready"] svg')).toBeVisible();
  }
  await capture(page, info, "editor-quoted-equations-rendered");
  await blocks
    .first()
    .getByRole("button", { name: "Edit display equation", exact: true })
    .click();
  const tex = blocks.first().locator(".cm-content");
  await expect(tex).toBeFocused();
  await tex.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("\\text{with } m > 0");
  await expect(tex).toContainText("\\text{with } m > 0");
  await expect(tex).not.toContainText("> \\text");
  await expect(
    blocks.first().locator('[data-math-state="ready"] svg'),
  ).toBeVisible();
  await capture(page, info, "editor-quoted-equation-editing");
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.type("Units remain explicit throughout.");
  await expect(
    scratchpad.locator(".axiom-callout .axiom-source-prose"),
  ).toContainText("Units remain explicit throughout.");
  await scratchpad.getByRole("button", { name: "Source", exact: true }).click();
  await expect(scratchpad.locator(".cm-content")).toContainText(
    "> \\text{with } m > 0",
  );
  await expect(scratchpad.locator(".cm-content")).toContainText(
    "> Units remain explicit throughout.",
  );
  await capture(page, info, "editor-quoted-equations-source");
  expect(errors).toEqual([]);
});
