/** A download is always explicit; never overwrite the resource being edited. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/\x00-\x1f]/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function downloadText(
  value: string,
  name: string,
  type = "text/plain;charset=utf-8",
) {
  downloadBlob(new Blob([value], { type }), name);
}
export async function rasterizeSvg(
  svg: string,
  scale: number,
  background: string | undefined,
  mime = "image/png",
) {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 6)
    throw new Error("Choose an export resolution between 1× and 6×.");
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const width = Math.ceil(img.naturalWidth * scale),
      height = Math.ceil(img.naturalHeight * scale);
    if (!width || !height)
      throw new Error("The equation has no image dimensions.");
    if (width * height > 32_000_000 || width > 32767 || height > 32767)
      throw new Error("Export dimensions exceed the safe 32 megapixel limit.");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d");
    if (!c) throw new Error("Image export is unavailable in this browser.");
    if (background) {
      c.fillStyle = background;
      c.fillRect(0, 0, canvas.width, canvas.height);
    }
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b?.type === mime
            ? resolve(b)
            : reject(new Error("This image format could not be exported.")),
        mime,
        0.95,
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
