"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  appearanceVariables,
  resolvedDark,
  type Preferences,
  type DevicePreferences,
} from "@axiom/shared/appearance";
import type { EditorPreferences } from "@axiom/shared/editor";
import { SIGN_OUT_PENDING } from "./client";
import { usePreferencesBundle } from "./preferences-bundle";

export function useAppearance(userId?: string) {
  const { snapshot, store } = usePreferencesBundle(userId);
  const [systemDark, setSystemDark] = useState(false);
  const effective = useMemo(
    () => ({
      ...snapshot.values.appearance,
      ...snapshot.preview.appearance,
      ...(snapshot.preview.device ?? snapshot.device),
    }),
    [
      snapshot.values.appearance,
      snapshot.preview.appearance,
      snapshot.preview.device,
      snapshot.device,
    ],
  );
  const dark = resolvedDark(effective, systemDark);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const resolved = resolvedDark(
      effective,
      matchMedia("(prefers-color-scheme: dark)").matches,
    );
    const root = document.documentElement;
    if (root.dataset.mathAccount !== (userId ?? ""))
      root.dataset.mathAccount = userId ?? "";
    if (userId && !snapshot.ready) return; // Keep the account-scoped boot theme until hydration completes.
    root.dataset.theme = resolved ? "dark" : "light";
    root.dataset.themePack = effective.themePack;
    root.dataset.motion = effective.motion;
    root.dataset.density = effective.density;
    root.dataset.focus = String(effective.focusMode);
    root.dataset.documentDecorations = effective.documentDecorations;
    root.style.colorScheme = resolved ? "dark" : "light";
    for (const [key, value] of Object.entries(
      appearanceVariables(effective, resolved),
    ))
      root.style.setProperty(key, value);
    try {
      if (
        !snapshot.preview.appearance &&
        !snapshot.preview.device &&
        snapshot.ready &&
        userId &&
        !localStorage.getItem(SIGN_OUT_PENDING)
      ) {
        localStorage.setItem(
          "axiom:appearance",
          JSON.stringify({
            userId,
            mode: effective.mode,
            themePack: effective.themePack,
            light: appearanceVariables(effective, false),
            dark: appearanceVariables(effective, true),
            motion: effective.motion,
            density: effective.density,
            focus: String(effective.focusMode),
            documentDecorations: effective.documentDecorations,
          }),
        );
      }
    } catch {
      /* Applying the bundle reports storage failures. */
    }
  }, [
    effective,
    systemDark,
    snapshot.preview.appearance,
    snapshot.preview.device,
    snapshot.ready,
    userId,
  ]);
  const preview = useCallback(
    (value: { preferences: Preferences; device: DevicePreferences } | null) => {
      if (value)
        store.preview({ appearance: value.preferences, device: value.device });
      else store.clearPreview("appearance");
    },
    [store],
  );
  const apply = useCallback(
    (
      preferences: Preferences,
      device: DevicePreferences,
      savePrevious = false,
    ) =>
      store.apply(
        { ...store.state.values, appearance: preferences },
        device,
        savePrevious,
      ),
    [store],
  );
  const applyBundle = useCallback(
    (
      preferences: Preferences,
      device: DevicePreferences,
      editor: EditorPreferences,
      savePrevious = false,
    ) => store.apply({ appearance: preferences, editor }, device, savePrevious),
    [store],
  );
  return {
    userId,
    ready: snapshot.ready,
    preferences: snapshot.values.appearance,
    previousPreferences: snapshot.base.appearance.previousPreferences,
    device: snapshot.device,
    effective,
    dark,
    preview,
    apply,
    applyBundle,
    status: snapshot.status,
    conflicts: snapshot.conflicts
      .filter((key) => key.startsWith("appearance."))
      .map((key) => key.slice(11)),
    resolve: (mine: boolean) => store.resolve(mine)?.appearance,
  };
}
export type AppearanceController = ReturnType<typeof useAppearance>;
