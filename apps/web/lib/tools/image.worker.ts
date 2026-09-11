type FilterRequest = { image: ImageData; filter: string; amount: number };
self.onmessage = (event: MessageEvent<FilterRequest>) => {
  try {
    const { image, filter, amount } = event.data;
    if (image.width * image.height > 16_000_000 || !Number.isFinite(amount))
      throw new Error("Invalid or oversized filter request.");
    const pixels = image.data;
    if (filter === "blur" || filter === "sharpen") {
      const source = new Uint8ClampedArray(pixels),
        w = image.width,
        h = image.height,
        r =
          filter === "blur" ? Math.max(1, Math.min(12, Math.round(amount))) : 1;
      if (filter === "sharpen") {
        const strength = Math.min(3, Math.max(0, amount / 50));
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const p = (y * w + x) * 4;
            for (let c = 0; c < 3; c++) {
              const left = source[(y * w + Math.max(0, x - 1)) * 4 + c],
                right = source[(y * w + Math.min(w - 1, x + 1)) * 4 + c],
                up = source[(Math.max(0, y - 1) * w + x) * 4 + c],
                down = source[(Math.min(h - 1, y + 1) * w + x) * 4 + c];
              pixels[p + c] =
                source[p + c] * (1 + 4 * strength) -
                strength * (left + right + up + down);
            }
          }
      } else {
        const temp = new Uint8ClampedArray(pixels.length);
        for (let y = 0; y < h; y++)
          for (let c = 0; c < 4; c++) {
            let sum = 0;
            for (let k = -r; k <= r; k++)
              sum += source[(y * w + Math.min(w - 1, Math.max(0, k))) * 4 + c];
            for (let x = 0; x < w; x++) {
              temp[(y * w + x) * 4 + c] = sum / (2 * r + 1);
              sum +=
                source[(y * w + Math.min(w - 1, x + r + 1)) * 4 + c] -
                source[(y * w + Math.max(0, x - r)) * 4 + c];
            }
          }
        for (let x = 0; x < w; x++)
          for (let c = 0; c < 4; c++) {
            let sum = 0;
            for (let k = -r; k <= r; k++)
              sum += temp[(Math.min(h - 1, Math.max(0, k)) * w + x) * 4 + c];
            for (let y = 0; y < h; y++) {
              pixels[(y * w + x) * 4 + c] = sum / (2 * r + 1);
              sum +=
                temp[(Math.min(h - 1, y + r + 1) * w + x) * 4 + c] -
                temp[(Math.max(0, y - r) * w + x) * 4 + c];
            }
          }
      }
    } else
      for (let i = 0; i < pixels.length; i += 4) {
        const gray =
          0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
        for (let c = 0; c < 3; c++) {
          let v = pixels[i + c];
          if (filter === "brightness") v += amount * 2.55;
          else if (filter === "exposure") v *= 2 ** (amount / 25);
          else if (filter === "contrast") {
            const f =
              (259 * (amount * 2.55 + 255)) / (255 * (259 - amount * 2.55));
            v = f * (v - 128) + 128;
          } else if (filter === "saturation")
            v = gray + (v - gray) * (1 + amount / 100);
          else if (filter === "grayscale") v = gray;
          else if (filter === "invert") v = 255 - v;
          else if (filter === "levels") {
            const black = Math.max(0, amount),
              white = 255 - Math.max(0, amount);
            v = ((v - black) * 255) / Math.max(1, white - black);
          } else if (filter === "curves")
            v = 255 * (v / 255) ** (2 ** (-amount / 100));
          pixels[i + c] = v;
        }
      }
    self.postMessage({ image }, [image.data.buffer]);
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "Filter failed.",
    });
  }
};
