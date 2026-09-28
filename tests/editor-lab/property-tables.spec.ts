import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import type { Preferences } from "../../packages/shared/src/appearance";
import {
  expectSheetBlock,
  expectSheetField,
  sheetSpecimen,
} from "../helpers/editor-sheet";

const specimen = readFileSync("docs/theme-fixtures/research.md", "utf8");
const failures = new WeakMap<Page, string[]>();
const pane = (page: Page) => page.locator('[data-pane="0"]');
const metadata = (page: Page) => pane(page).locator(".axiom-metadata");
const definition = (page: Page) =>
  pane(page).locator(".axiom-link-definition").first();

async function appearance(
  page: Page,
  values: Partial<Preferences>,
  dark = false,
) {
  await page.emulateMedia({
    colorScheme: dark ? "dark" : "light",
    reducedMotion: "reduce",
  });
  await page.evaluate(
    async ({ values, dark }) => {
      const modulePath = "/packages/shared/src/appearance.ts";
      const { defaults, appearanceVariables } = await import(modulePath);
      const preferences = { ...defaults, ...values, motion: "reduced" };
      const root = document.documentElement;
      for (const [key, value] of Object.entries(
        appearanceVariables(preferences, dark),
      ))
        root.style.setProperty(key, String(value));
      root.dataset.theme = dark ? "dark" : "light";
      root.style.colorScheme = root.dataset.theme;
      root.dataset.themePack = preferences.themePack;
      root.dataset.interfaceStyle = preferences.interfaceStyle;
      root.dataset.documentDecorations = preferences.documentDecorations;
      root.dataset.motion = "reduced";
      window.editorLab.appearance(0, preferences);
      window.editorLab.appearance(1, preferences);
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
    },
    { values, dark },
  );
}

test.beforeEach(async ({ page }) => {
  failures.set(page, []);
  page.on("pageerror", (error) => failures.get(page)!.push(error.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
  await page.evaluate((source) => window.editorLab.reset(source), specimen);
  await page.evaluate(() =>
    document.getElementById("editors")!.classList.add("ws-app"),
  );
});
test.afterEach(({ page }) => {
  expect(failures.get(page)).toEqual([]);
});

test("code and equation hover borders are wider without reflow or source reveal", async ({
  page,
}, info) => {
  const source = "Before\n\n```python\nx = 1\n```\n\n$$\nE = mc^2\n$$\n\nAfter";
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
    window.editorLab.focus(0, 3);
  }, source);
  for (const dark of [false, true]) {
    await appearance(page, { themePack: "paper-research" }, dark);
    for (const kind of ["codeBlock", "mathBlock"]) {
      const block = pane(page).locator(`.axiom-embedded[data-kind="${kind}"]`);
      await page.locator("body > header").click();
      await block.scrollIntoViewIfNeeded();
      const before = await block.boundingBox();
      const snapshot = await page.evaluate(() => window.editorLab.snapshot());
      await expect(block).toHaveCSS("outline-style", "none");
      await block.hover();
      await expect(block).toHaveCSS("outline-style", "solid");
      await expect(block).toHaveCSS("outline-width", "2px");
      await expect(block).toHaveCSS("outline-offset", "-2px");
      await expect(block).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      expect(await block.boundingBox()).toEqual(before);
      expect(await page.evaluate(() => window.editorLab.snapshot())).toEqual(
        snapshot,
      );
      if (kind === "mathBlock") {
        await expect(block).not.toHaveClass(/is-editing/);
        await expect(block.locator(".axiom-block-source")).toBeHidden();
      }
      if (info.project.name === "chromium")
        await page.screenshot({
          path: info.outputPath(`${kind}-${dark ? "dark" : "light"}-hover.png`),
        });
      await page.mouse.move(0, 0);
      await expect(block).toHaveCSS("outline-style", "none");
      const focusTarget =
        kind === "codeBlock"
          ? block.locator(".cm-content")
          : block.getByRole("button", {
              name: "Copy block contents",
              exact: true,
            });
      await focusTarget.focus();
      await expect(block).toHaveCSS("outline-width", "2px");
      // Equation focus may reveal its TeX editor; the hover-only state above
      // must not. The outline itself never adds border width or padding.
      await expect(block).toHaveCSS("border-width", "0px");
      if (kind === "codeBlock")
        expect(await block.boundingBox()).toEqual(before);
      expect(
        await block.evaluate((element) => {
          const probe = document.createElement("span");
          probe.style.color = "var(--focus)";
          document.body.append(probe);
          const matches =
            getComputedStyle(element).outlineColor ===
            getComputedStyle(probe).color;
          probe.remove();
          return matches;
        }),
      ).toBe(true);
    }
  }
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.locator("body > header").click();
  const code = pane(page).locator('.axiom-embedded[data-kind="codeBlock"]');
  await code.hover();
  await expect(code).toHaveCSS("outline-style", "solid");
  await expect(code).toHaveCSS("outline-width", "2px");
  await expect(code).not.toHaveCSS("outline-color", "rgba(0, 0, 0, 0)");
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([source, source]);
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
});

for (const pack of ["default", "paper-research", "technical-slate"] as const)
  for (const style of ["axiom", "material", "fluent", "editorial"] as const)
    for (const dark of [false, true]) {
      test(`property tables share paper geometry · ${pack} · ${style} · ${dark ? "dark" : "light"}`, async ({
        page,
      }, info) => {
        await appearance(
          page,
          { themePack: pack, interfaceStyle: style },
          dark,
        );
        const dimensions = await pane(page)
          .locator(".editor-properties")
          .evaluateAll((tables) =>
            tables.map((element) => {
              const table = element.querySelector("table")!;
              const th = table.querySelector("th")!;
              const td = table.querySelector("td")!;
              const input = td.querySelector("input, textarea")!;
              const css = getComputedStyle(element),
                field = getComputedStyle(input);
              const box = table.getBoundingClientRect(),
                key = th.getBoundingClientRect();
              return {
                width: box.width,
                keyWidth: key.width,
                fieldWidth: input.getBoundingClientRect().width,
                valueWidth: td.getBoundingClientRect().width,
                font: field.fontFamily,
                size: field.fontSize,
                line: field.lineHeight,
                padding: field.padding,
                border: field.borderWidth,
                radius: css.borderRadius,
                shadow: css.boxShadow,
                fieldRadius: field.borderRadius,
                verticalRules: [
                  getComputedStyle(th).borderInlineStartWidth,
                  getComputedStyle(td).borderInlineEndWidth,
                ],
                overflow: element.scrollWidth > element.clientWidth + 1,
              };
            }),
          );
        expect(dimensions).toHaveLength(3);
        for (const value of dimensions) {
          expect(value).toEqual(dimensions[0]);
          expect(value).toMatchObject({
            border: "0px",
            radius: "0px",
            shadow: "none",
            fieldRadius: "0px",
            verticalRules: ["0px", "0px"],
            overflow: false,
          });
          expect(value.keyWidth / value.width).toBeCloseTo(0.28, 2);
          expect(value.fieldWidth).toBeCloseTo(value.valueWidth, 0);
        }
        const tableText = await pane(page)
          .locator(".axiom-table-shell td")
          .first()
          .evaluate((cell) => {
            const css = getComputedStyle(cell);
            return {
              font: css.fontFamily,
              size: css.fontSize,
              line: css.lineHeight,
              padding: css.padding,
            };
          });
        expect(dimensions[0]).toMatchObject(tableText);
        const fields = pane(page).locator(".editor-property-input");
        for (const field of await fields.all()) await expectSheetField(field);
        await definition(page).scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        const actions = definition(page).locator(".editor-properties-actions");
        await expect(actions).toHaveCSS("opacity", "0");
        const before = await definition(page).boundingBox();
        await definition(page).hover();
        await expect(actions).toHaveCSS("opacity", "1");
        expect(await definition(page).boundingBox()).toEqual(before);
        // Keyboard focus reveals controls even with the pointer outside the block.
        await page.mouse.move(0, 0);
        const url = definition(page).getByLabel("Destination", { exact: true });
        await url.focus();
        await expect(actions).toHaveCSS("opacity", "1");
        await expectSheetField(url);
        await expect(url.locator("..")).toHaveCSS("outline-style", "solid");
        await expect(url.locator("..")).toHaveCSS("outline-width", "2px");
        const title = definition(page).getByLabel("Title", { exact: true });
        await title.hover();
        await expectSheetField(title);
        await title.focus();
        await expectSheetField(title);
        const code = pane(page)
          .locator('.axiom-embedded[data-kind="codeBlock"]')
          .first();
        await code.locator(".cm-content").focus();
        await expectSheetBlock(code);
        const math = pane(page)
          .locator('.axiom-embedded[data-kind="mathBlock"]')
          .last();
        await math
          .getByRole("button", { name: "Edit display equation", exact: true })
          .click();
        await expectSheetBlock(math);
        await url.focus();
        await page.keyboard.press("Escape");
        expect(
          await page.evaluate(() =>
            window.editorLab.snapshot().map((s) => s.source),
          ),
        ).toEqual([specimen, specimen]);
        expect(await page.evaluate(() => window.editorLab.recovery())).toEqual(
          [],
        );
        if (style === "axiom" && info.project.name === "chromium") {
          await metadata(page).scrollIntoViewIfNeeded();
          await page.mouse.move(0, 0);
          await page.screenshot({
            path: info.outputPath("property-tables.png"),
            animations: "disabled",
          });
        }
      });
    }

for (const scale of [0.8, 1.5]) {
  test(`fields wrap and preserve independent typography at UI scale ${scale}`, async ({
    page,
  }, info) => {
    const source =
      '---\ntitle: An unusually long title that must remain editable without changing the paper width\nauthor: Ada\n---\n\n[ref]: https://example.org/very-long-path-for-an-experiment "First line\n  Second line with a much longer explanation of the research results and their limitations."\n\nAfter\n';
    await page.evaluate((source) => window.editorLab.reset(source), source);
    await page.setViewportSize({ width: 1280, height: 1100 });
    await appearance(page, {
      uiFont: "inter",
      proseFont: "latinModern",
      uiSize: 22,
      uiScale: scale,
      proseSize: 30,
      codeSize: 24,
      radius: 0,
      shadows: "none",
      interfaceStyle: "material",
      lightPreset: "lightContrast",
    });
    const title = definition(page).getByLabel("Title", { exact: true });
    await expect(title).toHaveValue(/First line\n/);
    const metrics = await title.evaluate((element) => {
      const style = getComputedStyle(element),
        prose = getComputedStyle(element.closest(".axiom-prose")!);
      return {
        font: style.fontFamily,
        prose: prose.fontFamily,
        size: parseFloat(style.fontSize),
        height: element.clientHeight,
        scroll: element.scrollHeight,
        maximum: parseFloat(style.maxHeight),
        overflow: style.overflowY,
        width: element.clientWidth,
        parentWidth: element.parentElement!.clientWidth,
      };
    });
    expect(metrics.font).toContain("Latin Modern");
    expect(metrics.prose).toContain("Latin Modern");
    expect(metrics.size).toBeCloseTo(30 * 0.95, 1);
    // A multiline title grows to its content, then scrolls inside its bounded
    // cell at extreme font sizes instead of making the whole page overflow.
    expect(metrics.height).toBeCloseTo(
      Math.min(metrics.scroll, metrics.maximum),
      0,
    );
    expect(metrics.overflow).toBe("auto");
    expect(metrics.width).toBeLessThanOrEqual(metrics.parentWidth);
    await definition(page).hover();
    const open = definition(page).getByRole("button", {
      name: "Open destination",
      exact: true,
    });
    await expect(open).toHaveCSS("border-radius", "0px");
    await title.fill("Temporary title");
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(() =>
        window.editorLab.snapshot().map((s) => s.source),
      ),
    ).toEqual([source, source]);
    await metadata(page).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("scaled-fields.png"),
      animations: "disabled",
    });
  });
}

test("metadata errors are inline, cancellable and never replace the field", async ({
  page,
}) => {
  const key = metadata(page).getByLabel("Property name: title", {
    exact: true,
  });
  const identity = await key.elementHandle();
  await key.fill("author");
  await page.keyboard.press("Enter");
  await expect(key).toHaveAttribute("aria-invalid", "true");
  await expectSheetField(key);
  await expect(key.locator("..")).toHaveCSS("outline-style", "dashed");
  await expect(metadata(page).getByRole("status")).toBeVisible();
  expect(
    await identity!.evaluate((element) => element === document.activeElement),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(key).toHaveValue("title");
  await expect(key).not.toHaveAttribute("aria-invalid", "true");
  expect(await page.evaluate(() => window.editorLab.snapshot()[0].source)).toBe(
    specimen,
  );
});

test("read-only and reading views use the same flat table and retain structured YAML", async ({
  page,
}) => {
  await appearance(page, { themePack: "technical-slate" }, true);
  await page.evaluate(async () => {
    window.editorLab.readOnly(0, true);
    await window.editorLab.mode(1, "read");
  });
  const reading = page.locator('[data-pane="1"] .document-metadata');
  await expect(
    reading.getByRole("table", { name: "Document metadata" }),
  ).toBeVisible();
  await expect(
    metadata(page).getByRole("button", { name: "Add metadata property" }),
  ).toBeHidden();
  await expect(metadata(page).getByLabel("Value for title")).toHaveAttribute(
    "readonly",
    "",
  );
  await metadata(page).getByLabel("Value for title").hover();
  await expectSheetField(metadata(page).getByLabel("Value for title"));
  await expect(metadata(page).locator("pre")).toContainText("reproducibility");
  await expect(reading.locator("pre")).toContainText("reproducibility");
  const readingCode = page.locator('[data-pane="1"] pre code').first();
  await expect(readingCode).toBeVisible();
  await expect(readingCode).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(readingCode.locator("..")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(
    page.locator('[data-pane="1"] .axiom-link-definition'),
  ).toHaveCount(0);
  const sizes = await page
    .locator(".axiom-metadata table, .document-metadata table")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return [
          style.borderRadius,
          style.fontSize,
          style.fontFamily,
          style.backgroundColor,
        ];
      }),
    );
  expect(sizes[0]).toEqual(sizes[1]);
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([specimen, specimen]);
});

test("forced colors keeps a visible property-field focus indicator", async ({
  page,
}, info) => {
  test.skip(
    info.project.name === "webkit",
    "WebKit does not emulate forced-colors.",
  );
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  const input = metadata(page).getByLabel("Value for title");
  await input.focus();
  await expect(input.locator("..")).toHaveCSS("outline-style", "solid");
  await expect(input.locator("..")).toHaveCSS("outline-width", "2px");
});

test("editor field dialogs share control typography, shape and surface", async ({
  page,
}, info) => {
  await appearance(page, { uiScale: 1.5, radius: 0, shadows: "none" }, true);
  await page.evaluate(async () => {
    const modulePath = "/apps/web/lib/editor-vnext/fields.ts";
    const { sourceFields } = await import(modulePath);
    sourceFields({
      title: "Figure details",
      fields: [
        { key: "label", label: "Label", value: "Experiment A" },
        {
          key: "placement",
          label: "Placement",
          value: "center",
          options: ["left", "center", "right"],
        },
        {
          key: "caption",
          label: "Caption",
          value: "A reproducible comparison.",
          multiline: true,
        },
      ],
      apply: () => {},
      recover: () => {},
      restore: () => {},
    });
  });
  const dialog = page.getByRole("dialog", { name: "Figure details" });
  await expect(dialog).toHaveCSS("border-radius", "0px");
  await expect(dialog).toHaveCSS("box-shadow", "none");
  const controls = await dialog
    .locator("input, select, textarea")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const css = getComputedStyle(element);
        return [
          css.fontFamily,
          css.fontSize,
          css.color,
          css.backgroundColor,
          css.borderWidth,
          css.borderRadius,
          css.paddingBlock,
          css.paddingInlineStart,
        ];
      }),
    );
  expect(controls).toHaveLength(3);
  expect(controls[0]).toEqual(controls[1]);
  expect(controls[0]).toEqual(controls[2]);
  await expect(dialog.getByLabel("Label", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Placement")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Caption")).toBeFocused();
  for (const interfaceStyle of [
    "axiom",
    "material",
    "fluent",
    "editorial",
  ] as const) {
    await appearance(
      page,
      { uiScale: 1.5, radius: 0, shadows: "none", interfaceStyle },
      true,
    );
    await expect(dialog).toHaveCSS("border-radius", "0px");
    await expect(dialog).toHaveCSS("box-shadow", "none");
    await expect(dialog.getByLabel("Caption")).toBeFocused();
  }
  await page.screenshot({
    path: info.outputPath("field-dialog.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([specimen, specimen]);
});

test("custom paper and tinted canvas remain continuous through edit states without flattening app forms", async ({
  page,
}, info) => {
  await page.evaluate(
    (source) => window.editorLab.reset(source),
    sheetSpecimen,
  );
  await appearance(page, {
    interfaceStyle: "material",
    radius: 24,
    lightColors: {
      paper: "#fff9ed",
      surface: "#d0ffe4",
      code: "#3a204e",
      codeText: "#ffffff",
    },
  });
  const url = definition(page).getByLabel("Destination", { exact: true });
  const before = await url.boundingBox();
  for (const state of ["idle", "hover", "focus"] as const) {
    if (state === "hover") await url.hover();
    if (state === "focus") await url.focus();
    await expectSheetField(url);
    expect(await url.boundingBox()).toEqual(before);
  }
  const code = pane(page).locator('.axiom-embedded[data-kind="codeBlock"]');
  await code.locator(".cm-content").focus();
  await expectSheetBlock(code);
  await code.getByRole("button", { name: "Change code language" }).click();
  const language = code.getByLabel("Code language", { exact: true });
  await expectSheetField(language);
  await language.hover();
  await expectSheetField(language);
  await language.fill("py");
  await expect(
    page.getByRole("option", { name: /Python/i }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  // Escape may dismiss suggestions first; then dismiss the unchanged draft.
  if (await language.count()) await page.keyboard.press("Escape");
  await expect(language).toHaveCount(0);
  const math = pane(page).locator('.axiom-embedded[data-kind="mathBlock"]');
  await math
    .getByRole("button", { name: "Edit display equation", exact: true })
    .click();
  await expectSheetBlock(math);
  await expect(code.locator(".axiom-block-source")).toHaveCSS(
    "color",
    await code.evaluate((e) => getComputedStyle(e).color),
  );
  await pane(page).evaluate((host) => {
    host.classList.add("canvas-card-editor");
    host.style.backgroundColor = "rgb(242, 225, 200)";
  });
  await expect(pane(page).locator(".axiom-editor")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expectSheetBlock(code);
  await expectSheetBlock(math);
  await url.focus();
  await expectSheetField(url);
  const surfaces = await url.evaluate((element) => {
    const fills = [];
    for (
      let node: Element | null = element;
      node && !node.classList.contains("canvas-card-editor");
      node = node.parentElement
    )
      fills.push(getComputedStyle(node).backgroundColor);
    return fills;
  });
  expect(surfaces.every((color) => color === "rgba(0, 0, 0, 0)")).toBe(true);
  await page.screenshot({
    path: info.outputPath("single-sheet-tinted-canvas.png"),
    animations: "disabled",
  });
  // An ordinary application form must keep its filled, rounded control style.
  await page.evaluate(() => {
    const field = document.createElement("input");
    field.id = "application-form-probe";
    field.setAttribute("aria-label", "Application form probe");
    document.getElementById("editors")!.append(field);
  });
  const form = page.locator("#application-form-probe");
  await expect(form).toHaveCSS("background-color", "rgb(208, 255, 228)");
  await expect(form).not.toHaveCSS("border-radius", "0px");
  await form.focus();
  await expect(form).not.toHaveCSS("box-shadow", "none");
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([sheetSpecimen, sheetSpecimen]);
});
