import { test, expect } from "@playwright/test";

test("LaTeX headings retain rules while editing and section signs stay decorative", async ({
  page,
}) => {
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
  const source =
    Array.from(
      { length: 6 },
      (_, i) => "#".repeat(i + 1) + " Heading " + (i + 1),
    ).join("\n\n") + "\n\nOutside";
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
    document.documentElement.dataset.documentDecorations = "latex";
    window.editorLab.focus(0, source.length);
  }, source);
  const prose = page.locator('[data-pane="0"] .axiom-prose');
  for (let level = 1; level <= 6; level++) {
    const heading = prose.locator("h" + level);
    const resting = await heading.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        border: s.borderBottomWidth,
        padding: s.paddingBottom,
        before: getComputedStyle(el, "::before").content,
      };
    });
    expect(parseFloat(resting.border)).toBe(level <= 3 ? 1 : 0);
    expect(resting.before).toContain("§");
    const number = Array(level).fill("1").join(".");
    await expect(heading).toHaveAttribute("data-section-number", number);
    expect(resting.before).toContain(number);
    await expect(heading).toHaveAccessibleName("Heading " + level);
    await expect(heading).toHaveText("Heading " + level);
    await heading.click();
    await expect(heading).toHaveText("#".repeat(level) + " Heading " + level);
    await expect(heading).toHaveAttribute("data-section-number", number);
    expect(
      await heading.evaluate((el) => getComputedStyle(el, "::before").content),
    ).toBe("none");
    expect(
      await heading.evaluate((el) => getComputedStyle(el).borderBottomWidth),
    ).toBe(resting.border);
    await prose.getByText("Outside", { exact: true }).click();
  }
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual([source, source]);
  await page.evaluate(() => {
    document.documentElement.dataset.documentDecorations = "none";
  });
  expect(
    await prose
      .locator("h1")
      .evaluate((el) => getComputedStyle(el, "::before").content),
  ).toBe("none");
  expect(
    await prose
      .locator("h1")
      .evaluate((el) => getComputedStyle(el).borderBottomWidth),
  ).toBe("0px");
});

test("section numbers reflow across peer edits, level changes, moves and mode switches", async ({
  page,
}) => {
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
  const source =
    "# Theory\n\n## Setup\n\n## Evidence\n\n# Result\n\n## Discussion\n\nOutside";
  await page.evaluate(async (source) => {
    await window.editorLab.reset(source);
    document.documentElement.dataset.documentDecorations = "latex";
    window.editorLab.focus(0, source.length);
  }, source);
  const headings = page.locator('[data-pane="0"] [data-section-number]');
  const numbers = () =>
    headings.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-section-number")),
    );
  await expect.poll(numbers).toEqual(["1", "1.1", "1.2", "2", "2.1"]);
  await headings.nth(1).click();
  await page.evaluate(() => window.editorLab.remote(1, 0, 0, "# Foreword\n\n"));
  await expect.poll(numbers).toEqual(["1", "2", "2.1", "2.2", "3", "3.1"]);
  await expect(headings.nth(2)).toHaveText("## Setup");
  await page.evaluate(() => {
    const at = window.editorLab.snapshot()[0].source.indexOf("## Setup");
    window.editorLab.remote(1, at, at + 1, "");
  });
  await expect.poll(numbers).toEqual(["1", "2", "3", "3.1", "4", "4.1"]);
  await page.evaluate(() => window.editorLab.execute(0, "moveDown"));
  await expect.poll(numbers).toEqual(["1", "2", "2.1", "3", "4", "4.1"]);
  const sources = await page.evaluate(() =>
    window.editorLab.snapshot().map((s) => s.source),
  );
  expect(sources[0]).toBe(sources[1]);
  expect(sources[0].indexOf("## Evidence")).toBeLessThan(
    sources[0].indexOf("# Setup"),
  );
  const updates = await page.evaluate(() =>
    window.editorLab.snapshot().map((s) => s.updates),
  );
  for (const mode of ["read", "source", "write"] as const) {
    await page.evaluate((mode) => window.editorLab.mode(0, mode), mode);
    if (mode !== "source")
      await expect.poll(numbers).toEqual(["1", "2", "2.1", "3", "4", "4.1"]);
  }
  expect(
    await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    ),
  ).toEqual(updates);
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual(sources);
});

test("nested and deep numbered headings keep their editable body and labels separate", async ({
  page,
}) => {
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
  await page.evaluate(async () => {
    const source =
      "## A\n\n> #### B\n\n> #### C\n\n###### Deep heading with a long descriptive title that should wrap naturally across multiple lines\n\n# D\n\nOutside";
    await window.editorLab.reset(source);
    document.documentElement.dataset.documentDecorations = "latex";
    window.editorLab.focus(0, source.length);
  });
  const headings = page.locator('[data-pane="0"] [data-section-number]');
  expect(
    await headings.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-section-number")),
    ),
  ).toEqual(["1", "1.1", "1.2", "1.2.1", "2"]);
  await headings.nth(1).click();
  await expect(headings.nth(1)).toHaveText("#### B");
  await expect(headings.nth(1)).toHaveAttribute("data-section-number", "1.1");
  await page.keyboard.type("eta");
  const deep = headings.nth(3);
  expect(
    await deep.evaluate((el) => {
      const s = getComputedStyle(el),
        prefix = getComputedStyle(el, "::before");
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = `${prefix.fontSize} ${prefix.fontFamily}`;
      return (
        parseFloat(s.paddingInlineStart) -
        context.measureText("§ " + el.getAttribute("data-section-number")).width
      );
    }),
  ).toBeGreaterThan(2);
});

test("authored dividers use a clear double rule without affecting footnote separators", async ({
  page,
}) => {
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
  await page.evaluate(async () => {
    await window.editorLab.reset("Before\n\n***\n\nAfter");
    document.documentElement.dataset.documentDecorations = "latex";
    window.editorLab.focus(0, 0);
  });
  const hr = page.locator('[data-pane="0"] .axiom-prose hr');
  await expect(hr).toBeVisible();
  const s = await hr.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      top: s.borderTopStyle,
      bottom: s.borderBottomStyle,
      height: s.height,
      radius: s.borderRadius,
    };
  });
  expect(s).toEqual({
    top: "solid",
    bottom: "solid",
    height: "4px",
    radius: "0px",
  });
  expect(
    await page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
  ).toEqual(["Before\n\n***\n\nAfter", "Before\n\n***\n\nAfter"]);
  await page.evaluate(async () => {
    await window.editorLab.reset(
      "Before[^a]\n\n***\n\nAfter\n\n[^a]: A footnote.",
    );
    window.editorLab.mode(0, "read");
  });
  const reading = page.locator('[data-pane="0"]');
  await expect(reading.locator(".footnotes hr")).toHaveCount(1);
  expect(
    await reading
      .locator(".footnotes hr")
      .evaluate((el) => getComputedStyle(el).height),
  ).not.toBe("4px");
  await expect(reading.locator("hr:not(.footnotes hr)")).toHaveCSS(
    "height",
    "4px",
  );
});
