"use client";
import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import { canvasSizingSnapshot } from "./canvas-presence";

export function useCanvasSizing(
  awareness: Awareness | null,
  readOnly: boolean,
  editing: string | null,
) {
  const [snapshot, update] = useState(() =>
    canvasSizingSnapshot(awareness?.getStates() ?? []),
  );
  useEffect(() => {
    if (!awareness) return;
    const changed = () => {
      const next = canvasSizingSnapshot(awareness.getStates());
      update((old) => (old.key === next.key ? old : next));
    };
    awareness.on("change", changed);
    changed();
    return () => {
      awareness.off("change", changed);
      awareness.setLocalStateField("canvasSizing", null);
    };
  }, [awareness]);
  useEffect(() => {
    awareness?.setLocalStateField("canvasSizing", {
      writable: !readOnly,
      activeCard: editing,
    });
  }, [awareness, readOnly, editing]);
  return (id: string) =>
    !readOnly &&
    (!awareness ||
      (snapshot.owners.get(id) ?? snapshot.fallback) === awareness.clientID);
}
