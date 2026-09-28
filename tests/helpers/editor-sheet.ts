import { expect, type Locator } from "@playwright/test";

export const sheetSpecimen = [
  "---",
  "title: Research notes",
  "author: Ada",
  "---",
  "",
  "# One continuous sheet",
  "",
  "Compare the [reference study][study].",
  "",
  '[study]: https://example.org/research "A reproducible baseline"',
  "",
  "| Quantity | Meaning |",
  "| --- | --- |",
  "| E | Energy |",
  "",
  "```python",
  "def energy(mass):",
  "    return mass * 299792458 ** 2",
  "```",
  "",
  "$$",
  "E = mc^2",
  "$$",
  "",
  "Continue writing here.",
].join("\n");

/** Check the field itself, not just its attractive-looking outer table. */
export async function expectSheetField(field: Locator) {
  await expect(field).toHaveAttribute("data-editor-field", /cell|inline/);
  await expect(field).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(field).toHaveCSS("border-width", "0px");
  await expect(field).toHaveCSS("border-radius", "0px");
  await expect(field).toHaveCSS("box-shadow", "none");
  await expect(field).toHaveCSS("transition-duration", "0s");
}

export async function expectSheetBlock(block: Locator) {
  const layers = block.locator(
    ".axiom-block-controls, .axiom-block-preview, .axiom-block-source, .cm-editor, .cm-scroller, .cm-content, .cm-gutters",
  );
  await expect(block).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(await layers.count()).toBeGreaterThanOrEqual(6);
  for (const layer of await layers.all())
    await expect(layer).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
}
