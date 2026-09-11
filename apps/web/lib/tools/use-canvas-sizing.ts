"use client";
import { useEffect, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import { canvasSizingOwner } from "@axiom/shared/canvas-sizing";

export function useCanvasSizing(
  awareness: Awareness | null,
  readOnly: boolean,
  editing: string | null,
) {
  const [, update] = useState(0);
  useEffect(() => {
    if (!awareness) return;
    const changed = () => update((n) => n + 1);
    awareness.on("change", changed);
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
      canvasSizingOwner(awareness.getStates(), id) === awareness.clientID);
}
