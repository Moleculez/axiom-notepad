import { describe, expect, it } from "vitest";
import {
  appearanceVariables,
  contrastRatio,
  defaults,
  deviceSchema,
  mergePreferences,
  modernAppearance,
  normalizePreferenceRecord,
  paletteFor,
  preferencesSchema,
  presets,
  themeFileSchema,
  appearanceForClient,
  APPEARANCE_SCHEMA_HEADER,
  APPEARANCE_SCHEMA,
} from "../packages/shared/src/appearance";
import { applyDocumentStyle } from "../packages/shared/src/editor-looks";
describe("personal appearance", () => {
  it("migrates range guides without restyling v5 and projects safe old-client reads", () => {
    const {
      pdfReader: _pdf,
      minimap: _minimap,
      blockGuides: _guides,
      readingMarkMargin: _margin,
      readingMarkOverview: _overview,
      ...old
    } = defaults;
    const saved = { ...old, schemaVersion: 5, proseSize: 23, radius: 0 };
    const current = preferencesSchema.parse(saved);
    expect(current).toEqual({
      ...saved,
      schemaVersion: APPEARANCE_SCHEMA,
      blockGuides: true,
      readingMarkMargin: true,
      readingMarkOverview: true,
      minimap: defaults.minimap,
      pdfReader: defaults.pdfReader,
    });
    const record = {
      preferences: { ...current, blockGuides: false },
      version: 9,
      previousPreferences: current,
    };
    const response = appearanceForClient(
      new Request("http://localhost/preferences", {
        headers: { [APPEARANCE_SCHEMA_HEADER]: "5" },
      }),
      record,
    );
    expect(response?.preferences).toEqual(saved);
    expect(response?.previousPreferences).toEqual(saved);
    expect(preferencesSchema.parse(record.preferences).blockGuides).toBe(false);
    expect(() =>
      preferencesSchema.parse({ ...defaults, blockGuides: "yes" }),
    ).toThrow();
  });
  it("has readable built-in palettes for text, links, code and chrome", () => {
    for (const p of Object.values(presets))
      for (const [a, b] of [
        ["text", "paper"],
        ["muted", "paper"],
        ["subtle", "paper"],
        ["accent", "paper"],
        ["text", "sidebar"],
        ["muted", "sidebar"],
        ["codeText", "code"],
        ["onAccent", "accent"],
      ] as const)
        expect(
          contrastRatio(p.colors[a], p.colors[b]),
          `${p.name} ${a}/${b}`,
        ).toBeGreaterThanOrEqual(4.5);
  });
  it("provides independent semantic fonts and sizes without CSS injection", () => {
    const p = preferencesSchema.parse({
      ...defaults,
      uiSize: 22,
      proseSize: 30,
      codeSize: 24,
    });
    const css = appearanceVariables(p, false);
    expect(css["--size-ui"]).toBe("1.375rem");
    expect(css["--size-prose"]).toBe("1.875rem");
    expect(css["--size-code"]).toBe("1.5rem");
    expect(css["--font-prose"]).toContain("Source Sans 3");
    expect(() =>
      preferencesSchema.parse({
        ...p,
        uiFont: "url(https://tracker.test/font)",
      }),
    ).toThrow();
    expect(() =>
      preferencesSchema.parse({
        ...p,
        lightColors: { paper: "red;display:none" },
      }),
    ).toThrow();
    expect(() => preferencesSchema.parse({ ...p, proseSize: 400 })).toThrow();
    expect(() =>
      preferencesSchema.parse({ ...p, css: "body{display:none}" }),
    ).toThrow();
  });
  it("restricts device overrides and validates portable palettes", () => {
    expect(deviceSchema.parse({ uiScale: 1.2 })).toEqual({ uiScale: 1.2 });
    expect(() => deviceSchema.parse({ proseFont: "inter" })).toThrow();
    const file = {
      format: "axiom-theme",
      version: 1,
      name: "My palette",
      mode: "light",
      colors: paletteFor(defaults, false),
    };
    expect(themeFileSchema.parse(file).name).toBe("My palette");
    expect(() =>
      themeFileSchema.parse({ ...file, fontUrl: "https://example.com" }),
    ).toThrow();
  });
  it("merges independent offline edits, including individual color tokens", () => {
    const local = {
      ...defaults,
      proseSize: 22,
      lightColors: { accent: "#123456" },
    };
    const remote = {
      ...defaults,
      uiSize: 17,
      lightColors: { paper: "#eeeeee" },
    };
    const result = mergePreferences(defaults, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toMatchObject({
      proseSize: 22,
      uiSize: 17,
      lightColors: { accent: "#123456", paper: "#eeeeee" },
    });
  });
  it("retains conflicting local values for explicit resolution", () => {
    const result = mergePreferences(
      defaults,
      { ...defaults, proseSize: 22 },
      { ...defaults, proseSize: 24 },
    );
    expect(result.conflicts).toEqual(["proseSize"]);
    expect(result.merged.proseSize).toBe(22);
  });
  it("normalizes legacy profiles and snapshots without silently restyling them", () => {
    const legacy = {
      schemaVersion: 1,
      mode: "dark",
      uiSize: 19,
      proseFont: "atkinson",
      darkColors: { paper: "#112233" },
    };
    const normalized = preferencesSchema.parse(legacy);
    expect(normalized).toMatchObject({
      schemaVersion: APPEARANCE_SCHEMA,
      mode: "dark",
      uiFont: "inter",
      headingFont: "sourceSerif",
      proseFont: "atkinson",
      lightPreset: "paper",
      darkPreset: "slate",
      radius: 8,
      material: "solid",
      uiSize: 19,
      darkColors: { paper: "#112233" },
    });
    expect(
      normalizePreferenceRecord({
        preferences: normalized,
        version: 8,
        previousPreferences: normalized,
      }).previousPreferences,
    ).toEqual(normalized);
    expect(() =>
      preferencesSchema.parse({ schemaVersion: APPEARANCE_SCHEMA + 1 }),
    ).toThrow();
  });
  it("upgrades v2 values without restyling and safely negotiates the new font", () => {
    const {
      documentDecorations: _decoration,
      themePack: _pack,
      blockGuides: _guides,
      readingMarkMargin: _margin,
      readingMarkOverview: _overview,
      minimap: _minimap,
      pdfReader: _pdf,
      ...v3
    } = defaults;
    const old = {
      ...v3,
      schemaVersion: 2,
      proseSize: 23,
      uiFont: "inter",
      lightColors: { paper: "#fefefe" },
    };
    const current = preferencesSchema.parse(old);
    expect(current).toEqual({
      ...old,
      schemaVersion: APPEARANCE_SCHEMA,
      blockGuides: true,
      readingMarkMargin: true,
      readingMarkOverview: true,
      minimap: defaults.minimap,
      pdfReader: defaults.pdfReader,
      themePack: "default",
      documentDecorations: "none",
    });
    const legacy = new Request("http://localhost/preferences");
    const modern = new Request("http://localhost/preferences", {
      headers: { [APPEARANCE_SCHEMA_HEADER]: String(APPEARANCE_SCHEMA) },
    });
    const record = { preferences: current, version: 7 };
    expect(appearanceForClient(legacy, record)?.preferences).toEqual(old);
    expect(appearanceForClient(modern, record)).toEqual(record);
    const latex = {
      ...record,
      preferences: { ...current, proseFont: "latinModern" as const },
    };
    expect(appearanceForClient(legacy, latex)).toBeNull();
    expect(appearanceForClient(modern, latex)).toEqual(latex);
    expect(
      appearanceForClient(legacy, {
        ...record,
        previousPreferences: latex.preferences,
      }),
    ).toBeNull();
  });
  it("retains LaTeX ornaments through customization and migrates only the old exact preset", () => {
    const latex = applyDocumentStyle(defaults, "latexArticle");
    const { documentDecorations: _decoration, ...old } = latex;
    expect(preferencesSchema.parse({ ...old, schemaVersion: 3 })).toEqual(
      latex,
    );
    expect(
      preferencesSchema.parse({ ...old, proseSize: 22, schemaVersion: 3 })
        .documentDecorations,
    ).toBe("none");
    const custom = preferencesSchema.parse({
      ...latex,
      proseSize: 22,
      headingFont: "inter",
    });
    expect(custom.documentDecorations).toBe("latex");
    expect(applyDocumentStyle(custom, "journal").documentDecorations).toBe(
      "none",
    );
    const request = new Request("http://localhost/preferences", {
      headers: { [APPEARANCE_SCHEMA_HEADER]: "3" },
    });
    expect(
      appearanceForClient(request, { preferences: latex, version: 1 }),
    ).toBeNull();
    expect(
      appearanceForClient(request, {
        preferences: defaults,
        previousPreferences: latex,
        version: 2,
      }),
    ).toBeNull();
    const plain = { ...latex, documentDecorations: "none" as const };
    const compatible = appearanceForClient(request, {
      preferences: plain,
      version: 3,
    });
    expect(compatible?.preferences.schemaVersion).toBe(3);
    expect(compatible?.preferences).not.toHaveProperty("documentDecorations");
    expect(compatible?.preferences.proseFont).toBe("latinModern");
  });
  it("opts into the modern look without changing reading or accessibility choices", () => {
    const p = preferencesSchema.parse({
      schemaVersion: 1,
      proseSize: 24,
      lineHeight: 2.1,
      motion: "none",
      shadows: "none",
      mode: "dark",
      readingWidth: 91,
      themes: [
        {
          id: "123e4567-e89b-42d3-a456-426614174000",
          name: "Personal",
          mode: "light",
          colors: paletteFor(defaults, false),
        },
      ],
    });
    const modern = modernAppearance(p);
    expect(modern).toMatchObject({
      proseSize: 24,
      lineHeight: 2.1,
      motion: "none",
      shadows: "none",
      mode: "dark",
      readingWidth: 91,
      uiFont: "systemSans",
      headingFont: "systemSans",
      proseFont: "sourceSans",
      lightPreset: "frost",
      darkPreset: "graphite",
      material: "glass",
    });
    expect(modern.themes).toEqual(p.themes);
  });
  it("bounds glass intensity and makes solid and high contrast chrome opaque", () => {
    expect(() =>
      preferencesSchema.parse({ ...defaults, glassIntensity: 101 }),
    ).toThrow();
    expect(() =>
      preferencesSchema.parse({ ...defaults, glassIntensity: -1 }),
    ).toThrow();
    expect(appearanceVariables(defaults, false)["--material-filter"]).toContain(
      "blur",
    );
    for (const p of [
      { ...defaults, material: "solid" as const },
      {
        ...defaults,
        lightPreset: "lightContrast" as const,
        darkPreset: "darkContrast" as const,
      },
    ])
      for (const dark of [true, false]) {
        const css = appearanceVariables(p, dark);
        expect(css["--material-filter"]).toBe("none");
        expect(css["--chrome-background"]).toBe("var(--sidebar)");
      }
  });
});
