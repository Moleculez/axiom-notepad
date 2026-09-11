import { test, expect } from "@playwright/test";

const figure = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="270" viewBox="0 0 720 270">
  <rect width="720" height="270" fill="#edf1f3"/>
  <g stroke="#ccd5db"><path d="M60 55H680M60 105H680M60 155H680M60 205H680"/></g>
  <path d="M60 35V220H680" fill="none" stroke="#647480" stroke-width="1.5"/>
  <path d="M60 205C130 205 150 150 210 148S310 90 380 93S490 55 550 56S640 42 680 43" fill="none" stroke="#416f87" stroke-width="3"/>
  <path d="M60 205C150 198 180 170 250 168S370 138 440 130S580 105 680 100" fill="none" stroke="#998267" stroke-width="2" stroke-dasharray="6 5"/>
  <g fill="#475660" font-family="Georgia, serif" font-size="14">
    <text x="62" y="25">Convergence of a synthetic experiment</text>
    <text x="565" y="248">Iteration →</text>
  </g>
</svg>`;

for (const variant of [
  { name: "paper", dark: false, size: 19, width: 1440 },
  { name: "night", dark: true, size: 19, width: 1440 },
  { name: "large-text", dark: false, size: 28, width: 1280 },
]) {
  test(`image Markdown inherits prose typography and wraps above its preview · ${variant.name}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: variant.width, height: 1100 });
    await page.emulateMedia({
      colorScheme: variant.dark ? "dark" : "light",
      reducedMotion: "reduce",
    });
    await page.route("**/appearance-figure.svg?*", (route) =>
      route.fulfill({ contentType: "image/svg+xml", body: figure }),
    );
    await page.goto("/tests/editor-lab/index.html");
    await page.evaluate(() => window.editorLabReady);
    const markdown =
      "![Convergence curves](/appearance-figure.svg?experiment=" +
      "synthetic-research-".repeat(8) +
      ")";
    const source =
      "# Research notes\n\nA comparison of two iterative methods.\n\n" +
      markdown +
      "\n\nThe solid curve is the proposed method; the dashed curve is the baseline.";
    await page.evaluate(
      async ({ source, dark, size }) => {
        const modulePath = "/packages/shared/src/appearance.ts";
        const { defaults, appearanceVariables } = await import(modulePath);
        const root = document.documentElement;
        for (const [key, value] of Object.entries(
          appearanceVariables(
            {
              ...defaults,
              lightPreset: "paper",
              proseFont: "latinModern",
              headingFont: "latinModern",
              proseSize: size,
              lineHeight: 1.65,
            },
            dark,
          ),
        ))
          root.style.setProperty(key, String(value));
        root.dataset.theme = dark ? "dark" : "light";
        root.dataset.motion = "reduced";
        root.dataset.documentDecorations = "latex";
        await window.editorLab.reset(source);
        window.editorLab.images(true);
        window.editorLab.focus(0, source.indexOf("A comparison"));
        await document.fonts.ready;
      },
      { source, dark: variant.dark, size: variant.size },
    );
    const pane = page.locator('[data-pane="0"]');
    const preview = pane.locator(".axiom-image");
    await expect(preview).toHaveAttribute("data-image-state", "ready");
    await preview.click();
    const text = pane.locator(".axiom-image-source-text");
    await expect(text).toHaveText(markdown);
    await expect(pane.locator(".axiom-prose")).toBeFocused();
    const typography = await text.evaluate((element) => {
      const style = getComputedStyle(element);
      const prose = getComputedStyle(element.closest("p")!);
      return {
        font: style.fontFamily,
        size: style.fontSize,
        line: style.lineHeight,
        color: style.color,
        prose: [
          prose.fontFamily,
          prose.fontSize,
          prose.lineHeight,
          prose.color,
        ],
        outline: style.outlineStyle,
        transition: style.transitionDuration,
      };
    });
    expect([
      typography.font,
      typography.size,
      typography.line,
      typography.color,
    ]).toEqual(typography.prose);
    expect(typography.size).toBe(`${variant.size}px`);
    expect(typography.font).toContain("Latin Modern");
    expect(typography.outline).toBe("none");
    expect(typography.transition).toBe("0s");
    const bounds = await text.boundingBox();
    const picture = await preview.locator("img").boundingBox();
    const paragraph = await text.locator("..").boundingBox();
    expect(picture!.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height);
    expect(bounds!.width).toBeLessThanOrEqual(paragraph!.width + 1);
    expect(bounds!.height).toBeGreaterThan(parseFloat(typography.line));
    expect(picture!.x + picture!.width).toBeLessThanOrEqual(
      paragraph!.x + paragraph!.width + 1,
    );
    expect(picture!.width / picture!.height).toBeCloseTo(720 / 270, 1);
    const path = testInfo.outputPath(`image-inline-${variant.name}.png`);
    await page.screenshot({ path, animations: "disabled" });
    await testInfo.attach(`image-inline-${variant.name}`, {
      path,
      contentType: "image/png",
    });
    expect(
      await page.evaluate(() =>
        window.editorLab.snapshot().map((session) => session.source),
      ),
    ).toEqual([source, source]);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
  });
}
