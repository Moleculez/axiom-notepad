import { describe, expect, it } from "vitest";
import {
  cropError,
  cropFromPoints,
  cropWithRatio,
  dragCrop,
  imageSizeError,
  keepsEditableText,
  proportionalSize,
} from "../apps/web/lib/tools/image-geometry";
describe("image geometry", () => {
  const size = { width: 640, height: 480 };
  it.each([
    [0, 100],
    [10.5, 100],
    [NaN, 1],
    [1, Infinity],
    [8193, 1],
    [8192, 8192],
  ])("rejects invalid dimensions %s × %s", (w, h) => {
    expect(imageSizeError(w, h)).not.toBe("");
  });
  it("checks the total layer budget as well as canvas bounds", () => {
    expect(imageSizeError(4000, 4000, 4)).toBe("");
    expect(imageSizeError(4000, 4000, 5)).toContain("layer budget");
    expect(imageSizeError(8192, 1)).toBe("");
  });
  it("normalizes reverse drags and clamps both ends", () => {
    expect(
      cropFromPoints({ x: 800, y: 500 }, { x: -20, y: -10 }, size),
    ).toEqual({ x: 0, y: 0, ...size });
    expect(cropFromPoints({ x: 80, y: 40 }, { x: 10, y: 20 }, size)).toEqual({
      x: 10,
      y: 20,
      width: 70,
      height: 20,
    });
    expect(
      cropFromPoints({ x: 700, y: 600 }, { x: 700, y: 600 }, size),
    ).toEqual({ x: 639, y: 479, width: 1, height: 1 });
  });
  it("crops a centered preset within existing boundaries", () => {
    expect(cropWithRatio({ x: 0, y: 0, ...size }, 1)).toEqual({
      x: 80,
      y: 0,
      width: 480,
      height: 480,
    });
    expect(
      cropWithRatio({ x: 5, y: 8, width: 120, height: 90 }, 16 / 9),
    ).toEqual({ x: 5, y: 19, width: 120, height: 68 });
  });
  it("moves a crop without changing its dimensions", () => {
    const rect = { x: 40, y: 50, width: 120, height: 80 };
    expect(dragCrop(rect, "move", -500, 900, size, 1)).toEqual({
      ...rect,
      x: 0,
      y: 400,
    });
  });
  it.each(["nw", "ne", "sw", "se"] as const)(
    "bounds %s corner drags, including locked aspect ratios",
    (handle) => {
      const rect = { x: 40, y: 50, width: 120, height: 80 };
      for (const dx of [-1000, -20, 0, 30, 1000])
        for (const dy of [-1000, -30, 0, 20, 1000]) {
          const result = dragCrop(rect, handle, dx, dy, size, 1.5);
          expect(cropError(result, size)).toBe("");
          expect(
            Math.abs(result.width - 1.5 * result.height),
          ).toBeLessThanOrEqual(1);
          expect(
            handle.includes("w") ? result.x + result.width : result.x,
          ).toBe(handle.includes("w") ? rect.x + rect.width : rect.x);
          expect(
            handle.includes("n") ? result.y + result.height : result.y,
          ).toBe(handle.includes("n") ? rect.y + rect.height : rect.y);
        }
    },
  );
  it("uses the current document proportions for either dimension", () => {
    expect(proportionalSize(size, "width", 320)).toEqual({
      width: 320,
      height: 240,
    });
    expect(proportionalSize(size, "height", 120)).toEqual({
      width: 160,
      height: 120,
    });
  });
  it.each([
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: 0.1, y: 0 },
    { x: 600, y: 0 },
    { x: 0, y: 470 },
  ])("rejects out-of-bounds crop offsets %j", (offset) => {
    expect(cropError({ ...offset, width: 80, height: 40 }, size)).not.toBe("");
  });
  it("preserves editable text only when geometry remains representable", () => {
    const text = { rotation: 0, scaleX: 1, scaleY: 1, fontSize: 20 };
    expect(keepsEditableText(text, 2, 2)).toBe(true);
    expect(keepsEditableText(text, 0.1, 0.1)).toBe(false);
    expect(keepsEditableText(text, 2, 1)).toBe(false);
    expect(keepsEditableText({ ...text, rotation: 30 }, 1, 1)).toBe(false);
  });
});
