import { describe, it, expect } from "vitest";
import {
  isInitialImageTemplate,
  isInitialImageVersion,
} from "../apps/web/lib/tools/image-initial-state";
import type { ImageDocument } from "../apps/web/lib/tools/image-engine";

function starter() {
  const pixels = new Uint8ClampedArray(8);
  const doc = {
    width: 1200,
    height: 800,
    layers: [
      {
        name: "Layer 1",
        kind: "raster",
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        visible: true,
        locked: false,
        blend: "source-over",
        canvas: {
          width: 1200,
          height: 800,
          getContext: () => ({ getImageData: () => ({ data: pixels }) }),
        },
      },
    ],
  } as unknown as ImageDocument;
  return { doc, pixels };
}
describe("image import starter guard", () => {
  it("recognizes only the generated blank geometry and layer", () => {
    expect(isInitialImageTemplate(starter().doc)).toBe(true);
    const { doc } = starter();
    doc.width = 640;
    expect(isInitialImageTemplate(doc)).toBe(false);
  });
  it("preserves real pixels even when a layer is transparent", () => {
    const { doc, pixels } = starter();
    pixels[3] = 1;
    expect(isInitialImageTemplate(doc)).toBe(false);
    pixels[3] = 0;
    pixels[0] = 1;
    expect(isInitialImageTemplate(doc)).toBe(false);
  });
  it.each([
    { name: "Authored layer" },
    { kind: "text" },
    { x: 1 },
    { rotation: 90 },
    { scaleX: 2 },
    { opacity: 0 },
    { visible: false },
    { locked: true },
    { blend: "multiply" },
    { parent: "group" },
    { mask: {} },
  ])("does not replace an authored blank layer: %j", (change) => {
    const { doc } = starter();
    Object.assign(doc.layers[0], change);
    expect(isInitialImageTemplate(doc)).toBe(false);
  });
  it("preserves multiple layers", () => {
    const { doc } = starter();
    doc.layers.push(doc.layers[0]);
    expect(isInitialImageTemplate(doc)).toBe(false);
  });
  it("requires exactly the original immutable version", () => {
    expect(isInitialImageVersion("first", [{ id: "first", ordinal: 1 }])).toBe(
      true,
    );
    for (const versions of [
      [],
      [{ id: "other", ordinal: 1 }],
      [{ id: "first", ordinal: 2 }],
      [
        { id: "first", ordinal: 1 },
        { id: "other", ordinal: 2 },
      ],
    ])
      expect(isInitialImageVersion("first", versions)).toBe(false);
  });
});
