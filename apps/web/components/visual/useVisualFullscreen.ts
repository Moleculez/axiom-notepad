"use client";
import { useEffect, useRef, useState } from "react";

/** Fullscreen belongs to the viewer's inner shell, never its native dialog or
 * the whole application. Unsupported/denied requests still expand the window. */
export function useVisualFullscreen() {
  const surface = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"native" | "viewport" | null>(null);
  const live = useRef(false),
    pending = useRef(false);
  useEffect(() => {
    live.current = true;
    const element = surface.current;
    const changed = () => {
      setMode((current) =>
        document.fullscreenElement === element
          ? "native"
          : current === "native"
            ? null
            : current,
      );
    };
    document.addEventListener("fullscreenchange", changed);
    return () => {
      live.current = false;
      document.removeEventListener("fullscreenchange", changed);
      if (element && document.fullscreenElement === element)
        void document.exitFullscreen().catch(() => {});
    };
  }, []);
  const exit = async () => {
    if (surface.current && document.fullscreenElement === surface.current)
      await document.exitFullscreen();
    if (live.current) setMode(null);
  };
  const toggle = async () => {
    if (pending.current) return;
    pending.current = true;
    try {
      if (mode || document.fullscreenElement === surface.current) {
        await exit();
        return;
      }
      const element = surface.current;
      if (!element) return;
      try {
        if (
          typeof element.requestFullscreen !== "function" ||
          document.fullscreenEnabled === false
        )
          throw new Error("Native fullscreen unavailable.");
        await element.requestFullscreen();
        if (live.current && element.isConnected)
          setMode(
            document.fullscreenElement === element ? "native" : "viewport",
          );
      } catch {
        if (live.current && element.isConnected) setMode("viewport");
      }
    } finally {
      pending.current = false;
    }
  };
  return {
    surface,
    mode,
    active: mode !== null,
    expanded: mode === "viewport",
    toggle,
    exit,
  };
}
