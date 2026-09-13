import {
  EditorState,
  Compartment,
  Transaction,
  ChangeSet,
  StateEffect,
  StateField,
  Prec,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  Decoration,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import {
  syntaxHighlighting,
  HighlightStyle,
  indentUnit,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { codeLanguageSyntax } from "./code-languages";
import { tags } from "@lezer/highlight";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { minimalChange, containerText, type TextChange } from "@axiom/markdown";
import type { NativeTransaction, SourceSelection } from "./transactions";
import type { NavigationBlock, NavigationPosition } from "./minimap";

export type TextSurfaceValue = {
  text: string;
  from: number;
  offsets?: readonly number[];
  prefix?: string;
  lineEnding?: string;
};
const axiomHighlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.modifier, tags.operatorKeyword],
    color: "var(--syntax)",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    color: "var(--accent)",
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    color: "var(--syntax)",
  },
  {
    tag: [tags.comment, tags.meta],
    color: "var(--muted)",
    fontStyle: "italic",
  },
  {
    tag: [tags.function(tags.variableName), tags.typeName, tags.className],
    color: "var(--accent)",
  },
  { tag: [tags.heading, tags.strong], fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "var(--accent)", textDecoration: "underline" },
  {
    tag: tags.invalid,
    color: "var(--danger)",
    textDecoration: "underline wavy",
  },
]);
export type TextMarker = {
  id: string;
  from: number;
  to: number;
  head?: number;
  kind: "peer" | "discussion" | "search";
  color?: string;
  label?: string;
};
const markerEffect = StateEffect.define<DecorationSet>();
const markerField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, tr) => {
    for (const effect of tr.effects)
      if (effect.is(markerEffect)) return effect.value;
    return value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});
class PeerCaret extends WidgetType {
  constructor(
    readonly id: string,
    readonly color: string,
    readonly label: string,
  ) {
    super();
  }
  eq(other: PeerCaret) {
    return (
      this.id === other.id &&
      this.color === other.color &&
      this.label === other.label
    );
  }
  toDOM() {
    const caret = document.createElement("span");
    caret.className = "axiom-peer-caret";
    caret.style.setProperty("--peer-color", this.color);
    const label = document.createElement("span");
    label.textContent = this.label;
    caret.append(label);
    return caret;
  }
}
export type TextSurfaceOptions = {
  value: TextSurfaceValue;
  label: string;
  source?: boolean;
  language?: string;
  readOnly: boolean;
  wrap: boolean;
  numbers: boolean;
  indent: number;
  activeLine?: boolean;
  /** Host-scoped capabilities; never enables completion on other surfaces. */
  extensions?: Extension;
  edit: (
    changes: TextChange[],
    selection: SourceSelection,
    kind: NativeTransaction["kind"],
  ) => void;
  select: (selection: SourceSelection) => void;
  keydown: (event: KeyboardEvent) => boolean;
  input?: (selection: SourceSelection, value: string) => boolean;
  composition?: (active: boolean) => void;
};

/** Explicit CM6 setup: no basicSetup/history/historyKeymap and no y-codemirror
 * fragment. The host writes to the same source binding and Yjs undo as rich mode. */
export class TextSurface {
  readonly view: EditorView;
  private settings = new Compartment();
  private language = new Compartment();
  private options: TextSurfaceOptions;
  private value: TextSurfaceValue;
  private updating = false;
  private destroyed = false;
  private languageVersion = 0;
  constructor(parent: HTMLElement, options: TextSurfaceOptions) {
    this.options = options;
    this.value = options.value;
    this.view = new EditorView({
      parent,
      dispatchTransactions: (transactions, view) => {
        view.update(transactions);
        this.authored(transactions, view);
      },
      state: EditorState.create({
        doc: this.value.text,
        extensions: [
          // Split only on LF. Existing CR characters remain in the CM document;
          // opening a CRLF/mixed-ending file cannot change its UTF-16 coordinates.
          EditorState.lineSeparator.of("\n"),
          drawSelection(),
          markerField,
          syntaxHighlighting(axiomHighlight),
          this.settings.of(this.configuration()),
          this.language.of([]),
          options.extensions ?? [],
          EditorView.contentAttributes.of({
            "aria-label": options.label,
            spellcheck: "false",
            // Keep keyboard focus when permission changes remove contenteditable.
            tabindex: "0",
          }),
          Prec.highest(
            EditorView.domEventHandlers({
              keydown: (event) => {
                if (
                  this.options.readOnly &&
                  ["Backspace", "Delete"].includes(event.key)
                ) {
                  // WebKit otherwise treats Backspace on non-editable content as Back.
                  event.preventDefault();
                  return true;
                }
                return this.options.keydown(event);
              },
              compositionstart: () => {
                this.options.composition?.(true);
                return false;
              },
              compositionend: () => {
                setTimeout(() => this.options.composition?.(false), 0);
                return false;
              },
            }),
          ),
          EditorView.inputHandler.of((view, from, to, text) => {
            if (view.composing || this.options.readOnly) return false;
            return (
              this.options.input?.(
                { anchor: this.sourceAt(from), head: this.sourceAt(to) },
                text,
              ) ?? false
            );
          }),
          keymap.of([...defaultKeymap, indentWithTab, ...searchKeymap]),
          search({ top: true }),
        ],
      }),
    });
    this.loadLanguage();
  }
  private configuration(): Extension[] {
    return this.configurationValue();
  }
  private authored(transactions: readonly Transaction[], view: EditorView) {
    const update = {
      state: view.state,
      changes: transactions.reduce(
        (changes, tr) => changes.compose(tr.changes),
        ChangeSet.empty(
          transactions[0]?.startState.doc.length ?? view.state.doc.length,
        ),
      ),
      transactions,
      docChanged: transactions.some((tr) => tr.docChanged),
      selectionSet: transactions.some((tr) => !!tr.selection),
      focusChanged: false,
    };

    if (this.updating) return;
    const selection = update.state.selection.main;
    if (update.docChanged) {
      const value = this.value,
        changes: TextChange[] = [],
        insertedMaps: {
          from: number;
          to: number;
          a: number;
          b: number;
          text: string;
          offsets: number[];
        }[] = [];
      const at = (n: number) => value.offsets?.[n] ?? value.from + n;
      update.changes.iterChanges((from, to, a, b, inserted) => {
        const insert = containerText(
          inserted.toString(),
          value.prefix,
          value.lineEnding,
        );
        insertedMaps.push({ from, to, a, b, ...insert });
        changes.push({ from: at(from), to: at(to), insert: insert.text });
      });
      // CM positions are in the new buffer. Reconstruct their source
      // offsets from the untouched mapping and inserted prefix lengths.
      const nextPosition = (n: number) => {
        let delta = 0,
          result = at(update.changes.invertedDesc.mapPos(n, 1));
        for (const { from, to, a, b, text, offsets } of insertedMaps) {
          if (n < a) break;
          if (n <= b) {
            result = at(from) + delta + offsets[n - a];
            break;
          } else {
            delta += text.length - (at(to) - at(from));
            result = at(update.changes.invertedDesc.mapPos(n, 1)) + delta;
          }
        }
        return result;
      };
      // Composing updates address the new CM buffer even while rich projection
      // is frozen. Keep container-prefix/CRLF offsets current between updates.
      this.value = {
        ...value,
        text: view.state.doc.toString(),
        ...(value.offsets
          ? {
              offsets: Array.from(
                { length: view.state.doc.length + 1 },
                (_, at) => nextPosition(at),
              ),
            }
          : {}),
      };
      this.options.edit(
        changes,
        {
          anchor: nextPosition(selection.anchor),
          head: nextPosition(selection.head),
        },
        update.transactions.some((tr) => tr.isUserEvent("input.type.compose"))
          ? "composition"
          : update.transactions.some((tr) => tr.isUserEvent("input.paste"))
            ? "paste"
            : update.transactions.some((tr) => tr.isUserEvent("delete"))
              ? "delete"
              : update.transactions.some((tr) =>
                    tr.isUserEvent("input.complete"),
                  )
                ? "command"
                : "typing",
      );
    } else if (update.selectionSet || update.focusChanged) {
      this.options.select({
        anchor: this.sourceAt(selection.anchor),
        head: this.sourceAt(selection.head),
      });
    }
  }
  private configurationValue(): Extension[] {
    return [
      EditorState.readOnly.of(this.options.readOnly),
      EditorView.editable.of(!this.options.readOnly),
      indentUnit.of(" ".repeat(this.options.indent)),
      ...(this.options.wrap ? [EditorView.lineWrapping] : []),
      ...(this.options.numbers ? [lineNumbers()] : []),
      ...(this.options.activeLine ? [highlightActiveLine()] : []),
    ];
  }
  private loadLanguage() {
    const version = ++this.languageVersion;
    if (this.options.source) {
      this.view.dispatch({
        effects: this.language.reconfigure(
          markdown({ codeLanguages: languages }),
        ),
      });
      return;
    }
    const name = codeLanguageSyntax(this.options.language);
    const language = languages.find(
      (l) => l.name.toLowerCase() === name || l.alias.includes(name ?? ""),
    );
    if (!language) {
      this.view.dispatch({ effects: this.language.reconfigure([]) });
      return;
    }
    void language
      .load()
      .then((extension) => {
        if (!this.destroyed && version === this.languageVersion)
          this.view.dispatch({ effects: this.language.reconfigure(extension) });
      })
      .catch(() => {
        /* Plain text remains editable when a language chunk fails. */
      });
  }
  sourceAt(position: number) {
    return this.value.offsets?.[position] ?? this.value.from + position;
  }
  /** Uses the editor height map, including virtualized offscreen source lines. */
  navigationLines(limit = 12000): NavigationBlock[] {
    if (this.destroyed) return [];
    const doc = this.view.state.doc,
      box = this.view.contentDOM.getBoundingClientRect();
    const top = this.view.documentTop,
      stride = Math.max(1, Math.ceil(doc.lines / limit));
    const result: NavigationBlock[] = [];
    for (let number = 1; number <= doc.lines; number += stride) {
      const start = doc.line(number),
        end = doc.line(Math.min(doc.lines, number + stride - 1));
      const first = this.view.lineBlockAt(start.from),
        last = this.view.lineBlockAt(end.to);
      result.push({
        from: this.sourceAt(start.from),
        to: this.sourceAt(end.to),
        type: "sourceLine",
        left: box.left,
        right: box.right,
        top: top + first.top,
        bottom: top + last.bottom,
      });
    }
    return result;
  }
  /** Viewport coordinates in this surface, not the parent rich projection. */
  caretRect(source: number) {
    return this.destroyed
      ? null
      : this.view.coordsAtPos(this.positionAt(source));
  }
  navigationPosition(source: number): NavigationPosition | null {
    if (this.destroyed || !this.view.dom.getClientRects().length) return null;
    const at = this.positionAt(source),
      caret = this.view.coordsAtPos(at);
    if (caret && caret.bottom > caret.top) return caret;
    // Virtualized lines have no DOM Range; use their own height-map row, never
    // interpolate the source character offset across a whole paragraph/block.
    const line = this.view.lineBlockAt(at);
    return {
      top: this.view.documentTop + line.top,
      bottom: this.view.documentTop + line.bottom,
      estimated: true,
    };
  }
  private positionAt(source: number) {
    const offsets = this.value.offsets;
    if (!offsets)
      return Math.max(
        0,
        Math.min(this.view.state.doc.length, source - this.value.from),
      );
    let a = 0,
      b = offsets.length - 1;
    while (a < b) {
      const mid = (a + b) >>> 1;
      if (offsets[mid] < source) a = mid + 1;
      else b = mid;
    }
    return a;
  }
  update(value: TextSurfaceValue, selection?: SourceSelection) {
    if (this.destroyed) return;
    this.value = value;
    const before = this.view.state.doc.toString();
    const change =
      before === value.text ? null : minimalChange(before, value.text);
    this.updating = true;
    try {
      if (change)
        this.view.dispatch({
          changes: change,
          annotations: Transaction.addToHistory.of(false),
        });
      if (selection && this.view.hasFocus) {
        const anchor = this.positionAt(selection.anchor),
          head = this.positionAt(selection.head),
          current = this.view.state.selection.main;
        // A binding echo is not a cursor move. A redundant selection transaction
        // cancels an in-flight completion and can deactivate snippet fields.
        if (current.anchor !== anchor || current.head !== head)
          this.view.dispatch({ selection: { anchor, head } });
      }
    } finally {
      this.updating = false;
    }
  }
  configure(options: Partial<TextSurfaceOptions>) {
    const language = this.options.language;
    Object.assign(this.options, options);
    this.view.contentDOM.setAttribute(
      "aria-readonly",
      String(this.options.readOnly),
    );
    this.view.dispatch({
      effects: this.settings.reconfigure(this.configuration()),
    });
    if (language !== this.options.language) this.loadLanguage();
  }
  focus(selection: SourceSelection) {
    this.updating = true;
    try {
      this.view.dispatch({
        selection: {
          anchor: this.positionAt(selection.anchor),
          head: this.positionAt(selection.head),
        },
        scrollIntoView: true,
      });
      this.view.focus();
    } finally {
      this.updating = false;
    }
  }
  find() {
    openSearchPanel(this.view);
  }
  markers(markers: TextMarker[]) {
    if (this.destroyed) return;
    const from = this.sourceAt(0),
      to = this.sourceAt(this.view.state.doc.length);
    const ranges: import("@codemirror/state").Range<Decoration>[] = [];
    for (const marker of markers) {
      if (marker.to < from || marker.from > to) continue;
      const a = this.positionAt(Math.max(from, marker.from)),
        b = this.positionAt(Math.min(to, marker.to));
      if (b > a)
        ranges.push(
          Decoration.mark({
            class: `axiom-${marker.kind}-range`,
            attributes:
              marker.kind === "peer"
                ? { style: `--peer-color:${marker.color}` }
                : marker.kind === "discussion"
                  ? {
                      "data-discussion-id": marker.id,
                      title: "Open anchored discussion",
                    }
                  : {},
          }).range(a, b),
        );
      const head = marker.head ?? marker.to;
      if (marker.kind === "peer" && head >= from && head <= to)
        ranges.push(
          Decoration.widget({
            widget: new PeerCaret(
              marker.id,
              marker.color ?? "#64748b",
              marker.label ?? "Researcher",
            ),
            side: 1,
          }).range(this.positionAt(head)),
        );
    }
    this.view.dispatch({
      effects: markerEffect.of(Decoration.set(ranges, true)),
      annotations: Transaction.addToHistory.of(false),
    });
  }
  destroy() {
    this.destroyed = true;
    this.languageVersion++;
    this.view.destroy();
  }
}
