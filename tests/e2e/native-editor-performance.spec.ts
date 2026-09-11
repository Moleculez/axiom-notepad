import { test, expect } from "@playwright/test";
import { fixture, caret } from "./native-editor-helpers";

// DOM snapshot recording walks the entire large editable tree and distorts
// input-to-paint measurements. Functional scenarios retain failure traces.
test.use({ trace: "off" });
test("native editor records input-to-paint for 100 KB and near-limit 1 MB notes", async ({
  browser,
}) => {
  test.setTimeout(120000);
  for (const size of [100000, 980000]) {
    const paragraph =
      "Research data remains reproducible and preserves independent observations.\n\n";
    const f = await fixture(
        browser,
        (
          "# Benchmark\n\n" +
          paragraph.repeat(Math.ceil(size / paragraph.length))
        ).slice(0, size),
      ),
      editor = f.page.getByTestId("note-editor");
    await caret(
      editor
        .locator("p")
        .filter({ hasText: /Research data/ })
        .first(),
      20,
    );
    await editor.evaluate((el) => {
      (window as any).__nativePaint = [];
      el.parentElement!.addEventListener("axiom:editor-paint", (event) =>
        (window as any).__nativePaint.push(
          (event as CustomEvent).detail.duration,
        ),
      );
    });
    for (let i = 0; i < 6; i++) {
      await f.page.keyboard.insertText("x");
      await expect
        .poll(() => f.page.evaluate(() => (window as any).__nativePaint.length))
        .toBeGreaterThan(i);
    }
    const timings: number[] = await f.page.evaluate(
      () => (window as any).__nativePaint,
    );
    const p95 = [...timings].sort((a, b) => a - b)[timings.length - 1];
    console.info(
      `Native Write ${size} characters: input-to-paint samples ${timings.map((t) => t.toFixed(1)).join(", ")} ms; p95 ${p95.toFixed(1)} ms`,
    );
    await test.info().attach(`native-paint-${size}`, {
      body: JSON.stringify({ size, timings, p95 }),
      contentType: "application/json",
    });
    expect(p95).toBeLessThan(size === 100000 ? 300 : 1200);
    await f.close();
  }
});
