"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as Y from "yjs";
import dynamic from "next/dynamic";
import {
  Download,
  FilePlus2,
  Group,
  Hand,
  Link2,
  Maximize,
  MessageSquare,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Search,
  StickyNote,
  Undo2,
  Upload,
  X,
  SlidersHorizontal,
  LayoutTemplate,
  Grid2X2,
  RefreshCw,
} from "lucide-react";
import {
  applyCanvasCommands,
  canvasBounds,
  canvasColors,
  canvasCurve,
  canvasPort,
  canvasTitle,
  parseCanvas,
  readCanvas,
  type CanvasCommand,
  type CanvasData,
  type CanvasNode,
  type CanvasSide,
} from "@axiom/shared/canvas";
import {
  arrangeCanvas,
  canvasConnectionTarget,
  canvasEdgeGeometry,
  intersectsCanvas,
  type CanvasArrangement,
} from "@axiom/shared/canvas-geometry";
import { canvasTemplates } from "@axiom/shared/canvas-templates";
import type { ResourceCardPreview } from "@axiom/shared/canvas-preview";
import type { ToolProject } from "@axiom/shared/research-tools";
import type { Resource, ResourcePage } from "@axiom/shared/workspace";
import { useToolDocument } from "../../lib/tools/use-tool-document";
import { downloadText } from "../../lib/tools/download";
import { openContextMenu, type ContextAction } from "../../lib/context-menu";
import {
  ErrorNotice,
  Loading,
  ResourceIcon,
  useData,
  useWorkspace,
  WorkspaceLink,
} from "../workspace/ui";
import CanvasCardContents from "./CanvasCardContents";
import CanvasProperties from "./CanvasProperties";
import { useCanvasSizing } from "../../lib/tools/use-canvas-sizing";
import {
  cloneCanvasSelection,
  decodeCanvasClipboard,
  encodeCanvasClipboard,
  selectedCanvas,
} from "../../lib/tools/canvas-clipboard";
import ResourceDiscussion from "./ResourceDiscussion";
import Dialog from "../Dialog";
import { api } from "../../lib/client";

const origin = "canvas-local";
const CanvasExportDialog = dynamic(() => import("./CanvasExportDialog"), {
  ssr: false,
});
const sides: CanvasSide[] = ["top", "right", "bottom", "left"];
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
type Point = { x: number; y: number };
type View = Point & { zoom: number };
type Drag = {
  pointer: number;
  start: Point;
  view: View;
  at: Point;
  kind: "pan" | "move" | "resize" | "select" | "connect";
  ids: string[];
  nodes: CanvasNode[];
  initial: string[];
  moved: boolean;
  side?: CanvasSide;
};

/** Native DOM cards + SVG edges. Pointer previews are local; completed gestures
 * produce atomic, property-level Yjs transactions rather than replacing JSON. */
export default function CanvasStudio({ project }: { project: ToolProject }) {
  const { session, notify } = useWorkspace();
  const shared = useToolDocument(
    project.resource_id,
    project.generation ?? 1,
    session.user,
    project.role === "editor",
    "canvas",
  );
  const parsed = useMemo(() => {
    try {
      return { data: parseCanvas(shared.source), error: "" };
    } catch (error) {
      return {
        data: { nodes: [], edges: [] } as CanvasData,
        error: (error as Error).message,
      };
    }
  }, [shared.source]);
  const data = parsed.data;
  const [view, setView] = useState<View>({ x: 140, y: 100, zoom: 1 }),
    [selection, setSelection] = useState<string[]>([]),
    [editing, setEditing] = useState<string | null>(null),
    [dragPreview, setDragPreview] = useState<CanvasNode[] | null>(null),
    [rectangle, setRectangle] = useState<
      (Point & { width: number; height: number }) | null
    >(null),
    [connection, setConnection] = useState<{
      from: string;
      side: CanvasSide;
      to: Point;
      target?: { id: string; side: CanvasSide };
    } | null>(null),
    [hand, setHand] = useState(false),
    [panel, setPanel] = useState<"discussion" | "cards" | "properties" | null>(
      null,
    ),
    [renaming, setRenaming] = useState<string | null>(null),
    [replaceFile, setReplaceFile] = useState<string | null>(null),
    [snap, setSnap] = useState(false),
    [cardType, setCardType] = useState("all"),
    [exporting, setExporting] = useState(false),
    [commentCard, setCommentCard] = useState<string | null>(null),
    [boardSize, setBoardSize] = useState({ width: 1000, height: 800 }),
    [picker, setPicker] = useState(false),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [peers, setPeers] = useState<
      { id: number; name: string; color: string; x: number; y: number }[]
    >([]);
  const [, refreshPreviews] = useState(0);
  const board = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null),
    undo = useRef<Y.UndoManager | null>(null),
    spaceHeld = useRef(false),
    importInput = useRef<HTMLInputElement>(null),
    fitted = useRef(false),
    previewData = useRef(new Map<string, ResourceCardPreview>()),
    latest = useRef({ data, view, selection, readOnly: shared.readOnly });
  latest.current = { data, view, selection, readOnly: shared.readOnly };
  const ownsSizing = useCanvasSizing(
    shared.awareness,
    shared.readOnly,
    editing,
  );
  const resources = useData<ResourcePage>(
    picker
      ? `resources?view=all&spaceId=${project.space_id}&q=${encodeURIComponent(query)}`
      : null,
  );
  const nodes = dragPreview ?? data.nodes,
    selected = nodes.filter((n) => selection.includes(n.id)),
    selectedEdge = data.edges.find((e) => selection.includes(e.id));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const viewport = {
    x: -view.x / view.zoom - 180 / view.zoom,
    y: -view.y / view.zoom - 180 / view.zoom,
    width: (boardSize.width + 360) / view.zoom,
    height: (boardSize.height + 360) / view.zoom,
  };
  const visibleNodes = nodes.filter(
    (n) =>
      n.id === editing ||
      n.id === renaming ||
      selection.includes(n.id) ||
      intersectsCanvas(n, viewport),
  );
  const point = (client: Point, v = view) => {
    const rect = board.current!.getBoundingClientRect();
    return {
      x: (client.x - rect.left - v.x) / v.zoom,
      y: (client.y - rect.top - v.y) / v.zoom,
    };
  };
  const command = (commands: CanvasCommand[], boundary = true) => {
    if (!shared.document || latest.current.readOnly || parsed.error)
      return false;
    try {
      if (boundary) undo.current?.stopCapturing();
      applyCanvasCommands(shared.document, commands, origin);
      setError("");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const updateNode = (id: string, changes: Record<string, unknown>) =>
    command([{ type: "update-node", id, changes }]);
  const resizeAutomatically = (height: number, expected: CanvasNode) => {
    if (
      !shared.document ||
      latest.current.readOnly ||
      !ownsSizing(expected.id) ||
      drag.current
    )
      return;
    const current = readCanvas(shared.document).nodes.find(
      (n) => n.id === expected.id,
    );
    if (
      !current ||
      current.locked ||
      current.heightMode !== "auto" ||
      current.width !== expected.width ||
      current.height !== expected.height ||
      JSON.stringify(current) !== JSON.stringify(expected)
    )
      return;
    try {
      applyCanvasCommands(
        shared.document,
        [{ type: "update-node", id: current.id, changes: { height } }],
        "canvas-auto-size",
      );
    } catch {
      /* A concurrent removal wins over a derived measurement. */
    }
  };
  const fit = (items = latest.current.data.nodes) => {
    if (!board.current) return;
    const b = canvasBounds(items),
      r = board.current.getBoundingClientRect(),
      zoom = clamp(
        Math.min(
          (r.width - 100) / (b.width || 1),
          // Keep the selection strip and bottom dock clear of fitted cards.
          (r.height - 180) / (b.height || 1),
        ),
        0.08,
        1.3,
      );
    setView({
      x: r.width / 2 - (b.x + b.width / 2) * zoom,
      y: r.height / 2 - 10 - (b.y + b.height / 2) * zoom,
      zoom,
    });
  };
  useEffect(() => {
    const root = board.current;
    if (!root) return;
    const resize = new ResizeObserver(([entry]) =>
      setBoardSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    resize.observe(root);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    if (!fitted.current && data.nodes.length && board.current) {
      const target = new URLSearchParams(location.hash.slice(1)).get("card");
      const found = data.nodes.find((n) => n.id === target);
      fit(found ? [found] : data.nodes);
      if (found) setSelection([found.id]);
      fitted.current = true;
    }
  }, [data.nodes.length]);
  useEffect(() => {
    const revealCard = () => {
      const id = new URLSearchParams(location.hash.slice(1)).get("card");
      const node = latest.current.data.nodes.find((item) => item.id === id);
      if (!node) return;
      setSelection([node.id]);
      setEditing(null);
      fit([node]);
    };
    window.addEventListener("hashchange", revealCard);
    window.addEventListener("popstate", revealCard);
    return () => {
      window.removeEventListener("hashchange", revealCard);
      window.removeEventListener("popstate", revealCard);
    };
  }, []);
  useEffect(() => {
    if (!shared.document) return;
    const manager = new Y.UndoManager(shared.document.getMap("canvas"), {
      trackedOrigins: new Set([origin]),
      captureTimeout: 500,
    });
    undo.current = manager;
    return () => {
      manager.destroy();
      undo.current = null;
    };
  }, [shared.document]);
  useEffect(() => {
    const awareness = shared.awareness;
    if (!awareness) return;
    const update = () =>
      setPeers(
        [...awareness.getStates()].flatMap(([id, state]) =>
          id === awareness.clientID ||
          !state.canvas ||
          !Number.isFinite(state.canvas.x) ||
          !Number.isFinite(state.canvas.y)
            ? []
            : [
                {
                  id,
                  name: String(state.user?.name ?? "Collaborator").slice(
                    0,
                    100,
                  ),
                  color: /^#[\da-f]{6}$/i.test(state.user?.color)
                    ? state.user.color
                    : "#7080a0",
                  x: state.canvas.x,
                  y: state.canvas.y,
                },
              ],
        ),
      );
    awareness.on("change", update);
    update();
    return () => {
      awareness.setLocalStateField("canvas", null);
      awareness.off("change", update);
    };
  }, [shared.awareness]);
  useEffect(() => {
    const root = board.current;
    if (!root) return;
    const wheel = (e: WheelEvent) => {
      if (
        (e.target as Element).closest("textarea,.canvas-card-body") &&
        !e.ctrlKey &&
        !e.metaKey
      )
        return;
      e.preventDefault();
      setView((v) => {
        if (!e.ctrlKey && !e.metaKey)
          return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
        const p = point({ x: e.clientX, y: e.clientY }, v),
          zoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.008), 0.08, 3);
        return {
          x: v.x + p.x * (v.zoom - zoom),
          y: v.y + p.y * (v.zoom - zoom),
          zoom,
        };
      });
    };
    root.addEventListener("wheel", wheel, { passive: false });
    const release = () => {
      spaceHeld.current = false;
    };
    window.addEventListener("keyup", release);
    window.addEventListener("blur", release);
    return () => {
      root.removeEventListener("wheel", wheel);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", release);
    };
  }, []);
  const center = () => {
    const r = board.current!.getBoundingClientRect();
    return point({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };
  const add = (
    type: "text" | "group" | "link",
    requested?: Point,
    template?: { id: string; title: string; text: string },
  ) => {
    const at = requested ?? center();
    const id = crypto.randomUUID();
    const node: CanvasNode = {
      id,
      type,
      x: Math.round(at.x - 150),
      y: Math.round(at.y - 70),
      width: type === "group" ? 640 : 320,
      height: type === "group" ? 440 : 200,
      heightMode: type === "group" ? "manual" : "auto",
      ...(type === "text"
        ? {
            text: template?.text ?? "",
            ...(template ? { title: template.title, tags: [template.id] } : {}),
          }
        : type === "group"
          ? { label: "Untitled group" }
          : { url: "https://example.com" }),
    } as CanvasNode;
    if (!requested && type !== "group") {
      for (let tries = 0; tries <= data.nodes.length; tries++) {
        const occupied = data.nodes.some(
          (n) =>
            n.type !== "group" &&
            n.x < node.x + node.width + 24 &&
            n.x + n.width + 24 > node.x &&
            n.y < node.y + node.height + 24 &&
            n.y + n.height + 24 > node.y,
        );
        if (!occupied) break;
        node.x += node.width + 48;
      }
    }
    if (command([{ type: "add", nodes: [node] }])) {
      setSelection([id]);
      setEditing(id);
      if (type === "link") {
        setEditing(null);
        setPanel("properties");
      }
      if (type === "group") setRenaming(id);
      const r = board.current!.getBoundingClientRect();
      if (
        !requested &&
        (node.x * view.zoom + view.x < 24 ||
          (node.x + node.width) * view.zoom + view.x > r.width - 24)
      )
        setView((v) => ({
          ...v,
          x: r.width / 2 - (node.x + node.width / 2) * v.zoom,
          y: r.height / 2 - (node.y + node.height / 2) * v.zoom,
        }));
    }
  };
  const duplicate = (ids = latest.current.selection) => {
    const copied = cloneCanvasSelection(
      selectedCanvas(latest.current.data, ids),
    );
    if (command([{ type: "add", ...copied }]))
      setSelection(copied.nodes.map((n) => n.id));
  };
  const copySelection = async (ids = latest.current.selection, cut = false) => {
    try {
      await navigator.clipboard.writeText(
        encodeCanvasClipboard(selectedCanvas(latest.current.data, ids)),
      );
      if (cut && command([{ type: "remove", ids }])) setSelection([]);
      else notify("Cards copied with their internal connections.");
    } catch {
      setError(
        "Clipboard access was denied. Focus the canvas and use ⌘/Ctrl+C instead.",
      );
    }
  };
  const paste = (source: string, at = center()) => {
    try {
      const copied = decodeCanvasClipboard(source);
      if (copied) {
        const additions = cloneCanvasSelection(copied, at);
        if (command([{ type: "add", ...additions }]))
          setSelection(additions.nodes.map((n) => n.id));
      } else if (source.trim())
        add("text", at, {
          id: "pasted",
          title: "Pasted text",
          text: source.slice(0, 100000),
        });
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const pasteFromMenu = async (at?: Point) => {
    try {
      paste(await navigator.clipboard.readText(), at);
    } catch {
      setError(
        "Clipboard access was denied. Focus the canvas and use ⌘/Ctrl+V instead.",
      );
    }
  };
  const copyLink = (id: string) => {
    const url = new URL(location.href);
    url.hash = `card=${encodeURIComponent(id)}`;
    void navigator.clipboard
      .writeText(url.href)
      .then(() => notify("Card link copied."))
      .catch(() =>
        setError("Unable to copy this link. Clipboard permission is required."),
      );
  };
  const remove = () => {
    if (command([{ type: "remove", ids: selection }])) {
      setSelection([]);
      setEditing(null);
    }
  };
  const groupSelection = () => {
    const b = canvasBounds(selected),
      node: CanvasNode = {
        id: crypto.randomUUID(),
        type: "group",
        label: "Research group",
        x: b.x - 30,
        y: b.y - 60,
        width: b.width + 60,
        height: b.height + 90,
      };
    if (
      command([
        { type: "add", nodes: [node] },
        { type: "order", ids: selected.map((n) => n.id) },
      ])
    )
      setSelection([node.id]);
  };
  const menu = (e: React.MouseEvent, node?: CanvasNode) => {
    e.preventDefault();
    e.stopPropagation();
    if (node && !selection.includes(node.id)) setSelection([node.id]);
    const ids = node && !selection.includes(node.id) ? [node.id] : selection,
      at = point({ x: e.clientX, y: e.clientY });
    const chosen = data.nodes.filter((n) => ids.includes(n.id));
    const first = chosen.length === 1 ? chosen[0] : undefined;
    const arrangement = (
      label: string,
      mode: CanvasArrangement,
      icon: ContextAction["icon"],
    ): ContextAction => ({
      label,
      icon,
      disabled:
        shared.readOnly ||
        chosen.filter((n) => !n.locked).length <
          (mode === "horizontal" || mode === "vertical" ? 3 : 2),
      action: () => command(arrangeCanvas(chosen, mode)),
    });
    const items: ContextAction[] = ids.length
      ? [
          {
            label: "Properties",
            icon: "info",
            group: "Card",
            action: () => setPanel("properties"),
          },
          {
            label: "Rename",
            icon: "rename",
            shortcut: "F2",
            disabled: shared.readOnly || !first,
            action: () => {
              if (first) setRenaming(first.id);
            },
          },
          {
            label: "Copy link to card",
            icon: "link",
            disabled: !first,
            action: () => {
              if (first) copyLink(first.id);
            },
          },
          {
            label: "Discuss card",
            icon: "comment",
            disabled: !first,
            action: () => {
              if (first) {
                setCommentCard(first.id);
                setPanel("discussion");
              }
            },
          },
          {
            label: "Copy",
            icon: "copy",
            group: "Clipboard",
            shortcut: "⌘C",
            disabled: !chosen.length,
            action: () => {
              void copySelection(ids);
            },
          },
          {
            label: "Cut",
            icon: "cut",
            shortcut: "⌘X",
            disabled: shared.readOnly || !chosen.length,
            action: () => {
              void copySelection(ids, true);
            },
          },
          {
            label: "Duplicate",
            icon: "duplicate",
            shortcut: "⌘D",
            disabled: shared.readOnly || !chosen.length,
            action: () => duplicate(ids),
          },
          {
            label: "Focus selection",
            icon: "search",
            group: "View",
            action: () => fit(nodes.filter((n) => ids.includes(n.id))),
          },
          {
            label: "Bring to front",
            icon: "open",
            disabled: shared.readOnly,
            group: "Arrange",
            action: () => command([{ type: "order", ids }]),
          },
          {
            label: "Send to back",
            icon: "moveDown",
            disabled: shared.readOnly,
            action: () => command([{ type: "order", ids, placement: "back" }]),
          },
          {
            label: "Align and distribute",
            icon: "alignLeft",
            disabled: shared.readOnly || chosen.length < 2,
            action: () => {},
            children: [
              arrangement("Align left", "left", "alignLeft"),
              arrangement("Align center", "center", "alignCenter"),
              arrangement("Align right", "right", "alignRight"),
              arrangement("Align top", "top", "moveUp"),
              arrangement("Align middle", "middle", "alignCenter"),
              arrangement("Align bottom", "bottom", "moveDown"),
              {
                ...arrangement(
                  "Distribute horizontally",
                  "horizontal",
                  "moveRight",
                ),
                group: "Spacing",
              },
              arrangement("Distribute vertically", "vertical", "moveDown"),
            ],
          },
          {
            label: chosen.every((n) => n.locked)
              ? "Unlock position and size"
              : "Lock position and size",
            icon: chosen.every((n) => n.locked) ? "unlock" : "lock",
            disabled: shared.readOnly || !chosen.length,
            action: () =>
              command(
                chosen.map((n) => ({
                  type: "update-node",
                  id: n.id,
                  changes: { locked: !chosen.every((c) => c.locked) },
                })),
              ),
          },
          {
            label: "Restore automatic height",
            icon: "size",
            disabled:
              shared.readOnly ||
              !chosen.some((n) => !n.locked && n.type !== "group"),
            action: () =>
              command(
                chosen
                  .filter((n) => !n.locked && n.type !== "group")
                  .map((n) => ({
                    type: "update-node",
                    id: n.id,
                    changes: { heightMode: "auto" },
                  })),
              ),
          },
          {
            label: "Connect selected cards",
            icon: "link",
            disabled: shared.readOnly || chosen.length !== 2,
            action: () => {
              const id = crypto.randomUUID();
              if (
                command([
                  {
                    type: "add",
                    edges: [
                      {
                        id,
                        fromNode: chosen[0].id,
                        toNode: chosen[1].id,
                        fromSide: "right",
                        toSide: "left",
                        toEnd: "arrow",
                      },
                    ],
                  },
                ])
              ) {
                setSelection([id]);
                setPanel("properties");
              }
            },
          },
          {
            label: "Remove",
            icon: "trash",
            tone: "danger",
            disabled: shared.readOnly,
            group: "Edit",
            shortcut: "⌫",
            action: () => {
              command([{ type: "remove", ids }]);
              setSelection([]);
            },
          },
        ]
      : [
          {
            label: "Text card",
            icon: "newNote",
            group: "Create",
            disabled: shared.readOnly,
            action: () => add("text", at),
          },
          {
            label: "File card…",
            icon: "file",
            disabled: shared.readOnly,
            action: () => setPicker(true),
          },
          {
            label: "Web link",
            icon: "link",
            disabled: shared.readOnly,
            action: () => add("link", at),
          },
          {
            label: "Group",
            icon: "folder",
            disabled: shared.readOnly,
            action: () => add("group", at),
          },
          {
            label: "Research template",
            icon: "note",
            disabled: shared.readOnly,
            action: () => {},
            children: canvasTemplates.map((template) => ({
              label: template.title,
              icon: "newNote",
              action: () => add("text", at, template),
            })),
          },
          {
            label: "Paste",
            icon: "paste",
            group: "Clipboard",
            shortcut: "⌘V",
            disabled: shared.readOnly,
            action: () => {
              void pasteFromMenu(at);
            },
          },
          {
            label: "Snap to grid",
            icon: "table",
            group: "View",
            checked: snap,
            action: () => setSnap(!snap),
          },
          {
            label: "Zoom to fit",
            icon: "search",
            group: "View",
            action: () => fit(),
          },
        ];
    openContextMenu({
      owner: board.current!,
      x: e.clientX,
      y: e.clientY,
      label: "Canvas actions",
      items,
    });
  };
  const start = (
    e: ReactPointerEvent,
    kind: Drag["kind"],
    node?: CanvasNode,
    side?: CanvasSide,
  ) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (
      (e.target as Element).closest(
        "textarea,input,a,button,.canvas-card-editor",
      ) &&
      kind === "move"
    )
      return;
    e.stopPropagation();
    board.current?.focus({ preventScroll: true });
    if (e.button === 1 || spaceHeld.current || hand) kind = "pan";
    if (shared.readOnly && ["move", "resize", "connect"].includes(kind)) {
      if (node) setSelection([node.id]);
      return;
    }
    if (node?.locked && ["move", "resize"].includes(kind)) {
      setSelection([node.id]);
      return;
    }
    const at = point({ x: e.clientX, y: e.clientY });
    let ids = node
      ? selection.includes(node.id)
        ? selection
        : e.shiftKey || e.metaKey || e.ctrlKey
          ? [...selection, node.id]
          : [node.id]
      : [];
    if (node && kind === "connect") ids = [node.id];
    if (node && kind === "move" && node.type === "group")
      ids = [
        ...new Set([
          ...ids,
          ...data.nodes
            .filter(
              (n) =>
                n.id !== node.id &&
                n.x >= node.x &&
                n.y >= node.y &&
                n.x + n.width <= node.x + node.width &&
                n.y + n.height <= node.y + node.height,
            )
            .map((n) => n.id),
        ]),
      ];
    if (node) setSelection(ids);
    else if (kind === "select" && !(e.shiftKey || e.metaKey || e.ctrlKey))
      setSelection([]);
    if (kind !== "move" || node?.id !== editing) setEditing(null);
    drag.current = {
      pointer: e.pointerId,
      kind,
      start: { x: e.clientX, y: e.clientY },
      view,
      at,
      ids,
      nodes: data.nodes,
      initial: e.shiftKey || e.metaKey || e.ctrlKey ? selection : [],
      moved: false,
      side,
    };
    // Capturing a stationary card press retargets click/dblclick to the board.
    // Wait for an actual drag so double-click can reach the text card itself.
    if (kind !== "move") board.current?.setPointerCapture(e.pointerId);
    if (kind === "connect" && node)
      setConnection({ from: node.id, side: side!, to: at });
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current,
      p = point({ x: e.clientX, y: e.clientY });
    if (!d) {
      if (shared.awareness && e.timeStamp % 3 < 1)
        shared.awareness.setLocalStateField("canvas", p);
      return;
    }
    const dx = (e.clientX - d.start.x) / d.view.zoom,
      dy = (e.clientY - d.start.y) / d.view.zoom;
    d.moved ||= Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) > 4;
    if (!d.moved) return;
    if (d.kind === "move" && !board.current?.hasPointerCapture(e.pointerId)) {
      board.current?.setPointerCapture(e.pointerId);
      setEditing(null);
    }
    if (d.kind === "pan")
      setView({
        ...d.view,
        x: d.view.x + e.clientX - d.start.x,
        y: d.view.y + e.clientY - d.start.y,
      });
    if (d.kind === "move" || d.kind === "resize")
      setDragPreview(
        d.nodes.map((n) =>
          !d.ids.includes(n.id) || n.locked
            ? n
            : d.kind === "move"
              ? {
                  ...n,
                  x: clamp(
                    snap
                      ? Math.round((n.x + dx) / 24) * 24
                      : Math.round(n.x + dx),
                    -1e6,
                    1e6,
                  ),
                  y: clamp(
                    snap
                      ? Math.round((n.y + dy) / 24) * 24
                      : Math.round(n.y + dy),
                    -1e6,
                    1e6,
                  ),
                }
              : {
                  ...n,
                  width: clamp(Math.round(n.width + dx), 100, 20000),
                  height: clamp(Math.round(n.height + dy), 70, 20000),
                },
        ),
      );
    if (d.kind === "connect") {
      const target = canvasConnectionTarget(
        latest.current.data.nodes,
        p,
        view.zoom,
        d.ids[0],
      );
      setConnection({
        from: d.ids[0],
        side: d.side!,
        to: target ? canvasPort(target.node, target.side) : p,
        ...(target
          ? { target: { id: target.node.id, side: target.side } }
          : {}),
      });
    }
    if (d.kind === "select") {
      const r = {
        x: Math.min(d.at.x, p.x),
        y: Math.min(d.at.y, p.y),
        width: Math.abs(d.at.x - p.x),
        height: Math.abs(d.at.y - p.y),
      };
      setRectangle(r);
      setSelection([
        ...new Set([
          ...d.initial,
          ...data.nodes
            .filter(
              (n) =>
                n.x < r.x + r.width &&
                n.x + n.width > r.x &&
                n.y < r.y + r.height &&
                n.y + n.height > r.y,
            )
            .map((n) => n.id),
        ]),
      ]);
    }
  };
  const finish = (e?: ReactPointerEvent, cancel = false) => {
    const d = drag.current;
    if (!d) return;
    if (
      !cancel &&
      d.moved &&
      dragPreview &&
      ["move", "resize"].includes(d.kind)
    ) {
      // Rebase geometry deltas onto the latest shared coordinates so concurrent
      // collaborators' changes to text and unrelated properties are untouched.
      command(
        d.ids.flatMap((id) => {
          const before = d.nodes.find((n) => n.id === id),
            preview = dragPreview.find((n) => n.id === id),
            now = readCanvas(shared.document!).nodes.find((n) => n.id === id);
          return before && preview && now && !now.locked
            ? [
                {
                  type: "update-node" as const,
                  id,
                  changes:
                    d.kind === "move"
                      ? {
                          x: now.x + preview.x - before.x,
                          y: now.y + preview.y - before.y,
                        }
                      : {
                          width: preview.width,
                          height: preview.height,
                          heightMode: "manual",
                        },
                },
              ]
            : [];
        }),
      );
    }
    if (!cancel && e && d.kind === "connect") {
      const target = canvasConnectionTarget(
        latest.current.data.nodes,
        point({ x: e.clientX, y: e.clientY }),
        view.zoom,
        d.ids[0],
      );
      if (target)
        command([
          {
            type: "add",
            edges: [
              {
                id: crypto.randomUUID(),
                fromNode: d.ids[0],
                fromSide: d.side,
                toNode: target.node.id,
                toSide: target.side,
                toEnd: "arrow",
              },
            ],
          },
        ]);
    }
    if (cancel) {
      setSelection(d.initial);
      setView(d.view);
    }
    drag.current = null;
    setDragPreview(null);
    setRectangle(null);
    setConnection(null);
    if (board.current?.hasPointerCapture(d.pointer))
      board.current.releasePointerCapture(d.pointer);
  };
  const bounds = canvasBounds(nodes),
    miniScale = Math.min(180 / (bounds.width || 1), 110 / (bounds.height || 1));
  const importCanvas = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 5_000_000)
        throw new Error("Choose a .canvas file smaller than 5 MB.");
      const imported = parseCanvas(await file.text()),
        ids = new Map(imported.nodes.map((n) => [n.id, crypto.randomUUID()]));
      const additions = imported.nodes.map((n) => ({
        ...n,
        id: ids.get(n.id)!,
        heightMode: "manual" as const,
      }));
      if (
        command([
          {
            type: "add",
            nodes: additions,
            edges: imported.edges.map((e) => ({
              ...e,
              id: crypto.randomUUID(),
              fromNode: ids.get(e.fromNode)!,
              toNode: ids.get(e.toNode)!,
            })),
          },
        ])
      ) {
        fit(additions);
        notify("Canvas imported as new cards. Existing cards are unchanged.");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <main className="canvas-studio">
      <header className="canvas-header">
        <WorkspaceLink
          className="button ghost"
          to={`/explorer?space=${project.space_id}${project.parent_id ? `&folder=${project.parent_id}` : ""}`}
        >
          ← Explorer
        </WorkspaceLink>
        <h1>{project.name}</h1>
        <span className="tool-spacer" />
        <button
          className="icon-button"
          title="Undo (⌘Z)"
          aria-label="Undo"
          disabled={shared.readOnly}
          onClick={() => undo.current?.undo()}
        >
          <Undo2 size={17} />
        </button>
        <button
          className="icon-button"
          title="Redo (⇧⌘Z)"
          aria-label="Redo"
          disabled={shared.readOnly}
          onClick={() => undo.current?.redo()}
        >
          <Redo2 size={17} />
        </button>
        <button
          className="icon-button"
          title="Import JSON Canvas"
          aria-label="Import JSON Canvas"
          disabled={shared.readOnly}
          onClick={() => importInput.current?.click()}
        >
          <Upload size={17} />
        </button>
        <input
          ref={importInput}
          hidden
          type="file"
          accept=".canvas,application/json"
          onChange={(e) => {
            void importCanvas(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          className="icon-button"
          title="Export canvas"
          aria-label="Export canvas"
          onClick={() => setExporting(true)}
        >
          <Download size={17} />
        </button>
        <button
          className="icon-button"
          title="Find cards"
          aria-label="Find cards"
          aria-pressed={panel === "cards"}
          onClick={() => setPanel(panel === "cards" ? null : "cards")}
        >
          <Search size={17} />
        </button>
        <button
          className="icon-button"
          title="Discussion"
          aria-label="Discussion"
          aria-pressed={panel === "discussion"}
          onClick={() => setPanel(panel === "discussion" ? null : "discussion")}
        >
          <MessageSquare size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="Properties"
          title="Properties"
          aria-pressed={panel === "properties"}
          onClick={() => setPanel(panel === "properties" ? null : "properties")}
        >
          <SlidersHorizontal size={17} />
        </button>
      </header>
      <ErrorNotice message={error || parsed.error || shared.error} />
      {shared.recovery !== null && (
        <div className="tool-recovery">
          <button
            className="button secondary"
            onClick={() => downloadText(shared.recovery!, "recovered.canvas")}
          >
            Export retained canvas
          </button>
          <button className="button ghost" onClick={shared.reopen}>
            Reopen server version
          </button>
        </div>
      )}
      <div className="canvas-layout">
        <div
          className={`canvas-board ${hand ? "is-hand" : ""}`}
          ref={board}
          tabIndex={0}
          role="region"
          aria-label="Collaborative canvas"
          style={
            {
              backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
              backgroundPosition: `${view.x}px ${view.y}px`,
              "--canvas-inverse-zoom": 1 / view.zoom,
            } as CSSProperties
          }
          onContextMenu={(e) => menu(e)}
          onPointerDown={(e) => {
            if (
              !(e.target as Element).closest(
                ".canvas-card,button,a,input,textarea,.canvas-edge-hit",
              )
            )
              start(e, "select");
          }}
          onPointerMove={move}
          onPointerUp={(e) => finish(e)}
          onPointerCancel={(e) => finish(e, true)}
          onLostPointerCapture={() => {
            if (drag.current) finish(undefined, true);
          }}
          onCopy={(e) => {
            if (
              (e.target as Element).closest(
                "input,textarea,[contenteditable=true]",
              )
            )
              return;
            if (!selected.length) return;
            e.preventDefault();
            e.clipboardData.setData(
              "text/plain",
              encodeCanvasClipboard(selectedCanvas(data, selection)),
            );
          }}
          onCut={(e) => {
            if (
              (e.target as Element).closest(
                "input,textarea,[contenteditable=true]",
              ) ||
              shared.readOnly ||
              !selected.length
            )
              return;
            e.preventDefault();
            e.clipboardData.setData(
              "text/plain",
              encodeCanvasClipboard(selectedCanvas(data, selection)),
            );
            remove();
          }}
          onPaste={(e) => {
            if (
              (e.target as Element).closest(
                "input,textarea,[contenteditable=true]",
              ) ||
              shared.readOnly
            )
              return;
            e.preventDefault();
            paste(e.clipboardData.getData("text/plain"));
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("application/x-axiom-resources"))
              e.preventDefault();
          }}
          onDrop={async (e) => {
            try {
              const ids = e.dataTransfer
                .getData("application/x-axiom-resources")
                .split(",")
                .filter((id) => /^[\da-f-]{36}$/i.test(id))
                .slice(0, 30);
              if (!ids.length) return;
              e.preventDefault();
              const at = point({ x: e.clientX, y: e.clientY });
              const items = await Promise.all(
                ids.map((id) => api<Resource>(`resources/${id}`)),
              );
              command([
                {
                  type: "add",
                  nodes: items
                    .slice(0, 30)
                    .filter((r: Resource) => r.kind !== "folder")
                    .map((r: Resource, i: number) => ({
                      id: crypto.randomUUID(),
                      type: "file",
                      file: r.name,
                      resourceId: r.id,
                      heightMode: "auto",
                      x: at.x + i * 30,
                      y: at.y + i * 30,
                      width: 320,
                      height: 220,
                    })),
                },
              ]);
            } catch {
              setError("These items cannot be added to this canvas.");
            }
          }}
          onKeyDown={(e) => {
            if (
              (e.target as Element).closest(
                "textarea,input,button,a,select,[contenteditable=true]",
              )
            )
              return;
            if (e.key === "Escape") {
              e.preventDefault();
              if (drag.current) finish(undefined, true);
              else {
                setSelection([]);
                setEditing(null);
              }
            } else if (e.key === " ") {
              e.preventDefault();
              spaceHeld.current = true;
            } else if (
              (e.metaKey || e.ctrlKey) &&
              e.key.toLowerCase() === "z"
            ) {
              e.preventDefault();
              if (!shared.readOnly) {
                if (e.shiftKey) undo.current?.redo();
                else undo.current?.undo();
              }
            } else if (
              (e.metaKey || e.ctrlKey) &&
              e.key.toLowerCase() === "a"
            ) {
              e.preventDefault();
              setSelection(nodes.map((n) => n.id));
            } else if (
              (e.metaKey || e.ctrlKey) &&
              e.key.toLowerCase() === "d"
            ) {
              e.preventDefault();
              duplicate();
            } else if (["Backspace", "Delete"].includes(e.key)) {
              e.preventDefault();
              remove();
            } else if (
              e.key === "F2" &&
              selected.length === 1 &&
              !shared.readOnly
            ) {
              e.preventDefault();
              setRenaming(selected[0].id);
            } else if (e.key === "F10" && e.shiftKey) {
              e.preventDefault();
              const rect = board.current!.getBoundingClientRect();
              menu(
                {
                  preventDefault() {},
                  stopPropagation() {},
                  clientX: rect.left + rect.width / 2,
                  clientY: rect.top + rect.height / 2,
                } as React.MouseEvent,
                selected[0],
              );
            } else if (e.key === "Enter" && selected.length === 1) {
              e.preventDefault();
              setEditing(selected[0].id);
            } else if (e.key === "0") fit();
            else if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey)
              add("text");
            else if (e.key.startsWith("Arrow") && selected.length) {
              e.preventDefault();
              const amount = e.shiftKey ? 20 : 1;
              command(
                selected
                  .filter((n) => !n.locked)
                  .map((n) => ({
                    type: "update-node",
                    id: n.id,
                    changes: {
                      x:
                        n.x +
                        (e.key === "ArrowRight"
                          ? amount
                          : e.key === "ArrowLeft"
                            ? -amount
                            : 0),
                      y:
                        n.y +
                        (e.key === "ArrowDown"
                          ? amount
                          : e.key === "ArrowUp"
                            ? -amount
                            : 0),
                    },
                  })),
                false,
              );
            }
          }}
        >
          <div
            className="canvas-world"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            }}
          >
            <svg className="canvas-edges" width="1" height="1">
              <defs>
                <marker
                  id={`arrow-${project.resource_id}`}
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0 L8 4 L0 8" fill="context-stroke" />
                </marker>
              </defs>
              {data.edges.map((edge) => {
                const from = nodeMap.get(edge.fromNode),
                  to = nodeMap.get(edge.toNode);
                if (!from || !to) return null;
                const { d, label } = canvasEdgeGeometry(
                  from,
                  to,
                  edge.fromSide,
                  edge.toSide,
                );
                return (
                  <g
                    key={edge.id}
                    className={selection.includes(edge.id) ? "is-selected" : ""}
                    style={{
                      color: canvasColors[edge.color ?? ""] ?? edge.color,
                    }}
                  >
                    <path
                      className="canvas-edge-line"
                      d={d}
                      markerEnd={
                        edge.toEnd !== "none"
                          ? `url(#arrow-${project.resource_id})`
                          : undefined
                      }
                      markerStart={
                        edge.fromEnd === "arrow"
                          ? `url(#arrow-${project.resource_id})`
                          : undefined
                      }
                    />
                    <path
                      className="canvas-edge-hit"
                      d={d}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelection([edge.id]);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setSelection([edge.id]);
                        setPanel("properties");
                      }}
                      onContextMenu={(e) => {
                        setSelection([edge.id]);
                        e.preventDefault();
                        e.stopPropagation();
                        openContextMenu({
                          owner: board.current!,
                          x: e.clientX,
                          y: e.clientY,
                          label: "Connection actions",
                          items: [
                            {
                              label: "Connection properties",
                              icon: "info",
                              group: "Connection",
                              action: () => {
                                setSelection([edge.id]);
                                setPanel("properties");
                              },
                            },
                            {
                              label: "Reverse direction",
                              icon: "move",
                              disabled: shared.readOnly,
                              action: () =>
                                command([
                                  {
                                    type: "update-edge",
                                    id: edge.id,
                                    changes: {
                                      fromNode: edge.toNode,
                                      fromSide: edge.toSide ?? "left",
                                      toNode: edge.fromNode,
                                      toSide: edge.fromSide ?? "right",
                                    },
                                  },
                                ]),
                            },
                            {
                              label: "Remove connection",
                              icon: "trash",
                              group: "Edit",
                              tone: "danger",
                              disabled: shared.readOnly,
                              action: () =>
                                command([{ type: "remove", ids: [edge.id] }]),
                            },
                          ],
                        });
                      }}
                    />
                    <text x={label.x} y={label.y - 10}>
                      {edge.label}
                    </text>
                  </g>
                );
              })}
              {connection &&
                (() => {
                  const n = nodes.find((n) => n.id === connection.from);
                  return n ? (
                    <path
                      className="canvas-edge-line is-draft"
                      d={canvasCurve(
                        canvasPort(n, connection.side),
                        connection.to,
                        connection.side,
                      )}
                    />
                  ) : null;
                })()}
            </svg>
            {[
              ...visibleNodes.filter((n) => n.type === "group"),
              ...visibleNodes.filter((n) => n.type !== "group"),
            ].map((node) => (
              <article
                key={node.id}
                className={`canvas-card canvas-${node.type} ${selection.includes(node.id) ? "is-selected" : ""} ${editing === node.id ? "is-editing" : ""} ${connection?.target?.id === node.id ? "is-connection-target" : ""}`}
                data-canvas-node={node.id}
                style={
                  {
                    left: node.x,
                    top: node.y,
                    width: node.width,
                    height: node.height,
                    "--card-color":
                      canvasColors[node.color ?? ""] ??
                      node.color ??
                      "var(--border)",
                  } as CSSProperties
                }
                onPointerDown={(e) => start(e, "move", node)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (node.type === "group") {
                    if (!shared.readOnly) setRenaming(node.id);
                  } else if (node.type !== "text" || !shared.readOnly)
                    setEditing(node.id);
                }}
                onContextMenu={(e) => menu(e, node)}
              >
                <CanvasCardContents
                  node={node}
                  text={
                    (
                      shared.document?.getMap("canvas").get("nodes") as
                        Y.Map<Y.Map<unknown>> | undefined
                    )
                      ?.get(node.id)
                      ?.get("text") as Y.Text | undefined
                  }
                  active={editing === node.id}
                  parentId={project.resource_id}
                  sizingOwner={ownsSizing(node.id)}
                  height={resizeAutomatically}
                  resolved={(preview) => {
                    if ((previewData.current.get(node.id) ?? null) === preview)
                      return;
                    if (preview) previewData.current.set(node.id, preview);
                    else previewData.current.delete(node.id);
                    refreshPreviews((value) => value + 1);
                  }}
                  renaming={renaming === node.id}
                  rename={(title) => {
                    const ok = updateNode(node.id, {
                      title,
                      ...(node.type === "group" ? { label: title } : {}),
                    });
                    if (ok) setRenaming(null);
                    return ok;
                  }}
                  cancelRename={() => setRenaming(null)}
                  menu={(event) => menu(event, node)}
                  undo={undo.current}
                  awareness={shared.awareness}
                  readOnly={shared.readOnly}
                  activate={() => {
                    setSelection([node.id]);
                    setEditing(node.id);
                  }}
                  done={() => {
                    setEditing(null);
                    board.current?.focus();
                  }}
                />
                {!shared.readOnly &&
                  sides.map((side) => (
                    <button
                      key={side}
                      className={`canvas-port port-${side} ${connection?.target?.id === node.id && connection.target.side === side ? "is-target" : ""}`}
                      data-canvas-side={side}
                      title={`Connect from ${side}`}
                      aria-label={`Connect from ${side}`}
                      onPointerDown={(e) => start(e, "connect", node, side)}
                    />
                  ))}
                {!shared.readOnly &&
                  !node.locked &&
                  selection.includes(node.id) && (
                    <button
                      className="canvas-resize"
                      aria-label="Resize card"
                      title="Drag to resize"
                      onPointerDown={(e) => start(e, "resize", node)}
                    />
                  )}
              </article>
            ))}
            {rectangle && (
              <div
                className="canvas-marquee"
                style={{
                  left: rectangle.x,
                  top: rectangle.y,
                  width: rectangle.width,
                  height: rectangle.height,
                }}
              />
            )}
            {peers.map((p) => (
              <div
                key={p.id}
                className="canvas-peer"
                style={{ left: p.x, top: p.y, color: p.color }}
              >
                <MousePointer2 size={17} />
                <span style={{ background: p.color }}>{p.name}</span>
              </div>
            ))}
          </div>
          {!data.nodes.length && (
            <div className="canvas-empty">
              <Group size={40} strokeWidth={1} />
              <h2>Space to connect your ideas</h2>
              <p>
                Use the text-card button or press N to write. Drag between card
                ports to connect ideas.
              </p>
              <p>
                Scroll to pan · ⌘/Ctrl + scroll to zoom · hold Space to move
                around
              </p>
            </div>
          )}
          <div className="canvas-dock" role="toolbar" aria-label="Canvas tools">
            <button
              className="icon-button"
              title="Select"
              aria-label="Select"
              aria-pressed={!hand}
              onClick={() => setHand(false)}
            >
              <MousePointer2 size={20} />
            </button>
            <button
              className="icon-button"
              title="Pan (hold Space)"
              aria-label="Pan"
              aria-pressed={hand}
              onClick={() => setHand(true)}
            >
              <Hand size={20} />
            </button>
            <span className="canvas-dock-separator" />
            <button
              className="icon-button"
              title="Text card (N)"
              aria-label="Add text card"
              disabled={shared.readOnly}
              onClick={() => add("text")}
            >
              <StickyNote size={20} />
            </button>
            <button
              className="icon-button"
              title="File card"
              aria-label="Add file card"
              disabled={shared.readOnly}
              onClick={() => setPicker(true)}
            >
              <FilePlus2 size={20} />
            </button>
            <button
              className="icon-button"
              title="Web link"
              aria-label="Add web link"
              disabled={shared.readOnly}
              onClick={() => add("link")}
            >
              <Link2 size={20} />
            </button>
            <button
              className="icon-button"
              title={selected.length ? "Group selection" : "Add group"}
              aria-label="Add group"
              disabled={shared.readOnly}
              onClick={() =>
                selected.length ? groupSelection() : add("group")
              }
            >
              <Group size={20} />
            </button>
            <button
              className="icon-button"
              aria-label="Research templates"
              title="Research templates"
              disabled={shared.readOnly}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                openContextMenu({
                  owner: board.current!,
                  x: r.left,
                  y: r.top,
                  label: "Research templates",
                  items: canvasTemplates.map((template) => ({
                    label: template.title,
                    icon: "newNote",
                    action: () => add("text", undefined, template),
                  })),
                });
              }}
            >
              <LayoutTemplate size={20} />
            </button>
            <button
              className="icon-button"
              aria-label="Snap to grid"
              title="Snap to grid"
              aria-pressed={snap}
              onClick={() => setSnap(!snap)}
            >
              <Grid2X2 size={18} />
            </button>
          </div>
          {!!selection.length && (
            <div
              className="canvas-selection-bar"
              role="toolbar"
              aria-label="Selected card actions"
            >
              {Object.entries(canvasColors).map(([key, color]) => (
                <button
                  key={key}
                  className="canvas-swatch"
                  title={`Color ${key}`}
                  aria-label={`Color ${key}`}
                  disabled={shared.readOnly}
                  style={{ background: color }}
                  onClick={() =>
                    command([
                      ...selected.map((n) => ({
                        type: "update-node" as const,
                        id: n.id,
                        changes: { color: key },
                      })),
                      ...(selectedEdge
                        ? [
                            {
                              type: "update-edge" as const,
                              id: selectedEdge.id,
                              changes: { color: key },
                            },
                          ]
                        : []),
                    ])
                  }
                />
              ))}
              {selectedEdge && (
                <input
                  aria-label="Connection label"
                  placeholder="Connection label"
                  maxLength={1000}
                  value={selectedEdge.label ?? ""}
                  disabled={shared.readOnly}
                  onChange={(e) =>
                    command(
                      [
                        {
                          type: "update-edge",
                          id: selectedEdge.id,
                          changes: { label: e.target.value },
                        },
                      ],
                      false,
                    )
                  }
                />
              )}
              <button
                className="icon-button"
                title="Duplicate selection (⌘D)"
                aria-label="Duplicate selection"
                disabled={shared.readOnly || !selected.length}
                onClick={() => duplicate()}
              >
                <Plus size={16} />
              </button>
              <button
                className="icon-button"
                title="Remove selection"
                aria-label="Remove selection"
                disabled={shared.readOnly}
                onClick={remove}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="canvas-navigation">
            <svg
              viewBox="0 0 200 130"
              role="img"
              aria-label="Canvas overview"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect(),
                  x =
                    bounds.x +
                    (((e.clientX - r.left) / r.width) * 200 - 10) / miniScale,
                  y =
                    bounds.y +
                    (((e.clientY - r.top) / r.height) * 130 - 10) / miniScale,
                  b = board.current!.getBoundingClientRect();
                setView((v) => ({
                  ...v,
                  x: b.width / 2 - x * v.zoom,
                  y: b.height / 2 - y * v.zoom,
                }));
              }}
            >
              {nodes.map((n) => (
                <rect
                  key={n.id}
                  x={10 + (n.x - bounds.x) * miniScale}
                  y={10 + (n.y - bounds.y) * miniScale}
                  width={Math.max(2, n.width * miniScale)}
                  height={Math.max(2, n.height * miniScale)}
                  fill={
                    canvasColors[n.color ?? ""] ?? n.color ?? "currentColor"
                  }
                  opacity={n.type === "group" ? 0.12 : 0.55}
                />
              ))}
            </svg>
            <div>
              <button
                className="icon-button"
                aria-label="Zoom out"
                title="Zoom out"
                onClick={() =>
                  setView((v) => ({ ...v, zoom: clamp(v.zoom / 1.2, 0.08, 3) }))
                }
              >
                <Minus size={15} />
              </button>
              <span>{Math.round(view.zoom * 100)}%</span>
              <button
                className="icon-button"
                aria-label="Zoom in"
                title="Zoom in"
                onClick={() =>
                  setView((v) => ({ ...v, zoom: clamp(v.zoom * 1.2, 0.08, 3) }))
                }
              >
                <Plus size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="Zoom to fit"
                title="Zoom to fit (0)"
                onClick={() => fit()}
              >
                <Maximize size={15} />
              </button>
            </div>
          </div>
        </div>
        {panel && (
          <aside className="canvas-inspector">
            <header>
              <h2>
                {panel === "discussion"
                  ? "Discussion"
                  : panel === "properties"
                    ? "Properties"
                    : "Find cards"}
              </h2>
              <button
                className="icon-button"
                aria-label="Close panel"
                onClick={() => setPanel(null)}
              >
                <X size={16} />
              </button>
            </header>
            {panel === "discussion" ? (
              <>
                <select
                  aria-label="Discussion scope"
                  value={commentCard ?? ""}
                  onChange={(e) => setCommentCard(e.target.value || null)}
                >
                  <option value="">Whole canvas</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {canvasTitle(n)}
                    </option>
                  ))}
                  {commentCard && !nodeMap.has(commentCard) && (
                    <option value={commentCard}>Removed card</option>
                  )}
                </select>
                <ResourceDiscussion
                  key={commentCard ?? "whole"}
                  resourceId={project.resource_id}
                  canComment={project.role !== "viewer"}
                  fixedAnchor={
                    commentCard
                      ? { kind: "canvas-node", nodeId: commentCard }
                      : undefined
                  }
                  anchorLabel={(anchor) =>
                    anchor.kind === "canvas-node"
                      ? nodeMap.has(String(anchor.nodeId))
                        ? canvasTitle(nodeMap.get(String(anchor.nodeId))!)
                        : "Removed card"
                      : "Whole canvas"
                  }
                  onAnchor={(anchor) => {
                    const node = nodeMap.get(String(anchor.nodeId));
                    if (node) {
                      setSelection([node.id]);
                      fit([node]);
                    }
                  }}
                />
              </>
            ) : panel === "properties" ? (
              <CanvasProperties
                key={selected[0]?.id ?? selectedEdge?.id ?? "empty"}
                node={selected.length === 1 ? selected[0] : undefined}
                edge={selectedEdge}
                data={data}
                readOnly={shared.readOnly}
                preview={
                  selected.length === 1
                    ? previewData.current.get(selected[0].id)
                    : undefined
                }
                updateNode={(changes) =>
                  selected.length === 1 && updateNode(selected[0].id, changes)
                }
                updateEdge={(changes) =>
                  !!selectedEdge &&
                  command([
                    { type: "update-edge", id: selectedEdge.id, changes },
                  ])
                }
                changeFile={() => {
                  setReplaceFile(selected[0].id);
                  setPicker(true);
                }}
                fitGroup={() => {
                  const group = selected[0];
                  if (!group || group.type !== "group" || group.locked) return;
                  const children = data.nodes.filter(
                    (n) =>
                      n.id !== group.id &&
                      n.x >= group.x &&
                      n.y >= group.y &&
                      n.x + n.width <= group.x + group.width &&
                      n.y + n.height <= group.y + group.height,
                  );
                  if (!children.length) {
                    notify("This group has no contained cards to fit around.");
                    return;
                  }
                  const b = canvasBounds(children);
                  updateNode(group.id, {
                    x: b.x - 24,
                    y: b.y - 48,
                    width: b.width + 48,
                    height: b.height + 72,
                  });
                }}
              />
            ) : (
              <>
                <input
                  aria-label="Search cards"
                  placeholder="Names, content, tags…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Card type"
                  value={cardType}
                  onChange={(e) => setCardType(e.target.value)}
                >
                  {["all", "text", "file", "link", "group"].map((type) => (
                    <option key={type} value={type}>
                      {type === "all" ? "All card types" : type}
                    </option>
                  ))}
                </select>
                {nodes
                  .filter(
                    (n) =>
                      (cardType === "all" || n.type === cardType) &&
                      (
                        `${canvasTitle(n)} ${(n.tags ?? []).join(" ")} ` +
                        (n.type === "text"
                          ? n.text
                          : n.type === "group"
                            ? (n.label ?? "")
                            : n.type === "file"
                              ? n.file
                              : n.url)
                      )
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  )
                  .map((n) => (
                    <button
                      key={n.id}
                      className="canvas-card-result"
                      onClick={() => {
                        setSelection([n.id]);
                        fit([n]);
                      }}
                    >
                      <span>{canvasTitle(n)}</span>
                      <small>
                        {n.type}
                        {n.tags?.length ? ` · ${n.tags.join(", ")}` : ""}
                      </small>
                    </button>
                  ))}
              </>
            )}
          </aside>
        )}
      </div>
      <footer className="canvas-status">
        <span className="canvas-save-state">
          <span role="status">{shared.status}</span>
          {!shared.recovery &&
            /offline|unavailable|interrupted|Connecting/.test(
              shared.status,
            ) && (
              <button
                className="icon-button"
                aria-label="Reconnect canvas"
                title="Reconnect without discarding local work"
                onClick={shared.reconnect}
              >
                <RefreshCw size={13} />
              </button>
            )}
        </span>
        <span>
          {data.nodes.length} cards · {data.edges.length} connections
          {selection.length ? ` · ${selection.length} selected` : ""}
        </span>
        <span>
          {shared.readOnly ? "Read only" : "Collaborative canvas"}
          {peers.length ? ` · ${peers.length + 1} here` : ""}
        </span>
      </footer>
      {exporting && (
        <CanvasExportDialog
          source={data}
          selection={selection}
          viewport={{
            x: -view.x / view.zoom,
            y: -view.y / view.zoom,
            width: boardSize.width / view.zoom,
            height: boardSize.height / view.zoom,
          }}
          resourceId={project.resource_id}
          spaceId={project.space_id}
          name={project.name}
          onClose={() => setExporting(false)}
        />
      )}
      {picker && (
        <Dialog
          title={replaceFile ? "Change linked file" : "Add a workspace file"}
          onClose={() => {
            setPicker(false);
            setReplaceFile(null);
          }}
        >
          <p className="ws-note">
            Cards follow the latest resource by default. You can pin a saved
            file version in Properties. Every preview checks access again.
          </p>
          <input
            autoFocus
            aria-label="Search files"
            placeholder="Find a note, figure, or paper…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ErrorNotice message={resources.error} />
          {resources.loading ? (
            <Loading />
          ) : (
            resources.data?.items
              .filter(
                (r) => r.kind !== "folder" && r.id !== project.resource_id,
              )
              .map((r) => (
                <button
                  className="canvas-file-result"
                  key={r.id}
                  onClick={() => {
                    if (replaceFile) {
                      if (
                        updateNode(replaceFile, {
                          resourceId: r.id,
                          file: r.name,
                          versionId: undefined,
                        })
                      ) {
                        previewData.current.delete(replaceFile);
                        setReplaceFile(null);
                        setPicker(false);
                      }
                      return;
                    }
                    const at = center();
                    if (
                      command([
                        {
                          type: "add",
                          nodes: [
                            {
                              id: crypto.randomUUID(),
                              type: "file",
                              file: r.name,
                              resourceId: r.id,
                              heightMode: "auto",
                              x: Math.round(at.x - 160),
                              y: Math.round(at.y - 110),
                              width: 320,
                              height: 220,
                            },
                          ],
                        },
                      ])
                    )
                      setPicker(false);
                  }}
                >
                  <ResourceIcon resource={r} />
                  {r.name}
                </button>
              ))
          )}
        </Dialog>
      )}
    </main>
  );
}
