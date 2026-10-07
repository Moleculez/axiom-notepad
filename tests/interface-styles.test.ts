import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateInterfaceRegistry } from "../scripts/verify/interface-contract";
import {
  interfaceStyleIds,
  interfaceStyles,
  interfaceRecipeTokens,
  interfaceStyleVariables,
  legacyInterfaceStyleId,
  normalizeInterfaceStyleId,
} from "../packages/shared/src/interface-styles";
import {
  appearanceVariables,
  defaults,
} from "../packages/shared/src/appearance";

describe("complete original interface systems", () => {
  it("guards completeness, unsafe values and duplicate structure in the UI gate", () => {
    expect(validateInterfaceRegistry()).toEqual([]);
    const incomplete = interfaceStyles.map((style) => ({
      ...style,
      recipe: { ...style.recipe },
    }));
    delete (incomplete[0].recipe as Record<string, string>)["--field-rule"];
    expect(
      validateInterfaceRegistry(incomplete).some((error) =>
        /incomplete/.test(error.message),
      ),
    ).toBe(true);
    incomplete[1].recipe["--field-rule"] = "url(https://invalid.example)";
    expect(
      validateInterfaceRegistry(incomplete).some((error) =>
        /safe/.test(error.message),
      ),
    ).toBe(true);
    incomplete[2].recipe = { ...incomplete[3].recipe };
    expect(
      validateInterfaceRegistry(incomplete).some((error) =>
        /non-color/.test(error.message),
      ),
    ).toBe(true);
    const sliderOnly = interfaceStyles.map((style) => ({
      ...style,
      recipe: { ...style.recipe },
    }));
    sliderOnly[1].recipe = {
      ...sliderOnly[0].recipe,
      "--slider-track-height": "6px",
      "--slider-thumb-width": "5px",
      "--slider-thumb-height": "20px",
    };
    expect(
      validateInterfaceRegistry(sliderOnly).some((error) =>
        /including fields or selection/.test(error.message),
      ),
    ).toBe(true);
  });
  it("defines one complete safe recipe for every current identity", () => {
    expect(interfaceStyles.map((s) => s.id)).toEqual([...interfaceStyleIds]);
    for (const s of interfaceStyles) {
      expect(Object.keys(s.recipe).sort()).toEqual(
        [...interfaceRecipeTokens].sort(),
      );
      expect(new Set(s.signatures).size).toBe(3);
      expect(s).not.toHaveProperty("reference");
      for (const [key, value] of Object.entries(s.recipe)) {
        expect(key).toMatch(/^--[a-z-]+$/);
        expect(value).not.toMatch(
          /url\s*\(|expression\s*\(|!important|https?:|#[0-9a-f]{3,8}\b/i,
        );
        expect(key).not.toMatch(
          /^--(?:font-|size-|weight-|reading-|shadow$|radius$)/,
        );
      }
      const copy = interfaceStyleVariables(s.id);
      copy["--field-rule"] = "changed";
      expect(interfaceStyleVariables(s.id)["--field-rule"]).not.toBe("changed");
    }
    expect(() => interfaceStyleVariables("unknown" as any)).toThrow();
  });
  it("distinguishes every pair on at least three non-palette presentation roles", () => {
    const roles = [
      "--field-rule",
      "--field-border-width",
      "--field-focus-rule",
      "--field-adornment-edge",
      "--action-rule",
      "--ui-nav-rule",
      "--ui-nav-line",
      "--ui-panel-rule",
      "--ui-overlay-rule",
      "--slider-track-height",
      "--slider-thumb-width",
      "--slider-thumb-height",
      "--switch-knob-radius",
      "--ui-chrome-pattern",
    ] as const;
    for (const [i, a] of interfaceStyles.entries())
      for (const b of interfaceStyles.slice(i + 1))
        expect(
          roles.filter((key) => a.recipe[key] !== b.recipe[key]).length,
          `${a.id}/${b.id}`,
        ).toBeGreaterThanOrEqual(3);
  });
  it("keeps explicit geometry, typography and palette preferences independent", () => {
    const p = {
      ...defaults,
      radius: 0,
      shadows: "none" as const,
      uiSize: 22,
      proseSize: 24,
      lightColors: { accent: "#123456" },
    };
    const base = appearanceVariables(p, false);
    for (const id of interfaceStyleIds) {
      const vars = appearanceVariables({ ...p, interfaceStyle: id }, false);
      for (const key of [
        "--radius",
        "--shadow",
        "--size-ui",
        "--size-prose",
        "--font-ui",
        "--font-prose",
        "--accent",
        "--reading-width",
      ])
        expect(vars[key]).toEqual(base[key]);
    }
  });
  it("keeps aliases read-only and boot identities registry-derived", () => {
    expect(normalizeInterfaceStyleId("macos")).toBe("harbor");
    expect(normalizeInterfaceStyleId("__proto__")).toBeUndefined();
    expect(normalizeInterfaceStyleId(null)).toBeUndefined();
    expect(legacyInterfaceStyleId("harbor", 10)).toBeUndefined();
    expect(legacyInterfaceStyleId("harbor", 11)).toBe("macos");
    expect(legacyInterfaceStyleId("signal", 11)).toBeUndefined();
    expect(legacyInterfaceStyleId("signal", 12)).toBe("signal");
    const layout = readFileSync("apps/web/app/layout.tsx", "utf8");
    expect(layout).not.toContain("['axiom','material','fluent','editorial']");
  });
});
