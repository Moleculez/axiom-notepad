import { test, expect } from "@playwright/test";
test.use({ trace: "off", screenshot: "off" });

test("benchmark 50 edits at top, middle and end of large research notes", async ({
  page,
  browserName,
}) => {
  test.skip(
    process.env.AXIOM_EDITOR_BENCHMARK !== "1" || browserName !== "chromium",
    "Opt-in same-machine performance gate.",
  );
  test.setTimeout(300000);
  await page.goto("/tests/editor-lab/index.html");
  await page.waitForFunction(() => !!window.editorLabReady);
  await page.evaluate(() => window.editorLabReady);
  const report: {
    engine: string;
    size: number;
    location: string;
    p95: number;
    samples: number[];
  }[] = [];
  for (const size of [100000, 980000]) {
    const paragraph =
      "Research data remains reproducible and preserves independent observations.\n\n";
    const original = (
      "# Benchmark\n\n" + paragraph.repeat(Math.ceil(size / paragraph.length))
    ).slice(0, size);
    for (const engine of ["native", "milkdown"]) {
      // Both measurements have the same CM6 source peer. A legacy source peer
      // would otherwise charge its rendering cost only to the Milkdown run.
      await page.evaluate(
        ({ source, legacy }) => window.editorLab.reset(source, legacy),
        { source: original, legacy: engine === "native" },
      );
      const index = engine === "native" ? 1 : 0;
      await page.evaluate(
        (index) => window.editorLab.mode(1 - index, "source"),
        index,
      );
      for (const [location, fraction] of [
        ["top", 0],
        ["middle", 0.5],
        ["end", 0.98],
      ] as const) {
        await page.evaluate(
          ({ index, fraction }) => {
            const source = window.editorLab.snapshot()[index].source;
            const start = Math.floor(source.length * fraction);
            const word = source.indexOf("Research", start);
            window.editorLab.focus(
              index,
              word < 0 ? source.length - 3 : word + 20,
            );
          },
          { index, fraction },
        );
        const samples: number[] = [];
        for (let i = 0; i < 50; i++) {
          await page.evaluate((index) => {
            const host = document.querySelector(`[data-pane="${index}"]`)!;
            window.editorPaint = new Promise<number>((resolve) => {
              host.addEventListener(
                "beforeinput",
                () => {
                  const start = performance.now();
                  requestAnimationFrame(() => {
                    host.getBoundingClientRect();
                    resolve(performance.now() - start);
                  });
                },
                { once: true, capture: true },
              );
            });
          }, index);
          await page.keyboard.insertText("x");
          samples.push(await page.evaluate(() => window.editorPaint));
        }
        const p95 = [...samples].sort((a, b) => a - b)[
          Math.ceil(samples.length * 0.95) - 1
        ];
        report.push({ engine, size, location, p95, samples });
        console.info(
          `${engine} ${size} ${location}: p95 ${p95.toFixed(1)}ms (50 samples)`,
        );
        if (engine === "milkdown")
          expect
            .soft(p95, `${size} ${location} input-to-frame p95`)
            .toBeLessThan(size <= 100000 ? 50 : 200);
      }
      const values = await page.evaluate(() =>
        window.editorLab.snapshot().map((s) => s.source),
      );
      expect(values[0]).toBe(values[1]);
      expect(values[0].length).toBe(size + 150);
    }
  }
  await test.info().attach("editor-input-to-frame", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
});
declare global {
  interface Window {
    editorPaint: Promise<number>;
  }
}
