import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import sharp from "sharp";
import BrandMark from "../apps/web/components/BrandMark";
import {
  brandColors,
  brandPaths,
  brandSvg,
  brandVersion,
} from "../packages/shared/src/brand";

describe("connected-knowledge identity", () => {
  it("uses the same original paths in app and vector exports without editable text", () => {
    const html = renderToStaticMarkup(createElement(BrandMark));
    for (const d of brandPaths) {
      expect(html).toContain(d);
      expect(brandSvg()).toContain(d);
    }
    expect(html).toContain('aria-hidden="true"');
    expect(brandSvg()).not.toContain("<text");
    expect(() => brandSvg({ color: 'url("external")' })).toThrow();
  });
  it("keeps PWA foreground inside its circular maskable safe zone", async () => {
    const { data, info } = await sharp(
      Buffer.from(
        brandSvg({
          tile: true,
          color: brandColors.paper,
          background: brandColors.ink,
        }),
      ),
    )
      .resize(512, 512)
      .raw()
      .toBuffer({ resolveWithObject: true });
    let ink = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * info.channels;
        if (data[offset] > 150) {
          ink++;
          expect(Math.hypot(x - 256, y - 256)).toBeLessThan(512 * 0.4);
        }
      }
    expect(ink).toBeGreaterThan(1000);
  });
  it("ships matching versioned icons and only current PWA shortcuts", () => {
    const manifest = JSON.parse(
      readFileSync("apps/web/public/manifest.webmanifest", "utf8"),
    );
    expect(
      manifest.icons.every((i: { src: string }) =>
        i.src.endsWith(`?v=${brandVersion}`),
      ),
    ).toBe(true);
    expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual([
      "/workbench/explorer",
      "/workbench/workspaces",
      "/workbench/settings/data",
    ]);
    expect(readFileSync("apps/web/public/icon.svg", "utf8")).toBe(
      brandSvg({
        tile: true,
        color: brandColors.paper,
        background: brandColors.ink,
      }),
    );
  });
});
