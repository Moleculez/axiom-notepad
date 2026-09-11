import { rasterizeSvg } from "./download";

export type MathImageFormat = "svg" | "png" | "jpeg";
export const mathImageLabel = { svg: "SVG", png: "PNG", jpeg: "JPG" } as const;
export type MathImageSettings = {
  foreground: string;
  background: string;
  transparent: boolean;
  scale: number;
};

/** Capture the current render synchronously, before any clipboard/encoding await.
 * Never export the previous equation while a new worker result is pending. */
export function captureMathPreview(
  preview: HTMLElement | null,
  request: string,
  settings: Pick<
    MathImageSettings,
    "foreground" | "background" | "transparent"
  >,
) {
  const rendered = preview?.querySelector<HTMLElement>("[data-math-request]");
  if (
    !rendered ||
    rendered.dataset.mathRequest !== request ||
    rendered.dataset.mathState !== "ready"
  )
    throw new Error(
      "Wait for a valid math preview before copying or exporting.",
    );
  const original = rendered.querySelector("svg");
  if (!original) throw new Error("No rendered equation is available.");
  const { width, height } = original.getBoundingClientRect();
  if (![width, height].every((n) => Number.isFinite(n) && n > 0))
    throw new Error("The equation preview is empty or not visible.");
  const svg = original.cloneNode(true) as SVGSVGElement;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("color", settings.foreground);
  svg.style.color = settings.foreground;
  if (!settings.transparent) {
    const box = original.viewBox.baseVal;
    const paper = original.ownerDocument.createElementNS(
      svg.namespaceURI,
      "rect",
    );
    for (const [name, value] of Object.entries({
      x: box.x,
      y: box.y,
      width: box.width || width,
      height: box.height || height,
      fill: settings.background,
    }))
      paper.setAttribute(name, String(value));
    svg.insertBefore(paper, svg.firstChild);
  }
  const math = rendered.querySelector("math")?.cloneNode(true) as
    Element | undefined;
  math?.setAttribute("xmlns", "http://www.w3.org/1998/Math/MathML");
  return {
    svg: new XMLSerializer().serializeToString(svg),
    math: math ?? null,
    width,
    height,
  };
}

export function mathImageBlob(
  svg: string,
  format: MathImageFormat,
  settings: Pick<MathImageSettings, "scale" | "transparent" | "background">,
) {
  return format === "svg"
    ? Promise.resolve(new Blob([svg], { type: "image/svg+xml" }))
    : rasterizeSvg(
        svg,
        settings.scale,
        format === "jpeg" || !settings.transparent
          ? settings.background
          : undefined,
        `image/${format}`,
      );
}

/** Native image formats vary by browser. Never disguise a PNG as JPEG/SVG. */
export function mathClipboardPlan(
  format: MathImageFormat,
  supports: (mime: string) => boolean,
) {
  if (format === "svg")
    return supports("image/svg+xml")
      ? { mime: "image/svg+xml", notice: "SVG copied." }
      : {
          mime: "text/plain",
          notice: "SVG markup copied. Download SVG for a vector file.",
        };
  if (format === "jpeg" && supports("image/jpeg"))
    return { mime: "image/jpeg", notice: "JPG copied." };
  return {
    mime: "image/png",
    notice:
      format === "jpeg"
        ? "Copied as an opaque PNG because this browser cannot copy JPG. Download keeps JPG."
        : "PNG copied.",
  };
}

export function clipboardSupports(mime: string) {
  return (
    typeof ClipboardItem !== "undefined" &&
    (typeof ClipboardItem.supports === "function"
      ? ClipboardItem.supports(mime)
      : ["image/png", "text/plain", "text/html"].includes(mime))
  );
}

export async function copyMathImage(
  svg: string,
  format: MathImageFormat,
  settings: MathImageSettings,
) {
  const plan = mathClipboardPlan(format, clipboardSupports);
  if (plan.mime === "text/plain") {
    if (!navigator.clipboard?.writeText)
      throw new Error("Clipboard is unavailable. Use Download SVG instead.");
    await navigator.clipboard.writeText(svg);
  } else {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
      throw new Error("Image clipboard is unavailable. Use Download instead.");
    // Start the write in the click's user activation, passing a promise rather
    // than awaiting rasterization first (required by Safari).
    const image = mathImageBlob(
      svg,
      plan.mime === "image/png" ? "png" : format,
      format === "jpeg" ? { ...settings, transparent: false } : settings,
    );
    void image.catch(() => {}); // A permission denial can happen before encoding finishes.
    const item = new ClipboardItem({
      [plan.mime]: image,
      ...(format === "svg"
        ? { "text/plain": new Blob([svg], { type: "text/plain" }) }
        : {}),
    });
    await navigator.clipboard.write([item]);
  }
  return plan.notice;
}
