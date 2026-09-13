import type { ProjectedBlock } from "@axiom/editor/projection";
import { canFold, foldDescription } from "@axiom/editor/folding";
import type { EditorView } from "@milkdown/kit/prose/view";
import { actionIcon } from "../icons/actions";

/** One out-of-flow layer, outside ProseMirror's editable DOM. Layout reads are
 * batched before writes; resized math/images/fonts update the same gutter. */
export class FoldingGutter {
  readonly dom = document.createElement("div");
  private buttons = new Map<
    string,
    { button: HTMLButtonElement; block: ProjectedBlock }
  >();
  private frame = 0;
  private observer = new ResizeObserver(() => this.schedule());
  private view: EditorView | null = null;
  constructor(
    private host: HTMLElement,
    private toggle: (block: ProjectedBlock) => void,
  ) {
    this.dom.className = "axiom-folding-gutter";
    this.dom.contentEditable = "false";
    this.dom.setAttribute("role", "group");
    this.dom.setAttribute("aria-label", "Block folding");
  }
  update(view: EditorView, source: string, blocks: ProjectedBlock[]) {
    if (this.view !== view) {
      this.observer.disconnect();
      this.view = view;
      this.observer.observe(view.dom);
    }
    if (!this.dom.isConnected) this.host.append(this.dom);
    const keep = new Set<string>();
    const ordered: HTMLButtonElement[] = [];
    for (const block of [...blocks].sort((a, b) => a.from - b.from)) {
      if (!canFold(source, block.node)) continue;
      const key = `${block.node.type}:${block.node.from}`;
      keep.add(key);
      let item = this.buttons.get(key);
      if (!item) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "axiom-fold-toggle";
        button.dataset.editorFold = "true";
        button.append(actionIcon("chevronRight"));
        item = { button, block };
        const current = item;
        button.addEventListener("click", () => this.toggle(current.block));
        button.addEventListener("keydown", (event) => {
          if (
            (event.key === "ArrowRight" && current.block.folded) ||
            (event.key === "ArrowLeft" && !current.block.folded)
          ) {
            event.preventDefault();
            this.toggle(current.block);
          }
        });
        this.buttons.set(key, item);
        this.dom.append(button);
      }
      item.block = block;
      ordered.push(item.button);
      const { label, summary } = foldDescription(source, block.node);
      const description = `${block.folded ? "Expand" : "Collapse"} ${label.toLowerCase()}${summary ? ": " + summary.slice(0, 45) : ""}`;
      item.button.setAttribute("aria-label", description);
      item.button.setAttribute("aria-expanded", String(!block.folded));
      item.button.title = description;
    }
    for (const [key, item] of this.buttons)
      if (!keep.has(key)) {
        item.button.remove();
        this.buttons.delete(key);
      }
    // Reopening a parent restores controls in reading/keyboard order without
    // unnecessarily detaching the currently focused control.
    let next = this.dom.firstChild;
    for (const button of ordered) {
      if (button === next) next = next.nextSibling;
      else this.dom.insertBefore(button, next);
    }
    this.schedule();
  }
  focus(block: ProjectedBlock) {
    this.buttons
      .get(`${block.node.type}:${block.node.from}`)
      ?.button.focus({ preventScroll: true });
  }
  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.layout();
    });
  }
  private layout() {
    if (!this.view || !this.dom.isConnected) return;
    const origin = this.host.getBoundingClientRect();
    const size = parseFloat(getComputedStyle(this.view.dom).fontSize);
    const gap = Math.min(24, Math.max(12, size * 0.85));
    const layout = [...this.buttons.values()].map((item) => {
      const element = this.view!.nodeDOM(item.block.from);
      if (!(element instanceof HTMLElement))
        return { ...item, hidden: true, x: 0, y: 0 };
      const box = element.getBoundingClientRect();
      const line =
        parseFloat(getComputedStyle(element).lineHeight) || size * 1.6;
      return {
        ...item,
        hidden: !box.height,
        x: box.x - origin.x - gap + 0.5,
        y: box.y - origin.y + Math.min(line, 40) / 2,
      };
    });
    for (const { button, hidden, x, y } of layout) {
      button.hidden = hidden;
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
    }
  }
  clear() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.observer.disconnect();
    this.view = null;
    this.buttons.clear();
    this.dom.replaceChildren();
    this.dom.remove();
  }
}
