import { test, expect, type Page, type Locator } from "@playwright/test";
import { interfaceStyles } from "../../packages/shared/src/interface-styles";
import { paperAppearance } from "../../apps/showcase/src/samples";

const errors = new WeakMap<Page, string[]>(),
  outbound = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, baseURL }) => {
  errors.set(page, []);
  outbound.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (
      /^https?:/.test(url) &&
      (!url.startsWith(new URL(baseURL!).origin) ||
        /\/api\/|\/sync(?:\b|\/)/.test(url))
    )
      outbound.get(page)!.push(url);
  });
  page.on("websocket", (socket) => outbound.get(page)!.push(socket.url()));
  await page.goto("./", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Axiom Clear/ })
    .click();
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(outbound.get(page)).toEqual([]);
});

async function specimen(page: Page) {
  await page
    .getByRole("group", { name: "Preview surface" })
    .getByRole("button", { name: "Interface", exact: true })
    .click();
  return page.getByRole("region", { name: "Theme workbench" });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  for (const selector of [
    ".demo-settings-fields",
    ".demo-settings-preview-scroll:not([hidden])",
  ])
    expect(
      await page
        .locator(selector)
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      selector,
    ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Done", exact: true }),
  ).toBeInViewport();
}

async function iconFieldsAlign(page: Page) {
  const rows = await page
    .locator(".ui-input-group:visible")
    .evaluateAll((groups) =>
      groups.map((group) => {
        const input = group.querySelector<HTMLInputElement>("input.ui-input")!,
          box = group.getBoundingClientRect(),
          icon = group
            .querySelector(".ui-input-leading > svg")
            ?.getBoundingClientRect(),
          style = getComputedStyle(input);
        return {
          background: style.backgroundColor,
          border: style.borderWidth,
          iconOffset: icon
            ? Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2)
            : 0,
          inputWidth: input.getBoundingClientRect().width,
          overflow: group.scrollWidth > group.clientWidth + 1,
        };
      }),
    );
  for (const row of rows) {
    expect(row.background).toBe("rgba(0, 0, 0, 0)");
    expect(row.border).toBe("0px");
    expect(row.iconOffset).toBeLessThan(1);
    expect(row.inputWidth).toBeGreaterThan(80);
    expect(row.overflow).toBe(false);
  }
}

async function mixedToolbarsAlign(page: Page) {
  const scrollport = page.locator(".demo-settings-preview-scroll:visible"),
    scroll = await scrollport.evaluate((el) => ({
      top: el.scrollTop,
      left: el.scrollLeft,
    }));
  const query = page.getByRole("searchbox", {
      name: "standard toolbar query",
      exact: true,
    }),
    previous = await query.inputValue();
  await query.fill("Alignment specimen");
  await expect(
    page.getByRole("button", {
      name: "Clear standard toolbar query",
      exact: true,
    }),
  ).toBeVisible();
  const sizes = await page
    .locator(".theme-workbench-toolbars .ui-actions:visible")
    .evaluateAll((groups) => {
      // --size-ui may be authored in rem. The body's semantic UI font resolves
      // user preferences to pixels without treating a raw rem value as pixels.
      const uiSize = parseFloat(getComputedStyle(document.body).fontSize);
      return groups.map((group) => {
        const controls = [...group.children].map((el) => {
          const box = el.getBoundingClientRect();
          return {
            top: box.top,
            left: box.left,
            right: box.right,
            height: box.height,
          };
        });
        const search = group.querySelector(".ui-search-field")!,
          clear = search.querySelector(".ui-search-clear-slot .icon-button")!,
          shell = search.getBoundingClientRect(),
          action = clear.getBoundingClientRect();
        return {
          expected:
            group.getAttribute("data-control-group-size") === "compact"
              ? Math.max(28, uiSize * 2.133)
              : Math.max(32, uiSize * 2.4),
          controls,
          clearContained:
            action.top >= shell.top &&
            action.bottom <= shell.bottom &&
            action.left >= shell.left &&
            action.right <= shell.right,
          clearOffset: Math.abs(
            action.top + action.height / 2 - shell.top - shell.height / 2,
          ),
          overflow: group.scrollWidth > group.clientWidth + 1,
        };
      });
    });
  await query.fill(previous);
  await scrollport.evaluate((el, scroll) => {
    el.scrollTop = scroll.top;
    el.scrollLeft = scroll.left;
  }, scroll);
  expect(sizes).toHaveLength(2);
  for (const group of sizes) {
    expect(group.controls).toHaveLength(4);
    for (const box of group.controls) {
      expect(Math.abs(box.height - group.expected)).toBeLessThan(1);
      for (const other of group.controls)
        if (box !== other && Math.abs(box.top - other.top) < group.expected / 2)
          expect(box.right <= other.left || other.right <= box.left).toBe(true);
    }
    expect(group.overflow).toBe(false);
    expect(group.clearContained).toBe(true);
    expect(group.clearOffset).toBeLessThan(1);
  }
}

async function fieldBoundsInScrollport(field: Locator) {
  return field.evaluate((el) => {
    const owner = el.closest(".demo-settings-preview-scroll")!;
    const box = el.getBoundingClientRect(),
      frame = owner.getBoundingClientRect();
    // Native focus/Playwright pointer reveal may scroll this owned panel by a
    // few pixels. Its content coordinates must not change when Clear appears
    // or disappears; the panel frame and whole page must remain stationary.
    // Firefox serializes independent rectangles at slightly different floating
    // precision after scrolling (~0.000015px). Snap below every engine's layout
    // quantum, not a visible-pixel tolerance or allowance for control movement.
    const precise = (value: number) => Math.round(value * 1024) / 1024;
    return {
      x: precise(box.x - frame.x + owner.scrollLeft),
      y: precise(box.y - frame.y + owner.scrollTop),
      width: precise(box.width),
      height: precise(box.height),
      owner: {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
      },
      pageScroll: { x: window.scrollX, y: window.scrollY },
    };
  });
}

for (const { id, name } of interfaceStyles) {
  for (const mode of ["light", "dark"] as const) {
    test(`${name} / ${mode}: real native controls, states and inherited dialog styling`, async ({
      page,
    }, info) => {
      const settings = page.getByRole("dialog", {
        name: "Appearance & editor",
      });
      await settings.getByRole("radio", { name, exact: true }).check();
      await settings.getByRole("button", { name: mode, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-interface-style",
        id,
      );
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      const view = await specimen(page);
      await iconFieldsAlign(page);
      await mixedToolbarsAlign(page);
      const search = view.getByRole("searchbox", { name: "Specimen search" }),
        before = await fieldBoundsInScrollport(search);
      await search.fill("Physics");
      const withClear = await fieldBoundsInScrollport(search);
      expect(withClear).toEqual(before);
      await view.getByRole("button", { name: "Clear specimen search" }).click();
      await expect(search).toHaveValue("");
      await expect(search).toBeFocused();
      expect(await fieldBoundsInScrollport(search)).toEqual(before);
      const person = view.getByRole("combobox", { name: "Specimen person" });
      await person.fill("Noether");
      await expect(
        view.getByRole("option", { name: /Emmy Noether/ }),
      ).toBeVisible();
      await person.press("Enter");
      await expect(person).toHaveValue("Emmy Noether");
      const topics = view.getByRole("combobox", { name: "Specimen topics" });
      await topics.fill("Physics");
      await topics.press("Enter");
      await expect(
        view.getByRole("button", { name: "Remove Physics" }),
      ).toBeVisible();
      await topics.press("Escape");
      await expect(
        page.getByRole("dialog", { name: "Appearance & editor" }),
      ).toBeVisible();
      await view.getByRole("button", { name: "Remove Physics" }).click();
      await view
        .getByLabel("Specimen notes")
        .fill("Canonical application context");
      const toggle = view.getByRole("switch", { name: "Specimen preference" });
      await expect(toggle).toBeChecked();
      await toggle.press("Space");
      await expect(toggle).not.toBeChecked();
      await toggle.press("Space");
      await expect(toggle).toBeChecked();
      const all = view.getByRole("checkbox", {
        name: "Select all specimen options",
      });
      await expect(all).toHaveAttribute("aria-checked", "mixed");
      expect(
        await all.evaluate((el: HTMLInputElement) => el.indeterminate),
      ).toBe(true);
      await all.check();
      await expect(
        view.getByRole("checkbox", { name: "Specimen option 2" }),
      ).toBeChecked();
      const checkedColor = await all.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      await all.hover();
      expect(
        await all.evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe(checkedColor);
      await expect(
        view.getByRole("checkbox", { name: "Unavailable option" }),
      ).toBeDisabled();
      const slider = view.getByRole("slider", { name: "Specimen zoom" });
      await slider.press("Home");
      await expect(slider).toHaveValue("50");
      await slider.press("End");
      await expect(slider).toHaveValue("200");
      expect(
        await slider.evaluate((el) =>
          el.style.getPropertyValue("--slider-progress"),
        ),
      ).toBe("100%");
      await slider.press("ArrowLeft");
      await expect(slider).toHaveValue("190");
      await expect(slider).toHaveAttribute("aria-valuetext", "190%");
      const invalid = view.getByLabel("Specimen invalid field");
      await expect(invalid).toHaveAttribute("aria-invalid", "true");
      await expect(invalid).toHaveAccessibleDescription(
        "Keep the draft and explain how to correct it.",
      );
      const errorStyle = await view
        .locator(".ui-field .form-error")
        .evaluate((el) => ({
          background: getComputedStyle(el).backgroundColor,
          padding: getComputedStyle(el).padding,
        }));
      expect(errorStyle.background).toBe("rgba(0, 0, 0, 0)");
      expect(errorStyle.padding).toBe("0px");
      // The showcase must consume action semantics, not recolor every action
      // with its accent. This caught a legacy blanket .button rule visually.
      const danger = view.getByRole("button", {
        name: "Clear selection",
        exact: true,
      });
      expect(
        await danger.evaluate((el) => getComputedStyle(el).backgroundColor),
      ).not.toBe(
        await view
          .getByRole("button", { name: "Save sample", exact: true })
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      );
      const save = view.getByRole("button", {
        name: "Save sample",
        exact: true,
      });
      await save.scrollIntoViewIfNeeded();
      const idle = await save.boundingBox();
      await save.click();
      await expect(save).toHaveAttribute("aria-busy", "true");
      await expect(save).toBeDisabled();
      const busy = await save.boundingBox();
      expect(busy!.width).toBeCloseTo(idle!.width, 0);
      expect(busy!.height).toBeCloseTo(idle!.height, 0);
      await expect(save).toBeEnabled();
      await noOverflow(page);
      await page.screenshot({
        path: info.outputPath(`${id}-${mode}-controls.png`),
      });
      const opener = view.getByRole("button", { name: "Open sample dialog" });
      await opener.click();
      const dialog = page.getByRole("dialog", {
          name: "Sample form",
          exact: true,
        }),
        title = dialog.getByLabel("Sample title");
      await expect(title).toBeFocused();
      await iconFieldsAlign(page);
      await dialog.locator("label:has(.ui-field-label-icon)").first().click();
      await expect(title).toBeFocused();
      const website = dialog.getByLabel("Sample website", { exact: true });
      await dialog
        .locator("label[for]")
        .filter({ hasText: "Sample website" })
        .click();
      await expect(website).toBeFocused();
      expect(
        await website.evaluate((el: HTMLInputElement) => el.labels?.length),
      ).toBe(1);
      await title.focus();
      await expect(dialog.locator(".dialog-footer")).toBeInViewport();
      await title.fill(
        `A long ${name} research title — α, β, ∇ and reproducible experiments`,
      );
      await dialog.getByRole("button", { name: "Clear Sample owner" }).click();
      await title.press("Enter");
      await expect(dialog).toBeVisible();
      const sampleOwner = dialog.getByRole("combobox", {
        name: "Sample owner",
      });
      await expect(sampleOwner).toBeFocused();
      await sampleOwner.fill("Noether");
      await sampleOwner.press("Enter");
      await expect(sampleOwner).toHaveValue("Emmy Noether");
      await title.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(view.locator(".theme-workbench-row strong")).toContainText(
        name,
      );
      await settings.getByRole("button", { name: "Done", exact: true }).click();
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute(
        "data-interface-style",
        id,
      );
    });
  }
}

test("precision fields keep invalid drafts, snap fractional steps, reset and flush slider changes", async ({
  page,
}) => {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Typography", exact: true }).click();
  const value = dialog.getByLabel("Line height value", { exact: true }),
    slider = dialog.getByRole("slider", { name: "Line height", exact: true });
  await value.fill("99");
  await value.press("Tab");
  await expect(value).toHaveAttribute("aria-invalid", "true");
  await expect(value).toHaveValue("99");
  await expect(value).toHaveAccessibleDescription(
    /Use a number from 1.3 to 2.4/,
  );
  await value.fill("2.02");
  await value.press("Enter");
  await expect(value).toHaveValue("2");
  await expect(slider).toHaveValue("2");
  await slider.press("End");
  await slider.press("ArrowLeft");
  await dialog.getByRole("tab", { name: "Page", exact: true }).click();
  await dialog.getByRole("tab", { name: "Typography", exact: true }).click();
  await expect(value).toHaveValue("2.35");
  await dialog
    .getByRole("button", { name: "Reset Line height", exact: true })
    .click();
  await expect(value).toHaveValue(String(paperAppearance.lineHeight));
  await dialog.getByRole("tab", { name: "Page", exact: true }).click();
  await dialog.getByRole("switch", { name: "Use the full page width" }).check();
  await expect(
    dialog.getByLabel("Reading width value", { exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("slider", { name: "Reading width", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Reset Reading width", exact: true }),
  ).toBeDisabled();
  await noOverflow(page);
});

test("large text, square shapes and no shadows keep the shared fields and action footer usable", async ({
  page,
}, info) => {
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Interface font size value", { exact: true })
    .fill("22");
  await dialog
    .getByLabel("Interface font size value", { exact: true })
    .press("Enter");
  await dialog.getByLabel("Corner radius value", { exact: true }).fill("0");
  await dialog
    .getByLabel("Corner radius value", { exact: true })
    .press("Enter");
  await dialog.getByLabel("Shadows", { exact: true }).selectOption("none");
  await dialog.getByLabel("Density", { exact: true }).selectOption("compact");
  const view = await specimen(page);
  for (const { id, name } of interfaceStyles) {
    await dialog.getByRole("radio", { name, exact: true }).check();
    await iconFieldsAlign(page);
    await mixedToolbarsAlign(page);
    await noOverflow(page);
    const save = view.getByRole("button", { name: "Save sample", exact: true });
    await save.scrollIntoViewIfNeeded();
    const style = await save.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      radius: getComputedStyle(el).borderRadius,
      font: parseFloat(getComputedStyle(el).fontSize),
    }));
    expect(style.height).toBeGreaterThanOrEqual(50);
    expect(style.font).toBeGreaterThanOrEqual(19);
    expect(style.radius).toBe("0px");
    expect(await dialog.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(
      "none",
    );
    const spacing = await view
      .locator(".theme-workbench-choices label")
      .evaluateAll((labels) =>
        labels.map((el) => ({
          margin: getComputedStyle(el).marginBlockEnd,
          horizontal: getComputedStyle(el).flexDirection,
        })),
      );
    expect(
      spacing.every((row) => row.margin === "0px" && row.horizontal === "row"),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`${id}-large-square.png`) });
  }
});

test("destructive confirmation initially focuses Cancel and closing settings restores its opener", async ({
  page,
}) => {
  const settings = page.getByRole("dialog", { name: "Appearance & editor" });
  await settings.getByRole("tab", { name: "Local data" }).click();
  await settings
    .getByRole("button", { name: "Clear local demo", exact: true })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "Clear local demo data?",
    exact: true,
  });
  await expect(
    confirm.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Appearance", exact: true }),
  ).toBeFocused();
});

test("reduced motion and forced colors preserve native controls and visible keyboard focus", async ({
  page,
  browserName,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  const view = await specimen(page),
    toggle = view.getByRole("switch", { name: "Specimen preference" });
  await toggle.press("Space");
  await expect(toggle).not.toBeChecked();
  const slider = view.getByRole("slider", { name: "Specimen zoom" });
  // Real Tab navigation establishes keyboard modality in Firefox as well.
  // A programmatic locator focus does not imply :focus-visible there.
  // Safari uses Option-Tab to include non-text controls with default macOS settings.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(slider).toBeFocused();
  await slider.press("End");
  await expect(slider).toHaveValue("200");
  const outline = await slider.evaluate((el) => ({
    width: getComputedStyle(el).outlineWidth,
    style: getComputedStyle(el).outlineStyle,
    appearance: getComputedStyle(el).appearance,
  }));
  expect(parseFloat(outline.width)).toBeGreaterThan(0);
  expect(outline.style).not.toBe("none");
  expect(outline.appearance).not.toBe("none");
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("forced-colors-controls.png"),
  });
});
