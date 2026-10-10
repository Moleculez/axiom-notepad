import { readFile } from "node:fs/promises";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTranslator,
  englishMessages,
  formatNumber,
  locales,
  type Catalog,
} from "../packages/i18n/src/index";
import { localeRuntime } from "../packages/i18n/src/client";
import { uiText } from "../packages/i18n/src/react";
import { requiredTranslations } from "../packages/i18n/src/translation-coverage";
import ImageGeometryDialog, {
  type ImageGeometrySource,
} from "../apps/web/components/tools/ImageGeometryDialog";
import MathPreviewActions from "../apps/web/components/tools/MathPreviewActions";
import { blendModes } from "../apps/web/lib/tools/image-engine";
import {
  cropError,
  imageSizeError,
} from "../apps/web/lib/tools/image-geometry";
import { mathClipboardPlan } from "../apps/web/lib/tools/math-export";
import {
  imageAdjustmentMessage,
  imageAdjustmentMessages,
  imageBlendMessages,
  imageCropActions,
  imageGeometryFields,
  imageToolMessages,
  imageToolNames,
  mathPreviewHint,
  mathPreviewHints,
} from "../apps/web/lib/tools/tool-presentation";

const escaped = (value: string) =>
  renderToStaticMarkup(h("span", null, value)).slice(6, -7);

afterEach(async () => {
  await localeRuntime.choose("en");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("specialized tool localization", () => {
  it("guards every closed display registry and preserves engine identifiers", () => {
    const guarded = new Set(Object.values(requiredTranslations).flat());
    for (const registry of [
      imageAdjustmentMessages,
      imageBlendMessages,
      imageCropActions,
      imageGeometryFields,
      imageToolMessages,
      imageToolNames,
      mathPreviewHints,
    ])
      for (const message of Object.values(registry)) {
        expect(Object.hasOwn(englishMessages, message), message).toBe(true);
        expect(guarded.has(message), message).toBe(true);
      }
    expect(Object.keys(imageBlendMessages)).toEqual([...blendModes]);
    expect(Object.keys(imageToolNames)).toEqual(Object.keys(imageToolMessages));
    expect(Object.keys(imageGeometryFields)).toEqual([
      "x",
      "y",
      "width",
      "height",
    ]);
    expect(Object.keys(imageAdjustmentMessages)).toEqual([
      "brightness",
      "contrast",
      "exposure",
      "saturation",
      "levels",
      "curves",
      "blur",
      "sharpen",
      "grayscale",
      "invert",
    ]);
    expect(imageAdjustmentMessage("levels")).toBe("Levels adjustment");
    expect(imageAdjustmentMessage("__proto__")).toBe("Adjustment");
    expect(imageAdjustmentMessage("unknown")).toBe("Adjustment");
  });

  it.each([
    ["svg", false, mathPreviewHints.svgMarkup],
    ["svg", true, mathPreviewHints.svg],
    ["jpeg", false, mathPreviewHints.jpegPng],
    ["jpeg", true, mathPreviewHints.jpeg],
    ["png", false, mathPreviewHints.png],
  ] as const)(
    "describes the actual %s clipboard format (native: %s)",
    (format, supported, expected) => {
      const plan = mathClipboardPlan(format, () => supported);
      expect(mathPreviewHint(format, plan.mime)).toBe(expected);
    },
  );

  it.each(locales)(
    "renders real crop, resize, avatar and equation controls in $id",
    async ({ id }) => {
      const catalog: Catalog = JSON.parse(
        await readFile(`packages/i18n/src/messages/${id}.json`, "utf8"),
      );
      const t = createTranslator(id, catalog);
      vi.stubGlobal("document", {});
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(catalog)),
      );
      await localeRuntime.choose(id);
      // Exercise real components with the client snapshot in static rendering.
      // This is a markup gate, not a replacement for native-dialog browser tests.
      vi.spyOn(localeRuntime, "serverSnapshot").mockImplementation(
        localeRuntime.snapshot,
      );
      const doc: ImageGeometrySource = {
        width: 1001,
        height: 800,
        layers: [],
        selection: null,
        render: vi.fn((canvas) => canvas),
      };
      const onApply = vi.fn();
      const crop = renderToStaticMarkup(
        h(ImageGeometryDialog, {
          doc,
          mode: "crop",
          editable: true,
          onClose: () => {},
          onApply,
        }),
      );
      expect(crop).toContain(escaped(t("Crop image")));
      for (const message of Object.values(imageCropActions))
        expect(crop).toContain(`aria-label="${escaped(t(message))}"`);
      expect(crop).toContain(
        escaped(
          t("{action} · Arrow keys; Shift moves by 10 px", {
            action: t(imageCropActions.nw),
          }),
        ),
      );
      for (const message of [
        "Crop left",
        "Crop top",
        "Width",
        "Height",
      ] as const)
        expect(crop).toContain(`aria-label="${escaped(t(message))}"`);
      for (const value of [
        "free",
        "original",
        "square",
        "landscape",
        "photo",
        "wide",
        "portrait",
        "tall",
      ])
        expect(crop).toContain(`value="${value}"`);
      expect(crop).toContain('value="1001"');
      expect(crop).toContain('value="800"');

      const resize = renderToStaticMarkup(
        h(ImageGeometryDialog, {
          doc,
          mode: "resize",
          editable: true,
          onClose: () => {},
          onApply,
        }),
      );
      expect(resize).toContain(escaped(t("Resize image")));
      for (const scale of [0.25, 0.5, 1, 2])
        expect(resize).toContain(
          escaped(formatNumber(id, scale, { style: "percent" })),
        );
      expect(resize).toContain('value="smooth"');
      expect(resize).toContain('value="pixelated"');
      expect(resize).toContain(
        escaped(
          t("{width, number} × {height, number} px · {megapixels} megapixels", {
            width: 1001,
            height: 800,
            megapixels: formatNumber(id, 0.8008, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
          }),
        ),
      );

      const layer: ImageGeometrySource["layers"][number] = {
        id: "literal-layer-id",
        name: "Settings · 日本語 / {draft}",
        kind: "text",
        canvas: { width: 100, height: 100 } as HTMLCanvasElement,
        x: 0,
        y: 0,
        rotation: 30,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        blend: "source-over",
        visible: true,
        locked: false,
        fontSize: 40,
      };
      const warning = renderToStaticMarkup(
        h(ImageGeometryDialog, {
          doc: { ...doc, layers: [layer, { ...layer, id: "second-layer" }] },
          mode: "resize",
          editable: true,
          onClose: () => {},
          onApply,
        }),
      );
      expect(warning).toContain(
        escaped(
          t(
            "{count, plural, one {# transformed or rescaled text layer will become pixels to preserve appearance. Undo restores editable text.} other {# transformed or rescaled text layers will become pixels to preserve appearance. Undo restores editable text.}}",
            { count: 2 },
          ),
        ),
      );
      expect(layer.rotation).toBe(30);
      expect(layer.name).toBe("Settings · 日本語 / {draft}");

      const avatar = renderToStaticMarkup(
        h(ImageGeometryDialog, {
          doc,
          mode: "crop",
          avatar: true,
          editable: true,
          onClose: () => {},
          onApply,
        }),
      );
      expect(avatar).toContain(escaped(t("Crop profile picture")));
      expect(avatar).toContain(escaped(t("Save photo")));
      expect(avatar).toContain(
        escaped(
          t(
            "Only the selected area is uploaded. Photos are saved at 256 × 256 px with image metadata removed.",
          ),
        ),
      );
      const error = imageSizeError(9000, 800);
      const invalid = renderToStaticMarkup(
        h(ImageGeometryDialog, {
          doc: { ...doc, width: 9000 },
          mode: "resize",
          editable: false,
          onClose: () => {},
          onApply,
        }),
      );
      expect(invalid).toContain(escaped(t(error as keyof Catalog)));
      expect(invalid).toContain(
        escaped(t("Editing access is required to apply changes.")),
      );

      for (const [format, label] of [
        ["svg", "SVG"],
        ["png", "PNG"],
        ["jpeg", "JPG"],
      ] as const) {
        const actions = renderToStaticMarkup(
          h(MathPreviewActions, {
            preview: { current: null },
            format,
            onFormat: () => {},
            request: "request",
            latex: "\\alpha",
            settings: {
              foreground: "#202124",
              background: "#ffffff",
              transparent: true,
              scale: 3,
            },
            onScale: () => {},
            onTransparent: () => {},
            onExport: async () => {},
            onPanel: () => {},
            onError: () => {},
            notify: () => {},
          }),
        );
        expect(actions).toContain(
          `aria-label="${escaped(t("Copy {format}", { format: label }))}"`,
        );
        expect(actions).toContain(
          `aria-label="${escaped(t("Download {format}", { format: label }))}"`,
        );
        for (const value of ["svg", "png", "jpeg"])
          expect(actions).toContain(`value="${value}"`);
        expect(actions).toContain(escaped(t(mathPreviewHints.local)));
      }
      expect(onApply).not.toHaveBeenCalled();
      expect(doc.width).toBe(1001);
      expect(doc.layers).toEqual([]);
    },
  );

  it.each(locales)(
    "keeps authored names and technical units literal in $id",
    async ({ id }) => {
      const catalog = JSON.parse(
        await readFile(`packages/i18n/src/messages/${id}.json`, "utf8"),
      );
      const t = createTranslator(id, catalog);
      const name = "Settings · 日本語 / {draft} \\alpha";
      expect(t("Hide layer {name}", { name })).toContain(name);
      expect(t("Show layer {name}", { name })).toContain(name);
      expect(t("Copy {format}", { format: "SVG" })).toContain("SVG");
      expect(t("Download {format}", { format: "JPG" })).toContain("JPG");
      // Notification display translates only fixed clipboard feedback; helper
      // outputs and MIME plans remain canonical and independently testable.
      vi.stubGlobal("document", {});
      vi.stubGlobal("fetch", async () => Response.json(catalog));
      await localeRuntime.choose(id);
      for (const message of [
        "LaTeX copied, including project macros.",
        "MathML copied.",
        "SVG markup copied. Download SVG for a vector file.",
        "Copied as an opaque PNG because this browser cannot copy JPG. Download keeps JPG.",
      ] as const)
        expect(uiText(message)).toBe(t(message));
      const warning =
        "{count, plural, one {# transformed or rescaled text layer will become pixels to preserve appearance. Undo restores editable text.} other {# transformed or rescaled text layers will become pixels to preserve appearance. Undo restores editable text.}}";
      for (const count of [0, 1, 2, 5, 21, 1001]) {
        expect(t(warning, { count })).toContain(formatNumber(id, count));
        const summary = t(
          "{width, number} × {height, number} · {count, plural, one {# layer} other {# layers}}",
          { width: 1001, height: 800, count },
        );
        expect(summary).toContain(formatNumber(id, 1001));
        expect(summary).toContain(formatNumber(id, count));
      }
      for (const error of [
        imageSizeError(0, 1),
        imageSizeError(4000, 4000, 5),
        cropError(
          { x: -1, y: 0, width: 1, height: 1 },
          { width: 10, height: 10 },
        ),
      ]) {
        expect(Object.hasOwn(englishMessages, error)).toBe(true);
        if (id !== "en") expect(t(error as keyof Catalog)).not.toBe(error);
      }
    },
  );
});
