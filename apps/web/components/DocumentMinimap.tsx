"use client";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import type { ParsedDocument } from "@axiom/markdown";
import {
  clamp,
  clusteredMarkers,
  minimapBlocks,
  minimapLayout,
  minimapWidth,
  minimapY,
  type NavigationMarker,
} from "@axiom/editor/minimap";
import type { MinimapPreferences } from "@axiom/shared/minimap";
import { paintMinimap } from "../lib/minimap-painter";
import {
  scrollToSource,
  type DocumentNavigation,
  type NavigationAdapter,
} from "../lib/document-navigation";
import { openContextMenu, type ContextAction } from "../lib/context-menu";
import { editorOverlayActive } from "../lib/editor-popover";

type Props = {
  root: RefObject<HTMLElement | null>;
  navigation: DocumentNavigation;
  adapter: NavigationAdapter;
  source: string;
  parsed: ParsedDocument;
  mode: "write" | "source" | "read";
  preferences: MinimapPreferences;
  themeKey: string;
  active: boolean;
  minimumDocumentWidth?: number;
  markers?: NavigationMarker[];
  onChange: (preferences: MinimapPreferences) => void;
  onSettings?: () => void;
  onOpenMarker?: (id: string, trigger: HTMLElement) => void;
};

export default function DocumentMinimap(props: Props) {
  const p = props.preferences,
    n = props.navigation;
  const enabled = props.active && p.enabled && p[props.mode];
  const coherent = !n.editor || n.editor.source === props.source;
  const host = useRef<HTMLElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    control = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  current.current = props;
  const [width, setWidth] = useState(p.width),
    [preview, setPreview] = useState<{
      label: string;
      text: string;
      x: number;
      y: number;
    } | null>(null);
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    menu = useRef<(() => void) | null>(null);
  const composition = useRef(false),
    deferred = useRef<(() => void) | null>(null);
  const drag = useRef<{
    id: number;
    y: number;
    scroll: number;
    travel: number;
    max: number;
  } | null>(null);
  const lastTarget = useRef(0),
    priorFocus = useRef<HTMLElement | null>(null);
  const id = useId(),
    compact = width < 80;
  const visibleHeight = Math.max(1, n.height);
  const layout = minimapLayout(
    n.extent,
    visibleHeight,
    visibleHeight,
    width - 8,
    n.width,
    compact ? "fill" : p.size,
    n.scroll,
  );
  const blocks = useMemo(
    () =>
      enabled
        ? minimapBlocks(props.source, props.parsed, n.blocks, props.mode)
        : [],
    [enabled, props.source, props.parsed, n.blocks, props.mode],
  );
  const markers: NavigationMarker[] = [
    ...(props.markers ?? []),
    ...(n.editor?.markers ?? []).filter((m) =>
      m.kind === "search"
        ? p.search
        : m.kind === "peer"
          ? p.collaborators
          : true,
    ),
    ...(p.selection && n.editor && props.mode !== "read"
      ? [
          {
            id: "cursor",
            kind: "cursor" as const,
            from: n.editor.selection.head,
            to: n.editor.selection.head,
            label: "Editing position",
          },
          ...(n.editor.selection.anchor !== n.editor.selection.head
            ? [
                {
                  id: "selection",
                  kind: "selection" as const,
                  from: Math.min(
                    n.editor.selection.anchor,
                    n.editor.selection.head,
                  ),
                  to: Math.max(
                    n.editor.selection.anchor,
                    n.editor.selection.head,
                  ),
                  label: "Selected passage",
                },
              ]
            : []),
        ]
      : []),
  ];
  const positionY = (at: number) => n.positions.get(at) ?? n.index.yAt(at);
  // Align marks with the miniature, not with the document's scroll percentage.
  // Compact mode already uses Fill, preserving its whole-document overview.
  const groups = clusteredMarkers(
    coherent ? markers : [],
    (m) => minimapY(positionY(m.from), layout),
    visibleHeight,
  );
  const selection = markers.find((m) => m.kind === "selection");
  const selectionY = selection
    ? [positionY(selection.from), positionY(selection.to)].map((y) =>
        clamp(minimapY(y, layout), 0, visibleHeight),
      )
    : null;
  let previousHeadingY = -Infinity;
  const headings =
    p.headings && !compact
      ? props.parsed.outline
          .filter((h) => h.level <= 2)
          .map((h) => ({
            ...h,
            y: minimapY(n.index.yAt(h.from), layout),
          }))
          .filter((h) => {
            if (
              h.y < 20 ||
              h.y >= visibleHeight - 20 ||
              h.y - previousHeadingY < 24
            )
              return false;
            previousHeadingY = h.y;
            return true;
          })
      : [];

  useEffect(() => {
    if (!enabled) return;
    const row = host.current?.closest<HTMLElement>(".document-navigation-row");
    if (!row) return;
    const resize = () => {
      const next = minimapWidth(
        row.clientWidth,
        current.current.preferences.width,
        current.current.minimumDocumentWidth,
      );
      setWidth(next);
      row.style.setProperty("--minimap-width", `${next}px`);
      // Moving the column can translate the scroller without changing its size.
      // ResizeObserver alone cannot refresh the shared margin's viewport origin.
      current.current.root.current?.dispatchEvent(
        new Event("axiom:mark-layout"),
      );
    };
    row.dataset.minimap = p.side;
    const observer = new ResizeObserver(resize);
    observer.observe(row);
    resize();
    return () => {
      observer.disconnect();
      delete row.dataset.minimap;
      row.style.removeProperty("--minimap-width");
    };
  }, [enabled, p.side, p.width]);
  useEffect(() => {
    if (!canvas.current || !enabled || compact || !coherent) return;
    return paintMinimap(canvas.current, blocks, {
      width,
      height: visibleHeight,
      scale: layout.scale,
      offset: layout.offset,
      mode: props.mode,
      rendering: p.rendering,
    });
  }, [
    enabled,
    compact,
    coherent,
    blocks,
    n.revision,
    width,
    visibleHeight,
    layout.scale,
    layout.offset,
    props.mode,
    p.rendering,
    props.themeKey,
  ]);
  useEffect(() => {
    const element = host.current;
    if (!element || !enabled) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return; // Browser zoom remains native.
      event.preventDefault();
      event.stopPropagation();
      const root = current.current.root.current;
      if (root)
        setScroll(
          root.scrollTop +
            event.deltaY *
              (event.deltaMode === 1
                ? 18
                : event.deltaMode === 2
                  ? root.clientHeight
                  : 1),
        );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [enabled]);
  useEffect(() => {
    const root = props.root.current;
    if (!root) return;
    const begin = () => {
      composition.current = true;
    };
    const end = () => {
      composition.current = false;
      const work = deferred.current;
      deferred.current = null;
      // Let the editor commit its final composition input before explicit focus.
      if (work) setTimeout(work, 0);
    };
    const command = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "focus" && enabled)
        control.current?.focus({ preventScroll: true });
      if (action === "return") returnToCursor();
    };
    root.addEventListener("compositionstart", begin, true);
    root.addEventListener("compositionend", end, true);
    root.addEventListener("axiom:minimap-command", command);
    return () => {
      root.removeEventListener("compositionstart", begin, true);
      root.removeEventListener("compositionend", end, true);
      root.removeEventListener("axiom:minimap-command", command);
      deferred.current = null;
      composition.current = false;
    };
  }, [props.root, enabled]);
  useEffect(() => {
    if (!enabled) {
      setPreview(null);
      drag.current = null;
      menu.current?.();
    }
    return () => {
      clearTimeout(timer.current);
      menu.current?.();
      drag.current = null;
      deferred.current = null;
    };
  }, [enabled]);
  // Never let a delayed preview or context-menu target jump into a newer revision.
  useEffect(() => {
    clearTimeout(timer.current);
    setPreview(null);
    drag.current = null;
  }, [props.source, props.mode]);
  const navigate = (from: number) =>
    scrollToSource(props.root.current, current.current.navigation, from);
  const setScroll = (value: number) => {
    const root = props.root.current;
    if (!root) return;
    root.scrollTop =
      value === Infinity
        ? root.scrollHeight
        : clamp(value, 0, Math.max(0, root.scrollHeight - root.clientHeight));
    root.dispatchEvent(new Event("axiom:minimap-navigated"));
  };
  const returnToCursor = () => {
    const at = current.current.adapter.snapshot()?.selection.head ?? 0;
    navigate(at);
  };
  const restoreFocus = () => {
    const previous = priorFocus.current;
    if (
      current.current.mode !== "read" &&
      (!previous?.isConnected ||
        current.current.root.current?.contains(previous))
    ) {
      // A blurred heading/embedded block may have replaced its DOM projection.
      // Restore the editor's mapped selection, never a stale DOM Range.
      current.current.adapter.focus();
    } else if (previous?.isConnected) previous.focus({ preventScroll: true });
    else current.current.root.current?.focus({ preventScroll: true });
  };
  const goTo = (position: number, source: string) => {
    const work = () => {
      const state = current.current.navigation.editor;
      if (
        source !== current.current.source ||
        (state && state.source !== source)
      ) {
        setMessage("The document changed. Choose the location again.");
        return;
      }
      if (current.current.mode === "read") navigate(position);
      else current.current.adapter.focus(position);
    };
    if (composition.current || current.current.adapter.snapshot()?.composing)
      deferred.current = work;
    else work();
  };
  const options = (target = lastTarget.current): ContextAction[] => {
    const source = props.source;
    const change = (patch: Partial<MinimapPreferences>) =>
      props.onChange({ ...current.current.preferences, ...patch });
    const choices = <K extends keyof MinimapPreferences>(
      key: K,
      values: [MinimapPreferences[K], string][],
    ): ContextAction[] =>
      values.map(([value, label]) => ({
        label,
        icon: "outline",
        checked: p[key] === value,
        action: () => change({ [key]: value }),
      }));
    return [
      {
        label: "Return to cursor",
        icon: "undo",
        group: "navigate",
        action: returnToCursor,
      },
      {
        label: "Go to location",
        icon: "focus",
        group: "navigate",
        action: () => goTo(target, source),
      },
      {
        label: "Document start",
        icon: "moveUp",
        group: "navigate",
        action: () => setScroll(0),
      },
      {
        label: "Document end",
        icon: "moveDown",
        group: "navigate",
        action: () => setScroll(Infinity),
      },
      {
        label: "Rendering",
        icon: "code",
        group: "display",
        action: () => {},
        children: choices("rendering", [
          ["text", "Miniature text"],
          ["blocks", "Color blocks"],
        ]),
      },
      {
        label: "Sizing",
        icon: "outline",
        group: "display",
        action: () => {},
        children: choices("size", [
          ["fit", "Fit document"],
          ["proportional", "Proportional"],
          ["fill", "Fill height"],
        ]),
      },
      {
        label: "Position",
        icon: "outline",
        group: "display",
        action: () => {},
        children: choices("side", [
          ["right", "Right"],
          ["left", "Left"],
        ]),
      },
      {
        label: "Heading labels",
        icon: "heading1",
        group: "display",
        checked: p.headings,
        action: () => change({ headings: !p.headings }),
      },
      {
        label: "Always show viewport",
        icon: "focus",
        group: "display",
        checked: p.slider === "always",
        action: () =>
          change({ slider: p.slider === "always" ? "hover" : "always" }),
      },
      ...(props.onSettings
        ? [
            {
              label: "Minimap settings",
              icon: "settings" as const,
              group: "settings",
              action: props.onSettings,
            },
          ]
        : []),
      {
        label: "Hide minimap",
        icon: "close",
        group: "settings",
        action: () => change({ enabled: false }),
      },
    ];
  };
  const openMenu = (
    owner: HTMLElement,
    x: number,
    y: number,
    items = options(),
  ) => {
    setPreview(null);
    clearTimeout(timer.current);
    menu.current?.();
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      !focused.closest('.document-minimap,[role="menu"]')
    )
      priorFocus.current = focused;
    menu.current = openContextMenu({
      owner,
      x,
      y,
      label: "Minimap actions",
      items,
      restore: () => control.current?.focus({ preventScroll: true }),
    });
  };
  const markerMenu = (button: HTMLElement, entries: NavigationMarker[]) => {
    const box = button.getBoundingClientRect(),
      source = props.source;
    openMenu(
      button,
      box.left,
      box.bottom,
      entries.map((m) => ({
        label: m.label.slice(0, 100),
        icon:
          m.kind === "bookmark"
            ? "bookmark"
            : m.kind === "annotation"
              ? "comment"
              : m.kind === "search"
                ? "search"
                : "focus",
        action: () => {
          if (source === current.current.source) navigate(m.from);
        },
        ...(props.onOpenMarker && ["bookmark", "annotation"].includes(m.kind)
          ? {
              children: [
                {
                  label: "Scroll to mark",
                  icon: "focus" as const,
                  action: () => {
                    if (source === current.current.source) navigate(m.from);
                  },
                },
                {
                  label:
                    m.kind === "annotation"
                      ? "Open annotation"
                      : "Manage bookmark",
                  icon: "comment" as const,
                  action: () => props.onOpenMarker?.(m.id, button),
                },
              ],
            }
          : {}),
      })),
    );
  };
  const previewAt = (localY: number, clientX: number, clientY: number) => {
    const y = clamp((localY + layout.offset) / layout.scale, 0, n.extent),
      position = n.index.sourceAt(y);
    lastTarget.current = position;
    clearTimeout(timer.current);
    if (!p.preview || editorOverlayActive()) return;
    const block = n.index.atHeight(y),
      heading = [...props.parsed.outline]
        .reverse()
        .find((h) => h.from <= position);
    const excerpt = blocks.find(
      (b) => b.from === block?.from && b.type === block?.type,
    );
    timer.current = setTimeout(
      () =>
        setPreview({
          label:
            heading?.text ||
            (block?.type === "sourceLine"
              ? "Markdown source"
              : excerpt?.label || "Document"),
          text: excerpt?.text.slice(0, 300) || "Start of document",
          x: clamp(
            p.side === "right" ? clientX - 306 : clientX + 18,
            10,
            Math.max(10, innerWidth - 310),
          ),
          y: clamp(clientY - 30, 10, Math.max(10, innerHeight - 210)),
        }),
      300,
    );
  };
  if (!enabled) return null;
  return (
    <aside
      ref={host}
      className={`document-minimap${compact ? " is-compact" : ""}`}
      data-mode={props.mode}
      data-slider={p.slider}
      data-measures={n.measures}
      aria-label="Document minimap"
      style={{ width }}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.currentTarget, e.clientX, e.clientY);
      }}
    >
      <canvas ref={canvas} aria-hidden="true" className="minimap-canvas" />
      {selectionY && (
        <span
          aria-hidden="true"
          className="minimap-selection-range"
          style={{
            top: Math.min(...selectionY),
            height: Math.max(2, Math.abs(selectionY[1] - selectionY[0])),
          }}
        />
      )}
      <div
        ref={control}
        className="minimap-scroll-control"
        role="scrollbar"
        tabIndex={0}
        aria-label="Document minimap scroll position"
        aria-orientation="vertical"
        aria-controls={props.root.current?.id || undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(layout.fraction * 100)}
        aria-valuetext={`${Math.round(layout.fraction * 100)} percent through document${compact ? ". Compact overview for this pane width." : ""}`}
        aria-describedby={preview ? id : undefined}
        onFocus={(e) => {
          if (
            e.relatedTarget instanceof HTMLElement &&
            !e.relatedTarget.closest('.document-minimap,[role="menu"]')
          )
            priorFocus.current = e.relatedTarget;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setPreview(null);
            restoreFocus();
            return;
          }
          if (e.key === "F10" && e.shiftKey) {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            openMenu(e.currentTarget, r.left, r.top + 20);
            return;
          }
          const delta = (
            {
              ArrowUp: -36,
              ArrowDown: 36,
              PageUp: -n.height * 0.85,
              PageDown: n.height * 0.85,
            } as Record<string, number>
          )[e.key];
          if (delta !== undefined || e.key === "Home" || e.key === "End") {
            e.preventDefault();
            setScroll(
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? Infinity
                  : (props.root.current?.scrollTop ?? n.scroll) + delta,
            );
          }
          if (e.key === "Enter") {
            e.preventDefault();
            goTo(
              n.index.sourceAt(
                (props.root.current?.scrollTop ?? n.scroll) + n.height / 2,
              ),
              props.source,
            );
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          setPreview(null);
          clearTimeout(timer.current);
          const rect = e.currentTarget.getBoundingClientRect(),
            y = e.clientY - rect.top;
          lastTarget.current = n.index.sourceAt(
            (y + layout.offset) / layout.scale,
          );
          const slider =
            y >= layout.thumbTop && y <= layout.thumbTop + layout.thumbHeight;
          if (!slider)
            setScroll((y + layout.offset) / layout.scale - n.height / 2);
          drag.current = {
            id: e.pointerId,
            y: e.clientY,
            scroll: props.root.current?.scrollTop ?? n.scroll,
            travel: Math.max(
              1,
              Math.min(layout.track, layout.content) - layout.thumbHeight,
            ),
            max: layout.maxScroll,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current?.id === e.pointerId) {
            const d = drag.current;
            setScroll(d.scroll + ((e.clientY - d.y) / d.travel) * d.max);
          } else
            previewAt(
              e.clientY - e.currentTarget.getBoundingClientRect().top,
              e.clientX,
              e.clientY,
            );
        }}
        onPointerUp={(e) => {
          drag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          clearTimeout(timer.current);
          setPreview(null);
        }}
      >
        <span
          className="minimap-viewport"
          style={{ top: layout.thumbTop, height: layout.thumbHeight }}
        />
      </div>
      {!compact &&
        headings.slice(0, 80).map((h, i) => (
          <button
            key={`${h.id}:${h.from}`}
            className="minimap-heading"
            style={{ top: h.y }}
            title={h.text}
            aria-label={`Scroll to section: ${h.text}`}
            tabIndex={i === 0 ? 0 : -1}
            onKeyDown={(e) => {
              if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
              e.preventDefault();
              const buttons = Array.from(
                host.current!.querySelectorAll<HTMLButtonElement>(
                  ".minimap-heading",
                ),
              );
              buttons[
                (i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                  buttons.length
              ]?.focus({ preventScroll: true });
            }}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => navigate(h.from)}
          >
            {h.text}
          </button>
        ))}
      <div className="minimap-marker-lane" aria-label="Minimap markers">
        {groups.map(({ key, top, entries }, i) => (
          <button
            key={key}
            data-minimap-marker
            data-kind={entries[0].kind}
            data-mark-color={
              ["neutral", "blue", "green", "amber", "rose"].includes(
                entries[0].color ?? "",
              )
                ? entries[0].color
                : undefined
            }
            className="minimap-marker"
            style={{
              top,
              ...(entries[0].color &&
              typeof CSS !== "undefined" &&
              CSS.supports("color", entries[0].color)
                ? { "--minimap-marker": entries[0].color }
                : {}),
            }}
            tabIndex={i === 0 ? 0 : -1}
            aria-label={
              entries.length === 1
                ? entries[0].label
                : `${entries.length} marks: ${entries
                    .map((m) => m.label)
                    .join(", ")
                    .slice(0, 180)}`
            }
            title={entries.map((m) => m.label).join(" · ")}
            onPointerDown={(e) => e.preventDefault()}
            onClick={(e) =>
              entries.length === 1
                ? navigate(entries[0].from)
                : markerMenu(e.currentTarget, entries)
            }
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              markerMenu(e.currentTarget, entries);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const buttons = Array.from(
                  e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                    "button",
                  ),
                );
                buttons[
                  (i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                    buttons.length
                ]?.focus({ preventScroll: true });
              }
            }}
          />
        ))}
      </div>
      <button
        className="minimap-menu icon-button"
        aria-label="Minimap options"
        title={compact ? "Minimap options · compact pane" : "Minimap options"}
        onPointerDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          openMenu(e.currentTarget, b.left, b.bottom);
        }}
      >
        <MoreHorizontal size={13} />
      </button>
      <span className="sr-only" role="status">
        {message}
      </span>
      {preview &&
        createPortal(
          <div
            className="minimap-preview"
            role="tooltip"
            id={id}
            style={{ left: preview.x, top: preview.y }}
          >
            <strong>{preview.label}</strong>
            <p>{preview.text}</p>
            <small>Click or drag to scroll · cursor stays in place</small>
          </div>,
          document.body,
        )}
    </aside>
  );
}
