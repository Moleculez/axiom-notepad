import {
  defaults,
  mergePreferences,
  normalizePreferenceRecord,
  preferencesSchema,
  type Preferences,
  type PreferenceRecord,
} from "./appearance";
import {
  editorDefaults,
  editorPreferencesSchema,
  mergeEditorPreferences,
  type EditorPreferences,
  type EditorPreferenceRecord,
} from "./editor";

export type PreferencesBundle = {
  appearance: PreferenceRecord;
  editor: EditorPreferenceRecord;
};
export type PreferenceValues = {
  appearance: Preferences;
  editor: EditorPreferences;
};
export const emptyBundle = (): PreferencesBundle => ({
  appearance: { preferences: defaults, version: 0 },
  editor: { preferences: editorDefaults, version: 0 },
});
export function normalizeBundle(value: PreferencesBundle): PreferencesBundle {
  if (
    !Number.isSafeInteger(value.appearance.version) ||
    value.appearance.version < 0 ||
    !Number.isSafeInteger(value.editor.version) ||
    value.editor.version < 0
  )
    throw new Error("Invalid preference revision.");
  const appearance = normalizePreferenceRecord(value.appearance);
  const editor = editorPreferencesSchema.parse(value.editor.preferences);
  if (Number(value.editor.preferences.schemaVersion) === 1) {
    editor.codeWrap = appearance.preferences.codeWrap;
    editor.codeLineNumbers = appearance.preferences.lineNumbers;
  }
  return {
    appearance,
    editor: {
      ...value.editor,
      preferences: editor,
    },
  };
}
export const bundleValues = (bundle: PreferencesBundle): PreferenceValues => ({
  appearance: preferencesSchema.parse(bundle.appearance.preferences),
  editor: editorPreferencesSchema.parse(bundle.editor.preferences),
});
export function mergeBundle(
  base: PreferenceValues,
  local: PreferenceValues,
  remote: PreferenceValues,
) {
  const appearance = mergePreferences(
    base.appearance,
    local.appearance,
    remote.appearance,
  );
  const editor = mergeEditorPreferences(
    base.editor,
    local.editor,
    remote.editor,
  );
  return {
    values: { appearance: appearance.merged, editor: editor.merged },
    conflicts: [
      ...appearance.conflicts.map((key) => `appearance.${key}`),
      ...editor.conflicts.map((key) => `editor.${key}`),
    ],
  };
}
