"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  NavigationIndex,
  clamp,
  type NavigationBlock,
  type EditorNavigationState,
  type NavigationPosition,
} from "@axiom/editor/minimap";

export type NavigationAdapter = {
  geometry: () => NavigationBlock[];
  snapshot: () => EditorNavigationState | null;
  position?: (position: number) => NavigationPosition | null;
  focus: (position?: number) => void;
};
export type DocumentNavigation = {
  blocks: NavigationBlock[];
  index: NavigationIndex;
  positions: ReadonlyMap<number, number>;
  editor: EditorNavigationState | null;
  revision: number;
  left: number;
  top: number;
  width: number;
  height: number;
  extent: number;
  scroll: number;
  measures: number;
};
const empty: DocumentNavigation = {
  blocks: [],
  index: new NavigationIndex([]),
  positions: new Map(),
  editor: null,
  revision: 0,
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  extent: 1,
  scroll: 0,
  measures: 0,
};

/** One source/geometry subscription for a document's minimap and reading marks.
 * Cached blocks use scroll-content coordinates: scrolling never remeasures them. */
export function useDocumentNavigation(
  root: RefObject<HTMLElement | null>,
  adapter: NavigationAdapter,
  identity: string,
  source: string,
  mode: string,
  active: boolean,
) {
  const [state, setState] = useState<DocumentNavigation>(empty);
  const current = useRef({ adapter, source, mode, active });
  current.current = { adapter, source, mode, active };
  const invalidate = useRef<() => void>(() => {});
  useEffect(() => {
    const element = root.current;
    if (!element || !active) return;
    let stopped = false,
      frame = 0,
      geometryDirty = true,
      revision = 0,
      measures = 0;
    let blocks: NavigationBlock[] = [],
      index = new NavigationIndex([]);
    let positions = new Map<number, NavigationPosition | null>();
    const paint = () => {
      frame = 0;
      if (
        stopped ||
        !current.current.active ||
        document.visibilityState === "hidden"
      )
        return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const scroll = element.scrollTop;
      if (geometryDirty) {
        geometryDirty = false;
        positions.clear();
        measures++;
        const { adapter, mode, source } = current.current;
        const read =
          mode === "read"
            ? element.querySelector(".read-mount:not(.print-only)")
            : null;
        const geometry: NavigationBlock[] = read
          ? Array.from(
              read.querySelectorAll<HTMLElement>("[data-reading-from]"),
            ).map((node) => {
              const b = node.getBoundingClientRect();
              return {
                from: Number(node.dataset.readingFrom),
                to: Number(node.dataset.readingTo),
                type: node.dataset.readingType!,
                left: b.left,
                right: b.right,
                top: b.top,
                bottom: b.bottom,
              };
            })
          : adapter.geometry();
        let next = geometry
          .filter(
            (b) =>
              b.bottom > b.top &&
              Number.isFinite(b.from) &&
              Number.isFinite(b.to),
          )
          .map((b) => ({
            ...b,
            top: b.top - rect.top + scroll,
            bottom: b.bottom - rect.top + scroll,
            left: b.left - rect.left + element.scrollLeft,
            right: b.right - rect.left + element.scrollLeft,
          }));
        if (!next.length && !source.trim())
          next = [
            {
              from: 0,
              to: 0,
              type: "paragraph",
              top: 24,
              bottom: 52,
              left: 24,
              right: rect.width - 24,
            },
          ];
        // A presence repaint or unchanged projection is not a new map. Keep
        // the immutable geometry identity so it cannot restart canvas painting.
        const same =
          next.length === blocks.length &&
          next.every((b, i) => {
            const old = blocks[i];
            return (
              b.from === old.from &&
              b.to === old.to &&
              b.type === old.type &&
              b.folded === old.folded &&
              Math.abs(b.top - old.top) < 0.1 &&
              Math.abs(b.bottom - old.bottom) < 0.1 &&
              Math.abs(b.left - old.left) < 0.1 &&
              Math.abs(b.right - old.right) < 0.1
            );
          });
        if (!same) {
          blocks = next;
          index = new NavigationIndex(blocks);
          revision++;
        }
      }
      const editor = current.current.adapter.snapshot();
      const nextPositions = new Map<number, NavigationPosition | null>();
      const resolved = new Map<number, number>();
      if (
        editor &&
        editor.source === current.current.source &&
        current.current.mode !== "read"
      ) {
        const targets = new Set([
          editor.selection.anchor,
          editor.selection.head,
          ...editor.markers.map((m) => m.from),
        ]);
        for (const at of targets) {
          if (index.atSource(at)?.folded) continue;
          let point = positions.get(at);
          // Reuse content-relative positions while scrolling. Only an estimated
          // virtualized row that enters the viewport needs a fresh measurement.
          if (
            point === undefined ||
            (point?.estimated &&
              point.bottom >= scroll &&
              point.top <= scroll + rect.height)
          ) {
            const box = current.current.adapter.position?.(at);
            point =
              box &&
              box.bottom > box.top &&
              Number.isFinite(box.top) &&
              Number.isFinite(box.bottom)
                ? {
                    top: box.top - rect.top + scroll,
                    bottom: box.bottom - rect.top + scroll,
                    estimated: box.estimated,
                  }
                : null;
          }
          nextPositions.set(at, point);
          if (point) resolved.set(at, (point.top + point.bottom) / 2);
        }
      }
      // Retain only current targets: moving a caret cannot grow this cache.
      positions = nextPositions;
      setState({
        blocks,
        index,
        positions: resolved,
        revision,
        editor,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        extent: Math.max(1, element.scrollHeight),
        scroll,
        measures,
      });
    };
    const schedule = () => {
      if (!frame && !stopped) frame = requestAnimationFrame(paint);
    };
    const dirty = () => {
      geometryDirty = true;
      schedule();
    };
    invalidate.current = dirty;
    const resize = new ResizeObserver(dirty);
    resize.observe(element);
    const observed = new Set<Element>();
    const observeContent = () => {
      const next = new Set(
        Array.from(
          element.querySelectorAll(
            ".ws-paper,.axiom-editor-content,.read-mount",
          ),
        ).filter((node) => !node.closest(".print-only")),
      );
      for (const node of observed)
        if (!next.has(node)) {
          resize.unobserve(node);
          observed.delete(node);
        }
      for (const node of next)
        if (!observed.has(node)) {
          resize.observe(node);
          observed.add(node);
        }
    };
    const mutation = new MutationObserver((records) => {
      const visible = records.filter(
        (r) =>
          !(r.target instanceof Element && r.target.closest(".print-only")),
      );
      if (!visible.length) return;
      // Source virtualization replaces visible lines while scrolling, but its
      // height map still supplies all navigation geometry. It needs no DOM scan.
      const sourceScrollOnly =
        current.current.mode === "source" &&
        visible.every(
          (r) =>
            r.target instanceof Element &&
            !!r.target.closest(".cm-content,.cm-gutters,.cm-layer"),
        );
      if (!sourceScrollOnly) {
        observeContent();
        dirty();
      }
    });
    mutation.observe(element, { childList: true, subtree: true });
    observeContent();
    element.addEventListener("scroll", schedule, { passive: true });
    element.addEventListener("axiom:mark-layout", dirty);
    element.addEventListener("axiom:math-rendered", dirty);
    element.addEventListener("axiom:navigation-state", schedule);
    element.addEventListener("load", dirty, true);
    window.addEventListener("resize", dirty);
    document.addEventListener("visibilitychange", dirty);
    const fontsChanged = () => {
      revision++;
      dirty();
    };
    document.fonts.addEventListener("loadingdone", fontsChanged);
    void document.fonts.ready.then(() => {
      if (!stopped) fontsChanged();
    });
    schedule();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      element.removeEventListener("scroll", schedule);
      element.removeEventListener("axiom:mark-layout", dirty);
      element.removeEventListener("axiom:math-rendered", dirty);
      element.removeEventListener("axiom:navigation-state", schedule);
      element.removeEventListener("load", dirty, true);
      window.removeEventListener("resize", dirty);
      document.removeEventListener("visibilitychange", dirty);
      document.fonts.removeEventListener("loadingdone", fontsChanged);
    };
  }, [root, identity, active]);
  useEffect(() => {
    invalidate.current();
  }, [source, mode]);
  return state;
}

export function scrollToSource(
  root: HTMLElement | null,
  state: DocumentNavigation,
  position: number,
) {
  if (!root) return;
  root.scrollTo({
    top: clamp(
      state.index.yAt(position) - state.height * 0.35,
      0,
      Math.max(0, state.extent - state.height),
    ),
    behavior: "instant",
  });
  root.dispatchEvent(new Event("axiom:minimap-navigated"));
}
