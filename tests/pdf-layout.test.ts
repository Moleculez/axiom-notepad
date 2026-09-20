import { describe, it, expect } from "vitest";
import {
  pdfPageLayout,
  pdfPageAtOffset,
} from "../packages/shared/src/pdf-layout";
describe("PDF virtual layout", () => {
  it("finds a page without mounting all 1000 shells", () => {
    const layout = pdfPageLayout(1000, new Map(), 612, 792, 1, "continuous");
    expect(layout.pages).toHaveLength(1000);
    expect(pdfPageAtOffset(layout, layout.pages[800].top + 40)?.page).toBe(801);
  });
  it("handles mixed-size facing rows and prefers their left page", () => {
    const layout = pdfPageLayout(
      3,
      new Map([[2, { width: 100, height: 200 }]]),
      1216,
      800,
      1,
      "facing",
    );
    expect(layout.pages[0].top).toBe(layout.pages[1].top);
    expect(layout.pages[2].top).toBe(828);
    expect(pdfPageAtOffset(layout, 40)?.page).toBe(1);
  });
});
