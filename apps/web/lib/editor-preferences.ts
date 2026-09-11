"use client";
import { useCallback } from "react";
import type { EditorPreferences } from "@axiom/shared/editor";
import { usePreferencesBundle } from "./preferences-bundle";

export function useEditorPreferences(userId?: string) {
  const { snapshot, store } = usePreferencesBundle(userId);
  const preview = useCallback(
    (preferences: EditorPreferences | null) => {
      if (preferences) store.preview({ editor: preferences });
      else store.clearPreview("editor");
    },
    [store],
  );
  return {
    userId,
    ready: snapshot.ready,
    preferences: snapshot.values.editor,
    effective: snapshot.preview.editor ?? snapshot.values.editor,
    preview,
    status: snapshot.status,
    conflicts: snapshot.conflicts
      .filter((key) => key.startsWith("editor."))
      .map((key) => key.slice(7)),
    apply: (preferences: EditorPreferences) =>
      store.apply(
        { ...store.state.values, editor: preferences },
        store.state.device,
      ),
    resolve: (mine: boolean) => store.resolve(mine)?.editor,
  };
}
export type EditorPreferencesController = ReturnType<
  typeof useEditorPreferences
>;
