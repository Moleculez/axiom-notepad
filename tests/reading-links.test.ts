import { describe, expect, it } from "vitest";
import { readingLinkRoute } from "../apps/web/lib/reading-links";

describe("embedded reading anchor navigation", () => {
  const outline = [{ id: "methods" }];

  it("preserves native non-heading anchors in ordinary documents", () => {
    for (const target of [
      "#eq-result",
      "#fig-result",
      "#fn-detail",
      "#ref-study",
    ])
      expect(readingLinkRoute(target, outline)).toBe("native");
  });

  it("retains the existing document heading callback", () => {
    expect(readingLinkRoute("#methods", outline)).toBe("link");
  });

  it("routes all embedded hash anchors through the host, not the fragment DOM", () => {
    for (const target of [
      "#methods",
      "#eq-result",
      "#fig-result",
      "#fn-detail",
      "#ref-study",
      "#unknown",
    ])
      expect(readingLinkRoute(target, outline, true)).toBe("internal");
  });

  it("does not require a fragment to contain the target heading", () => {
    expect(readingLinkRoute("#methods", [], true)).toBe("internal");
    expect(readingLinkRoute("#methods", [])).toBe("native");
  });

  it("does not intercept logical wiki targets or attachment URLs as internal anchors", () => {
    for (const target of [
      "Other study#Methods",
      "/api/v1/attachments/123",
      "/workbench/notes/123#methods",
    ])
      expect(readingLinkRoute(target, outline, true)).toBe("link");
  });
});
