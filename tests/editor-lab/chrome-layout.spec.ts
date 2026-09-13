import { test, expect } from "@playwright/test";

for (const [name, source, selector] of [
  [
    "table",
    "| A | B |\n| --- | --- |\n| x | y |\n\nAfter the table.\n",
    ".axiom-table-shell",
  ],
  ["code", "```python\nx = 1\n```\n\nAfter the code.\n", ".axiom-embedded"],
  ["math", "$$\nx^2 + y^2\n$$\n\nAfter the equation.\n", ".axiom-embedded"],
]) {
  test(`${name} first-block controls scale with UI text without clipping or changing Markdown`, async ({
    page,
  }, info) => {
    await page.goto("/tests/editor-lab/index.html");
    await page.evaluate(() => window.editorLabReady);
    await page.evaluate(async (source) => {
      document.documentElement.style.setProperty("--size-ui", "22.5px");
      document.documentElement.style.setProperty("--radius", "0px");
      document.documentElement.style.setProperty("--shadow", "none");
      await window.editorLab.reset(source);
    }, source);
    const host = page.locator('[data-pane="0"]');
    const block = host.locator(selector).first();
    await block.hover();
    const controls = block.locator(
      ".axiom-table-controls, .axiom-block-controls",
    );
    await expect(controls).toBeVisible();
    const bounds = (await host.boundingBox())!;
    const toolbar = (await controls.boundingBox())!;
    expect(toolbar.y).toBeGreaterThanOrEqual(bounds.y);
    expect(toolbar.x).toBeGreaterThanOrEqual(bounds.x);
    expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(
      bounds.x + bounds.width,
    );
    const button = controls.locator(".editor-icon-button").first();
    const shape = await button.evaluate((el) => {
      const rect = el.getBoundingClientRect(),
        style = getComputedStyle(el);
      return {
        height: rect.height,
        radius: style.borderRadius,
        hittable: el.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        ),
      };
    });
    expect(shape.height).toBeCloseTo(45, 0);
    expect(shape.radius).toBe("0px");
    expect(shape.hittable).toBe(true);
    await page.screenshot({
      path: info.outputPath(`${name}-scaled-controls.png`),
    });
    expect(
      await page.evaluate(() =>
        window.editorLab.snapshot().map((s) => s.source),
      ),
    ).toEqual([source, source]);
    expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
  });
}
