import * as Y from "yjs";
import type { MarkdownNode, ParsedDocument } from "@axiom/markdown";
import type { NativeBinding } from "@axiom/editor/binding";
import {
  samePlacement,
  type VisualAnnotation,
  type VisualPlacement,
} from "@axiom/shared/visual-annotations";
import { api } from "./client";
import { diagramSnapshot } from "./editor-vnext/diagrams";
import { actionIcon } from "./icons/actions";
import { openContextMenu, type ContextAction } from "./context-menu";
import { markdownVisuals, openVisual, type VisualAsset } from "./visual-assets";

export type VisualContext = {
  resourceId: string;
  path?: string[];
  versionId?: string;
  generation?: number;
  revision?: string;
  anchor?: (from: number, to: number) => VisualPlacement["anchor"] | null;
};
type SurfaceOptions = {
  assets: () => VisualAsset[];
  selection?: () => { anchor: number; head: number };
  captureRestore?: () => () => void;
  editorMenu?: (x: number, y: number, at: number) => void;
};
const surfaces = new WeakMap<
  HTMLElement,
  {
    assets: () => VisualAsset[];
    open: (item: VisualAsset, panel?: "info" | "markup") => void;
  }
>();
/** Current board's visible, already-authorized placements; no hidden-file crawl. */
export function canvasVisuals(root: HTMLElement): VisualAsset[] {
  const board = root.closest<HTMLElement>(".canvas-world");
  if (!board) return [];
  return Array.from(
    board.querySelectorAll<HTMLElement>("[data-visual-surface]"),
  )
    .flatMap((el) => surfaces.get(el)?.assets() ?? [])
    .map((item) => ({
      ...item,
      id: JSON.stringify([item.placement?.path ?? [], item.id]),
    }));
}
const markCache = new Map<
  string,
  { at: number; promise: Promise<VisualAnnotation[]> }
>();
const markRequests = new Set<AbortController>();
if (typeof window !== "undefined") {
  const stop = () => {
    for (const request of markRequests) request.abort();
    markRequests.clear();
    markCache.clear();
  };
  window.addEventListener("pagehide", stop);
  window.addEventListener("beforeunload", stop);
  window.addEventListener("axiom:close-documents", stop);
}
export const visualMarksEvent = "axiom:visual-marks";
export function currentVisualUser(): string {
  try {
    return (
      JSON.parse(localStorage.getItem("axiom:session") ?? "null")?.user?.id ??
      ""
    );
  } catch {
    return "";
  }
}
export function loadVisualMarks(
  resourceId: string,
  refresh = false,
): Promise<VisualAnnotation[]> {
  const user = currentVisualUser();
  if (!user) return Promise.resolve([]);
  const key = user + ":" + resourceId,
    old = markCache.get(key);
  if (!refresh && old && Date.now() - old.at < 10000) return old.promise;
  const controller = new AbortController();
  markRequests.add(controller);
  const promise = api<VisualAnnotation[]>(
    `resources/${resourceId}/visual-annotations`,
    { signal: controller.signal },
  )
    .then((rows) => (currentVisualUser() === user ? rows : []))
    .catch((e) => {
      if (markCache.get(key)?.promise === promise) markCache.delete(key);
      throw e;
    })
    .finally(() => markRequests.delete(controller));
  markCache.set(key, { at: Date.now(), promise });
  if (markCache.size > 24) markCache.delete(markCache.keys().next().value!);
  return promise;
}
export function changedVisualMarks(resourceId: string) {
  markCache.delete(currentVisualUser() + ":" + resourceId);
  window.dispatchEvent(
    new CustomEvent(visualMarksEvent, { detail: resourceId }),
  );
}
export function refreshVisualSurfaces() {
  markCache.clear();
  window.dispatchEvent(new Event(visualMarksEvent));
}
export function inheritedVisualContext(
  root: HTMLElement,
): VisualContext | undefined {
  const scope = root.closest<HTMLElement>("[data-visual-resource]");
  if (!scope?.dataset.visualResource) return;
  let path: string[] = [];
  try {
    path = JSON.parse(scope.dataset.visualPath ?? "[]");
    // Nested read-only cards extend the owning board's placement path.
    const nested: string[][] = [];
    for (let el = root; el && el !== scope; el = el.parentElement!)
      if (el.dataset.visualPath)
        nested.unshift(JSON.parse(el.dataset.visualPath));
    path.push(...nested.flat());
  } catch {
    /* Anonymous preview. */
  }
  return {
    resourceId: scope.dataset.visualResource,
    path,
    versionId: scope.dataset.visualVersion,
    generation:
      Number(
        root.closest<HTMLElement>("[data-visual-generation]")?.dataset
          .visualGeneration,
      ) || undefined,
    revision: root.closest<HTMLElement>("[data-visual-revision]")?.dataset
      .visualRevision,
  };
}
export function visualTextAnchor(
  text: Y.Text,
  from: number,
  to: number,
  generation = 1,
  blockType = "image",
): NonNullable<VisualPlacement["anchor"]> {
  return {
    start: Array.from(
      Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(text, from),
      ),
    ),
    end: Array.from(
      Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(text, to, -1),
      ),
    ),
    quote: text.toString().slice(from, to).slice(0, 2000),
    generation,
    kind: "block",
    blockType,
  };
}
export function visualPlacement(
  context: VisualContext | undefined,
  node?: MarkdownNode,
  binding?: NativeBinding,
  generation = 1,
): VisualPlacement | undefined {
  if (!context) return;
  let anchor = (node && context.anchor?.(node.from, node.to)) || undefined;
  if (node && binding) {
    anchor = visualTextAnchor(
      binding.text,
      node.from,
      node.to,
      context.generation ?? generation,
      node.type,
    );
  }
  if (anchor && context.generation)
    anchor = { ...anchor, generation: context.generation };
  return {
    resourceId: context.resourceId,
    path: context.path ?? [],
    versionId: context.versionId,
    revision: anchor ? undefined : context.revision,
    anchor,
    ...(node ? { from: node.from, to: node.to } : {}),
  };
}
export function installMarkdownVisuals(
  root: HTMLElement,
  options: {
    parsed: () => ParsedDocument;
    source: () => string;
    context?: () => VisualContext | undefined;
    anchor?: VisualContext["anchor"];
    binding?: NativeBinding;
    generation?: number;
    selection?: SurfaceOptions["selection"];
    captureRestore?: () => () => void;
    editorMenu?: SurfaceOptions["editorMenu"];
  },
) {
  return installVisualSurface(root, {
    ...options,
    assets: () => {
      const context = options.context?.() ?? inheritedVisualContext(root);
      return markdownVisuals(options.parsed(), options.source(), (n) =>
        visualPlacement(
          context && options.anchor
            ? { ...context, anchor: options.anchor }
            : context,
          n,
          options.binding,
          options.generation,
        ),
      );
    },
  });
}
export function installVisualSurface(
  root: HTMLElement,
  options: SurfaceOptions,
) {
  const abort = new AbortController(),
    { signal } = abort;
  let alive = true,
    frame = 0,
    menu: (() => void) | undefined,
    marks: VisualAnnotation[] = [],
    loading = false,
    loadedResource = "",
    openedAt = -Infinity;
  let last: { time: number; x: number; y: number; item: VisualAsset } | null =
    null;
  const own = (el: HTMLElement) => el.closest("[data-visual-surface]") === root;
  root.dataset.visualSurface = "true";
  const elements = () =>
    Array.from(root.querySelectorAll<HTMLElement>("[data-visual-kind]")).filter(
      own,
    );
  const assets = () =>
    options.assets().map((item) => {
      const element = elements().find(
        (el) =>
          el.dataset.visualId === item.id ||
          (item.from !== undefined &&
            Number(el.dataset.visualFrom) === item.from),
      );
      const snapshot = element && diagramSnapshot(element),
        img = element?.querySelector("img");
      return {
        ...item,
        ...(snapshot ? { svg: snapshot.svg, source: snapshot.source } : {}),
        ...(element?.dataset.previewState
          ? { state: element.dataset.previewState as VisualAsset["state"] }
          : {}),
        ...(img?.naturalWidth
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : {}),
      };
    });
  const find = (el: HTMLElement, items = assets()) =>
    items.find(
      (i) =>
        el.dataset.visualId === i.id ||
        (i.from !== undefined && Number(el.dataset.visualFrom) === i.from),
    );
  const open = (item: VisualAsset, panel?: "info" | "markup") => {
    if (!alive) return;
    menu?.();
    const board = canvasVisuals(root);
    const list = board.length ? board : assets(),
      index = list.findIndex(
        (i) =>
          i.id === item.id ||
          (!!i.placement &&
            !!item.placement &&
            samePlacement(i.placement, item.placement)),
      );
    // A single click can remove a diagram's preview while entering its rich
    // editor. Keep the pre-click rendered snapshot through that projection.
    if (index >= 0 && item.svg && !list[index].svg)
      list[index] = {
        ...list[index],
        svg: item.svg,
        source: item.source,
        state: item.state,
      };
    if (index < 0) return;
    const active =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const scrolls: { el: Element; x: number; y: number }[] = [];
    for (let el: Element | null = root; el; el = el.parentElement)
      if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
        scrolls.push({ el, x: el.scrollLeft, y: el.scrollTop });
    const restore = options.captureRestore?.();
    openVisual({
      items: list,
      index,
      current: () =>
        canvasVisuals(root).length ? canvasVisuals(root) : assets(),
      initialPanel: panel,
      restore: () => {
        if (!root.isConnected) return;
        if (restore) restore();
        else if (active?.isConnected) active.focus({ preventScroll: true });
        requestAnimationFrame(() =>
          scrolls.forEach(({ el, x, y }) => {
            el.scrollLeft = x;
            el.scrollTop = y;
          }),
        );
      },
    });
  };
  surfaces.set(root, { assets, open });
  const controls = () => {
    if (!alive) return;
    const items = options.assets();
    const resource = items.find((i) => i.placement)?.placement?.resourceId;
    if (resource && resource !== loadedResource) load();
    for (const el of elements()) {
      const item = find(el, items);
      if (!item) continue;
      if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
      let button = el.querySelector<HTMLButtonElement>(
        ":scope > [data-visual-open]",
      );
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "visual-open-button";
        button.dataset.visualOpen = "true";
        button.dataset.editorChrome = "true";
        button.contentEditable = "false";
        button.append(actionIcon("focus"), document.createElement("span"));
        el.append(button);
      }
      const count = marks.filter(
        (m) =>
          !m.deleted &&
          !m.parentId &&
          !m.resolved &&
          item.placement &&
          samePlacement(m.placement, item.placement),
      ).length;
      const label = count
        ? `View ${item.kind === "image" ? "image" : "diagram"} · ${count} annotations`
        : `View ${item.kind === "image" ? "image" : "diagram"} larger`;
      button.title = label;
      button.setAttribute("aria-label", label);
      if (button.lastElementChild?.textContent !== (count ? String(count) : ""))
        button.lastElementChild!.textContent = count ? String(count) : "";
      button.classList.toggle("has-marks", count > 0);
    }
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(controls);
  };
  const load = () => {
    if (loading) return;
    const id = options.assets().find((i) => i.placement)?.placement?.resourceId;
    if (!id) return;
    loading = true;
    loadedResource = id;
    void loadVisualMarks(id)
      .then((rows) => {
        if (alive && loadedResource === id) {
          marks = rows;
          schedule();
        }
      })
      .catch(() => {})
      .finally(() => {
        loading = false;
      });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.isPrimary === false
      )
        return;
      const target = event.target as Element;
      if (target.closest("[data-visual-open]")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const el = target.closest<HTMLElement>("[data-visual-kind]"),
        item = el && own(el) ? find(el) : undefined;
      if (
        last &&
        event.timeStamp - last.time < 550 &&
        Math.hypot(event.clientX - last.x, event.clientY - last.y) < 7 &&
        (!item || item.id === last.item.id)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openedAt = event.timeStamp;
        open(last.item);
        last = null;
        return;
      }
      last = item
        ? { time: event.timeStamp, x: event.clientX, y: event.clientY, item }
        : null;
    },
    { signal, capture: true },
  );
  root.addEventListener(
    "mousedown",
    (event) => {
      if ((event.target as Element).closest("[data-visual-open]")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { signal, capture: true },
  );
  root.addEventListener(
    "click",
    (event) => {
      const button = (event.target as Element).closest("[data-visual-open]"),
        el = button?.closest<HTMLElement>("[data-visual-kind]");
      if (el && own(el)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const item = find(el);
        if (item)
          open(
            item,
            button?.classList.contains("has-marks") ? "markup" : undefined,
          );
      }
    },
    { signal, capture: true },
  );
  root.addEventListener(
    "dblclick",
    (event) => {
      const el = (event.target as Element).closest<HTMLElement>(
        "[data-visual-kind]",
      );
      if (el && own(el) && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const item = find(el);
        if (item && event.timeStamp - openedAt > 550) open(item);
      }
    },
    { signal, capture: true },
  );
  root.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing || !(event.altKey && event.key === "Enter")) return;
      const el = (event.target as Element).closest<HTMLElement>(
        "[data-visual-kind]",
      );
      // Atom focus is redirected to the source editor so that regular typing
      // remains source-backed. Resolve that selected range as well as DOM focus.
      const selection = !el && options.selection?.();
      const item = el
        ? find(el)
        : selection &&
          assets().find(
            (candidate) =>
              candidate.from !== undefined &&
              candidate.to !== undefined &&
              Math.min(selection.anchor, selection.head) >= candidate.from &&
              Math.max(selection.anchor, selection.head) <= candidate.to,
          );
      if (item) {
        event.preventDefault();
        event.stopPropagation();
        open(item);
      }
    },
    { signal, capture: true },
  );
  root.addEventListener(
    "contextmenu",
    (event) => {
      const el = (event.target as Element).closest<HTMLElement>(
        "[data-visual-kind]",
      );
      const item = el && own(el) && find(el);
      if (!item) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const actions = visualActions(item, open);
      if (options.editorMenu && item.from !== undefined)
        actions.push({
          label: "Editing actions…",
          icon: "edit",
          group: "Editing",
          action: () =>
            options.editorMenu!(event.clientX, event.clientY, item.from!),
        });
      menu = openContextMenu({
        owner: root,
        x: event.clientX,
        y: event.clientY,
        label: "Visual actions",
        items: actions,
      });
    },
    { signal, capture: true },
  );
  const refresh = () => {
    load();
    schedule();
  };
  window.addEventListener(visualMarksEvent, refresh, { signal });
  root.addEventListener("axiom:diagram-rendered", schedule, { signal });
  controls();
  load();
  return () => {
    alive = false;
    abort.abort();
    observer.disconnect();
    cancelAnimationFrame(frame);
    menu?.();
    surfaces.delete(root);
    delete root.dataset.visualSurface;
    root.querySelectorAll("[data-visual-open]").forEach((b) => b.remove());
  };
}
function visualActions(
  item: VisualAsset,
  open: (item: VisualAsset, panel?: "info" | "markup") => void,
): ContextAction[] {
  return [
    {
      label: "View larger",
      icon: "focus",
      group: "View",
      shortcut: "⌥↵",
      action: () => open(item),
    },
    {
      label:
        item.kind === "mermaid" ? "Diagram information" : "Image information",
      icon: "info",
      group: "View",
      action: () => open(item, "info"),
    },
    {
      label: "Annotate this placement",
      icon: "comment",
      group: "Markup",
      action: () => open(item, "markup"),
    },
  ];
}
