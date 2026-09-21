import { expect, test } from "vitest";
import { extractOfficeSource } from "../packages/shared/src/assistant-office";
import { wordFixture, slidesFixture } from "./helpers/office-fixtures";
test("Office evidence is inert text with precise block and slide locators", async () => {
  const word = await extractOfficeSource(
    await (await wordFixture()).generateAsync({ type: "arraybuffer" }),
    "docx",
  );
  expect(word.source).toContain("Energy & evidence");
  expect(word.source).toContain("<script> remains inert");
  expect(word.source).not.toContain("Deleted claim");
  expect(word.locators.length).toBeGreaterThan(3);
  for (const l of word.locators)
    expect(word.source.slice(l.from, l.to)).toContain(l.label);
  const slides = await extractOfficeSource(
    await (await slidesFixture()).generateAsync({ type: "arraybuffer" }),
    "pptx",
  );
  expect(slides.source).toContain("Explain the calibration uncertainty.");
  expect(slides.locators[0].target).toBe("1");
});
