import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { themePacks } from "../packages/shared/src/theme-packs";
import {
  themePackContrast,
  themePackManifestSchema,
  validateThemePackCss,
} from "../packages/shared/src/theme-pack-validation";
import {
  appearanceForClient,
  defaults,
  paletteFor,
  preferencesSchema,
  presets,
} from "../packages/shared/src/appearance";
describe("trusted theme contracts", () => {
  for (const pack of themePacks)
    it(`${pack.name} has paired readable palettes and scoped CSS`, () => {
      expect(themePackManifestSchema.safeParse(pack).success).toBe(true);
      expect(
        validateThemePackCss(readFileSync(pack.css, "utf8"), pack.id),
      ).toEqual([]);
      for (const check of themePackContrast(pack))
        expect(
          check.ratio,
          `${check.mode} ${check.label}`,
        ).toBeGreaterThanOrEqual(check.minimum);
    });
  it.each([
    "body { color: red; }",
    '[data-theme-pack="paper-research"], button { color: var(--text); }',
    '@import "https://example.org/a.css";',
    '[data-theme-pack="paper-research"] .card { display: none; }',
    '[data-theme-pack="paper-research"] button { color: var(--text) !important; }',
    '[data-theme-pack="paper-research"] .card { background-color: url(https://example.org); }',
    '[data-theme-pack="paper-research"] input { font-family: Arial; }',
  ])("rejects unsafe stylesheet %s", (css) =>
    expect(validateThemePackCss(css, "paper-research").length).toBeGreaterThan(
      0,
    ),
  );
  it("keeps user overrides and high-contrast bases ahead of pack colors", () => {
    const p = preferencesSchema.parse({
      ...defaults,
      themePack: "paper-research",
      lightColors: { accent: "#123456" },
      proseSize: 25,
    });
    expect(paletteFor(p, false)).toMatchObject({
      ...themePacks[0].palettes.light,
      accent: "#123456",
    });
    expect(p.proseSize).toBe(25);
    expect(
      paletteFor(
        { ...p, lightPreset: "lightContrast", lightColors: {} },
        false,
      ),
    ).toEqual(presets.lightContrast.colors);
  });
  it("does not allow a scoped selector to reach a sibling outside its boundary", () => {
    expect(
      validateThemePackCss(
        '[data-theme-pack="paper-research"] ~ .other { color: var(--text); }',
        "paper-research",
      ).length,
    ).toBeGreaterThan(0);
  });
  it("upgrades v4 safely, but refuses to flatten an active pack for old clients", () => {
    const { themePack: _pack, ...old } = defaults;
    expect(preferencesSchema.parse({ ...old, schemaVersion: 4 })).toEqual(
      defaults,
    );
    const req = new Request("http://localhost", {
      headers: { "X-Axiom-Appearance-Schema": "4" },
    });
    expect(
      appearanceForClient(req, { preferences: defaults, version: 1 })
        ?.preferences,
    ).not.toHaveProperty("themePack");
    expect(
      appearanceForClient(req, {
        preferences: { ...defaults, themePack: "technical-slate" },
        version: 1,
      }),
    ).toBeNull();
    expect(() =>
      preferencesSchema.parse({
        ...defaults,
        themePack: "https://untrusted.test/theme.css",
      }),
    ).toThrow();
  });
});
