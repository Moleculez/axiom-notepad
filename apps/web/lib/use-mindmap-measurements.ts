import {
  useEffect,
  useRef,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { MindmapProjection } from "@axiom/mindmap";

type Sizes = Record<string, { width: number; height: number }>;
/** Intrinsic unscaled geometry; panning/zooming alone never queues a layout. */
export function useMindmapMeasurements(
  host: RefObject<HTMLDivElement | null>,
  projection: MindmapProjection | undefined,
  keys: Map<string, string>,
  visibleKey: string,
  width: number,
  presentationKey: string,
  setSizes: Dispatch<SetStateAction<Sizes>>,
) {
  const measurements = useRef(
    new Map<string, { width: number; height: number }>(),
  );
  useEffect(() => {
    const root = host.current;
    if (!root || !projection) return;
    let frame = 0,
      alive = true;
    const update = () => {
      if (!alive) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const element of root.querySelectorAll<HTMLElement>(
          ".mindmap-label",
        )) {
          const id =
              element.closest<HTMLElement>("[data-map-node]")?.dataset.mapNode,
            key = id && keys.get(id);
          if (!key || element.querySelector("input:not([type=checkbox])"))
            continue;
          measurements.current.set(key, {
            width: Math.min(width, Math.max(80, element.offsetWidth)),
            height: Math.max(40, element.offsetHeight),
          });
        }
        const next: Sizes = {},
          retained = new Set(keys.values());
        for (const node of projection.nodes) {
          const key = keys.get(node.id),
            size = key && measurements.current.get(key);
          if (size) next[node.id] = size;
        }
        for (const key of measurements.current.keys())
          if (!retained.has(key)) measurements.current.delete(key);
        setSizes((previous) =>
          Object.keys(next).length === Object.keys(previous).length &&
          Object.entries(next).every(
            ([id, size]) =>
              previous[id]?.width === size.width &&
              previous[id]?.height === size.height,
          )
            ? previous
            : next,
        );
      });
    };
    const observer = new ResizeObserver(update);
    root
      .querySelectorAll(".mindmap-label")
      .forEach((node) => observer.observe(node));
    root.addEventListener("axiom:math-rendered", update);
    root.addEventListener("axiom:diagram-rendered", update);
    root.addEventListener("axiom:image-rendered", update);
    void document.fonts.ready.then(update);
    update();
    return () => {
      alive = false;
      observer.disconnect();
      root.removeEventListener("axiom:math-rendered", update);
      root.removeEventListener("axiom:diagram-rendered", update);
      root.removeEventListener("axiom:image-rendered", update);
      cancelAnimationFrame(frame);
    };
  }, [host, projection, keys, visibleKey, width, presentationKey, setSizes]);
}
