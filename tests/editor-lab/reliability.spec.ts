import { test, expect, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();
const fixture = (eol: string) =>
  [
    "---",
    "title: Reproducibility",
    "authors: [Ada, Emmy]",
    "---",
    "",
    "## Research",
    "",
    "Observation **retains** source[^n].",
    "",
    "> - Parent",
    ">   - [ ] Nested result",
    ">",
    "> $$",
    "> E=mc^2",
    "> $$",
    "",
    "| Model | Result |",
    "| --- | --- |",
    "| A | $x^2$ |",
    "",
    "```python",
    "def result(x):",
    "    return x * x",
    "```",
    "",
    "[^n]: Evidence",
    "    $$",
    "    x^2 + y^2",
    "    $$",
    "",
    '[paper]: https://example.org "Reference"',
    "",
    "After.",
  ].join(eol);
const shared = (page: Page, source: string) =>
  expect
    .poll(() =>
      page.evaluate(() => window.editorLab.snapshot().map((s) => s.source)),
    )
    .toEqual([source, source]);
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(await page.evaluate(() => window.editorLab.recovery())).toEqual([]);
});
for (const eol of ["\n", "\r\n"]) {
  test(`mixed research blocks keep exact ${eol === "\n" ? "LF" : "CRLF"} source through repeated mode changes`, async ({
    page,
  }, info) => {
    const source = fixture(eol);
    await page.evaluate((source) => window.editorLab.reset(source), source);
    const before = await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    );
    for (let round = 0; round < 3; round++) {
      for (const mode of ["source", "read", "write"] as const) {
        await page.evaluate((mode) => window.editorLab.mode(0, mode), mode);
        await shared(page, source);
      }
    }
    expect(
      await page.evaluate(() =>
        window.editorLab.snapshot().map((s) => s.updates),
      ),
    ).toEqual(before);
    await page.evaluate(
      (at) => window.editorLab.focus(0, at),
      source.indexOf("Observation") + "Observation".length,
    );
    await page.keyboard.insertText(" local");
    const edited = source.replace("Observation", "Observation local");
    await shared(page, edited);
    await page.evaluate(
      (eol) => window.editorLab.remote(1, 0, 0, `Peer${eol}${eol}`),
      eol,
    );
    await page.keyboard.press("ControlOrMeta+z");
    await shared(page, `Peer${eol}${eol}` + source);
    await page.screenshot({
      path: info.outputPath(`mixed-${eol === "\n" ? "lf" : "crlf"}.png`),
    });
  });
}
for (const opener of ["```python", "$$", "\\["]) {
  test(`empty ${opener} removal inside a mixed note preserves peers and one-step undo`, async ({
    page,
  }) => {
    const closer =
      opener === "\\[" ? "\\]" : opener.startsWith("`") ? "```" : "$$";
    const prefix = fixture("\n") + "\n\n",
      block = `${opener}\n\n${closer}`;
    const source = prefix + block + "\n\nTail";
    await page.evaluate(
      async ({ source, at }) => {
        await window.editorLab.reset(source);
        window.editorLab.focus(0, at);
      },
      { source, at: prefix.length + opener.length + 1 },
    );
    await page.evaluate(() => {
      const source = window.editorLab.snapshot()[1].source;
      window.editorLab.remote(
        1,
        source.length,
        source.length,
        "\n\nPeer evidence",
      );
    });
    await page.keyboard.press("Backspace");
    await shared(page, prefix + "\n\nTail\n\nPeer evidence");
    await page.keyboard.press("ControlOrMeta+z");
    await shared(page, source + "\n\nPeer evidence");
  });
}
