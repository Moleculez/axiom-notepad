/** Derived, bounded previews only. Mermaid's global configuration/rendering is
 * serialized, and stale asynchronous results can never replace newer source. */
let queue: Promise<unknown> = Promise.resolve();
export class DiagramPreviews {
  private jobs = new Map<
    HTMLElement,
    { key: string; timer?: ReturnType<typeof setTimeout>; good: string }
  >();
  private destroyed = false;
  render(root: HTMLElement) {
    for (const [element, job] of this.jobs)
      if (!root.contains(element)) {
        clearTimeout(job.timer);
        this.jobs.delete(element);
      }
    const style = getComputedStyle(root);
    const colors = ["--paper", "--text", "--accent", "--line", "--font-ui"].map(
      (name) => style.getPropertyValue(name).trim(),
    );
    for (const element of root.querySelectorAll<HTMLElement>(
      "[data-mermaid]",
    )) {
      const source = element.dataset.mermaid ?? "";
      const key = JSON.stringify([source, colors]);
      const previous = this.jobs.get(element);
      if (previous?.key === key) continue;
      clearTimeout(previous?.timer);
      const job = {
        key,
        good: previous?.good ?? "",
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      this.jobs.set(element, job);
      element.setAttribute("aria-busy", "true");
      job.timer = setTimeout(() => {
        queue = queue
          .catch(() => {})
          .then(async () => {
            const current = () =>
              !this.destroyed &&
              element.isConnected &&
              this.jobs.get(element) === job;
            if (!current()) return;
            try {
              if (
                /(?:<\s*(?:img|image|iframe|script|object|foreignObject)\b|@\{[^}]*\bimg\s*:|!\[[^\]]*\]\s*\(|\burl\s*\()/i.test(
                  source,
                )
              )
                throw new Error("External diagram resources are disabled.");
              if (source.length > 30000)
                throw new Error(
                  "Diagram exceeds the 30,000-character preview limit.",
                );
              const { default: mermaid } = await import("mermaid");
              if (!current()) return;
              mermaid.initialize({
                startOnLoad: false,
                securityLevel: "strict",
                maxTextSize: 30000,
                suppressErrorRendering: true,
                secure: [
                  "secure",
                  "securityLevel",
                  "startOnLoad",
                  "maxTextSize",
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
              if (!current()) return;
              job.good = result.svg;
              element.innerHTML = result.svg;
              element.dataset.previewState = "ready";
            } catch {
              if (!current()) return;
              element.innerHTML = job.good;
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
            } finally {
              if (current()) element.setAttribute("aria-busy", "false");
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
