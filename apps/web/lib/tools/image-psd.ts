import { ImageDocument, imageCanvas } from "./image-engine";
/** PSD interchange is deliberately restricted to common 8-bit RGB layers. */
export async function importPsd(data: ArrayBuffer) {
  const header = new DataView(data);
  if (
    data.byteLength < 26 ||
    header.getUint32(0) !== 0x38425053 ||
    header.getUint16(4) !== 1 ||
    header.getUint16(22) !== 8 ||
    header.getUint16(24) !== 3
  )
    throw new Error(
      "Only 8-bit RGB PSD files are supported. Convert CMYK, 16/32-bit, PSB and indexed files to RGB PSD first.",
    );
  const width = header.getUint32(18),
    height = header.getUint32(14);
  imageCanvas(width, height);
  if (data.byteLength > 50_000_000)
    throw new Error("PSD import is limited to 50 MB.");
  const { readPsd } = await import("ag-psd"),
    psd = readPsd(data, {
      useImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
      logMissingFeatures: false,
      throwForMissingFeatures: false,
      totalMemoryLimit: 256_000_000,
    });
  const doc = new ImageDocument(width, height),
    warnings = new Set<string>();
  const walk = (layers: NonNullable<typeof psd.children>, parent?: string) => {
    for (const value of layers) {
      if (value.children) {
        const group = doc.addLayer(value.name ?? "Group", undefined, "group");
        group.opacity = value.opacity ?? 1;
        group.visible = !value.hidden;
        if (parent)
          warnings.add("Nested groups were flattened to one group level.");
        walk(value.children, group.id);
        continue;
      }
      const canvas = imageCanvas(width, height),
        ctx = canvas.getContext("2d")!;
      if (value.imageData)
        ctx.putImageData(
          new ImageData(
            new Uint8ClampedArray(value.imageData.data),
            value.imageData.width,
            value.imageData.height,
          ),
          value.left ?? 0,
          value.top ?? 0,
        );
      else if (value.canvas)
        ctx.drawImage(value.canvas, value.left ?? 0, value.top ?? 0);
      const layer = doc.addLayer(value.name ?? "PSD layer", canvas);
      layer.parent = parent;
      layer.opacity = value.opacity ?? 1;
      layer.visible = !value.hidden;
      layer.locked = !!value.protected?.transparency;
      const blend =
        value.blendMode === "normal"
          ? "source-over"
          : (value.blendMode?.replace(/ /g, "-") as typeof layer.blend);
      if (
        blend &&
        [
          "source-over",
          "multiply",
          "screen",
          "overlay",
          "darken",
          "lighten",
          "color-dodge",
          "color-burn",
          "hard-light",
          "soft-light",
          "difference",
          "exclusion",
          "hue",
          "saturation",
          "color",
          "luminosity",
        ].includes(blend)
      )
        layer.blend = blend;
      else if (value.blendMode && value.blendMode !== "normal")
        warnings.add(`Unsupported blend mode ${value.blendMode} uses Normal.`);
      if (value.mask?.imageData) {
        const md = value.mask.imageData,
          m = imageCanvas(width, height),
          mc = m.getContext("2d")!;
        mc.fillStyle = value.mask.defaultColor === 255 ? "#fff" : "transparent";
        if (value.mask.defaultColor === 255) mc.fillRect(0, 0, width, height);
        const pixels = new ImageData(md.width, md.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
          pixels.data[i + 3] = md.data[i];
        }
        mc.putImageData(pixels, value.mask.left ?? 0, value.mask.top ?? 0);
        layer.mask = m;
      }
      if (value.text)
        warnings.add(
          "PSD text is imported as its saved raster appearance; source font/text editing is not preserved.",
        );
      if (value.effects)
        warnings.add(
          "Layer effects may not match Photoshop and are not editable.",
        );
      if (value.placedLayer)
        warnings.add(
          "Smart objects use their saved raster appearance; linked originals are not opened.",
        );
      if (value.adjustment)
        warnings.add(
          "Adjustment layers are not live adjustments; verify the exported appearance.",
        );
    }
  };
  if (psd.children?.length) walk(psd.children);
  else if (psd.imageData) {
    const c = imageCanvas(width, height);
    c.getContext("2d")!.putImageData(
      new ImageData(new Uint8ClampedArray(psd.imageData.data), width, height),
      0,
      0,
    );
    doc.addLayer("Background", c);
  }
  return { doc, warnings: [...warnings] };
}
export async function exportPsd(doc: ImageDocument) {
  const { writePsdUint8Array } = await import("ag-psd");
  const composite = doc.render(imageCanvas(doc.width, doc.height));
  const convert = (l: (typeof doc.layers)[number]): import("ag-psd").Layer => {
    if (l.kind === "group")
      return {
        name: l.name,
        hidden: !l.visible,
        opacity: l.opacity,
        blendMode: (l.blend === "source-over"
          ? "normal"
          : l.blend.replace(/-/g, " ")) as import("ag-psd").BlendMode,
        children: doc.layers
          .filter((child) => child.parent === l.id)
          .map((child) =>
            convert({ ...child, x: child.x + l.x, y: child.y + l.y }),
          ),
      };
    const single = new ImageDocument(doc.width, doc.height);
    single.layers = [
      {
        ...l,
        parent: undefined,
        opacity: 1,
        blend: "source-over",
        visible: true,
      },
    ];
    return {
      name: l.name,
      hidden: !l.visible,
      opacity: l.opacity,
      blendMode: (l.blend === "source-over"
        ? "normal"
        : l.blend.replace(/-/g, " ")) as import("ag-psd").BlendMode,
      canvas: single.render(imageCanvas(doc.width, doc.height)),
    };
  };
  const layers = doc.layers.filter((l) => !l.parent).map(convert);
  return new Blob(
    [
      writePsdUint8Array(
        {
          width: doc.width,
          height: doc.height,
          canvas: composite,
          children: layers,
        },
        { generateThumbnail: true },
      ) as Uint8Array<ArrayBuffer>,
    ],
    { type: "image/vnd.adobe.photoshop" },
  );
}
