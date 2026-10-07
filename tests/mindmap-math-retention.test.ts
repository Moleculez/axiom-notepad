import { describe, expect, it } from "vitest";
import { matchMindmapMathPreviews } from "../apps/web/lib/tools/mindmap-media";

describe("mind-map equation preview identities", () => {
  it("matches every old occurrence, not only the ready equations", () => {
    expect(
      matchMindmapMathPreviews(
        [{ request: "x" }, { request: "y" }],
        [{ request: "x" }, { request: "y" }],
      ),
    ).toEqual([0, 1]);
  });

  it("keeps duplicate requests distinct and follows reordered identical expressions", () => {
    expect(
      matchMindmapMathPreviews(
        [{ request: "x" }, { request: "x" }, { request: "y" }],
        [{ request: "y" }, { request: "x" }, { request: "x" }],
      ),
    ).toEqual([2, 0, 1]);
  });

  it("retains a last-good preview when only its TeX content changes", () => {
    expect(
      matchMindmapMathPreviews(
        [
          { request: "x", from: 0 },
          { request: "z", from: 8 },
        ],
        [
          { request: "y^2", from: 0 },
          { request: "z", from: 10 },
        ],
        "$x$ and $z$",
        "$y^2$ and $z$",
      ),
    ).toEqual([0, 1]);
  });

  it("never lends an unrelated snapshot to an inserted equation", () => {
    expect(
      matchMindmapMathPreviews(
        [{ request: "x", from: 0 }],
        [
          { request: "a", from: 0 },
          { request: "x", from: 4 },
        ],
        "$x$",
        "$a$ $x$",
      ),
    ).toEqual([undefined, 0]);
  });

  it("does not retain an equation replaced together with its delimiters", () => {
    expect(
      matchMindmapMathPreviews(
        [{ request: "x", from: 0 }],
        [{ request: "y", from: 2 }],
        "$x$",
        "a $y$",
      ),
    ).toEqual([undefined]);
  });

  it("retains source-identical equations when owner macros or numbering change", () => {
    expect(
      matchMindmapMathPreviews(
        [{ request: "old macros", from: 0 }],
        [{ request: "new macros", from: 0 }],
        "$$\nx\n$$\n",
        "$$\nx\n$$\n",
      ),
    ).toEqual([0]);
  });
});
