import { describe, expect, it } from "vitest";
import {
  editorDefaults,
  editorPreferencesSchema,
  editorPreferenceKeys,
  mergeEditorPreferences,
} from "../packages/shared/src/editor";
import {
  bundleValues,
  emptyBundle,
  mergeBundle,
  normalizeBundle,
} from "../packages/shared/src/preferences-bundle";
import {
  writingControls,
  settingsCategories,
  settingsCategory,
  appearanceSections,
} from "../apps/web/lib/settings-registry";
import { defaults, APPEARANCE_SCHEMA } from "../packages/shared/src/appearance";

describe("versioned preference bundle", () => {
  it("upgrades old cache values and restore points independently while preserving pending edits", () => {
    const value = emptyBundle();
    const old = {
      ...defaults,
      schemaVersion: 11,
      interfaceStyle: "macos",
      radius: 0,
      shadows: "none",
      proseFont: "atkinson",
      themePack: "paper-research",
      lightColors: { accent: "#123456" },
    };
    const normalized = normalizeBundle({
      ...value,
      appearance: {
        version: 9,
        preferences: old,
        previousPreferences: {
          ...old,
          interfaceStyle: "editorial",
          proseSize: 24,
        },
      },
    } as unknown as typeof value);
    expect(normalized.appearance.version).toBe(9);
    expect(normalized.appearance.preferences).toEqual({
      ...old,
      schemaVersion: APPEARANCE_SCHEMA,
      interfaceStyle: "harbor",
    });
    expect(normalized.appearance.previousPreferences).toEqual({
      ...old,
      schemaVersion: APPEARANCE_SCHEMA,
      interfaceStyle: "folio",
      proseSize: 24,
    });
    const pending = bundleValues(normalized);
    const remote = bundleValues(emptyBundle());
    pending.appearance.proseSize = 29;
    remote.editor.defaultCodeLanguage = "julia";
    const merged = mergeBundle(bundleValues(normalized), pending, {
      ...bundleValues(normalized),
      editor: remote.editor,
    });
    expect(merged.values.appearance.proseSize).toBe(29);
    expect(merged.values.appearance.interfaceStyle).toBe("harbor");
    expect(merged.values.appearance.themePack).toBe("paper-research");
    expect(merged.values.editor.defaultCodeLanguage).toBe("julia");
  });
  it("normalizes old writing profiles without losing shortcuts", () => {
    const previous = {
      schemaVersion: 1,
      slashCommands: false,
      defaultCodeLanguage: "julia",
      indentSize: 8,
      keybindings: { mac: { bold: ["Mod-Alt-z"] }, windowsLinux: {} },
    };
    const normalized = editorPreferencesSchema.parse(previous);
    expect(normalized).toMatchObject({
      schemaVersion: 2,
      slashCommands: false,
      defaultCodeLanguage: "julia",
      indentSize: 8,
      formattingBar: false,
      tableAutoRow: true,
    });
    expect(normalized.keybindings).toEqual(previous.keybindings);
    expect(
      editorPreferencesSchema.safeParse({ ...previous, schemaVersion: 9 })
        .success,
    ).toBe(false);
  });
  it("merges every writing setting and reports overlapping edits", () => {
    for (const key of editorPreferenceKeys) {
      const value =
        typeof editorDefaults[key] === "boolean"
          ? !editorDefaults[key]
          : key === "indentSize"
            ? 8
            : "julia";
      const local = { ...editorDefaults, [key]: value };
      expect(
        mergeEditorPreferences(editorDefaults, local, editorDefaults).merged[
          key
        ],
      ).toEqual(value);
    }
    const local = { ...editorDefaults, indentSize: 2 as const },
      remote = { ...editorDefaults, indentSize: 8 as const };
    expect(
      mergeEditorPreferences(editorDefaults, local, remote).conflicts,
    ).toEqual(["indentSize"]);
  });
  it("merges appearance and writing fields independently and names conflicts", () => {
    const base = bundleValues(emptyBundle()),
      local = structuredClone(base),
      remote = structuredClone(base);
    local.appearance.proseSize = 24;
    local.editor.defaultCodeLanguage = "julia";
    remote.appearance.proseSize = 20;
    remote.editor.indentSize = 8;
    const merged = mergeBundle(base, local, remote);
    expect(merged.values.appearance.proseSize).toBe(24);
    expect(merged.values.editor).toMatchObject({
      defaultCodeLanguage: "julia",
      indentSize: 8,
    });
    expect(merged.conflicts).toEqual(["appearance.proseSize"]);
  });
  it("rejects invalid revisions and keeps fresh state account independent", () => {
    const a = emptyBundle(),
      b = emptyBundle();
    a.appearance.version = 9;
    expect(b.appearance.version).toBe(0);
    expect(() =>
      normalizeBundle({ ...b, editor: { ...b.editor, version: -1 } }),
    ).toThrow();
  });
  it("has a settings route for every writing control and safe legacy aliases", () => {
    for (const control of writingControls)
      expect(Object.values(appearanceSections)).toContain(control.category);
    expect(
      new Set(settingsCategories.map((category) => category.id)).size,
    ).toBe(settingsCategories.length);
    expect(settingsCategory("appearance", "Keyboard shortcuts")).toBe(
      "shortcuts",
    );
    expect(settingsCategory("appearance", "invalid")).toBe("theme");
    expect(settingsCategory("unknown")).toBe("profile");
  });
});
