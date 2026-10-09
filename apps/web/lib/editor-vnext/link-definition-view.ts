import {
  paragraphBesideBlock,
  sourceLine,
  minimalChange,
  safeUrl,
  type MarkdownNode,
  type ParsedDocument,
} from "@axiom/markdown";
import {
  editLinkDefinition,
  linkDefinitionModel,
  linkDefinitionUses,
  referenceKey,
  type DefinitionField,
} from "@axiom/editor/link-definitions";
import { applyChanges, mapPosition } from "@axiom/editor/transactions";
import { bindAttribute, bindText } from "@axiom/i18n/dom";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { NodeView } from "@milkdown/kit/prose/view";
import type { AxiomEditorView } from "./view";
import { iconButton } from "./chrome";
import { openContextMenu } from "../context-menu";
import { PropertyTable } from "./property-table";

type Control = HTMLInputElement | HTMLTextAreaElement;
const usageCache = new WeakMap<
  ParsedDocument,
  ReturnType<typeof linkDefinitionUses>
>();
const fields: DefinitionField[] = ["key", "href", "title"];

/** Stable native fields over the authoritative Markdown, never a second rich
 * document. Field drafts commit once and fail closed against concurrent edits. */
export class LinkDefinitionView implements NodeView {
  private presentation = new PropertyTable(
    "Link definition",
    "axiom-link-definition",
    "referenceDefinition",
  );
  readonly dom = this.presentation.dom;
  private inputs = {} as Record<DefinitionField, Control>;
  private usage = document.createElement("button");
  private open: HTMLButtonElement;
  private menu: (() => void) | undefined;
  private committing = false;
  private destroyed = false;
  private composing = false;
  private useIndex = 0;
  private draft?: {
    field: DefinitionField;
    value: string;
    source: string;
    original: string;
    parsed: ParsedDocument;
    node: MarkdownNode;
    range: ReturnType<AxiomEditorView["binding"]["relative"]>;
  };
  constructor(
    private owner: AxiomEditorView,
    private getPos: () => number | undefined,
  ) {
    this.usage.type = "button";
    this.usage.className = "editor-property-detail-button";
    this.usage.addEventListener("click", () => this.jumpToUse());
    this.open = iconButton("Open destination", "link", () =>
      this.openDestination(),
    );
    const copy = iconButton("Copy reference link", "copy", () => {
      const node = this.sourceNode();
      if (node) this.copy(`[${node.key}]`);
    });
    const more = iconButton("Link definition actions", "more", () => {
      const box = more.getBoundingClientRect();
      this.showMenu(box.right, box.bottom + 4);
    });
    more.setAttribute("aria-haspopup", "menu");
    this.presentation.actions.append(this.open, copy, more);
    this.presentation.detail.append(this.usage);
    const body = document.createElement("tbody");
    const labels = { key: "Reference ID", href: "Destination", title: "Title" };
    for (const field of fields) {
      const input =
        field !== "href"
          ? document.createElement("textarea")
          : document.createElement("input");
      if (input instanceof HTMLTextAreaElement) input.rows = 1;
      bindAttribute(input, "aria-label", labels[field]);
      input.setAttribute("autocomplete", "off");
      input.spellcheck = field === "title";
      bindAttribute(
        input,
        "placeholder",
        field === "key"
          ? "paper"
          : field === "href"
            ? "https://… or a file path"
            : "Optional hover text",
      );
      input.maxLength = field === "key" ? 999 : 8000;
      input.dataset.field = field;
      this.inputs[field] = input;
      const label = document.createElement("span");
      bindText(label, labels[field]);
      body.append(this.presentation.row(label, this.presentation.field(input)));
      input.addEventListener("focus", () => this.begin(field));
      input.addEventListener("input", () => {
        input.removeAttribute("aria-invalid");
        this.hint("Enter to save · Escape to cancel");
      });
      input.addEventListener("compositionstart", () => {
        this.composing = true;
      });
      input.addEventListener("compositionend", () => {
        this.composing = false;
      });
      input.addEventListener("blur", () => {
        if (this.destroyed || this.committing) return;
        if (!this.commit()) this.recover();
        queueMicrotask(() => {
          if (!this.destroyed) this.render();
        });
      });
      input.addEventListener("keydown", (event) =>
        this.keydown(event as KeyboardEvent, field),
      );
    }
    this.presentation.body(body);
    this.dom.addEventListener("contextmenu", (event) => {
      event.stopPropagation();
      if ((event.target as Element).closest("input,textarea")) return;
      event.preventDefault();
      this.showMenu(event.clientX, event.clientY);
    });
    this.render();
  }
  private sourceNode() {
    return this.owner.embeddedNode(this.getPos());
  }
  private hint(text: string, error = false) {
    this.presentation.message(
      text,
      error,
      this.draft && this.inputs[this.draft.field],
    );
  }
  private begin(field: DefinitionField) {
    const node = this.sourceNode(),
      model = node && linkDefinitionModel(this.owner.source, node);
    if (!node || !model || this.owner.options.readOnly()) return;
    // Values can change after a peer update but before the browser focus event.
    this.inputs[field].value = model[field].value;
    this.draft = {
      field,
      value: model[field].value,
      source: this.owner.source,
      original: this.owner.source.slice(node.from, node.to),
      parsed: this.owner.parsed,
      node,
      range: this.owner.binding.relative({ anchor: node.from, head: node.to }),
    };
    const at = model[field].from;
    this.owner.selection = { anchor: at, head: at };
    this.owner.binding.select(this.owner.selection);
    this.hint(
      field === "key"
        ? "Renaming also updates this document’s reference links."
        : "Enter to save · Escape to cancel",
    );
  }
  private resolveDraft() {
    const node = this.sourceNode(),
      draft = this.draft;
    const range = draft && this.owner.binding.absolute(draft.range);
    return node &&
      draft &&
      range &&
      node.from === range.anchor &&
      node.to === range.head &&
      this.owner.source.slice(range.anchor, range.head) === draft.original
      ? node
      : null;
  }
  private recover() {
    const draft = this.draft;
    if (!draft) return;
    const value = this.inputs[draft.field].value;
    this.draft = undefined;
    if (value === draft.value) return;
    // A valid draft is retained as complete Markdown; an invalid one is still
    // retained verbatim in a comment instead of silently discarding user input.
    const edit = editLinkDefinition(
      draft.source,
      draft.parsed,
      draft.node,
      draft.field,
      value,
    );
    this.owner.options.recover(
      edit?.changes
        ? applyChanges(draft.source, edit.changes)
        : draft.source +
            `\n\n<!-- Link definition ${draft.field} draft: ${value.replace(/-->/g, "-- >")} -->\n`,
    );
    this.owner.options.message(
      "This definition changed or the field could not be saved. Your draft was retained in recovery.",
    );
  }
  private commit() {
    const draft = this.draft;
    if (!draft || this.committing) return true;
    const input = this.inputs[draft.field];
    if (input.value === draft.value) {
      this.draft = undefined;
      return true;
    }
    if (this.owner.options.readOnly() || !this.resolveDraft()) {
      this.recover();
      this.render();
      return false;
    }
    const node = this.sourceNode()!;
    const edit = editLinkDefinition(
      this.owner.source,
      this.owner.parsed,
      node,
      draft.field,
      input.value,
    );
    if (!edit.changes) {
      input.setAttribute("aria-invalid", "true");
      this.hint(edit.error, true);
      return false;
    }
    this.draft = undefined;
    this.committing = true;
    try {
      this.owner.edit(
        {
          changes: edit.changes,
          selection: { anchor: mapPosition(node.from, edit.changes) },
        },
        "command",
        undefined,
        false,
      );
    } finally {
      this.committing = false;
    }
    this.render();
    this.hint("Saved to Markdown");
    return true;
  }
  /** Explicit mode switches do not depend on browser-specific blur ordering. */
  finish() {
    if (!this.commit()) this.recover();
  }
  private keydown(event: KeyboardEvent, field: DefinitionField) {
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229 || this.composing) return;
    const input = this.inputs[field];
    if ((event.metaKey || event.ctrlKey) && event.key === "/") {
      event.preventDefault();
      this.finish();
      this.owner.execute("source");
      return;
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      ["z", "y"].includes(event.key.toLowerCase())
    ) {
      if (this.draft && input.value !== this.draft.value) return; // Native draft undo.
      event.preventDefault();
      this.draft = undefined;
      input.removeAttribute("aria-invalid");
      input.blur();
      this.owner.binding.history(
        event.shiftKey || event.key.toLowerCase() === "y",
      );
      if (input.isConnected) {
        this.render();
        input.focus();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.draft) input.value = this.draft.value;
      this.draft = undefined;
      input.removeAttribute("aria-invalid");
      input.blur();
      this.render();
      return;
    }
    if (
      event.key === "Backspace" &&
      field === "href" &&
      !input.value &&
      !this.inputs.title.value &&
      !this.owner.options.readOnly()
    ) {
      event.preventDefault();
      const node = this.resolveDraft();
      if (!node) {
        this.recover();
        return;
      }
      const prefix =
        this.owner.source.slice(
          node.from,
          linkDefinitionModel(this.owner.source, node)!.key.to + 2,
        ) + " ";
      this.draft = undefined;
      const ending =
        /\r?\n$/.exec(this.owner.source.slice(node.from, node.to))?.[0] ?? "";
      this.owner.edit({
        changes: [{ from: node.from, to: node.to, insert: prefix + ending }],
        selection: { anchor: node.from + prefix.length },
      });
      return;
    }
    if (event.key === "Enter" && !(event.shiftKey && field === "title")) {
      event.preventDefault();
      if (!this.commit()) return;
      if (event.metaKey || event.ctrlKey || field === "title") this.exit();
      else this.inputs[fields[fields.indexOf(field) + 1]].focus();
    }
  }
  private exit() {
    if (!this.commit()) return;
    const node = this.sourceNode();
    if (this.dom.contains(document.activeElement))
      (document.activeElement as HTMLElement).blur();
    if (!node) return;
    const edit = paragraphBesideBlock(this.owner.source, node, false);
    const after = applyChanges(this.owner.source, edit.changes);
    const line = sourceLine(after, edit.selection.anchor);
    const newline = after.indexOf("\n", line.to);
    // A following paragraph needs its own blank separator once typing starts.
    // Do not join the new paragraph with existing prose below the definition.
    if (newline >= 0 && sourceLine(after, newline + 1).text.trim()) {
      const result =
        after.slice(0, line.to) + line.ending + after.slice(line.to);
      edit.changes = [minimalChange(this.owner.source, result)];
    }
    this.owner.edit(edit);
  }
  private copy(text: string) {
    void navigator.clipboard.writeText(text).then(
      () => this.hint("Copied"),
      () => this.owner.options.message("Clipboard access was denied."),
    );
  }
  private openDestination() {
    const href = this.sourceNode()?.href;
    if (href && safeUrl(href)) this.owner.openLink(href);
  }
  private uses() {
    const parsed = this.owner.parsed;
    let index = usageCache.get(parsed);
    if (!index) {
      index = linkDefinitionUses(this.owner.source, parsed);
      usageCache.set(parsed, index);
    }
    return index.get(referenceKey(this.sourceNode()?.key ?? "")) ?? [];
  }
  private jumpToUse() {
    if (!this.commit()) return;
    const uses = this.uses();
    if (uses.length) this.owner.focus(uses[this.useIndex++ % uses.length].at);
  }
  private showMenu(x: number, y: number) {
    this.menu?.();
    this.menu = openContextMenu({
      owner: this.dom,
      x,
      y,
      label: "Link definition actions",
      items: [
        {
          label: "Copy destination",
          icon: "link",
          action: () => this.copy(this.sourceNode()?.href ?? ""),
        },
        {
          label: "Copy definition Markdown",
          icon: "copy",
          action: () => {
            const node = this.sourceNode();
            if (node) this.copy(this.owner.source.slice(node.from, node.to));
          },
        },
        {
          label: "Continue after definition",
          icon: "paragraph",
          group: "Navigation",
          disabled: this.owner.options.readOnly(),
          action: () => this.exit(),
        },
        {
          label: "Edit in Source mode",
          icon: "source",
          action: () => {
            if (!this.commit()) return;
            const node = this.sourceNode();
            if (node)
              this.owner.setSelection({ anchor: node.from, head: node.from });
            this.owner.execute("source");
          },
        },
      ],
    });
  }
  focus(at: number) {
    const node = this.sourceNode(),
      model = node && linkDefinitionModel(this.owner.source, node);
    if (!node || !model || at < node.from || at >= node.to) return false;
    const field =
      at <= model.key.to
        ? "key"
        : at >= model.title.from && node.title !== undefined
          ? "title"
          : "href";
    const input = this.inputs[field];
    input.focus();
    const offset = Math.max(
      0,
      Math.min(input.value.length, at - model[field].from),
    );
    input.setSelectionRange(offset, offset);
    return true;
  }
  render() {
    if (this.destroyed) return;
    const node = this.sourceNode(),
      model = node && linkDefinitionModel(this.owner.source, node);
    if (!node || !model) return;
    if (this.owner.options.readOnly()) this.recover();
    this.presentation.readOnly(this.owner.options.readOnly());
    for (const field of fields) {
      const input = this.inputs[field];
      input.readOnly = this.owner.options.readOnly();
      if (this.draft?.field !== field && input.value !== model[field].value)
        input.value = model[field].value;
    }
    const count = this.uses().length;
    this.usage.textContent = `${count} ${count === 1 ? "use" : "uses"}`;
    this.usage.disabled = !count;
    this.usage.setAttribute(
      "aria-label",
      count ? `Go to next reference use (${count})` : "No reference uses",
    );
    this.open.disabled = !node.href || !safeUrl(node.href);
    this.presentation.layout();
    if (!this.draft) {
      const duplicate = this.owner.parsed.definitions?.some(
        (n) =>
          n.type === "referenceDefinition" &&
          n.from !== node.from &&
          referenceKey(n.key ?? "") === referenceKey(node.key ?? ""),
      );
      this.hint(
        duplicate
          ? "Duplicate ID · Markdown uses the first definition."
          : node.href && !safeUrl(node.href)
            ? "This destination is blocked for safety."
            : "Reusable link · hidden in reading view",
        !!duplicate || (!!node.href && !safeUrl(node.href)),
      );
    }
  }
  update(node: ProseNode) {
    if (
      node.type.name !== "raw_block" ||
      node.attrs.kind !== "referenceDefinition"
    )
      return false;
    // Never reuse a focused card for a newly inserted neighboring definition.
    const range = this.draft && this.owner.binding.absolute(this.draft.range);
    if (!this.committing && range && this.sourceNode()?.from !== range.anchor)
      return false;
    this.render();
    return true;
  }
  stopEvent() {
    return true;
  }
  ignoreMutation() {
    return true;
  }
  destroy() {
    this.destroyed = true;
    this.recover();
    this.menu?.();
    this.presentation.destroy();
  }
}
