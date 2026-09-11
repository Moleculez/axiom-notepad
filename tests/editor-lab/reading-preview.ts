import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { parseMarkdown } from "../../packages/markdown/src";
import ReadingView from "../../apps/web/components/ReadingView";

// Browser-only fixture for the real React reading component. No account,
// provider, persistence, attachment requests or application routes are involved.
const readers: Root[] = [];
const context = { disableImages: true };
let host: HTMLDivElement | null = null;
const update = (index: number, source: string, active = true) => {
  flushSync(() =>
    readers[index].render(
      createElement(ReadingView, {
        parsed: parseMarkdown(source),
        context,
        onLink: () => {},
        active,
      }),
    ),
  );
};
const destroy = () => {
  readers.splice(0).forEach((root) => root.unmount());
  host?.remove();
  host = null;
  document.querySelector<HTMLElement>("#editors")!.hidden = false;
};
const mount = (sources: string[]) => {
  destroy();
  document.querySelector<HTMLElement>("#editors")!.hidden = true;
  host = document.createElement("div");
  host.id = "footnote-readers";
  host.style.cssText =
    "display:grid;grid-template-columns:1fr 1fr;gap:32px;background:var(--paper);padding:32px";
  document.body.append(host);
  sources.forEach((source, index) => {
    const pane = document.createElement("div");
    pane.dataset.reader = String(index);
    host!.append(pane);
    readers.push(createRoot(pane));
    update(index, source);
  });
};
window.footnoteReadingLab = { mount, update, destroy };
declare global {
  interface Window {
    footnoteReadingLab: {
      mount: typeof mount;
      update: typeof update;
      destroy: typeof destroy;
    };
  }
}
