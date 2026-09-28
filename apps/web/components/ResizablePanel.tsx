"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { clampPanelWidth, storedPanelWidth } from "../lib/panel-width";

/** Width is local presentation only; never writes account preferences or content. */
export default function ResizablePanel({
  account,
  name,
  edge,
  className,
  label,
  children,
}: {
  account: string;
  name: "sidebar" | "document-context" | "research-details";
  edge: "left" | "right";
  className: string;
  label: string;
  children: ReactNode;
}) {
  const min = 220,
    max = name === "sidebar" ? 420 : 480;
  const fallback =
    name === "sidebar" ? 248 : name === "research-details" ? 340 : 270;
  const key = `axiom:panel-width:${account}:${name}`;
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const [saved, setSaved] = useState({ key: "", width: fallback });
  const [available, setAvailable] = useState(max);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    x: number;
    width: number;
    target: HTMLElement;
    pointer: number;
  } | null>(null);
  const width = clampPanelWidth(
    saved.key === key ? saved.width : fallback,
    min,
    available,
  );
  const live = useRef(width);
  live.current = width;
  useEffect(() => {
    try {
      setSaved({
        key,
        width: storedPanelWidth(localStorage.getItem(key), fallback, min, max),
      });
    } catch {
      setSaved({ key, width: fallback });
    }
  }, [key, fallback, max]);
  useEffect(() => {
    const parent = panel.current?.parentElement;
    if (!parent) return;
    const measure = () =>
      setAvailable(
        Math.max(
          min,
          Math.min(max, parent.clientWidth - (name === "sidebar" ? 600 : 360)),
        ),
      );
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    measure();
    return () => observer.disconnect();
  }, [max, name]);
  const persist = (next: number) => {
    const bounded = clampPanelWidth(next, min, available);
    live.current = bounded;
    setSaved({ key, width: bounded });
    try {
      localStorage.setItem(key, String(bounded));
    } catch {
      /* Still usable without storage. */
    }
  };
  const finish = (cancel = false) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (current.target.hasPointerCapture(current.pointer))
      current.target.releasePointerCapture(current.pointer);
    setDragging(false);
    if (cancel) {
      live.current = current.width;
      setSaved({ key, width: current.width });
    } else persist(live.current);
  };
  useEffect(() => {
    if (!dragging) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      }
    };
    const blur = () => finish(true);
    document.documentElement.classList.add("resizing-workspace-panel");
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", blur);
    return () => {
      document.documentElement.classList.remove("resizing-workspace-panel");
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", blur);
    };
  }, [dragging]);
  return (
    <aside
      ref={panel}
      id={id}
      className={`${className} resizable-workspace-panel`}
      aria-label={label}
      style={{ width }}
    >
      {children}
      <div
        role="separator"
        tabIndex={0}
        aria-label={`Resize ${label.toLowerCase()}`}
        aria-orientation="vertical"
        aria-controls={id}
        aria-valuemin={min}
        aria-valuemax={available}
        aria-valuenow={width}
        aria-valuetext={`${width} pixels`}
        title="Drag to resize · Arrow keys to adjust · Double-click to reset"
        className={`workspace-panel-resizer edge-${edge}`}
        data-dragging={dragging || undefined}
        onDoubleClick={() => persist(fallback)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          drag.current = {
            x: event.clientX,
            width,
            target: event.currentTarget,
            pointer: event.pointerId,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || event.pointerId !== current.pointer) return;
          const next = clampPanelWidth(
            current.width +
              (event.clientX - current.x) * (edge === "right" ? 1 : -1),
            min,
            available,
          );
          live.current = next;
          setSaved({ key, width: next });
        }}
        onPointerUp={() => finish()}
        onPointerCancel={() => finish(true)}
        onLostPointerCapture={() => finish(true)}
        onKeyDown={(event) => {
          if (
            !["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          const step = event.shiftKey ? 40 : 10;
          const next =
            event.key === "Home"
              ? min
              : event.key === "End"
                ? available
                : event.key === "Enter"
                  ? fallback
                  : width +
                    (event.key === "ArrowRight" ? step : -step) *
                      (edge === "right" ? 1 : -1);
          persist(next);
        }}
      />
    </aside>
  );
}
