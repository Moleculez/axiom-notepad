"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  useLayoutEffect,
  type CSSProperties,
  type Ref,
  type KeyboardEvent,
} from "react";
import {
  Braces,
  ChevronLeft,
  ChevronRight,
  Focus,
  Info,
  Minus,
  MoreHorizontal,
  Plus,
  Undo2,
  Redo2,
  X,
  ArrowLeft,
  Check,
  Filter,
  ListChecks,
} from "lucide-react";
import {
  parseMarkdown,
  type ParsedDocument,
  type RenderContext,
} from "@axiom/markdown";
import {
  mindmapCommand,
  moveMindmapBranch,
  mindmapConnector,
  nodeAtMindmapPosition,
  fitMindmap,
  mindmapZoomLimits,
  mindmapIndex,
  visibleMindmapOrder,
  ensureMindmapVisible,
  selectedMindmapRoots,
  batchMindmapCommand,
  mindmapBlockPreview,
  mindmapResearchIndex,
  mindmapResearchMatches,
  mindmapViewProjection,
  mindmapAncestorIds,
  mindmapResearchLenses,
  mindmapTaskChecked,
  mindmapBranchIds,
  mindmapBranchColor as branchColor,
  type MindmapResearchLens,
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
import StudioSource, { type StudioSourceHandle } from "../tools/StudioSource";
import MindmapDetails, { type MindmapDetailTab } from "./MindmapDetails";
import { markdownVisuals, openVisual } from "../../lib/visual-assets";
import { visualPlacement, type VisualContext } from "../../lib/visual-surface";
import { openContextMenu, type ContextAction } from "../../lib/context-menu";
import { confirmAction } from "../../lib/app-prompt";
import { useMindmap } from "../../lib/use-mindmap";
import MindmapExportDialog from "./MindmapExportDialog";
import MindmapDisplayDialog from "./MindmapDisplayDialog";
import MindmapPreview from "./MindmapPreview";
import MindmapOverview from "./MindmapOverview";
import { useMindmapIdentities } from "../../lib/use-mindmap-identities";
import { useMindmapMeasurements } from "../../lib/use-mindmap-measurements";
import Dialog, { DialogFooter } from "../Dialog";
import {
  mindmapViewSchema,
  resolveMindmapDraft,
  type MindmapViewState,
  type MindmapDraft,
  type MindmapStatus,
  type MindmapPresentation,
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
  document?: { source: string; parsed: ParsedDocument };
  visual?: VisualContext;
  settings?: Partial<MindmapSettings>;
  onSaveDefaults?: (settings: MindmapSettings) => Promise<void>;
  onLink: (target: string) => void;
  onComment?: (from: number, to: number, annotation: boolean) => void;
  onBookmark?: (from: number, to: number) => void;
  onDocument?: (position: number) => void;
  externalInspector?: boolean;
  onAuxiliary?: () => void;
  beforeExport?: () => Promise<void>;
  onStatus?: (status: MindmapStatus) => void;
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
    [detailTab, setDetailTab] = useState<MindmapDetailTab>("block"),
    [selected, setSelected] = useState("root"),
    [query, setQuery] = useState(""),
    [hovered, setHovered] = useState<string | null>(null),
    [focusBranch, setFocusBranch] = useState<Fold | null>(null),
    [selections, setSelections] = useState<Fold[]>([]),
    [help, setHelp] = useState(false),
    [dropHint, setDropHint] = useState(""),
    [camera, setCamera] = useState<Camera>({ x: 40, y: 40, scale: 1 }),
    [viewport, setViewport] = useState({ width: 900, height: 600 }),
    [sizes, setSizes] = useState<
      Record<string, { width: number; height: number }>
    >({}),
    [draft, setDraft] = useState<Draft | null>(null),
    [leaving, setLeaving] = useState<(() => void) | null>(null),
    [message, setMessage] = useState(""),
    [display, setDisplay] = useState(false),
    [presentation, setPresentation] = useState<MindmapPresentation>({
      preview: "research",
      minimap: false,
      supporting: false,
      lens: "all",
      resultsOnly: false,
    }),
    [exporting, setExporting] = useState<{
      source: string;
      projection: MindmapProjection;
      selected?: string;
      settings: MindmapSettings;
      research: boolean;
    } | null>(null),
    [peers, setPeers] = useState(binding.peers());
  const host = useRef<HTMLDivElement>(null),
    stage = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    sourceEditor = useRef<StudioSourceHandle>(null),
    selectedAnchor = useRef<Bookmark | null>(null),
    pendingNode = useRef<Bookmark | null>(null),
    pendingFocus = useRef<Bookmark | null>(null),
    initialized = useRef(false),
    fitPending = useRef(false),
    viewportAnchor = useRef<{
      bookmark: Bookmark;
      type: string;
      x: number;
      y: number;
    } | null>(null),
    searchFolds = useRef<Fold[] | null>(null),
    searchDirty = useRef(false),
    rangeStart = useRef<string>("root"),
    revealPending = useRef<{ from: number; to: number } | null>(null),
    spaceDown = useRef(false),
    hoverExpand = useRef<ReturnType<typeof setTimeout> | null>(null),
    hoverTarget = useRef<string | null>(null),
    hoverLeave = useRef<ReturnType<typeof setTimeout> | null>(null),
    stored = useRef<MindmapViewState | null>(null),
    localPreferences = useRef(false),
    dropTarget = useRef<HTMLElement | null>(null),
    drag = useRef<{
      id?: string;
      bookmark?: Bookmark;
      original?: string;
      x: number;
      y: number;
      clientX: number;
      clientY: number;
      source: string;
      camera: Camera;
      pointer: number;
      moved: boolean;
      target: HTMLDivElement;
      drop?: {
        id: string;
        placement: "before" | "after" | "child";
        source: string;
        edit?: MindmapEdit;
        error?: string;
      };
    } | null>(null),
    gestureId = useRef(0),
    edgeVelocity = useRef({ x: 0, y: 0 });
  const refreshDrop = useRef<(x: number, y: number) => void>(() => {});
  const pendingViewSave = useRef<(() => void) | null>(null);
  const acceptedNavigationDraft = useRef<Draft | null>(null);
  const latest = useRef(props);
  const hoverNode = (id: string) => {
    if (hoverLeave.current) clearTimeout(hoverLeave.current);
    hoverLeave.current = null;
    setHovered(id);
  };
  const leaveNode = () => {
    if (hoverLeave.current) clearTimeout(hoverLeave.current);
    // Keep the unscaled control reachable across the small node/control gap.
    hoverLeave.current = setTimeout(() => setHovered(null), 180);
  };
  const clearDrop = () => {
    dropTarget.current?.removeAttribute("data-map-drop");
    dropTarget.current?.removeAttribute("data-map-drop-invalid");
    dropTarget.current = null;
  };
  const clearDrag = () => {
    cancelAnimationFrame(gestureId.current);
    gestureId.current = 0;
    edgeVelocity.current = { x: 0, y: 0 };
    if (drag.current) delete drag.current.target.dataset.draggingBranch;
    drag.current = null;
    clearDrop();
    setDropHint("");
    if (hoverExpand.current) clearTimeout(hoverExpand.current);
    hoverExpand.current = null;
    hoverTarget.current = null;
  };
  latest.current = props;
  useEffect(() => {
    const cancel = () => {
      cancelAnimationFrame(gestureId.current);
      gestureId.current = 0;
      if (hoverExpand.current) clearTimeout(hoverExpand.current);
      if (hoverLeave.current) clearTimeout(hoverLeave.current);
      hoverLeave.current = null;
      hoverExpand.current = null;
      hoverTarget.current = null;
      edgeVelocity.current = { x: 0, y: 0 };
      if (drag.current) delete drag.current.target.dataset.draggingBranch;
      drag.current = null;
      dropTarget.current?.removeAttribute("data-map-drop");
      dropTarget.current?.removeAttribute("data-map-drop-invalid");
      dropTarget.current = null;
      spaceDown.current = false;
    };
    const blurred = () => {
      cancel();
      setDropHint("");
      setHovered(null);
    };
    window.addEventListener("blur", blurred);
    return () => {
      window.removeEventListener("blur", blurred);
      cancel();
    };
  }, []);
  const focusPosition = focusBranch && binding.absolute(focusBranch.bookmark);
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
      view: {
        supporting: presentation.supporting,
        research: {
          lens: presentation.lens,
          query,
          resultsOnly: presentation.resultsOnly,
        },
        ...(focusBranch &&
        focusPosition &&
        focusPosition.anchor < focusPosition.head
          ? {
              focus: { position: focusPosition.anchor, type: focusBranch.type },
            }
          : {}),
      },
    }),
    [
      source,
      props.title,
      settings,
      foldPositions,
      sizes,
      presentation.supporting,
      presentation.lens,
      presentation.resultsOnly,
      query,
      focusBranch,
      focusPosition?.anchor,
    ],
  );
  const result = useMindmap(request);
  const projection = result?.projection,
    viewProjection = result?.viewProjection,
    layout = result?.layout;
  const displayedSource = result?.source ?? source;
  const ownerDocument = useMemo(
    () =>
      props.document?.source === displayedSource
        ? props.document.parsed
        : parseMarkdown(displayedSource),
    [displayedSource, props.document?.source, props.document?.parsed],
  );
  const previewContext = useMemo(
    () => ({ ...props.context, document: ownerDocument }),
    [props.context, ownerDocument],
  );
  const research = useMemo(
    () => (projection ? mindmapResearchIndex(projection, ownerDocument) : null),
    [projection, ownerDocument],
  );
  const focusedProjection = useMemo(
    () =>
      projection ? mindmapViewProjection(projection, request.view.focus) : null,
    [projection, request.view.focus],
  );
  const researchActive = presentation.lens !== "all" || !!query.trim();
  const matches = useMemo(
    () =>
      projection && research && researchActive
        ? mindmapResearchMatches(
            projection,
            research,
            presentation.lens,
            query,
            focusedProjection?.rootId ?? projection.rootId,
          )
        : [],
    [
      projection,
      research,
      researchActive,
      presentation.lens,
      query,
      focusedProjection?.rootId,
    ],
  );
  const matchIds = useMemo(() => new Set(matches.map((n) => n.id)), [matches]);
  // Current focus/filter intent is synchronous. The worker's viewProjection
  // remains the paint topology until its matching layout arrives.
  const navigationProjection = useMemo(
    () =>
      projection && focusedProjection
        ? presentation.resultsOnly && researchActive
          ? mindmapViewProjection(projection, request.view.focus, matchIds)
          : focusedProjection
        : null,
    [
      projection,
      focusedProjection,
      presentation.resultsOnly,
      researchActive,
      request.view.focus,
      matchIds,
    ],
  );
  const navigationById = useMemo(
    () => new Map(navigationProjection?.nodes.map((n) => [n.id, n]) ?? []),
    [navigationProjection],
  );
  const matchContextIds = useMemo(
    () =>
      projection ? mindmapAncestorIds(projection, matchIds) : new Set<string>(),
    [projection, matchIds],
  );
  const index = useMemo(
    () => (projection ? mindmapIndex(projection) : null),
    [projection],
  );
  const byId = index?.byId ?? new Map<string, MindmapNode>();
  const nodeKeys = useMindmapIdentities(binding, projection);
  const visibleOrder = useMemo(() => {
    if (!projection || !navigationProjection || !layout) return [];
    const positions = new Set(
      foldPositions.map((f) => `${f.type}:${f.position}`),
    );
    const collapsed = projection.nodes
      .filter(
        (node) =>
          node.kind !== "root" &&
          positions.has(`${node.blockType}:${node.from}`),
      )
      .map((node) => node.id);
    return visibleMindmapOrder(
      navigationProjection,
      layout,
      collapsed,
      navigationProjection.rootId,
    );
  }, [projection, navigationProjection, layout, foldPositions]);
  const navigableIds = useMemo(() => new Set(visibleOrder), [visibleOrder]);
  const rangeIndex = useMemo(
    () =>
      new Map(
        projection?.nodes.map((n) => [`${n.blockType}:${n.from}`, n.id]) ?? [],
      ),
    [projection],
  );
  const selectionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of selections) {
      const at = binding.absolute(item.bookmark);
      const id = at && rangeIndex.get(`${item.type}:${at.anchor}`);
      if (id && at && at.anchor < at.head) ids.add(id);
    }
    if (!ids.size) ids.add(selected);
    return ids;
  }, [selections, selected, binding, rangeIndex]);
  const placements = useMemo(
    () => new Map(layout?.nodes.map((n) => [n.id, n]) ?? []),
    [layout],
  );
  const chosen = byId.get(selected) ?? projection?.nodes[0];
  const activePath = useMemo(
    () =>
      projection
        ? mindmapAncestorIds(projection, [selected])
        : new Set<string>(),
    [projection, selected],
  );
  const viewById = useMemo(
    () => new Map(viewProjection?.nodes.map((n) => [n.id, n]) ?? []),
    [viewProjection],
  );
  const peersByNode = useMemo(() => {
    const found = new Map<string, typeof peers>();
    if (projection)
      for (const peer of peers)
        if (peer.selection) {
          const id = nodeAtMindmapPosition(projection, peer.selection.head).id;
          found.set(id, [...(found.get(id) ?? []), peer]);
        }
    return found;
  }, [projection, peers]);
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
  const revealSource = (node: MindmapNode) => {
    if (!node.to) return;
    if (result?.source !== binding.source) {
      setMessage("Wait for the current map before revealing a source range.");
      return;
    }
    if (pane === "source") {
      sourceEditor.current?.reveal(node.from, node.to);
      return;
    }
    revealPending.current = { from: node.from, to: node.to };
    changePane("source");
  };
  useEffect(() => {
    if (pane !== "source" || !revealPending.current) return;
    const range = revealPending.current;
    const frame = requestAnimationFrame(() => {
      sourceEditor.current?.reveal(range.from, range.to);
      revealPending.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [pane, selected]);
  const selectNode = (node: MindmapNode, modifier = false, extend = false) => {
    let ids = new Set([node.id]);
    if (extend) {
      const start = visibleOrder.indexOf(rangeStart.current),
        end = visibleOrder.indexOf(node.id);
      if (start >= 0 && end >= 0)
        ids = new Set(
          visibleOrder.slice(Math.min(start, end), Math.max(start, end) + 1),
        );
    } else if (modifier) {
      ids = new Set(selectionIds);
      if (ids.has(node.id) && ids.size > 1) ids.delete(node.id);
      else ids.add(node.id);
    } else rangeStart.current = node.id;
    setSelections(
      ids.size > 1
        ? [...ids].flatMap((id) => {
            const n = byId.get(id);
            return n
              ? [
                  {
                    bookmark: binding.relative({ anchor: n.from, head: n.to }),
                    type: n.blockType,
                  },
                ]
              : [];
          })
        : [],
    );
    const active = ids.has(node.id)
      ? node
      : (byId.get([...ids].at(-1) ?? "") ?? node);
    setSelected(active.id);
    selectedAnchor.current = binding.relative({
      anchor: active.from,
      head: active.to,
    });
    return active;
  };
  const focusNode = (node: MindmapNode, focus = true) => {
    fitPending.current = false;
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
      setCamera((c) =>
        ensureMindmapVisible(c, position, viewport.width, viewport.height),
      );
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
          if (presentation.resultsOnly && !navigationById.has(node.id))
            setPresentation((value) => ({ ...value, resultsOnly: false }));
          if (
            focusBranch &&
            !mindmapBranchIds(projection, focusedProjection?.rootId).has(
              node.id,
            )
          )
            setFocusBranch(null);
          // Reveal the exact branch, not a similarly named node.
          const ancestors = new Set<string>();
          let parent = node.parentId;
          while (parent) {
            const n = byId.get(parent);
            if (!n) break;
            ancestors.add(`${n.blockType}:${n.from}`);
            parent = n.parentId;
          }
          setFolds((items) =>
            items.filter(
              (item) =>
                !ancestors.has(
                  `${item.type}:${binding.absolute(item.bookmark)?.anchor ?? -1}`,
                ),
            ),
          );
          focusNode(node);
        } else host.current?.focus();
      },
    }),
    [
      projection,
      chosen,
      placements,
      viewport,
      binding,
      pane,
      presentation.resultsOnly,
      focusBranch,
      focusedProjection?.rootId,
      navigationById,
    ],
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
        setPresentation(value.data.presentation);
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
    const before = (event: Event) => {
      if (event.defaultPrevented || acceptedNavigationDraft.current === draft)
        return;
      event.preventDefault();
      const detail = (
        event as CustomEvent<{ destination: string; proceed: () => void }>
      ).detail;
      setLeaving(() => () => {
        acceptedNavigationDraft.current = draft;
        // Serialize retained editors: approving this draft does not approve
        // another pane's draft or the settings exit guard.
        if (
          window.dispatchEvent(
            new CustomEvent("axiom:before-navigate", {
              cancelable: true,
              detail,
            }),
          )
        )
          detail.proceed();
      });
    };
    window.addEventListener("axiom:before-navigate", before);
    let retainedUrl = location.href,
      retainedState = history.state;
    const historyNavigation = () => {
      if (location.href === retainedUrl) return;
      const destination = location.href;
      const url = new URL(destination);
      const route = url.pathname + url.search + url.hash;
      const destinationState = history.state;
      // Native history events cannot be cancelled. Restore the current URL
      // before router subscribers read it, and review the proposed transition.
      history.replaceState(retainedState, "", retainedUrl);
      const proceed = () => {
        retainedUrl = destination;
        retainedState = destinationState;
        history.replaceState(destinationState, "", destination);
        window.dispatchEvent(
          new CustomEvent("axiom:route", {
            detail: { destination: route, replace: true },
          }),
        );
        window.dispatchEvent(new Event("axiom:navigate"));
        window.dispatchEvent(new Event("hashchange"));
      };
      if (
        window.dispatchEvent(
          new CustomEvent("axiom:before-navigate", {
            cancelable: true,
            detail: { destination: route, proceed },
          }),
        )
      )
        proceed();
    };
    window.addEventListener("popstate", historyNavigation, true);
    window.addEventListener("hashchange", historyNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", protect);
      window.removeEventListener("axiom:before-navigate", before);
      window.removeEventListener("popstate", historyNavigation, true);
      window.removeEventListener("hashchange", historyNavigation, true);
    };
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
        setCamera((c) =>
          ensureMindmapVisible(c, placement, viewport.width, viewport.height),
        );
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
    } else if (previous && selectedAnchor.current) {
      setSelected(projection.rootId);
      selectedAnchor.current = null;
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
            setCamera((c) =>
              ensureMindmapVisible(
                c,
                placement,
                viewport.width,
                viewport.height,
              ),
            );
          requestAnimationFrame(() => input.current?.focus());
        }
      }
    }
    if (!initialized.current) {
      initialized.current = true;
      const saved = stored.current;
      const savedFolds = new Map(
        saved?.folds.map((f) => [`${f.type}:${f.position}`, f.label]) ?? [],
      );
      const collapsed =
        saved?.folds && Array.isArray(saved.folds)
          ? projection.nodes.filter(
              (n) =>
                savedFolds.get(`${n.blockType}:${n.from}`) === n.labelSource,
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
      const savedFocus = saved?.focus;
      const focused =
        savedFocus &&
        projection.nodes.find(
          (n) =>
            n.from === savedFocus.position &&
            n.blockType === savedFocus.type &&
            n.labelSource === savedFocus.label &&
            !n.presentationOnly,
        );
      if (focused && focused.kind !== "root")
        setFocusBranch({
          bookmark: binding.relative({
            anchor: focused.from,
            head: focused.to,
          }),
          type: focused.blockType,
        });
      if (initialNode) {
        setSelected(initialNode.id);
        selectedAnchor.current = binding.relative({
          anchor: initialNode.from,
          head: initialNode.to,
        });
      }
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
  // Reflow may change positions, but must not change zoom or lose visible context.
  useLayoutEffect(() => {
    if (
      !layout ||
      !projection ||
      result?.source !== binding.source ||
      fitPending.current ||
      drag.current
    )
      return;
    const previous = viewportAnchor.current,
      at = previous && binding.absolute(previous.bookmark);
    const id = at && rangeIndex.get(`${previous!.type}:${at.anchor}`),
      next = id && placements.get(id);
    if (previous && next && next.id === selected)
      setCamera((c) => ({
        ...c,
        x: c.x + (previous.x - next.x) * c.scale,
        y: c.y + (previous.y - next.y) * c.scale,
      }));
    const box = placements.get(selected),
      node = byId.get(selected);
    viewportAnchor.current =
      box && node && node.to > node.from
        ? {
            bookmark: binding.relative({ anchor: node.from, head: node.to }),
            type: node.blockType,
            x: box.x,
            y: box.y,
          }
        : null;
  }, [layout, projection, result?.source, binding, selected]);
  useEffect(() => {
    if (!layout || !fitPending.current || !viewport.width || !viewport.height)
      return;
    const timer = setTimeout(() => {
      if (!fitPending.current) return;
      fitPending.current = false;
      setCamera(fitMindmap(layout.bounds, viewport.width, viewport.height));
    }, 180);
    return () => clearTimeout(timer);
  }, [layout, viewport]);
  useEffect(() => {
    props.onStatus?.({
      total: projection?.nodes.length ?? 0,
      shown: layout?.nodes.length ?? 0,
      supporting: projection?.supporting.length ?? 0,
      selected: selectionIds.size,
      readOnly: props.readOnly,
    });
  }, [
    props.onStatus,
    projection?.nodes.length,
    layout?.nodes.length,
    projection?.supporting.length,
    props.readOnly,
    selectionIds.size,
  ]);
  useEffect(() => {
    if (!initialized.current || result?.source !== source) return;
    const save = () => {
      if (binding.source !== source) return;
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            settings,
            presentation,
            camera,
            pane,
            focus:
              focusBranch && focusPosition
                ? {
                    position: focusPosition.anchor,
                    type: focusBranch.type,
                    label:
                      projection?.nodes.find(
                        (n) =>
                          n.from === focusPosition.anchor &&
                          n.blockType === focusBranch.type,
                      )?.labelSource ?? "",
                  }
                : undefined,
            selection: chosen?.from,
            label: chosen?.labelSource,
            folds: folds.flatMap((f) => {
              const at = binding.absolute(f.bookmark);
              const id = at && rangeIndex.get(`${f.type}:${at.anchor}`);
              const n = id && byId.get(id);
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
    };
    pendingViewSave.current = save;
    const timer = setTimeout(save, 300);
    return () => clearTimeout(timer);
  }, [
    key,
    settings,
    presentation,
    camera,
    pane,
    focusBranch,
    focusPosition?.anchor,
    folds,
    chosen,
    binding,
    projection,
    result?.source,
    source,
    rangeIndex,
    byId,
  ]);
  useEffect(
    () => () => {
      // Debounced view state must not revert when the host unmounts the map.
      // The save closure rejects stale source offsets after a document change.
      pendingViewSave.current?.();
      pendingViewSave.current = null;
    },
    [key, binding],
  );
  const visible = useMemo(
    () =>
      layout?.nodes.filter(
        (n) =>
          selectionIds.has(n.id) ||
          (n.x + n.width >= (-camera.x - 240) / camera.scale &&
            n.x <= (viewport.width - camera.x + 240) / camera.scale &&
            n.y + n.height >= (-camera.y - 240) / camera.scale &&
            n.y <= (viewport.height - camera.y + 240) / camera.scale),
      ) ?? [],
    [layout, camera, viewport, selectionIds],
  );
  useMindmapMeasurements(
    stage,
    projection,
    nodeKeys,
    visible.map((n) => n.id).join("|"),
    settings.nodeWidth,
    `${presentation.preview}:${props.context.theme}`,
    setSizes,
  );
  const folded = new Set(foldPositions.map((f) => `${f.type}:${f.position}`));
  const isFolded = (node: MindmapNode) =>
    node.kind !== "root" && folded.has(`${node.blockType}:${node.from}`);
  const toggle = (node: MindmapNode) => {
    if (!node.children.length || node.kind === "root" || node.presentationOnly)
      return;
    if (searchFolds.current) searchDirty.current = true;
    if (!isFolded(node)) {
      const hiddenSelection = projection?.nodes.some(
        (n) =>
          selectionIds.has(n.id) &&
          n.id !== node.id &&
          n.from >= node.from &&
          n.from < node.branchTo,
      );
      if (hiddenSelection && !draft) {
        selectNode(node);
        focusNode(node);
      }
    }
    setFolds((items) =>
      isFolded(node)
        ? items.filter(
            (f) =>
              f.type !== node.blockType ||
              binding.absolute(f.bookmark)?.anchor !== node.from,
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
      revealSource(node);
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
    if (!draft) return false;
    const range = binding.absolute(draft.bookmark);
    if (
      !range ||
      binding.source.slice(range.anchor, range.head) !== draft.original ||
      !latest.current.canEdit()
    ) {
      setMessage(
        "This label changed elsewhere or edit access ended. Your draft is retained; copy it or cancel and select the branch again.",
      );
      return false;
    }
    const node = projection && resolveMindmapDraft(binding, projection, draft);
    if (!node || result?.source !== binding.source) {
      setMessage(
        "The Markdown structure changed. Your draft is retained; review it in Source.",
      );
      return false;
    }
    if (
      mutate(() => mindmapCommand(binding.source, node, "rename", draft.value))
    ) {
      setDraft(null);
      return true;
    }
    return false;
  };
  const add = (node: MindmapNode, name: "child" | "sibling") => {
    if (draft && draft.value !== draft.original) {
      setMessage(
        "Apply, copy or cancel your label draft before adding another branch.",
      );
      return;
    }
    if (mutate(() => mindmapCommand(binding.source, node, name))) {
      // A new empty label is not research evidence yet. Reveal its editing
      // surface instead of stranding it outside a filtered result topology.
      setPresentation((value) =>
        value.resultsOnly ? { ...value, resultsOnly: false } : value,
      );
      if (name === "sibling" && focusBranch) setFocusBranch(null);
      pendingNode.current = binding.relative(binding.selection());
      if (name === "child")
        setFolds((items) =>
          items.filter(
            (f) =>
              f.type !== node.blockType ||
              binding.absolute(f.bookmark)?.anchor !== node.from,
          ),
        );
    }
  };
  const command = (name: "child" | "sibling" | "delete" | "toggleTask") => {
    const snapshot = binding.source;
    const ids = [...selectionIds];
    const run = () => {
      if (binding.source !== snapshot) {
        setMessage(
          "The selection changed while confirming. Select it again; nothing was removed.",
        );
        return;
      }
      if (name === "child" || name === "sibling") {
        if (result?.source !== binding.source || !chosen) {
          setMessage("Wait for the current map before adding a branch.");
          return;
        }
        add(chosen, name);
        return;
      }
      mutate(() =>
        name === "delete" && ids.length > 1 && projection
          ? batchMindmapCommand(binding.source, projection, ids, "delete")
          : mindmapCommand(binding.source, selectedNow(), name),
      );
    };
    if (name === "delete")
      void confirmAction(
        "The branch and its descendants will be removed from Markdown. You can undo this edit.",
        {
          title:
            ids.length > 1
              ? "Remove selected branches?"
              : "Remove this branch?",
          confirmLabel: ids.length > 1 ? "Remove selection" : "Remove branch",
          destructive: true,
        },
      ).then((yes) => {
        if (yes) run();
      });
    else run();
  };
  const copyBranches = async (ids: Iterable<string>) => {
    if (!projection || result?.source !== binding.source) {
      setMessage("Wait for the current map before copying.");
      return;
    }
    const roots = selectedMindmapRoots(projection, ids);
    const text = roots
      .map((n) =>
        n.kind === "root"
          ? binding.source
          : binding.source.slice(n.from, n.branchTo),
      )
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Markdown copied.");
    } catch {
      setMessage(
        "Clipboard access was denied. Reveal the selection in Source to copy it manually.",
      );
    }
  };
  const expandBranch = (node: MindmapNode) => {
    if (searchFolds.current) searchDirty.current = true;
    setFolds((items) =>
      items.filter((item) => {
        const at = binding.absolute(item.bookmark);
        return (
          !at ||
          !(
            node.kind === "root" ||
            (at.anchor >= node.from && at.anchor < node.branchTo)
          )
        );
      }),
    );
  };
  const foldToDepth = (depth: number) => {
    if (!projection || !layout) return;
    if (searchFolds.current) searchDirty.current = true;
    const levels = new Map<string, number>();
    const pending = [
      { id: layout.nodes[0]?.id ?? projection.rootId, depth: 0 },
    ];
    while (pending.length) {
      const item = pending.pop()!;
      levels.set(item.id, item.depth);
      pending.push(
        ...(byId.get(item.id)?.children ?? []).map((id) => ({
          id,
          depth: item.depth + 1,
        })),
      );
    }
    setFolds(
      projection.nodes
        .filter(
          (n) =>
            n.children.length &&
            !n.presentationOnly &&
            n.id !== layout.nodes[0]?.id &&
            (levels.get(n.id) ?? -1) >= depth,
        )
        .map((n) => ({
          bookmark: binding.relative({ anchor: n.from, head: n.to }),
          type: n.blockType,
        })),
    );
    if (!draft && depth < (levels.get(selected) ?? 0)) {
      const root = byId.get(layout.nodes[0]?.id ?? projection.rootId)!;
      selectNode(root);
      focusNode(root);
    }
  };
  const fitSelection = (node: MindmapNode) => {
    fitPending.current = false;
    const box = placements.get(node.id);
    if (box)
      setCamera((c) => ({
        ...c,
        x: viewport.width / 2 - (box.x + box.width / 2) * c.scale,
        y: viewport.height / 2 - (box.y + box.height / 2) * c.scale,
      }));
  };
  const fitBranch = (node: MindmapNode) => {
    if (!layout) return;
    const descendants = new Set<string>(),
      pending = [node.id];
    while (pending.length) {
      const id = pending.pop()!;
      descendants.add(id);
      pending.push(...(byId.get(id)?.children ?? []));
    }
    const boxes = layout.nodes.filter((n) => descendants.has(n.id));
    if (!boxes.length) return;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    fitPending.current = false;
    setCamera(
      fitMindmap(
        {
          x,
          y,
          width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
          height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
        },
        viewport.width,
        viewport.height,
      ),
    );
  };
  const focusOnly = (node: MindmapNode) => {
    if (node.presentationOnly) return;
    expandBranch(node);
    selectNode(node);
    setFocusBranch(
      node.kind === "root"
        ? null
        : {
            bookmark: binding.relative({ anchor: node.from, head: node.to }),
            type: node.blockType,
          },
    );
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
      if (!selectionIds.has(node.id)) selectNode(node);
      binding.select({ anchor: node.labelFrom, head: node.labelTo });
    }
    const n = node ?? chosen;
    if (!n) return;
    // Capture the menu's target, not a later selection; source changes invalidate it.
    const snapshot = binding.source;
    const run = (action: () => void) => {
      if (result?.source !== snapshot)
        setMessage("The map is updating. Reopen the menu when it is ready.");
      else if (binding.source !== snapshot)
        setMessage(
          "The branch changed while the menu was open. Open it again.",
        );
      else action();
    };
    const targets = selectionIds.has(n.id) ? [...selectionIds] : [n.id];
    const items: ContextAction[] = [
      {
        label: "Edit label",
        icon: "edit",
        group: "Edit",
        disabled: props.readOnly || !!n.presentationOnly,
        action: () => run(() => beginEdit(n)),
      },
      {
        label: "Edit in Source",
        icon: "source",
        group: "Edit",
        action: () => run(() => revealSource(n)),
      },
      {
        label: "Add branch",
        icon: "plus",
        group: "Structure",
        disabled:
          props.readOnly ||
          !!n.presentationOnly ||
          !["heading", "item", "root"].includes(n.kind),
        disabledReason:
          "Add structural branches from a heading or list item; use Source for other blocks.",
        action: () => {},
        children: [
          {
            label: "Add child",
            icon: "plus",
            action: () => run(() => add(n, "child")),
          },
          {
            label: "Add sibling",
            icon: "plus",
            disabled: n.kind === "root",
            action: () => run(() => add(n, "sibling")),
          },
        ],
      },
      {
        label: "Navigate branch",
        icon: "chevronRight",
        group: "Structure",
        action: () => {},
        children: [
          {
            label: isFolded(n) ? "Expand children" : "Fold branch",
            icon: "chevronRight",
            disabled:
              !n.children.length || n.kind === "root" || !!n.presentationOnly,
            action: () => toggle(n),
          },
          {
            label: "Expand entire branch",
            icon: "chevronRight",
            disabled: !n.children.length,
            action: () => expandBranch(n),
          },
          {
            label: "Focus this branch",
            icon: "search",
            disabled: n.kind === "root" || !!n.presentationOnly,
            action: () => focusOnly(n),
          },
          {
            label: "Center selected",
            icon: "search",
            action: () => fitSelection(n),
          },
          {
            label: "Fit selected branch",
            icon: "search",
            action: () => fitBranch(n),
          },
          {
            label: "Full block details",
            icon: "info",
            action: () => changePane("details"),
          },
        ],
      },
      {
        label: "Move branch",
        icon: "moveUp",
        group: "Structure",
        disabled: props.readOnly || n.kind === "root" || !!n.presentationOnly,
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
        label: targets.length > 1 ? "Selection actions" : "Copy and tasks",
        icon: "copy",
        group: "Edit",
        action: () => {},
        children: [
          {
            label: "Copy Markdown",
            icon: "copy",
            action: () => run(() => void copyBranches(targets)),
          },
          ...(n.blockType === "codeBlock"
            ? [
                {
                  label: "Copy code",
                  icon: "copy" as const,
                  action: () =>
                    run(() => {
                      const code =
                        mindmapBlockPreview(binding.source, n).code ?? "";
                      void navigator.clipboard.writeText(code).then(
                        () => setMessage("Code copied."),
                        () =>
                          setMessage(
                            "Clipboard access is unavailable. Open the block in Source to copy it.",
                          ),
                      );
                    }),
                },
              ]
            : []),
          {
            label: "Complete tasks",
            icon: "check",
            disabled:
              props.readOnly ||
              !targets.some((id) => (index?.tasks.get(id)?.total ?? 0) > 0),
            action: () =>
              run(() =>
                mutate(() =>
                  batchMindmapCommand(
                    binding.source,
                    projection!,
                    targets,
                    "complete",
                  ),
                ),
              ),
          },
          {
            label: "Reopen tasks",
            icon: "check",
            disabled:
              props.readOnly ||
              !targets.some((id) => (index?.tasks.get(id)?.total ?? 0) > 0),
            action: () =>
              run(() =>
                mutate(() =>
                  batchMindmapCommand(
                    binding.source,
                    projection!,
                    targets,
                    "reopen",
                  ),
                ),
              ),
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
        label: targets.length > 1 ? "Remove selection" : "Remove branch",
        icon: "trash",
        tone: "danger",
        disabled:
          props.readOnly ||
          targets.some(
            (id) =>
              byId.get(id)?.kind === "root" || byId.get(id)?.presentationOnly,
          ),
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
                  mutate(() =>
                    batchMindmapCommand(
                      binding.source,
                      projection!,
                      targets,
                      "delete",
                    ),
                  ),
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
    if (modifier && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copyBranches(selectionIds);
      return;
    }
    if (modifier && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelections(
        visibleOrder.flatMap((id) => {
          const n = byId.get(id);
          return n && n.kind !== "root" && !n.presentationOnly
            ? [
                {
                  bookmark: binding.relative({ anchor: n.from, head: n.to }),
                  type: n.blockType,
                },
              ]
            : [];
        }),
      );
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      beginEdit(node);
      return;
    }
    if (
      !modifier &&
      !event.altKey &&
      event.key.toLowerCase() === "t" &&
      node.checked !== undefined
    ) {
      event.preventDefault();
      command("toggleTask");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      command(modifier || node.kind === "root" ? "child" : "sibling");
      return;
    }
    if (
      event.key === " " &&
      (navigationById.get(node.id)?.children.length ?? 0)
    ) {
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
    const position = visibleOrder.indexOf(node.id);
    if (event.key === "ArrowUp")
      next = byId.get(visibleOrder[Math.max(0, position - 1)]);
    if (event.key === "ArrowDown")
      next = byId.get(
        visibleOrder[Math.min(visibleOrder.length - 1, position + 1)],
      );
    if (event.key === "ArrowLeft") {
      if (
        (navigationById.get(node.id)?.children.length ?? 0) &&
        !isFolded(node) &&
        node.kind !== "root" &&
        !node.presentationOnly
      ) {
        event.preventDefault();
        toggle(node);
        return;
      }
      next =
        node.id !== navigationProjection?.rootId &&
        navigableIds.has(node.parentId ?? "")
          ? byId.get(node.parentId ?? "")
          : undefined;
    }
    if (event.key === "ArrowRight") {
      if (isFolded(node)) {
        event.preventDefault();
        toggle(node);
        return;
      }
      next = byId.get(navigationById.get(node.id)?.children[0] ?? "");
    }
    if (event.key === "Home") next = byId.get(visibleOrder[0]);
    if (event.key === "End") next = byId.get(visibleOrder.at(-1) ?? "");
    if (next) {
      event.preventDefault();
      focusNode(next);
      selectNode(next, false, event.shiftKey);
    }
  };
  const zoom = (
    factor: number,
    x = viewport.width / 2,
    y = viewport.height / 2,
  ) => {
    fitPending.current = false;
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
  };
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const wheel = (event: WheelEvent) => {
      if (
        (event.target as Element).closest(
          "input,textarea,[contenteditable=true],.mindmap-overview",
        )
      )
        return;
      fitPending.current = false;
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
  useEffect(() => {
    if (researchActive && !searchFolds.current) {
      searchFolds.current = folds;
      searchDirty.current = false;
    }
    if (!researchActive && searchFolds.current) {
      if (!searchDirty.current) {
        const restored = searchFolds.current;
        setFolds(restored);
        let node = chosen;
        while (node?.parentId) {
          const parent = byId.get(node.parentId);
          if (!parent) break;
          if (
            restored.some(
              (item) =>
                binding.absolute(item.bookmark)?.anchor === parent.from &&
                item.type === parent.blockType,
            )
          )
            selectNode(parent);
          node = parent;
        }
      }
      searchFolds.current = null;
    }
    // Snapshot only on entering/leaving a research/search session. Ordinary
    // folding is explicit intent and sets searchDirty rather than overwriting it.
  }, [researchActive]);
  const updateQuery = (value: string) => setQuery(value);
  const updateLens = (lens: MindmapResearchLens) =>
    setPresentation((current) => ({ ...current, lens }));
  const findNext = (direction = 1) => {
    if (!matches.length) return;
    const current = matches.findIndex((n) => n.id === selected);
    const next =
      matches[
        current < 0
          ? direction < 0
            ? matches.length - 1
            : 0
          : (current + direction + matches.length) % matches.length
      ];
    const ancestors = new Set<string>();
    let parent = next.parentId;
    while (parent) {
      const node = byId.get(parent);
      if (!node) break;
      ancestors.add(`${node.blockType}:${node.from}`);
      parent = node.parentId;
    }
    setFolds((items) =>
      items.filter(
        (item) =>
          !ancestors.has(
            `${item.type}:${binding.absolute(item.bookmark)?.anchor ?? -1}`,
          ),
      ),
    );
    selectNode(next);
    focusNode(next);
  };
  const focusNodeId =
    focusBranch && focusPosition
      ? rangeIndex.get(`${focusBranch.type}:${focusPosition.anchor}`)
      : undefined;
  useEffect(() => {
    if (
      focusBranch &&
      projection &&
      result?.source === source &&
      (!focusPosition ||
        focusPosition.anchor >= focusPosition.head ||
        !focusNodeId)
    )
      setFocusBranch(null);
  }, [
    focusBranch,
    projection,
    result?.source,
    source,
    focusPosition?.anchor,
    focusPosition?.head,
    focusNodeId,
  ]);
  const focusAncestors: MindmapNode[] = [];
  let ancestor = focusNodeId && byId.get(focusNodeId);
  while (ancestor) {
    focusAncestors.unshift(ancestor);
    ancestor = byId.get(ancestor.parentId ?? "");
  }
  useEffect(() => {
    if (
      !presentation.resultsOnly ||
      !researchActive ||
      !projection ||
      result?.source !== source ||
      draft ||
      navigableIds.has(selected)
    )
      return;
    let node = byId.get(selected);
    while (node && !navigableIds.has(node.id))
      node = byId.get(node.parentId ?? "");
    node ??= byId.get(navigationProjection?.rootId ?? projection.rootId);
    if (node) {
      selectNode(node);
      selectedAnchor.current = binding.relative({
        anchor: node.from,
        head: node.to,
      });
    }
    // Selection is a view fallback, not a content mutation or a zoom reset.
  }, [
    presentation.resultsOnly,
    researchActive,
    projection,
    result?.source,
    source,
    draft,
    navigableIds,
    navigationProjection?.rootId,
    selected,
  ]);
  const toggleTask = (node: MindmapNode) =>
    mutate(() => {
      if (result?.source !== binding.source)
        throw new Error("The map is updating. Try again when it is ready.");
      return mindmapCommand(binding.source, node, "toggleTask");
    });
  const navigateResearch = (position: number) => {
    if (!projection || result?.source !== binding.source) return;
    const node = nodeAtMindmapPosition(projection, position);
    if (presentation.resultsOnly && !navigationById.has(node.id))
      setPresentation((p) => ({ ...p, resultsOnly: false }));
    if (
      focusBranch &&
      !mindmapBranchIds(projection, focusedProjection?.rootId).has(node.id)
    )
      setFocusBranch(null);
    expandBranch(node);
    let parent = byId.get(node.parentId ?? "");
    const ancestors = new Set<string>();
    while (parent) {
      ancestors.add(`${parent.blockType}:${parent.from}`);
      parent = byId.get(parent.parentId ?? "");
    }
    setFolds((items) =>
      items.filter(
        (item) =>
          !ancestors.has(
            `${item.type}:${binding.absolute(item.bookmark)?.anchor ?? -1}`,
          ),
      ),
    );
    selectNode(node);
    focusNode(node);
  };
  const mapLink = (target: string) => {
    if (target.startsWith("#fn-") || target.startsWith("#ref-")) {
      setDetailTab("evidence");
      changePane("details");
      return;
    }
    const at = research?.targets.get(target);
    if (at !== undefined) {
      navigateResearch(at);
      return;
    }
    props.onLink(target);
  };
  const sourceRange = (from: number, to: number) => {
    if (result?.source !== binding.source) {
      setMessage("Wait for the current map before revealing a source range.");
      return;
    }
    revealPending.current = { from, to };
    changePane("source");
    if (pane === "source") {
      sourceEditor.current?.reveal(from, to);
      revealPending.current = null;
    }
  };
  const visuals = useMemo(
    () =>
      displayedSource === source && displayedSource === binding.source
        ? markdownVisuals(ownerDocument, displayedSource, (node) =>
            visualPlacement(
              props.visual,
              node,
              props.visual ? binding : undefined,
            ),
          )
        : [],
    [ownerDocument, displayedSource, source, props.visual, binding],
  );
  const inspectVisual = (node: MindmapNode) => {
    if (result?.source !== binding.source) {
      setMessage("Wait for the current map before inspecting a visual.");
      return;
    }
    const at = visuals.findIndex(
      (visual) =>
        visual.from !== undefined &&
        visual.from >= node.from &&
        visual.from < node.to,
    );
    if (at < 0) return;
    openVisual({
      items: visuals,
      index: at,
      current: () => (result?.source === binding.source ? visuals : []),
      restore: () =>
        stage.current
          ?.querySelector<HTMLElement>(
            `[data-map-node="${CSS.escape(node.id)}"]`,
          )
          ?.focus({ preventScroll: true }),
    });
  };
  const chosenHasVisual =
    !!chosen &&
    visuals.some(
      (visual) =>
        visual.from !== undefined &&
        visual.from >= chosen.from &&
        visual.from < chosen.to,
    );
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
  refreshDrop.current = (x, y) => {
    const current = drag.current;
    if (!current?.id || !current.moved) return;
    clearDrop();
    if (current.source !== binding.source) {
      current.drop = undefined;
      setDropHint(
        "This document changed during dragging. Nothing will be moved.",
      );
      return;
    }
    const target = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-map-node]");
    if (
      !target ||
      target.dataset.mapNode === current.id ||
      !host.current?.contains(target)
    ) {
      current.drop = undefined;
      setDropHint("");
      if (hoverExpand.current) clearTimeout(hoverExpand.current);
      hoverExpand.current = null;
      hoverTarget.current = null;
      return;
    }
    const rect = target.getBoundingClientRect(),
      ratio = (y - rect.top) / rect.height;
    const placement =
      ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "child";
    const targetId = target.dataset.mapNode!;
    if (
      current.drop?.id !== targetId ||
      current.drop.placement !== placement ||
      current.drop.source !== binding.source
    ) {
      try {
        if (!projection || result?.source !== binding.source)
          throw new Error("The map is updating; wait before dropping.");
        const edit = moveMindmapBranch(
          binding.source,
          projection,
          current.id,
          targetId,
          placement,
        );
        current.drop = {
          id: targetId,
          placement,
          edit,
          source: binding.source,
        };
      } catch (error) {
        current.drop = {
          id: targetId,
          placement,
          source: binding.source,
          error: (error as Error).message,
        };
      }
      setDropHint(
        current.drop.error ??
          `Move ${byId.get(current.id)?.label ?? "branch"} ${placement === "child" ? "inside" : placement} ${byId.get(targetId)?.label ?? "branch"}`,
      );
    }
    if (current.drop.error) target.dataset.mapDropInvalid = "true";
    else target.dataset.mapDrop = placement;
    dropTarget.current = target;
    if (hoverTarget.current !== targetId) {
      if (hoverExpand.current) clearTimeout(hoverExpand.current);
      hoverExpand.current = null;
      hoverTarget.current = targetId;
      const next = byId.get(targetId);
      if (next && !current.drop.error && isFolded(next))
        hoverExpand.current = setTimeout(() => {
          if (drag.current === current && current.source === binding.source)
            setFolds((items) =>
              items.filter(
                (item) =>
                  item.type !== next.blockType ||
                  binding.absolute(item.bookmark)?.anchor !== next.from,
              ),
            );
        }, 600);
    }
  };
  useLayoutEffect(() => {
    const current = drag.current;
    if (current?.id && current.moved)
      refreshDrop.current(current.clientX, current.clientY);
  }, [camera, layout, source]);
  return (
    <section
      className="mindmap-surface"
      aria-label="Markdown mind map"
      data-map-layout={settings.layout}
      aria-busy={result?.source !== source}
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing) return;
        const field = (event.target as Element).closest(
          "input,textarea,[contenteditable=true],button",
        );
        if (!field && event.key === " ") spaceDown.current = true;
        if (!field && event.key === "Escape") {
          clearDrag();
          spaceDown.current = false;
          if (draft) {
            setDraft(null);
            event.stopPropagation();
            return;
          }
          if (query) updateQuery("");
          else if (selectionIds.size > 1) setSelections([]);
          else if (focusBranch) setFocusBranch(null);
        }
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
      onKeyUpCapture={(event) => {
        if (event.key === " ") spaceDown.current = false;
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
          onChange={(e) => updateQuery(e.target.value)}
          onClear={() => updateQuery("")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              findNext(e.shiftKey ? -1 : 1);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              updateQuery("");
            }
          }}
        />
        <Button
          variant="ghost"
          aria-label="Research lens"
          aria-pressed={presentation.lens !== "all"}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            openContextMenu({
              owner: event.currentTarget,
              x: box.left,
              y: box.bottom,
              label: "Research lens",
              items: mindmapResearchLenses.map((lens) => ({
                label: lens.label,
                icon: lens.id === presentation.lens ? "check" : "search",
                action: () => updateLens(lens.id),
              })),
            });
          }}
        >
          <Filter size={16} />
          {presentation.lens === "all"
            ? "Lens"
            : mindmapResearchLenses.find(
                (lens) => lens.id === presentation.lens,
              )?.label}
        </Button>
        {researchActive && (
          <span className="mindmap-search-count" role="status">
            {matches.length
              ? `${Math.max(0, matches.findIndex((n) => n.id === selected) + 1)} / ${matches.length}`
              : "No matches"}
          </span>
        )}
        {researchActive && (
          <>
            <IconButton
              label="Previous map match"
              disabled={!matches.length}
              onClick={() => findNext(-1)}
            >
              <ChevronLeft size={15} />
            </IconButton>
            <IconButton
              label="Next map match"
              disabled={!matches.length}
              onClick={() => findNext()}
            >
              <ChevronRight size={15} />
            </IconButton>
            <Button
              variant="ghost"
              aria-pressed={presentation.resultsOnly}
              onClick={() =>
                setPresentation((p) => ({ ...p, resultsOnly: !p.resultsOnly }))
              }
            >
              {presentation.resultsOnly ? "Show context" : "Focus results"}
            </Button>
            <IconButton
              label="Clear research lens and search"
              onClick={() => {
                setQuery("");
                setPresentation((p) => ({
                  ...p,
                  lens: "all",
                  resultsOnly: false,
                }));
              }}
            >
              <X size={15} />
            </IconButton>
          </>
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
          onClick={() => {
            fitPending.current = false;
            if (layout)
              setCamera(
                fitMindmap(layout.bounds, viewport.width, viewport.height),
              );
          }}
        >
          <Focus size={16} />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => zoom(1 / 1.2)}>
          <Minus size={16} />
        </IconButton>
        <Button
          variant="ghost"
          className="mindmap-zoom"
          onClick={() => {
            fitPending.current = false;
            setCamera((c) => ({ ...c, scale: 1 }));
          }}
          aria-label="Reset zoom to 100 percent"
        >
          {Math.round(camera.scale * 100)}%
        </Button>
        <IconButton label="Zoom in" onClick={() => zoom(1.2)}>
          <Plus size={16} />
        </IconButton>
        <IconButton
          label="Branch details"
          aria-pressed={pane === "details"}
          onClick={() => changePane(pane === "details" ? null : "details")}
        >
          <Info size={16} />
        </IconButton>
        <IconButton
          label="More map options"
          onClick={(event) => {
            const owner = event.currentTarget,
              box = owner.getBoundingClientRect();
            openContextMenu({
              owner: event.currentTarget,
              x: box.left,
              y: box.bottom,
              label: "Map options",
              items: [
                {
                  label: "Map hierarchy",
                  icon: "graph",
                  action: () => {},
                  children: [
                    {
                      label: "Expand all",
                      icon: "chevronRight",
                      action: () => {
                        if (searchFolds.current) searchDirty.current = true;
                        setFolds([]);
                      },
                    },
                    ...[1, 2, 3, 6].map((depth) => ({
                      label:
                        depth === 1
                          ? "Fold to first level"
                          : `Show ${depth} levels`,
                      icon: "chevronRight" as const,
                      action: () => foldToDepth(depth),
                    })),
                    {
                      label: "Focus selected branch",
                      icon: "search",
                      disabled:
                        !chosen ||
                        chosen.kind === "root" ||
                        !!chosen.presentationOnly,
                      action: () => chosen && focusOnly(chosen),
                    },
                    {
                      label: "Show entire map",
                      icon: "search",
                      disabled: !focusBranch && !presentation.resultsOnly,
                      action: () => {
                        setFocusBranch(null);
                        setPresentation((p) => ({ ...p, resultsOnly: false }));
                      },
                    },
                  ],
                },
                {
                  label: "Toggle map overview",
                  icon: "graph",
                  checked: presentation.minimap,
                  action: () =>
                    setPresentation((p) => ({ ...p, minimap: !p.minimap })),
                },
                {
                  label: "Map display options",
                  icon: "settings",
                  action: () => setDisplay(true),
                },
                {
                  label: "Export mind map",
                  icon: "download",
                  disabled: !projection || result?.source !== source,
                  action: () =>
                    projection &&
                    setExporting({
                      source,
                      projection,
                      settings,
                      selected: chosen?.presentationOnly
                        ? undefined
                        : chosen?.id,
                      research: presentation.preview === "research",
                    }),
                },
                {
                  label: "Selected branch actions",
                  icon: "more",
                  disabled: !chosen,
                  group: "node",
                  action: () => openMenu(owner, box.left, box.bottom),
                },
                {
                  label: "Mind-map shortcuts",
                  icon: "info",
                  group: "help",
                  action: () => setHelp(true),
                },
              ],
            });
          }}
        >
          <MoreHorizontal size={16} />
        </IconButton>
      </header>
      {focusBranch && (
        <nav
          className="mindmap-focus-path"
          aria-label="Focused branch ancestors"
        >
          <IconButton
            label="Show entire map"
            onClick={() => setFocusBranch(null)}
          >
            <ArrowLeft size={15} />
          </IconButton>
          {focusAncestors.map((node) => (
            <Button
              key={node.id}
              variant="ghost"
              onClick={() => focusOnly(node)}
              aria-current={node.id === focusNodeId ? "location" : undefined}
            >
              {node.label}
            </Button>
          ))}
        </nav>
      )}
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
            minWidth={240}
            defaultWidth={360}
            maxWidth={900}
            reserveWidth={360}
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
              ref={sourceEditor}
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
          role="tree"
          aria-label="Markdown hierarchy"
          aria-roledescription="Mind map"
          aria-multiselectable="true"
          title="Drag empty space or middle-drag to pan; command/control scroll to zoom."
          onPointerDown={(e) => {
            if (
              (e.button !== 0 && e.button !== 1) ||
              (e.target as Element).closest("button,input,a,textarea")
            )
              return;
            const element = (e.target as Element).closest<HTMLElement>(
              "[data-map-node]",
            );
            const node = element && byId.get(element.dataset.mapNode!);
            const pan = e.button === 1 || spaceDown.current;
            fitPending.current = false;
            if (node && !pan) {
              const active = selectNode(
                node,
                e.metaKey || e.ctrlKey,
                e.shiftKey,
              );
              selectedAnchor.current = binding.relative({
                anchor: active.from,
                head: active.to,
              });
              binding.select({
                anchor: active.labelFrom,
                head: active.labelTo,
              });
              const activeElement =
                active.id === node.id
                  ? element
                  : stage.current?.querySelector<HTMLElement>(
                      `[data-map-node="${CSS.escape(active.id)}"]`,
                    );
              activeElement?.focus({ preventScroll: true });
              // Modifier deselection must not let the browser focus the removed
              // member after the remaining active node was restored above.
              e.preventDefault();
            }
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            drag.current = {
              ...(node &&
              !pan &&
              latest.current.canEdit() &&
              node.kind !== "root" &&
              !node.presentationOnly &&
              selectionIds.size <= 1
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
              clientX: e.clientX,
              clientY: e.clientY,
              source: binding.source,
              camera,
              pointer: e.pointerId,
              moved: false,
              target: e.currentTarget,
            };
            if (!node || pan) e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const current = drag.current;
            if (!current || current.pointer !== e.pointerId) return;
            current.clientX = e.clientX;
            current.clientY = e.clientY;
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
              const edge = e.currentTarget.getBoundingClientRect();
              edgeVelocity.current = {
                x:
                  e.clientX < edge.left + 28
                    ? 8
                    : e.clientX > edge.right - 28
                      ? -8
                      : 0,
                y:
                  e.clientY < edge.top + 28
                    ? 8
                    : e.clientY > edge.bottom - 28
                      ? -8
                      : 0,
              };
              if (
                !gestureId.current &&
                (edgeVelocity.current.x || edgeVelocity.current.y)
              ) {
                const pan = () => {
                  if (drag.current !== current) return;
                  const velocity = edgeVelocity.current;
                  setCamera((c) => ({
                    ...c,
                    x: c.x + velocity.x,
                    y: c.y + velocity.y,
                  }));
                  gestureId.current =
                    velocity.x || velocity.y ? requestAnimationFrame(pan) : 0;
                };
                gestureId.current = requestAnimationFrame(pan);
              }
              e.currentTarget.dataset.draggingBranch = current.id;
              refreshDrop.current(e.clientX, e.clientY);
            }
          }}
          onPointerUp={(e) => {
            const current = drag.current;
            refreshDrop.current(e.clientX, e.clientY);
            clearDrag();
            delete e.currentTarget.dataset.draggingBranch;
            if (!current) return;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            if (!current.moved || !current.id || !projection) return;
            if (current.source !== binding.source) {
              setMessage(
                "This document changed during dragging. Nothing was moved.",
              );
              return;
            }
            if (!current.drop) {
              setMessage(
                "Drop on another branch to move it. Empty space only pans the map.",
              );
              return;
            }
            mutate(() => {
              const at = current.bookmark && binding.absolute(current.bookmark);
              if (
                !at ||
                binding.source.slice(at.anchor, at.head) !== current.original ||
                result?.source !== binding.source ||
                current.drop?.source !== binding.source
              )
                throw new Error(
                  "This branch changed during dragging. Nothing was moved.",
                );
              if (!current.drop?.edit)
                throw new Error(
                  current.drop?.error ?? "Choose a valid branch destination.",
                );
              return current.drop.edit;
            });
          }}
          onPointerCancel={(e) => {
            clearDrag();
            delete e.currentTarget.dataset.draggingBranch;
          }}
          onLostPointerCapture={(e) => {
            clearDrag();
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
              clearDrag();
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
              style={{
                transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`,
              }}
            >
              <svg
                className="mindmap-connectors"
                aria-hidden="true"
                style={{ overflow: "visible" }}
              >
                {layout.nodes
                  .filter((position) => {
                    const parent = placements.get(
                      byId.get(position.id)?.parentId ?? "",
                    );
                    if (!parent) return false;
                    const x = Math.min(parent.x, position.x),
                      y = Math.min(parent.y, position.y),
                      right = Math.max(
                        parent.x + parent.width,
                        position.x + position.width,
                      ),
                      bottom = Math.max(
                        parent.y + parent.height,
                        position.y + position.height,
                      );
                    return (
                      right * camera.scale + camera.x >= -100 &&
                      x * camera.scale + camera.x <= viewport.width + 100 &&
                      bottom * camera.scale + camera.y >= -100 &&
                      y * camera.scale + camera.y <= viewport.height + 100
                    );
                  })
                  .map((position) => {
                    const node = byId.get(position.id)!,
                      parent = placements.get(node.parentId ?? "");
                    if (!parent) return null;
                    return (
                      <path
                        key={position.id}
                        d={mindmapConnector(parent, position)}
                        className="mindmap-connector"
                        data-active-path={activePath.has(node.id) || undefined}
                        data-lens-context={
                          (researchActive && matchContextIds.has(node.id)) ||
                          undefined
                        }
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
                const peer = peersByNode.get(node.id) ?? [];
                // A task toggle is a synchronous one-character source edit. Reflect
                // it immediately; a worker round-trip must not restore the old check.
                const checked = mindmapTaskChecked(node, source);
                return (
                  <div
                    key={nodeKeys.get(node.id) ?? node.id}
                    role="treeitem"
                    aria-level={position.depth + 1}
                    aria-posinset={
                      node.id !== viewProjection?.rootId && node.parentId
                        ? (viewById
                            .get(node.parentId)
                            ?.children.indexOf(node.id) ?? 0) + 1
                        : 1
                    }
                    aria-setsize={
                      node.id !== viewProjection?.rootId && node.parentId
                        ? viewById.get(node.parentId)?.children.length
                        : 1
                    }
                    aria-selected={selectionIds.has(node.id)}
                    aria-expanded={
                      viewById.get(node.id)?.children.length
                        ? !isFolded(node)
                        : undefined
                    }
                    aria-label={
                      checked === undefined
                        ? node.label
                        : `${checked ? "Complete" : "Incomplete"} task: ${node.label}`
                    }
                    tabIndex={selected === node.id ? 0 : -1}
                    data-map-node={node.id}
                    data-kind={node.kind}
                    data-matching={matchIds.has(node.id) || undefined}
                    data-lens-match={
                      (researchActive && matchIds.has(node.id)) || undefined
                    }
                    data-lens-context={
                      (researchActive && matchContextIds.has(node.id)) ||
                      undefined
                    }
                    data-active-path={activePath.has(node.id) || undefined}
                    className="mindmap-node"
                    onPointerEnter={() => hoverNode(node.id)}
                    onPointerLeave={(e) => {
                      if (
                        !(e.relatedTarget instanceof Element) ||
                        e.relatedTarget.getAttribute("data-map-control") !==
                          node.id
                      )
                        leaveNode();
                    }}
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
                          checked={checked}
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
                      ) : (
                        <div className="mindmap-node-content">
                          <MindmapPreview
                            source={displayedSource}
                            node={node}
                            context={previewContext}
                            research={presentation.preview === "research"}
                            onLink={(target) => {
                              selectNode(node);
                              mapLink(target);
                            }}
                          />
                          {["root", "heading", "container"].includes(
                            node.kind,
                          ) &&
                            (index?.tasks.get(node.id)?.total ?? 0) > 0 && (
                              <div className="mindmap-branch-summary">
                                {index?.tasks.get(node.id)?.complete}/
                                {index?.tasks.get(node.id)?.total} tasks
                                complete
                              </div>
                            )}
                        </div>
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
                  </div>
                );
              })}
            </div>
          )}
          {layout && projection && (
            <div className="mindmap-control-layer">
              {draft && draftInView && draftBox && (
                <div
                  className="mindmap-draft-actions"
                  aria-label="Node edit actions"
                  style={{
                    left: Math.max(
                      8,
                      Math.min(
                        viewport.width - 80,
                        (draftBox.x + draftBox.width) * camera.scale +
                          camera.x -
                          76,
                      ),
                    ),
                    top: Math.max(
                      8,
                      Math.min(
                        viewport.height - 40,
                        (draftBox.y + draftBox.height) * camera.scale +
                          camera.y +
                          4,
                      ),
                    ),
                  }}
                >
                  <IconButton label="Apply node edit" onClick={commit}>
                    <Check size={16} />
                  </IconButton>
                  <IconButton
                    label="Cancel node edit"
                    onClick={() => setDraft(null)}
                  >
                    <X size={16} />
                  </IconButton>
                </div>
              )}
              {visible.map((position) => {
                const node = byId.get(position.id)!;
                const collapsed = isFolded(node),
                  active = hovered === node.id || selectionIds.has(node.id);
                const x =
                  (position.x + (position.side === 1 ? position.width : 0)) *
                    camera.scale +
                  camera.x +
                  (position.side === 1 ? 6 : -6);
                const children = node.children.flatMap((id) => {
                  const next = placements.get(id);
                  return next ? [next] : [];
                });
                const tightGutter =
                  !collapsed &&
                  children.some(
                    (child) =>
                      (position.side === 1
                        ? child.x - position.x - position.width
                        : position.x - child.x - child.width) *
                        camera.scale <
                      44,
                  );
                const y = tightGutter
                  ? Math.max(64, position.y * camera.scale + camera.y - 6)
                  : (position.y + position.height / 2) * camera.scale +
                    camera.y;
                if (
                  !viewById.get(node.id)?.children.length ||
                  node.kind === "root" ||
                  node.presentationOnly
                )
                  return null;
                return (
                  <IconButton
                    key={nodeKeys.get(node.id) ?? node.id}
                    data-map-control={node.id}
                    data-visible={collapsed || active || undefined}
                    data-collapsed={collapsed || undefined}
                    label={`${collapsed ? "Expand" : "Fold"} ${node.label}`}
                    title={
                      collapsed
                        ? `Expand ${node.label} · ${index?.descendants.get(node.id) ?? 0} hidden nodes`
                        : `Fold ${node.label}`
                    }
                    className="mindmap-fold"
                    style={{
                      left: x,
                      top: y,
                      transform: `translate(${position.side === 1 ? "0" : "-100%"}, ${tightGutter ? "-100%" : "-50%"})`,
                    }}
                    aria-expanded={!collapsed}
                    onPointerEnter={() => hoverNode(node.id)}
                    onPointerLeave={leaveNode}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(node);
                    }}
                  >
                    {collapsed ? (
                      position.side === 1 ? (
                        <ChevronRight size={14} />
                      ) : (
                        <ChevronLeft size={14} />
                      )
                    ) : position.side === 1 ? (
                      <ChevronLeft size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                    {collapsed && (
                      <span className="mindmap-hidden-count" aria-hidden="true">
                        {index?.descendants.get(node.id) ?? 0}
                      </span>
                    )}
                  </IconButton>
                );
              })}
            </div>
          )}
          {chosen && placements.has(chosen.id) && (
            <div
              className="mindmap-node-actions"
              aria-label="Selected block actions"
            >
              {chosen.checked !== undefined && (
                <IconButton
                  label={`${chosen.checked ? "Reopen" : "Complete"} selected task`}
                  disabled={props.readOnly}
                  onClick={() => toggleTask(chosen)}
                >
                  <ListChecks size={15} />
                </IconButton>
              )}
              {(index?.tasks.get(chosen.id)?.total ?? 0) > 0 && (
                <HelpText as="span">
                  {index?.tasks.get(chosen.id)?.complete}/
                  {index?.tasks.get(chosen.id)?.total} tasks
                </HelpText>
              )}
              {chosen.kind === "content" || chosen.kind === "container" ? (
                <IconButton
                  label="Open full block"
                  onClick={() => changePane("details")}
                >
                  <Info size={15} />
                </IconButton>
              ) : null}
              <IconButton
                label="Reveal selected in Source"
                disabled={!chosen.to}
                onClick={() => revealSource(chosen)}
              >
                <Braces size={15} />
              </IconButton>
              <IconButton
                label="Center selected branch"
                onClick={() => fitSelection(chosen)}
              >
                <Focus size={15} />
              </IconButton>
            </div>
          )}
          {dropHint && (
            <p className="mindmap-drop-hint" role="status">
              {dropHint}
            </p>
          )}
          {presentation.minimap && layout && (
            <MindmapOverview
              layout={layout}
              camera={camera}
              viewport={viewport}
              onCamera={(next) => {
                fitPending.current = false;
                setCamera(next);
              }}
              onClose={() =>
                setPresentation((value) => ({ ...value, minimap: false }))
              }
            />
          )}
        </div>
        {pane === "details" && chosen && projection && research && (
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
            <MindmapDetails
              node={chosen}
              projection={projection}
              research={research}
              source={displayedSource}
              liveSource={source}
              context={previewContext}
              document={ownerDocument}
              readOnly={props.readOnly}
              onLink={mapLink}
              onNavigate={navigateResearch}
              onSource={sourceRange}
              onDocument={props.onDocument}
              onToggleTask={toggleTask}
              onVisual={chosenHasVisual ? inspectVisual : undefined}
              tab={detailTab}
              onTab={setDetailTab}
            />
          </ResizablePanel>
        )}
      </div>
      {display && (
        <MindmapDisplayDialog
          settings={settings}
          presentation={presentation}
          onPresentation={setPresentation}
          onChange={(next) => {
            localPreferences.current = true;
            if (next.nodeWidth !== settings.nodeWidth) {
              setSizes({});
            }
            setSettings(next);
          }}
          onExpandAll={() => {
            if (searchFolds.current) searchDirty.current = true;
            setFolds([]);
          }}
          onFoldAll={() => foldToDepth(1)}
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
            setDisplay(false);
          }}
        />
      )}
      {help && (
        <Dialog title="Mind-map shortcuts" onClose={() => setHelp(false)}>
          <dl className="mindmap-shortcuts">
            <dt>Arrow keys · Home / End</dt>
            <dd>Navigate visible branches; Left folds, Right expands.</dd>
            <dt>Enter · ⌘/Ctrl Enter</dt>
            <dd>Add a sibling or child. The root always adds a child.</dd>
            <dt>F2 · double-click</dt>
            <dd>Edit an inline label; other blocks open their source range.</dd>
            <dt>T · Space</dt>
            <dd>Toggle the selected task or fold its branch.</dd>
            <dt>⌘/Ctrl click · Shift click</dt>
            <dd>Toggle selection or select a visible range.</dd>
            <dt>⌘/Ctrl A · ⌘/Ctrl C</dt>
            <dd>Select visible branches or copy selected Markdown.</dd>
            <dt>Alt ↑ / ↓ / ←</dt>
            <dd>Move a compatible branch up, down or outdent.</dd>
            <dt>⌘/Ctrl / · ⌘/Ctrl Z</dt>
            <dd>Toggle source or undo. Add Shift to redo.</dd>
            <dt>Drag blank space · middle-drag</dt>
            <dd>
              Pan without modifying Markdown. Command/control wheel zooms.
            </dd>
            <dt>Shift F10 · Escape</dt>
            <dd>Open branch actions; cancel gestures or leave focused view.</dd>
          </dl>
          <DialogFooter>
            <Button variant="primary" onClick={() => setHelp(false)}>
              Done
            </Button>
          </DialogFooter>
        </Dialog>
      )}
      {leaving && draft && (
        <Dialog title="Keep your node edit?" onClose={() => setLeaving(null)}>
          <p>
            Your label has not been applied to Markdown. Apply it before
            leaving, or keep editing.
          </p>
          <TextInput
            aria-label="Unsaved node label"
            value={draft.value}
            readOnly
          />
          <Button
            onClick={() =>
              void navigator.clipboard.writeText(draft.value).then(
                () => setMessage("Draft copied."),
                () =>
                  setMessage(
                    "Clipboard access is unavailable. Select and copy the label above.",
                  ),
              )
            }
          >
            Copy draft
          </Button>
          {message && <Notice tone="warning">{message}</Notice>}
          <DialogFooter>
            <Button onClick={() => setLeaving(null)}>Stay</Button>
            <Button
              variant="danger"
              onClick={() => {
                const proceed = leaving;
                setDraft(null);
                setLeaving(null);
                proceed();
              }}
            >
              Discard and leave
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!commit()) return;
                const proceed = leaving;
                setLeaving(null);
                proceed();
              }}
            >
              Apply and leave
            </Button>
          </DialogFooter>
        </Dialog>
      )}
      {exporting && (
        <MindmapExportDialog
          binding={binding}
          source={exporting.source}
          title={props.title}
          projection={exporting.projection}
          settings={exporting.settings}
          selected={exporting.selected}
          context={previewContext}
          research={exporting.research}
          beforeExport={props.beforeExport}
          onClose={() => setExporting(null)}
        />
      )}
    </section>
  );
}
export { mindmapBranchColor as branchColor } from "@axiom/mindmap";
