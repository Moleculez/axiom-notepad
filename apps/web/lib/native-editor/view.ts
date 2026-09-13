import {
  MarkdownEngine,
  adoptMarkdownCommandDocument,
  parseMarkdown,
  renderDocument,
  nodeAt,
  sourceCommand,
  minimalChange,
  tableModel,
  tableAction,
  moveTableAxis,
  parseTSV,
  writeTSV,
  escapeCell,
  slashQuery,
  type SourceEdit,
  type ParsedDocument,
  type RenderContext,
  type MarkdownNode,
  type TextChange,
} from "@axiom/markdown";
import {
  editorCommands,
  commandById,
  eventBinding,
  keysFor,
  shortcutPlatform,
  shortcutLabel,
  type EditorCommandId,
  type EditorPreferences,
} from "@axiom/shared/editor";
import type { Preferences } from "@axiom/shared/appearance";
import { NativeBinding, type PeerSelection } from "./binding";
import { openContextMenu } from "../context-menu";
import { editorCommandIcons } from "../icons/editor-commands";
import { appendActionLabel, type ActionIconName } from "../icons/actions";
import { footnoteTooltips } from "../footnote-tooltips";
import { footnoteAt } from "@axiom/editor/footnotes";
import { preserveLineEndings } from "@axiom/editor/line-endings";
import { installEditorLinkNavigation } from "../editor-links";
import { nativeCompletions } from "./completions";
import { mathSymbolIcon } from "../icons/math-symbols";
import { literalBody, literalPrefix } from "./literal";
import { htmlMarkdown, htmlTableGrid } from "./clipboard";
import { SourceDOMMap, reconcileBlock, type MappedBlock } from "./selection";
import { renderBlock } from "./render";
import {
  editingProjection,
  EditingSession,
  isDraftHeader,
  intersects,
} from "./projection";
import { OwnedPairs } from "./pairs";
import { boundaryDelete, literalDelete, rangeDelete } from "./deletion";
import {
  applyChanges,
  clampSelection,
  enterEdit,
  codeLineEdit,
  graphemeBoundary,
  indentList,
  lineAt,
  replacement,
  selectionRange,
  mapPosition,
  type SourceSelection,
  type NativeTransaction,
} from "./transactions";

export type CommandArguments = {
  wholeBlock?: boolean;
  from?: number;
  to?: number;
  rows?: number;
  columns?: number;
  value?: string;
};
export type NativeEditorOptions = {
  mode: () => "write" | "source" | "read";
  preferences: () => EditorPreferences;
  appearance: () => Preferences;
  context: () => RenderContext;
  readOnly: () => boolean;
  workspace: (id: EditorCommandId) => void;
  message: (message: string) => void;
  recover: (source: string) => void;
  prepare: (range?: { from: number; to: number }) => void;
  navigate: (position: number) => void;
  link: (target: string) => void;
  changed: (source: string, parsed: ParsedDocument) => void;
  notes: () => { id: string; title: string }[];
  files?: (files: File[]) => void;
  /** Optional completion boundary for an embedded editor such as a Canvas card. */
  exit?: () => void;
  annotations?: () => import("@axiom/editor/annotations").SourceAnnotation[];
  annotation?: (id: string) => void;
};
type Composition = {
  before: ReturnType<SourceDOMMap["capture"]>;
  source: string;
  positions: Map<number, ReturnType<NativeBinding["relative"]>>;
  selection: SourceSelection;
  container: ReturnType<NativeBinding["relative"]>;
  containerText: string;
};
type CellRange = {
  table: number;
  row: number;
  column: number;
  endRow: number;
  endColumn: number;
};
const inlineTypes = new Set([
  "em",
  "strong",
  "strike",
  "highlight",
  "code",
  "link",
  "mathInline",
  "image",
  "wikiLink",
  "citation",
  "equationRef",
  "footnoteRef",
  "subscript",
  "superscript",
  "underline",
  "emoji",
  "mathBlock",
  "hr",
]);

/** A first-party, source-mapped DOM editor. React owns only its host. */
export class NativeEditorView {
  readonly dom: HTMLDivElement;
  readonly content: HTMLDivElement;
  readonly overlay: HTMLDivElement;
  readonly map: SourceDOMMap;
  readonly engine = new MarkdownEngine();
  source = "";
  parsed: ParsedDocument = parseMarkdown("");
  selection: SourceSelection = { anchor: 0, head: 0 };
  private blocks: MappedBlock[] = [];
  private codeOverrides = new Map<
    number,
    { wrap?: boolean; numbers?: boolean }
  >();
  private abort = new AbortController();
  private tableWidths = new Map<number, number[]>();
  private tableDrag: {
    table: number;
    axis: "row" | "column";
    index: number;
    location: ReturnType<NativeBinding["relative"]>;
    original: string;
  } | null = null;
  private textDrag: {
    location: ReturnType<NativeBinding["relative"]>;
    original: string;
  } | null = null;
  private resizeObserver: ResizeObserver;
  private unsubscribe: () => void;
  private unpresence: () => void;
  private composition: Composition | null = null;
  private nativeFallback = false;
  private fallbackInsert: string | undefined;
  private metadataDrafts = new WeakMap<
    HTMLInputElement,
    {
      location: ReturnType<NativeBinding["relative"]>;
      header: ReturnType<NativeBinding["relative"]>;
      headerText: string;
      original: string;
      source: string;
      from: number;
      to: number;
    }
  >();
  private snippet: {
    fields: ReturnType<NativeBinding["relative"]>[];
    end: ReturnType<NativeBinding["relative"]>;
    index: number;
  } | null = null;
  private focused = false;
  private restoring = false;
  private pointerSelecting = false;
  private pointerChanges: TextChange[][] = [];
  private restoreEpoch = 0;
  private mappedRevision = -1;
  private destroyed = false;
  private footnotePreviews: ReturnType<typeof footnoteTooltips>;
  private force = false;
  private revision = 0;
  private popup: HTMLElement | null = null;
  private popupKind = "";
  private popupIndex = 0;
  private menuDismiss: (() => void) | null = null;
  private menuOpen = false;
  private selectionBar: HTMLElement | null = null;
  private selectionTimer: ReturnType<typeof setTimeout> | undefined;
  private sourceGutter: HTMLElement | null = null;
  private dismissQuery = "";
  private cellRange: CellRange | null = null;
  private cellHint: { table: number; row: number; column: number } | null =
    null;
  private peers: PeerSelection[] = [];
  private paintFrame = 0;
  private inputStarted = 0;
  private lastGoodMath = new Map<number, string>();
  private pairs: OwnedPairs;
  private editing: EditingSession;
  constructor(
    parent: HTMLElement,
    readonly binding: NativeBinding,
    readonly options: NativeEditorOptions,
  ) {
    this.pairs = new OwnedPairs(binding);
    this.editing = new EditingSession(binding);
    this.dom = document.createElement("div");
    this.dom.className = "native-editor";
    this.content = document.createElement("div");
    this.content.className = "native-content prose";
    this.content.role = "textbox";
    this.content.setAttribute("aria-multiline", "true");
    this.content.setAttribute("aria-label", "Research note editor");
    this.content.dataset.testid = "note-editor";
    this.content.setAttribute("autocorrect", "off");
    this.content.tabIndex = 0;
    this.overlay = document.createElement("div");
    this.overlay.className = "native-presence-layer";
    this.overlay.setAttribute("aria-hidden", "true");
    this.dom.append(this.content, this.overlay);
    parent.append(this.dom);
    this.footnotePreviews = footnoteTooltips({
      root: this.dom,
      document: () => this.parsed,
      context: () => this.options.context(),
    });
    this.map = new SourceDOMMap(this.content);
    const on = (
      target: EventTarget,
      name: string,
      handler: EventListener,
      capture = false,
    ) =>
      target.addEventListener(name, handler, {
        signal: this.abort.signal,
        capture,
      });
    on(this.content, "beforeinput", this.beforeInput as EventListener);
    on(this.content, "input", this.input as EventListener);
    on(this.content, "keydown", this.keydown as EventListener);
    on(this.content, "compositionstart", this.compositionStart);
    on(this.content, "compositionend", this.compositionEnd);
    on(document, "selectionchange", this.selectionChanged);
    on(this.content, "focusin", this.focusIn);
    on(this.content, "focusout", this.focusOut);
    installEditorLinkNavigation(
      this.content,
      (event) => {
        const link = (event.target as Element).closest<HTMLElement>(
          "a[href], a[data-note-target]",
        );
        return link
          ? (link.dataset.noteTarget ?? link.getAttribute("href"))
          : null;
      },
      (target) => this.options.link(target),
      this.abort.signal,
    );
    on(this.content, "mousedown", this.pointerDown as EventListener);
    on(document, "mouseup", this.finishPointerSelection);
    on(this.content, "click", this.click as EventListener);
    on(this.content, "contextmenu", this.contextMenu as EventListener);
    on(this.content, "change", this.change as EventListener);
    on(this.content, "paste", this.paste as EventListener);
    on(this.content, "copy", this.copy as EventListener);
    on(this.content, "cut", this.cut as EventListener);
    on(this.content, "dragstart", ((event: DragEvent) => {
      const grip = (event.target as Element).closest<HTMLElement>(
        "[data-move-axis]",
      );
      if (grip && !this.options.readOnly()) {
        const table = grip.closest<HTMLElement>("[data-block='table']")!;
        const from = Number(table.dataset.nfrom),
          to = Number(table.dataset.nto);
        this.tableDrag = {
          table: from,
          axis: grip.dataset.moveAxis as "row" | "column",
          index: Number(grip.dataset.moveIndex),
          location: this.binding.relative({ anchor: from, head: to }),
          original: this.source.slice(from, to),
        };
        event.dataTransfer?.setData(
          "application/x-axiom-table-axis",
          this.tableDrag.axis,
        );
        return;
      }
      const { from, to } = selectionRange(this.selection);
      if (event.dataTransfer && from !== to) {
        this.textDrag = {
          location: this.binding.relative({ anchor: from, head: to }),
          original: this.source.slice(from, to),
        };
        event.dataTransfer.setData("text/plain", this.source.slice(from, to));
        event.dataTransfer.setData(
          "text/x-axiom-markdown",
          this.source.slice(from, to),
        );
      }
    }) as EventListener);
    on(this.content, "dragend", () => {
      this.tableDrag = null;
      this.textDrag = null;
    });
    on(this.content, "drop", this.drop as EventListener);
    on(this.content, "dragover", ((event: DragEvent) => {
      if (!this.options.readOnly()) event.preventDefault();
    }) as EventListener);
    on(this.content, "axiom:math-rendered", this.mathRendered);
    on(window, "resize", this.schedulePresence);
    on(document, "scroll", this.schedulePresence, true);
    on(document, "pointerdown", ((event: PointerEvent) => {
      if (
        this.popup &&
        !this.popup.contains(event.target as Node) &&
        !this.content.contains(event.target as Node)
      )
        this.closePopup();
    }) as EventListener);
    this.unsubscribe = binding.subscribe((source, selection, local) => {
      const field = document.activeElement;
      if (
        !local &&
        field instanceof HTMLInputElement &&
        this.content.contains(field)
      ) {
        const draft = this.metadataDrafts.get(field),
          header = draft && this.binding.absolute(draft.header);
        if (
          draft &&
          (!header ||
            source.slice(header.anchor, header.head) !== draft.headerText)
        ) {
          if (field.value !== draft.original.trim()) {
            const value =
              field.dataset.metadataFrom !== undefined
                ? " " + field.value.trim()
                : field.value;
            this.options.recover(
              draft.source.slice(0, draft.from) +
                value +
                draft.source.slice(draft.to),
            );
            this.options.message(
              "This block header changed remotely. Your uncommitted text was retained for recovery.",
            );
          }
          this.metadataDrafts.delete(field);
          field.blur();
        }
      }
      const change = minimalChange(this.source, source);
      if (this.pointerSelecting) this.pointerChanges.push([change]);
      if (!local) this.pairs.beforeChange([change], true);
      this.pairs.rebase();
      for (const map of [
        this.codeOverrides,
        this.tableWidths,
        this.lastGoodMath,
      ] as Map<number, unknown>[]) {
        const entries = Array.from(map);
        map.clear();
        for (const [position, value] of entries)
          if (!(
            change.to > change.from &&
            position >= change.from &&
            position < change.to
          ))
            map.set(mapPosition(position, [change]), value);
      }
      this.source = source;
      this.selection = selection;
      this.revision++;
      if (!this.composition) this.render(local || this.focused);
      this.options.changed(source, this.engine.parse(source));
    });
    this.unpresence = binding.onPresence((peers) => {
      this.peers = peers;
      this.schedulePresence();
    });
    this.source = binding.source;
    this.selection = binding.selection();
    this.resizeObserver = new ResizeObserver(() => {
      if (
        this.options.mode() === "source" &&
        this.options.appearance().lineNumbers
      )
        this.updateSourceChrome();
      this.schedulePresence();
    });
    this.resizeObserver.observe(this.content);
    this.configure();
  }
  get hasFocus() {
    return this.focused;
  }
  get scrollDOM() {
    return (
      this.content.closest<HTMLElement>(
        ".ws-document-scroll, .document-scroll",
      ) ?? this.dom
    );
  }
  configure() {
    this.force = true;
    this.content.contentEditable = String(!this.options.readOnly());
    this.content.setAttribute("aria-readonly", String(this.options.readOnly()));
    this.content.spellcheck = this.options.mode() !== "source";
    if (this.options.mode() === "read") {
      this.focused = false;
      this.binding.blur();
    }
    this.dom.dataset.mode = this.options.mode();
    this.dom.dataset.wrap = String(this.options.appearance().codeWrap);
    this.dom.dataset.activeLine = String(this.options.appearance().activeLine);
    this.dom.dataset.sourceNumbers = String(
      this.options.appearance().lineNumbers,
    );
    this.dom.dataset.typewriter = String(this.options.preferences().typewriter);
    if (!this.composition) this.render(this.focused);
  }
  focus(position = this.selection.head, head = position) {
    this.focused = true;
    this.selection = clampSelection(
      { anchor: position, head },
      this.source.length,
    );
    this.binding.select(this.selection);
    this.render(true);
    this.content.focus({ preventScroll: true });
    this.restoreSelection();
    this.scrollSelection();
    this.options.navigate(this.selection.head);
  }
  setSelection(selection: SourceSelection, focus = false) {
    this.selection = clampSelection(selection, this.source.length);
    this.binding.select(this.selection, focus || this.focused);
    if (focus) this.focus(this.selection.anchor, this.selection.head);
    else this.render(false);
  }
  position() {
    return this.selection.head;
  }
  visiblePosition(viewportY: number) {
    if (this.options.mode() === "source") {
      const lines = this.content.querySelectorAll<HTMLElement>(
        ".native-source-line",
      );
      let low = 0,
        high = lines.length - 1;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (lines[mid].getBoundingClientRect().bottom < viewportY)
          low = mid + 1;
        else high = mid;
      }
      return Number(
        lines[low]?.firstElementChild?.getAttribute("data-nfrom") ?? 0,
      );
    }
    for (const block of this.blocks)
      if (block.element.getBoundingClientRect().bottom >= viewportY)
        return block.from;
    return this.source.length;
  }
  jumpToPeer(clientId: number) {
    const peer = this.peers.find((p) => p.clientId === clientId);
    if (!peer?.selection) return false;
    const el = this.blocks.find(
      (b) => peer.selection!.head >= b.from && peer.selection!.head <= b.to,
    )?.element;
    el?.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    return !!el;
  }
  private render(restore: boolean) {
    if (this.destroyed || this.composition || this.pointerSelecting) return;
    this.parsed = this.engine.parse(this.source);
    this.footnotePreviews.refresh();
    adoptMarkdownCommandDocument(this.source, this.parsed);
    this.dom.dataset.large = String(this.source.length > 200_000);
    const sourceMode = this.options.mode() === "source";
    const table = this.tableAt();
    const activeCell = table
      ? { table: table.node.from, row: table.row, column: table.column }
      : undefined;
    const nodes: MarkdownNode[] = [];
    if (sourceMode)
      nodes.push({ type: "source", from: 0, to: this.source.length });
    else {
      let at = 0;
      const projection = editingProjection(
        this.source,
        this.parsed,
        this.selection,
        this.focused && !this.options.readOnly(),
        this.editing.header(),
      );
      if (!this.menuOpen) this.editing.capture(projection, this.selection);
      for (const n of projection) {
        if (at < n.from)
          nodes.push({
            type: this.source.slice(at, n.from).trim() ? "source" : "gap",
            from: at,
            to: n.from,
          });
        nodes.push(n);
        at = n.to;
      }
      if (
        at < this.source.length ||
        !nodes.length ||
        this.source.endsWith("\n")
      )
        nodes.push({
          type: this.source.slice(at).trim() ? "source" : "gap",
          from: at,
          to: this.source.length,
        });
    }
    const candidates = new Map<string, MappedBlock[]>();
    if (!this.force)
      for (const old of this.blocks) {
        const key = old.signature;
        const list = candidates.get(key) ?? [];
        list.push(old);
        candidates.set(key, list);
      }
    const next: MappedBlock[] = [];
    const claimed = new Set<MappedBlock>();
    const consumed = new Map<string, number>();
    const previousByStart = new Map(
      this.blocks.map((block) => [block.from, block]),
    );
    for (const n of nodes) {
      const raw = this.source.slice(n.from, n.to);
      const active: string[] = [];
      const visit = (child: MarkdownNode) => {
        const inSelection =
          this.focused &&
          intersects(
            this.selection,
            lineAt(this.source, child.from).from,
            child.to,
          );
        if (inSelection && child.type === "table")
          active.push(
            "cells:" +
              (this.selection.anchor - n.from) +
              ":" +
              (this.selection.head - n.from) +
              ":" +
              activeCell?.row +
              ":" +
              activeCell?.column,
          );
        if (child.type === "editingParagraph")
          active.push(
            "prose:" + (child.from - n.from) + ":" + (child.to - n.from),
          );
        if (inSelection && ["paragraph", "heading"].includes(child.type)) {
          const first = child.contentFrom ?? child.from;
          const last = child.contentTo ?? child.to;
          if (
            [this.selection.anchor, this.selection.head].some(
              (at) => at < first || at > last,
            )
          )
            active.push(
              "prose-edge:" +
                (this.selection.anchor - n.from) +
                ":" +
                (this.selection.head - n.from),
            );
        }
        if (this.focused && ["codeBlock", "mathBlock"].includes(child.type)) {
          const line = lineAt(this.source, child.from);
          const range = selectionRange(this.selection);
          if (range.to >= line.from && range.from <= line.to)
            active.push("fence-header:" + (child.from - n.from));
        }
        if (
          this.focused &&
          [this.selection.anchor, this.selection.head].some(
            (at) => at >= child.from && at <= child.to,
          )
        ) {
          if (inlineTypes.has(child.type))
            active.push(child.type + (child.from - n.from));
          if (
            child.type === "text" &&
            child.text !== this.source.slice(child.from, child.to)
          )
            active.push("literal:" + (child.from - n.from));
          if (child.type === "table")
            active.push("cell-caret:" + (this.selection.head - n.from));
        }
        if (inSelection) child.children?.forEach(visit);
      };
      visit(n);
      const contextual = n.type === "toc" || /\$|\[\^|\[@|\\eqref\{/.test(raw);
      const signature =
        n.type +
        ":" +
        (n.key ?? "") +
        ":" +
        (contextual ? this.revision : "") +
        ":" +
        active.join(",") +
        ":" +
        raw;
      const queue = candidates.get(signature);
      let index = consumed.get(signature) ?? 0;
      while (queue?.[index] && claimed.has(queue[index])) index++;
      const old = queue?.[index];
      consumed.set(signature, index + 1);
      let block: MappedBlock;
      if (old) {
        claimed.add(old);
        const shift = n.from - old.from;
        if (shift) {
          for (const map of old.maps) {
            map.from += shift;
            map.to += shift;
            map.shift = (map.shift ?? 0) + shift;
          }
          for (const el of [
            old.element,
            ...old.element.querySelectorAll<HTMLElement>(
              "[data-block], [data-atom], li, td, th, [data-task-from], [data-language-from], [data-math-from], [data-metadata-from], [data-callout-from]",
            ),
          ])
            for (const key of [
              "nfrom",
              "nto",
              "taskFrom",
              "languageFrom",
              "mathFrom",
              "metadataFrom",
              "calloutFrom",
            ])
              if (el.dataset[key] !== undefined)
                el.dataset[key] = String(Number(el.dataset[key]) + shift);
        }
        block = { ...old, from: n.from, to: n.to };
      } else if (n.type === "gap") {
        block = renderBlock(
          {
            ...n,
            type: "paragraph",
            text: raw,
            contentFrom: n.from,
            contentTo: n.to,
          },
          {
            source: this.source,
            parsed: this.parsed,
            context: this.options.context(),
            selection: this.selection,
            focused: this.focused,
            sourceMode: false,
            preferences: this.options.preferences(),
            readOnly: this.options.readOnly(),
            codeOverrides: this.codeOverrides,
            tableWidths: this.tableWidths,
          },
        );
        block.element.classList.add("native-gap");
      } else {
        block = renderBlock(n, {
          source: this.source,
          parsed: this.parsed,
          context: this.options.context(),
          selection: this.selection,
          focused: this.focused,
          sourceMode: sourceMode || n.type === "source",
          preferences: this.options.preferences(),
          readOnly: this.options.readOnly(),
          codeOverrides: this.codeOverrides,
          tableWidths: this.tableWidths,
          activeCell,
        });
      }
      if (!old) {
        const prior = previousByStart.get(n.from);
        if (
          prior &&
          !claimed.has(prior) &&
          prior.element.tagName === block.element.tagName
        ) {
          claimed.add(prior);
          block = reconcileBlock(prior, block);
        }
      }
      block.signature = signature;
      if (n.type === "gap")
        block.element.classList.toggle(
          "is-active",
          this.focused &&
            this.selection.head >= n.from &&
            this.selection.head <= n.to,
        );
      next.push(block);
    }
    // Move/reuse unaffected DOM; a keystroke does not replace the document tree.
    let cursor = this.content.firstChild;
    for (const block of next) {
      if (block.element === cursor) cursor = cursor.nextSibling;
      else this.content.insertBefore(block.element, cursor);
    }
    while (cursor) {
      const after = cursor.nextSibling;
      cursor.remove();
      cursor = after;
    }
    this.blocks = next;
    this.force = false;
    this.map.reset(next.flatMap((b) => b.maps));
    this.mappedRevision = this.revision;
    if (restore && this.focused) this.ensureEditableSelection();
    this.paintRange();
    this.updateSourceChrome();
    if (restore && this.focused) this.restoreSelection();
    this.schedulePresence();
    if (this.focused) this.completions();
    this.updateSelectionBar();
    this.renderDiagrams();
    if (this.inputStarted) {
      const started = this.inputStarted,
        revision = this.revision;
      this.inputStarted = 0;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!this.destroyed)
            this.dom.dispatchEvent(
              new CustomEvent("axiom:editor-paint", {
                bubbles: true,
                detail: {
                  duration: performance.now() - started,
                  length: this.source.length,
                  revision,
                },
              }),
            );
        }),
      );
    }
  }
  /** Missing source positions are revealed in their own block. Never silently
   * relocate a keystroke to a neighbouring paragraph or the end of the note. */
  private ensureEditableSelection() {
    for (const position of [this.selection.anchor, this.selection.head]) {
      if (this.map.domPosition(position)) continue;
      const index = this.blocks.findIndex(
        (block) => position >= block.from && position <= block.to,
      );
      const prior = this.blocks[index];
      if (!prior) continue;
      const block = renderBlock(
        { type: "source", from: prior.from, to: prior.to },
        {
          source: this.source,
          parsed: this.parsed,
          context: this.options.context(),
          selection: this.selection,
          focused: this.focused,
          sourceMode: true,
          preferences: this.options.preferences(),
          readOnly: this.options.readOnly(),
          codeOverrides: this.codeOverrides,
          tableWidths: this.tableWidths,
        },
      );
      block.signature = prior.signature + ":exact-selection";
      block.element.classList.add("native-selection-source");
      prior.element.replaceWith(block.element);
      this.blocks[index] = block;
      this.map.reset(this.blocks.flatMap((b) => b.maps));
    }
  }
  private restoreSelection() {
    const epoch = ++this.restoreEpoch;
    this.restoring = true;
    this.map.restore(this.selection);
    const { from, to } = selectionRange(this.selection);
    this.dom.dispatchEvent(
      new CustomEvent("axiom:editor-selection", {
        bubbles: true,
        detail: from === to ? "" : this.source.slice(from, to),
      }),
    );
    queueMicrotask(() => {
      if (epoch === this.restoreEpoch) this.restoring = false;
    });
  }
  private scrollSelection() {
    const rect = this.map.rect(this.selection.head),
      scroll = this.scrollDOM,
      box = scroll.getBoundingClientRect();
    if (!rect) return;
    if (this.options.preferences().typewriter)
      scroll.scrollTop += rect.top - box.top - box.height / 2;
    else if (rect.bottom > box.bottom - 24)
      scroll.scrollTop += rect.bottom - box.bottom + 24;
    else if (rect.top < box.top + 16)
      scroll.scrollTop -= box.top + 16 - rect.top;
  }
  private selectionChanged = () => {
    if (
      this.restoring ||
      this.composition ||
      this.destroyed ||
      !this.focused ||
      this.pointerSelecting ||
      this.menuOpen ||
      this.mappedRevision !== this.revision
    )
      return;
    const selection = this.map.read();
    if (!selection) return;
    if (
      selection.anchor === this.selection.anchor &&
      selection.head === this.selection.head
    )
      return;
    this.selection = selection;
    this.binding.select(selection);
    this.options.navigate(selection.head);
    this.cellRange = null;
    this.render(true);
  };
  private finishPointerSelection = () => {
    if (!this.pointerSelecting) return;
    this.pointerSelecting = false;
    let selection = this.map.read() ?? this.selection;
    for (const changes of this.pointerChanges)
      selection = {
        anchor: mapPosition(selection.anchor, changes),
        head: mapPosition(selection.head, changes),
      };
    this.pointerChanges = [];
    this.selection = selection;
    this.binding.select(selection);
    this.render(this.focused);
  };
  private readInputSelection() {
    this.finishPointerSelection();
    if (this.mappedRevision !== this.revision) {
      this.render(true);
      return this.selection;
    }
    return this.map.read() ?? this.selection;
  }
  private focusIn = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (
      input instanceof HTMLInputElement &&
      (input.dataset.languageFrom !== undefined ||
        input.dataset.metadataFrom !== undefined)
    ) {
      this.focused = false;
      const at = Number(
          input.dataset.languageFrom ?? input.dataset.metadataFrom,
        ),
        line = lineAt(this.source, at);
      const match =
        input.dataset.languageFrom !== undefined
          ? /(`{3,}|~{3,})/.exec(line.text)
          : /\[![A-Za-z]+\]/.exec(line.text);
      if (match) {
        const from = line.from + match.index + match[0].length;
        this.metadataDrafts.set(input, {
          location: this.binding.relative({ anchor: from, head: line.to }),
          header: this.binding.relative({ anchor: line.from, head: line.to }),
          headerText: line.text,
          original: this.source.slice(from, line.to),
          source: this.source,
          from,
          to: line.to,
        });
      }
      return;
    }
    if ((event.target as Element).closest("[data-native-ui]")) return;
    this.focused = true;
    if (this.restoring) return;
    const selection = this.map.read();
    if (selection) this.selection = selection;
    this.binding.select(this.selection);
  };
  private focusOut = () => {
    queueMicrotask(() => {
      if (
        this.destroyed ||
        this.content.contains(document.activeElement) ||
        this.popup?.contains(document.activeElement) ||
        this.menuOpen
      )
        return;
      this.focused = false;
      this.binding.blur();
      this.closePopup();
      this.selectionBar?.remove();
      this.selectionBar = null;
      if (!this.composition) this.render(false);
    });
  };
  private edit(
    edit: SourceEdit | null,
    kind: NativeTransaction["kind"] = "command",
  ) {
    if (!edit || this.options.readOnly()) return false;
    const next = applyChanges(this.source, edit.changes);
    if (next.length > 1_000_000) {
      this.options.message(
        "Notes support up to 1,000,000 characters. Split this document before adding more.",
      );
      return false;
    }
    const anchor = edit.selection.anchor;
    if (!edit.changes.length) {
      this.focus(anchor, edit.selection.head ?? anchor);
      return true;
    }
    this.inputStarted ||= performance.now();
    this.focused = true;
    const nextLine = lineAt(next, anchor);
    const current = nodeAt(this.source, this.selection.head, [
      "codeBlock",
      "mathBlock",
    ]);
    const draft = this.editing.header();
    const pending =
      kind === "typing" &&
      isDraftHeader(nextLine.text) &&
      (draft ||
        !current ||
        ((current.contentTo ?? current.to) === current.to &&
          this.selection.head < (current.contentFrom ?? current.from)));
    this.pairs.beforeChange(edit.changes);
    this.binding.transact({
      changes: edit.changes,
      selection: { anchor, head: edit.selection.head ?? anchor },
      kind,
    });
    if (pending) {
      this.editing.beginHeader(nextLine.from, nextLine.to);
      this.render(true);
    }
    this.options.navigate(this.selection.head);
    this.scrollSelection();
    return true;
  }
  private beforeInput = (event: InputEvent) => {
    if ((event.target as Element).closest("[data-native-ui]")) return;
    this.inputStarted = performance.now();
    if (this.options.readOnly()) {
      event.preventDefault();
      return;
    }
    if (
      event.isComposing ||
      this.composition ||
      event.inputType.includes("Composition")
    )
      return;
    if (!event.cancelable) {
      this.nativeFallback = true;
      this.compositionStart();
      this.fallbackInsert =
        event.inputType.startsWith("insert") && event.data !== null
          ? event.data
          : undefined;
      return;
    }
    this.selection = this.readInputSelection();
    if (event.inputType === "insertReplacementText") {
      const range = event.getTargetRanges?.()[0];
      if (range) {
        const from = this.map.sourcePosition(
            range.startContainer,
            range.startOffset,
          ),
          to = this.map.sourcePosition(range.endContainer, range.endOffset);
        if (from !== null && to !== null)
          this.selection = { anchor: from, head: to };
      }
    }
    event.preventDefault();
    if (
      event.inputType === "historyUndo" ||
      event.inputType === "historyRedo"
    ) {
      this.binding.history(event.inputType === "historyRedo");
      return;
    }
    if (
      event.inputType === "insertParagraph" ||
      event.inputType === "insertLineBreak"
    ) {
      this.enter(event.inputType === "insertLineBreak");
      return;
    }
    if (event.inputType.startsWith("delete")) {
      this.delete(event.inputType);
      return;
    }
    if (event.inputType === "formatBold") {
      this.execute("bold");
      return;
    }
    if (event.inputType === "formatItalic") {
      this.execute("italic");
      return;
    }
    if (event.data !== null) this.insertText(event.data, "typing");
  };
  private input = (event: Event) => {
    if ((event.target as Element).closest("[data-native-ui]")) return;
    if (this.nativeFallback) {
      this.nativeFallback = false;
      this.compositionEnd();
    } else if (!this.composition) {
      this.force = true;
      this.render(true);
    }
  };
  private insertText(value: string, kind: NativeTransaction["kind"]) {
    const { from, to } = selectionRange(this.selection),
      cell = this.inputCell();
    if (value.includes("\n") && this.options.mode() !== "source") {
      const literal = nodeAt(this.source, from, ["codeBlock", "mathBlock"]);
      if (
        literal &&
        from >= (literal.contentFrom ?? literal.from) &&
        to <= (literal.contentTo ?? literal.to)
      ) {
        const prefix = literalPrefix(this.source, literal);
        if (prefix) value = value.replaceAll("\n", "\n" + prefix);
      }
    }
    if (cell?.model.rows[cell.row].cells[cell.column].missing) {
      const changes = tableAction(
        cell.model,
        this.source,
        cell.row,
        cell.column,
        "paste",
        [[value]],
      );
      const after = applyChanges(this.source, changes),
        node = nodeAt(after, cell.node.from, ["table"]),
        model = node && tableModel(after, node);
      this.edit(
        {
          changes,
          selection: {
            anchor: model?.rows[cell.row].cells[cell.column].to ?? from,
          },
        },
        kind,
      );
      return;
    }
    if (cell) {
      // The active cell displays raw Markdown. A separately typed backslash
      // already owns its escaped pipe; do not insert a second escape.
      const preceding = /\\+$/.exec(this.source.slice(0, from))?.[0] ?? "";
      value = escapeCell(preceding + value).slice(preceding.length);
    }
    const prefs = this.options.preferences();
    if (
      value === "`" &&
      from === to &&
      /^[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?``$/.test(
        lineAt(this.source, from).text,
      ) &&
      from === lineAt(this.source, from).to
    ) {
      this.edit(replacement(this.selection, value), kind);
      return;
    }
    if (
      kind === "typing" &&
      prefs.autoPair &&
      value.length === 1 &&
      (/\\+$/.exec(this.source.slice(0, from))?.[0].length ?? 0) % 2 === 0
    ) {
      const pairs: Record<string, string> = {
        "(": ")",
        "[": "]",
        "{": "}",
        '"': '"',
        "'": "'",
        "`": "`",
        $: "$",
      };
      const before = this.source[from - 1] ?? "",
        after = this.source[to] ?? "";
      if (from === to && after === value && this.pairs.consume(from, value)) {
        this.focus(from + 1);
        return;
      }
      if (
        pairs[value] &&
        !(
          /[ `$]/.test(value) &&
          (() => {
            const literal = nodeAt(this.source, from, [
              "codeBlock",
              "mathBlock",
              "code",
              "mathInline",
            ]);
            return literal && from >= (literal.contentFrom ?? literal.from + 1);
          })()
        ) &&
        !(
          from === to &&
          /[\p{L}\p{N}]/u.test(before) &&
          /['"`$]/.test(value)
        ) &&
        (!after || /[\s)\]}.,;:]/.test(after))
      ) {
        const inserted = this.edit(
          {
            changes: [
              {
                from,
                to,
                insert: value + this.source.slice(from, to) + pairs[value],
              },
            ],
            selection: { anchor: from + 1, head: to + 1 },
          },
          kind,
        );
        if (inserted) this.pairs.add(from, to + 1, value, pairs[value]);
        return;
      }
    }
    this.edit(replacement(this.selection, value), kind);
  }
  private enter(soft = false) {
    if (this.inputCell()) {
      if (soft) this.insertText("\n", "typing");
      else this.tableNavigate(1, 0);
      return;
    }
    const options = this.options.preferences();
    if (this.options.mode() === "source") {
      const structural = nodeAt(this.source, this.selection.head, [
        "item",
        "blockquote",
        "codeBlock",
        "mathBlock",
      ]);
      const line = lineAt(this.source, this.selection.head);
      if (
        !structural &&
        !footnoteAt(this.source, this.selection.head) &&
        !/^(?:\s*>\s*)?(?:`{3,}[\w]*|\$\$)$/.test(line.text)
      ) {
        this.edit(replacement(this.selection, "\n"), "typing");
        return;
      }
    }
    const pending = this.editing.header();
    const draft =
      !!pending &&
      this.selection.head >= pending.from &&
      this.selection.head <= pending.to;
    if (!soft) this.editing.commitHeader();
    this.edit(
      footnoteAt(this.source, this.selection.head)
        ? preserveLineEndings(this.source, this.selection, (source, at) =>
            enterEdit(source, at, options, soft, draft),
          )
        : enterEdit(this.source, this.selection, options, soft, draft),
      "command",
    );
  }
  private delete(kind: string) {
    if (this.cellRange) {
      this.tableCommand("clearCells");
      return;
    }
    const { from, to } = selectionRange(this.selection);
    if (from !== to) {
      this.edit(
        this.options.mode() === "write"
          ? rangeDelete(this.source, this.selection)
          : replacement(this.selection, ""),
        "delete",
      );
      return;
    }
    const backward = !kind.includes("Forward");
    const boundary =
      this.options.mode() === "write" &&
      boundaryDelete(this.source, this.selection, backward);
    if (boundary) {
      this.edit(boundary, "command");
      return;
    }
    const literal =
      this.options.mode() === "write" && literalDelete(this.source, from, kind);
    if (literal) {
      const change = literal.changes[0];
      if (
        backward &&
        this.options.preferences().autoPair &&
        change?.from === from - 1 &&
        change.to === to &&
        this.pairs.closer(to, this.source[to], true)
      )
        change.to++;
      this.edit(literal, "delete");
      return;
    }
    const cell = this.tableAt();
    if (cell) {
      const bounds = cell.model.rows[cell.row].cells[cell.column];
      if ((backward && from < bounds.from) || (!backward && to > bounds.to)) {
        this.focus(backward ? bounds.from : bounds.to);
        return;
      }
    }
    let start = from,
      end = to;
    const line = lineAt(this.source, from);
    if (kind.includes("Word")) {
      if (backward)
        start =
          from -
          (this.source
            .slice(line.from, from)
            .match(/(?:\s+|[\p{L}\p{N}_]+|[^\p{L}\p{N}\s])$/u)?.[0].length ??
            1);
      else
        end =
          to +
          (this.source
            .slice(to)
            .match(/^(?:\s+|[\p{L}\p{N}_]+|[^\p{L}\p{N}\s])/u)?.[0].length ??
            1);
    } else if (kind.includes("SoftLine") || kind.includes("HardLine")) {
      if (backward) start = line.from;
      else end = line.to;
    } else if (backward) start = graphemeBoundary(this.source, from, -1);
    else end = graphemeBoundary(this.source, to, 1);
    if (this.options.mode() === "write") {
      if (cell) {
        const bounds = cell.model.rows[cell.row].cells[cell.column];
        start = Math.max(start, bounds.from);
        end = Math.min(end, bounds.to);
      } else {
        const prose = nodeAt(this.source, from, ["paragraph", "heading"]);
        if (
          prose &&
          from >= (prose.contentFrom ?? prose.from) &&
          to <= (prose.contentTo ?? prose.to)
        ) {
          start = Math.max(start, prose.contentFrom ?? prose.from);
          end = Math.min(end, prose.contentTo ?? prose.to);
        }
      }
    }
    if (
      backward &&
      this.options.preferences().autoPair &&
      start === from - 1 &&
      this.pairs.closer(to, this.source[to], true)
    )
      end++;
    this.edit(
      {
        changes: [
          {
            from: Math.max(0, start),
            to: Math.min(this.source.length, end),
            insert: "",
          },
        ],
        selection: { anchor: Math.max(0, start) },
      },
      "delete",
    );
  }
  private compositionStart = () => {
    if (this.options.readOnly()) return;
    this.selection = this.readInputSelection();
    const before = this.map.capture(),
      positions = new Map<number, ReturnType<NativeBinding["relative"]>>();
    const range = selectionRange(this.selection),
      first = lineAt(this.source, range.from).from,
      last = lineAt(this.source, range.to).to;
    // Only the composing line/selection needs stable character anchors, not a million-character note.
    for (const position of [
      ...before.positions,
      ...before.ends,
      this.selection.anchor,
      this.selection.head,
    ])
      if (position >= first && position <= last && !positions.has(position))
        positions.set(
          position,
          this.binding.relative({ anchor: position, head: position }),
        );
    this.composition = {
      before,
      source: this.source,
      positions,
      selection: this.selection,
      container: this.binding.relative({ anchor: first, head: last }),
      containerText: this.source.slice(first, last),
    };
  };
  private compositionEnd = (event?: Event) => {
    const committed =
      event instanceof CompositionEvent ? event.data : undefined;
    // WebKit dispatches the final composition input after compositionend.
    queueMicrotask(() => {
      const composing = this.composition;
      if (!composing || this.destroyed) return;
      const after = this.map.capture(),
        change = minimalChange(composing.before.text, after.text);
      let oldFrom = composing.before.positions[change.from];
      let oldTo =
        change.to > change.from
          ? composing.before.ends[change.to - 1]
          : oldFrom;
      // At a display boundary, omitted table/list syntax must never be consumed.
      if (change.from === change.to) oldFrom = oldTo = composing.selection.head;
      const fallback = this.fallbackInsert;
      if (fallback !== undefined) {
        const range = selectionRange(composing.selection);
        oldFrom = range.from;
        oldTo = range.to;
        change.insert = fallback;
        this.fallbackInsert = undefined;
      } else if (
        committed &&
        composing.selection.anchor !== composing.selection.head
      ) {
        // An IME replaces its original selection, including matching leading
        // or trailing characters. A minimal DOM diff would leave the caret
        // before an unchanged suffix and can misclassify a document edit as
        // a cell edit. Empty/cancelled compositions still use the DOM diff.
        const range = selectionRange(composing.selection);
        oldFrom = range.from;
        oldTo = range.to;
        change.insert = committed;
      } else if (
        committed &&
        composing.selection.anchor === composing.selection.head &&
        !composing.before.text.slice(change.from, change.to).trim() &&
        change.insert.trim() === committed.trim()
      ) {
        oldFrom = oldTo = composing.selection.head;
        change.insert = committed;
      }
      const a = composing.positions.get(oldFrom),
        b = composing.positions.get(oldTo);
      const from = a && this.binding.absolute(a)?.anchor,
        to = b && this.binding.absolute(b)?.head;
      this.composition = null;
      this.force = true;
      const container = this.binding.absolute(composing.container);
      if (
        from === undefined ||
        to === undefined ||
        to < from ||
        this.source.slice(from, to) !==
          composing.source.slice(oldFrom, oldTo) ||
        this.options.readOnly() ||
        (composing.containerText.length > 0 &&
          (!container || container.head <= container.anchor))
      ) {
        this.options.recover(
          composing.source.slice(0, oldFrom) +
            change.insert +
            composing.source.slice(oldTo),
        );
        this.options.message(
          "The composing text changed remotely. Your draft was retained for recovery.",
        );
        this.render(true);
        return;
      }
      if (change.from === change.to && !change.insert) {
        this.render(true);
        return;
      }
      if (fallback !== undefined) {
        this.selection = { anchor: from, head: to };
        this.insertText(fallback, "typing");
        return;
      }
      this.selection = { anchor: from, head: to };
      this.insertText(change.insert, "composition");
    });
  };
  private keydown = (event: KeyboardEvent) => {
    const input = event.target;
    if (
      input instanceof HTMLInputElement &&
      (input.dataset.languageFrom !== undefined ||
        input.dataset.metadataFrom !== undefined) &&
      ["Enter", "Escape"].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") this.change(event);
      else {
        this.metadataDrafts.delete(input);
        this.force = true;
        this.render(false);
      }
      this.focus(this.selection.anchor, this.selection.head);
      return;
    }
    const resize = (event.target as Element).closest<HTMLElement>(
      "[data-resize-column]",
    );
    if (resize && ["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) {
      const table = resize.closest<HTMLElement>("[data-block='table']")!,
        column = Number(resize.dataset.resizeColumn),
        at = Number(table.dataset.nfrom);
      const width = table
        .querySelectorAll<HTMLElement>("thead th")
        [column].getBoundingClientRect().width;
      this.resizeColumn(
        at,
        column,
        event.key === "Home"
          ? null
          : width + (event.key === "ArrowLeft" ? -16 : 16),
      );
      this.content
        .querySelector<HTMLElement>(
          `[data-block='table'][data-nfrom='${at}'] [data-resize-column='${column}']`,
        )
        ?.focus();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      event.isComposing ||
      this.composition ||
      event.getModifierState("AltGraph") ||
      (event.target as Element).closest("[data-native-ui]")
    )
      return;
    // Native selectionchange is asynchronous; a shortcut can follow a pointer
    // selection before that event has reached the document listener.
    this.selection = this.readInputSelection();
    this.binding.select(this.selection);
    const atom = (event.target as Element).closest<HTMLElement>("[data-atom]");
    if (atom && event.key === "Enter") {
      event.preventDefault();
      if (!this.options.readOnly())
        this.focus(
          Number(atom.dataset.nfrom) +
            (atom.dataset.atom === "mathBlock" ? 0 : 1),
        );
      return;
    }
    if (
      this.popup &&
      ["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(event.key)
    ) {
      if (event.key === "Escape") {
        this.dismissQuery = this.currentQueryKey();
        this.closePopup();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp")
        this.selectPopup(
          this.popupIndex + (event.key === "ArrowDown" ? 1 : -1),
        );
      else
        this.popup
          .querySelectorAll<HTMLButtonElement>("button")
          [this.popupIndex]?.click();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const table = this.inputCell();
    // WebKit may omit beforeinput for Backspace at a collapsed cell-start
    // caret. A rectangular selection is our state, not a native DOM range.
    if (this.cellRange && ["Backspace", "Delete"].includes(event.key)) {
      if (!this.options.readOnly()) this.tableCommand("clearCells");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      table &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      this.selection.anchor === this.selection.head
    ) {
      const cell = table.model.rows[table.row].cells[table.column];
      if (
        (event.key === "ArrowRight" && this.selection.head >= cell.to) ||
        (event.key === "ArrowLeft" && this.selection.head <= cell.from)
      ) {
        this.tableNavigate(0, event.key === "ArrowRight" ? 1 : -1);
        event.preventDefault();
        return;
      }
    }
    const key = eventBinding(event, shortcutPlatform());
    const catalogue = table
      ? [
          ...editorCommands.filter((c) => c.scope === "table"),
          ...editorCommands.filter((c) => c.scope !== "table"),
        ]
      : editorCommands.filter((c) => c.scope !== "table");
    const command = catalogue.find((c) =>
      keysFor(c.id, this.options.preferences(), shortcutPlatform()).includes(
        key,
      ),
    );
    if (command && this.execute(command.id)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      const block =
        this.options.mode() === "write"
          ? nodeAt(this.source, this.selection.head, ["codeBlock", "mathBlock"])
          : null;
      const literal = block && literalBody(this.source, block);
      let from = literal?.offsets[0] ?? 0,
        to = literal?.offsets.at(-1) ?? this.source.length;
      if (this.selection.anchor === from && this.selection.head === to) {
        from = 0;
        to = this.source.length;
      }
      this.focus(from, to);
      event.preventDefault();
      return;
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      ["Home", "End"].includes(event.key)
    ) {
      const at = event.key === "Home" ? 0 : this.source.length;
      this.focus(event.shiftKey ? this.selection.anchor : at, at);
      event.preventDefault();
      return;
    }
    if (
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      (event.key === "Home" || event.key === "End")
    ) {
      const line = lineAt(this.source, this.selection.head);
      const first = this.map.maps.find(
        (mapping) => mapping.from >= line.from && mapping.from <= line.to,
      );
      const cell = table?.model.rows[table.row].cells[table.column];
      const at =
        event.key === "End"
          ? (cell?.to ?? line.to)
          : (cell?.from ?? Math.max(line.from, first?.from ?? line.from));
      this.focus(event.shiftKey ? this.selection.anchor : at, at);
      event.preventDefault();
      return;
    }
    if (event.key === "Enter") {
      if (!this.options.readOnly()) this.enter(event.shiftKey);
      event.preventDefault();
      return;
    }
    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      ["Backspace", "Delete"].includes(event.key)
    ) {
      if (!this.options.readOnly())
        this.delete(
          event.key === "Backspace"
            ? "deleteContentBackward"
            : "deleteContentForward",
        );
      event.preventDefault();
      return;
    }
    if (event.key === "Tab") {
      if (this.snippet && this.moveSnippet(event.shiftKey ? -1 : 1)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (table && !this.options.preferences().tableTabNavigation) return;
      if (table) this.tableNavigate(0, event.shiftKey ? -1 : 1);
      else if (!this.execute(event.shiftKey ? "outdent" : "indent")) return;
      event.preventDefault();
      return;
    }
    if (
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10")
    ) {
      const box =
        this.map.rect(this.selection.head) ??
        this.content.getBoundingClientRect();
      this.openMenu(box.left, box.bottom);
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      if (this.options.exit) {
        event.preventDefault();
        queueMicrotask(() => this.options.exit?.());
        return;
      }
      this.snippet = null;
      this.cellRange = null;
      this.paintRange();
      if (
        this.options.mode() === "write" &&
        nodeAt(this.source, this.selection.head, ["mathBlock"])
      ) {
        this.focused = false;
        this.binding.blur();
        this.content.blur();
        this.render(false);
        event.preventDefault();
      }
    }
    if (
      table &&
      event.altKey &&
      event.shiftKey &&
      event.key.startsWith("Arrow")
    ) {
      this.cellRange ??= {
        table: table.node.from,
        row: table.row,
        column: table.column,
        endRow: table.row,
        endColumn: table.column,
      };
      this.cellRange.endRow = Math.max(
        0,
        Math.min(
          table.model.rows.length - 1,
          this.cellRange.endRow +
            (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0),
        ),
      );
      this.cellRange.endColumn = Math.max(
        0,
        Math.min(
          table.model.columns - 1,
          this.cellRange.endColumn +
            (event.key === "ArrowRight"
              ? 1
              : event.key === "ArrowLeft"
                ? -1
                : 0),
        ),
      );
      this.paintRange();
      event.preventDefault();
    }
  };
  private pointerDown = (event: MouseEvent) => {
    const target = event.target as Element;
    const equation = target.closest<HTMLElement>('[data-atom="mathBlock"]');
    if (event.button === 0 && equation && !this.options.readOnly()) {
      // A MathJax result can replace the pressed descendant before mouseup.
      // Firefox then omits click entirely. Resolve this explicit activation
      // from the stable preview's source map at pointer-down, before rendering
      // or browser selection can move it to another block.
      event.preventDefault();
      this.focus(Number(equation.dataset.nfrom));
      return;
    }
    if (
      event.button === 0 &&
      !target.closest("[data-native-ui], [data-atom], button, input, select")
    )
      this.pointerSelecting = true;
    const resize = target.closest<HTMLElement>("[data-resize-column]");
    if (resize) {
      event.preventDefault();
      const table = resize.closest<HTMLElement>("[data-block='table']")!,
        column = Number(resize.dataset.resizeColumn),
        at = Number(table.dataset.nfrom),
        startX = event.clientX;
      const width = table
        .querySelectorAll<HTMLElement>("thead th")
        [column].getBoundingClientRect().width;
      const move = (event: MouseEvent) =>
        this.resizeColumn(at, column, width + event.clientX - startX);
      const end = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", end);
      };
      document.addEventListener("mousemove", move, {
        signal: this.abort.signal,
      });
      document.addEventListener("mouseup", end, {
        once: true,
        signal: this.abort.signal,
      });
      return;
    }
    if (target.closest("button, [data-atom], input[type='checkbox']"))
      event.preventDefault();
    const cell = target.closest<HTMLElement>("td, th");
    if (cell && !event.shiftKey)
      this.cellHint = {
        table: Number(
          cell.closest<HTMLElement>("[data-block='table']")?.dataset.nfrom,
        ),
        row: Number(cell.dataset.row),
        column: Number(cell.dataset.column),
      };
    if (
      cell &&
      !event.shiftKey &&
      cell.dataset.nfrom === cell.dataset.nto &&
      !target.closest("[data-native-ui]")
    ) {
      event.preventDefault();
      // This is an explicit caret placement, not a drag. Render before focusin
      // can read a stale selection from the previously blurred source surface.
      this.pointerSelecting = false;
      this.pointerChanges = [];
      this.focus(Number(cell.dataset.nfrom));
      return;
    }
    if (event.shiftKey && cell) {
      const table = cell.closest<HTMLElement>("[data-block='table']"),
        current = this.tableAt();
      if (
        table &&
        current &&
        Number(table.dataset.nfrom) === current.node.from
      ) {
        this.cellRange = {
          table: current.node.from,
          row: current.row,
          column: current.column,
          endRow: Number(cell.dataset.row),
          endColumn: Number(cell.dataset.column),
        };
        this.paintRange();
        event.preventDefault();
      }
    }
  };
  private click = (event: MouseEvent) => {
    const target = event.target as Element;
    const reference = target.closest<HTMLElement>("[data-footnote-key]");
    const definition =
      reference &&
      this.parsed.definitions?.find(
        (node) =>
          node.type === "footnoteDefinition" &&
          node.key === reference.dataset.footnoteKey,
      );
    if (definition) {
      event.preventDefault();
      this.focus(definition.from);
      return;
    }
    const command = target.closest<HTMLElement>("[data-command]");
    if (command) {
      const block = command.closest<HTMLElement>(
        "[data-native-block], [data-block]",
      );
      const at = Number(block?.dataset.nfrom ?? this.selection.head);
      if (
        this.selection.head < at ||
        this.selection.head > Number(block?.dataset.nto ?? at)
      )
        this.selection = { anchor: at, head: at };
      if (command.dataset.command === "menu") {
        const box = command.getBoundingClientRect();
        this.openMenu(box.left, box.bottom);
      } else this.execute(command.dataset.command as EditorCommandId);
      return;
    }
    const atom = target.closest<HTMLElement>("[data-atom]");
    if (atom && !this.options.readOnly()) {
      event.preventDefault();
      const from = Number(atom.dataset.nfrom);
      this.focus(atom.dataset.atom === "mathBlock" ? from : from + 1);
    }
  };
  private change = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.calloutFrom !== undefined) {
      if (
        this.options.readOnly() ||
        !/^(note|warning|theorem|lemma|proof|definition|corollary|proposition|example|remark)$/.test(
          target.value,
        )
      )
        return;
      const line = lineAt(this.source, Number(target.dataset.calloutFrom)),
        match = /\[!([A-Za-z]+)\]/.exec(line.text);
      if (match) {
        const from = line.from + match.index + 2;
        this.edit({
          changes: [
            {
              from,
              to: from + match[1].length,
              insert: target.value.toUpperCase(),
            },
          ],
          selection: this.selection,
        });
      }
      return;
    }
    if (
      target.dataset.metadataFrom !== undefined ||
      target.dataset.languageFrom !== undefined
    ) {
      const draft = this.metadataDrafts.get(target);
      if (!draft) return;
      const location = draft && this.binding.absolute(draft.location);
      if (
        !draft ||
        !location ||
        this.source.slice(location.anchor, location.head) !== draft.original ||
        this.options.readOnly()
      ) {
        if (draft)
          this.options.recover(
            draft.source.slice(0, draft.from) +
              target.value +
              draft.source.slice(draft.to),
          );
        this.options.message(
          "This block header changed remotely. Your uncommitted text was retained for recovery.",
        );
        return;
      }
      if (
        target.dataset.languageFrom !== undefined &&
        !/^[\w+#.-]*$/.test(target.value)
      ) {
        this.options.message(
          "Use a language name such as python, julia, latex or mermaid.",
        );
        return;
      }
      const value =
        target.dataset.metadataFrom !== undefined
          ? " " + target.value.trim()
          : target.value;
      this.metadataDrafts.delete(target);
      this.edit({
        changes: [{ from: location.anchor, to: location.head, insert: value }],
        selection: { anchor: location.anchor + value.length + 1 },
      });
      return;
    }
    if (target.dataset.taskFrom !== undefined) {
      this.selection = {
        anchor: Number(target.dataset.taskFrom),
        head: Number(target.dataset.taskFrom),
      };
      this.execute("toggleTask");
    }
  };
  private contextMenu = (event: MouseEvent) => {
    if ((event.target as Element).closest("[data-native-ui] input")) return;
    event.preventDefault();
    const cell = (event.target as Element).closest<HTMLElement>("td,th"),
      block = (event.target as Element).closest<HTMLElement>("[data-block]");
    if (!this.cellRange && cell)
      this.selection = {
        anchor: Number(cell.dataset.nfrom),
        head: Number(cell.dataset.nfrom),
      };
    else if (
      block &&
      (this.selection.head < Number(block.dataset.nfrom) ||
        this.selection.head > Number(block.dataset.nto))
    )
      this.selection = {
        anchor: Number(block.dataset.nfrom),
        head: Number(block.dataset.nfrom),
      };
    this.binding.select(this.selection);
    this.openMenu(event.clientX, event.clientY);
  };
  private inputCell() {
    const table = this.tableAt();
    if (!table) return null;
    const cell = table.model.rows[table.row].cells[table.column];
    const { from, to } = selectionRange(this.selection);
    // A note/range ending at a table is not a selection inside its last cell.
    return from >= cell.fieldFrom && to <= cell.fieldTo ? table : null;
  }
  private tableAt() {
    if (this.options.mode() !== "write") return null;
    const node = nodeAt(this.source, this.selection.head, ["table"]);
    if (!node) return null;
    const model = tableModel(this.source, node);
    if (!model) return null;
    let row = model.rows.findIndex(
      (r) => this.selection.head >= r.from && this.selection.head <= r.to,
    );
    row = Math.max(0, row);
    let column = -1;
    model.rows[row].cells.forEach((c, index) => {
      if (
        this.selection.head >= c.fieldFrom &&
        this.selection.head <= c.fieldTo
      )
        column = index;
    });
    column = Math.max(0, column);
    if (this.cellHint?.table === node.from && this.cellHint.row === row) {
      const cell = model.rows[row].cells[this.cellHint.column];
      if (cell?.missing && this.selection.head === cell.from)
        column = this.cellHint.column;
    }
    return { node, model, row, column };
  }
  tableActive() {
    return !!this.tableAt();
  }
  private tableNavigate(deltaRow: number, deltaColumn: number) {
    const current = this.tableAt();
    if (!current) return;
    let row = current.row + deltaRow,
      column = current.column + deltaColumn;
    if (column >= current.model.columns) {
      column = 0;
      row++;
    }
    if (column < 0) {
      column = current.model.columns - 1;
      row--;
    }
    if (row < 0) {
      this.execute("paragraphBefore");
      return;
    }
    if (row >= current.model.rows.length) {
      if (!this.options.preferences().tableAutoRow || this.options.readOnly()) {
        this.execute("finishBlock");
        return;
      }
      this.execute("rowAfter");
    }
    const node = nodeAt(this.source, current.node.from, ["table"]),
      model = node && tableModel(this.source, node);
    const cell =
      model?.rows[Math.min(row, model.rows.length - 1)]?.cells[column];
    if (cell) {
      this.cellHint = { table: current.node.from, row, column };
      this.focus(cell.from);
    }
  }
  private paintRange() {
    const current = this.focused ? this.tableAt() : null;
    this.content
      .querySelectorAll<HTMLElement>(
        ".native-table-block td, .native-table-block th",
      )
      .forEach((cell) => {
        const active =
          !!current &&
          Number(
            cell.closest<HTMLElement>("[data-block='table']")?.dataset.nfrom,
          ) === current.node.from &&
          Number(cell.dataset.row) === current.row &&
          Number(cell.dataset.column) === current.column;
        cell.dataset.activeCell = String(active);
      });
    this.content.querySelectorAll(".native-cell-selected").forEach((el) => {
      el.classList.remove("native-cell-selected");
      el.removeAttribute("aria-selected");
    });
    const range = this.cellRange;
    if (!range) return;
    const table = this.content.querySelector(
      `[data-block='table'][data-nfrom='${range.table}']`,
    );
    table?.querySelectorAll<HTMLElement>("td,th").forEach((cell) => {
      const row = Number(cell.dataset.row),
        column = Number(cell.dataset.column);
      cell.classList.toggle(
        "native-cell-selected",
        row >= Math.min(range.row, range.endRow) &&
          row <= Math.max(range.row, range.endRow) &&
          column >= Math.min(range.column, range.endColumn) &&
          column <= Math.max(range.column, range.endColumn),
      );
      if (cell.classList.contains("native-cell-selected"))
        cell.setAttribute("aria-selected", "true");
    });
  }
  private tableCommand(id: EditorCommandId) {
    const current = this.tableAt();
    if (!current) return false;
    const { model, row, column } = current;
    if (id === "copyTable") {
      void this.clipboard(
        writeTSV(model.rows.map((r) => r.cells.map((c) => c.raw))),
      );
      return true;
    }
    if (["selectRow", "selectColumn", "selectTable"].includes(id)) {
      this.cellRange = {
        table: current.node.from,
        row: id === "selectRow" ? row : 0,
        column: id === "selectColumn" ? column : 0,
        endRow: id === "selectRow" ? row : model.rows.length - 1,
        endColumn: id === "selectColumn" ? column : model.columns - 1,
      };
      this.paintRange();
      return true;
    }
    if (this.options.readOnly()) return true;
    if (id === "clearCells") {
      const range = this.cellRange ?? {
          table: current.node.from,
          row,
          column,
          endRow: row,
          endColumn: column,
        },
        changes: TextChange[] = [];
      for (
        let r = Math.min(range.row, range.endRow);
        r <= Math.max(range.row, range.endRow);
        r++
      )
        for (
          let c = Math.min(range.column, range.endColumn);
          c <= Math.max(range.column, range.endColumn);
          c++
        ) {
          const cell = model.rows[r]?.cells[c];
          if (cell) changes.push({ from: cell.from, to: cell.to, insert: "" });
        }
      this.cellRange = null;
      return this.edit({
        changes,
        selection: {
          anchor:
            model.rows[Math.min(range.row, range.endRow)].cells[
              Math.min(range.column, range.endColumn)
            ].from,
        },
      });
    }
    try {
      const changes = tableAction(model, this.source, row, column, id);
      if (!changes.length) return true;
      const after = applyChanges(this.source, changes),
        nextNode = nodeAt(after, current.node.from, ["table"]),
        next = nextNode && tableModel(after, nextNode);
      const nextRow =
        row +
        (["rowAfter", "duplicateRow", "rowDown"].includes(id)
          ? 1
          : id === "rowUp"
            ? -1
            : 0);
      const nextColumn =
        column +
        (["columnAfter", "duplicateColumn", "columnRight"].includes(id)
          ? 1
          : id === "columnLeft"
            ? -1
            : 0);
      const cell =
        next?.rows[Math.max(0, Math.min(nextRow, next.rows.length - 1))]?.cells[
          Math.max(0, Math.min(nextColumn, next.columns - 1))
        ];
      this.cellRange = null;
      return this.edit({
        changes,
        selection: { anchor: cell?.from ?? current.node.from },
      });
    } catch (error) {
      this.options.message((error as Error).message);
      return true;
    }
  }
  execute(id: EditorCommandId, args: CommandArguments = {}) {
    if (this.composition) return false;
    const definition = commandById[id];
    if (!definition) return false;
    if (args.from !== undefined)
      this.selection = { anchor: args.from, head: args.to ?? args.from };
    if (definition.scope === "workspace") {
      this.options.workspace(id);
      return true;
    }
    if (definition.scope === "table") return this.tableCommand(id);
    if (id === "find" || id === "replace") {
      this.openFind(id === "replace");
      return true;
    }
    const block = nodeAt(this.source, this.selection.head, [
      "codeBlock",
      "mathBlock",
      "mathInline",
      "table",
      "blockquote",
      "callout",
      "paragraph",
    ]);
    if (id.startsWith("copy")) {
      let value = this.source.slice(
        ...(Object.values(selectionRange(this.selection)) as [number, number]),
      );
      if (id === "copyBlockSource" && block)
        value = this.source.slice(block.from, block.to);
      if (["copyCode", "copyTex"].includes(id) && block)
        value = block.text ?? "";
      if (id === "copyMathSvg") {
        const svg = this.content.querySelector(
          `[data-math-from='${block?.from}'] svg`,
        );
        if (!svg) {
          this.options.message(
            "Wait for a valid equation preview before copying SVG.",
          );
          return true;
        }
        value = svg.outerHTML;
      }
      void this.clipboard(value);
      return true;
    }
    if (
      ["codeWrap", "codeLineNumbers", "resetCodeDisplay"].includes(id) &&
      block?.type === "codeBlock"
    ) {
      const old = this.codeOverrides.get(block.from) ?? {},
        prefs = this.options.preferences();
      if (id === "resetCodeDisplay") this.codeOverrides.delete(block.from);
      else
        this.codeOverrides.set(
          block.from,
          id === "codeWrap"
            ? { ...old, wrap: !(old.wrap ?? prefs.codeWrap) }
            : { ...old, numbers: !(old.numbers ?? prefs.codeLineNumbers) },
        );
      this.force = true;
      this.render(true);
      return true;
    }
    if (this.options.readOnly()) return false;
    if (
      !args.wholeBlock &&
      block?.type === "codeBlock" &&
      ["duplicate", "moveUp", "moveDown"].includes(id)
    ) {
      const edit = codeLineEdit(
        this.source,
        this.selection,
        id as "duplicate" | "moveUp" | "moveDown",
      );
      if (edit) this.edit(edit);
      else
        this.options.message(
          "Code lines stay inside their fences. Use the block menu to move the whole block.",
        );
      return true;
    }
    if (id === "undo" || id === "redo") {
      this.binding.history(id === "redo");
      return true;
    }
    if (id === "attachment" || (id === "table" && args.rows === undefined)) {
      this.options.prepare(
        args.from === undefined
          ? undefined
          : { from: args.from, to: args.to ?? args.from },
      );
      this.options.workspace(id);
      return true;
    }
    if (id === "equationLabel" && block?.type === "mathBlock") {
      const found = /\\label\{([^}]+)\}/.exec(
        this.source.slice(block.from, block.to),
      );
      if (found)
        this.focus(
          block.from + found.index + 7,
          block.from + found.index + 7 + found[1].length,
        );
      else {
        const at = block.contentTo ?? block.to - 2;
        this.edit({
          changes: [{ from: at, to: at, insert: "\\label{}\n" }],
          selection: { anchor: at + 7 },
        });
      }
      return true;
    }
    if (
      (id === "indent" || id === "outdent") &&
      block?.type !== "codeBlock" &&
      block?.type !== "mathBlock" &&
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
    if (
      (id === "indent" || id === "outdent") &&
      this.selection.anchor === this.selection.head &&
      id === "indent" &&
      block?.type === "codeBlock"
    )
      return this.edit(
        replacement(
          this.selection,
          " ".repeat(this.options.preferences().indentSize),
        ),
      );
    let source = this.source;
    const { from } = selectionRange(this.selection);
    let { to } = selectionRange(this.selection);
    const query = slashQuery(source, to);
    let removal = false;
    if (args.from !== undefined && query?.from === from && definition.insert) {
      source = source.slice(0, from) + source.slice(to);
      to = from;
      removal = true;
    }
    let edit =
      args.value === undefined
        ? sourceCommand(id, source, from, to, {
            ...args,
            language: this.options.preferences().defaultCodeLanguage,
            indent: this.options.preferences().indentSize,
          })
        : replacement({ anchor: from, head: to }, args.value);
    if (!edit) return false;
    if (removal) {
      if (query?.prefix) {
        const fragment = sourceCommand(id, "", 0, 0, {
          ...args,
          language: this.options.preferences().defaultCodeLanguage,
          indent: this.options.preferences().indentSize,
        });
        if (fragment) {
          const raw = applyChanges("", fragment.changes),
            continuation = query.prefix.replace(
              /(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?$/,
              (marker) => " ".repeat(marker.length),
            );
          const insert = raw.replace(/\n(?!$)/g, "\n" + continuation);
          const position = (at: number) =>
            from +
            at +
            (raw.slice(0, at).match(/\n/g)?.length ?? 0) * continuation.length;
          return this.edit({
            changes: [{ from, to: query.to, insert }],
            selection: {
              anchor: position(fragment.selection.anchor),
              head: position(
                fragment.selection.head ?? fragment.selection.anchor,
              ),
            },
          });
        }
      }
      // Collapse only the local command's composed change, not a whole-document reserialization.
      const next = applyChanges(source, edit.changes);
      edit = { ...edit, changes: [minimalChange(this.source, next)] };
    }
    this.closePopup();
    return this.edit(edit);
  }
  private clipboard(value: string) {
    return navigator.clipboard
      .writeText(value)
      .catch(() =>
        this.options.message(
          "Clipboard access was denied. Select the source and use Copy.",
        ),
      );
  }
  private copy = (event: ClipboardEvent) => {
    if ((event.target as Element).closest("[data-native-ui]")) return;
    const table = this.tableAt(),
      range = this.cellRange;
    if (table && range) {
      const rows = table.model.rows
        .slice(
          Math.min(range.row, range.endRow),
          Math.max(range.row, range.endRow) + 1,
        )
        .map((r) =>
          r.cells
            .slice(
              Math.min(range.column, range.endColumn),
              Math.max(range.column, range.endColumn) + 1,
            )
            .map((c) => c.raw),
        );
      event.clipboardData?.setData("text/plain", writeTSV(rows));
      event.preventDefault();
      return;
    }
    const { from, to } = selectionRange(this.map.read() ?? this.selection);
    if (from === to) return;
    const markdown = this.source.slice(from, to);
    event.clipboardData?.setData("text/x-axiom-markdown", markdown);
    event.clipboardData?.setData("text/plain", markdown);
    event.clipboardData?.setData(
      "text/html",
      renderDocument(parseMarkdown(markdown), {
        ...this.options.context(),
        taskLayout: "inline",
      }),
    );
    event.preventDefault();
  };
  private cut = (event: ClipboardEvent) => {
    this.selection = this.map.read() ?? this.selection;
    if (this.options.readOnly()) {
      event.preventDefault();
      return;
    }
    this.copy(event);
    if (this.cellRange) this.tableCommand("clearCells");
    else this.edit(replacement(this.selection, ""), "command");
  };
  private paste = (event: ClipboardEvent) => {
    if ((event.target as Element).closest("[data-native-ui]")) return;
    event.preventDefault();
    if (this.options.readOnly() || !event.clipboardData) return;
    if (event.clipboardData.files.length) {
      this.options.prepare();
      if (this.options.files)
        this.options.files(Array.from(event.clipboardData.files));
      else this.options.workspace("attachment");
      return;
    }
    const plain = event.clipboardData.getData("text/plain"),
      html = event.clipboardData.getData("text/html"),
      table = this.inputCell();
    if (
      table &&
      this.options.preferences().tableRichPaste &&
      (plain.includes("\t") || /<table[\s>]/i.test(html))
    ) {
      try {
        const rows = htmlTableGrid(html) ?? parseTSV(plain);
        const changes = tableAction(
          table.model,
          this.source,
          table.row,
          table.column,
          "paste",
          rows,
        );
        this.edit(
          {
            changes,
            selection: {
              anchor: table.model.rows[table.row].cells[table.column].from,
            },
          },
          "paste",
        );
      } catch (error) {
        this.options.message((error as Error).message);
      }
      return;
    }
    // HTML is never inserted into the editing DOM. External rich content is reduced to text/Markdown.
    this.insertText(
      event.clipboardData.getData("text/x-axiom-markdown") ||
        (html && this.options.mode() === "write"
          ? htmlMarkdown(html)
          : plain) ||
        plain,
      "paste",
    );
  };
  private drop = (event: DragEvent) => {
    event.preventDefault();
    if (this.options.readOnly()) return;
    if (this.tableDrag) {
      const drag = this.tableDrag;
      this.tableDrag = null;
      const location = this.binding.absolute(drag.location);
      if (
        !location ||
        this.source.slice(location.anchor, location.head) !== drag.original
      ) {
        this.options.message(
          "The table changed during the drag. Try the move again.",
        );
        return;
      }
      drag.table = location.anchor;
      const cell = (event.target as Element).closest<HTMLElement>("td,th"),
        table = cell?.closest<HTMLElement>("[data-block='table']");
      if (!cell || Number(table?.dataset.nfrom) !== drag.table) return;
      const node = nodeAt(this.source, drag.table, ["table"]),
        model = node && tableModel(this.source, node);
      if (!model) return;
      const target = Number(
        drag.axis === "row" ? cell.dataset.row : cell.dataset.column,
      );
      const changes = moveTableAxis(
        model,
        this.source,
        drag.axis,
        drag.index,
        target,
      );
      this.edit({ changes, selection: { anchor: model.from + 2 } });
      return;
    }
    const doc = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const p = doc.caretPositionFromPoint?.(event.clientX, event.clientY),
      r = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
    const at = p
      ? this.map.sourcePosition(p.offsetNode, p.offset)
      : r
        ? this.map.sourcePosition(r.startContainer, r.startOffset)
        : null;
    if (at !== null) this.selection = { anchor: at, head: at };
    if (this.textDrag) {
      const drag = this.textDrag;
      this.textDrag = null;
      const range = this.binding.absolute(drag.location);
      if (
        at === null ||
        !range ||
        this.source.slice(range.anchor, range.head) !== drag.original
      ) {
        this.options.message(
          "The selected text changed during the drag. Select it again before moving it.",
        );
        return;
      }
      if (at >= range.anchor && at <= range.head) return;
      const move = !event.altKey && !this.tableAt();
      const changes = [
        {
          from: at,
          to: at,
          insert: this.tableAt() ? escapeCell(drag.original) : drag.original,
        },
        ...(move ? [{ from: range.anchor, to: range.head, insert: "" }] : []),
      ];
      const start =
        at > range.head && move ? at - (range.head - range.anchor) : at;
      this.edit({
        changes,
        selection: { anchor: start, head: start + changes[0].insert.length },
      });
      return;
    }
    if (event.dataTransfer?.files.length) {
      this.options.prepare();
      if (this.options.files)
        this.options.files(Array.from(event.dataTransfer.files));
      else this.options.workspace("attachment");
      return;
    }
    this.insertText(event.dataTransfer?.getData("text/plain") ?? "", "paste");
  };
  openBlockMenu(x: number, y: number, target = this.selection) {
    this.focus(target.anchor, target.head);
    this.openMenu(x, y);
  }
  private openMenu(x: number, y: number) {
    const block = nodeAt(this.source, this.selection.head, [
      "table",
      "codeBlock",
      "mathBlock",
      "mathInline",
    ]);
    let ids: EditorCommandId[] =
      block?.type === "table"
        ? [
            "rowBefore",
            "rowAfter",
            "duplicateRow",
            "deleteRow",
            "rowUp",
            "rowDown",
            "columnBefore",
            "columnAfter",
            "duplicateColumn",
            "deleteColumn",
            "columnLeft",
            "columnRight",
            "alignDefault",
            "alignLeft",
            "alignCenter",
            "alignRight",
            "selectRow",
            "selectColumn",
            "selectTable",
            "clearCells",
            "copyTable",
            "finishBlock",
          ]
        : block?.type === "codeBlock"
          ? [
              "copyCode",
              "codeWrap",
              "codeLineNumbers",
              "resetCodeDisplay",
              "copyBlockSource",
              "duplicate",
              "moveUp",
              "moveDown",
              "paragraphBefore",
              "finishBlock",
            ]
          : block?.type.startsWith("math")
            ? [
                "copyTex",
                "copyMathSvg",
                "equationLabel",
                "copyBlockSource",
                "duplicate",
                "paragraphBefore",
                "finishBlock",
              ]
            : [
                "bold",
                "italic",
                "strike",
                "highlight",
                "inlineMath",
                "link",
                "copyMarkdown",
                "duplicate",
                "paragraphBefore",
                "finishBlock",
              ];
    if (this.options.readOnly())
      ids = ids.filter(
        (id) =>
          id.startsWith("copy") ||
          ["codeWrap", "codeLineNumbers", "resetCodeDisplay"].includes(id),
      );
    this.closePopup();
    this.menuDismiss?.();
    this.menuOpen = true;
    const bookmark = this.binding.relative(this.selection);
    const target = block
      ? this.binding.relative({ anchor: block.from, head: block.to })
      : null;
    const current = this.tableAt(),
      p = this.options.preferences();
    this.menuDismiss = openContextMenu({
      owner: this.dom,
      x,
      y,
      label: "Block actions",
      onClose: () => {
        this.menuOpen = false;
        this.menuDismiss = null;
      },
      restore: () => this.focus(this.selection.anchor, this.selection.head),
      items: ids.map((id) => ({
        id,
        icon: editorCommandIcons[id],
        label: commandById[id].label,
        ...(block?.type === "codeBlock" &&
        (id === "codeWrap" || id === "codeLineNumbers")
          ? {
              checked:
                id === "codeWrap"
                  ? (this.codeOverrides.get(block.from)?.wrap ?? p.codeWrap)
                  : (this.codeOverrides.get(block.from)?.numbers ??
                    p.codeLineNumbers),
            }
          : {}),
        group:
          id.startsWith("row") || ["duplicateRow", "deleteRow"].includes(id)
            ? "Rows"
            : /column/i.test(id)
              ? "Columns"
              : id.startsWith("align")
                ? "Alignment"
                : commandById[id].category,
        shortcut: keysFor(id, p, shortcutPlatform())
          .map((key) => shortcutLabel(key, shortcutPlatform()))
          .join(" / "),
        disabled:
          !!current &&
          ((["deleteRow", "rowUp"].includes(id) && current.row === 0) ||
            (id === "deleteColumn" && current.model.columns === 1)),
        action: () => {
          const selection = this.binding.absolute(bookmark),
            range = target && this.binding.absolute(target);
          if (
            !selection ||
            (target &&
              (!range ||
                range.head <= range.anchor ||
                !nodeAt(this.source, range.anchor, [block!.type])))
          ) {
            this.options.message(
              "This block was removed or changed while its menu was open. Open its menu again.",
            );
            return;
          }
          this.selection = selection;
          this.execute(id, { wholeBlock: true });
          if (!document.querySelector("dialog[open]"))
            this.focus(this.selection.anchor, this.selection.head);
        },
      })),
    });
  }
  private updateSourceChrome() {
    const enabled =
      this.options.mode() === "source" && this.options.appearance().lineNumbers;
    if (enabled) {
      if (!this.sourceGutter) {
        this.sourceGutter = document.createElement("div");
        this.sourceGutter.className = "native-source-gutter";
        this.sourceGutter.setAttribute("aria-hidden", "true");
        this.dom.append(this.sourceGutter);
      }
      const heights = Array.from(
        this.content.querySelectorAll<HTMLElement>(".native-source-line"),
        (line) => line.getBoundingClientRect().height,
      );
      const numbers = document.createDocumentFragment();
      heights.forEach((height, index) => {
        const number = document.createElement("span");
        number.textContent = String(index + 1);
        number.style.height = height + "px";
        numbers.append(number);
      });
      this.sourceGutter.replaceChildren(numbers);
    } else {
      this.sourceGutter?.remove();
      this.sourceGutter = null;
    }
    this.content
      .querySelectorAll(".native-active-block")
      .forEach((el) => el.classList.remove("native-active-block"));
    if (this.focused && this.options.appearance().activeLine)
      this.blocks
        .find(
          (block) =>
            this.selection.head >= block.from &&
            this.selection.head <= block.to,
        )
        ?.element.classList.add("native-active-block");
  }
  private resizeColumn(at: number, column: number, width: number | null) {
    const table = this.content.querySelector<HTMLElement>(
      `[data-block='table'][data-nfrom='${at}']`,
    );
    if (!table) return;
    const widths =
      this.tableWidths.get(at) ??
      Array.from(table.querySelectorAll<HTMLElement>("thead th"), (cell) =>
        Math.max(64, cell.getBoundingClientRect().width),
      );
    if (width === null) this.tableWidths.delete(at);
    else {
      widths[column] = Math.max(64, Math.min(1200, width));
      this.tableWidths.set(at, widths);
    }
    this.force = true;
    this.render(false);
  }
  private updateSelectionBar() {
    clearTimeout(this.selectionTimer);
    this.selectionBar?.remove();
    this.selectionBar = null;
    if (
      !this.focused ||
      this.options.readOnly() ||
      this.selection.anchor === this.selection.head ||
      !this.options.preferences().selectionBar ||
      this.composition ||
      this.menuOpen ||
      this.popup ||
      nodeAt(this.source, this.selection.head, ["codeBlock", "mathBlock"])
    )
      return;
    this.selectionTimer = setTimeout(() => {
      const box = this.map.rect(
        Math.min(this.selection.anchor, this.selection.head),
      );
      if (!box || this.destroyed) return;
      const bar = document.createElement("div");
      bar.className = "editor-selection-bar";
      bar.role = "toolbar";
      bar.setAttribute("aria-label", "Selection formatting");
      for (const [id, label] of [
        ["bold", "B"],
        ["italic", "I"],
        ["inlineCode", "‹›"],
        ["inlineMath", "∑"],
        ["link", "↗"],
        ["comment", "+"],
      ] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.title = commandById[id].label;
        button.setAttribute("aria-label", commandById[id].label);
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          this.execute(id);
          bar.remove();
        });
        bar.append(button);
      }
      document.body.append(bar);
      this.selectionBar = bar;
      bar.style.left =
        Math.max(8, Math.min(box.left, innerWidth - bar.offsetWidth - 8)) +
        "px";
      bar.style.top = Math.max(8, box.top - bar.offsetHeight - 8) + "px";
    }, 140);
  }
  private currentQueryKey() {
    return this.source + ":" + this.selection.head;
  }
  private moveSnippet(direction: -1 | 1) {
    const snippet = this.snippet;
    if (!snippet) return false;
    const start = this.binding.absolute(snippet.fields[0]),
      end = this.binding.absolute(snippet.end);
    if (
      !start ||
      !end ||
      end.head <= start.anchor ||
      this.selection.head < start.anchor ||
      this.selection.head > end.head
    ) {
      this.snippet = null;
      return false;
    }
    const next = snippet.index + direction;
    if (next >= snippet.fields.length) {
      this.snippet = null;
      this.focus(end.head);
      return true;
    }
    snippet.index = Math.max(0, next);
    const field = this.binding.absolute(snippet.fields[snippet.index]);
    if (!field) {
      this.snippet = null;
      return false;
    }
    this.focus(field.anchor, field.head);
    return true;
  }
  private completions() {
    if (
      this.menuOpen ||
      this.popupKind === "find" ||
      this.options.readOnly() ||
      this.dismissQuery === this.currentQueryKey()
    )
      return;
    const matches =
      this.selection.anchor === this.selection.head
        ? nativeCompletions(
            this.source,
            this.selection.head,
            this.options.preferences(),
            this.options.context(),
            this.options.notes(),
          )
        : [];
    if (!matches.length) {
      if (this.popupKind === "slash") this.closePopup();
      return;
    }
    const box = this.map.rect(this.selection.head);
    if (!box) return;
    this.showPopup(
      "slash",
      matches.map((item) => ({
        label: item.label,
        mathSymbol: item.mathSymbol,
        icon: item.command
          ? editorCommandIcons[item.command]
          : (item.icon ?? "note"),
        action: () => {
          // Re-evaluate against the current CRDT text; a remote edit may have moved the query.
          const current = nativeCompletions(
            this.source,
            this.selection.head,
            this.options.preferences(),
            this.options.context(),
            this.options.notes(),
          ).find((c) => c.label === item.label);
          if (!current) {
            this.options.message(
              "The completion target changed. Type the query again.",
            );
            return;
          }
          if (current.command)
            this.execute(current.command, {
              from: current.from,
              to: current.to,
            });
          else {
            const value = current.value ?? "";
            this.edit({
              changes: [{ from: current.from, to: current.to, insert: value }],
              selection: {
                anchor: current.from + (current.select?.[0] ?? value.length),
                head: current.from + (current.select?.[1] ?? value.length),
              },
            });
            this.snippet = current.fields?.length
              ? {
                  fields: current.fields.map(([anchor, head]) =>
                    this.binding.relative({
                      anchor: current.from + anchor,
                      head: current.from + head,
                    }),
                  ),
                  end: this.binding.relative({
                    anchor: current.from + value.length,
                    head: current.from + value.length,
                  }),
                  index: 0,
                }
              : null;
          }
        },
      })),
      box.left,
      box.bottom + 6,
    );
  }
  private showPopup(
    kind: string,
    items: {
      label: string;
      icon: ActionIconName;
      mathSymbol?: string;
      action: () => unknown;
    }[],
    x: number,
    y: number,
  ) {
    const prior = this.popupKind === kind ? this.popupIndex : 0;
    this.closePopup();
    this.popupKind = kind;
    const menu = document.createElement("div");
    menu.className = "native-popup native-" + kind;
    menu.role = kind === "menu" ? "menu" : "listbox";
    menu.setAttribute(
      "aria-label",
      kind === "menu" ? "Block actions" : "Insert block",
    );
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.role = kind === "menu" ? "menuitem" : "option";
      button.className = "action-option";
      appendActionLabel(button, item.icon, item.label);
      if (item.mathSymbol)
        button.firstElementChild?.replaceWith(mathSymbolIcon(item.mathSymbol));
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => {
        this.closePopup();
        item.action();
        if (!document.querySelector("dialog[open]")) {
          this.content.focus({ preventScroll: true });
          this.restoreSelection();
        }
      });
      menu.append(button);
    }
    this.popup = menu;
    document.body.append(menu);
    menu.style.left =
      Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + "px";
    menu.style.top =
      Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + "px";
    this.selectPopup(Math.min(prior, items.length - 1));
  }
  private selectPopup(index: number) {
    const buttons = this.popup?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons?.length) return;
    this.popupIndex = (index + buttons.length) % buttons.length;
    buttons.forEach((b, i) => {
      b.classList.toggle("is-selected", i === this.popupIndex);
      b.setAttribute("aria-selected", String(i === this.popupIndex));
    });
    buttons[this.popupIndex].scrollIntoView({ block: "nearest" });
  }
  private closePopup() {
    this.popup?.remove();
    this.popup = null;
    this.popupKind = "";
  }
  private openFind(replace: boolean) {
    this.closePopup();
    this.popupKind = "find";
    const panel = document.createElement("form");
    panel.className = "native-find";
    panel.role = "search";
    panel.setAttribute("aria-label", "Find in note");
    const search = document.createElement("input");
    search.placeholder = "Find in note";
    search.setAttribute("aria-label", "Find in note");
    const replacementInput = document.createElement("input");
    replacementInput.placeholder = "Replace with";
    replacementInput.setAttribute("aria-label", "Replace with");
    const status = document.createElement("span");
    status.role = "status";
    let matches: number[] = [],
      index = -1;
    const update = () => {
      matches = [];
      if (search.value)
        for (
          let at = 0;
          (at = this.source.indexOf(search.value, at)) >= 0;
          at += search.value.length
        )
          matches.push(at);
      status.textContent = `${matches.length} matches`;
    };
    const next = () => {
      update();
      if (matches.length) {
        index = (index + 1) % matches.length;
        this.selection = {
          anchor: matches[index],
          head: matches[index] + search.value.length,
        };
        this.binding.select(this.selection);
        this.focused = true;
        this.render(true);
        this.scrollSelection();
        status.textContent = `${index + 1} of ${matches.length}`;
        search.focus();
      }
    };
    const button = (label: string, action: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", action);
      return b;
    };
    search.addEventListener("input", () => {
      index = -1;
      update();
    });
    panel.append(search, button("Next", next));
    if (replace && !this.options.readOnly())
      panel.append(
        replacementInput,
        button("Replace", () => {
          if (
            this.source.slice(
              ...(Object.values(selectionRange(this.selection)) as [
                number,
                number,
              ]),
            ) === search.value
          )
            this.edit(replacement(this.selection, replacementInput.value));
          next();
        }),
        button("Replace all", () => {
          update();
          if (!matches.length) return;
          this.edit({
            changes: matches.map((at) => ({
              from: at,
              to: at + search.value.length,
              insert: replacementInput.value,
            })),
            selection: { anchor: matches[0] },
          });
          update();
        }),
      );
    panel.append(
      status,
      button("Close", () => {
        this.closePopup();
        this.focus(this.selection.anchor, this.selection.head);
      }),
    );
    panel.addEventListener("submit", (event) => {
      event.preventDefault();
      next();
    });
    panel.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        this.closePopup();
        this.focus(this.selection.anchor, this.selection.head);
      }
    });
    this.popup = panel;
    this.dom.prepend(panel);
    search.focus();
  }
  private schedulePresence = () => {
    if (this.paintFrame || this.destroyed) return;
    this.paintFrame = requestAnimationFrame(() => {
      this.paintFrame = 0;
      this.paintPresence();
    });
  };
  private paintPresence() {
    this.overlay.replaceChildren();
    const box = this.dom.getBoundingClientRect();
    for (const peer of this.peers) {
      if (!peer.selection) continue;
      const { from, to } = selectionRange(peer.selection);
      const atom = Array.from(
        this.content.querySelectorAll<HTMLElement>(
          ".native-math-preview, .native-atom",
        ),
      ).find(
        (el) =>
          !el.closest(".native-math-block.is-editing") &&
          peer.selection!.head >= Number(el.dataset.nfrom) &&
          peer.selection!.head <= Number(el.dataset.nto),
      );
      const rect =
        atom?.getBoundingClientRect() ?? this.map.rect(peer.selection.head);
      if (!rect) continue;
      if (!atom && from !== to)
        for (const r of this.map.rangeRects(from, to)) {
          const mark = document.createElement("span");
          mark.className = "native-peer-range";
          mark.style.cssText = `left:${r.left - box.left}px;top:${r.top - box.top}px;width:${r.width}px;height:${r.height}px;background:${peer.color}26`;
          this.overlay.append(mark);
        }
      const caret = document.createElement("span");
      caret.className = atom
        ? "native-peer-caret native-peer-block"
        : "native-peer-caret";
      caret.dataset.clientId = String(peer.clientId);
      caret.style.cssText = `left:${rect.left - box.left}px;top:${rect.top - box.top}px;height:${rect.height}px;--peer-color:${peer.color}`;
      const label = document.createElement("span");
      label.textContent = peer.name + (atom ? " · editing equation" : "");
      caret.append(label);
      this.overlay.append(caret);
    }
  }
  private mathRendered = (event: Event) => {
    const target = event.target as HTMLElement,
      block = target.closest<HTMLElement>(".native-math-block");
    if (!block) return;
    const from = Number(block.dataset.nfrom),
      result = (event as CustomEvent<{ error?: string }>).detail;
    block.querySelector(".native-math-diagnostic")?.remove();
    if (!result.error) this.lastGoodMath.set(from, target.innerHTML);
    else {
      const message = document.createElement("div");
      message.className = "native-math-diagnostic";
      message.contentEditable = "false";
      message.dataset.nativeUi = "true";
      message.role = "status";
      const old =
        this.options.preferences().mathKeepLastPreview &&
        this.lastGoodMath.get(from);
      if (old) {
        target.innerHTML = old;
        target.dataset.mathState = "stale";
      }
      message.textContent = `${old ? "Last valid preview · " : "Equation error · "}${result.error}`;
      block.append(message);
    }
    this.schedulePresence();
  };
  private renderDiagrams() {
    for (const el of this.content.querySelectorAll<HTMLElement>(
      "[data-mermaid]:not([data-native-rendering])",
    )) {
      el.dataset.nativeRendering = "true";
      const source = el.dataset.mermaid ?? "";
      void import("mermaid")
        .then(async ({ default: mermaid }) => {
          if (!el.isConnected || el.dataset.mermaid !== source) return;
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            maxTextSize: 30000,
            flowchart: { htmlLabels: false },
            theme:
              document.documentElement.dataset.theme === "dark"
                ? "dark"
                : "default",
            suppressErrorRendering: true,
          });
          const result = await mermaid.render(
            "native-diagram-" + crypto.randomUUID(),
            source,
          );
          if (el.isConnected && el.dataset.mermaid === source)
            el.innerHTML = result.svg;
        })
        .catch(() => {
          if (el.isConnected) {
            el.dataset.diagramError = "true";
            el.title =
              "Diagram syntax could not be rendered. Edit the source above.";
          }
        });
    }
  }
  destroy() {
    this.destroyed = true;
    this.footnotePreviews.destroy();
    this.resizeObserver.disconnect();
    this.abort.abort();
    this.unsubscribe();
    this.unpresence();
    this.closePopup();
    this.menuDismiss?.();
    clearTimeout(this.selectionTimer);
    this.selectionBar?.remove();
    cancelAnimationFrame(this.paintFrame);
    this.binding.destroy();
    this.lastGoodMath.clear();
    this.dom.remove();
  }
}
