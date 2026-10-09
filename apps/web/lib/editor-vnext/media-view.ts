import { bindAttribute } from "@axiom/i18n/dom";
import { DOMSerializer, type Node } from "@milkdown/kit/prose/model";
import { attachmentVersion } from "@axiom/markdown";

/** Preview UI is outside contentDOM and never enters the Markdown transaction. */
export function mediaNodeView(initial: Node) {
  let node = initial;
  const rendered = DOMSerializer.renderSpec(
    document,
    node.type.spec.toDOM!(node),
  );
  const dom = rendered.dom as HTMLElement,
    contentDOM = rendered.contentDOM as HTMLElement;
  let preview: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;
  const paint = () => {
    observer?.disconnect();
    preview?.remove();
    preview = null;
    dom.className = `document-media media-${node.attrs.display}`;
    dom.style.setProperty("--media-width", `${node.attrs.width}%`);
    dom.style.setProperty("--media-align", node.attrs.align);
    if (node.attrs.label) dom.id = node.attrs.label;
    else dom.removeAttribute("id");
    if (node.attrs.number)
      dom.dataset.figureNumber = `Figure ${node.attrs.number}.`;
    else delete dom.dataset.figureNumber;
    dom.style.setProperty(
      "--figure-label",
      JSON.stringify(node.attrs.number ? `Figure ${node.attrs.number}. ` : ""),
    );
    if (node.attrs.display !== "preview" || !attachmentVersion(node.attrs.href))
      return;
    const mime = node.attrs.mime as string;
    if (!/^(?:audio\/|video\/|application\/pdf$)/.test(mime)) return;
    preview = document.createElement("div");
    preview.className = "document-inline-preview";
    preview.contentEditable = "false";
    dom.prepend(preview);
    const host = preview;
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer?.disconnect();
        const element = document.createElement(
          mime === "application/pdf"
            ? "iframe"
            : mime.startsWith("audio/")
              ? "audio"
              : "video",
        );
        element.src = node.attrs.href;
        if (element instanceof HTMLIFrameElement) {
          bindAttribute(element, "title", "PDF attachment preview");
          element.loading = "lazy";
        } else {
          element.controls = true;
          element.preload = "metadata";
        }
        host.replaceChildren(element);
      },
      { rootMargin: "100px" },
    );
    observer.observe(preview);
  };
  paint();
  return {
    dom,
    contentDOM,
    update(next: Node) {
      if (next.type !== node.type) return false;
      const changed = JSON.stringify(next.attrs) !== JSON.stringify(node.attrs);
      node = next;
      if (changed) paint();
      return true;
    },
    stopEvent(event: Event) {
      return !!preview?.contains(event.target as globalThis.Node);
    },
    ignoreMutation(mutation: { target: globalThis.Node; type?: string }) {
      return (
        (mutation.target === dom && mutation.type === "attributes") ||
        !!preview?.contains(mutation.target)
      );
    },
    destroy() {
      observer?.disconnect();
    },
  };
}
