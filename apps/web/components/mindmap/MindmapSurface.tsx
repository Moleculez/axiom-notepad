"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  type CSSProperties,
  type Ref,
  type KeyboardEvent,
} from "react";
import {
  Braces,
  ChevronLeft,
  ChevronRight,
  Download,
  Focus,
  Info,
  Minus,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import {
  parseMarkdown,
  renderDocument,
  type RenderContext,
} from "@axiom/markdown";
import {
  mindmapCommand,
  moveMindmapBranch,
  mindmapConnector,
  nodeAtMindmapPosition,
  fitMindmap,
  mindmapZoomLimits,
  type MindmapNode,
  type MindmapSettings,
  type MindmapEdit,
  type MindmapProjection,
} from "@axiom/mindmap";
import type { NativeBinding } from "@axiom/editor/binding";
import { mindmapSettingsSchema } from "@axiom/shared/mindmap";
import {
  Button,
  IconButton,
  SearchField,
  TextInput,
  Checkbox,
  Notice,
  HelpText,
} from "../ui/controls";
import ResizablePanel from "../ResizablePanel";
import StudioSource from "../tools/StudioSource";
import ReadingView from "../ReadingView";
import { openContextMenu, type ContextAction } from "../../lib/context-menu";
import { confirmAction } from "../../lib/app-prompt";
import { useMindmap } from "../../lib/use-mindmap";
import MindmapExportDialog from "./MindmapExportDialog";
import MindmapDisplayDialog from "./MindmapDisplayDialog";
import { mindmapRichLabel } from "@axiom/mindmap/label";
import {
  mindmapViewSchema,
  resolveMindmapDraft,
  type MindmapViewState,
  type MindmapDraft,
} from "../../lib/mindmap-state";

type Bookmark = ReturnType<NativeBinding["relative"]>;
type Fold = { bookmark: Bookmark; type: string };
type Draft = MindmapDraft;
type Camera = { x: number; y: number; scale: number };
export type MindmapHandle = {
  focus: (position?: number) => void;
  toggleSource: () => void;
};
export type MindmapProps = {
  binding: NativeBinding;
  scope: string;
  account: string;
  title: string;
  readOnly: boolean;
  canEdit: () => boolean;
  context: RenderContext;
  settings?: Partial<MindmapSettings>;
  onSaveDefaults?: (settings: MindmapSettings) => Promise<void>;
  onLink: (target: string) => void;
  onComment?: (from: number, to: number, annotation: boolean) => void;
  onBookmark?: (from: number, to: number) => void;
  onDocument?: (position: number) => void;
  externalInspector?: boolean;
  onAuxiliary?: () => void;
  beforeExport?: () => Promise<void>;
  ref?: Ref<MindmapHandle>;
};

/** A projection of the host's binding, never a second editor session/document. */
export default function MindmapSurface(props: MindmapProps) {
  const { binding } = props;
  const key = `axiom:mindmap:${props.scope}`;
  const initialSettings = mindmapSettingsSchema
    .catch(mindmapSettingsSchema.parse({}))
    .parse(props.settings ?? {});
  const [source, setSource] = useState(binding.source),
    [settings, setSettings] = useState<MindmapSettings>(initialSettings),
    [folds, setFolds] = useState<Fold[]>([]),
    [pane, setPane] = useState<"source" | "details" | null>(null),
    [selected, setSelected] = useState("root"),
    [query, setQuery] = useState(""),
    [camera, setCamera] = useState<Camera>({ x: 40, y: 40, scale: 1 }),
    [viewport, setViewport] = useState({ width: 900, height: 600 }),
    [sizes, setSizes] = useState<
      Record<string, { width: number; height: number }>
    >({}),
    [draft, setDraft] = useState<Draft | null>(null),
    [message, setMessage] = useState(""),
    [display, setDisplay] = useState(false),
    [exporting, setExporting] = useState<{
      source: string;
      projection: MindmapProjection;
      selected?: string;
      settings: MindmapSettings;
    } | null>(null),
    [peers, setPeers] = useState(binding.peers());
  const host = useRef<HTMLDivElement>(null),
    stage = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    selectedAnchor = useRef<Bookmark | null>(null),
    pendingNode = useRef<Bookmark | null>(null),
    pendingFocus = useRef<Bookmark | null>(null),
    initialized = useRef(false),
    fitPending = useRef(false),
    stored = useRef<MindmapViewState | null>(null),
    localPreferences = useRef(false),
    dropTarget = useRef<HTMLElement | null>(null),
    drag = useRef<{
      id?: string;
      bookmark?: Bookmark;
      original?: string;
      x: number;
      y: number;
      camera: Camera;
      pointer: number;
      moved: boolean;
      target: HTMLDivElement;
    } | null>(null),
    measurements = useRef(
      new Map<string, { signature: string; width: number; height: number }>(),
    );
  const latest = useRef(props);
  const clearDrop = () => {
    dropTarget.current?.removeAttribute("data-map-drop");
    dropTarget.current = null;
  };
  const labelCache = useRef(
    new Map<string, { key: string; html: string; context: RenderContext }>(),
  );
  latest.current = props;
  const foldPositions = useMemo(
    () =>
      folds.flatMap((fold) => {
        const range = binding.absolute(fold.bookmark);
        return range && range.anchor < range.head
          ? [{ position: range.anchor, type: fold.type }]
          : [];
      }),
    [binding, folds, source],
  );
  const request = useMemo(
    () => ({
      source,
      title: props.title,
      settings,
      folds: foldPositions,
      sizes,
    }),
    [source, props.title, settings, foldPositions, sizes],
  );
  const result = useMindmap(request);
  const projection = result?.projection,
    layout = result?.layout;
  const byId = useMemo(
    () => new Map(projection?.nodes.map((n) => [n.id, n]) ?? []),
    [projection],
  );
  const placements = useMemo(
    () => new Map(layout?.nodes.map((n) => [n.id, n]) ?? []),
    [layout],
  );
  const chosen = byId.get(selected) ?? projection?.nodes[0];
  const selectedNow = () => {
    if (!projection || result?.source !== binding.source)
      throw new Error(
        "The map is updating. Wait for the current source before changing a branch.",
      );
    return byId.get(selected) ?? projection.nodes[0];
  };
  const changePane = (next: typeof pane) => {
    setPane(next);
    if (next) latest.current.onAuxiliary?.();
  };
  const focusNode = (node: MindmapNode, focus = true) => {
    setSelected(node.id);
    const from = node.kind === "root" && !node.level ? 0 : node.labelFrom;
    const to = node.kind === "root" && !node.level ? 0 : node.labelTo;
    binding.select({ anchor: from, head: to });
    selectedAnchor.current = binding.relative({
      anchor: node.from,
      head: node.to,
    });
    const position = placements.get(node.id);
    if (!position && focus)
      pendingFocus.current = binding.relative({
        anchor: node.from,
        head: node.to,
      });
    if (position)
      setCamera((c) => ({
        ...c,
        x: viewport.width / 2 - (position.x + position.width / 2) * c.scale,
        y: viewport.height / 2 - (position.y + position.height / 2) * c.scale,
      }));
    if (focus)
      requestAnimationFrame(() =>
        stage.current
          ?.querySelector<HTMLElement>(
            `[data-map-node="${CSS.escape(node.id)}"]`,
          )
          ?.focus({ preventScroll: true }),
      );
  };
  useImperativeHandle(
    props.ref,
    () => ({
      toggleSource: () => changePane(pane === "source" ? null : "source"),
      focus(position) {
        if (projection) {
          const node =
            position === undefined
              ? chosen!
              : nodeAtMindmapPosition(projection, position);
          // Reveal the exact branch, not a similarly named node.
          const ancestors = new Set<number>();
          let parent = node.parentId;
          while (parent) {
            const n = byId.get(parent);
            if (!n) break;
            ancestors.add(n.from);
            parent = n.parentId;
          }
          setFolds((items) =>
            items.filter(
              (item) =>
                !ancestors.has(binding.absolute(item.bookmark)?.anchor ?? -1),
            ),
          );
          focusNode(node);
        } else host.current?.focus();
      },
    }),
    [projection, chosen, placements, viewport, binding, pane],
  );
  useEffect(() => binding.subscribe((value) => setSource(value)), [binding]);
  useEffect(() => binding.onPresence(setPeers), [binding]);
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const observer = new ResizeObserver(() =>
      setViewport({ width: root.clientWidth, height: root.clientHeight }),
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try {
      const value = mindmapViewSchema.safeParse(
        JSON.parse(localStorage.getItem(key) ?? "null"),
      );
      if (value.success) {
        stored.current = value.data;
        localPreferences.current = true;
        setSettings(value.data.settings);
        setPane(value.data.pane);
      }
    } catch {
      /* Private browsing still has a fully usable in-memory map. */
    }
  }, [key]);
  useEffect(() => {
    if (localPreferences.current) return;
    const defaults = mindmapSettingsSchema.safeParse(props.settings ?? {});
    if (defaults.success) setSettings(defaults.data);
  }, [props.settings]);
  useEffect(() => {
    if (!draft || draft.value === draft.original) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [draft]);
  useEffect(() => {
    if (props.externalInspector) setPane(null);
  }, [props.externalInspector]);
  useEffect(() => {
    if (!projection || !layout || result?.source !== binding.source) return;
    if (pendingFocus.current) {
      const range = binding.absolute(pendingFocus.current);
      const node =
        range &&
        projection.nodes.find(
          (n) => n.from === range.anchor && n.to >= range.head,
        );
      const placement = node && layout.nodes.find((n) => n.id === node.id);
      if (placement) {
        pendingFocus.current = null;
        setCamera((c) => ({
          ...c,
          x: viewport.width / 2 - (placement.x + placement.width / 2) * c.scale,
          y:
            viewport.height / 2 -
            (placement.y + placement.height / 2) * c.scale,
        }));
        requestAnimationFrame(() =>
          stage.current
            ?.querySelector<HTMLElement>(
              `[data-map-node="${CSS.escape(node.id)}"]`,
            )
            ?.focus({ preventScroll: true }),
        );
      } else if (!node) pendingFocus.current = null;
    }
    const previous =
      selectedAnchor.current && binding.absolute(selectedAnchor.current);
    if (previous && previous.anchor < previous.head) {
      const node = projection.nodes.find(
        (n) => n.from === previous.anchor && n.to >= previous.head,
      );
      if (node) setSelected(node.id);
      else {
        setSelected("root");
        selectedAnchor.current = null;
      }
    }
    if (pendingNode.current) {
      const at = binding.absolute(pendingNode.current);
      pendingNode.current = null;
      if (at) {
        const node = nodeAtMindmapPosition(projection, at.head);
        setSelected(node.id);
        selectedAnchor.current = binding.relative({
          anchor: node.from,
          head: node.to,
        });
        if (["heading", "item"].includes(node.kind)) {
          setDraft({
            bookmark: binding.relative({
              anchor: node.labelFrom,
              head: node.labelTo,
            }),
            original: node.labelSource,
            type: node.blockType,
            value: node.labelSource,
          });
          const placement = layout.nodes.find((n) => n.id === node.id);
          if (placement)
            setCamera((c) => ({
              ...c,
              x:
                viewport.width / 2 -
                (placement.x + placement.width / 2) * c.scale,
              y:
                viewport.height / 2 -
                (placement.y + placement.height / 2) * c.scale,
            }));
          requestAnimationFrame(() => input.current?.focus());
        }
      }
    }
    if (!initialized.current) {
      initialized.current = true;
      const saved = stored.current;
      const collapsed =
        saved?.folds && Array.isArray(saved.folds)
          ? projection.nodes.filter((n) =>
              saved.folds.some(
                (f) =>
                  f.position === n.from &&
                  f.label === n.labelSource &&
                  f.type === n.blockType,
              ),
            )
          : layout.nodes
              .filter((n) => n.depth >= settings.initialDepth)
              .map((n) => byId.get(n.id)!);
      setFolds(
        collapsed
          .filter((n) => n.children.length && n.kind !== "root")
          .map((n) => ({
            bookmark: binding.relative({ anchor: n.from, head: n.to }),
            type: n.blockType,
          })),
      );
      const c = saved?.camera;
      if (
        c &&
        Number.isFinite(c.x) &&
        Number.isFinite(c.y) &&
        c.scale >= mindmapZoomLimits.min &&
        c.scale <= mindmapZoomLimits.max &&
        Math.abs(c.x) <= 100_000_000 &&
        Math.abs(c.y) <= 100_000_000
      )
        setCamera(c);
      else fitPending.current = true;
      const initialNode = projection.nodes.find(
        (n) => n.from === saved?.selection && n.labelSource === saved?.label,
      );
      if (initialNode) {
        setSelected(initialNode.id);
        selectedAnchor.current = binding.relative({
          anchor: initialNode.from,
          head: initialNode.to,
        });
      }
    } else if (fitPending.current) {
      fitPending.current = false;
      setCamera(fitMindmap(layout.bounds, viewport.width, viewport.height));
    }
  }, [
    projection,
    layout,
    result?.source,
    binding,
    settings.initialDepth,
    byId,
    viewport,
  ]);
  useEffect(() => {
    if (!initialized.current || result?.source !== source) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            settings,
            camera,
            pane,
            selection: chosen?.from,
            label: chosen?.labelSource,
            folds: folds.flatMap((f) => {
              const at = binding.absolute(f.bookmark);
              const n = projection?.nodes.find(
                (n) => n.from === at?.anchor && n.blockType === f.type,
              );
              return n
                ? [
                    {
                      position: n.from,
                      label: n.labelSource,
                      type: n.blockType,
                    },
                  ]
                : [];
            }),
          }),
        );
      } catch {
        /* Content remains in the host's durable document journal. */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [
    key,
    settings,
    camera,
    pane,
    folds,
    chosen,
    binding,
    projection,
    result?.source,
    source,
  ]);
  const visible = useMemo(
    () =>
      layout?.nodes.filter(
        (n) =>
          n.id === selected ||
          (n.x + n.width >= (-camera.x - 240) / camera.scale &&
            n.x <= (viewport.width - camera.x + 240) / camera.scale &&
            n.y + n.height >= (-camera.y - 240) / camera.scale &&
            n.y <= (viewport.height - camera.y + 240) / camera.scale),
      ) ?? [],
    [layout, camera, viewport, selected],
  );
  useEffect(() => {
    const root = stage.current;
    if (!root || !projection) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next: typeof sizes = {};
        let changed = false;
        for (const element of root.querySelectorAll<HTMLElement>(
          ".mindmap-label",
        )) {
          const id =
            element.closest<HTMLElement>("[data-map-node]")?.dataset.mapNode;
          const node = id && byId.get(id);
          if (
            !id ||
            !node ||
            element.querySelector("input:not([type=checkbox])")
          )
            continue;
          const signature = `${settings.nodeWidth}:${node.labelSource}:${props.context.theme}:${getComputedStyle(element).fontFamily}:${getComputedStyle(element).fontSize}`;
          const width = Math.min(
              settings.nodeWidth,
              Math.max(80, Math.ceil(element.scrollWidth)),
            ),
            height = Math.max(40, Math.ceil(element.scrollHeight));
          const prior = measurements.current.get(id);
          if (
            !prior ||
            prior.signature !== signature ||
            prior.width !== width ||
            prior.height !== height
          ) {
            measurements.current.set(id, { signature, width, height });
            changed = true;
          }
        }
        if (changed) {
          for (const n of projection.nodes) {
            const m = measurements.current.get(n.id);
            if (m) next[n.id] = { width: m.width, height: m.height };
          }
          for (const id of measurements.current.keys())
            if (!byId.has(id)) measurements.current.delete(id);
          setSizes(next);
        }
      });
    };
    const observer = new ResizeObserver(update);
    root
      .querySelectorAll(".mindmap-label")
      .forEach((node) => observer.observe(node));
    void document.fonts.ready.then(update);
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [projection, byId, visible, settings.nodeWidth, props.context.theme]);
  const folded = new Set(foldPositions.map((f) => f.position));
  const toggle = (node: MindmapNode) => {
    if (!node.children.length || node.kind === "root") {
      if (node.kind === "root") setFolds([]);
      return;
    }
    setFolds((items) =>
      folded.has(node.from)
        ? items.filter(
            (f) => binding.absolute(f.bookmark)?.anchor !== node.from,
          )
        : [
            ...items,
            {
              bookmark: binding.relative({ anchor: node.from, head: node.to }),
              type: node.blockType,
            },
          ],
    );
  };
  const mutate = (edit: () => MindmapEdit) => {
    try {
      if (!latest.current.canEdit())
        throw new Error(
          "This document is read-only. Your local draft has not been applied.",
        );
      binding.transact({ ...edit(), kind: "command" });
      setMessage("");
      return true;
    } catch (error) {
      setMessage((error as Error).message);
      return false;
    }
  };
  const beginEdit = (node: MindmapNode) => {
    if (!latest.current.canEdit()) return;
    if (draft) {
      const at = binding.absolute(draft.bookmark);
      if (at?.anchor === node.labelFrom && draft.type === node.blockType) {
        requestAnimationFrame(() => input.current?.focus());
        return;
      }
      if (draft.value !== draft.original) {
        setMessage(
          "Apply, copy or cancel your current label draft before editing another node.",
        );
        return;
      }
    }
    if (
      !["heading", "item", "root"].includes(node.kind) ||
      (node.kind === "root" && !node.level)
    ) {
      changePane("source");
      binding.select({ anchor: node.from, head: node.to });
      return;
    }
    if (result?.source !== binding.source) {
      setMessage(
        "The map is updating. Select the branch again when it is ready.",
      );
      return;
    }
    setDraft({
      bookmark: binding.relative({
        anchor: node.labelFrom,
        head: node.labelTo,
      }),
      original: node.labelSource,
      type: node.blockType,
      value: node.labelSource,
    });
    setSelected(node.id);
    requestAnimationFrame(() => input.current?.select());
  };
  const commit = () => {
    if (!draft) return;
    const range = binding.absolute(draft.bookmark);
    if (
      !range ||
      binding.source.slice(range.anchor, range.head) !== draft.original ||
      !latest.current.canEdit()
    ) {
      setMessage(
        "This label changed elsewhere or edit access ended. Your draft is retained; copy it or cancel and select the branch again.",
      );
      return;
    }
    const node = projection && resolveMindmapDraft(binding, projection, draft);
    if (!node || result?.source !== binding.source) {
      setMessage(
        "The Markdown structure changed. Your draft is retained; review it in Source.",
      );
      return;
    }
    if (
      mutate(() => mindmapCommand(binding.source, node, "rename", draft.value))
    )
      setDraft(null);
  };
  const add = (node: MindmapNode, name: "child" | "sibling") => {
    if (draft && draft.value !== draft.original) {
      setMessage(
        "Apply, copy or cancel your label draft before adding another branch.",
      );
      return;
    }
    if (mutate(() => mindmapCommand(binding.source, node, name))) {
      pendingNode.current = binding.relative(binding.selection());
      if (name === "child")
        setFolds((items) =>
          items.filter(
            (f) => binding.absolute(f.bookmark)?.anchor !== node.from,
          ),
        );
    }
  };
  const command = (name: "child" | "sibling" | "delete" | "toggleTask") => {
    const run = () => {
      if (name === "child" || name === "sibling") {
        if (result?.source !== binding.source || !chosen) {
          setMessage("Wait for the current map before adding a branch.");
          return;
        }
        add(chosen, name);
        return;
      }
      mutate(() => mindmapCommand(binding.source, selectedNow(), name));
    };
    if (name === "delete")
      void confirmAction(
        "The branch and its descendants will be removed from Markdown. You can undo this edit.",
        {
          title: "Remove this branch?",
          confirmLabel: "Remove branch",
          destructive: true,
        },
      ).then((yes) => {
        if (yes) run();
      });
    else run();
  };
  const move = (node: MindmapNode, direction: "up" | "down" | "out") =>
    mutate(() => {
      if (!projection || result?.source !== binding.source)
        throw new Error("Wait for the map to finish updating.");
      const parent = byId.get(node.parentId ?? ""),
        siblings = parent?.children ?? [];
      const target =
        direction === "out"
          ? parent
          : byId.get(
              siblings[
                siblings.indexOf(node.id) + (direction === "up" ? -1 : 1)
              ],
            );
      if (!target || (target.kind === "root" && direction === "out"))
        throw new Error(
          "This branch cannot move further in that direction. Use Source for an explicit structural conversion.",
        );
      return moveMindmapBranch(
        binding.source,
        projection,
        node.id,
        target.id,
        direction === "up" ? "before" : "after",
      );
    });
  const openMenu = (
    owner: HTMLElement,
    x: number,
    y: number,
    node?: MindmapNode,
  ) => {
    if (node) {
      setSelected(node.id);
      binding.select({ anchor: node.labelFrom, head: node.labelTo });
    }
    const n = node ?? chosen;
    if (!n) return;
    // Capture the menu's target, not a later selection; source changes invalidate it.
    const snapshot = binding.source;
    const run = (action: () => void) => {
      if (binding.source !== snapshot)
        setMessage(
          "The branch changed while the menu was open. Open it again.",
        );
      else action();
    };
    const items: ContextAction[] = [
      {
        label: "Edit label",
        icon: "edit",
        group: "Edit",
        disabled: props.readOnly,
        action: () => run(() => beginEdit(n)),
      },
      {
        label: "Edit in Source",
        icon: "source",
        group: "Edit",
        action: () => {
          changePane("source");
          binding.select({ anchor: n.from, head: n.to });
        },
      },
      {
        label: "Add child",
        icon: "plus",
        group: "Structure",
        disabled: props.readOnly,
        action: () => run(() => add(n, "child")),
      },
      {
        label: "Add sibling",
        icon: "plus",
        group: "Structure",
        disabled: props.readOnly || n.kind === "root",
        action: () => run(() => add(n, "sibling")),
      },
      {
        label: folded.has(n.from) ? "Expand branch" : "Fold branch",
        icon: "chevronRight",
        group: "Structure",
        disabled: !n.children.length,
        action: () => toggle(n),
      },
      {
        label: "Move branch",
        icon: "moveUp",
        group: "Structure",
        disabled: props.readOnly || n.kind === "root",
        action: () => {},
        children: [
          {
            label: "Move up",
            icon: "moveUp",
            shortcut: "Alt ↑",
            action: () => run(() => move(n, "up")),
          },
          {
            label: "Move down",
            icon: "moveDown",
            shortcut: "Alt ↓",
            action: () => run(() => move(n, "down")),
          },
          {
            label: "Outdent",
            icon: "outdent",
            shortcut: "Alt ←",
            action: () => run(() => move(n, "out")),
          },
        ],
      },
      {
        label: "Research actions",
        icon: "comment",
        group: "Research",
        action: () => {},
        children: [
          {
            label: "Discuss branch",
            icon: "comment",
            disabled: !props.onComment,
            action: () => run(() => props.onComment?.(n.from, n.to, false)),
          },
          {
            label: "Annotate block",
            icon: "edit",
            disabled: !props.onComment,
            action: () => run(() => props.onComment?.(n.from, n.to, true)),
          },
          {
            label: "Reading bookmark",
            icon: "bookmark",
            disabled: !props.onBookmark,
            action: () => run(() => props.onBookmark?.(n.from, n.to)),
          },
          {
            label: "Open in document",
            icon: "file",
            disabled: !props.onDocument,
            action: () => props.onDocument?.(n.from),
          },
        ],
      },
      {
        label: "Remove branch",
        icon: "trash",
        tone: "danger",
        disabled: props.readOnly || n.kind === "root",
        action: () =>
          run(() => {
            void confirmAction(
              "This removes its source and descendants. Undo remains available.",
              {
                title: "Remove this branch?",
                confirmLabel: "Remove",
                destructive: true,
              },
            ).then((yes) => {
              if (yes)
                run(() =>
                  mutate(() => mindmapCommand(binding.source, n, "delete")),
                );
            });
          }),
      },
    ];
    openContextMenu({ owner, x, y, label: "Mind-map branch actions", items });
  };
  const keydown = (event: KeyboardEvent<HTMLDivElement>, node: MindmapNode) => {
    if ((event.target as HTMLElement).closest("input,textarea,button,a"))
      return;
    if (event.nativeEvent.isComposing || draft) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (
      event.altKey &&
      ["ArrowUp", "ArrowDown", "ArrowLeft"].includes(event.key)
    ) {
      event.preventDefault();
      move(
        node,
        event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : "out",
      );
      return;
    }
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (latest.current.canEdit()) binding.history(event.shiftKey);
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      beginEdit(node);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      command(modifier ? "child" : "sibling");
      return;
    }
    if (event.key === " " && node.children.length) {
      event.preventDefault();
      toggle(node);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      command("delete");
      return;
    }
    if (
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10")
    ) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openMenu(event.currentTarget, rect.left, rect.bottom, node);
      return;
    }
    let next: MindmapNode | undefined;
    const siblings = byId.get(node.parentId ?? "")?.children ?? [
      projection!.rootId,
    ];
    if (event.key === "ArrowUp")
      next = byId.get(siblings[Math.max(0, siblings.indexOf(node.id) - 1)]);
    if (event.key === "ArrowDown")
      next = byId.get(
        siblings[Math.min(siblings.length - 1, siblings.indexOf(node.id) + 1)],
      );
    if (event.key === "ArrowLeft") next = byId.get(node.parentId ?? "");
    if (event.key === "ArrowRight") {
      if (folded.has(node.from)) toggle(node);
      next = byId.get(node.children[0]);
    }
    if (event.key === "Home") next = projection!.nodes[0];
    if (next) {
      event.preventDefault();
      focusNode(next);
    }
  };
  const zoom = (
    factor: number,
    x = viewport.width / 2,
    y = viewport.height / 2,
  ) =>
    setCamera((c) => {
      const scale = Math.max(
        mindmapZoomLimits.min,
        Math.min(mindmapZoomLimits.max, c.scale * factor),
      );
      return {
        scale,
        x: x - ((x - c.x) * scale) / c.scale,
        y: y - ((y - c.y) * scale) / c.scale,
      };
    });
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const box = root.getBoundingClientRect();
        zoom(
          Math.exp(-event.deltaY * 0.003),
          event.clientX - box.left,
          event.clientY - box.top,
        );
      } else
        setCamera((c) => ({
          ...c,
          x: c.x - event.deltaX,
          y: c.y - event.deltaY,
        }));
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => root.removeEventListener("wheel", wheel);
  }, [viewport]);
  const matches =
    projection?.nodes.filter(
      (n) =>
        query.trim() &&
        n.label.toLowerCase().includes(query.trim().toLowerCase()),
    ) ?? [];
  const labelHtml = useMemo(() => {
    const html = new Map<string, string>();
    for (const position of visible) {
      const n = byId.get(position.id);
      if (!n) continue;
      const value = mindmapRichLabel(source, n);
      if (value) {
        const cached = labelCache.current.get(n.id);
        if (cached?.key === value && cached.context === props.context)
          html.set(n.id, cached.html);
        else {
          const rendered = renderDocument(parseMarkdown(value), {
            ...props.context,
            fragment: true,
            visuals: false,
            blockMarks: false,
            disableImages: true,
          });
          labelCache.current.set(n.id, {
            key: value,
            context: props.context,
            html: rendered,
          });
          html.set(n.id, rendered);
        }
      }
    }
    for (const id of labelCache.current.keys())
      if (!byId.has(id)) labelCache.current.delete(id);
    return html;
  }, [byId, visible, source, props.context]);
  const draftPosition = draft && binding.absolute(draft.bookmark);
  const draftNode =
    draftPosition &&
    projection?.nodes.find(
      (n) => n.labelFrom === draftPosition.anchor && n.blockType === draft.type,
    );
  const draftBox = draftNode && placements.get(draftNode.id);
  const draftInView =
    draftBox &&
    (draftBox.x + draftBox.width) * camera.scale + camera.x >= 0 &&
    draftBox.x * camera.scale + camera.x <= viewport.width &&
    (draftBox.y + draftBox.height) * camera.scale + camera.y >= 0 &&
    draftBox.y * camera.scale + camera.y <= viewport.height;
  return (
    <section
      className="mindmap-surface"
      aria-label="Markdown mind map"
      data-map-layout={settings.layout}
      onKeyDownCapture={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key === "/" &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          changePane(pane === "source" ? null : "source");
        }
      }}
    >
      <header className="mindmap-toolbar">
        <Button
          variant="ghost"
          aria-pressed={pane === "source"}
          onClick={() => changePane(pane === "source" ? null : "source")}
        >
          <Braces size={16} />
          Source
        </Button>
        <SearchField
          aria-label="Find in mind map"
          placeholder="Find a branch…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches.length) {
              const next =
                matches[
                  (matches.findIndex((n) => n.id === selected) + 1) %
                    matches.length
                ];
              const ancestors = new Set<number>();
              let parent = next.parentId;
              while (parent) {
                const n = byId.get(parent)!;
                ancestors.add(n.from);
                parent = n.parentId;
              }
              setFolds((items) =>
                items.filter(
                  (f) =>
                    !ancestors.has(binding.absolute(f.bookmark)?.anchor ?? -1),
                ),
              );
              focusNode(next);
            }
          }}
        />
        {query && (
          <span className="mindmap-search-count" role="status">
            {matches.length} found
          </span>
        )}
        <span className="tool-spacer" />
        <IconButton
          label="Undo map edit"
          disabled={props.readOnly}
          onClick={() => {
            if (latest.current.canEdit()) binding.history(false);
          }}
        >
          <Undo2 size={16} />
        </IconButton>
        <IconButton
          label="Redo map edit"
          disabled={props.readOnly}
          onClick={() => {
            if (latest.current.canEdit()) binding.history(true);
          }}
        >
          <Redo2 size={16} />
        </IconButton>
        <IconButton
          label="Fit mind map"
          disabled={!layout}
          onClick={() =>
            layout &&
            setCamera(
              fitMindmap(layout.bounds, viewport.width, viewport.height),
            )
          }
        >
          <Focus size={16} />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => zoom(1 / 1.2)}>
          <Minus size={16} />
        </IconButton>
        <Button
          variant="ghost"
          className="mindmap-zoom"
          onClick={() => setCamera((c) => ({ ...c, scale: 1 }))}
          aria-label="Reset zoom to 100 percent"
        >
          {Math.round(camera.scale * 100)}%
        </Button>
        <IconButton label="Zoom in" onClick={() => zoom(1.2)}>
          <Plus size={16} />
        </IconButton>
        <IconButton
          label="Map display options"
          onClick={() => setDisplay(true)}
        >
          <SlidersHorizontal size={16} />
        </IconButton>
        <IconButton
          label="Branch details"
          aria-pressed={pane === "details"}
          onClick={() => changePane(pane === "details" ? null : "details")}
        >
          <Info size={16} />
        </IconButton>
        <IconButton
          label="Export mind map"
          disabled={!projection || result?.source !== source}
          onClick={() =>
            projection &&
            setExporting({ source, projection, settings, selected: chosen?.id })
          }
        >
          <Download size={16} />
        </IconButton>
      </header>
      {message && (
        <Notice tone="warning">
          <span>{message}</span>
          <IconButton
            label="Dismiss map message"
            onClick={() => setMessage("")}
          >
            <X size={14} />
          </IconButton>
        </Notice>
      )}
      {draft && !draftInView && (
        <div className="mindmap-retained-draft">
          <TextInput
            aria-label="Retained node draft"
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          />
          <Button
            onClick={() =>
              void navigator.clipboard
                .writeText(draft.value)
                .catch(() =>
                  setMessage(
                    "Clipboard access is unavailable. Select and copy the retained draft.",
                  ),
                )
            }
          >
            Copy draft
          </Button>
          <Button onClick={() => setDraft(null)}>Cancel</Button>
        </div>
      )}
      <div className="mindmap-body">
        {pane === "source" && (
          <ResizablePanel
            account={props.scope}
            name="mindmap-source"
            edge="right"
            className="mindmap-source-pane"
            label="Mind-map source"
          >
            <div className="mindmap-pane-heading">
              <span>Canonical Markdown</span>
              <IconButton
                label="Close map source"
                onClick={() => setPane(null)}
              >
                <X size={15} />
              </IconButton>
            </div>
            <StudioSource
              binding={binding}
              readOnly={props.readOnly}
              language="markdown"
            />
          </ResizablePanel>
        )}
        <div
          className="mindmap-viewport"
          ref={host}
          tabIndex={0}
          aria-label="Mind-map viewport. Drag empty space to pan; control or command scroll to zoom."
          onPointerDown={(e) => {
            if (
              e.button !== 0 ||
              (e.target as Element).closest("button,input,a,textarea")
            )
              return;
            const element = (e.target as Element).closest<HTMLElement>(
              "[data-map-node]",
            );
            const node = element && byId.get(element.dataset.mapNode!);
            if (node) {
              setSelected(node.id);
              selectedAnchor.current = binding.relative({
                anchor: node.from,
                head: node.to,
              });
              binding.select({ anchor: node.labelFrom, head: node.labelTo });
              element.focus({ preventScroll: true });
            }
            drag.current = {
              ...(node && latest.current.canEdit() && node.kind !== "root"
                ? {
                    id: node.id,
                    bookmark: binding.relative({
                      anchor: node.from,
                      head: node.branchTo,
                    }),
                    original: binding.source.slice(node.from, node.branchTo),
                  }
                : {}),
              x: e.clientX,
              y: e.clientY,
              camera,
              pointer: e.pointerId,
              moved: false,
              target: e.currentTarget,
            };
            if (!node) e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const current = drag.current;
            if (!current || current.pointer !== e.pointerId) return;
            const dx = e.clientX - current.x,
              dy = e.clientY - current.y;
            if (Math.hypot(dx, dy) > 5) {
              current.moved = true;
              if (!e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.setPointerCapture(e.pointerId);
            }
            if (current.moved && !current.id)
              setCamera({
                ...current.camera,
                x: current.camera.x + dx,
                y: current.camera.y + dy,
              });
            if (current.id && current.moved) {
              e.currentTarget.dataset.draggingBranch = current.id;
              clearDrop();
              const target = document
                .elementFromPoint(e.clientX, e.clientY)
                ?.closest<HTMLElement>("[data-map-node]");
              if (target && target.dataset.mapNode !== current.id) {
                const rect = target.getBoundingClientRect(),
                  ratio = (e.clientY - rect.top) / rect.height;
                target.dataset.mapDrop =
                  ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "child";
                dropTarget.current = target;
              }
            }
          }}
          onPointerUp={(e) => {
            const current = drag.current;
            drag.current = null;
            clearDrop();
            delete e.currentTarget.dataset.draggingBranch;
            if (!current) return;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            if (!current.moved || !current.id || !projection) return;
            const target = document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest<HTMLElement>("[data-map-node]");
            if (!target) {
              setMessage(
                "Drop on another branch to move it. Empty space only pans the map.",
              );
              return;
            }
            const rect = target.getBoundingClientRect(),
              ratio = (e.clientY - rect.top) / rect.height;
            const placement =
              ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "child";
            mutate(() => {
              const at = current.bookmark && binding.absolute(current.bookmark);
              if (
                !at ||
                binding.source.slice(at.anchor, at.head) !== current.original ||
                result?.source !== binding.source
              )
                throw new Error(
                  "This branch changed during dragging. Nothing was moved.",
                );
              return moveMindmapBranch(
                binding.source,
                projection,
                current.id!,
                target.dataset.mapNode!,
                placement,
              );
            });
          }}
          onPointerCancel={(e) => {
            drag.current = null;
            clearDrop();
            delete e.currentTarget.dataset.draggingBranch;
          }}
          onLostPointerCapture={(e) => {
            drag.current = null;
            clearDrop();
            delete e.currentTarget.dataset.draggingBranch;
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const element = (e.target as Element).closest<HTMLElement>(
              "[data-map-node]",
            );
            openMenu(
              element ?? e.currentTarget,
              e.clientX,
              e.clientY,
              element ? byId.get(element.dataset.mapNode!) : undefined,
            );
          }}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "0") {
              e.preventDefault();
              if (layout)
                setCamera(
                  fitMindmap(layout.bounds, viewport.width, viewport.height),
                );
            }
            if (e.key === "Escape") {
              drag.current = null;
              setDraft(null);
            }
          }}
        >
          {!result && (
            <p className="mindmap-empty" role="status">
              Building your map…
            </p>
          )}
          {result?.error && (
            <div className="mindmap-empty">
              <Notice tone="warning">{result.error}</Notice>
              <Button onClick={() => changePane("source")}>
                Open complete source
              </Button>
              <Button
                onClick={() => props.onDocument?.(binding.selection().head)}
              >
                Document view
              </Button>
            </div>
          )}
          {layout && projection && (
            <div
              className="mindmap-stage"
              ref={stage}
              role="tree"
              aria-label="Markdown hierarchy"
              style={{
                transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`,
              }}
            >
              <svg
                className="mindmap-connectors"
                aria-hidden="true"
                style={{ overflow: "visible" }}
              >
                {layout.nodes.map((position) => {
                  const node = byId.get(position.id)!,
                    parent = placements.get(node.parentId ?? "");
                  if (!parent) return null;
                  return (
                    <path
                      key={position.id}
                      d={mindmapConnector(parent, position)}
                      className="mindmap-connector"
                      style={
                        {
                          "--branch-color": branchColor(
                            position.branch,
                            settings.colors,
                          ),
                        } as CSSProperties
                      }
                    />
                  );
                })}
              </svg>
              {visible.map((position) => {
                const node = byId.get(position.id)!;
                const editing = draft && draftNode?.id === node.id;
                const peer = peers.filter(
                  (p) =>
                    p.selection &&
                    p.selection.head >= node.from &&
                    p.selection.head <= node.to,
                );
                return (
                  <div
                    key={node.id}
                    role="treeitem"
                    aria-level={position.depth + 1}
                    aria-posinset={
                      node.parentId
                        ? (byId.get(node.parentId)?.children.indexOf(node.id) ??
                            0) + 1
                        : 1
                    }
                    aria-setsize={
                      node.parentId
                        ? byId.get(node.parentId)?.children.length
                        : 1
                    }
                    aria-selected={selected === node.id}
                    aria-expanded={
                      node.children.length ? !folded.has(node.from) : undefined
                    }
                    aria-label={
                      node.checked === undefined
                        ? node.label
                        : `${node.checked ? "Complete" : "Incomplete"} task: ${node.label}`
                    }
                    tabIndex={selected === node.id ? 0 : -1}
                    data-map-node={node.id}
                    data-kind={node.kind}
                    data-matching={
                      matches.some((n) => n.id === node.id) || undefined
                    }
                    className="mindmap-node"
                    style={
                      {
                        left: position.x,
                        top: position.y,
                        width: position.width,
                        "--node-width": `${settings.nodeWidth}px`,
                        "--branch-color": branchColor(
                          position.branch,
                          settings.colors,
                        ),
                      } as CSSProperties
                    }
                    onFocus={(e) => {
                      if (e.target === e.currentTarget) {
                        setSelected(node.id);
                        selectedAnchor.current = binding.relative({
                          anchor: node.from,
                          head: node.to,
                        });
                        binding.select({
                          anchor: node.labelFrom,
                          head: node.labelTo,
                        });
                      }
                    }}
                    onDoubleClick={(e) => {
                      if ((e.target as Element).closest("a,button,input"))
                        return;
                      e.stopPropagation();
                      beginEdit(node);
                    }}
                    onKeyDown={(e) => keydown(e, node)}
                  >
                    <div className="mindmap-label">
                      {node.checked !== undefined && !editing && (
                        <Checkbox
                          data-editor-field="inline"
                          checked={node.checked}
                          aria-label={`Toggle task ${node.label}`}
                          disabled={props.readOnly}
                          onChange={() =>
                            mutate(() => {
                              if (result?.source !== binding.source)
                                throw new Error(
                                  "The map is updating. Try again when it is ready.",
                                );
                              return mindmapCommand(
                                binding.source,
                                node,
                                "toggleTask",
                              );
                            })
                          }
                        />
                      )}
                      {editing ? (
                        <TextInput
                          ref={input}
                          data-editor-field="inline"
                          aria-label="Edit map node label"
                          value={draft.value}
                          onChange={(e) =>
                            setDraft({ ...draft, value: e.target.value })
                          }
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.nativeEvent.isComposing) return;
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commit();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setDraft(null);
                            }
                          }}
                          onBlur={() => {
                            /* Commit is explicit: peer edits can arrive while another control gains focus. */
                          }}
                        />
                      ) : labelHtml.has(node.id) ? (
                        <div
                          className="mindmap-rich-label"
                          dangerouslySetInnerHTML={{
                            __html: labelHtml.get(node.id)!,
                          }}
                          onClick={(e) => {
                            const link = (
                              e.target as Element
                            ).closest<HTMLAnchorElement>("a");
                            if (link) {
                              e.preventDefault();
                              e.stopPropagation();
                              props.onLink(
                                link.dataset.note ??
                                  link.getAttribute("href") ??
                                  "",
                              );
                            }
                          }}
                        />
                      ) : (
                        <span>{node.label}</span>
                      )}
                      {peer.length > 0 && (
                        <span
                          className="mindmap-peer"
                          title={peer.map((p) => p.name).join(", ")}
                          aria-label={`Collaborators: ${peer.map((p) => p.name).join(", ")}`}
                          style={{ color: peer[0].color }}
                        >
                          ●
                        </span>
                      )}
                    </div>
                    {node.children.length > 0 && (
                      <IconButton
                        label={`${folded.has(node.from) ? "Expand" : "Fold"} ${node.label}`}
                        className={`mindmap-fold side-${position.side}`}
                        aria-expanded={!folded.has(node.from)}
                        onClick={() => toggle(node)}
                      >
                        {folded.has(node.from) ? (
                          <ChevronRight size={12} />
                        ) : (
                          <ChevronLeft size={12} />
                        )}
                      </IconButton>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {pane === "details" && chosen && (
          <ResizablePanel
            account={props.scope}
            name="mindmap-details"
            edge="left"
            className="mindmap-details-pane"
            label="Mind-map branch details"
          >
            <div className="mindmap-pane-heading">
              <span>{chosen.label}</span>
              <IconButton
                label="Close branch details"
                onClick={() => setPane(null)}
              >
                <X size={15} />
              </IconButton>
            </div>
            <div className="mindmap-detail-content">
              <HelpText>
                Lines {source.slice(0, chosen.from).split("\n").length}–
                {source.slice(0, chosen.branchTo).split("\n").length} ·{" "}
                {chosen.children.length} branches
              </HelpText>
              <ReadingView
                parsed={parseMarkdown(
                  source.slice(chosen.from, chosen.branchTo),
                )}
                source={source.slice(chosen.from, chosen.branchTo)}
                context={props.context}
                onLink={props.onLink}
              />
              <div className="mindmap-detail-actions">
                <Button onClick={() => changePane("source")}>
                  Edit in Source
                </Button>
                {props.onDocument && (
                  <Button onClick={() => props.onDocument?.(chosen.from)}>
                    Open document
                  </Button>
                )}
              </div>
            </div>
          </ResizablePanel>
        )}
      </div>
      <footer className="mindmap-status">
        <span>
          {projection?.nodes.length ?? 0} nodes · {layout?.nodes.length ?? 0}{" "}
          visible
          {projection?.supporting.length
            ? ` · ${projection.supporting.length} supporting blocks`
            : ""}
        </span>
        <span>
          {props.readOnly
            ? "Read only"
            : "Double-click / F2 to edit · Enter sibling · ⌘/Ctrl Enter child"}
        </span>
        {draft && <Button onClick={commit}>Apply label</Button>}
        <IconButton
          label="Selected branch actions"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            openMenu(e.currentTarget, box.left, box.top);
          }}
        >
          <MoreHorizontal size={15} />
        </IconButton>
      </footer>
      {display && (
        <MindmapDisplayDialog
          settings={settings}
          onChange={(next) => {
            localPreferences.current = true;
            if (next.nodeWidth !== settings.nodeWidth) {
              setSizes({});
              measurements.current.clear();
            }
            setSettings(next);
          }}
          onExpandAll={() => setFolds([])}
          onFoldAll={() =>
            setFolds(
              (projection?.nodes ?? [])
                .filter((n) => n.kind !== "root" && n.children.length)
                .map((n) => ({
                  bookmark: binding.relative({ anchor: n.from, head: n.to }),
                  type: n.blockType,
                })),
            )
          }
          onSave={
            props.onSaveDefaults && !props.readOnly
              ? async () => {
                  if (!latest.current.canEdit())
                    throw new Error(
                      "Edit access ended. File defaults were not changed.",
                    );
                  await latest.current.onSaveDefaults!(settings);
                }
              : undefined
          }
          onClose={() => {
            fitPending.current = true;
            setDisplay(false);
            if (layout)
              setCamera(
                fitMindmap(layout.bounds, viewport.width, viewport.height),
              );
          }}
        />
      )}
      {exporting && (
        <MindmapExportDialog
          binding={binding}
          source={exporting.source}
          title={props.title}
          projection={exporting.projection}
          settings={exporting.settings}
          selected={exporting.selected}
          context={props.context}
          beforeExport={props.beforeExport}
          onClose={() => setExporting(null)}
        />
      )}
    </section>
  );
}
export function branchColor(index: number, mode: MindmapSettings["colors"]) {
  return mode === "accent"
    ? "var(--accent)"
    : [
        "var(--accent)",
        "var(--green, var(--accent))",
        "var(--danger, var(--accent))",
        "color-mix(in srgb, var(--accent) 65%, var(--text))",
        "color-mix(in srgb, var(--green, var(--accent)) 65%, var(--text))",
      ][index % 5];
}
