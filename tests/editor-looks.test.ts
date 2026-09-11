import { describe, expect, it } from "vitest";
import {
  defaults,
  preferencesSchema,
  themeFileSchema,
  paletteFor,
  contrastRatio,
} from "../packages/shared/src/appearance";
import {
  editorThemes,
  applyEditorTheme,
  matchingEditorTheme,
  documentStyles,
  applyDocumentStyle,
  matchingDocumentStyle,
  type DocumentStyleId,
} from "../packages/shared/src/editor-looks";
import { blockMove } from "../packages/editor/src/block-move";
import { applyChanges } from "../packages/editor/src/transactions";
describe("coordinated editor looks", () => {
  it("supplies twenty-eight readable palettes that fit the unchanged portable theme format", () => {
    expect(Object.keys(editorThemes)).toHaveLength(28);
    for (const [id, theme] of Object.entries(editorThemes)) {
      const p = preferencesSchema.parse(applyEditorTheme(defaults, id));
      expect(matchingEditorTheme(p, theme.mode === "dark")).toBe(id);
      expect(paletteFor(p, theme.mode === "dark")).toEqual(theme.colors);
      expect(
        themeFileSchema.parse({
          format: "axiom-theme",
          version: 1,
          name: theme.name,
          mode: theme.mode,
          colors: theme.colors,
        }).colors,
      ).toEqual(theme.colors);
      for (const [a, b] of [
        ["text", "paper"],
        ["muted", "paper"],
        ["subtle", "paper"],
        ["accent", "paper"],
        ["text", "sidebar"],
        ["muted", "sidebar"],
        ["codeText", "code"],
        ["syntax", "code"],
        ["accent", "code"],
        ["muted", "code"],
        ["onAccent", "accent"],
      ] as const)
        expect(
          contrastRatio(theme.colors[a], theme.colors[b]),
          `${id}: ${a}/${b}`,
        ).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("applies optional document styles without changing interface, colors, or device layout", () => {
    const before = {
      ...defaults,
      uiSize: 19,
      uiFont: "inter" as const,
      sidebarWidth: 310,
      lightColors: { accent: "#224466" },
    };
    for (const id of Object.keys(documentStyles) as DocumentStyleId[]) {
      const result = preferencesSchema.parse(applyDocumentStyle(before, id));
      expect(matchingDocumentStyle(result)).toBe(id);
      for (const key of [
        "uiSize",
        "uiFont",
        "sidebarWidth",
        "lightColors",
        "mode",
      ] as const)
        expect(result[key]).toEqual(before[key]);
      expect(
        matchingDocumentStyle({ ...result, proseSize: result.proseSize + 1 }),
      ).toBe("custom");
    }
  });
  it("keeps system mode and explicit custom colors unless a look is chosen", () => {
    expect(applyEditorTheme(defaults, "mist", false).mode).toBe("system");
    expect(
      matchingEditorTheme(
        { ...defaults, lightColors: { text: "#123456" } },
        false,
      ),
    ).toBe("custom");
    expect(applyEditorTheme(defaults, "unknown")).toBe(defaults);
  });
});
describe("source-backed block movement", () => {
  it("moves exact source slices and selects the moved block", () => {
    const source = "Alpha\r\n\r\n**Beta**\r\n\r\nGamma";
    const edit = blockMove(source, 9, 21, 0)!;
    expect(applyChanges(source, edit.changes)).toBe(
      "**Beta**\r\n\r\nAlpha\r\n\r\nGamma",
    );
    expect(edit.selection.anchor).toBe(0);
    expect(blockMove(source, 9, 21, 12)).toBeNull();
    expect(blockMove(source, -1, 21, 0)).toBeNull();
  });
});
