import {
  readingBlocks,
  readingBlockTypes,
  type ReadingBlockRect,
} from "@axiom/editor/reading-marks";
import {
  MarkdownEngine,
  adoptMarkdownCommandDocument,
  nodeAt,
  sourceCommand,
  tableModel,
  tableAction,
  parseTSV,
  writeTSV,
  escapeCell,
  minimalChange,
  renderDocument,
  documentIndex,
  sectionNumberAttributes,
  escapeHtml,
  safeUrl,
  plainText,
  type MarkdownNode,
  type ParsedDocument,
  type SourceEdit,
  type TextChange,
  sourceLine,
  containerText,
  footnoteDefinitionAt,
  footnoteBody,
  footnoteCommand,
  paragraphBesideBlock,
} from "@axiom/markdown";
import {
  commandById,
  editorCommands,
  eventBinding,
  keysFor,
  shortcutPlatform,
  type EditorCommandId,
} from "@axiom/shared/editor";
import { type NativeBinding, type PeerSelection } from "@axiom/editor/binding";
import { compareRelativePositions } from "yjs";
import {
  applyChanges,
  clampSelection,
  enterEdit,
  replacement,
  selectionRange,
  graphemeBoundary,
  indentList,
  codeLineEdit,
  lineAt,
  mapPosition,
  type SourceSelection,
  type NativeTransaction,
} from "@axiom/editor/transactions";
import {
  boundaryDelete,
  rangeDelete,
  unwrapBlock,
  emptyBlockDelete,
} from "@axiom/editor/deletion";
import { literalBody, literalPrefix } from "@axiom/editor/literal";
import { OwnedPairs, pairedInput } from "@axiom/editor/pairs";
import {
  codeFenceQuery,
  codeLanguageSuggestions,
} from "@axiom/editor/code-languages";
import { preserveLineEndings } from "@axiom/editor/line-endings";
import { footnoteAt, footnoteInput } from "@axiom/editor/footnotes";
import { quoteBodyEdit, quoteBodyDelete } from "@axiom/editor/quote-prose";
import { listBodyEdit, listBodyDelete } from "@axiom/editor/list-prose";
import {
  bookmarkTable,
  resolveTable,
  type TableTarget,
} from "@axiom/editor/table-target";
import { projectMarkdown, type Projection } from "@axiom/editor/projection";
import {
  bridgeTransaction,
  bridgeComposition,
  draftSource,
} from "@axiom/editor/bridge";
import { RichSurface } from "@axiom/editor/rich-surface";
import {
  TextSurface,
  type TextSurfaceOptions,
  type TextMarker,
} from "@axiom/editor/text-surface";
import { type Node as ProseNode, type Schema } from "@milkdown/kit/prose/model";
import { type Transaction } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type NodeView,
} from "@milkdown/kit/prose/view";
import { openContextMenu, type ContextAction } from "../context-menu";
import { editorCommandIcons } from "../icons/editor-commands";
import { appendActionLabel } from "../icons/actions";
import { claimEditorOverlay } from "../editor-popover";
import { footnoteTooltips, paintFootnoteReference } from "../footnote-tooltips";
import { installEditorLinkNavigation } from "../editor-links";
import { FindPanel } from "./find";
import { DiagramPreviews } from "./diagrams";
import { sourceFields, type EditorField } from "./fields";
import { iconButton, disableIcon } from "./chrome";
import { languageMenu, languageOption } from "./language-menu";
import { mathSymbolIcon } from "../icons/math-symbols";
import { ImageView, type ImageCacheEntry } from "./image-view";
import { ImageSourceSession } from "./image-source";
import { tablePanel, type TablePanelState } from "./table-panel";
import { paintMathPreview } from "./math-preview";
import { MetadataView } from "./metadata-view";
import { BlockFolds } from "@axiom/editor/folding";
import { FoldingGutter } from "./folding-gutter";
import {
  NavigationIndex,
  type EditorNavigationState,
  type NavigationBlock,
  type NavigationPosition,
} from "@axiom/editor/minimap";
import type { ProjectedBlock } from "@axiom/editor/projection";
import {
  editingProjection,
  EditingSession,
  isDraftHeader,
} from "../native-editor/projection";
import {
  nativeCompletions,
  type NativeCompletion,
} from "../native-editor/completions";
import { htmlMarkdown, htmlTableGrid } from "../native-editor/clipboard";
import type {
  NativeEditorOptions,
  CommandArguments,
} from "../native-editor/view";

type Composition = {
  projection: Projection;
  positions: Map<number, ReturnType<NativeBinding["relative"]>>;
  container: ReturnType<NativeBinding["relative"]>;
  containerLength: number;
  replacement?: { from: number; to: number };
};
type TextComposition = {
  source: string;
  draft: string;
  positions: Map<number, ReturnType<NativeBinding["relative"]>>;
  container: ReturnType<NativeBinding["relative"]>;
  containerLength: number;
};
type CellRange = {
  table: number;
  row: number;
  column: number;
  endRow: number;
  endColumn: number;
};
type Completion = NativeCompletion & {
  language?: boolean;
  query?: string;
};

/** Application adapter. Y.Text, permissions, durable-save acknowledgements,
 * comments and presence still belong to Editor.tsx, not either upstream editor. */
export class AxiomEditorView {
  readonly dom = document.createElement("div");
  readonly content = document.createElement("div");
  readonly engine = new MarkdownEngine();
  readonly options: NativeEditorOptions;
  readonly binding: NativeBinding;
  private rich: RichSurface | null = null;
  private sourceView: TextSurface | null = null;
  private embedded = new Set<EmbeddedView>();
  private metadata = new Set<MetadataView>();
  private tables = new Set<TableView>();
  private tablePanel: ReturnType<typeof tablePanel> | null = null;
  private projection: Projection | null = null;
  private folds = new BlockFolds();
  private printing = false;
  private folding = new FoldingGutter(this.content, (block) =>
    this.toggleFold(block),
  );
  private editing: EditingSession;
  private pairs: OwnedPairs;
  private label = "Markdown editor";
  private testId = "note-editor";
  private find: FindPanel | null = null;
  private unsubscribe: () => void;
  private unpresence: () => void;
  private abort = new AbortController();
  private generation = 0;
  private navigationRevision = 0;
  private destroyed = false;
  private footnotePreviews: ReturnType<typeof footnoteTooltips>;
  private footnoteDraft: ReturnType<NativeBinding["relative"]> | null = null;
  private mode = "";
  private focused = false;
  private composing: Composition | null = null;
  private cmComposing = false;
  private textComposition: TextComposition | null = null;
  private dragging = false;
  // Deltas since the current DOM projection. Pointer selection can still be
  // using that older DOM while incoming Yjs edits are deliberately not painted.
  private projectionChanges: TextChange[][] = [];
  private peers: PeerSelection[] = [];
  private menu: (() => void) | null = null;
  private popup: HTMLElement | null = null;
  private releaseCompletionOverlay: (() => void) | null = null;
  private completionInput: {
    element: HTMLElement;
    controls: string | null;
    active: string | null;
  } | null = null;
  private choices: Completion[] = [];
  private choice = 0;
  private popupFrame = 0;
  private diagrams = new DiagramPreviews();
  private inlineRefresh = new Set<() => void>();
  private projecting = false;
  private imagePool: ImageCacheEntry[] = [];
  private previewNodes = new WeakMap<
    HTMLElement,
    () => MarkdownNode | undefined
  >();
  private references = document.createElement("div");
  private referenceHTML = "";
  private contextRevision = 0;
  private previewMemo: {
    parsed: ParsedDocument;
    revision: number;
    key: string;
  } | null = null;
  private fields: ReturnType<typeof sourceFields> | null = null;
  private imageSource: {
    session: ImageSourceSession;
    preview: ImageView | null;
  } | null = null;
  private dismissedQuery = "";
  private cellRange: CellRange | null = null;
  private cellHint: {
    tableFrom: number;
    row: number;
    column: number;
    at: number;
  } | null = null;
  private snippet: ReturnType<NativeBinding["relative"]>[] = [];
  private snippetIndex = 0;
  selection: SourceSelection;
  source: string;
  parsed;
  ready: Promise<void> = Promise.resolve();

  constructor(
    parent: HTMLElement,
    binding: NativeBinding,
    options: NativeEditorOptions,
  ) {
    this.options = options;
    this.binding = binding;
    this.source = binding.source;
    this.selection = binding.selection();
    this.parsed = this.engine.parse(this.source);
    this.editing = new EditingSession(binding);
    this.pairs = new OwnedPairs(binding);
    this.dom.className = "axiom-editor";
    this.dom.dataset.engine = "milkdown";
    this.content.className = "axiom-editor-content";
    this.dom.append(this.content);
    parent.append(this.dom);
    this.footnotePreviews = footnoteTooltips({
      root: this.dom,
      document: () => this.parsed,
      context: () => this.options.context(),
    });
    const signal = this.abort.signal;
    window.addEventListener(
      "beforeprint",
      () => {
        this.printing = true;
        this.refresh(false);
      },
      { signal },
    );
    window.addEventListener(
      "afterprint",
      () => {
        this.printing = false;
        this.refresh(false);
      },
      { signal },
    );
    let contextPress: EventTarget | null = null;
    // A secondary press inspects content; it never starts text selection.
    for (const type of ["pointerdown", "mousedown"])
      this.dom.addEventListener(
        type,
        (event) => {
          const mouse = event as MouseEvent;
          const secondary =
            mouse.button === 2 ||
            (mouse.button === 0 &&
              mouse.ctrlKey &&
              shortcutPlatform() === "mac");
          contextPress = secondary && mouse.button === 0 ? event.target : null;
          if (
            !secondary ||
            (event.target as Element).closest("input, .cm-search")
          )
            return;
          event.preventDefault();
          this.dragging = false;
        },
        { signal, capture: true },
      );
    // Preventing pointerdown can suppress mouseup/contextmenu in Firefox.
    // Handle pointerup too, without taking over modifier-link navigation.
    for (const type of ["pointerup", "mouseup"])
      this.dom.addEventListener(
        type,
        (event) => {
          const mouse = event as MouseEvent;
          const pressed = contextPress;
          contextPress = null;
          if (
            pressed === event.target &&
            mouse.button === 0 &&
            mouse.ctrlKey &&
            shortcutPlatform() === "mac" &&
            !this.menu &&
            this.linkTarget(mouse) === null
          )
            this.contextMenu(mouse);
        },
        { signal, capture: true },
      );
    const cancelDrag = () => {
      contextPress = null;
      if (!this.dragging) return;
      this.dragging = false;
      this.refresh(false);
    };
    document.addEventListener("pointercancel", cancelDrag, { signal });
    window.addEventListener("blur", cancelDrag, { signal });
    this.dom.addEventListener(
      "contextmenu",
      (event) => this.contextMenu(event),
      { signal },
    );
    this.dom.addEventListener(
      "focusin",
      (event) => {
        if ((event.target as Element).closest("[data-editor-fold]")) {
          this.focused = false;
          this.binding.blur();
          return;
        }
        // Focusing a task control does not start editing the remembered prose.
        if (
          (event.target as Element).matches(
            'input[type="checkbox"][data-editor-chrome]',
          )
        )
          return;
        this.focused = true;
      },
      { signal },
    );
    this.dom.addEventListener(
      "focusout",
      () => {
        queueMicrotask(() => {
          if (
            this.destroyed ||
            this.dom.contains(document.activeElement) ||
            this.popup?.contains(document.activeElement) ||
            this.menu ||
            this.fields
          )
            return;
          this.focused = false;
          this.binding.blur();
          if (!this.composing && !this.cmComposing) this.refresh(false);
        });
      },
      { signal },
    );
    installEditorLinkNavigation(
      this.dom,
      (event) => this.linkTarget(event),
      (target) => {
        if (!target.startsWith("#") || !this.followAnchor(target))
          this.options.link(target);
      },
      signal,
    );
    this.dom.addEventListener(
      "click",
      (event) => {
        const anchor = (event.target as Element).closest<HTMLAnchorElement>(
          "a[href]",
        );
        if (
          anchor &&
          (anchor.getAttribute("href")?.startsWith("#") || this.mode === "read")
        ) {
          const href = anchor.getAttribute("href")!;
          if (href.startsWith("#")) {
            if (this.followAnchor(href)) {
              event.preventDefault();
              return;
            }
          } else if (safeUrl(href)) {
            event.preventDefault();
            this.options.link(anchor.dataset.noteTarget ?? href);
            return;
          }
        }
        const annotation = (event.target as Element).closest<HTMLElement>(
          "[data-discussion-id]",
        );
        if (annotation)
          this.options.annotation?.(annotation.dataset.discussionId!);
      },
      { signal },
    );
    document.addEventListener(
      "pointerup",
      () => {
        if (this.dragging) {
          // Native selectionchange may arrive after pointerup. Capture the
          // browser's completed selection before revealing prose; refreshing
          // the old selection here can move both the layout and the caret.
          const selected = document.getSelection();
          const view = this.rich?.view;
          if (
            view &&
            selected?.anchorNode &&
            selected.focusNode &&
            view.dom.contains(selected.anchorNode) &&
            view.dom.contains(selected.focusNode) &&
            !this.composing
          )
            this.capture(
              view.posAtDOM(selected.anchorNode, selected.anchorOffset),
              view.posAtDOM(selected.focusNode, selected.focusOffset),
            );
          this.dragging = false;
          this.refresh(false);
        }
      },
      { signal },
    );
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (
          !this.dom.contains(event.target as Node) &&
          !this.popup?.contains(event.target as Node)
        )
          this.closePopup();
      },
      { signal },
    );
    this.unsubscribe = binding.subscribe(
      (source, selection, local, changes) => {
        this.folds.changed(changes);
        if (
          this.imageSource &&
          !this.imageSource.session.changed(changes, local)
        )
          this.closeImageSource();
        if (this.dragging && this.projection && changes.length)
          this.projectionChanges.push(changes);
        this.cellHint = null;
        if (!local) this.cellRange = null;
        if (!local) this.pairs.beforeChange(changes, true);
        this.pairs.rebase();
        this.source = source;
        this.selection = selection;
        this.parsed = this.engine.parse(source);
        this.folds.reconcile(source, this.parsed);
        if (local && this.focused) this.folds.reveal(selection);
        this.footnotePreviews.refresh();
        adoptMarkdownCommandDocument(source, this.parsed);
        options.changed(source, this.parsed);
        this.find?.update();
        if (!this.composing && !this.cmComposing && !this.dragging)
          this.refresh(local && this.focused, !local);
      },
    );
    this.unpresence = binding.onPresence((peers) => {
      this.peers = peers;
      this.paintPresence();
    });
    this.configure();
    options.changed(this.source, this.parsed);
    this.dom.addEventListener("scroll", () => this.positionPopup(), {
      signal,
      capture: true,
      passive: true,
    });
    window.addEventListener(
      "scroll",
      () => {
        this.positionPopup();
      },
      {
        signal,
        capture: true,
        passive: true,
      },
    );
    window.addEventListener(
      "resize",
      () => {
        this.positionPopup();
      },
      {
        signal,
        passive: true,
      },
    );
  }
  get scrollDOM() {
    return (
      this.dom.closest<HTMLElement>(".document-scroll") ??
      this.sourceView?.view.scrollDOM ??
      this.dom
    );
  }
  get hasFocus() {
    return this.dom.contains(document.activeElement);
  }
  setLabel(label: string, testId = this.testId) {
    this.label = label;
    this.testId = testId;
    this.rich?.view.setProps({
      attributes: {
        "data-testid": testId,
        "aria-label": label,
        spellcheck: "true",
        class: "axiom-prose",
      },
    });
    for (const element of [
      this.rich?.view.dom,
      this.sourceView?.view.contentDOM,
    ]) {
      element?.setAttribute("aria-label", label);
      if (element) element.dataset.testid = testId;
    }
  }
  position() {
    return this.selection.head;
  }
  private linkTarget(event: MouseEvent): string | null {
    const target = event.target as Element;
    const link = target.closest<HTMLElement>("a[href], [data-target]");
    if (link)
      return (
        link.dataset.noteTarget ??
        link.dataset.target ??
        link.getAttribute("href")
      );
    // Active prose and Source mode contain literal Markdown, not link DOM.
    // Resolve the actual source token without moving the selection to it.
    let at: number | null = null;
    if (this.sourceView?.view.contentDOM.contains(target)) {
      const pos = this.sourceView.view.posAtCoords({
        x: event.clientX,
        y: event.clientY,
      });
      if (pos !== null) at = this.sourceView.sourceAt(pos);
    } else if (
      this.rich?.view.dom.contains(target) &&
      this.projection &&
      !target.closest(".axiom-embedded, button, input, textarea")
    ) {
      const found = this.rich.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      if (found) at = this.projection.map.sourceAt(found.pos);
    }
    if (at === null) return null;
    const node = nodeAt(this.source, at, ["link", "wikiLink"]);
    return node && at < node.to ? (node.href ?? null) : null;
  }
  visiblePosition(viewportY: number) {
    if (this.sourceView) {
      const box = this.sourceView.view.contentDOM.getBoundingClientRect();
      return this.sourceView.view.posAtCoords(
        { x: box.left + 8, y: viewportY },
        false,
      );
    }
    if (this.rich && this.projection) {
      const box = this.rich.view.dom.getBoundingClientRect();
      const found = this.rich.view.posAtCoords({
        left: box.left + 8,
        top: viewportY,
      });
      return found ? this.projection.map.sourceAt(found.pos) : null;
    }
    return null;
  }
  markGeometry(): ReadingBlockRect[] {
    if (this.destroyed) return [];
    if (this.sourceView) {
      const box = this.sourceView.view.contentDOM.getBoundingClientRect();
      const blocks = readingBlocks(this.parsed);
      if (!blocks.length && !this.source.trim())
        blocks.push({ from: 0, to: 0, type: "paragraph" });
      return blocks.flatMap((block) => {
        const a = this.sourceView!.caretRect(block.from),
          b = this.sourceView!.caretRect(Math.max(block.from, block.to - 1));
        return a
          ? [
              {
                ...block,
                left: box.left,
                right: box.right,
                top: a.top,
                bottom: b?.bottom ?? a.bottom,
              },
            ]
          : [];
      });
    }
    if (!this.rich || !this.projection) return [];
    return this.projection.blocks.flatMap((block) => {
      const type =
        block.node.type === "sourceProse"
          ? (block.node.kind ?? "paragraph")
          : block.node.type;
      if (!readingBlockTypes.has(type)) return [];
      const dom = this.rich!.view.nodeDOM(block.from);
      if (!(dom instanceof HTMLElement)) return [];
      const box = dom.getBoundingClientRect();
      return box.height
        ? [
            {
              from: block.node.from,
              to: block.node.to,
              type,
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
              folded: !!block.folded,
            },
          ]
        : [];
    });
  }
  navigationGeometry(): NavigationBlock[] {
    if (this.sourceView) {
      const lines = this.sourceView.navigationLines(),
        index = new NavigationIndex(lines);
      return [
        ...lines,
        ...readingBlocks(this.parsed).flatMap((b) => {
          const a = index.atSource(b.from),
            z = index.atSource(Math.max(b.from, b.to - 1));
          return a
            ? [
                {
                  ...b,
                  top: a.top,
                  bottom: z?.bottom ?? a.bottom,
                  left: a.left,
                  right: a.right,
                },
              ]
            : [];
        }),
      ];
    }
    if (this.mode === "read")
      return Array.from(
        this.content.querySelectorAll<HTMLElement>("[data-reading-from]"),
      ).map((el) => {
        const b = el.getBoundingClientRect();
        return {
          from: Number(el.dataset.readingFrom),
          to: Number(el.dataset.readingTo),
          type: el.dataset.readingType!,
          top: b.top,
          bottom: b.bottom,
          left: b.left,
          right: b.right,
        };
      });
    return this.markGeometry();
  }
  navigationPosition(at: number): NavigationPosition | null {
    if (this.destroyed) return null;
    if (this.sourceView) return this.sourceView.navigationPosition(at);
    if (
      !this.rich ||
      !this.projection ||
      this.composing ||
      this.projection.source !== this.source ||
      this.projectionChanges.length
    )
      return null;
    for (const view of this.embedded) {
      const node = view.sourceNode();
      if (
        node &&
        at >= (node.contentFrom ?? node.from) &&
        at <= (node.contentTo ?? node.to)
      ) {
        const position = view.surface.navigationPosition(at);
        if (position) return position;
      }
    }
    const position = this.projection.map.positionAt(at);
    // Rendered atoms have no text caret. Their block geometry is a better
    // fallback than coordsAtPos at the neighboring paragraph's boundary.
    return this.rich.view.state.doc.resolve(position).parent.inlineContent
      ? this.rich.view.coordsAtPos(position)
      : null;
  }
  navigationSnapshot(): EditorNavigationState {
    return {
      revision: this.navigationRevision,
      source: this.source,
      selection: { ...this.selection },
      composing: !!this.composing || this.cmComposing,
      markers: [
        ...(this.find?.matches.slice(0, 1000) ?? []).map((m, i) => ({
          ...m,
          id: `search:${i}`,
          kind: "search" as const,
          label: `Search result ${i + 1}`,
        })),
        ...this.peers.flatMap((p) =>
          p.selection
            ? [
                {
                  id: `peer:${p.clientId}`,
                  kind: "peer" as const,
                  ...selectionRange(p.selection),
                  label: p.name,
                  color: p.color,
                },
              ]
            : [],
        ),
      ],
    };
  }
  private navigationChanged() {
    this.navigationRevision++;
    this.dom.dispatchEvent(
      new Event("axiom:navigation-state", { bubbles: true }),
    );
  }
  configure() {
    if (this.destroyed) return;
    this.contextRevision++;
    this.footnotePreviews.refresh();
    if (this.options.readOnly()) this.closePopup();
    if (this.options.readOnly()) {
      this.closeImageSource();
      this.fields?.revoke();
      this.fields = null;
    }
    this.tables.forEach((view) => view.configure());
    this.tablePanel?.refresh();
    this.find?.update();
    this.content
      .querySelectorAll<HTMLInputElement>(".axiom-task > input")
      .forEach((input) => {
        input.disabled = this.options.readOnly();
      });
    const mode = this.options.mode();
    this.dom.dataset.mode = mode;
    this.dom.dataset.blockGuides = String(
      this.options.appearance().blockGuides,
    );
    this.dom.dataset.typewriter = String(this.options.preferences().typewriter);
    if (mode !== this.mode) {
      if (this.composing || this.cmComposing) return;
      this.binding.undo.stopCapturing();
      this.mode = mode;
      this.ready = this.mount();
    } else {
      this.sourceView?.configure(this.textOptions(true));
      this.embedded.forEach((view) => view.configure());
      this.rich?.view.setProps({ editable: () => !this.options.readOnly() });
      this.refresh(false);
    }
  }
  private async mount() {
    this.folding.clear();
    this.footnotePreviews.close();
    this.closeImageSource();
    const generation = ++this.generation;
    const restoreFocus = this.focused;
    this.closePopup();
    this.find?.destroy();
    this.find = null;
    this.menu?.();
    this.menu = null;
    const old = this.rich;
    this.rich = null;
    if (old) await old.destroy();
    if (generation !== this.generation || this.destroyed) return;
    if (
      restoreFocus &&
      (document.activeElement === document.body ||
        this.dom.contains(document.activeElement))
    )
      this.focused = true;
    this.sourceView?.destroy();
    this.sourceView = null;
    this.content.replaceChildren();
    this.content.classList.toggle("prose", this.mode === "read");
    this.projection = null;
    if (this.mode === "source") {
      this.sourceView = new TextSurface(this.content, {
        ...this.textOptions(true),
        value: { text: this.source, from: 0 },
        label:
          this.label === "Markdown editor" ? "Markdown source" : this.label,
      });
      this.sourceView.view.contentDOM.dataset.testid = this.testId;
      if (this.focused) this.sourceView.focus(this.selection);
      return;
    }
    if (this.mode === "read") {
      this.content.innerHTML = renderDocument(this.parsed, {
        ...this.options.context(),
        scrollTables: true,
        blockMarks: true,
      });
      this.diagrams.render(this.content);
      return;
    }
    try {
      const rich = await RichSurface.create(this.content, {
        projection: (schema) => this.makeProjection(schema),
        dispatch: (tr) => this.dispatch(tr),
        props: {
          attributes: {
            "data-testid": this.testId,
            "aria-label": this.label,
            spellcheck: "true",
            class: "axiom-prose",
          },
          editable: () => !this.options.readOnly(),
          handleKeyDown: (_view, event) => this.keydown(event, false),
          handleTextInput: (_view, from, to, value) => {
            if (this.composing) return false;
            this.capture(from, to);
            this.insertText(value);
            return true;
          },
          handlePaste: (_view, event) => {
            this.paste(event);
            return true;
          },
          handleDOMEvents: {
            compositionstart: () => {
              this.startComposition();
              return false;
            },
            compositionend: (_view, event) => {
              setTimeout(
                () => this.endComposition((event as CompositionEvent).data),
                0,
              );
              return false;
            },
            beforeinput: (_view, event) =>
              this.beforeInput(event as InputEvent),
            mousedown: (_view, event) => {
              const mouse = event as MouseEvent;
              if (
                mouse.button !== 0 ||
                (mouse.ctrlKey && shortcutPlatform() === "mac")
              )
                return true;
              if ((event.target as Element).closest("[data-editor-chrome]"))
                return true;
              if (
                (event as MouseEvent).shiftKey &&
                this.extendTableSelection(event as MouseEvent)
              )
                return true;
              this.dragging = true;
              return false;
            },
            copy: (_view, event) => this.copy(event as ClipboardEvent),
            cut: (_view, event) => {
              if (
                this.copy(event as ClipboardEvent) &&
                !this.options.readOnly()
              )
                this.deleteSelection();
              return true;
            },
            drop: (_view, event) => {
              const files = (event as DragEvent).dataTransfer?.files;
              if (files?.length && !this.options.readOnly()) {
                event.preventDefault();
                this.options.files?.(Array.from(files));
                return true;
              }
              // Internal rich DOM drags need a source-range move transaction.
              // Keep native text selected; never let PM serialize a dragged slice.
              event.preventDefault();
              return true;
            },
          },
          nodeViews: {
            folded_block: (node, _view, getPos) => {
              const dom = document.createElement("div");
              dom.className = "axiom-folded-block";
              dom.contentEditable = "false";
              const label = document.createElement("span"),
                summary = document.createElement("span"),
                expand = document.createElement("button");
              label.className = "axiom-fold-label";
              summary.className = "axiom-fold-summary";
              expand.type = "button";
              expand.className = "axiom-fold-expand";
              expand.dataset.editorFold = "true";
              expand.textContent = "···";
              const render = () => {
                label.textContent = node.attrs.label;
                summary.textContent = node.attrs.summary;
                expand.setAttribute(
                  "aria-label",
                  `Expand ${node.attrs.label.toLowerCase()}`,
                );
                expand.title = `Expand ${node.attrs.detail}`;
              };
              const open = () => {
                const block = this.projection?.blocks.find(
                  (b) => b.folded && b.from === getPos(),
                );
                if (block) this.toggleFold(block, true);
              };
              expand.addEventListener("click", open);
              dom.addEventListener("dblclick", open);
              dom.append(label, summary, expand);
              render();
              return {
                dom,
                stopEvent: () => true,
                ignoreMutation: () => true,
                update: (next) => {
                  if (next.type.name !== "folded_block") return false;
                  node = next;
                  render();
                  return true;
                },
              };
            },
            table: (node, _view, getPos) => new TableView(this, node, getPos),
            inline_preview: (node, _view, getPos) => {
              const source = () => this.embeddedNode(getPos());
              if (node.attrs.kind === "image") {
                const image = this.makeImageView(source);
                this.previewNodes.set(image.dom, source);
                this.inlineRefresh.add(image.refresh);
                return {
                  dom: image.dom,
                  update: (node) => image.update(node),
                  selectNode: () => image.selectNode(),
                  deselectNode: () => image.deselectNode(),
                  stopEvent: (event) => image.stopEvent(event),
                  ignoreMutation: () => true,
                  destroy: () => {
                    this.inlineRefresh.delete(image.refresh);
                    image.destroy();
                  },
                };
              }
              const dom = document.createElement("span");
              this.previewNodes.set(dom, source);
              dom.className = "axiom-inline-preview";
              dom.contentEditable = "false";
              let previous = "";
              const render = () => {
                const source = this.embeddedNode(getPos());
                const html = source
                  ? this.renderFragment(source)
                  : escapeHtml(node.attrs.source);
                if (html !== previous) {
                  if (node.attrs.kind === "footnoteRef")
                    paintFootnoteReference(dom, html);
                  else if (node.attrs.kind === "mathInline")
                    paintMathPreview(
                      dom,
                      html,
                      this.options.preferences().mathKeepLastPreview,
                    );
                  else dom.innerHTML = html;
                  previous = html;
                }
              };
              render();
              this.inlineRefresh.add(render);
              dom.addEventListener("mousedown", (event) => {
                if (
                  node.attrs.kind === "footnoteRef" &&
                  (event.button !== 0 ||
                    (event.ctrlKey && shortcutPlatform() === "mac"))
                )
                  return;
                const anchor =
                  (event.target as Element).closest<HTMLAnchorElement>(
                    'a[href^="#"]',
                  ) ??
                  (node.attrs.kind === "footnoteRef"
                    ? dom.querySelector<HTMLAnchorElement>("a[href]")
                    : null);
                if (anchor && this.followAnchor(anchor.getAttribute("href")!)) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                if (event.button !== 0 || event.metaKey || event.ctrlKey)
                  return;
                event.preventDefault();
                const current = this.embeddedNode(getPos());
                if (current) this.focus(current.contentFrom ?? current.from);
              });
              return {
                dom,
                ignoreMutation: () => true,
                update: (next) => {
                  if (
                    next.type !== node.type ||
                    next.attrs.kind !== node.attrs.kind
                  )
                    return false;
                  node = next;
                  render();
                  return true;
                },
                destroy: () => this.inlineRefresh.delete(render),
              };
            },
            embedded: (node, _view, getPos) =>
              new EmbeddedView(this, node, getPos),
            raw_block: (node, _view, getPos) => {
              if (node.attrs.kind === "hr") return dividerView(this, getPos);
              if (node.attrs.kind === "frontmatter") {
                const view = new MetadataView(this, getPos);
                this.metadata.add(view);
                const refresh = () => view.render();
                this.inlineRefresh.add(refresh);
                return {
                  dom: view.dom,
                  update: (next) => view.update(next),
                  stopEvent: () => true,
                  ignoreMutation: () => true,
                  destroy: () => {
                    this.inlineRefresh.delete(refresh);
                    this.metadata.delete(view);
                    view.destroy();
                  },
                };
              }
              if (node.attrs.kind === "toc") {
                const dom = document.createElement("section");
                dom.className = "axiom-toc";
                dom.dataset.kind = "toc";
                dom.contentEditable = "false";
                let previous = "";
                const render = () => {
                  const current = this.embeddedNode(getPos());
                  if (!current) return;
                  const html = this.renderFragment(current);
                  if (html !== previous) {
                    dom.innerHTML = html;
                    previous = html;
                  }
                };
                dom.addEventListener("mousedown", (event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey)
                    return;
                  if ((event.target as Element).closest("a")) return;
                  event.preventDefault();
                  const current = this.embeddedNode(getPos());
                  if (current) this.focus(current.from, current.to);
                });
                dom.addEventListener("click", (event) => {
                  const link = (
                    event.target as Element
                  ).closest<HTMLAnchorElement>("a[href]");
                  if (link && this.followAnchor(link.getAttribute("href")!)) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                });
                render();
                this.inlineRefresh.add(render);
                return {
                  dom,
                  update: (next) => {
                    if (
                      next.type.name !== "raw_block" ||
                      next.attrs.kind !== "toc"
                    )
                      return false;
                    render();
                    return true;
                  },
                  stopEvent: () => true,
                  ignoreMutation: () => true,
                  destroy: () => this.inlineRefresh.delete(render),
                };
              }
              return new EmbeddedView(this, node, getPos);
            },
            list_item: (node, _view, getPos) =>
              taskItemView(this, node, getPos),
            footnote: (node, _view, getPos) => footnoteView(this, node, getPos),
          },
          decorations: (state) => this.decorations(state.doc),
        },
      });
      if (generation !== this.generation || this.destroyed) {
        await rich.destroy();
        return;
      }
      this.rich = rich;
      // Destroying the previous CM content fires focusout while Milkdown starts.
      // Restore an explicit source/comment navigation request, but never steal
      // focus if the user has since moved to another control.
      if (
        restoreFocus &&
        (document.activeElement === document.body ||
          this.dom.contains(document.activeElement))
      )
        this.focused = true;
      this.setLabel(this.label, this.testId);
      this.projection = rich.projection;
      this.refresh(this.focused);
    } catch (error) {
      if (this.destroyed) return;
      this.options.message(
        `The rich engine could not start. Source remains available. ${(error as Error).message}`,
      );
      this.sourceView = new TextSurface(this.content, {
        ...this.textOptions(true),
        value: { text: this.source, from: 0 },
        label: "Recovery Markdown source",
      });
      this.setLabel(this.label, this.testId);
    }
  }
  private makeProjection(schema?: Schema) {
    const draft = this.footnoteDraftFrom();
    if (
      this.mode === "write" &&
      this.selection.anchor === this.selection.head
    ) {
      const definition = footnoteDefinitionAt(
        this.source,
        this.selection.head,
        this.parsed,
      );
      if (definition && definition.from !== draft) {
        const body = footnoteBody(this.source, definition);
        const line = body.lines.find(
          (line) =>
            this.selection.head >= line.from &&
            this.selection.head < line.bodyFrom,
        );
        if (this.selection.head < body.offsets[0] || line) {
          const at = line?.bodyFrom ?? body.offsets[0];
          this.selection = { anchor: at, head: at };
          this.binding.select(this.selection);
        }
      }
    }
    if (
      this.mode === "write" &&
      this.selection.anchor === this.selection.head
    ) {
      const image = nodeAt(this.source, this.selection.head, ["image"]);
      if (
        image &&
        this.selection.head > image.from &&
        this.selection.head < image.to
      ) {
        if (!this.imageSource && this.focused && !this.options.readOnly())
          this.beginImageSource(image);
      }
    }
    const nodes = editingProjection(
      this.source,
      this.parsed,
      this.selection,
      this.focused,
      this.editing.header(),
      true,
    );
    const projection = projectMarkdown(this.source, {
      folded: this.printing ? [] : this.folds.ranges,
      schema,
      parsed: this.parsed,
      nodes,
      selection: this.selection,
      reveal: this.focused && !this.options.readOnly(),
      proseSource: true,
      footnoteDraft: draft,
      draftHeader: this.editing.header(),
      imageSource: this.activeImageSource(),
    });
    if (
      this.mode === "write" &&
      this.selection.anchor === this.selection.head
    ) {
      const hidden = projection.activeProse
        .flatMap((range) => range.list?.lines ?? [])
        .find(
          (line) =>
            this.selection.head >= line.from &&
            this.selection.head < line.bodyFrom,
        );
      if (hidden) {
        this.selection = { anchor: hidden.bodyFrom, head: hidden.bodyFrom };
        this.binding.select(this.selection);
      }
    }
    this.projection = projection;
    this.projectionChanges = [];
    return projection;
  }
  private footnoteDraftFrom() {
    const range =
      this.footnoteDraft && this.binding.absolute(this.footnoteDraft);
    if (!range) return;
    const line = sourceLine(this.source, range.anchor);
    const definition = footnoteDefinitionAt(
      this.source,
      range.anchor,
      this.parsed,
    );
    const body = definition && footnoteBody(this.source, definition);
    if (
      line.from !== range.anchor ||
      !/^ {0,3}\[\^[^\]\r\n]+\]:[ \t]*$/.test(line.text) ||
      !body ||
      body.lines.length !== 1 ||
      body.lines[0].from !== line.from
    ) {
      this.footnoteDraft = null;
      return;
    }
    return line.from;
  }
  private removeEmptyBlock() {
    if (this.mode !== "write" || this.structureLocked) return false;
    const edit = emptyBlockDelete(this.source, this.selection);
    if (!edit) return false;
    this.closePopup();
    this.footnoteDraft = null;
    return this.edit(edit, "command");
  }
  private followAnchor(href: string) {
    const id = href.slice(1),
      heading = this.parsed.outline.find((h) => h.id === id);
    const equation = documentIndex(this.parsed).equations.find(
      (e) => e.label && "eq-" + e.label === id,
    );
    const footnote = this.parsed.definitions?.find(
      (n) => n.type === "footnoteDefinition" && "fn-" + n.key === id,
    );
    const from =
      heading?.from ??
      equation?.from ??
      (footnote && this.mode === "write"
        ? footnoteBody(this.source, footnote).offsets[0]
        : footnote?.from);
    if (from === undefined) {
      if (!id.startsWith("ref-")) return false;
      const target = this.content.querySelector<HTMLElement>(
        `[id="${CSS.escape(id)}"]`,
      );
      if (!target) return false;
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center" });
      return true;
    }
    if (this.mode === "read")
      this.content
        .querySelector(`[id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "center" });
    else this.focus(from);
    return true;
  }
  private refresh(focus: boolean, retainEmbedded = false) {
    if (this.destroyed || this.composing || this.cmComposing || this.dragging)
      return;
    if (this.sourceView) {
      this.sourceView.update({ text: this.source, from: 0 }, this.selection);
      this.paintPresence();
      if (this.focused) this.completions();
      return;
    }
    if (this.mode === "read") {
      this.content.innerHTML = renderDocument(this.parsed, {
        ...this.options.context(),
        scrollTables: true,
        blockMarks: true,
      });
      this.diagrams.render(this.content);
      return;
    }
    if (!this.rich) return;
    const embedded = this.activeEmbedded();
    const projection = this.makeProjection(this.rich.view.state.schema);
    const hint = this.cellHint;
    const cell =
      hint &&
      this.selection.anchor === hint.at &&
      this.selection.head === hint.at
        ? projection.blocks.find(
            (block) =>
              block.cell?.tableFrom === hint.tableFrom &&
              block.cell.row === hint.row &&
              block.cell.column === hint.column,
          )
        : null;
    // PM may rebuild an item's wrapper or an edited image token. Defer new
    // requests until old views release their already-loaded image elements.
    this.projecting = true;
    try {
      this.rich.update(
        projection,
        this.selection,
        false,
        cell ? { anchor: cell.from + 1, head: cell.from + 1 } : undefined,
      );
    } finally {
      this.projecting = false;
    }
    this.refreshReferences();
    this.inlineRefresh.forEach((render) => render());
    this.imagePool = [];
    // ProseMirror can reuse an unchanged node without calling its update hook.
    // Its source offsets still move when a peer edits earlier in the document.
    this.embedded.forEach((view) => view.refreshSource());
    this.tables.forEach((view) => view.configure());
    this.tablePanel?.refresh();
    this.diagrams.render(this.content);
    this.folding.update(this.rich.view, this.source, projection.blocks);
    this.dom.dispatchEvent(new Event("axiom:mark-layout", { bubbles: true }));
    // An unchanged embedded editor keeps its DOM, native composition and focus.
    // A peer can insert a same-kind block above ours and ProseMirror can reuse
    // the focused node view for it. Follow our rebased source selection instead.
    const metadataFocused = Array.from(this.metadata).some((view) =>
      view.dom.contains(document.activeElement),
    );
    if ((focus || (retainEmbedded && embedded)) && !metadataFocused)
      this.focusSurface(embedded?.dom.isConnected ? embedded : undefined);
    if (this.focused) this.completions();
  }
  private capture(anchor: number, head = anchor) {
    const map = this.projection?.map;
    if (!map) return;
    this.selection = {
      anchor:
        !this.projectionChanges.length &&
        map.positionAt(this.selection.anchor) === anchor
          ? this.selection.anchor
          : map.sourceAt(anchor, 1),
      head:
        !this.projectionChanges.length &&
        map.positionAt(this.selection.head) === head
          ? this.selection.head
          : map.sourceAt(head, anchor === head ? 1 : -1),
    };
    for (const changes of this.projectionChanges)
      this.selection = {
        anchor: mapPosition(this.selection.anchor, changes),
        head: mapPosition(this.selection.head, changes),
      };
    const cell =
      anchor === head &&
      !this.projectionChanges.length &&
      this.projection?.doc.resolve(head).parent.type.name === "table_cell"
        ? this.projection?.blocks.find(
            (block) =>
              block.cell?.missing && head > block.from && head < block.to,
          )?.cell
        : null;
    this.cellHint = cell ? { ...cell, at: this.selection.head } : null;
    this.binding.select(this.selection);
    this.navigationChanged();
  }
  private dispatch(tr: Transaction) {
    if (!this.rich || !this.projection || this.destroyed) return;
    if (this.composing) {
      this.rich.apply(tr);
      return;
    }
    if (!tr.docChanged) {
      this.rich.apply(tr);
      this.capture(tr.selection.anchor, tr.selection.head);
      this.options.navigate(this.selection.head);
      if (!this.dragging) this.refresh(false);
      return;
    }
    if (this.options.readOnly()) {
      this.refresh(false);
      return;
    }
    try {
      const edit = bridgeTransaction(this.projection, tr);
      this.edit({ changes: edit.changes, selection: edit.selection }, "typing");
    } catch {
      // No whole-document serialization on an unexpected upstream operation.
      this.options.recover(
        this.source +
          "\n\nRecovered rich-edit text (not applied):\n\n" +
          tr.doc.textBetween(0, tr.doc.content.size, "\n\n"),
      );
      this.options.message(
        "That operation could not be mapped safely. Its text was retained in recovery; use Source for this structural edit.",
      );
      this.refresh(false);
    }
  }
  private beforeInput(event: InputEvent) {
    if (
      event.isComposing ||
      this.composing ||
      event.inputType.includes("Composition")
    )
      return false;
    if (!event.cancelable) return false; // PM's transaction path handles native replacements.
    if (this.options.readOnly()) {
      event.preventDefault();
      return true;
    }
    if (
      event.inputType === "historyUndo" ||
      event.inputType === "historyRedo"
    ) {
      event.preventDefault();
      this.binding.history(event.inputType === "historyRedo");
      return true;
    }
    if (event.inputType.startsWith("delete")) {
      event.preventDefault();
      this.delete(event.inputType);
      return true;
    }
    if (["insertParagraph", "insertLineBreak"].includes(event.inputType)) {
      event.preventDefault();
      this.enter(event.inputType === "insertLineBreak");
      return true;
    }
    if (event.inputType === "insertText" && event.data !== null) {
      // Native text insertion may replace a selection spanning tables or atom
      // views. Author the selected source range before PM's replace fitter can
      // reshape the rich document. IME and non-cancelable events stay with PM.
      event.preventDefault();
      this.insertText(event.data);
      return true;
    }
    return false;
  }
  private startComposition() {
    if (!this.projection || this.options.readOnly()) return;
    this.closePopup();
    const positions = new Map<number, ReturnType<NativeBinding["relative"]>>();
    const block =
      this.projection.activeProse.find(
        (range) =>
          this.selection.head >= range.from && this.selection.head <= range.to,
      ) ??
      nodeAt(this.source, this.selection.head, [
        "paragraph",
        "heading",
        "tableCell",
      ]);
    const selected = selectionRange(this.selection);
    const replacement =
      selected.from !== selected.to &&
      (!block || selected.from < block.from || selected.to > block.to)
        ? selected
        : undefined;
    const from = replacement?.from ?? block?.from ?? this.selection.head,
      to = replacement?.to ?? block?.to ?? this.selection.head;
    if (replacement) {
      for (const at of [from, to])
        positions.set(at, this.binding.relative({ anchor: at, head: at }));
    } else
      for (let at = from; at <= to; at++)
        positions.set(at, this.binding.relative({ anchor: at, head: at }));
    this.composing = {
      projection: this.projection,
      positions,
      container: this.binding.relative({ anchor: from, head: to }),
      containerLength: to - from,
      replacement,
    };
  }
  private endComposition(committed?: string) {
    const composing = this.composing;
    if (!composing || !this.rich || this.destroyed) return;
    try {
      // A native IME can replace a selected range spanning structural blocks.
      // Its commit string is authored input, not serialized rich-document text.
      // Reuse the same relative-range conflict checks as ordinary composition.
      const selected = composing.replacement;
      const edit =
        selected &&
        committed !== undefined &&
        !this.rich.view.state.doc.eq(composing.projection.doc)
          ? {
              changes: [{ ...selected, insert: committed }],
              selection: {
                anchor: selected.from + committed.length,
                head: selected.from + committed.length,
              },
            }
          : bridgeComposition(composing.projection, this.rich.view.state.doc);
      this.composing = null;
      if (!edit) {
        this.refresh(false);
        return;
      }
      const change = edit.changes[0];
      const a = composing.positions.get(change.from),
        b = composing.positions.get(change.to);
      const from = a && this.binding.absolute(a)?.anchor,
        to = b && this.binding.absolute(b)?.head;
      const container = this.binding.absolute(composing.container);
      if (
        from === undefined ||
        to === undefined ||
        to < from ||
        this.options.readOnly() ||
        (composing.containerLength > 0 &&
          (!container || container.anchor >= container.head)) ||
        this.source.slice(from, to) !==
          composing.projection.source.slice(change.from, change.to)
      ) {
        this.options.recover(draftSource(composing.projection, edit));
        this.options.message(
          "The composing range changed remotely. Your draft was retained for recovery.",
        );
        this.refresh(false);
        return;
      }
      this.edit(
        {
          changes: [{ from, to, insert: change.insert }],
          selection: { anchor: from + change.insert.length },
        },
        "composition",
      );
    } catch {
      this.composing = null;
      this.options.recover(
        composing.projection.source +
          "\n\nRecovered composition text (not applied):\n\n" +
          this.rich.view.state.doc.textBetween(
            0,
            this.rich.view.state.doc.content.size,
            "\n\n",
          ),
      );
      this.options.message(
        "The composition could not be mapped safely. Its text was retained in recovery.",
      );
      this.refresh(false);
    } finally {
      // A toolbar mode change can be requested while native IME owns the DOM.
      // Apply the deferred configuration only after committing/recovering it.
      if (!this.destroyed && !this.composing) this.configure();
    }
  }
  textOptions(source = false): Omit<TextSurfaceOptions, "value" | "label"> {
    const prefs = this.options.preferences(),
      appearance = this.options.appearance();
    return {
      source,
      readOnly: this.options.readOnly(),
      wrap: source ? appearance.codeWrap : prefs.codeWrap,
      numbers: source ? appearance.lineNumbers : prefs.codeLineNumbers,
      indent: prefs.indentSize,
      activeLine: source && appearance.activeLine,
      edit: (changes, selection, kind) => {
        if (this.textComposition) {
          this.textComposition.draft = applyChanges(
            this.textComposition.draft,
            changes,
          );
          return;
        }
        this.edit({ changes, selection }, kind);
      },
      select: (selection) => {
        if (this.textComposition) return;
        this.selection = selection;
        this.binding.select(selection);
        this.navigationChanged();
        this.options.navigate(selection.head);
        if (this.focused) this.completions();
      },
      keydown: (event) => this.keydown(event, true),
      input: (selection, value) => {
        if (this.cmComposing) return false;
        this.selection = selection;
        return this.pairedInput(value);
      },
      // CM owns composing DOM. Structural reprojection waits for its final input.
      composition: (active) => this.textCompositionChanged(active),
    };
  }
  private textCompositionChanged(active: boolean) {
    if (this.destroyed) return;
    if (active) {
      if (this.options.readOnly() || this.textComposition) return;
      this.closePopup();
      const range = selectionRange(this.selection);
      const from = lineAt(this.source, range.from).from,
        to = lineAt(this.source, range.to).to;
      const positions = new Map<
        number,
        ReturnType<NativeBinding["relative"]>
      >();
      for (let at = from; at <= to; at++)
        positions.set(at, this.binding.relative({ anchor: at, head: at }));
      this.textComposition = {
        source: this.source,
        draft: this.source,
        positions,
        container: this.binding.relative({ anchor: from, head: to }),
        containerLength: to - from,
      };
      this.cmComposing = true;
      return;
    }
    const draft = this.textComposition;
    this.textComposition = null;
    this.cmComposing = false;
    if (!draft) return;
    const change = minimalChange(draft.source, draft.draft);
    if (change.from === change.to && !change.insert) {
      this.refresh(false);
      return;
    }
    const a = draft.positions.get(change.from),
      b = draft.positions.get(change.to);
    const from = a && this.binding.absolute(a)?.anchor,
      to = b && this.binding.absolute(b)?.head;
    const container = this.binding.absolute(draft.container);
    if (
      from === undefined ||
      to === undefined ||
      to < from ||
      this.options.readOnly() ||
      this.source.slice(from, to) !==
        draft.source.slice(change.from, change.to) ||
      (draft.containerLength > 0 &&
        (!container || container.anchor >= container.head))
    ) {
      this.options.recover(draft.draft);
      this.options.message(
        "The composing source range changed remotely. Your draft was retained for recovery.",
      );
      this.refresh(false);
      return;
    }
    this.edit(
      {
        changes: [{ from, to, insert: change.insert }],
        selection: { anchor: from + change.insert.length },
      },
      "composition",
    );
    this.configure();
  }
  edit(
    edit: SourceEdit | null,
    kind: NativeTransaction["kind"] = "command",
    _intent?: "code-language",
    focus = true,
  ) {
    if (!edit || this.destroyed || this.options.readOnly()) return false;
    // A one-line equation remains source-exact until a multiline edit needs fenced
    // form. Expand only that equation, in this same undoable source transaction.
    const equation =
      this.mode === "write" && edit.changes.length
        ? nodeAt(this.source, edit.changes[0]?.from, ["mathBlock"])
        : undefined;
    if (
      equation?.contentFrom !== undefined &&
      equation.contentTo !== undefined &&
      edit.changes.some((c) => c.insert.includes("\n")) &&
      sourceLine(this.source, equation.from).to >= equation.contentTo &&
      edit.changes.every(
        (c) => c.from >= equation.contentFrom! && c.to <= equation.contentTo!,
      )
    ) {
      const from = equation.contentFrom,
        to = equation.contentTo;
      const boundary =
        sourceLine(this.source, from).ending +
        literalPrefix(this.source, equation);
      const body = applyChanges(
        this.source.slice(from, to),
        edit.changes.map((c) => ({
          ...c,
          from: c.from - from,
          to: c.to - from,
        })),
      );
      edit = {
        changes: [{ from, to, insert: boundary + body + boundary }],
        selection: {
          anchor: edit.selection.anchor + boundary.length,
          head:
            (edit.selection.head ?? edit.selection.anchor) + boundary.length,
        },
      };
    } else if (
      equation?.type === "mathBlock" &&
      equation.text === "" &&
      equation.contentFrom !== undefined &&
      equation.contentTo !== undefined &&
      sourceLine(this.source, equation.from).from !==
        sourceLine(this.source, equation.contentTo).from &&
      sourceLine(this.source, equation.contentFrom).from ===
        sourceLine(this.source, equation.contentTo).from &&
      literalPrefix(this.source, equation).includes(">") &&
      edit.changes.every(
        (c) => c.from === equation.contentTo && c.to === equation.contentTo,
      )
    ) {
      // Imported adjacent fences have no physical body line yet. Create it only
      // on the first authored body edit, leaving the closing fence intact.
      const boundary =
        sourceLine(this.source, equation.from).ending +
        literalPrefix(this.source, equation);
      edit = {
        ...edit,
        changes: edit.changes.map((c, i) =>
          i === edit!.changes.length - 1
            ? { ...c, insert: c.insert + boundary }
            : c,
        ),
      };
    }
    if (focus) this.focused = true;
    const selection = {
      anchor: edit.selection.anchor,
      head: edit.selection.head ?? edit.selection.anchor,
    };
    // A view transaction carries original-source coordinates and is applied once.
    const changes = edit.changes.filter(
      (c) => this.source.slice(c.from, c.to) !== c.insert,
    );
    this.pairs.beforeChange(changes);
    this.binding.transact({
      changes,
      selection,
      kind,
    });
    if (!changes.length) {
      this.selection = selection;
      this.refresh(true);
    }
    const line = sourceLine(this.source, this.selection.head);
    if (kind === "typing" && isDraftHeader(line.text))
      this.editing.beginHeader(line.from, line.to);
    if (
      kind === "typing" &&
      this.mode === "write" &&
      changes.some(
        (change) => change.insert && !/[\r\n]/.test(change.insert),
      ) &&
      /^ {0,3}\[\^[^\]\r\n]+\]:[ \t]*$/.test(line.text)
    ) {
      this.footnoteDraft = this.binding.relative({
        anchor: line.from,
        head: line.to,
      });
      this.refresh(focus);
    }
    return true;
  }
  private insertText(value: string) {
    const table = this.tableAt();
    if (table?.model.rows[table.row].cells[table.column].missing) {
      const changes = tableAction(
        table.model,
        this.source,
        table.row,
        table.column,
        "paste",
        [[value]],
      );
      const after = applyChanges(this.source, changes),
        node = nodeAt(after, table.node.from, ["table"]),
        model = node && tableModel(after, node);
      this.edit(
        {
          changes,
          selection: {
            anchor:
              model?.rows[table.row].cells[table.column].to ??
              this.selection.head,
          },
        },
        "typing",
      );
      return;
    }
    if (table) {
      const preceding =
        /\\+$/.exec(
          this.source.slice(0, selectionRange(this.selection).from),
        )?.[0] ?? "";
      value = escapeCell(preceding + value).slice(preceding.length);
    }
    if (this.pairedInput(value)) return;
    this.edit(
      (this.mode === "write"
        ? footnoteInput(this.source, this.selection, value)
        : undefined) ??
        (this.mode === "write"
          ? listBodyEdit(this.source, this.selection, value)
          : undefined) ??
        quoteBodyEdit(this.source, this.selection, value, this.activeQuote()),
      "typing",
    );
  }
  private activeQuote() {
    if (this.mode !== "write") return;
    const { from, to } = selectionRange(this.selection);
    return this.projection?.activeProse.find(
      (range) => range.quote && from >= range.from && to <= range.to,
    )?.quote;
  }
  private pairedInput(value: string) {
    if (!this.options.preferences().autoPair || this.options.readOnly())
      return false;
    const action = pairedInput(this.source, this.selection, value, this.pairs);
    if (!action) return false;
    if (action.skip !== undefined) this.focus(action.skip);
    else if (action.edit && this.edit(action.edit, "typing") && action.pair) {
      const { open, close, left, right } = action.pair;
      this.pairs.add(open, close, left, right);
    }
    return true;
  }
  private deletePair() {
    const { from, to } = selectionRange(this.selection);
    if (from !== to || !this.pairs.closer(to, this.source[to], true))
      return false;
    return this.edit(
      {
        changes: [{ from: from - 1, to: to + 1, insert: "" }],
        selection: { anchor: from - 1 },
      },
      "delete",
    );
  }
  private enter(soft = false) {
    const header = this.footnoteDraftFrom();
    if (!soft && this.mode === "write" && header !== undefined) {
      const line = sourceLine(this.source, header);
      if (
        this.selection.anchor === line.to &&
        this.selection.head === line.to
      ) {
        this.footnoteDraft = null;
        this.edit(replacement(this.selection, line.ending + "    "));
        return;
      }
    }
    const table = this.tableAt();
    if (table) {
      if (soft) this.insertText("\n");
      else if (
        table.row > 0 &&
        table.row === table.model.rows.length - 1 &&
        table.model.rows[table.row].cells.every((cell) => !cell.raw.trim())
      ) {
        // A blank final row is the table equivalent of an empty list item.
        // Never remove a populated row just to move the caret outside.
        const changes = tableAction(
          table.model,
          this.source,
          table.row,
          table.column,
          "deleteRow",
        );
        const after = applyChanges(this.source, changes);
        const node = nodeAt(after, table.node.from, ["table"]);
        if (node) {
          const exit = paragraphBesideBlock(after, node);
          this.edit(
            {
              changes: [
                minimalChange(this.source, applyChanges(after, exit.changes)),
              ],
              selection: exit.selection,
            },
            "command",
          );
        }
      } else this.navigateCell(0, 1);
      return;
    }
    // ATX/setext headings cannot contain a hard line break.
    if (soft && nodeAt(this.source, this.selection.head, ["heading"]))
      soft = false;
    const pending = !!this.editing.header();
    if (!soft) this.editing.commitHeader();
    const edit = preserveLineEndings(
      this.source,
      this.selection,
      (source, selection) => {
        return enterEdit(
          source,
          selection,
          this.options.preferences(),
          soft,
          pending,
        );
      },
    );
    this.edit(edit);
  }
  private deleteSelection() {
    const { from, to } = selectionRange(this.selection);
    const literal = this.projection?.activeProse.some(
      (range) => from >= range.from && to <= range.to,
    );
    if (this.mode === "write") {
      const scoped = footnoteCommand(this.source, this.selection, (body, at) =>
        literal ? replacement(at, "") : rangeDelete(body, at),
      );
      if (scoped !== undefined) {
        this.edit(scoped, "delete");
        return;
      }
    }
    this.edit(
      this.mode === "write" && !literal
        ? rangeDelete(this.source, this.selection)
        : replacement(this.selection, ""),
      "delete",
    );
  }
  private delete(kind: string) {
    if (this.cellRange) {
      this.execute("clearCells");
      return;
    }
    const { from, to } = selectionRange(this.selection);
    if (from !== to) {
      this.deleteSelection();
      return;
    }
    const backward = !kind.includes("Forward"),
      table = this.tableAt();
    if (backward && this.removeEmptyBlock()) return;
    if (backward && this.deletePair()) return;
    const active = this.projection?.activeProse.find(
      (range) => from >= range.from && from <= range.to,
    );
    if (active?.list && this.mode === "write") {
      const edit = listBodyDelete(from, backward, active.list);
      if (edit) {
        this.edit(edit, "delete");
        return;
      }
      if (backward && from === active.list.lines[0]?.bodyFrom) {
        const outdent = indentList(
          this.source,
          this.selection,
          true,
          this.options.preferences().indentSize,
        );
        if (outdent?.changes.length) {
          this.edit(outdent, "command");
          return;
        }
        const scoped = footnoteCommand(
          this.source,
          this.selection,
          (body, at) => {
            const item = nodeAt(body, at.head, ["item"]);
            return item ? unwrapBlock(body, item, at.head) : null;
          },
        );
        const item = nodeAt(this.source, from, ["item"]);
        const unwrap = scoped ?? (item && unwrapBlock(this.source, item, from));
        if (unwrap) {
          this.edit(unwrap, "command");
          return;
        }
      }
    }
    if (active?.quote && !active.list && this.mode === "write") {
      const edit = quoteBodyDelete(this.source, from, backward, active.quote);
      if (edit) {
        // Each structural unwrap is its own undo step, unlike consecutive
        // character deletion or joining wrapped lines within one paragraph.
        this.edit(
          edit,
          backward && from === active.quote.lines[0]?.bodyFrom
            ? "command"
            : "delete",
        );
        return;
      }
    }
    const literal =
      active && (backward ? from > active.from : from < active.to);
    const footnote = this.mode === "write" && footnoteAt(this.source, from);
    if (
      footnote &&
      !table &&
      footnote.definition.from !== this.footnoteDraftFrom()
    ) {
      if (backward && from === footnote.offsets[0]) {
        return;
      }
      const scoped = footnoteCommand(
        this.source,
        this.selection,
        (body, at) => {
          if (!literal) {
            const boundary = boundaryDelete(body, at, backward);
            if (boundary) return boundary;
          }
          let a = backward ? graphemeBoundary(body, at.head, -1) : at.head;
          let b = backward ? at.head : graphemeBoundary(body, at.head, 1);
          if (kind.includes("Word")) {
            if (backward)
              a =
                at.head -
                (body
                  .slice(0, at.head)
                  .match(/(?:\s+|[\p{L}\p{N}_]+|[^\p{L}\p{N}\s])$/u)?.[0]
                  .length ?? 0);
            else
              b =
                at.head +
                (body
                  .slice(at.head)
                  .match(/^(?:\s+|[\p{L}\p{N}_]+|[^\p{L}\p{N}\s])/u)?.[0]
                  .length ?? 0);
          }
          return {
            changes: [{ from: a, to: b, insert: "" }],
            selection: { anchor: a },
          };
        },
      );
      this.edit(scoped ?? null, "delete");
      return;
    }
    const blank = this.projection?.blocks.find(
      (block) =>
        block.node.type === "blankParagraph" &&
        from === (backward ? block.node.contentFrom : block.node.contentTo),
    );
    if (blank && !kind.includes("Word")) {
      const spans = this.projection!.map.spans;
      const neighbour = backward
        ? spans.filter((span) => span.sourceTo < from).at(-1)?.sourceTo
        : spans.find((span) => span.sourceFrom > from)?.sourceFrom;
      if (neighbour !== undefined) {
        const a = Math.min(neighbour, from),
          b = Math.max(neighbour, from);
        if (/^[\t \r\n]+$/.test(this.source.slice(a, b))) {
          this.edit({
            changes: [{ from: a, to: b, insert: "" }],
            selection: { anchor: a },
          });
          return;
        }
      }
    }
    const boundary =
      !table &&
      !literal &&
      this.mode === "write" &&
      boundaryDelete(this.source, this.selection, backward);
    if (boundary) {
      this.edit(boundary);
      return;
    }
    let a = backward ? graphemeBoundary(this.source, from, -1) : from;
    let b = backward ? to : graphemeBoundary(this.source, to, 1);
    if (kind.includes("Word")) {
      if (backward)
        a =
          from -
          (this.source
            .slice(0, from)
            .match(/(?:\s+|[\p{L}\p{N}_]+|[^\p{L}\p{N}\s])$/u)?.[0].length ??
            0);
      else
        b =
          to +
          (this.source
            .slice(to)
            .match(/^(?:\s+|[\p{L}\p{N}_]+|[^\p{L}\p{N}\s])/u)?.[0].length ??
            0);
    }
    if (table) {
      const cell = table.model.rows[table.row].cells[table.column];
      a = Math.max(a, cell.from);
      b = Math.min(b, cell.to);
    }
    this.edit(
      { changes: [{ from: a, to: b, insert: "" }], selection: { anchor: a } },
      "delete",
    );
  }
  private keydown(event: KeyboardEvent, text: boolean) {
    if (
      event.key === "Tab" &&
      this.snippet.length &&
      !nodeAt(this.source, this.selection.head, ["codeBlock", "code"]) &&
      !this.popup &&
      !event.isComposing &&
      !this.cmComposing &&
      !this.composing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !this.options.readOnly()
    ) {
      event.preventDefault();
      this.snippetIndex += event.shiftKey ? -1 : 1;
      const field = this.snippet[this.snippetIndex];
      const selection = field && this.binding.absolute(field);
      if (selection) this.focus(selection.anchor, selection.head);
      if (!selection) this.snippet = [];
      return true;
    }
    if (
      event.isComposing ||
      this.composing ||
      this.cmComposing ||
      event.getModifierState("AltGraph")
    )
      return false;
    if (
      this.popup &&
      ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)
    ) {
      // An unselected language menu must not consume bare-fence Enter.
      if (
        this.choices[0]?.language &&
        event.key === "Enter" &&
        this.choice < 0
      ) {
        this.dismissedQuery = this.source + ":" + this.selection.head;
        this.closePopup();
      } else {
        event.preventDefault();
        if (event.key === "Escape") {
          this.dismissedQuery = this.source + ":" + this.selection.head;
          this.closePopup();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          this.choice =
            this.choice < 0
              ? event.key === "ArrowDown"
                ? 0
                : this.choices.length - 1
              : (this.choice +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  this.choices.length) %
                this.choices.length;
          this.paintChoices();
        } else this.choose(this.choices[Math.max(0, this.choice)]);
        return true;
      }
    }
    const platform = shortcutPlatform(),
      key = eventBinding(event, platform);
    if (!text && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key === "Escape" && this.imageSource) {
        event.preventDefault();
        const { session } = this.imageSource;
        const { from, to } = session.range;
        const valid = session.valid;
        this.closeImageSource();
        this.focus(valid ? from : to, to);
        return true;
      }
      if (!this.imageSource && ["Enter", " "].includes(event.key)) {
        const range = selectionRange(this.selection);
        const image = this.projection?.blocks.find(
          (block) =>
            block.node.type === "image" &&
            block.node.from === range.from &&
            block.node.to === range.to,
        );
        if (image && !this.options.readOnly()) {
          event.preventDefault();
          this.openImageSource(image.node);
          return true;
        }
      }
    }
    if (
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10")
    ) {
      event.preventDefault();
      const box = this.dom.getBoundingClientRect();
      this.openMenu(box.left + 24, Math.max(60, box.top + 24));
      return true;
    }
    if (event.key === "Escape" && this.options.exit) {
      event.preventDefault();
      queueMicrotask(() => {
        if (!this.destroyed) this.options.exit?.();
      });
      return true;
    }
    if (
      !text &&
      (event.metaKey || event.ctrlKey) &&
      ["Home", "End"].includes(event.key)
    ) {
      event.preventDefault();
      const to = event.key === "Home" ? 0 : this.source.length;
      this.focus(event.shiftKey ? this.selection.anchor : to, to);
      return true;
    }
    const matches = editorCommands.filter((c) =>
      keysFor(c.id, this.options.preferences(), platform).includes(key),
    );
    // Within list prose Mod+Enter is a hard line break, not "finish block".
    // Embedded code/math keep their established finish-block shortcut.
    if (
      !text &&
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !this.options.readOnly() &&
      !this.tableActive() &&
      nodeAt(this.source, this.selection.head, ["item"])
    ) {
      event.preventDefault();
      this.enter(true);
      return true;
    }
    const command =
      (this.tableActive() && matches.find((c) => c.scope === "table")) ||
      matches.find((c) => c.scope !== "table");
    if (command && this.execute(command.id)) {
      event.preventDefault();
      return true;
    }
    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      this.arrowBoundary(event.key, text)
    ) {
      event.preventDefault();
      return true;
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "a" &&
      !text
    ) {
      event.preventDefault();
      const table = this.tableAt(),
        cell = table?.model.rows[table.row].cells[table.column];
      if (
        cell &&
        (this.selection.anchor !== cell.from || this.selection.head !== cell.to)
      ) {
        this.focus(cell.from, cell.to);
        return true;
      }
      this.focus(0, this.source.length);
      return true;
    }
    if (event.key === "Escape" && text && this.mode === "write") {
      event.preventDefault();
      this.execute("finishBlock");
      return true;
    }
    if (text) {
      if (event.key === "Backspace" && this.removeEmptyBlock()) {
        event.preventDefault();
        return true;
      }
      if (
        event.key === "Backspace" &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        this.deletePair()
      ) {
        event.preventDefault();
        return true;
      }
      if (
        event.key === "Enter" &&
        this.mode === "write" &&
        !this.options.preferences().codeIndentOnEnter &&
        !this.options.readOnly()
      ) {
        event.preventDefault();
        this.enter(event.shiftKey);
        return true;
      }
      if (
        this.mode === "source" &&
        event.key === "Enter" &&
        !this.options.readOnly()
      ) {
        event.preventDefault();
        const structural = nodeAt(this.source, this.selection.head, [
          "item",
          "blockquote",
          "codeBlock",
          "mathBlock",
        ]);
        if (structural || footnoteAt(this.source, this.selection.head))
          this.enter(event.shiftKey);
        else this.edit(replacement(this.selection, "\n"), "typing");
        return true;
      }
      if (
        this.mode === "write" &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "a"
      ) {
        const block = this.activeEmbedded()?.sourceNode();
        if (block) {
          const body = literalBody(this.source, block);
          if (
            this.selection.anchor === body.offsets[0] &&
            this.selection.head === body.offsets.at(-1)
          ) {
            event.preventDefault();
            this.focus(0, this.source.length);
            return true;
          }
        }
      }
      return false;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      this.enter(event.shiftKey);
      return true;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      this.delete(
        "delete" +
          (event.altKey || event.ctrlKey ? "Word" : "Content") +
          (event.key === "Backspace" ? "Backward" : "Forward"),
      );
      return true;
    }
    if (event.key === "Tab") {
      if (this.tableActive() && this.options.preferences().tableTabNavigation) {
        event.preventDefault();
        this.navigateCell(event.shiftKey ? -1 : 1);
        return true;
      }
      const edit = indentList(
        this.source,
        this.selection,
        event.shiftKey,
        this.options.preferences().indentSize,
      );
      if (edit) {
        event.preventDefault();
        this.edit(edit);
        return true;
      }
    }
    return false;
  }
  private arrowBoundary(key: string, text: boolean) {
    if (
      this.mode === "write" &&
      !text &&
      /^Arrow(Left|Right|Up|Down)$/.test(key)
    ) {
      const range = selectionRange(this.selection);
      const image = this.projection?.blocks.find(
        (b) =>
          b.node.type === "image" &&
          b.node.from === range.from &&
          b.node.to === range.to,
      );
      if (image) {
        this.focus(
          key === "ArrowLeft" || key === "ArrowUp" ? range.from : range.to,
        );
        return true;
      }
    }
    if (
      this.mode !== "write" ||
      this.selection.anchor !== this.selection.head ||
      !this.rich ||
      !this.projection ||
      !/^Arrow(Left|Right|Up|Down)$/.test(key)
    )
      return false;
    const backward = key === "ArrowLeft" || key === "ArrowUp";
    if (text) {
      const embedded = this.activeEmbedded();
      if (!embedded) return false;
      const view = embedded.surface.view,
        selection = view.state.selection.main;
      const end = backward ? 0 : view.state.doc.length;
      if (/Left|Right/.test(key)) {
        if (selection.head !== end) return false;
      } else {
        const caret = view.coordsAtPos(selection.head),
          boundary = view.coordsAtPos(end);
        if (!caret || !boundary || Math.abs(caret.top - boundary.top) > 2)
          return false;
      }
      const projected = this.projection.blocks.find(
        (block) => block.node === embedded.sourceNode(),
      );
      if (!projected) return false;
      const at = backward ? projected.from : projected.to;
      const spans = this.projection.map.spans;
      const target = backward
        ? [...spans].reverse().find((span) => span.to < at)
        : spans.find((span) => span.from > at);
      if (!target) return false; // No implicit paragraph or source mutation on navigation.
      this.focus(backward ? target.sourceTo : target.sourceFrom);
      return true;
    }
    const direction = key.slice(5).toLowerCase() as
      "left" | "right" | "up" | "down";
    if (!this.rich.view.endOfTextblock(direction)) return false;
    const head = this.rich.view.state.selection.$head;
    if (!head.depth) return false;
    const at = backward ? head.before() : head.after();
    const next = this.projection.blocks.find(
      (block) =>
        (backward ? block.to === at : block.from === at) &&
        ["codeBlock", "mathBlock"].includes(block.node.type),
    );
    if (!next) return false;
    const body = literalBody(this.source, next.node);
    this.focus(backward ? body.offsets.at(-1) : body.offsets[0]);
    return true;
  }
  setSelection(selection: SourceSelection, focus = false) {
    this.folds.reveal(selection);
    this.selection = clampSelection(selection, this.source.length);
    this.binding.select(this.selection, focus || this.focused);
    if (focus) this.focus(this.selection.anchor, this.selection.head);
    else this.refresh(false);
  }
  focus(position = this.selection.head, head = position) {
    this.folds.reveal({ anchor: position, head });
    this.cellHint = null;
    this.focused = true;
    this.selection = clampSelection(
      { anchor: position, head },
      this.source.length,
    );
    this.binding.select(this.selection);
    this.refresh(false);
    this.focusSurface();
    this.options.navigate(this.selection.head);
  }
  private focusSurface(preferred?: EmbeddedView) {
    if (this.sourceView) {
      this.sourceView.focus(this.selection);
      return;
    }
    const range = selectionRange(this.selection);
    if (
      range.from === range.to &&
      Array.from(this.metadata).some((view) => view.focus(range.from))
    )
      return;
    const contains = (view: EmbeddedView) => {
      const n = view.sourceNode();
      return (
        n &&
        range.from >= (n.contentFrom ?? n.from) &&
        range.to <= (n.contentTo ?? n.to)
      );
    };
    const target =
      preferred && contains(preferred)
        ? preferred
        : Array.from(this.embedded).find(contains);
    if (target) {
      target.dom.classList.add("is-editing");
      target.surface.focus(this.selection);
      return;
    }
    this.rich?.view.focus();
    if (this.rich) this.rich.apply(this.rich.view.state.tr.scrollIntoView());
  }
  private activeEmbedded() {
    return Array.from(this.embedded).find((view) => view.surface.view.hasFocus);
  }
  embeddedNode(at: number | undefined) {
    return at === undefined
      ? undefined
      : this.projection?.blocks.find((b) => b.from === at)?.node;
  }
  previewKey() {
    if (
      this.previewMemo?.parsed === this.parsed &&
      this.previewMemo.revision === this.contextRevision
    )
      return this.previewMemo.key;
    const index = documentIndex(this.parsed);
    const key = JSON.stringify([
      this.contextRevision,
      this.parsed.outline.map(({ level, text, id }) => [level, text, id]),
      this.parsed.citations,
      [...index.labels],
      index.macros,
      index.physics,
    ]);
    this.previewMemo = {
      parsed: this.parsed,
      revision: this.contextRevision,
      key,
    };
    return key;
  }
  private refreshReferences() {
    if (!this.rich) return;
    const referenceDocument: ParsedDocument = {
      ...this.parsed,
      ast: { type: "document", from: 0, to: 0, children: [] },
      footnotes: {},
      definitions: [],
    };
    const html = this.parsed.citations.length
      ? renderDocument(referenceDocument, {
          ...this.options.context(),
          document: referenceDocument,
          fragment: false,
        })
      : "";
    if (html !== this.referenceHTML) {
      this.references.innerHTML = html;
      this.referenceHTML = html;
    }
    this.references.className = "axiom-reference-footer";
    this.references.hidden = !html;
    if (this.references.parentElement !== this.content)
      this.content.append(this.references);
  }
  renderFragment(node: MarkdownNode) {
    if (node.type === "referenceDefinition")
      return `<span class="axiom-definition-key">[${escapeHtml(node.key ?? "")}]</span> <span>${escapeHtml(node.href ?? "")}</span>`;
    const children =
      node.type === "footnoteDefinition"
        ? (this.parsed.footnotes[node.key ?? ""] ?? [])
        : [node];
    return renderDocument(
      {
        ...this.parsed,
        ast: { type: "document", from: node.from, to: node.to, children },
      },
      { ...this.options.context(), document: this.parsed, fragment: true },
    );
  }
  register(view: EmbeddedView) {
    this.embedded.add(view);
  }
  unregister(view: EmbeddedView) {
    this.embedded.delete(view);
  }
  registerTable(view: TableView) {
    this.tables.add(view);
  }
  unregisterTable(view: TableView) {
    this.tables.delete(view);
  }
  get structureLocked() {
    return !!this.composing || this.cmComposing || this.options.readOnly();
  }
  tableCell(node: MarkdownNode) {
    const current = this.tableAt();
    return this.focused && current?.node.from === node.from
      ? { row: current.row, column: current.column }
      : undefined;
  }
  tableTarget(node: MarkdownNode) {
    return bookmarkTable(this.binding, this.source, node, this.tableCell(node));
  }
  private tablePanelState(target: TableTarget): TablePanelState | null {
    const current = resolveTable(this.binding, this.source, target);
    return (
      current && {
        row: current.row,
        column: current.column,
        rows: current.model.rows.length,
        columns: current.model.columns,
        cell: target.row !== undefined,
        readOnly: this.options.readOnly(),
        composing: !!this.composing || this.cmComposing,
        alignment: current.model.align[current.column] ?? "",
      }
    );
  }
  tableControl(
    view: TableView,
    action: "row" | "column" | "copy" | "menu" | "alignment",
    selection?: SourceSelection,
  ) {
    const node = view.sourceNode();
    const cell = selection && this.tableAt(selection.head);
    const target =
      node &&
      (cell?.node.from === node.from
        ? bookmarkTable(this.binding, this.source, node, {
            row: cell.row,
            column: cell.column,
          })
        : this.tableTarget(node));
    const current = target && resolveTable(this.binding, this.source, target);
    if (!target || !current || this.composing || this.cmComposing) return;
    if (action === "copy") {
      void navigator.clipboard
        .writeText(
          writeTSV(
            current.model.rows.map((row) => row.cells.map((cell) => cell.raw)),
          ),
        )
        .catch(() => this.options.message("Clipboard access was denied."));
      return;
    }
    if (action === "row" || action === "column") {
      if (this.structureLocked) return;
      if (action === "row") current.row = current.model.rows.length - 1;
      else {
        current.column = current.model.columns - 1;
        current.row = target.row ?? Math.min(1, current.model.rows.length - 1);
      }
      this.tableCommand(
        action === "row" ? "rowAfter" : "columnAfter",
        current,
        null,
      );
      this.focus(this.selection.anchor, this.selection.head);
      view.revealSelection();
      return;
    }
    if (action === "alignment" && target.row === undefined) {
      this.options.message(
        "Select a cell in this table to set its column alignment.",
      );
      return;
    }
    this.closePopup();
    this.menu?.();
    const caret = this.binding.relative(this.selection);
    const rectangle =
      this.cellRange?.table === node?.from ? { ...this.cellRange } : null;
    const selected = selection ?? this.selection;
    const commentRange = this.binding.relative(selected);
    const context: ContextAction[] =
      target.row !== undefined ? this.contextFields(selection?.head) : [];
    if (target.row !== undefined && selected.anchor !== selected.head)
      context.push({
        label: commandById.comment.label,
        icon: "comment",
        action: () => {
          const at = this.binding.absolute(commentRange);
          if (at) this.execute("comment", { from: at.anchor, to: at.head });
        },
      });
    view.dom.dataset.panelOpen = "true";
    this.tablePanel = tablePanel({
      owner: view.dom,
      anchor: () => view.controlBounds(action),
      state: () => this.tablePanelState(target),
      alignmentOnly: action === "alignment",
      context,
      restore: () => {
        const at = this.binding.absolute(caret);
        if (at && !this.destroyed) this.focus(at.anchor, at.head);
      },
      onClose: () => {
        delete view.dom.dataset.panelOpen;
        this.menu = null;
        this.tablePanel = null;
        this.releaseMenuFocus();
      },
      action: (id) => {
        const resolved = resolveTable(this.binding, this.source, target);
        if (!resolved) {
          this.options.message(
            "The table structure changed. Select the table again; no cells were changed.",
          );
          return;
        }
        if (id === "copyTable") return this.tableControl(view, "copy");
        if (this.structureLocked && !id.startsWith("select")) return;
        if (id === "finishBlock") {
          this.focus(resolved.model.rows.at(-1)!.cells.at(-1)!.to);
          this.execute(id);
        } else
          this.tableCommand(
            id,
            resolved,
            rectangle ? { ...rectangle, table: resolved.node.from } : null,
          );
      },
    });
    this.menu = () => this.tablePanel?.close();
  }
  private tableAt(at = this.selection.head) {
    if (this.mode !== "write") return null;
    const node = nodeAt(this.source, at, ["table"]),
      model = node && tableModel(this.source, node);
    if (!node || !model) return null;
    const hint = this.cellHint;
    if (
      hint?.tableFrom === node.from &&
      at === hint.at &&
      model.rows[hint.row]?.cells[hint.column]
    )
      return { node, model, row: hint.row, column: hint.column };
    const row = Math.max(
      0,
      model.rows.findIndex((r) => at >= r.from && at <= r.to),
    );
    const column = Math.max(
      0,
      model.rows[row].cells.findIndex((c) => at >= c.from && at <= c.to),
    );
    return { node, model, row, column };
  }
  tableActive() {
    return !!this.tableAt();
  }
  private navigateCell(delta: number, down = 0) {
    const table = this.tableAt();
    if (!table) return;
    const index =
      table.row * table.model.columns +
      table.column +
      delta +
      down * table.model.columns;
    if (index < 0) {
      this.execute("paragraphBefore");
      return;
    }
    const row = Math.floor(index / table.model.columns),
      column = index % table.model.columns;
    if (row >= table.model.rows.length) {
      if (!this.options.preferences().tableAutoRow || this.options.readOnly()) {
        this.execute("finishBlock");
        return;
      }
      this.execute("rowAfter");
    }
    const next = this.tableAt();
    const cell = next?.model.rows[row]?.cells[column];
    if (cell) {
      this.focus(cell.from);
      if (cell.missing && next) {
        this.cellHint = {
          tableFrom: next.node.from,
          row,
          column,
          at: cell.from,
        };
        this.refresh(true);
      }
    }
  }
  execute(id: EditorCommandId, args: CommandArguments = {}) {
    if (this.composing || this.cmComposing) return false;
    if (id === "attachment" || (id === "table" && args.rows === undefined)) {
      if (this.options.readOnly()) return false;
      // Bookmark an async insertion range without selecting it. Selecting the
      // slash query here leaves a stale rich selection after modal cancellation.
      this.options.prepare(
        args.from === undefined
          ? undefined
          : { from: args.from, to: args.to ?? args.from },
      );
      this.options.workspace(id);
      return true;
    }
    if (args.from !== undefined)
      this.selection = { anchor: args.from, head: args.to ?? args.from };
    const definition = commandById[id];
    if (!definition) return false;
    if (definition.scope === "workspace") {
      this.options.workspace(id);
      return true;
    }
    if (id === "undo" || id === "redo") {
      if (!this.options.readOnly()) {
        this.binding.history(id === "redo");
        const line = sourceLine(this.source, this.selection.head);
        const definition = footnoteDefinitionAt(
          this.source,
          this.selection.head,
          this.parsed,
        );
        if (
          this.mode === "write" &&
          this.selection.anchor === line.to &&
          this.selection.head === line.to &&
          definition &&
          /^ {0,3}\[\^[^\]\r\n]+\]:[ \t]*$/.test(line.text) &&
          !footnoteBody(this.source, definition).text &&
          footnoteBody(this.source, definition).lines.length === 1
        ) {
          this.footnoteDraft = this.binding.relative({
            anchor: line.from,
            head: line.to,
          });
          this.refresh(this.focused);
        }
      }
      return true;
    }
    if (id === "find" || id === "replace") {
      this.openFind(id === "replace");
      return true;
    }
    const block = nodeAt(this.source, this.selection.head, [
      "codeBlock",
      "mathBlock",
      "table",
      "paragraph",
      "heading",
      "blockquote",
    ]);
    if (
      !args.wholeBlock &&
      block?.type === "codeBlock" &&
      ["duplicate", "moveUp", "moveDown"].includes(id)
    ) {
      return this.edit(
        codeLineEdit(
          this.source,
          this.selection,
          id as "duplicate" | "moveUp" | "moveDown",
        ),
      );
    }
    if (id === "equationLabel" && block?.type === "mathBlock") {
      const found = /\\label\{([^}]+)\}/.exec(
        this.source.slice(block.from, block.to),
      );
      if (found) {
        const at = block.from + found.index + 7;
        this.focus(at, at + found[1].length);
        return true;
      }
      const body = literalBody(this.source, block);
      const at = body.offsets.at(-1)!;
      const singleLine = sourceLine(this.source, block.from).to >= at;
      const value = containerText(
        (body.text ? (singleLine ? " " : "\n") : "") + "\\label{}",
        literalPrefix(this.source, block),
        sourceLine(this.source, block.from).ending,
      ).text;
      return this.edit({
        changes: [{ from: at, to: at, insert: value }],
        selection: { anchor: at + value.length - 1 },
      });
    }
    if (id.startsWith("copy")) {
      if (id === "copyMathSvg") {
        const svg = this.dom.querySelector(
          `[data-math-from="${block?.from}"] svg`,
        );
        if (!svg) {
          this.options.message(
            "Wait for a valid equation preview before copying SVG.",
          );
          return true;
        }
        void navigator.clipboard
          .writeText(svg.outerHTML)
          .catch(() => this.options.message("Clipboard access was denied."));
        return true;
      }
      const range = selectionRange(this.selection);
      const table = this.tableAt();
      const value =
        id === "copyTable" && table
          ? writeTSV(
              table.model.rows.map((row) => row.cells.map((cell) => cell.raw)),
            )
          : id === "copyBlockSource" && block
            ? this.source.slice(block.from, block.to)
            : ["copyCode", "copyTex"].includes(id) && block
              ? (block.text ?? "")
              : this.source.slice(range.from, range.to);
      void navigator.clipboard
        .writeText(value)
        .catch(() =>
          this.options.message(
            "Clipboard access was denied. Select and copy the source instead.",
          ),
        );
      return true;
    }
    if (this.options.readOnly()) return false;
    if (definition.scope === "table") return this.tableCommand(id);
    if (["codeWrap", "codeLineNumbers", "resetCodeDisplay"].includes(id)) {
      const active = this.activeEmbedded();
      active?.display(id);
      return !!active;
    }
    if (
      (id === "indent" || id === "outdent") &&
      nodeAt(this.source, this.selection.head, ["item"])
    )
      return this.edit(
        indentList(
          this.source,
          this.selection,
          id === "outdent",
          this.options.preferences().indentSize,
        ),
      );
    const { from, to } = selectionRange(this.selection);
    const edit =
      args.value === undefined
        ? sourceCommand(id, this.source, from, to, {
            ...args,
            language: this.options.preferences().defaultCodeLanguage,
            indent: this.options.preferences().indentSize,
          })
        : replacement(this.selection, args.value);
    if (id === "mathBlock" && !edit)
      this.options.message(
        "Select text within one quote or list item to insert an equation, or edit its Markdown in Source mode.",
      );
    return this.edit(edit);
  }
  private tableCommand(
    id: EditorCommandId,
    current = this.tableAt(),
    selectedRange = this.cellRange,
  ) {
    if (!current) return false;
    const { node, model, row, column } = current;
    if (["selectRow", "selectColumn", "selectTable"].includes(id)) {
      this.cellRange = {
        table: node.from,
        row: id === "selectRow" ? row : 0,
        column: id === "selectColumn" ? column : 0,
        endRow: id === "selectRow" ? row : model.rows.length - 1,
        endColumn: id === "selectColumn" ? column : model.columns - 1,
      };
      this.paintPresence();
      return true;
    }
    if (id === "clearCells") {
      const range = selectedRange ?? {
        table: node.from,
        row,
        column,
        endRow: row,
        endColumn: column,
      };
      const cells = model.rows
        .slice(range.row, range.endRow + 1)
        .flatMap((r) => r.cells.slice(range.column, range.endColumn + 1));
      this.cellRange = null;
      return this.edit({
        changes: cells.map((c) => ({ from: c.from, to: c.to, insert: "" })),
        selection: { anchor: cells[0]?.from ?? node.from },
      });
    }
    try {
      const changes = tableAction(model, this.source, row, column, id);
      const nextSource = applyChanges(this.source, changes),
        nextNode = nodeAt(nextSource, node.from, ["table"]),
        next = nextNode && tableModel(nextSource, nextNode);
      const r = Math.max(
        0,
        row +
          (["rowAfter", "duplicateRow", "rowDown"].includes(id)
            ? 1
            : id === "rowUp"
              ? -1
              : 0),
      );
      const c = Math.max(
        0,
        column +
          (["columnAfter", "duplicateColumn", "columnRight"].includes(id)
            ? 1
            : id === "columnLeft"
              ? -1
              : 0),
      );
      const cell =
        next?.rows[Math.min(r, next.rows.length - 1)]?.cells[
          Math.min(c, next.columns - 1)
        ];
      this.cellRange = null;
      return this.edit({
        changes,
        selection: { anchor: cell?.from ?? node.from },
      });
    } catch (error) {
      this.options.message((error as Error).message);
      return true;
    }
  }
  private copy(event: ClipboardEvent) {
    const { from, to } = selectionRange(this.selection);
    if (from === to && !this.cellRange) return false;
    event.preventDefault();
    const table = this.tableAt(),
      range = this.cellRange;
    const value =
      table && range
        ? writeTSV(
            table.model.rows
              .slice(range.row, range.endRow + 1)
              .map((row) =>
                row.cells
                  .slice(range.column, range.endColumn + 1)
                  .map((cell) => cell.raw),
              ),
          )
        : this.source.slice(from, to);
    event.clipboardData?.setData("text/plain", value);
    return true;
  }
  private paste(event: ClipboardEvent) {
    event.preventDefault();
    if (this.options.readOnly()) return;
    const data = event.clipboardData;
    if (!data) return;
    if (data.files.length) {
      this.options.files?.(Array.from(data.files));
      return;
    }
    const text = data.getData("text/plain"),
      html = data.getData("text/html"),
      table = this.tableAt();
    if (table && this.options.preferences().tableRichPaste) {
      const grid =
        htmlTableGrid(html) ??
        (text.includes("\t") || text.includes("\n") ? parseTSV(text) : null);
      if (grid) {
        this.edit(
          {
            changes: tableAction(
              table.model,
              this.source,
              table.row,
              table.column,
              "paste",
              grid,
            ),
            selection: { anchor: this.selection.head },
          },
          "paste",
        );
        return;
      }
    }
    const value = table
      ? escapeCell(text)
      : html
        ? htmlMarkdown(html) || text
        : text;
    this.edit(
      (this.mode === "write"
        ? footnoteInput(this.source, this.selection, value)
        : undefined) ??
        quoteBodyEdit(this.source, this.selection, value, this.activeQuote()),
      "paste",
    );
  }
  private contextMenu(event: MouseEvent) {
    if ((event.target as Element).closest("[data-editor-chrome]")) {
      event.preventDefault();
      return;
    }
    if ((event.target as Element).closest("input, .cm-search")) return;
    event.preventDefault();
    let target = { ...this.selection };
    const preview = (event.target as Element).closest<HTMLElement>(
      ".axiom-inline-preview",
    );
    const previewNode = preview && this.previewNodes.get(preview)?.();
    const embedded = Array.from(this.embedded).find((view) =>
      view.dom.contains(event.target as Node),
    );
    if (embedded) {
      const node = embedded.sourceNode();
      if (node)
        target = {
          anchor: node.contentFrom ?? node.from,
          head: node.contentFrom ?? node.from,
        };
    }
    if (previewNode)
      target = { anchor: previewNode.from, head: previewNode.from };
    if (
      this.rich &&
      this.projection &&
      !this.cellRange &&
      !previewNode &&
      !(event.target as Element).closest(".axiom-embedded")
    ) {
      const found = this.rich.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      if (found) {
        const selection = this.rich.view.state.selection;
        if (
          selection.empty ||
          found.pos < selection.from ||
          found.pos > selection.to
        )
          target = {
            anchor: this.projection.map.sourceAt(found.pos),
            head: this.projection.map.sourceAt(found.pos),
          };
      }
    }
    this.openMenu(event.clientX, event.clientY, target);
  }
  private extendTableSelection(event: MouseEvent) {
    const cell = (event.target as Element).closest("td,th"),
      table = this.tableAt();
    if (!cell || !table || !this.rich || !this.projection) return false;
    const pos = this.rich.view.posAtDOM(cell, 0),
      at = this.projection.map.sourceAt(pos);
    const endRow = table.model.rows.findIndex((row) =>
      row.cells.some((cell) => at >= cell.from && at <= cell.to),
    );
    const endColumn =
      endRow < 0
        ? -1
        : table.model.rows[endRow].cells.findIndex(
            (cell) => at >= cell.from && at <= cell.to,
          );
    if (endRow < 0 || endColumn < 0) return false;
    event.preventDefault();
    this.cellRange = {
      table: table.node.from,
      row: Math.min(table.row, endRow),
      column: Math.min(table.column, endColumn),
      endRow: Math.max(table.row, endRow),
      endColumn: Math.max(table.column, endColumn),
    };
    this.paintPresence();
    return true;
  }
  openBlockMenu(x: number, y: number, target = this.selection) {
    this.openMenu(x, y, target);
  }
  openMenu(x: number, y: number, target = this.selection) {
    this.closePopup();
    const currentTable = this.tableAt(target.head);
    if (currentTable) {
      const view = Array.from(this.tables).find(
        (table) => table.sourceNode()?.from === currentTable.node.from,
      );
      if (view) return this.tableControl(view, "menu", target);
      return;
    }
    const caret = this.binding.relative(this.selection);
    const selected = this.binding.relative(target);
    const targetNode = nodeAt(this.source, target.head, [
      "paragraph",
      "heading",
      "blockquote",
      "callout",
      "theorem",
      "proof",
      "codeBlock",
      "mathBlock",
      "hr",
      "toc",
      "frontmatter",
      "image",
      "link",
      "footnoteDefinition",
      "referenceDefinition",
    ]);
    const identity =
      targetNode &&
      this.binding.relative({ anchor: targetNode.from, head: targetNode.to });
    const original =
      targetNode && this.source.slice(targetNode.from, targetNode.to);
    const resolve = () => {
      const at = this.binding.absolute(selected);
      const range = identity && this.binding.absolute(identity);
      const current =
        range &&
        targetNode &&
        nodeAt(this.source, range.anchor, [targetNode.type]);
      const valid =
        !targetNode ||
        (current &&
          range &&
          current.from === range.anchor &&
          current.to === range.head &&
          this.source.slice(range.anchor, range.head) === original &&
          compareRelativePositions(
            identity!.anchor,
            this.binding.relative({ anchor: current.from, head: current.to })
              .anchor,
          ));
      if (!at || !valid) {
        this.options.message(
          "This block changed. Reopen its menu; no source was changed.",
        );
        return null;
      }
      return at;
    };
    const block = nodeAt(this.source, target.head, ["codeBlock", "mathBlock"]);
    const ids: EditorCommandId[] = [
      ...(!block ? ["mathBlock" as EditorCommandId] : []),
      ...(block?.type === "codeBlock"
        ? ([
            "copyCode",
            "codeWrap",
            "codeLineNumbers",
            "resetCodeDisplay",
          ] as EditorCommandId[])
        : block?.type === "mathBlock"
          ? (["copyTex", "copyMathSvg", "equationLabel"] as EditorCommandId[])
          : []),
      "copyBlockSource",
      "paragraphBefore",
      "finishBlock",
      "duplicate",
      "moveUp",
      "moveDown",
      "source",
    ];
    if (target.anchor !== target.head) ids.push("comment");
    const menuOwner =
      block &&
      Array.from(this.embedded).find(
        (view) => view.sourceNode()?.from === block.from,
      )?.dom;
    const menuButton = menuOwner?.querySelector('[aria-label="Block actions"]');
    this.menu = openContextMenu({
      owner: this.dom,
      x,
      y,
      label: "Block actions",
      restore: () => {
        const at = this.binding.absolute(caret);
        if (at && !this.destroyed) this.focus(at.anchor, at.head);
      },
      onClose: () => {
        if (menuOwner) delete menuOwner.dataset.panelOpen;
        menuButton?.setAttribute("aria-expanded", "false");
        this.menu = null;
        this.releaseMenuFocus();
      },
      items: [
        ...this.contextFields(target.head),
        ...ids.map((id) => ({
          id,
          label: commandById[id].label,
          icon: editorCommandIcons[id],
          disabled:
            this.options.readOnly() &&
            !id.startsWith("copy") &&
            !["source", "comment"].includes(id),
          group: commandById[id].category,
          action: () => {
            const at = resolve();
            if (!at) return;
            if (
              ["codeWrap", "codeLineNumbers", "resetCodeDisplay"].includes(id)
            ) {
              if (this.structureLocked) return;
              const node = nodeAt(this.source, at.head, ["codeBlock"]);
              Array.from(this.embedded)
                .find((view) => view.sourceNode()?.from === node?.from)
                ?.display(id);
              return;
            }
            const before = this.selection;
            try {
              this.execute(id, {
                wholeBlock: true,
                from: at.anchor,
                to: at.head,
              });
            } finally {
              if (id.startsWith("copy")) this.selection = before;
            }
          },
        })),
      ],
    });
    // The overlay manager closes any previous menu synchronously. Set the new
    // owner state afterwards so reopening the same block cannot clear it.
    if (menuOwner) menuOwner.dataset.panelOpen = "true";
    menuButton?.setAttribute("aria-expanded", "true");
  }
  private releaseMenuFocus() {
    queueMicrotask(() => {
      if (
        !this.destroyed &&
        !this.hasFocus &&
        !this.menu &&
        !this.fields &&
        !this.popup
      ) {
        this.focused = false;
        this.binding.blur();
        this.refresh(false);
      }
    });
  }
  private closeImageSource() {
    const active = this.imageSource;
    this.imageSource = null;
    if (active?.preview) {
      this.inlineRefresh.delete(active.preview.refresh);
      active.preview.destroy();
    }
  }
  private beginImageSource(node: MarkdownNode) {
    if (this.imageSource?.session.range.from === node.from) return;
    this.closeImageSource();
    this.imageSource = {
      session: new ImageSourceSession(this.binding, node),
      preview: null,
    };
  }
  private activeImageSource() {
    const active = this.imageSource;
    if (!active) return;
    const { session } = active;
    const host = nodeAt(this.source, session.range.from, [
      "paragraph",
      "heading",
      "tableCell",
    ]);
    const keep =
      (this.focused || !!this.menu || !!this.fields || !!this.tablePanel) &&
      this.mode === "write" &&
      !this.options.readOnly() &&
      session.resolve(this.source) &&
      host &&
      [this.selection.anchor, this.selection.head].every(
        (at) => at >= host.from && at <= host.to,
      );
    if (!keep) {
      this.closeImageSource();
      return;
    }
    return session.range;
  }
  private makeImageView(
    source: () => MarkdownNode | undefined,
    editing = false,
  ) {
    return new ImageView({
      source,
      disabled: () => !!this.options.context().disableImages,
      readOnly: () => this.options.readOnly(),
      active: () => editing,
      stale: () => editing && !this.imageSource?.session.valid,
      defer: () => this.projecting,
      reuse: (url) => {
        const index = this.imagePool.findIndex(
          (entry) => entry.image.getAttribute("src") === url,
        );
        return index < 0 ? undefined : this.imagePool.splice(index, 1)[0];
      },
      release: (entry) => {
        if (!this.destroyed && entry.image.getAttribute("src")) {
          this.imagePool.push(entry);
          if (this.imagePool.length > 8) this.imagePool.shift();
        }
      },
      select: (node, dom) => {
        if (editing) this.focus(this.selection.anchor, this.selection.head);
        else if (this.options.readOnly()) {
          this.setSelection({ anchor: node.from, head: node.to });
          dom.focus({ preventScroll: true });
        } else this.focus(node.from, node.to);
      },
      openSource: (node) => this.openImageSource(node),
    });
  }
  private openImageSource(node: MarkdownNode) {
    if (
      this.options.readOnly() ||
      this.mode !== "write" ||
      this.structureLocked
    )
      return;
    const same = this.imageSource?.session.range.from === node.from;
    this.closePopup();
    this.beginImageSource(node);
    this.focus(
      same ? this.selection.anchor : node.to,
      same ? this.selection.head : node.to,
    );
  }
  private editFields(
    node: MarkdownNode,
    title: string,
    fields: EditorField[],
    build: (values: Record<string, string>) => string,
    range = { from: node.from, to: node.to },
  ) {
    if (this.options.readOnly()) return;
    this.fields?.close(true, false);
    const source = this.source,
      original = source.slice(range.from, range.to),
      bookmark = this.binding.relative({ anchor: range.from, head: range.to });
    const recover = (values: Record<string, string>) => {
      this.options.recover(
        source.slice(0, range.from) + build(values) + source.slice(range.to),
      );
      this.options.message(
        "The field draft was retained for recovery; no remote text was overwritten.",
      );
    };
    this.fields = sourceFields({
      title,
      fields,
      recover,
      restore: () => {
        if (!this.destroyed)
          this.focus(this.selection.anchor, this.selection.head);
      },
      apply: (values) => {
        const current = this.binding.absolute(bookmark);
        if (
          this.options.readOnly() ||
          !current ||
          this.source.slice(current.anchor, current.head) !== original
        ) {
          recover(values);
          return "The source or permission changed. Your draft is in recovery; cancel and reopen this field.";
        }
        const insert = build(values);
        if (insert !== original)
          this.edit({
            changes: [{ from: current.anchor, to: current.head, insert }],
            selection: { anchor: current.anchor },
          });
      },
    });
  }
  private contextFields(at = this.selection.head): ContextAction[] {
    const node = nodeAt(this.source, at, [
      "image",
      "link",
      "callout",
      "theorem",
      "proof",
    ]);
    if (!node) return [];
    const bookmark = this.binding.relative({
      anchor: node.from,
      head: node.to,
    });
    const original = this.source.slice(node.from, node.to);
    const currentNode = () => {
      const at = this.binding.absolute(bookmark);
      const current = at && nodeAt(this.source, at.anchor, [node.type]);
      const identity =
        current &&
        this.binding.relative({ anchor: current.from, head: current.to });
      if (
        !at ||
        !current ||
        !identity ||
        current.from !== at.anchor ||
        current.to !== at.head ||
        this.source.slice(current.from, current.to) !== original ||
        !compareRelativePositions(identity.anchor, bookmark.anchor) ||
        !compareRelativePositions(identity.head, bookmark.head)
      ) {
        this.options.message(
          "This content changed. Reopen its details; no source was changed.",
        );
        return null;
      }
      return current;
    };
    if (node.type === "image" || node.type === "link")
      return [
        {
          id: "edit-link-fields",
          icon: node.type === "image" ? "image" : "link",
          label:
            node.type === "image" ? "Edit image details" : "Edit link details",
          group: "Details",
          disabled: this.options.readOnly(),
          action: () => {
            const node = currentNode();
            if (!node) return;
            const label =
              this.source.slice(
                node.contentFrom ?? node.from,
                node.contentTo ?? node.to,
              ) || plainText(node);
            const quoted = (value: string) =>
              value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            this.editFields(
              node,
              node.type === "image" ? "Image details" : "Link details",
              [
                {
                  key: "label",
                  label:
                    node.type === "image" ? "Alternative text" : "Link text",
                  value: label,
                  validate: (v) =>
                    /[\r\n]/.test(v) ? "Use a single line." : undefined,
                },
                {
                  key: "url",
                  label: "Destination",
                  value: node.href ?? "",
                  validate: (v) =>
                    !v ||
                    !safeUrl(v, node.type === "image") ||
                    /[<>\r\n]/.test(v)
                      ? "Use a safe relative, HTTPS, HTTP, or mailto address."
                      : undefined,
                },
                {
                  key: "title",
                  label: "Title (optional)",
                  value: node.title ?? "",
                  validate: (v) =>
                    /[\r\n]/.test(v) ? "Use a single line." : undefined,
                },
              ],
              (v) =>
                `${node.type === "image" ? "!" : ""}[${v.label === label ? label : v.label.replace(/[\\\[\]]/g, "\\$&")}](<${v.url}>${v.title ? ' "' + quoted(v.title) + '"' : ""})`,
            );
          },
        },
      ];
    const line = lineAt(this.source, node.from);
    const titleEnd = line.to - (line.text.endsWith("\r") ? 1 : 0);
    const match =
      /^([ \t]*(?:>[ \t]*)?\[![^\]]+\][ \t]*|[ \t]*:::\w+[ \t]*)(.*)$/.exec(
        this.source.slice(line.from, titleEnd),
      );
    if (!match) return [];
    return [
      {
        id: "edit-block-title",
        label: "Edit block title",
        icon: "edit",
        group: "Details",
        disabled: this.options.readOnly(),
        action: () => {
          const current = currentNode();
          if (!current) return;
          const delta = current.from - node.from;
          this.editFields(
            current,
            "Block title",
            [
              {
                key: "title",
                label: "Title",
                value: match[2],
                validate: (v) =>
                  /[\r\n]/.test(v) ? "Use a single-line title." : undefined,
              },
            ],
            (v) => v.title,
            { from: line.from + match[1].length + delta, to: titleEnd + delta },
          );
        },
      },
    ];
  }
  private completionMatches(): Completion[] {
    if (this.selection.anchor !== this.selection.head) return [];
    // Code bodies deliberately have no keyword, identifier or snippet menu.
    // Fence headers and the separate language field retain language completion.
    if (
      this.mode === "write" &&
      this.activeEmbedded()?.sourceNode()?.type === "codeBlock"
    )
      return [];
    const fence = codeFenceQuery(this.source, this.selection.head);
    if (fence)
      return codeLanguageSuggestions(
        fence.query,
        this.options.preferences().defaultCodeLanguage,
      ).map((language) => ({
        label: language.label,
        value: language.value,
        language: true,
        ...fence,
      }));
    return nativeCompletions(
      this.source,
      this.selection.head,
      this.options.preferences(),
      this.options.context(),
      this.options.notes(),
    );
  }
  private completions() {
    if (document.activeElement?.classList.contains("axiom-language-input")) {
      this.closePopup();
      return;
    }
    if (
      this.composing ||
      this.cmComposing ||
      this.options.readOnly() ||
      this.source + ":" + this.selection.head === this.dismissedQuery
    ) {
      // Undo/redo can notify first with a rebased caret and then its saved
      // selection. Remove any menu painted by that intermediate notification.
      this.closePopup();
      return;
    }
    const matches = this.completionMatches();
    if (!matches.length) {
      this.closePopup();
      return;
    }
    const sameQuery =
      this.choices[0]?.language === matches[0].language &&
      this.choices[0]?.query === matches[0].query;
    this.choice =
      matches[0].language && !sameQuery
        ? -1
        : Math.min(this.choice, matches.length - 1);
    if (!matches[0].language) this.choice = Math.max(0, this.choice);
    this.choices = matches;
    if (!this.popup) {
      this.releaseCompletionOverlay = claimEditorOverlay(() =>
        this.closePopup(),
      );
      this.popup = document.createElement("div");
      this.popup.className = "axiom-completions";
      this.popup.role = "listbox";
      this.popup.id = "axiom-completions-" + crypto.randomUUID();
      if (typeof this.popup.showPopover === "function")
        this.popup.setAttribute("popover", "manual");
      this.dom.append(this.popup);
      if (this.popup.hasAttribute("popover")) this.popup.showPopover();
    }
    this.popup.classList.toggle(
      "axiom-language-completions",
      !!matches[0].language,
    );
    this.popup.setAttribute(
      "aria-label",
      matches[0].language
        ? "Code language suggestions"
        : "Markdown commands and completions",
    );
    this.paintChoices();
    this.positionPopup();
  }
  private positionPopup() {
    if (!this.popup || this.popupFrame) return;
    this.popupFrame = requestAnimationFrame(() => {
      this.popupFrame = 0;
      if (!this.popup || this.destroyed) return;
      const text = this.activeEmbedded()?.surface ?? this.sourceView;
      const box = text
        ? text.caretRect(this.selection.head)
        : this.rich && this.projection
          ? this.rich.view.coordsAtPos(
              this.projection.map.positionAt(this.selection.head),
            )
          : null;
      if (!box) {
        this.closePopup();
        return;
      }
      const height = this.popup.offsetHeight;
      this.popup.style.left =
        Math.max(
          12,
          Math.min(innerWidth - this.popup.offsetWidth - 12, box.left),
        ) + "px";
      this.popup.style.top =
        Math.max(
          12,
          box.bottom + height + 12 <= innerHeight
            ? box.bottom + 6
            : box.top - height - 6,
        ) + "px";
    });
  }
  private paintChoices() {
    this.popup?.replaceChildren(
      ...this.choices.map((choice, index) => {
        const button = choice.language
          ? languageOption({ label: choice.label, value: choice.value! }, () =>
              this.choose(choice),
            )
          : document.createElement("button");
        button.type = "button";
        button.role = "option";
        button.tabIndex = -1;
        button.setAttribute("aria-selected", String(index === this.choice));
        button.id = this.popup!.id + "-" + index;
        if (!choice.language) {
          button.classList.add("action-option");
          appendActionLabel(
            button,
            choice.command
              ? editorCommandIcons[choice.command]
              : (choice.icon ?? "note"),
            choice.label,
          );
          if (choice.mathSymbol)
            button.firstElementChild?.replaceWith(
              mathSymbolIcon(choice.mathSymbol),
            );
          button.addEventListener("mousedown", (event) =>
            event.preventDefault(),
          );
          button.addEventListener("click", () => this.choose(choice));
        }
        return button;
      }),
    );
    if (this.choices[0]?.language && this.popup) {
      const hint = document.createElement("div");
      hint.className = "axiom-completion-hint";
      hint.role = "presentation";
      hint.textContent =
        this.choice < 0
          ? "Tab complete · ↑↓ choose · Enter start block"
          : "Enter / Tab complete · Esc dismiss";
      this.popup.append(hint);
    }
    if (this.choice >= 0)
      this.popup?.children[this.choice]?.scrollIntoView({ block: "nearest" });
    const input =
      (this.activeEmbedded()?.surface ?? this.sourceView)?.view.contentDOM ??
      this.rich?.view.dom;
    if (input && this.popup) {
      if (this.completionInput && this.completionInput.element !== input)
        this.clearCompletionInput();
      if (!this.completionInput)
        this.completionInput = {
          element: input,
          controls: input.getAttribute("aria-controls"),
          active: input.getAttribute("aria-activedescendant"),
        };
      input.setAttribute("aria-controls", this.popup.id);
      if (this.choice >= 0)
        input.setAttribute(
          "aria-activedescendant",
          this.popup.id + "-" + this.choice,
        );
      else input.removeAttribute("aria-activedescendant");
    }
  }
  private choose(choice: Completion) {
    this.closePopup();
    // Popup ranges may have moved while a collaborator edited the document.
    const current = this.completionMatches().find(
      (item) =>
        item.label === choice.label && item.language === choice.language,
    );
    if (!current || this.options.readOnly()) return;
    choice = current;
    if (choice.language && choice.value !== undefined) {
      const edit: SourceEdit = {
        changes: [{ from: choice.from, to: choice.to, insert: choice.value }],
        selection: { anchor: choice.from + choice.value.length },
      };
      this.dismissedQuery =
        applyChanges(this.source, edit.changes) + ":" + edit.selection.anchor;
      if (this.mode === "write") {
        const line = sourceLine(this.source, choice.from);
        this.editing.beginHeader(line.from, line.to);
      }
      this.edit(edit, "command", "code-language");
      return;
    }
    if (choice.command) {
      if (choice.command === "attachment") {
        // File selection is an asynchronous host action, not a Markdown
        // formatting command. Bookmark the whole query until a file is chosen;
        // cancellation leaves it intact and insertion is a single undo step.
        this.execute(choice.command, { from: choice.from, to: choice.to });
        return;
      }
      const stripped =
        this.source.slice(0, choice.from) + this.source.slice(choice.to);
      const edit = sourceCommand(
        choice.command,
        stripped,
        choice.from,
        choice.from,
        { language: this.options.preferences().defaultCodeLanguage },
      );
      if (edit)
        this.edit({
          changes: [
            minimalChange(this.source, applyChanges(stripped, edit.changes)),
          ],
          selection: edit.selection,
        });
      return;
    }
    if (choice.value !== undefined) {
      const literal = nodeAt(this.source, choice.from, ["mathBlock"]);
      const value = containerText(
        choice.value,
        literal ? literalPrefix(this.source, literal) : "",
        sourceLine(this.source, choice.from).ending,
      );
      const mapped = (offset: number) => choice.from + value.offsets[offset];
      const edit: SourceEdit = {
        changes: [{ from: choice.from, to: choice.to, insert: value.text }],
        selection: {
          anchor: mapped(choice.select?.[0] ?? choice.value.length),
          head: mapped(choice.select?.[1] ?? choice.value.length),
        },
      };
      this.edit(edit);
      const shift =
        this.selection.anchor -
        mapped(choice.select?.[0] ?? choice.value.length);
      this.snippet = (choice.fields ?? []).map(([from, to]) =>
        this.binding.relative({
          anchor: mapped(from) + shift,
          head: mapped(to) + shift,
        }),
      );
      this.snippetIndex = 0;
    }
  }
  private closePopup() {
    cancelAnimationFrame(this.popupFrame);
    this.popupFrame = 0;
    this.popup?.remove();
    this.popup = null;
    this.releaseCompletionOverlay?.();
    this.releaseCompletionOverlay = null;
    this.clearCompletionInput();
    this.choices = [];
    this.choice = 0;
  }
  private clearCompletionInput() {
    if (this.completionInput) {
      const { element, controls, active } = this.completionInput;
      for (const [attribute, value] of [
        ["aria-controls", controls],
        ["aria-activedescendant", active],
      ] as const) {
        if (value === null) element.removeAttribute(attribute);
        else element.setAttribute(attribute, value);
      }
      this.completionInput = null;
    }
  }
  private openFind(replace: boolean) {
    this.closePopup();
    this.find?.destroy();
    this.find = new FindPanel(
      {
        source: () => this.source,
        selection: () => this.selection,
        readOnly: () => this.options.readOnly(),
        select: (from, to) => this.focus(from, to),
        edit: (edit) => {
          this.edit(edit);
        },
        paint: () => this.paintPresence(),
        close: () => {
          this.find?.destroy();
          this.find = null;
          this.paintPresence();
          this.focus(this.selection.anchor, this.selection.head);
        },
      },
      replace,
    );
    this.dom.prepend(this.find.dom);
    this.find.focus();
    this.paintPresence();
  }
  private decorations(doc: ProseNode) {
    if (
      !this.projection ||
      (doc !== this.projection.doc &&
        doc.content.size !== this.projection.doc.content.size)
    )
      return DecorationSet.empty;
    const decorations: Decoration[] = [];
    if (this.options.appearance().blockGuides) {
      const ranges: {
        from: number;
        to: number;
        depth: number;
        type: string;
      }[] = [];
      const walk = (
        node: ProseNode,
        pos: number,
        depth: number,
        parent?: ProseNode,
      ) => {
        // Cells and a list item's sole paragraph already share their owner's
        // range. Distinct paragraph/container ranges get independent rails.
        const skip =
          ["table_row", "table_cell", "table_header"].includes(
            node.type.name,
          ) ||
          (node.isTextblock &&
            parent &&
            [
              "list_item",
              "blockquote",
              "callout",
              "footnote_definition",
            ].includes(parent.type.name) &&
            parent.firstChild === node);
        if (node.isBlock && !skip)
          ranges.push({
            from: pos,
            to: pos + node.nodeSize,
            depth,
            type: node.type.name,
          });
        if (!node.isLeaf && !node.isTextblock && node.type.name !== "table")
          node.forEach((child, offset) =>
            walk(child, pos + 1 + offset, depth + (skip ? 0 : 1), node),
          );
      };
      doc.forEach((node, offset) => walk(node, offset, 0));
      const head = this.projection.map.positionAt(this.selection.head);
      const active = ranges
        .filter((range) => head >= range.from && head <= range.to)
        .sort(
          (a, b) => b.depth - a.depth || a.to - a.from - (b.to - b.from),
        )[0];
      for (const range of ranges)
        decorations.push(
          Decoration.node(range.from, range.to, {
            class:
              "axiom-block-guide" +
              (range === active ? " axiom-block-guide-active" : ""),
            "data-block-depth": String(range.depth),
            "data-block-type": range.type,
          }),
        );
    }
    const activeImage = this.imageSource;
    if (activeImage && this.projection.imageSource) {
      const { session } = activeImage;
      const at = this.projection.map.positionAt(session.range.to, -1);
      const parent = doc.resolve(at);
      if (parent.parent.isTextblock) {
        const previewAt = parent.end();
        if (!activeImage.preview) {
          const source = () =>
            this.imageSource === activeImage ? session.preview() : undefined;
          activeImage.preview = this.makeImageView(source, true);
          activeImage.preview.dom.classList.add("axiom-image-edit-preview");
          this.previewNodes.set(activeImage.preview.dom, source);
          this.inlineRefresh.add(activeImage.preview.refresh);
        }
        decorations.push(
          Decoration.widget(previewAt, activeImage.preview.dom, {
            key: "image-preview-" + session.key,
            side: 1,
            marks: [],
            ignoreSelection: true,
            stopEvent: (event) => event.type !== "contextmenu",
          }),
        );
        // A styling hook on real source text, never a second editable field.
        for (const span of this.projection.map.spans) {
          const from = Math.max(span.sourceFrom, session.range.from);
          const to = Math.min(span.sourceTo, session.range.to);
          if (to > from)
            decorations.push(
              Decoration.inline(
                this.projection.map.positionAt(from),
                this.projection.map.positionAt(to, -1),
                { class: "axiom-image-source-text" },
              ),
            );
        }
      }
    }
    const sections = documentIndex(this.projection.parsed).sections;
    for (const block of this.projection.blocks) {
      const node = block.node;
      if (
        node.type === "heading" ||
        (node.type === "sourceProse" && node.kind === "heading")
      ) {
        const number = sections.get(node.key ?? "");
        if (number)
          decorations.push(
            Decoration.node(
              block.from,
              block.to,
              sectionNumberAttributes(number),
            ),
          );
      }
    }
    for (const match of this.find?.matches.slice(0, 1000) ?? []) {
      const from = this.projection.map.positionAt(match.from),
        to = this.projection.map.positionAt(match.to, -1);
      if (to > from)
        decorations.push(
          Decoration.inline(from, to, { class: "axiom-search-range" }),
        );
    }
    for (const range of this.options.annotations?.() ?? []) {
      const from = this.projection.map.positionAt(range.from),
        to = this.projection.map.positionAt(range.to, -1);
      if (to > from)
        decorations.push(
          Decoration.inline(from, to, {
            class: "axiom-discussion-range",
            "data-discussion-id": range.id,
            title: "Open anchored discussion",
          }),
        );
    }
    for (const peer of this.peers) {
      if (!peer.selection) continue;
      const { from, to } = selectionRange(peer.selection),
        a = this.projection.map.positionAt(from),
        b = this.projection.map.positionAt(to, -1);
      if (b > a)
        decorations.push(
          Decoration.inline(a, b, {
            class: "axiom-peer-range",
            style: `--peer-color:${peer.color}`,
          }),
        );
      const at = this.projection.map.positionAt(peer.selection.head);
      decorations.push(
        Decoration.widget(
          at,
          () => {
            const caret = document.createElement("span");
            caret.className = "axiom-peer-caret";
            caret.style.setProperty("--peer-color", peer.color);
            caret.dataset.clientId = String(peer.clientId);
            caret.title = peer.name;
            const name = document.createElement("span");
            name.textContent = peer.name;
            caret.append(name);
            return caret;
          },
          { key: "peer-" + peer.clientId, side: 1 },
        ),
      );
    }
    if (this.cellRange)
      for (const block of this.projection.blocks) {
        if (block.node.type !== "tableCell") continue;
        const table = this.tableAt(),
          range = this.cellRange;
        const selected = table?.model.rows
          .slice(range.row, range.endRow + 1)
          .some((row) =>
            row.cells
              .slice(range.column, range.endColumn + 1)
              .some((cell) => cell.from === block.node.from),
          );
        if (selected)
          decorations.push(
            Decoration.node(block.from, block.to, {
              class: "axiom-cell-selected",
            }),
          );
      }
    return DecorationSet.create(doc, decorations);
  }
  private paintPresence() {
    this.navigationChanged();
    const markers: TextMarker[] = [
      ...this.peers.flatMap((peer) =>
        peer.selection
          ? [
              {
                id: String(peer.clientId),
                ...selectionRange(peer.selection),
                head: peer.selection.head,
                color: peer.color,
                label: peer.name,
                kind: "peer" as const,
              },
            ]
          : [],
      ),
      ...(this.options.annotations?.() ?? []).map((annotation) => ({
        ...annotation,
        kind: "discussion" as const,
      })),
      ...(this.find?.matches.slice(0, 1000) ?? []).map((match, i) => ({
        ...match,
        id: "find-" + i,
        kind: "search" as const,
      })),
    ];
    if (!this.cmComposing) {
      this.sourceView?.markers(markers);
      this.embedded.forEach((view) => view.surface.markers(markers));
    }
    if (this.rich && !this.composing && !this.dragging)
      this.rich.view.setProps({
        decorations: (state) => this.decorations(state.doc),
      });
  }
  private toggleFold(block: ProjectedBlock, enter = false) {
    if (
      this.destroyed ||
      this.composing ||
      this.cmComposing ||
      this.dragging ||
      this.mode !== "write"
    )
      return;
    const current = this.projection?.blocks.find(
      (b) => b.node.from === block.node.from && b.node.type === block.node.type,
    );
    if (!current) return;
    this.closePopup();
    this.closeImageSource();
    this.focused = false;
    this.binding.blur();
    this.folds.toggle(current.node);
    if (
      !current.folded &&
      this.selection.anchor < current.node.to &&
      this.selection.head >= current.node.from
    ) {
      this.selection = { anchor: current.node.to, head: current.node.to };
      this.binding.select(this.selection, false);
    }
    this.refresh(false);
    if (enter && current.folded)
      this.focus(current.node.contentFrom ?? current.node.from);
    else this.folding.focus(current);
  }
  jumpToPeer(clientId: number) {
    const peer = this.peers.find((p) => p.clientId === clientId);
    if (!peer?.selection) return false;
    this.focus(peer.selection.anchor, peer.selection.head);
    return true;
  }
  destroy() {
    this.folding.clear();
    this.destroyed = true;
    this.footnotePreviews.destroy();
    this.closeImageSource();
    this.fields?.close(true, false);
    this.diagrams.destroy();
    this.generation++;
    this.abort.abort();
    this.unsubscribe();
    this.unpresence();
    this.closePopup();
    this.find?.destroy();
    this.find = null;
    this.menu?.();
    this.sourceView?.destroy();
    if (this.rich) void this.rich.destroy();
    this.rich = null;
    this.binding.destroy();
    this.dom.remove();
  }
}

/** The title is quiet chrome; all body nodes belong to the main editor. */
function footnoteView(
  owner: AxiomEditorView,
  node: ProseNode,
  getPos: () => number | undefined,
): NodeView {
  const dom = document.createElement("aside"),
    title = document.createElement("div"),
    contentDOM = document.createElement("div");
  dom.className = "axiom-footnote";
  title.className = "axiom-footnote-title";
  title.dataset.footnoteTitle = "true";
  title.contentEditable = "false";
  contentDOM.className = "axiom-footnote-body";
  const paint = () => {
    dom.dataset.footnoteDefinition = node.attrs.key;
    dom.setAttribute("aria-label", "Footnote " + node.attrs.key);
    title.textContent = "[^" + node.attrs.key + "]";
  };
  title.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    const definition = owner.embeddedNode(getPos());
    if (definition?.type === "footnoteDefinition")
      owner.focus(footnoteBody(owner.source, definition).offsets[0]);
  });
  paint();
  dom.append(title, contentDOM);
  return {
    dom,
    contentDOM,
    update: (next) => {
      if (next.type !== node.type) return false;
      node = next;
      paint();
      return true;
    },
    stopEvent: (event) => title.contains(event.target as Node),
    ignoreMutation: (mutation) => title.contains(mutation.target),
  };
}

/** Checking a task is an atomic source edit, not a request to edit its prose.
 * Keep browser activation outside PM selection handling and preserve the caret. */
function taskItemView(
  owner: AxiomEditorView,
  node: ProseNode,
  getPos: () => number | undefined,
): NodeView {
  const dom = document.createElement("li"),
    contentDOM = document.createElement("div"),
    checkbox =
      node.attrs.checked === null ? null : document.createElement("input");
  let pressed: {
    range: ReturnType<NativeBinding["relative"]>;
    value: string;
  } | null = null;
  const marker = () => {
    const item = owner.embeddedNode(getPos());
    if (item?.type !== "item" || item.checked === undefined) return null;
    const line = sourceLine(owner.source, item.from);
    const match = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+\[)([ xX])\]/.exec(
      owner.source.slice(item.from, line.to),
    );
    return match ? { at: item.from + match[1].length, value: match[2] } : null;
  };
  const paint = () => {
    if (!checkbox) return;
    checkbox.checked = !!node.attrs.checked;
    checkbox.disabled = owner.options.readOnly();
    checkbox.setAttribute(
      "aria-label",
      checkbox.checked ? "Mark task incomplete" : "Mark task complete",
    );
  };
  const remember = () => {
    const current = marker();
    pressed = current
      ? {
          range: owner.binding.relative({
            anchor: current.at,
            head: current.at + 1,
          }),
          value: current.value,
        }
      : null;
  };
  if (checkbox) {
    dom.className = "axiom-task document-task";
    contentDOM.className = "document-task-content";
    checkbox.type = "checkbox";
    checkbox.contentEditable = "false";
    checkbox.dataset.editorChrome = "true";
    checkbox.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (event.button === 0) {
        remember();
        event.preventDefault();
      }
    });
    checkbox.addEventListener("pointercancel", () => {
      pressed = null;
    });
    checkbox.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      if (event.button === 0) {
        if (!pressed) remember();
        event.preventDefault();
      }
    });
    checkbox.addEventListener("keydown", (event) => {
      if (event.key === " " && !event.repeat) remember();
    });
    // Do not cancel native click activation: cancelling it rolls back checked.
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", (event) => {
      event.stopPropagation();
      const current = marker(),
        bookmark = pressed,
        range = bookmark && owner.binding.absolute(bookmark.range);
      pressed = null;
      if (
        !current ||
        owner.structureLocked ||
        (bookmark &&
          (!range ||
            range.anchor !== current.at ||
            range.head !== current.at + 1 ||
            current.value !== bookmark.value ||
            !compareRelativePositions(
              bookmark.range.anchor,
              owner.binding.relative({
                anchor: current.at,
                head: current.at + 1,
              }).anchor,
            )))
      ) {
        paint();
        return;
      }
      const focused = document.activeElement === checkbox;
      owner.edit(
        {
          changes: [
            {
              from: current.at,
              to: current.at + 1,
              insert: current.value === " " ? "x" : " ",
            },
          ],
          selection: owner.selection,
        },
        "command",
        undefined,
        false,
      );
      paint();
      if (focused && checkbox.isConnected)
        checkbox.focus({ preventScroll: true });
    });
    paint();
    dom.append(checkbox);
  }
  dom.append(contentDOM);
  return {
    dom,
    contentDOM,
    update: (next) => {
      if (
        next.type !== node.type ||
        (next.attrs.checked === null) !== (node.attrs.checked === null)
      )
        return false;
      node = next;
      paint();
      return true;
    },
    stopEvent: (event) => !!checkbox && event.target === checkbox,
    ignoreMutation: (mutation) => !!checkbox && mutation.target === checkbox,
  };
}

/** A rendered source-backed unit, not an embedded text editor. Selecting the
 * whole range lets the existing delete/cut/undo path remove the rule directly. */
function dividerView(
  owner: AxiomEditorView,
  getPos: () => number | undefined,
): NodeView {
  const dom = document.createElement("section"),
    preview = document.createElement("div"),
    rule = document.createElement("hr");
  dom.className = "axiom-embedded axiom-divider";
  dom.dataset.kind = "hr";
  dom.contentEditable = "false";
  dom.tabIndex = 0;
  dom.setAttribute("role", "separator");
  dom.setAttribute("aria-label", "Divider");
  dom.setAttribute("aria-orientation", "horizontal");
  preview.className = "axiom-block-preview";
  rule.setAttribute("aria-hidden", "true");
  preview.append(rule);
  dom.append(preview);
  const select = () => {
    const node = owner.embeddedNode(getPos());
    if (node?.type !== "hr") return;
    if (owner.options.readOnly()) {
      owner.setSelection({ anchor: node.from, head: node.to });
      // A non-editable PM root is not focusable in every browser. Keep focus
      // on this separator so Backspace cannot become browser Back navigation.
      dom.focus({ preventScroll: true });
    } else owner.focus(node.from, node.to);
  };
  dom.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    select();
  });
  dom.addEventListener("focus", select);
  dom.addEventListener("keydown", (event) => {
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  return {
    dom,
    update: (node) =>
      node.type.name === "raw_block" && node.attrs.kind === "hr",
    stopEvent: () => true,
    ignoreMutation: () => true,
  };
}

class TableView implements NodeView {
  readonly dom = document.createElement("div");
  readonly contentDOM = document.createElement("tbody");
  private table = document.createElement("table");
  private scroll = document.createElement("div");
  private controls = document.createElement("div");
  private addRow: HTMLButtonElement;
  private addColumn: HTMLButtonElement;
  private alignment: HTMLButtonElement;
  private menu: HTMLButtonElement;
  private columns = document.createElement("colgroup");
  private widths: number[] = [];
  private abort = new AbortController();
  private drag: AbortController | null = null;
  constructor(
    private owner: AxiomEditorView,
    private node: ProseNode,
    private getPos: () => number | undefined,
  ) {
    this.dom.className = "axiom-table-shell";
    this.scroll.className = "axiom-table-scroll";
    this.controls.className = "axiom-table-controls";
    this.controls.dataset.editorChrome = "true";
    this.controls.contentEditable = "false";
    this.controls.role = "toolbar";
    this.controls.setAttribute("aria-label", "Table tools");
    this.alignment = iconButton("Column alignment", "alignLeft", () =>
      owner.tableControl(this, "alignment"),
    );
    const copy = iconButton("Copy table as TSV", "copy", () =>
      owner.tableControl(this, "copy"),
    );
    this.menu = iconButton("Table actions", "more", () =>
      owner.tableControl(this, "menu"),
    );
    this.menu.setAttribute("aria-haspopup", "dialog");
    this.alignment.setAttribute("aria-haspopup", "dialog");
    this.controls.append(this.alignment, copy, this.menu);
    this.addRow = iconButton("Add row at bottom", "plus", () =>
      owner.tableControl(this, "row"),
    );
    this.addColumn = iconButton("Add column at right", "plus", () =>
      owner.tableControl(this, "column"),
    );
    for (const [button, axis] of [
      [this.addRow, "row"],
      [this.addColumn, "column"],
    ] as const) {
      button.classList.add("axiom-table-edge");
      button.dataset.axis = axis;
      button.dataset.editorChrome = "true";
      button.contentEditable = "false";
    }
    this.table.append(this.columns, this.contentDOM);
    this.scroll.append(this.table);
    this.dom.append(this.controls, this.scroll, this.addRow, this.addColumn);
    owner.registerTable(this);
    this.update(node);
    this.dom.addEventListener(
      "mousedown",
      (event) => {
        if ((event.target as Element).closest("[data-editor-chrome]")) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      { signal: this.abort.signal, capture: true },
    );
    this.dom.addEventListener(
      "pointermove",
      (event) => {
        const box = this.scroll.getBoundingClientRect();
        this.dom.classList.toggle(
          "near-right",
          event.clientX >= box.right - 14,
        );
        this.dom.classList.toggle(
          "near-bottom",
          event.clientY >= box.bottom - 14,
        );
      },
      { signal: this.abort.signal },
    );
    this.dom.addEventListener(
      "pointerleave",
      () => {
        this.dom.classList.remove("near-right", "near-bottom", "can-resize");
      },
      { signal: this.abort.signal },
    );
    this.dom.addEventListener(
      "mousemove",
      (event) => {
        const cell = (event.target as Element).closest("td,th");
        this.dom.classList.toggle(
          "can-resize",
          !!cell &&
            Math.abs(event.clientX - cell.getBoundingClientRect().right) < 6,
        );
      },
      { signal: this.abort.signal },
    );
    this.dom.addEventListener(
      "mousedown",
      (event) => {
        const cell = (event.target as Element).closest<HTMLTableCellElement>(
          "td,th",
        );
        if (
          !cell ||
          (event.target as Element).closest("[data-editor-chrome]") ||
          event.button !== 0 ||
          Math.abs(event.clientX - cell.getBoundingClientRect().right) >= 6
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const column = cell.cellIndex,
          x = event.clientX,
          width = cell.getBoundingClientRect().width;
        if (!this.widths.length)
          this.widths = Array.from(
            this.table.rows[0]?.cells ?? [],
            (cell) => cell.getBoundingClientRect().width,
          );
        this.drag?.abort();
        this.drag = new AbortController();
        document.addEventListener(
          "mousemove",
          (event) => {
            this.widths[column] = Math.max(
              72,
              Math.min(1200, width + event.clientX - x),
            );
            this.applyWidths();
          },
          { signal: this.drag.signal },
        );
        document.addEventListener(
          "mouseup",
          () => {
            this.drag?.abort();
            this.drag = null;
          },
          { signal: this.drag.signal, once: true },
        );
      },
      { signal: this.abort.signal, capture: true },
    );
    this.dom.addEventListener(
      "dblclick",
      (event) => {
        if (!this.dom.classList.contains("can-resize")) return;
        event.preventDefault();
        this.widths = [];
        this.applyWidths();
      },
      { signal: this.abort.signal },
    );
  }
  sourceNode() {
    return this.owner.embeddedNode(this.getPos());
  }
  controlBounds(action: "alignment" | "menu") {
    return (
      action === "alignment" ? this.alignment : this.menu
    ).getBoundingClientRect();
  }
  configure() {
    const node = this.sourceNode();
    // Hover/focus chrome is presentation only. Capture Y-relative row identities
    // once when opening a menu, not for every caret move through a large table.
    const target = node && this.owner.tableCell(node);
    const current = node && tableModel(this.owner.source, node);
    const readOnly = this.owner.options.readOnly();
    this.dom.dataset.active = String(target?.row !== undefined);
    this.addRow.hidden = this.addColumn.hidden = readOnly;
    this.dom.dataset.readOnly = String(readOnly);
    const locked = this.owner.structureLocked
      ? "Finish editing before changing table structure."
      : undefined;
    disableIcon(
      this.addRow,
      locked ??
        (current && current.rows.length >= 1000
          ? "Tables support up to 1,000 rows."
          : undefined),
    );
    disableIcon(
      this.addColumn,
      locked ??
        (current && current.columns >= 100
          ? "Tables support up to 100 columns."
          : undefined),
    );
    disableIcon(
      this.alignment,
      readOnly
        ? "You have read-only access to this note."
        : target?.row === undefined
          ? "Select a cell in this table first."
          : locked,
    );
  }
  revealSelection() {
    requestAnimationFrame(() => {
      const cell = document
        .getSelection()
        ?.anchorNode?.parentElement?.closest("td, th");
      if (cell && this.contentDOM.contains(cell))
        cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }
  private applyWidths() {
    const count = this.node.firstChild?.childCount ?? 1;
    this.columns.replaceChildren(
      ...Array.from({ length: count }, (_, i) => {
        const col = document.createElement("col");
        if (this.widths[i]) col.style.width = this.widths[i] + "px";
        return col;
      }),
    );
    this.table.style.width = this.widths.length
      ? this.widths.reduce((sum, n) => sum + n, 0) + "px"
      : "100%";
    this.table.style.minWidth = count * 72 + "px";
  }
  update(node: ProseNode) {
    if (node.type.name !== "table") return false;
    const changed =
      node.firstChild?.childCount !== this.node.firstChild?.childCount;
    this.node = node;
    if (changed) this.widths = [];
    this.applyWidths();
    this.configure();
    return true;
  }
  ignoreMutation(mutation: { type: string; target: Node }) {
    return (
      mutation.type !== "selection" &&
      !this.contentDOM.contains(mutation.target)
    );
  }
  stopEvent(event: Event) {
    return !!(event.target as Element).closest?.("[data-editor-chrome]");
  }
  destroy() {
    this.owner.unregisterTable(this);
    this.abort.abort();
    this.drag?.abort();
  }
}

class EmbeddedView implements NodeView {
  readonly dom = document.createElement("section");
  readonly surface: TextSurface;
  private preview = document.createElement("div");
  private host = document.createElement("div");
  private controls = document.createElement("div");
  private lastPreview = "";
  private goodMath = "";
  private wrap: boolean | undefined;
  private numbers: boolean | undefined;
  private label = document.createElement("button");
  private languageDraft: (() => void) | null = null;
  constructor(
    private owner: AxiomEditorView,
    private node: ProseNode,
    private getPos: () => number | undefined,
  ) {
    this.dom.className = "axiom-embedded";
    this.dom.dataset.kind = node.attrs.kind;
    this.dom.contentEditable = "false";
    this.controls.className = "axiom-block-controls";
    this.controls.dataset.editorChrome = "true";
    this.controls.addEventListener("mousedown", (event) => {
      if ((event.target as Element).closest("button")) event.preventDefault();
    });
    this.preview.className = "axiom-block-preview";
    this.preview.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        this.preview.click();
      }
    });
    if (node.attrs.kind !== "codeBlock" || node.attrs.lang === "mermaid") {
      this.preview.role = "button";
      this.preview.tabIndex = 0;
      this.preview.setAttribute("aria-label", "Edit " + this.blockName());
    }
    this.host.className = "axiom-block-source";
    const label = this.label;
    label.type = "button";
    label.className = "axiom-language-label";
    label.setAttribute(
      "aria-label",
      node.attrs.kind === "codeBlock" ? "Change code language" : "Block type",
    );
    label.disabled =
      node.attrs.kind !== "codeBlock" || owner.options.readOnly();
    label.addEventListener("click", () => this.editLanguage());
    label.textContent =
      node.attrs.kind === "mathBlock"
        ? "TeX"
        : node.attrs.lang ||
          (node.type.name === "raw_block"
            ? node.attrs.kind + " · source"
            : "Plain text");
    const copy = iconButton("Copy block contents", "copy", () => {
      void navigator.clipboard
        .writeText(this.node.textContent)
        .catch(() => owner.options.message("Clipboard access was denied."));
    });
    const menu = iconButton("Block actions", "more", () => {
      const n = this.sourceNode();
      if (
        n &&
        (owner.selection.head < (n.contentFrom ?? n.from) ||
          owner.selection.head > (n.contentTo ?? n.to))
      )
        owner.setSelection({
          anchor: this.value().from,
          head: this.value().from,
        });
      const box = menu.getBoundingClientRect();
      owner.openMenu(box.left, box.bottom + 4);
    });
    menu.setAttribute("aria-haspopup", "menu");
    menu.setAttribute("aria-expanded", "false");
    this.controls.append(label, copy, menu);
    this.dom.append(this.controls, this.preview, this.host);
    this.surface = new TextSurface(this.host, {
      ...owner.textOptions(),
      value: this.value(),
      language: node.attrs.lang,
      label: this.sourceLabel(),
    });
    this.dom.addEventListener("focusin", () =>
      this.dom.classList.add("is-editing"),
    );
    this.dom.addEventListener("focusout", () =>
      queueMicrotask(() => {
        if (!this.dom.contains(document.activeElement))
          this.dom.classList.remove("is-editing");
      }),
    );
    this.preview.addEventListener("click", (event) => {
      if ((event.target as Element).closest("a")) return;
      const n = this.sourceNode();
      if (n) {
        this.dom.classList.add("is-editing");
        owner.focus(this.value().from);
      }
    });
    this.preview.addEventListener("axiom:math-rendered", (event) => {
      const target = event.target as HTMLElement,
        result = (event as CustomEvent<{ error?: string }>).detail;
      if (!result.error) this.goodMath = target.innerHTML;
      else if (
        owner.options.preferences().mathKeepLastPreview &&
        this.goodMath
      ) {
        target.innerHTML = this.goodMath;
        target.dataset.mathState = "stale";
        target.title = "Last valid preview · " + result.error;
      }
    });
    owner.register(this);
    this.updatePreview();
  }
  sourceNode() {
    return this.owner.embeddedNode(this.getPos());
  }
  private blockName() {
    return (
      (
        {
          mathBlock: "display equation",
          hr: "divider",
          toc: "table of contents",
          frontmatter: "document metadata",
          footnoteDefinition: "footnote definition",
          referenceDefinition: "link definition",
        } as Record<string, string>
      )[this.node.attrs.kind] ??
      (this.node.attrs.lang === "mermaid" ? "diagram" : "code block")
    );
  }
  private sourceLabel() {
    return this.node.attrs.kind === "mathBlock"
      ? "Equation TeX source"
      : this.blockName().replace(/^./, (c) => c.toUpperCase()) + " source";
  }
  private editLanguage() {
    const node = this.sourceNode();
    if (!node || this.owner.options.readOnly()) return;
    const match = /^([ \t]*(?:`{3,}|~{3,})[ \t]*)([\w+#.-]*)/.exec(
      this.owner.source.slice(node.from, node.contentFrom),
    );
    if (!match) return;
    const source = this.owner.source,
      from = node.from + match[1].length,
      to = from + match[2].length;
    const bookmark = this.owner.binding.relative({ anchor: from, head: to });
    const input = document.createElement("input");
    input.value = match[2];
    input.maxLength = 40;
    input.setAttribute("aria-label", "Code language");
    input.className = "axiom-language-input";
    this.label.hidden = true;
    this.controls.prepend(input);
    input.focus();
    input.select();
    let closed = false;
    const close = (restore = true) => {
      if (closed) return;
      closed = true;
      this.languageDraft = null;
      suggestions?.destroy();
      input.remove();
      this.label.hidden = false;
      if (restore) this.surface.focus(this.owner.selection);
    };
    this.languageDraft = () => {
      if (closed) return;
      if (input.value !== match[2]) {
        this.owner.options.recover(
          source.slice(0, from) + input.value + source.slice(to),
        );
        this.owner.options.message(
          "Your code-language draft was retained for recovery.",
        );
      }
      closed = true;
      this.languageDraft = null;
      suggestions?.destroy();
      input.remove();
      this.label.hidden = false;
    };
    const commit = (value: string) => {
      if (closed || this.owner.options.readOnly()) return;
      input.value = value;
      if (!/^[\w+#.-]{0,40}$/.test(value)) {
        input.setCustomValidity(
          "Use a language name such as python, julia, cpp or mermaid.",
        );
        input.reportValidity();
        return;
      }
      const range = this.owner.binding.absolute(bookmark);
      if (
        !range ||
        this.owner.source.slice(range.anchor, range.head) !== match[2]
      ) {
        this.owner.options.recover(
          source.slice(0, from) + input.value + source.slice(to),
        );
        this.owner.options.message(
          "This language field changed remotely. Your draft was retained for recovery.",
        );
        close();
        return;
      }
      const body = this.value();
      const caret =
        this.owner.selection.head >= body.from &&
        this.owner.selection.head <=
          (body.offsets?.at(-1) ?? body.from + body.text.length)
          ? this.owner.selection.head
          : body.from;
      close(false);
      const changes = [{ from: range.anchor, to: range.head, insert: value }];
      this.owner.edit(
        {
          changes,
          selection: {
            anchor: mapPosition(caret, changes),
          },
        },
        "command",
        "code-language",
      );
    };
    const suggestions = languageMenu(input, commit);
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (suggestions?.keydown(event)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        commit(input.value);
      }
    });
    input.addEventListener("input", () => input.setCustomValidity(""));
    input.addEventListener("blur", () => {
      if (!closed && input.isConnected) {
        close(false);
      }
    });
  }
  private value() {
    const node = this.sourceNode();
    if (!node) return { text: this.node.textContent, from: 0 };
    if (this.node.type.name === "raw_block")
      return {
        text: this.owner.source.slice(node.from, node.to),
        from: node.from,
      };
    const body = literalBody(this.owner.source, node);
    return {
      text: body.text,
      from: body.offsets[0],
      offsets: body.offsets,
      prefix: literalPrefix(this.owner.source, node),
      lineEnding: sourceLine(this.owner.source, node.from).ending,
    };
  }
  refreshSource() {
    this.surface.update(this.value(), this.owner.selection);
    this.updatePreview();
  }
  update(node: ProseNode) {
    if (
      node.type !== this.node.type ||
      node.attrs.kind !== this.node.attrs.kind
    )
      return false;
    this.node = node;
    this.label.textContent =
      node.attrs.kind === "mathBlock"
        ? "TeX"
        : node.attrs.lang ||
          (node.type.name === "raw_block"
            ? node.attrs.kind + " · source"
            : "Plain text");
    this.surface.update(this.value(), this.owner.selection);
    this.configure();
    this.updatePreview();
    return true;
  }
  configure() {
    if (this.owner.options.readOnly()) this.languageDraft?.();
    this.label.disabled =
      this.node.attrs.kind !== "codeBlock" || this.owner.options.readOnly();
    this.surface.configure({
      ...this.owner.textOptions(),
      language:
        this.node.attrs.kind === "frontmatter" ? "yaml" : this.node.attrs.lang,
      wrap: this.wrap ?? this.owner.options.preferences().codeWrap,
      numbers: this.numbers ?? this.owner.options.preferences().codeLineNumbers,
    });
    this.surface.view.contentDOM.setAttribute("aria-label", this.sourceLabel());
    this.preview.setAttribute(
      "aria-disabled",
      String(this.owner.options.readOnly()),
    );
    this.updatePreview();
  }
  display(id: string) {
    if (id === "resetCodeDisplay") this.wrap = this.numbers = undefined;
    else if (id === "codeWrap")
      this.wrap = !(this.wrap ?? this.owner.options.preferences().codeWrap);
    else
      this.numbers = !(
        this.numbers ?? this.owner.options.preferences().codeLineNumbers
      );
    this.configure();
  }
  updatePreview() {
    const node = this.sourceNode();
    const specialized =
      node &&
      [
        "mathBlock",
        "hr",
        "toc",
        "frontmatter",
        "footnoteDefinition",
        "referenceDefinition",
      ].includes(node.type);
    const diagram = node?.type === "codeBlock" && node.lang === "mermaid";
    if (diagram) {
      this.preview.dataset.visualKind = "mermaid";
      this.preview.dataset.visualFrom = String(node.from);
      this.preview.dataset.visualTo = String(node.to);
    } else {
      delete this.preview.dataset.visualKind;
      delete this.preview.dataset.visualFrom;
      delete this.preview.dataset.visualTo;
    }
    if (
      !node ||
      (!specialized && !diagram) ||
      (node.type === "mathBlock" &&
        !this.owner.options.preferences().mathPreview)
    ) {
      this.preview.hidden = true;
      this.dom.dataset.preview = "false";
      delete this.preview.dataset.mermaid;
      return;
    }
    this.preview.hidden = false;
    this.preview.role = "button";
    this.preview.tabIndex = 0;
    this.preview.setAttribute("aria-label", "Edit " + this.blockName());
    this.dom.dataset.preview = "true";
    const source = this.owner.source.slice(node.from, node.to);
    const math = this.preview.querySelector<HTMLElement>(".math-block");
    if (math) math.dataset.mathFrom = String(node.from);
    const key = JSON.stringify([source, this.owner.previewKey()]);
    if (key === this.lastPreview) return;
    this.lastPreview = key;
    this.label.textContent =
      node.type === "codeBlock"
        ? "Mermaid"
        : this.blockName().replace(/^./, (c) => c.toUpperCase()) +
          (node.key ? " · " + node.key : "");
    if (diagram) {
      this.preview.dataset.mermaid = node.text ?? "";
      return;
    }
    delete this.preview.dataset.mermaid;
    const html = this.owner.renderFragment(node);
    if (node.type === "mathBlock")
      paintMathPreview(
        this.preview,
        html,
        this.owner.options.preferences().mathKeepLastPreview,
      );
    else this.preview.innerHTML = html;
    if (node.type === "frontmatter") {
      const fields = source
        .split(/\r?\n/)
        .flatMap((line) => /^[\w.-]+(?=\s*:)/.exec(line)?.[0] ?? []);
      this.preview.innerHTML = `<span class="axiom-metadata-summary">${fields.length} ${fields.length === 1 ? "field" : "fields"}${fields.length ? " · " + escapeHtml(fields.slice(0, 4).join(", ")) : ""}${fields.length > 4 ? "…" : ""}</span>`;
    }
  }
  stopEvent() {
    return true;
  }
  ignoreMutation() {
    return true;
  }
  destroy() {
    this.owner.unregister(this);
    this.languageDraft?.();
    this.surface.destroy();
  }
}
