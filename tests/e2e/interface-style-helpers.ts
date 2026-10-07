import { expect, type Locator, type Page } from "@playwright/test";

/** Measure the painted surface, not an assumed header foreground or palette. */
export async function interfaceChromeContrast(page: Page) {
  return page.evaluate(() => {
    type Color = [number, number, number, number];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const parse = (value: string): Color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const composite = (foreground: Color, background: Color): Color =>
      [
        ...foreground
          .slice(0, 3)
          .map(
            (channel, index) =>
              channel * foreground[3] + background[index] * (1 - foreground[3]),
          ),
        1,
      ] as Color;
    const backgroundFor = (element: Element): Color => {
      const layers: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement)
        layers.unshift(node);
      return layers.reduce(
        (background, layer) =>
          composite(parse(getComputedStyle(layer).backgroundColor), background),
        [255, 255, 255, 1] as Color,
      );
    };
    const luminance = (color: Color) =>
      color.slice(0, 3).reduce((sum, channel, index) => {
        const value = channel / 255;
        return (
          sum +
          (value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][index]
        );
      }, 0);
    const ratio = (foreground: Color, background: Color) => {
      const light = luminance(composite(foreground, background)),
        dark = luminance(background);
      return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
    };
    const groups = [
      { selector: ".settings-rail .ws-side-link:not(.active)", minimum: 4.5 },
      { selector: ".ws-appbar .workspace-docs-trigger", minimum: 4.5 },
      { selector: ".ws-appbar .icon-button:not(:disabled)", minimum: 3 },
      {
        selector: ".ws-account-menu[open] > div :is(a, button, strong, small)",
        minimum: 4.5,
      },
      {
        selector:
          ".workspace-recent[open] .workspace-recent-popover :is(header strong, header small, .workspace-recent-open strong, .workspace-recent-open small, footer)",
        minimum: 4.5,
      },
    ];
    const visible = (element: HTMLElement) => {
      if (!element.getClientRects().length) return false;
      for (
        let parent: Element | null = element;
        parent;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        )
          return false;
        // Firefox may expose boxes/styles for the unpainted native details
        // content. Its summary is the only visible descendant while closed.
        if (
          parent instanceof HTMLDetailsElement &&
          !parent.open &&
          !parent.querySelector(":scope > summary")?.contains(element)
        )
          return false;
      }
      return true;
    };
    const samples = groups.flatMap(({ selector, minimum }) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter(visible)
        .map((element) => {
          const style = getComputedStyle(element),
            background = backgroundFor(element),
            glyph = minimum === 3 ? element.querySelector("svg") : null,
            glyphStyle = glyph ? getComputedStyle(glyph) : null,
            color =
              glyphStyle && glyphStyle.stroke !== "none"
                ? glyphStyle.stroke
                : style.color;
          return {
            selector,
            label:
              element.getAttribute("aria-label") ?? element.textContent?.trim(),
            color,
            background,
            minimum,
            contrast: ratio(parse(color), background),
          };
        }),
    );
    const root = getComputedStyle(document.documentElement);
    return {
      style: document.documentElement.dataset.interfaceStyle,
      roles: Object.fromEntries(
        [
          "--ui-chrome-text",
          "--ink-chrome-text",
          "--ui-header-text",
          "--ui-header-muted",
          "--icon-surface",
        ].map((name) => [name, root.getPropertyValue(name).trim()]),
      ),
      samples,
    };
  });
}

/** Wait for painted roles to settle, not unrelated background-work animations. */
export async function settledInterfaceChrome(page: Page) {
  let previous = "",
    unchanged = 0;
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() =>
          JSON.stringify(
            Array.from(
              document.querySelectorAll(
                ".ws-appbar, .ws-appbar .workspace-docs-trigger, .ws-appbar .icon-button, .settings-rail, .settings-rail .ws-side-link, .ws-account-menu[open] > div",
              ),
            ).map((element) => {
              const style = getComputedStyle(element);
              return [
                style.color,
                style.backgroundColor,
                style.borderColor,
                style.borderRadius,
                style.boxShadow,
              ];
            }),
          ),
        );
        unchanged = current === previous ? unchanged + 1 : 1;
        previous = current;
        return unchanged;
      },
      {
        intervals: [100, 150, 250],
        message: "Relevant chrome paint is stable across samples",
      },
    )
    .toBeGreaterThanOrEqual(3);
}

export async function expectInterfaceChromeContrast(page: Page) {
  await settledInterfaceChrome(page);
  try {
    await expect
      .poll(
        async () => {
          const { samples } = await interfaceChromeContrast(page);
          expect(samples.some((sample) => sample.minimum === 4.5)).toBe(true);
          expect(samples.some((sample) => sample.minimum === 3)).toBe(true);
          return Math.min(
            ...samples.map((sample) => sample.contrast / sample.minimum),
          );
        },
        {
          message: "Each chrome label/glyph contrasts its own painted surface",
        },
      )
      .toBeGreaterThanOrEqual(1);
  } catch (error) {
    if (error instanceof Error)
      error.message += `\nResolved chrome: ${JSON.stringify(await interfaceChromeContrast(page))}`;
    throw error;
  }
  return interfaceChromeContrast(page);
}

/** Native checked state alone can precede React's row state and actual paint.
 * Measure the real pseudo-glyph/surface after both states and three samples agree. */
export async function expectGalleryCheckboxPaint(row: Locator) {
  const checkbox = row.locator("input[type='checkbox']");
  await expect(checkbox).toBeChecked();
  await expect(row).toHaveAttribute("data-selected", "true");
  const sample = () =>
    row.evaluate((element) => {
      type Color = [number, number, number, number];
      const input = element.querySelector<HTMLInputElement>(
          "input[type='checkbox']",
        )!,
        style = getComputedStyle(input),
        glyph = getComputedStyle(input, "::before"),
        canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      const parse = (value: string): Color => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      };
      const composite = (foreground: Color, background: Color): Color =>
        [
          ...foreground
            .slice(0, 3)
            .map(
              (channel, index) =>
                channel * foreground[3] +
                background[index] * (1 - foreground[3]),
            ),
          1,
        ] as Color;
      const layers: Element[] = [];
      for (let node: Element | null = input; node; node = node.parentElement)
        layers.unshift(node);
      const background = layers.reduce(
        (value, layer) =>
          composite(parse(getComputedStyle(layer).backgroundColor), value),
        [255, 255, 255, 1] as Color,
      );
      const luminance = (color: Color) =>
        color.slice(0, 3).reduce((sum, channel, index) => {
          const value = channel / 255;
          return (
            sum +
            (value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4) *
              [0.2126, 0.7152, 0.0722][index]
          );
        }, 0);
      const ink = luminance(
          composite(parse(glyph.borderBottomColor), background),
        ),
        surface = luminance(background);
      return {
        checked: input.checked,
        selected: element.getAttribute("data-selected"),
        appearance: style.appearance,
        backgroundColor: style.backgroundColor,
        glyphColor: glyph.borderBottomColor,
        glyphOpacity: Number(glyph.opacity),
        glyphWidth: parseFloat(glyph.borderBottomWidth),
        contrast:
          (Math.max(ink, surface) + 0.05) / (Math.min(ink, surface) + 0.05),
      };
    });
  let previous = "",
    unchanged = 0;
  await expect
    .poll(
      async () => {
        const current = await sample(),
          key = JSON.stringify(current);
        unchanged = key === previous ? unchanged + 1 : 0;
        previous = key;
        return (
          current.checked &&
          current.selected === "true" &&
          current.appearance === "none" &&
          current.glyphOpacity === 1 &&
          current.glyphWidth > 0 &&
          current.contrast >= 3 &&
          unchanged >= 2
        );
      },
      {
        message:
          "Checked glyph and selected surface must settle with at least 3:1 contrast",
      },
    )
    .toBe(true);
  return sample();
}
