import { test, expect } from "@playwright/test";
test("draft serialization reuses unchanged layers and invalidates paint and undo", async ({
  page,
}) => {
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
  const result = await page.evaluate(async () => {
    const modulePath = "/apps/web/lib/tools/image-engine.ts",
      { ImageDocument } = await import(modulePath);
    const doc = new ImageDocument(20, 20),
      a = doc.addLayer("A");
    doc.addLayer("B");
    const first = await doc.snapshot();
    doc.updateLayer(a.id, { name: "Renamed" });
    const renamed = await doc.snapshot();
    const ctx = a.canvas.getContext("2d"),
      before = ctx.getImageData(0, 0, 20, 20);
    ctx.fillRect(0, 0, 10, 10);
    doc.commitPixels(a, before, { x: 0, y: 0, width: 10, height: 10 });
    const painted = await doc.snapshot();
    doc.undo();
    const undone = await doc.snapshot();
    const decoded = await createImageBitmap(undone.assets[0].blob);
    const restoredCanvas = document.createElement("canvas");
    restoredCanvas.width = restoredCanvas.height = 20;
    const restored = restoredCanvas.getContext("2d")!;
    restored.drawImage(decoded, 0, 0);
    decoded.close();
    return {
      same: first.assets.every(
        (v: any, i: number) => v.blob === renamed.assets[i].blob,
      ),
      changed: first.assets[0].hash !== painted.assets[0].hash,
      other: first.assets[1].blob === painted.assets[1].blob,
      // Firefox can encode a never-painted transparent canvas differently from
      // one cleared by putImageData. Undo promises pixels, not identical PNGs.
      undo: restored
        .getImageData(0, 0, 20, 20)
        .data.every((v: number, i: number) => v === before.data[i]),
      name: renamed.project.layers[0].name,
    };
  });
  expect(result).toEqual({
    same: true,
    changed: true,
    other: true,
    undo: true,
    name: "Renamed",
  });
});
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

test("crop keeps document-space pixels, groups and masks through undo and reopening", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const path = "/apps/web/lib/tools/image-engine.ts";
    const { ImageDocument, imageCanvas } = await import(path);
    const doc = new ImageDocument(60, 40),
      group = doc.addLayer("Group", undefined, "group");
    group.x = 4;
    group.y = 2;
    group.opacity = 0.5;
    const layer = doc.addLayer("Rotated masked layer");
    layer.parent = group.id;
    layer.x = 2;
    layer.rotation = 90;
    const ctx = layer.canvas.getContext("2d");
    ctx.fillStyle = "#e04030";
    ctx.fillRect(12, 8, 20, 16);
    ctx.fillStyle = "#2080d0";
    ctx.fillRect(32, 8, 15, 16);
    layer.mask = imageCanvas(60, 40);
    layer.mask.getContext("2d").fillRect(10, 0, 34, 40);
    doc.selection = {
      kind: "rectangle",
      points: [
        { x: 10, y: 8 },
        { x: 40, y: 28 },
      ],
      invert: false,
      feather: 0,
    };
    const expected = Array.from(
      doc
        .render(imageCanvas(60, 40))
        .getContext("2d")
        .getImageData(10, 8, 30, 20).data,
    );
    const pixels = () =>
      Array.from(
        doc
          .render(imageCanvas(doc.width, doc.height))
          .getContext("2d")
          .getImageData(0, 0, doc.width, doc.height).data,
      );
    doc.resize(30, 20, { x: 10, y: 8 });
    const cropped = pixels();
    doc.undo();
    const undo = {
      width: doc.width,
      height: doc.height,
      rotation: layer.rotation,
      x: group.x,
      selection: doc.selection?.points,
    };
    doc.redo();
    const redone = pixels();
    const reopened = await ImageDocument.open(
      await (await doc.bundle()).arrayBuffer(),
    );
    return {
      expected,
      cropped,
      undo,
      redone,
      reopened: Array.from(
        reopened
          .render(imageCanvas(30, 20))
          .getContext("2d")
          .getImageData(0, 0, 30, 20).data,
      ),
      layers: reopened.layers.map((l: any) => [l.name, l.kind, !!l.mask]),
      parentRetained: reopened.layers[1].parent === reopened.layers[0].id,
    };
  });
  expect(result.expected.some((v) => Number(v) > 0)).toBe(true);
  expect(result.cropped).toEqual(result.expected);
  expect(result.redone).toEqual(result.expected);
  expect(result.reopened).toEqual(result.expected);
  expect(result.undo).toEqual({
    width: 60,
    height: 40,
    rotation: 90,
    x: 4,
    selection: [
      { x: 10, y: 8 },
      { x: 40, y: 28 },
    ],
  });
  expect(result.parentRetained).toBe(true);
  expect(result.layers).toEqual([
    ["Group", "group", false],
    ["Rotated masked layer", "raster", true],
  ]);
});

test("non-proportional resize preserves rotated pixel geometry and can be undone", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const path = "/apps/web/lib/tools/image-engine.ts",
      { ImageDocument, imageCanvas } = await import(path);
    const doc = new ImageDocument(40, 30),
      layer = doc.addLayer("Measured pixels");
    layer.canvas.getContext("2d").fillRect(8, 7, 12, 10);
    layer.rotation = 90;
    layer.x = 2;
    const original = doc.render(imageCanvas(40, 30));
    const expected = imageCanvas(80, 30),
      ctx = expected.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(original, 0, 0, 80, 30);
    doc.resize(80, 30, undefined, "pixelated");
    const actual = Array.from(
      doc
        .render(imageCanvas(80, 30))
        .getContext("2d")
        .getImageData(0, 0, 80, 30).data,
    );
    doc.undo();
    return {
      expected: Array.from(ctx.getImageData(0, 0, 80, 30).data),
      actual,
      undo: [doc.width, doc.height, layer.rotation, layer.x],
    };
  });
  expect(result.actual).toEqual(result.expected);
  expect(result.undo).toEqual([40, 30, 90, 2]);
});

test("resize updates editable text metadata and restores transformed text on undo", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const path = "/apps/web/lib/tools/image-engine.ts",
      { ImageDocument } = await import(path);
    const doc = new ImageDocument(120, 80);
    doc.setText(undefined, "Research", 16, "#123456", "Inter", { x: 8, y: 10 });
    const text = doc.active;
    doc.resize(240, 160);
    const resized = {
      kind: text.kind,
      size: text.fontSize,
      origin: text.textOrigin,
    };
    const reopened = await ImageDocument.open(
      await (await doc.bundle()).arrayBuffer(),
    );
    doc.undo();
    text.rotation = 90;
    doc.resize(60, 40, { x: 4, y: 6 });
    const croppedKind = text.kind;
    doc.undo();
    return {
      resized,
      reopened: reopened.active.kind,
      croppedKind,
      undone: {
        kind: text.kind,
        text: text.text,
        rotation: text.rotation,
        size: text.fontSize,
        origin: text.textOrigin,
      },
    };
  });
  expect(result.resized).toEqual({
    kind: "text",
    size: 32,
    origin: { x: 16, y: 20 },
  });
  expect(result.reopened).toBe("text");
  expect(result.croppedKind).toBe("raster");
  expect(result.undone).toEqual({
    kind: "text",
    text: "Research",
    rotation: 90,
    size: 16,
    origin: { x: 8, y: 10 },
  });
});

test("invalid crops and failed allocations leave every layer and revision unchanged", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const path = "/apps/web/lib/tools/image-engine.ts",
      { ImageDocument } = await import(path);
    const doc = new ImageDocument(20, 20);
    doc.addLayer("A");
    doc.addLayer("B");
    const revision = doc.revision,
      before = doc.layers.map((l: any) => l.canvas),
      errors: string[] = [];
    for (const args of [
      [0, 2],
      [1.5, 2],
      [8192, 8192],
      [10, 10, { x: -1, y: 0 }],
      [10, 10, { x: 15, y: 15 }],
    ]) {
      try {
        doc.resize(...args);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    const create = document.createElement.bind(document);
    let count = 0;
    document.createElement = ((tag: string, ...rest: any[]) => {
      if (tag === "canvas" && ++count === 3)
        throw new Error("Simulated allocation failure");
      return create(tag, ...rest);
    }) as typeof document.createElement;
    try {
      doc.resize(10, 10);
    } catch (e) {
      errors.push((e as Error).message);
    } finally {
      document.createElement = create;
    }
    doc.resize(20, 20);
    return {
      count: errors.length,
      last: errors.at(-1),
      unchanged:
        doc.revision === revision &&
        doc.layers.every((l: any, i: number) => l.canvas === before[i]) &&
        doc.width === 20 &&
        doc.height === 20,
    };
  });
  expect(result).toEqual({
    count: 6,
    last: "Simulated allocation failure",
    unchanged: true,
  });
});
