import { metadataModel, type MetadataProperty } from "@axiom/markdown";
import { mapPosition } from "@axiom/editor/transactions";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { NodeView } from "@milkdown/kit/prose/view";
import type { AxiomEditorView } from "./view";
import { iconButton } from "./chrome";
import { openContextMenu } from "../context-menu";

/** A property table, not another source editor. Field commits are rebased and
 * checked against the source they began with before entering shared history. */
export class MetadataView implements NodeView {
  readonly dom = document.createElement("section");
  private table = document.createElement("table");
  private last = "";
  private menu: (() => void) | null = null;
  private committing = false;
  private recoverDraft: (() => void) | undefined;
  constructor(
    private owner: AxiomEditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom.className = "axiom-metadata";
    this.dom.dataset.kind = "frontmatter";
    this.dom.contentEditable = "false";
    const title = document.createElement("div");
    title.className = "axiom-metadata-heading";
    title.textContent = "Document metadata";
    this.table.setAttribute("aria-label", "Document metadata");
    const add = iconButton("Add metadata property", "plus", () => this.add());
    add.classList.add("axiom-metadata-add");
    this.dom.append(title, this.table, add);
    this.dom.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const row = (event.target as Element).closest<HTMLTableRowElement>(
        "tr[data-property]",
      );
      const node = this.sourceNode();
      const model = node && metadataModel(owner.source, node);
      const property = model?.properties[Number(row?.dataset.property ?? -1)];
      const bookmark =
        property &&
        owner.binding.relative({ anchor: property.from, head: property.to });
      const original =
        property && owner.source.slice(property.from, property.to);
      this.menu?.();
      this.menu = openContextMenu({
        x: event.clientX,
        y: event.clientY,
        owner: this.dom,
        label: "Metadata actions",
        items: [
          {
            label: "Add property",
            icon: "plus",
            disabled: owner.structureLocked,
            action: () => this.add(),
          },
          ...(property
            ? [
                {
                  label: "Copy value",
                  icon: "copy" as const,
                  action: () => {
                    void navigator.clipboard
                      .writeText(property.value)
                      .catch(() =>
                        owner.options.message("Clipboard access was denied."),
                      );
                  },
                },
                {
                  label: "Delete property",
                  icon: "trash" as const,
                  tone: "danger" as const,
                  disabled: owner.structureLocked,
                  action: () => {
                    const range = bookmark && owner.binding.absolute(bookmark);
                    if (
                      !range ||
                      owner.source.slice(range.anchor, range.head) !== original
                    ) {
                      owner.options.message(
                        "This property changed remotely. Select it again.",
                      );
                      return;
                    }
                    owner.edit(
                      {
                        changes: [
                          { from: range.anchor, to: range.head, insert: "" },
                        ],
                        selection: { anchor: range.anchor },
                      },
                      "command",
                    );
                  },
                },
              ]
            : []),
          {
            label: "Continue after metadata",
            icon: "paragraph",
            group: "Navigation",
            action: () => this.exit(),
          },
        ],
      });
    });
    this.render();
  }
  private sourceNode() {
    return this.owner.embeddedNode(this.getPos());
  }
  focus(at: number) {
    const node = this.sourceNode(),
      model = node && metadataModel(this.owner.source, node);
    if (!node || !model || at < node.from || at >= node.to) return false;
    const index = Math.max(
      0,
      model.properties.findIndex(
        (property) => at >= property.keyFrom && at <= property.to,
      ),
    );
    const property = model.properties[index];
    const field =
      property && at >= property.keyFrom && at <= property.keyTo
        ? "key"
        : "value";
    const input =
      this.table.querySelector<HTMLInputElement>(
        `tr[data-property="${index}"] input[data-field="${field}"]`,
      ) ?? this.table.querySelector<HTMLInputElement>("input");
    if (!input) return false;
    input.focus();
    const start =
      property && field === "key"
        ? property.keyFrom
        : (property?.valueFrom ?? at);
    const offset = Math.max(0, Math.min(input.value.length, at - start));
    input.setSelectionRange(offset, offset);
    return true;
  }
  private exit() {
    const node = this.sourceNode();
    if (!node) return;
    if (this.dom.contains(document.activeElement))
      (document.activeElement as HTMLElement).blur();
    this.owner.setSelection({ anchor: node.from, head: node.from });
    this.owner.execute("finishBlock");
  }
  private add() {
    if (this.owner.structureLocked) return;
    const node = this.sourceNode(),
      model = node && metadataModel(this.owner.source, node);
    if (!model) return;
    let key = "property",
      number = 1;
    while (model.properties.some((property) => property.key === key))
      key = `property${++number}`;
    this.owner.edit(
      {
        changes: [
          {
            from: model.closing,
            to: model.closing,
            insert: `${key}: ${model.ending}`,
          },
        ],
        selection: { anchor: model.closing + key.length + 2 },
      },
      "command",
      undefined,
      false,
    );
    this.render(true);
    const input = Array.from(
      this.table.querySelectorAll<HTMLInputElement>("input[data-field=value]"),
    ).at(-1);
    input?.focus();
  }
  private input(property: MetadataProperty, field: "key" | "value") {
    const input = document.createElement("input");
    input.value = property[field];
    input.dataset.field = field;
    input.setAttribute(
      "aria-label",
      field === "key"
        ? `Property name: ${property.key}`
        : `Value for ${property.key}`,
    );
    input.placeholder = field === "key" ? "Property" : "Empty";
    input.readOnly = this.owner.options.readOnly();
    let draft:
      | {
          range: ReturnType<AxiomEditorView["binding"]["relative"]>;
          original: string;
        }
      | undefined;
    input.addEventListener("focus", () => {
      const node = this.sourceNode(),
        model = node && metadataModel(this.owner.source, node);
      const current = model?.properties.find(
        (value) => value.key === property.key,
      );
      if (!current) {
        input.readOnly = true;
        this.owner.options.message(
          "This property changed remotely. Leave the table to refresh its fields.",
        );
        return;
      }
      const from = field === "key" ? current.keyFrom : current.valueFrom;
      const to = field === "key" ? current.keyTo : current.valueTo;
      draft = {
        range: this.owner.binding.relative({ anchor: from, head: to }),
        original: this.owner.source.slice(from, to),
      };
      const originalSource = this.owner.source;
      this.recoverDraft = () => {
        if (draft && input.value !== draft.original) {
          this.owner.options.recover(
            originalSource.slice(0, from) +
              input.value +
              originalSource.slice(to),
          );
          this.owner.options.message(
            "Your uncommitted metadata field was retained in recovery.",
          );
        }
      };
    });
    const commit = () => {
      if (
        this.committing ||
        !draft ||
        input.value === draft.original ||
        this.owner.structureLocked
      )
        return true;
      const node = this.sourceNode(),
        model = node && metadataModel(this.owner.source, node);
      if (
        field === "key" &&
        (!/^[\w.-]+$/.test(input.value) ||
          model?.properties.some(
            (value) => value.key === input.value && value.key !== property.key,
          ))
      ) {
        input.setCustomValidity(
          "Use a unique property name with letters, numbers, dots, underscores or hyphens.",
        );
        input.reportValidity();
        return false;
      }
      const range = this.owner.binding.absolute(draft.range);
      if (
        !range ||
        this.owner.source.slice(range.anchor, range.head) !== draft.original
      ) {
        this.recoverDraft?.();
        draft = undefined;
        this.recoverDraft = undefined;
        this.owner.options.message(
          "This property changed remotely. Your field draft was retained in recovery.",
        );
        return true;
      }
      const changes = [
        { from: range.anchor, to: range.head, insert: input.value },
      ];
      this.committing = true;
      try {
        this.owner.edit(
          {
            changes,
            selection: {
              anchor: mapPosition(this.owner.selection.head, changes),
            },
          },
          "command",
          undefined,
          false,
        );
      } finally {
        this.committing = false;
      }
      property[field] = input.value;
      input
        .closest("tr")
        ?.querySelectorAll<HTMLInputElement>("input")
        .forEach((control) => {
          control.setAttribute(
            "aria-label",
            control.dataset.field === "key"
              ? `Property name: ${property.key}`
              : `Value for ${property.key}`,
          );
        });
      draft = undefined;
      this.recoverDraft = undefined;
      return true;
    };
    input.addEventListener("input", () => input.setCustomValidity(""));
    input.addEventListener("blur", () => {
      if (!commit()) {
        queueMicrotask(() => input.isConnected && input.focus());
        return;
      }
      queueMicrotask(() => this.render());
    });
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === "Escape") {
        input.value = draft?.original ?? property[field];
        input.blur();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (!commit()) return;
        if (
          (field === "value" && !input.value.trim()) ||
          event.metaKey ||
          event.ctrlKey
        ) {
          this.exit();
          return;
        }
        const next = input
          .closest("tr")
          ?.nextElementSibling?.querySelector<HTMLInputElement>(
            'input[data-field="value"]',
          );
        if (next) next.focus();
        else this.add();
      }
    });
    return input;
  }
  render(force = false) {
    this.table.querySelectorAll("input").forEach((input) => {
      input.readOnly = this.owner.options.readOnly();
    });
    const node = this.sourceNode(),
      model = node && metadataModel(this.owner.source, node);
    if (!model || !node) return;
    const raw =
      this.owner.source.slice(node.from, node.to) +
      ":" +
      this.owner.options.readOnly();
    if (
      this.committing ||
      (!force && this.dom.contains(document.activeElement)) ||
      (!force && raw === this.last)
    )
      return;
    this.last = raw;
    const body = document.createElement("tbody");
    model.properties.forEach((property, index) => {
      const row = document.createElement("tr"),
        key = document.createElement("th"),
        value = document.createElement("td");
      row.dataset.property = String(index);
      key.scope = "row";
      key.append(this.input(property, "key"));
      if (property.complex) {
        const content = document.createElement("pre");
        content.textContent = property.value.replace(/^\r?\n/, "");
        content.title = "Structured YAML is preserved. Edit it in Source mode.";
        value.append(content);
      } else value.append(this.input(property, "value"));
      row.append(key, value);
      body.append(row);
    });
    this.table.replaceChildren(body);
    this.dom.querySelector<HTMLButtonElement>(".axiom-metadata-add")!.disabled =
      this.owner.options.readOnly();
  }
  update(node: ProseNode) {
    if (node.type.name !== "raw_block" || node.attrs.kind !== "frontmatter")
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
    if (!this.committing) this.recoverDraft?.();
    this.menu?.();
  }
}
