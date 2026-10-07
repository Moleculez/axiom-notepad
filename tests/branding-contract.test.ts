import { describe, expect, it } from "vitest";
import {
  authoredBrandingPath,
  validateAuthoredBranding,
  validateProjectLicensing,
} from "../scripts/verify/branding-contract";

describe("original presentation vocabulary", () => {
  it("rejects borrowed design labels and promotional comparisons in rendered copy", () => {
    expect(
      validateAuthoredBranding(
        "apps/web/components/Example.tsx",
        'const ui = <><span>Fluent Studio</span><Button title="macOS Studio">Open</Button></>;',
      ),
    ).toHaveLength(2);
    expect(
      validateAuthoredBranding(
        "README.md",
        "A Typora-like editor with Material Tonal controls.",
      ),
    ).toHaveLength(2);
    expect(
      validateAuthoredBranding(
        "apps/web/content/help.ts",
        "const copy = `A Notion-like workspace: ${count} files`;",
      ),
    ).toHaveLength(1);
  });
  it("retains technical names, package imports, provider disclosures and historical IDs", () => {
    expect(
      validateAuthoredBranding(
        "apps/web/lib/example.ts",
        'import core from "@milkdown/kit"; const mime = "image/vnd.adobe.photoshop"; const id = "macos"; const recipient = "Google Analytics 4"; const provider = "OpenAI"; const font = "Microsoft YaHei";',
      ),
    ).toEqual([]);
    expect(
      validateAuthoredBranding(
        "docs/README.md",
        "GitHub Pages hosts static files. CodeMirror is an underlying dependency.",
      ),
    ).toEqual([]);
  });
  it("does not inspect comments or modify third-party notices and fixture content", () => {
    expect(
      validateAuthoredBranding(
        "apps/web/lib/example.ts",
        "// Photoshop MIME matching\nconst re = /photoshop/i;",
      ),
    ).toEqual([]);
    for (const path of [
      "packages/editor/THIRD_PARTY_NOTICES.md",
      "docs/theme-fixtures/research.md",
      "apps/publish/licenses/NOTICE.md",
    ])
      expect(authoredBrandingPath(path)).toBe(false);
  });
  it("keeps useful line numbers and rejects case-insensitive variants", () => {
    expect(
      validateAuthoredBranding(
        "apps/web/components/Example.tsx",
        '\n\nconst copy = "pHoToShOp features";',
      )[0],
    ).toMatchObject({ line: 3 });
  });
});

describe("first-party MIT metadata", () => {
  const license =
    'MIT License\n\nCopyright (c) 2026 Moleculez\nThe above copyright notice and this permission notice\nTHE SOFTWARE IS PROVIDED "AS IS"';
  const manifests = {
    "package.json": { name: "axiom", license: "MIT" },
    "apps/web/package.json": { name: "@axiom/web", license: "MIT" },
  };
  const lock = {
    "": manifests["package.json"],
    "apps/web": manifests["apps/web/package.json"],
    "node_modules/vendor": { name: "vendor", license: "ISC" },
  };
  it("checks every first-party manifest without relicensing dependencies", () => {
    expect(validateProjectLicensing(manifests, lock, license)).toEqual([]);
  });
  it("rejects missing metadata, mismatched lock entries and removed notices", () => {
    expect(
      validateProjectLicensing({ "package.json": { name: "axiom" } }, {}, ""),
    ).toHaveLength(3);
    expect(
      validateProjectLicensing(
        manifests,
        { ...lock, "apps/web": { name: "@axiom/web", license: "ISC" } },
        license,
      ),
    ).toHaveLength(1);
  });
});
