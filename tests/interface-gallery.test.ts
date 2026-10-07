import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import InterfaceStylePicker from "../apps/web/components/ui/InterfaceStylePicker";
import InterfaceStyleGallery from "../apps/web/components/ui/InterfaceStyleGallery";
import { interfaceStyles } from "../packages/shared/src/interface-styles";

describe("shared interface selection and comparison", () => {
  it("uses a native named radio group and meaningful independent miniatures", () => {
    const html = renderToStaticMarkup(
      h(InterfaceStylePicker, { value: "folio", onChange: () => {} }),
    );
    expect(html.match(/type="radio"/g)).toHaveLength(interfaceStyles.length);
    expect(
      new Set(
        [...html.matchAll(/type="radio"[^>]*name="([^"]+)"/g)].map((m) => m[1]),
      ).size,
    ).toBe(1);
    expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*value="folio"/);
    for (const style of interfaceStyles) {
      expect(html).toContain(`aria-label="${style.name}"`);
      expect(html).toContain(`data-interface-style="${style.id}"`);
      expect(html).toContain(style.description);
    }
    expect(html).toContain("Find evidence");
    expect(html).toContain("Field notes");
    expect(html).toContain("Compare all styles");
    expect(html).not.toContain('aria-label="Interface style comparison"');
    expect(html).not.toMatch(/<i(?:\s|>)/);
  });
  it("compares real native fields and all states under complete local recipes", () => {
    const html = renderToStaticMarkup(
      h(InterfaceStyleGallery, { value: "cutline", onSelect: () => {} }),
    );
    for (const style of interfaceStyles) {
      expect(html).toContain(`aria-label="${style.name} controls"`);
      expect(html).toContain(`aria-label="${style.name} sample search"`);
      expect(html).toContain(`aria-label="${style.name} sample reading scale"`);
      expect(html).toContain(`data-interface-style="${style.id}"`);
    }
    expect(html.match(/type="range"/g)).toHaveLength(interfaceStyles.length);
    expect(html.match(/type="checkbox"/g)).toHaveLength(
      interfaceStyles.length * 2,
    );
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(
      interfaceStyles.length,
    );
    expect(html.match(/readOnly=""/g)).toHaveLength(interfaceStyles.length);
    expect(html.match(/data-pending="true"/g)).toHaveLength(
      interfaceStyles.length,
    );
    expect(html).toContain("cutline selected".replace("cutline", "Cutline"));
    expect(html).not.toContain("<form");
  });
  it("lets both hosts control comparison without changing the native picker", () => {
    const html = renderToStaticMarkup(
      h(InterfaceStylePicker, {
        value: "axiom",
        onChange: () => {},
        comparing: true,
        onComparingChange: () => {},
      }),
    );
    expect(html).toContain("Hide comparison");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Interface style comparison"');
    expect(html.match(/type="radio"/g)).toHaveLength(interfaceStyles.length);
    const production = readFileSync(
      "apps/web/components/AppearanceSettings.tsx",
      "utf8",
    );
    expect(production).toContain("showPreview={previewVisible}");
    expect(production).toContain("active={previewVisible}");
    expect(production).toContain("onComparingChange={setComparingStyles}");
    const showcase = readFileSync(
      "apps/showcase/src/ShowcaseSettings.tsx",
      "utf8",
    );
    expect(showcase).toContain("data-style-comparison={comparing}");
    expect(showcase).toContain("hidden={comparing}");
    expect(showcase).toContain(
      'active={!comparing && preview === "interface"}',
    );
  });
  it("production and showcase share the picker, cascade and palette-aware swatches", () => {
    for (const path of [
      "apps/web/components/AppearanceSettings.tsx",
      "apps/showcase/src/ShowcaseSettings.tsx",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("<InterfaceStylePicker");
      expect(source).not.toContain("interface-style-sample");
    }
    expect(readFileSync("apps/web/app/styles.ts", "utf8")).toContain(
      'import "./interface-gallery.css";',
    );
    expect(
      readFileSync("apps/showcase/src/ShowcaseSettings.tsx", "utf8"),
    ).toContain("pack.palettes.light.paper");
  });
});
