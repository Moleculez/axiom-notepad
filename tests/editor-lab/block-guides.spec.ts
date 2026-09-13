import { expect, test, type Page } from "@playwright/test";

const source = [
  "# A clear structure",
  "",
  "A quiet margin makes room for the research.",
  "",
  "- Record an observation",
  "  - Compare the model",
  "    - [ ] Check the assumptions",
  "- [ ] Reproduce the result",
  "",
  "1. Establish a baseline",
  "2. Repeat the measurement",
  "",
  "> Keep context close.",
  ">",
  "> > A nested perspective.",
  "",
  "### Conclusions",
  "",
  "The content stays in exactly the same place.",
].join("\n");
const rich = (page: Page) => page.locator('[data-pane="0"] .axiom-prose');
const active = (page: Page) => rich(page).locator(".axiom-block-guide-active");

async function snapshot(page: Page) {
  return page.evaluate(() => ({
    source: window.editorLab.snapshot(),
    caret: window.editorLab.domSelection(0),
    boxes: Array.from(
      document.querySelectorAll('[data-pane="0"] .axiom-block-guide'),
      (element) => {
        const box = element.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height];
      },
    ),
  }));
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
});

for (const variant of [
  { name: "paper", dark: false, size: 18 },
  { name: "night", dark: true, size: 18 },
  { name: "large-serif", dark: false, size: 30 },
]) {
  test(`guides share a neutral, aligned gutter without duplicate item rails · ${variant.name}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.evaluate(
      async ({ source, variant }) => {
        const modulePath = "/packages/shared/src/appearance.ts";
        const { defaults, appearanceVariables } = await import(modulePath);
        const root = document.documentElement;
        const preferences = {
          ...defaults,
          proseSize: variant.size,
          proseFont: variant.size === 30 ? "latinModern" : defaults.proseFont,
        };
        for (const [key, value] of Object.entries(
          appearanceVariables(preferences, variant.dark),
        ))
          root.style.setProperty(key, String(value));
        root.dataset.theme = variant.dark ? "dark" : "light";
        await window.editorLab.reset(source);
        window.editorLab.focus(0, source.indexOf("Compare") + 4);
        await document.fonts.ready;
      },
      { source, variant },
    );
    const measurements = await rich(page)
      .locator(".axiom-block-guide")
      .evaluateAll((elements) =>
        elements.map((el) => {
          const box = el.getBoundingClientRect(),
            guide = getComputedStyle(el, "::after");
          const owner = el.parentElement!.closest("ul, ol");
          const ownerGuide = owner && getComputedStyle(owner, "::after");
          const ownerX =
            owner && ownerGuide
              ? owner.getBoundingClientRect().x + parseFloat(ownerGuide.left)
              : null;
          return {
            tag: el.tagName,
            depth: el.getAttribute("data-block-depth"),
            active: el.classList.contains("axiom-block-guide-active"),
            x: box.x + parseFloat(guide.left),
            ownerX,
            opacity: Number(guide.opacity),
            pointer: guide.pointerEvents,
            width: guide.width,
            color: guide.color,
            top: guide.borderTopColor,
            text: el.textContent?.slice(0, 28),
          };
        }),
      );
    const rootX = measurements.find((m) => m.depth === "0")!.x;
    for (const measurement of measurements) {
      expect(measurement.pointer).toBe("none");
      expect(measurement.width).toBe("1px");
      if (measurement.depth === "0")
        expect(Math.abs(measurement.x - rootX), measurement.text).toBeLessThan(
          3,
        );
      if (measurement.tag === "LI") {
        expect(
          Math.abs(measurement.x - measurement.ownerX!),
          measurement.text,
        ).toBeLessThan(0.5);
        expect(measurement.opacity).toBe(measurement.active ? 1 : 0);
      }
    }
    const selected = measurements.find((m) => m.active)!;
    expect(selected.color).toBe(selected.top);
    expect(
      measurements.find((m) => m.tag === "BLOCKQUOTE" && m.depth === "1")!
        .opacity,
    ).toBe(0);
    const before = await snapshot(page);
    const color = await active(page).evaluate(
      (el) => getComputedStyle(el, "::after").color,
    );
    // A saturated theme accent must not turn structural rails into colored bars.
    await page.evaluate(() =>
      document.documentElement.style.setProperty("--accent", "#ff00ff"),
    );
    expect(
      await active(page).evaluate(
        (el) => getComputedStyle(el, "::after").color,
      ),
    ).toBe(color);
    expect(await snapshot(page)).toEqual(before);
    await page.screenshot({
      path: info.outputPath(`block-guides-${variant.name}.png`),
    });
    expect(errors).toEqual([]);
  });
}

test("hover emphasizes only the inspected item without moving the caret; blur quiets its previous range", async ({
  page,
}) => {
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
    window.editorLab.focus(0, source.indexOf("Compare") + 4);
  }, source);
  const before = await snapshot(page);
  const task = rich(page)
    .locator("li.document-task")
    .filter({ hasText: "Reproduce the result" });
  await task.hover();
  expect(
    await task.evaluate((el) => getComputedStyle(el, "::after").opacity),
  ).toBe("1");
  expect(await snapshot(page)).toEqual(before);
  await page.mouse.move(5, 5);
  expect(
    await task.evaluate((el) => getComputedStyle(el, "::after").opacity),
  ).toBe("0");
  await page.locator("#editors nav button").first().focus();
  expect(
    await active(page).evaluate(
      (el) => getComputedStyle(el, "::after").opacity,
    ),
  ).toBe("0");
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([source, source]);
});

test("guides honor reduced motion and forced colors, and never enter print output", async ({
  page,
}, info) => {
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
    window.editorLab.focus(0, source.indexOf("Compare") + 4);
  }, source);
  expect(
    await active(page).evaluate(
      (el) => getComputedStyle(el, "::after").transitionDuration,
    ),
  ).toBe("0s");
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  const colors = await active(page).evaluate((el) => {
    const guide = getComputedStyle(el, "::after");
    return {
      opacity: guide.opacity,
      adjustment: CSS.supports("forced-color-adjust", "none")
        ? guide.forcedColorAdjust
        : "unsupported",
      color: guide.color,
    };
  });
  expect(colors.opacity).toBe("1");
  expect(["none", "unsupported"]).toContain(colors.adjustment);
  await page.screenshot({
    path: info.outputPath("block-guides-forced-colors.png"),
  });
  await page.emulateMedia({ media: "print" });
  expect(
    await active(page).evaluate(
      (el) => getComputedStyle(el, "::after").display,
    ),
  ).toBe("none");
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([source, source]);
});
