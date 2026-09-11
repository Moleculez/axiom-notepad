import { findMatches, type SearchMatch } from "@axiom/editor/search";
import type { SourceEdit } from "@axiom/markdown";
import {
  selectionRange,
  type SourceSelection,
} from "@axiom/editor/transactions";

type FindHost = {
  source: () => string;
  selection: () => SourceSelection;
  readOnly: () => boolean;
  select: (from: number, to: number) => void;
  edit: (edit: SourceEdit) => void;
  paint: () => void;
  close: () => void;
};

/** One source-backed find panel across rich/source/nested editors. Re-resolves
 * against current shared text before replacing; no stale offsets or extra undo. */
export class FindPanel {
  readonly dom = document.createElement("form");
  private query = document.createElement("input");
  private replacement = document.createElement("input");
  private status = document.createElement("span");
  private sensitive = document.createElement("input");
  private words = document.createElement("input");
  private replacements: HTMLButtonElement[] = [];
  matches: SearchMatch[] = [];
  constructor(
    readonly host: FindHost,
    replace: boolean,
  ) {
    this.dom.className = "axiom-find";
    this.dom.role = "search";
    this.dom.setAttribute("aria-label", "Find in note");
    const row = document.createElement("div");
    row.className = "axiom-find-row";
    this.query.type = "search";
    this.query.placeholder = "Find in note";
    this.query.setAttribute("aria-label", "Find in note");
    const selection = selectionRange(host.selection());
    const selected = host.source().slice(selection.from, selection.to);
    if (!selected.includes("\n") && selected.length <= 256)
      this.query.value = selected;
    this.query.addEventListener("input", () => {
      this.update();
      this.next(1, true);
    });
    row.append(
      this.query,
      this.button("Previous match", "↑", () => this.next(-1)),
      this.button("Next match", "↓", () => this.next(1)),
    );
    for (const [input, label, text] of [
      [this.sensitive, "Match case", "Aa"],
      [this.words, "Whole words", "Ab"],
    ] as const) {
      const wrapper = document.createElement("label");
      wrapper.title = label;
      input.type = "checkbox";
      input.setAttribute("aria-label", label);
      input.addEventListener("change", () => {
        this.update();
        this.host.paint();
      });
      wrapper.append(input, text);
      row.append(wrapper);
    }
    this.status.role = "status";
    row.append(
      this.status,
      this.button("Close find", "×", () => host.close()),
    );
    this.dom.append(row);
    if (replace) {
      const row = document.createElement("div");
      row.className = "axiom-find-row";
      this.replacement.placeholder = "Replace with";
      this.replacement.setAttribute("aria-label", "Replace with");
      this.replacements = [
        this.button("Replace match", "Replace", () => this.replace(false)),
        this.button("Replace all matches", "Replace all", () =>
          this.replace(true),
        ),
      ];
      row.append(this.replacement, ...this.replacements);
      this.dom.append(row);
    }
    this.dom.addEventListener("submit", (event) => {
      event.preventDefault();
      this.next(1);
    });
    this.dom.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        host.close();
      } else if (event.key === "Enter" && event.shiftKey) {
        event.preventDefault();
        this.next(-1);
      }
    });
    this.update();
  }
  private button(label: string, text: string, action: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = text;
    button.addEventListener("click", action);
    return button;
  }
  update() {
    this.matches = findMatches(
      this.host.source(),
      this.query.value,
      this.sensitive.checked,
      this.words.checked,
    );
    const range = selectionRange(this.host.selection());
    const index = this.matches.findIndex(
      (match) => match.from === range.from && match.to === range.to,
    );
    this.status.textContent =
      index < 0
        ? `${this.matches.length} matches`
        : `${index + 1} of ${this.matches.length}`;
    this.replacement.disabled = this.host.readOnly();
    this.replacements.forEach((button) => {
      button.disabled = this.host.readOnly() || !this.matches.length;
    });
  }
  private next(direction: number, inclusive = false) {
    this.update();
    const selection = selectionRange(this.host.selection());
    const at = direction > 0 ? selection.to : selection.from;
    const match =
      direction > 0
        ? (this.matches.find(
            (m) => m.from >= (inclusive ? selection.from : at),
          ) ?? this.matches[0])
        : ([...this.matches].reverse().find((m) => m.to <= at) ??
          this.matches.at(-1));
    if (match) this.host.select(match.from, match.to);
    this.update();
    this.host.paint();
    this.query.focus();
  }
  private replace(all: boolean) {
    if (this.host.readOnly()) return;
    this.update();
    const range = selectionRange(this.host.selection());
    const matches = all
      ? this.matches
      : this.matches.filter((m) => m.from === range.from && m.to === range.to);
    if (matches.length)
      this.host.edit({
        changes: matches.map((m) => ({ ...m, insert: this.replacement.value })),
        selection: { anchor: matches[0].from + this.replacement.value.length },
      });
    this.next(1);
  }
  focus() {
    this.query.focus();
    this.query.select();
  }
  destroy() {
    this.dom.remove();
  }
}
