import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test("artboard selections follow transformed layers and text stays editable after recovery", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const modulePath = "/apps/web/lib/tools/image-engine.ts";
    const { ImageDocument, imageCanvas, layerMatrix } = await import(
      modulePath
    );
    const doc = new ImageDocument(40, 30),
      layer = doc.addLayer("Moved");
    layer.canvas.getContext("2d").fillRect(0, 0, 40, 30);
    doc.updateLayer(layer.id, { x: 10 });
    doc.selection = {
      kind: "rectangle",
      points: [
        { x: 10, y: 0 },
        { x: 15, y: 30 },
      ],
      invert: false,
      feather: 0,
    };
    doc.addMask();
    const out = doc.render(imageCanvas(40, 30)).getContext("2d");
    const shown = out.getImageData(12, 4, 1, 1).data[3],
      hidden = out.getImageData(18, 4, 1, 1).data[3];
    layer.mask = undefined;
    await doc.filter("invert", 0);
    const selected = Array.from(
        layer.canvas.getContext("2d").getImageData(2, 4, 1, 1).data,
      ),
      outside = Array.from(
        layer.canvas.getContext("2d").getImageData(8, 4, 1, 1).data,
      );
    const local = new DOMPoint(12, 4).matrixTransform(
      layerMatrix(layer).inverse(),
    );
    doc.selection = null;
    doc.setText(undefined, "α = β", 16, "#123456", "Source Serif 4", {
      x: 1,
      y: 2,
    });
    const text = doc.active;
    doc.setText(text, "γ = δ", 20, "#123456", "Inter", { x: 1, y: 2 });
    doc.undo();
    const undo = text.text;
    doc.redo();
    const loaded = await ImageDocument.open(
      await (await doc.bundle()).arrayBuffer(),
    );
    return {
      shown,
      hidden,
      selected,
      outside,
      local: [local.x, local.y],
      undo,
      text: loaded.active.text,
      font: loaded.active.fontFamily,
      origin: loaded.active.textOrigin,
    };
  });
  expect(result).toMatchObject({
    shown: 255,
    hidden: 0,
    selected: [255, 255, 255, 255],
    outside: [0, 0, 0, 255],
    local: [2, 4],
    undo: "α = β",
    text: "γ = δ",
    font: "Inter",
    origin: { x: 1, y: 2 },
  });
});
test("layer pixels, masks, region undo and bundles round-trip without modifying an original", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const modulePath = "/apps/web/lib/tools/image-engine.ts",
      { ImageDocument, imageCanvas } = await import(modulePath);
    const doc = new ImageDocument(40, 30),
      layer = doc.addLayer("Red");
    const ctx = layer.canvas.getContext("2d");
    const before = ctx.getImageData(0, 0, 40, 30);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(2, 3, 10, 9);
    doc.commitPixels(layer, before, { x: 2, y: 3, width: 10, height: 9 });
    const alpha = () => ctx.getImageData(4, 4, 1, 1).data[3];
    const painted = alpha();
    doc.undo();
    const undone = alpha();
    doc.redo();
    const redone = alpha();
    doc.selection = {
      kind: "rectangle",
      points: [
        { x: 0, y: 0 },
        { x: 7, y: 30 },
      ],
      invert: false,
      feather: 0,
    };
    doc.addMask();
    const output = doc.render(imageCanvas(40, 30)).getContext("2d");
    const visible = output.getImageData(4, 4, 1, 1).data[3],
      hidden = output.getImageData(10, 4, 1, 1).data[3];
    const bundle = await doc.bundle(),
      reopened = await ImageDocument.open(await bundle.arrayBuffer());
    const restored = reopened
      .render(imageCanvas(40, 30))
      .getContext("2d")
      .getImageData(0, 0, 40, 30).data;
    return {
      painted,
      undone,
      redone,
      visible,
      hidden,
      layers: reopened.layers.length,
      name: reopened.layers[0].name,
      pixels: Array.from(restored),
      original: Array.from(output.getImageData(0, 0, 40, 30).data),
    };
  });
  expect(result.painted).toBe(255);
  expect(result.undone).toBe(0);
  expect(result.redone).toBe(255);
  expect(result.visible).toBe(255);
  expect(result.hidden).toBe(0);
  expect(result.layers).toBe(1);
  expect(result.name).toBe("Red");
  expect(result.pixels).toEqual(result.original);
});
test("pixel workers apply reversible filters and PSD retains common raster layers", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const modulePath = "/apps/web/lib/tools/image-engine.ts",
      psdPath = "/apps/web/lib/tools/image-psd.ts",
      { ImageDocument, imageCanvas } = await import(modulePath),
      { importPsd, exportPsd } = await import(psdPath);
    const doc = new ImageDocument(20, 20),
      layer = doc.addLayer("Pixels"),
      ctx = layer.canvas.getContext("2d");
    ctx.fillStyle = "rgb(30,60,90)";
    ctx.fillRect(0, 0, 20, 20);
    await doc.filter("invert", 0);
    const inverted = Array.from(ctx.getImageData(2, 2, 1, 1).data);
    doc.undo();
    const original = Array.from(ctx.getImageData(2, 2, 1, 1).data);
    const group = doc.addLayer("Group", undefined, "group");
    layer.parent = group.id;
    group.opacity = 0.5;
    const file = await exportPsd(doc),
      loaded = await importPsd(await file.arrayBuffer());
    const first = doc
        .render(imageCanvas(20, 20))
        .getContext("2d")
        .getImageData(2, 2, 1, 1).data,
      second = loaded.doc
        .render(imageCanvas(20, 20))
        .getContext("2d")
        .getImageData(2, 2, 1, 1).data;
    return {
      inverted,
      original,
      first: [...first],
      second: [...second],
      layers: loaded.doc.layers.map((l: any) => l.name),
    };
  });
  expect(result.inverted).toEqual([225, 195, 165, 255]);
  expect(result.original).toEqual([30, 60, 90, 255]);
  expect(result.layers).toContain("Pixels");
  expect(Math.abs(result.first[3] - result.second[3])).toBeLessThanOrEqual(1);
});
test("rejects unsupported PSD depth and unreasonable image dimensions before allocating", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const modulePath = "/apps/web/lib/tools/image-engine.ts",
      psdPath = "/apps/web/lib/tools/image-psd.ts",
      { ImageDocument } = await import(modulePath),
      { importPsd } = await import(psdPath);
    const errors: string[] = [];
    try {
      new ImageDocument(8192, 8192);
    } catch (e) {
      errors.push((e as Error).message);
    }
    const header = new ArrayBuffer(26),
      view = new DataView(header);
    view.setUint32(0, 0x38425053);
    view.setUint16(4, 1);
    view.setUint16(22, 16);
    view.setUint16(24, 3);
    try {
      await importPsd(header);
    } catch (e) {
      errors.push((e as Error).message);
    }
    return errors;
  });
  expect(result).toHaveLength(2);
  expect(result[1]).toContain("8-bit RGB");
});
