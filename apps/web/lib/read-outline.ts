"use client";
import { useEffect, useRef, type RefObject } from "react";

export type HeadingOffset = { id: string; top: number };
/** Ordered content coordinates, independent of the viewport's scroll position. */
export function readHeadingAt(
  headings: readonly HeadingOffset[],
  top: number,
  fallback: string | null,
) {
  let low = 0,
    high = headings.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (headings[middle].top <= top) low = middle + 1;
    else high = middle;
  }
  return low ? headings[low - 1].id : fallback;
}

/** Scroll schedules one read per frame; only actual layout/content invalidation
 * remeasures heading boxes. The progress-save controller remains separate. */
export function useReadOutline(
  root: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  outline: readonly { id: string }[],
  layoutKey: string,
  select: (id: string | null) => void,
) {
  const latest = useRef({ outline, select });
  latest.current = { outline, select };
  const invalidate = useRef<() => void>(() => {});
  const schedule = useRef<() => void>(() => {});
  useEffect(() => {
    const element = root.current;
    if (!enabled || !element) return;
    let frame = 0,
      alive = true,
      dirty = true;
    let offsets: HeadingOffset[] = [];
    const paint = () => {
      frame = 0;
      if (!alive || !element.isConnected) return;
      if (dirty) {
        dirty = false;
        const top = element.getBoundingClientRect().top;
        offsets = Array.from(
          element.querySelectorAll<HTMLElement>(
            ".read-mount:not(.print-only) :is(h1,h2,h3,h4,h5,h6)[id]",
          ),
        ).map((heading) => ({
          id: heading.id,
          top: heading.getBoundingClientRect().top - top + element.scrollTop,
        }));
      }
      latest.current.select(
        readHeadingAt(
          offsets,
          element.scrollTop + 50,
          latest.current.outline[0]?.id ?? null,
        ),
      );
    };
    const queue = () => {
      if (!frame && alive) frame = requestAnimationFrame(paint);
    };
    const changed = () => {
      dirty = true;
      queue();
    };
    schedule.current = queue;
    invalidate.current = changed;
    const resize = new ResizeObserver(changed);
    resize.observe(element);
    const content = element.querySelector(".read-mount:not(.print-only)");
    if (content) resize.observe(content);
    const mutation = new MutationObserver(changed);
    if (content)
      mutation.observe(content, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    element.addEventListener("load", changed, true);
    element.addEventListener("axiom:math-rendered", changed);
    element.addEventListener("axiom:diagram-rendered", changed);
    element.addEventListener("axiom:mark-layout", changed);
    window.addEventListener("resize", changed);
    document.fonts.addEventListener("loadingdone", changed);
    void document.fonts.ready.then(() => {
      if (alive) changed();
    });
    queue();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      schedule.current = invalidate.current = () => {};
      element.removeEventListener("load", changed, true);
      element.removeEventListener("axiom:math-rendered", changed);
      element.removeEventListener("axiom:diagram-rendered", changed);
      element.removeEventListener("axiom:mark-layout", changed);
      window.removeEventListener("resize", changed);
      document.fonts.removeEventListener("loadingdone", changed);
    };
  }, [root, enabled]);
  useEffect(() => {
    invalidate.current();
  }, [outline, layoutKey]);
  return () => schedule.current();
}
