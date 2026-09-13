import { expect, test } from "@playwright/test";
import { measureTaskLayout } from "../helpers/task-layout";

const source = [
  "Research checklist",
  "",
  "- [ ] First task",
  "- [x] Wrapped task with **emphasis**, `code`, and enough explanation to span multiple lines while keeping its checkbox beside the first line of the text.",
  "  - [ ] Nested task",
  "  - [x] Nested completed task",
  "- [ ] Following sibling",
  "",
  "> - [ ] Quoted task",
  ">   - [ ] Nested quoted task",
  "",
  "- [ ] Loose task with a second paragraph.",
  "",
  "  This paragraph stays aligned with the label, not the checkbox.",
  "",
  "- [ ] `code` comes first, followed by α, β, ε and 中文.",
  "- [ ] **Bold text** starts this task.",
  "- [ ] $\\frac{a}{b}$ starts this task with a taller inline equation.",
  "",
  "End",
].join("\n");

for (const appearance of [
  { size: 16, line: 1.35, font: '"Axiom Latin Modern", serif' },
  { size: 18, line: 1.75, font: '"Source Sans 3", sans-serif' },
  { size: 28, line: 2.2, font: '"Axiom Latin Modern", serif' },
  { size: 20, line: 1.8, font: '"Inter", sans-serif', dark: true },
]) {
  test(`task rows align optically at ${appearance.size}px / ${appearance.line}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/editor-lab/index.html");
    await page.evaluate(() => window.editorLabReady);
    await page.evaluate(
      async ({ source, appearance }) => {
        await window.editorLab.reset(source, true);
        window.editorLab.focus(0, 0);
        const style = document.documentElement.style;
        style.setProperty("--size-prose", `${appearance.size}px`);
        style.setProperty("--reading-line", String(appearance.line));
        style.setProperty("--font-prose", appearance.font);
        if ("dark" in appearance && appearance.dark) {
          style.setProperty("--paper", "#202124");
          style.setProperty("--text", "#e8eaed");
          style.setProperty("--muted", "#a8adb5");
          style.setProperty("--accent", "#aecbfa");
          style.setProperty("--on-accent", "#10264b");
          document.documentElement.style.colorScheme = "dark";
        }
        await document.fonts.ready;
      },
      { source, appearance },
    );

    for (const mode of ["write", "read"] as const) {
      if (mode === "read")
        await page.evaluate(async () => {
          await window.editorLab.mode(0, "read");
        });
      // The rollback adapter delegates Read mode to its application host;
      // its lab surface only implements Write/Source.
      for (const index of mode === "write" ? [0, 1] : [0]) {
        const tasks = page.locator(
          `[data-pane="${index}"] .document-task > input`,
        );
        await expect(tasks).toHaveCount(11);
        const measurements = [];
        for (const checkbox of await tasks.all()) {
          const item = await checkbox.evaluate(measureTaskLayout);
          measurements.push(item);
          expect(
            Math.abs(item.offset),
            `${mode}, pane ${index}: ${item.text}`,
          ).toBeLessThan(0.75);
          expect(item.layout).toBe("grid");
          expect(item.margin).toBe("0px");
          expect(item.gap).toBeCloseTo(item.textSize * 0.65, 1);
          expect(item.size).toBeCloseTo(appearance.size * 0.85, 1);
          expect(item.hitSize).toBeGreaterThanOrEqual(24);
          if (mode === "read") await expect(checkbox).toBeDisabled();
        }
        expect(
          measurements.find((item) => item.text?.startsWith("Wrapped task"))
            ?.wrapped,
        ).toBe(true);
      }
      await page.screenshot({
        path: info.outputPath(`task-rows-${mode}.png`),
        animations: "disabled",
      });
    }
    expect(
      await page.evaluate(() =>
        window.editorLab.snapshot().map((item) => item.source),
      ),
    ).toEqual([source, source]);
    expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("the larger task hit area toggles without stealing the caret or exposing source", async ({
  page,
}) => {
  const original = "Caret\n\n- [ ] **First task**\n- [ ] Second task\n\nEnd";
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
    window.editorLab.focus(0, 2);
    document.documentElement.style.setProperty("--size-prose", "16px");
  }, original);
  const pane = page.locator('[data-pane="0"]');
  const checkbox = pane.getByRole("checkbox").first();
  for (const [index, edge] of ["left", "right", "top", "bottom"].entries()) {
    const box = (await checkbox.boundingBox())!;
    const x =
      edge === "left"
        ? box.x - 2
        : edge === "right"
          ? box.x + box.width + 2
          : box.x + box.width / 2;
    const y =
      edge === "top"
        ? box.y - 2
        : edge === "bottom"
          ? box.y + box.height + 2
          : box.y + box.height / 2;
    expect(
      await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.matches('input[type="checkbox"]'),
        { x, y },
      ),
    ).toBe(true);
    await page.mouse.click(x, y);
    const expected =
      index % 2 === 0 ? original.replace("[ ]", "[x]") : original;
    await expect
      .poll(() =>
        page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
      )
      .toEqual([expected, expected]);
    expect(await page.evaluate(() => window.editorLab.domSelection(0))).toEqual(
      { anchor: 2, head: 2 },
    );
    await expect(
      pane.locator(".document-task .axiom-source-prose"),
    ).toHaveCount(0);
    await expect(pane.getByRole("checkbox").nth(1)).not.toBeChecked();
  }
  await page.keyboard.press("ControlOrMeta+z");
  await expect(checkbox).toBeChecked();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(checkbox).not.toBeChecked();
  await page.keyboard.type("X");
  await expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([
      original.replace("Caret", "CaXret"),
      original.replace("Caret", "CaXret"),
    ]);
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
});

test("editing a task retains its control gutter without a layout jump", async ({
  page,
}) => {
  const source = "Caret\n\n- [ ] **First task**\n  - [x] Nested task\n\nEnd";
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
    window.editorLab.focus(0, 2);
  }, source);
  const pane = page.locator('[data-pane="0"]');
  const checkbox = pane.getByRole("checkbox").first();
  const before = await checkbox.boundingBox();
  await pane.locator(".document-task strong").click();
  const raw = pane.locator(".document-task .axiom-source-prose").first();
  await expect(raw).toContainText("**First task**");
  await expect(pane.locator(".document-task > input").first()).toBeVisible();
  expect(await checkbox.boundingBox()).toEqual(before);
  await pane
    .locator("p")
    .filter({ hasText: /^Caret$/ })
    .click();
  await expect(checkbox).toBeVisible();
  expect(await checkbox.boundingBox()).toEqual(before);
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([source, source]);
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
});

test("task controls retain keyboard focus and contrast in forced colors", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
  await page.evaluate(() => window.editorLab.reset("- [ ] **Task**"));
  const checkbox = page.locator('[data-pane="0"]').getByRole("checkbox");
  await checkbox.focus();
  await expect(checkbox).toBeFocused();
  await expect(checkbox).toHaveCSS("outline-style", "solid");
  await expect(checkbox).toHaveCSS("outline-width", "2px");
  await expect(checkbox).toHaveCSS("transition-duration", "0s");
  await checkbox.press("Space");
  await expect(checkbox).toBeChecked();
  const colors = await checkbox.evaluate((el) => ({
    fill: getComputedStyle(el).backgroundColor,
    tick: getComputedStyle(el, "::after").borderBottomColor,
  }));
  expect(colors.tick).not.toBe(colors.fill);
  await checkbox.hover();
  await expect(checkbox).toHaveCSS("background-color", colors.fill);
  await expect(checkbox).toBeFocused();
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await expect(checkbox).toBeDisabled();
  await expect(checkbox).toHaveCSS("opacity", "1");
});
