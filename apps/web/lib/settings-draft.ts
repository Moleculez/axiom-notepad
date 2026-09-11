"use client";
import { useEffect, useState } from "react";
import {
  mergeBundle,
  type PreferenceValues,
} from "@axiom/shared/preferences-bundle";
import type { DevicePreferences } from "@axiom/shared/appearance";
import type { AppearanceController } from "./appearance";
import type { EditorPreferencesController } from "./editor-preferences";
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function useSettingsDraft(
  appearance: AppearanceController,
  editor: EditorPreferencesController,
  enabled = true,
) {
  const remote = {
    appearance: appearance.preferences,
    editor: editor.preferences,
  };
  const [state, setState] = useState(() => ({
    base: remote,
    values: remote,
    deviceBase: appearance.device,
    device: appearance.device,
    conflicts: [] as string[],
    savePrevious: false,
  }));
  useEffect(() => {
    if (!enabled) return;
    setState((previous) => {
      const next = {
        appearance: appearance.preferences,
        editor: editor.preferences,
      };
      if (
        equal(previous.base, next) &&
        equal(previous.deviceBase, appearance.device)
      )
        return previous;
      const merged = mergeBundle(previous.base, previous.values, next);
      const device: DevicePreferences = { ...appearance.device };
      for (const key of [
        "uiScale",
        "density",
        "sidebarWidth",
        "panelWidth",
      ] as const)
        if (previous.device[key] !== previous.deviceBase[key]) {
          if (previous.device[key] === undefined) delete device[key];
          else Object.assign(device, { [key]: previous.device[key] });
        }
      return {
        ...previous,
        base: next,
        values: merged.values,
        deviceBase: appearance.device,
        device,
        conflicts: [...new Set([...previous.conflicts, ...merged.conflicts])],
      };
    });
  }, [appearance.preferences, appearance.device, editor.preferences, enabled]);
  useEffect(() => {
    if (!enabled) return;
    appearance.preview({
      preferences: state.values.appearance,
      device: state.device,
    });
    editor.preview(state.values.editor);
    return () => {
      appearance.preview(null);
      editor.preview(null);
    };
  }, [state.values, state.device, appearance.preview, editor.preview, enabled]);
  const dirty =
    state.savePrevious ||
    !equal(state.base, state.values) ||
    !equal(state.deviceBase, state.device);
  const setValues = <K extends keyof PreferenceValues>(
    key: K,
    value:
      | PreferenceValues[K]
      | ((previous: PreferenceValues[K]) => PreferenceValues[K]),
  ) =>
    setState((s) => ({
      ...s,
      values: {
        ...s.values,
        [key]: typeof value === "function" ? value(s.values[key]) : value,
      },
    }));
  const discard = () =>
    setState({
      base: remote,
      values: remote,
      deviceBase: appearance.device,
      device: appearance.device,
      conflicts: [],
      savePrevious: false,
    });
  const apply = () => {
    const merged = mergeBundle(state.base, state.values, remote);
    if (state.conflicts.length || merged.conflicts.length) {
      setState((s) => ({
        ...s,
        base: remote,
        values: merged.values,
        conflicts: [...new Set([...s.conflicts, ...merged.conflicts])],
      }));
      return false;
    }
    if (appearance.conflicts.length || editor.conflicts.length) return false;
    if (
      !appearance.applyBundle(
        merged.values.appearance,
        state.device,
        merged.values.editor,
        state.savePrevious,
      )
    )
      return false;
    setState((s) => ({
      ...s,
      base: merged.values,
      values: merged.values,
      deviceBase: s.device,
      savePrevious: false,
    }));
    return true;
  };
  const resolve = (mine: boolean) =>
    setState((s) => {
      const values = structuredClone(s.values);
      if (!mine)
        for (const path of s.conflicts) {
          const keys = path.split(".");
          let target = values as unknown as Record<string, unknown>,
            source = remote as unknown as Record<string, unknown>;
          for (const key of keys.slice(0, -1)) {
            target = target[key] as Record<string, unknown>;
            source = source[key] as Record<string, unknown>;
          }
          if (source[keys.at(-1)!] === undefined) delete target[keys.at(-1)!];
          else target[keys.at(-1)!] = source[keys.at(-1)!];
        }
      return { ...s, values, base: remote, conflicts: [] };
    });
  return {
    ...state,
    dirty,
    apply,
    discard,
    resolve,
    setAppearance: (
      value:
        | PreferenceValues["appearance"]
        | ((
            previous: PreferenceValues["appearance"],
          ) => PreferenceValues["appearance"]),
    ) => setValues("appearance", value),
    setEditor: (
      value:
        | PreferenceValues["editor"]
        | ((
            previous: PreferenceValues["editor"],
          ) => PreferenceValues["editor"]),
    ) => setValues("editor", value),
    setDevice: (
      value:
        | DevicePreferences
        | ((previous: DevicePreferences) => DevicePreferences),
    ) =>
      setState((s) => ({
        ...s,
        device: typeof value === "function" ? value(s.device) : value,
      })),
    setSavePrevious: (value: boolean) =>
      setState((s) => ({ ...s, savePrevious: value })),
  };
}
export type SettingsDraft = ReturnType<typeof useSettingsDraft>;
