import { safeUrl, plainText, type MarkdownNode } from "@axiom/markdown";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { NodeView } from "@milkdown/kit/prose/view";

export type ImageCacheEntry = {
  image: HTMLImageElement;
  state: "ready" | "loading" | "error";
};

/** Source-backed image presentation, reusable as either an atom or a decoration. */
export class ImageView implements NodeView {
  readonly dom = document.createElement("span");
  private status = document.createElement("span");
  private retry = document.createElement("button");
  private img: HTMLImageElement | null = null;
  private pending: HTMLImageElement | null = null;
  private failed: HTMLImageElement | null = null;
  private url: string | null = null;
  private requested = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private events = new AbortController();
  constructor(
    private options: {
      source: () => MarkdownNode | undefined;
      disabled: () => boolean;
      readOnly: () => boolean;
      active: () => boolean;
      stale: () => boolean;
      select: (node: MarkdownNode, dom: HTMLElement) => void;
      openSource: (node: MarkdownNode) => void;
      defer: () => boolean;
      reuse: (url: string) => ImageCacheEntry | undefined;
      release: (entry: ImageCacheEntry) => void;
    },
  ) {
    this.dom.className = "axiom-inline-preview axiom-image";
    this.dom.dataset.kind = "image";
    this.dom.dataset.visualKind = "image";
    this.dom.contentEditable = "false";
    this.dom.tabIndex = 0;
    this.status.className = "axiom-image-status";
    this.status.setAttribute("aria-live", "polite");
    this.retry.type = "button";
    this.retry.className = "axiom-image-retry";
    this.retry.textContent = "Retry";
    this.retry.setAttribute("aria-label", "Retry image loading");
    this.retry.dataset.editorChrome = "true";
    this.retry.addEventListener("click", () => {
      this.url = null;
      this.refresh();
    });
    this.dom.append(this.status, this.retry);
    this.dom.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
      if ((event.target as Element).closest("[data-visual-open]")) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.target === this.retry) return;
      const node = this.options.source();
      if (node) {
        if (this.options.readOnly()) this.options.select(node, this.dom);
        else this.options.openSource(node);
      }
    });
    this.dom.addEventListener("focus", () => {
      const node = this.options.source();
      if (node) this.options.select(node, this.dom);
    });
    this.dom.addEventListener("keydown", (event) => {
      if (event.target === this.retry || event.isComposing) return;
      if (["Enter", " "].includes(event.key) && !this.options.readOnly()) {
        event.preventDefault();
        event.stopPropagation();
        const node = this.options.source();
        if (node) this.options.openSource(node);
      } else if (event.key === "Backspace" || event.key === "Delete") {
        // Read-only atom focus must not turn Backspace into browser navigation.
        event.preventDefault();
        event.stopPropagation();
      }
    });
    this.refresh();
  }
  private cancel() {
    clearTimeout(this.timer);
    this.events.abort();
    this.events = new AbortController();
    this.pending?.remove();
    this.pending = null;
    this.requested = false;
  }
  private load(url: string) {
    this.requested = true;
    const start = () => {
      if (this.destroyed || this.url !== url) return;
      const cached = this.options.reuse(url);
      const img = cached?.image ?? document.createElement("img");
      this.pending = img;
      img.draggable = false;
      img.decoding = "async";
      const finish = (ready: boolean) => {
        if (this.destroyed || this.pending !== img || this.url !== url) return;
        this.pending = null;
        if (ready) {
          this.failed = null;
          this.img?.remove();
          this.img = img;
          img.hidden = false;
          this.dom.prepend(img);
        } else this.failed = img;
        this.dom.dataset.imageState = ready ? "ready" : "error";
        this.refresh();
      };
      if (cached?.state === "ready") finish(true);
      else if (cached?.state === "error") finish(false);
      else {
        img.addEventListener("load", () => finish(img.naturalWidth > 0), {
          signal: this.events.signal,
        });
        img.addEventListener("error", () => finish(false), {
          signal: this.events.signal,
        });
        if (!cached) img.src = url;
        else if (img.complete) finish(img.naturalWidth > 0);
      }
    };
    // Only network previews are debounced. Source typing is always immediate.
    if (this.options.active() && this.img) this.timer = setTimeout(start, 160);
    else start();
  }
  refresh = () => {
    const node = this.options.source();
    if (!node || this.destroyed) return;
    const alt = plainText(node) || "Image";
    this.dom.dataset.visualFrom = String(node.from);
    this.dom.dataset.visualTo = String(node.to);
    const disabled = this.options.disabled();
    const url = disabled ? "" : safeUrl(node.href ?? "", true);
    if (url !== this.url) {
      this.cancel();
      this.failed = null;
      this.url = url;
      if (!url || !this.options.active()) {
        this.img?.remove();
        this.img = null;
      }
      this.dom.dataset.imageState = url
        ? "loading"
        : disabled
          ? "disabled"
          : "blocked";
    }
    // Disabled and blocked both have an empty URL, but distinct presentation.
    if (!url) this.dom.dataset.imageState = disabled ? "disabled" : "blocked";
    if (url && !this.requested && !this.options.defer()) this.load(url);
    if (this.img && this.img.getAttribute("src") === url) {
      this.img.alt = plainText(node);
      this.img.title = node.title ?? "";
    }
    const state = this.dom.dataset.imageState;
    const stale = this.options.stale();
    const previous = !!this.img && (state !== "ready" || stale);
    this.dom.dataset.imagePrevious = String(previous);
    this.dom.setAttribute("aria-busy", String(state === "loading"));
    this.retry.hidden = state !== "error";
    this.status.hidden = state === "ready" && !stale;
    this.status.textContent = this.status.hidden
      ? ""
      : (previous ? "Last valid preview · " : "") +
        (stale
          ? "Image Markdown is incomplete"
          : state === "loading"
            ? "Loading image"
            : state === "disabled"
              ? "Image preview disabled"
              : state === "blocked"
                ? "Image address blocked"
                : "Image unavailable") +
        " · " +
        alt;
  };
  update(node: ProseNode) {
    if (node.type.name !== "inline_preview" || node.attrs.kind !== "image")
      return false;
    this.refresh();
    return true;
  }
  selectNode() {
    this.dom.classList.add("is-selected");
  }
  deselectNode() {
    this.dom.classList.remove("is-selected");
  }
  stopEvent(event: Event) {
    return event.type !== "contextmenu";
  }
  ignoreMutation() {
    return true;
  }
  destroy() {
    this.destroyed = true;
    const image = this.pending ?? this.failed ?? this.img;
    const state = this.pending ? "loading" : this.failed ? "error" : "ready";
    this.cancel();
    if (image) this.options.release({ image, state });
  }
}
