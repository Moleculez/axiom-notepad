/** Presentation only. Each node view retains its own source model, draft and
 * transaction rules; a field is never swapped for a second display-only node. */
export class PropertyTable {
  readonly dom = document.createElement("section");
  readonly table = document.createElement("table");
  readonly caption = document.createElement("caption");
  readonly heading = document.createElement("span");
  readonly detail = document.createElement("span");
  readonly actions = document.createElement("span");
  private status = document.createElement("span");
  private frame = 0;
  private width = 0;
  private observer: ResizeObserver;
  private measured = new WeakMap<HTMLTextAreaElement, string>();
  constructor(label: string, className: string, kind: string) {
    this.dom.className = `editor-properties ${className}`;
    this.dom.dataset.kind = kind;
    this.dom.contentEditable = "false";
    this.dom.setAttribute("role", "group");
    this.dom.setAttribute("aria-label", label);
    this.table.className = "editor-properties-table";
    this.table.setAttribute("aria-label", label);
    this.caption.className = "editor-properties-caption";
    const bar = document.createElement("span");
    bar.className = "editor-properties-bar";
    this.heading.className = "editor-properties-title";
    this.heading.textContent = label;
    this.detail.className = "editor-properties-detail";
    this.actions.className = "editor-properties-actions";
    bar.append(this.heading, this.detail, this.actions);
    this.caption.append(bar);
    this.table.append(this.caption, document.createElement("tbody"));
    this.status.id = "editor-property-status-" + crypto.randomUUID();
    this.status.className = "editor-property-status sr-only";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.dom.append(this.table, this.status);
    this.observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== this.width) {
        this.width = entry.contentRect.width;
        this.layout();
      }
    });
    this.observer.observe(this.dom);
  }
  row(key: string | Node, value: Node) {
    const row = document.createElement("tr"),
      name = document.createElement("th"),
      cell = document.createElement("td");
    name.scope = "row";
    name.append(key);
    cell.append(value);
    row.append(name, cell);
    return row;
  }
  field<T extends HTMLInputElement | HTMLTextAreaElement>(input: T): T {
    input.classList.add("editor-property-input");
    input.dataset.editorField = "cell";
    input.setAttribute("aria-describedby", this.status.id);
    input.setAttribute(
      "aria-description",
      "Enter to save. Escape to cancel this field.",
    );
    input.addEventListener("input", () => this.layout());
    return input;
  }
  body(body: HTMLTableSectionElement) {
    // A visible error belongs to its old row, not the next unrelated property.
    this.message("");
    this.table.tBodies[0].replaceWith(body);
    this.layout();
  }
  message(text: string, visible = false, field?: HTMLElement) {
    const parent = (visible && field?.closest("td, th")) || this.dom;
    if (this.status.parentElement !== parent) parent.append(this.status);
    this.status.classList.toggle("sr-only", !visible);
    this.status.dataset.error = String(visible);
    if (this.status.textContent !== text) this.status.textContent = text;
  }
  readOnly(value: boolean) {
    this.dom.dataset.readonly = String(value);
  }
  /** CSS field-sizing where supported; this bounded fallback also handles
   * imported multiline titles and narrow desktop panes in other browsers. */
  layout() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.dom.isConnected) return;
      this.table.querySelectorAll("textarea").forEach((input) => {
        const style = getComputedStyle(input);
        const key = [
          input.value,
          input.clientWidth,
          style.font,
          style.lineHeight,
        ].join("|");
        if (this.measured.get(input) === key) return;
        this.measured.set(input, key);
        input.style.height = "auto";
        const maximum = parseFloat(style.maxHeight) || 240;
        input.style.height =
          Math.min(
            maximum,
            Math.max(parseFloat(style.minHeight) || 0, input.scrollHeight),
          ) + "px";
      });
    });
  }
  destroy() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
  }
}
