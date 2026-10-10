import type { MessageId } from "@axiom/i18n";
import type { ImageLayer } from "./image-engine";
import type { CropHandle, CropRect } from "./image-geometry";
import type { MathImageFormat } from "./math-export";

// Presentation only: these labels never become tool IDs, image blend modes,
// filenames, editable values or clipboard MIME types.
export const mathPreviewHints = {
  local: "Copy or download your equation locally",
  svgMarkup: "Copy uses SVG markup · Download saves the vector file",
  svg: "Vector artwork · sharp at any size",
  jpegPng: "JPG download · clipboard uses opaque PNG",
  jpeg: "JPG uses your paper color · no transparency",
  png: "PNG image · ready for documents and slides",
} as const satisfies Record<string, MessageId>;

export function mathPreviewHint(
  format: MathImageFormat,
  mime: string,
): MessageId {
  return format === "svg"
    ? mime === "text/plain"
      ? mathPreviewHints.svgMarkup
      : mathPreviewHints.svg
    : format === "jpeg"
      ? mime === "image/png"
        ? mathPreviewHints.jpegPng
        : mathPreviewHints.jpeg
      : mathPreviewHints.png;
}

export const imageCropActions = {
  move: "Move crop selection",
  nw: "Resize crop from top left",
  ne: "Resize crop from top right",
  sw: "Resize crop from bottom left",
  se: "Resize crop from bottom right",
} as const satisfies Record<CropHandle, MessageId>;

export const imageGeometryFields = {
  x: "Left",
  y: "Top",
  width: "Width",
  height: "Height",
} as const satisfies Record<keyof CropRect, MessageId>;

export const imageToolMessages = {
  move: "Move layer (V)",
  hand: "Pan (H)",
  selection: "Rectangular selection (M)",
  "ellipse-selection": "Elliptical selection",
  lasso: "Lasso selection (L)",
  brush: "Brush (B)",
  eraser: "Eraser (E)",
  clone: "Clone stamp (S) · Alt-click to sample",
  heal: "Sampled healing · Alt-click to sample",
  eyedropper: "Eyedropper (I)",
  text: "Text (T)",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  arrow: "Arrow",
} as const satisfies Record<string, MessageId>;

// Compact labels belong to the same tool registry, not to an English substring
// of the shortcut tooltip. Neither set of labels is an engine identifier.
export const imageToolNames = {
  move: "Move layer",
  hand: "Pan",
  selection: "Rectangular selection",
  "ellipse-selection": "Elliptical selection",
  lasso: "Lasso selection",
  brush: "Brush",
  eraser: "Eraser",
  clone: "Clone stamp",
  heal: "Sampled healing",
  eyedropper: "Eyedropper",
  text: "Text",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  arrow: "Arrow",
} as const satisfies Record<keyof typeof imageToolMessages, MessageId>;

export const imageBlendMessages = {
  "source-over": "Normal",
  multiply: "Multiply",
  screen: "Screen blend",
  overlay: "Overlay blend",
  darken: "Darken",
  lighten: "Lighten",
  "color-dodge": "Color dodge",
  "color-burn": "Color burn",
  "hard-light": "Hard light",
  "soft-light": "Soft light",
  difference: "Difference blend",
  exclusion: "Exclusion blend",
  hue: "Hue",
  saturation: "Saturation",
  color: "Color",
  luminosity: "Luminosity",
} as const satisfies Record<ImageLayer["blend"], MessageId>;

export const imageAdjustmentMessages = {
  brightness: "Brightness",
  contrast: "Contrast",
  exposure: "Exposure",
  saturation: "Saturation",
  levels: "Levels adjustment",
  curves: "Curves adjustment",
  blur: "Blur",
  sharpen: "Sharpen",
  grayscale: "Grayscale",
  invert: "Invert colors",
} as const satisfies Record<string, MessageId>;

export function imageAdjustmentMessage(id: string): MessageId {
  return Object.hasOwn(imageAdjustmentMessages, id)
    ? imageAdjustmentMessages[id as keyof typeof imageAdjustmentMessages]
    : "Adjustment";
}
