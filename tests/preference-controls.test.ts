import { describe, it, expect } from "vitest";
import { parseMarkdown, renderDocument } from "../packages/markdown/src/index";
import {
  parseThemeColor,
  preferencesSchema,
  defaults,
} from "../packages/shared/src/appearance";
describe("color text entry", () => {
  it("scratchpad rendering never loads local attachments or external images", () => {
    const html = renderDocument(
      parseMarkdown(
        "![Private file](/api/v1/attachments/00000000-0000-4000-8000-000000000001)\n\n![External](https://example.test/image.png)",
      ),
      { disableImages: true },
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("Image disabled in scratchpad");
  });
  it("canonicalizes HEX and RGB while preserving the stored schema", () => {
    for (const [input, output] of [
      [" #AbC ", "#aabbcc"],
      ["#123456", "#123456"],
      ["rgb(0, 127, 255)", "#007fff"],
    ]) {
      expect(parseThemeColor(input)).toBe(output);
      expect(
        preferencesSchema.safeParse({
          ...defaults,
          lightColors: { accent: output },
        }).success,
      ).toBe(true);
    }
  });
  it("does not commit incomplete, transparent or out-of-range values", () => {
    for (const input of [
      "",
      "#",
      "#ff",
      "#12345678",
      "rgba(0,0,0,0.5)",
      "rgb(256,0,0)",
      "red",
      "url(example)",
    ])
      expect(parseThemeColor(input)).toBeNull();
  });
});
