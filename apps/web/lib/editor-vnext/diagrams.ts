/** All surfaces share Mermaid's global renderer; configuration and renders must
 * never interleave. Viewer transforms reuse SVG, not another render loop. */
let queue: Promise<unknown> = Promise.resolve();
export type DiagramSnapshot = { svg: string; source: string; type: string };
const snapshots = new WeakMap<HTMLElement, DiagramSnapshot>();
export const diagramSnapshot = (element: HTMLElement) => snapshots.get(element);
export function diagramColors(root: HTMLElement) {
  const style = getComputedStyle(root);
  return ["--paper", "--text", "--accent", "--line", "--font-ui"].map((n) =>
    style.getPropertyValue(n).trim(),
  );
}
export function renderDiagram(
  source: string,
  colors: string[],
): Promise<DiagramSnapshot> {
  const task = queue
    .catch(() => {})
    .then(async () => {
      if (source.length > 30000)
        throw new Error("Diagram exceeds the 30,000-character preview limit.");
      if (
        /(?:<\s*(?:img|image|iframe|script|object|foreignObject)\b|@\{[^}]*\bimg\s*:|!\[[^\]]*\]\s*\(|\burl\s*\()/i.test(
          source,
        )
      )
        throw new Error("External diagram resources are disabled.");
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        maxTextSize: 30000,
        maxEdges: 2000,
        suppressErrorRendering: true,
        secure: [
          "secure",
          "securityLevel",
          "startOnLoad",
          "maxTextSize",
          "maxEdges",
          "suppressErrorRendering",
          "theme",
          "themeCSS",
          "themeVariables",
          "flowchart",
          "fontFamily",
        ],
        flowchart: { htmlLabels: false },
        theme: "base",
        themeVariables: {
          background: colors[0],
          primaryColor: colors[0],
          primaryTextColor: colors[1],
          primaryBorderColor: colors[3],
          lineColor: colors[2],
          textColor: colors[1],
          fontFamily: colors[4],
        },
      });
      const result = await mermaid.render(
        "axiom-diagram-" + crypto.randomUUID(),
        source,
      );
      return { svg: result.svg, source, type: result.diagramType };
    });
  queue = task;
  return task;
}
export class DiagramPreviews {
  private jobs = new Map<
    HTMLElement,
    {
      key: string;
      timer?: ReturnType<typeof setTimeout>;
      good?: DiagramSnapshot;
    }
  >();
  private destroyed = false;
  render(root: HTMLElement) {
    for (const [element, job] of this.jobs)
      if (!root.contains(element)) {
        clearTimeout(job.timer);
        this.jobs.delete(element);
      }
    const colors = diagramColors(root);
    for (const element of root.querySelectorAll<HTMLElement>(
      "[data-mermaid]",
    )) {
      const source = element.dataset.mermaid ?? "",
        key = JSON.stringify([source, colors]),
        previous = this.jobs.get(element);
      if (previous?.key === key) continue;
      clearTimeout(previous?.timer);
      const job = {
        key,
        good: previous?.good,
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      this.jobs.set(element, job);
      element.setAttribute("aria-busy", "true");
      job.timer = setTimeout(() => {
        const current = () =>
          !this.destroyed &&
          element.isConnected &&
          this.jobs.get(element) === job;
        if (!current()) return;
        void renderDiagram(source, colors)
          .then((result) => {
            if (!current()) return;
            job.good = result;
            snapshots.set(element, result);
            element.innerHTML = result.svg;
            element.dataset.previewState = "ready";
          })
          .catch(() => {
            if (!current()) return;
            element.innerHTML = job.good?.svg ?? "";
            const message = document.createElement("p");
            message.className = "axiom-preview-message";
            message.role = "status";
            message.textContent =
              source.length > 30000
                ? "Diagram is too large to preview. Its source remains editable."
                : (job.good ? "Last valid preview · " : "") +
                  "Check the diagram syntax. Its source remains editable.";
            element.append(message);
            element.dataset.previewState = job.good ? "stale" : "error";
          })
          .finally(() => {
            if (current()) {
              element.setAttribute("aria-busy", "false");
              element.dispatchEvent(
                new Event("axiom:diagram-rendered", { bubbles: true }),
              );
            }
          });
      }, 160);
    }
  }
  destroy() {
    this.destroyed = true;
    for (const job of this.jobs.values()) clearTimeout(job.timer);
    this.jobs.clear();
  }
}
