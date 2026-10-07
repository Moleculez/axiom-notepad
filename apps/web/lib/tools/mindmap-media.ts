import { parseMarkdown, type MarkdownNode } from "@axiom/markdown";

type MathPreview = { request: string; from?: number };
const sources = new WeakMap<HTMLElement, string>();

/** Match occurrence identities first, then delimiter-preserved source ranges.
 * Index-only matching can flash a neighbouring equation after insertion/deletion.
 */
export function matchMindmapMathPreviews(
  previous: readonly MathPreview[],
  next: readonly MathPreview[],
  previousSource?: string,
  nextSource?: string,
) {
  const matches: (number | undefined)[] = Array(next.length).fill(undefined),
    used = new Set<number>(),
    exact = new Map<string, number[]>();
  previous.forEach((value, i) => {
    const occurrences = exact.get(value.request) ?? [];
    occurrences.push(i);
    exact.set(value.request, occurrences);
  });
  next.forEach((value, i) => {
    const old = exact.get(value.request)?.shift();
    if (old !== undefined) {
      matches[i] = old;
      used.add(old);
    }
  });
  if (
    !previous.length ||
    !next.length ||
    matches.every((match) => match !== undefined) ||
    previousSource === undefined ||
    nextSource === undefined
  )
    return matches;
  let start = 0,
    oldEnd = previousSource.length,
    newEnd = nextSource.length;
  while (
    start < oldEnd &&
    start < newEnd &&
    previousSource[start] === nextSource[start]
  )
    start++;
  while (
    oldEnd > start &&
    newEnd > start &&
    previousSource[oldEnd - 1] === nextSource[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  const delta = nextSource.length - previousSource.length;
  const ranges = (source: string) => {
    const found = new Map<number, MarkdownNode>();
    const visit = (node: MarkdownNode) => {
      if (node.type === "mathBlock" || node.type === "mathInline")
        found.set(node.from, node);
      node.children?.forEach(visit);
    };
    visit(parseMarkdown(source).ast);
    return found;
  };
  const oldRanges = ranges(previousSource),
    newRanges = ranges(nextSource);
  next.forEach((value, i) => {
    if (matches[i] !== undefined || value.from === undefined) return;
    const target = newRanges.get(value.from);
    if (!target) return;
    const old = previous.findIndex((candidate, j) => {
      if (used.has(j) || candidate.from === undefined) return false;
      const range = oldRanges.get(candidate.from);
      if (!range) return false;
      let from = range.from,
        to = range.to;
      if (to <= start) {
        // Entire expression precedes the edit.
      } else if (from >= oldEnd) {
        from += delta;
        to += delta;
      } else if (
        start >= (range.contentFrom ?? range.from) &&
        oldEnd <= (range.contentTo ?? range.to)
      ) {
        // Only expression content changed. Both source delimiters survive.
        to += delta;
      } else return false;
      return from === target.from && to === target.to;
    });
    if (old >= 0) {
      matches[i] = old;
      used.add(old);
    }
  });
  return matches;
}

/** The map is not another editor: retain rendered nodes without touching source. */
export function reconcileMindmapHtml(
  root: HTMLElement,
  html: string,
  markdown?: string,
) {
  const next = document.createElement("div");
  next.innerHTML = html;
  const previousMath = [
      ...root.querySelectorAll<HTMLElement>("[data-math-request]"),
    ],
    nextMath = [...next.querySelectorAll<HTMLElement>("[data-math-request]")],
    identity = (element: HTMLElement): MathPreview => {
      const from =
        element.closest<HTMLElement>("[data-math-from]")?.dataset.mathFrom;
      return {
        request: element.dataset.mathRequest ?? "",
        from: from === undefined ? undefined : Number(from),
      };
    },
    matches = matchMindmapMathPreviews(
      previousMath.map(identity),
      nextMath.map(identity),
      sources.get(root),
      markdown,
    );
  nextMath.forEach((node, i) => {
    const index = matches[i],
      old = index === undefined ? undefined : previousMath[index];
    if (
      !old ||
      (old.dataset.mathState !== "ready" && !old.dataset.previousPreview)
    )
      return;
    node.innerHTML = old.innerHTML;
    if (
      old.dataset.mathRequest === node.dataset.mathRequest &&
      old.dataset.mathState === "ready"
    ) {
      node.dataset.mathState = "ready";
      node.setAttribute("aria-busy", "false");
    } else {
      node.dataset.mathState = "pending";
      node.dataset.previousPreview = "true";
      node.setAttribute("aria-busy", "true");
    }
  });
  // Retain actual diagram elements, including their renderer's last-good snapshot
  // and in-flight job identity. Copying innerHTML would lose both on each edit.
  const diagrams = [...root.querySelectorAll<HTMLElement>("[data-mermaid]")];
  next.querySelectorAll<HTMLElement>("[data-mermaid]").forEach((node, i) => {
    const old = diagrams[i];
    if (!old) return;
    old.dataset.mermaid = node.dataset.mermaid;
    old.dataset.visualFrom = node.dataset.visualFrom;
    old.dataset.visualTo = node.dataset.visualTo;
    node.replaceWith(old);
  });
  const images = new Map<string, HTMLImageElement[]>();
  for (const img of root.querySelectorAll("img")) {
    const key = img.getAttribute("src") ?? "",
      matches = images.get(key) ?? [];
    matches.push(img);
    images.set(key, matches);
  }
  for (const img of next.querySelectorAll("img")) {
    const old = images.get(img.getAttribute("src") ?? "")?.shift();
    if (!old) continue;
    old.alt = img.alt;
    old.title = img.title;
    const frame = old.closest<HTMLElement>(".mindmap-image-frame");
    if (frame)
      imageState(
        old,
        frame.dataset.imageState === "ready"
          ? "ready"
          : frame.dataset.imageState === "error"
            ? "error"
            : "loading",
      );
    img.replaceWith(old.closest(".mindmap-image-frame") ?? old);
  }
  root.replaceChildren(...next.childNodes);
  prepareMindmapImages(root);
  if (markdown === undefined) sources.delete(root);
  else sources.set(root, markdown);
}

function imageState(
  img: HTMLImageElement,
  state: "loading" | "ready" | "error",
) {
  const frame = img.closest<HTMLElement>(".mindmap-image-frame");
  if (!frame) return;
  frame.dataset.imageState = state;
  frame.setAttribute("aria-busy", String(state === "loading"));
  img.hidden = state === "error";
  const status = frame.querySelector<HTMLElement>(".mindmap-image-status")!;
  status.hidden = state === "ready";
  status.textContent =
    state === "error"
      ? `Image unavailable${img.alt ? " · " + img.alt : ""}`
      : "Loading image…";
  frame.querySelector<HTMLButtonElement>("[data-mindmap-image-retry]")!.hidden =
    state !== "error";
  if (state !== "loading")
    frame.dispatchEvent(new Event("axiom:image-rendered", { bubbles: true }));
}

export function prepareMindmapImages(root: HTMLElement) {
  for (const img of root.querySelectorAll("img")) {
    if (img.closest(".mindmap-image-frame")) continue;
    const frame = document.createElement("span"),
      status = document.createElement("span"),
      retry = document.createElement("button");
    frame.className = "mindmap-image-frame";
    status.className = "mindmap-image-status";
    status.role = "status";
    retry.className = "button compact mindmap-image-retry";
    retry.type = "button";
    retry.dataset.mindmapImageRetry = "true";
    retry.textContent = "Retry";
    retry.setAttribute("aria-label", "Retry image loading");
    img.draggable = false;
    img.decoding = "async";
    // The surface already culls off-screen nodes. Browser lazy heuristics are
    // unreliable inside its transformed camera and can strand a visible image.
    img.loading = "eager";
    img.replaceWith(frame);
    frame.append(img, status, retry);
    imageState(
      img,
      img.complete ? (img.naturalWidth > 0 ? "ready" : "error") : "loading",
    );
  }
  for (const unavailable of root.querySelectorAll<HTMLElement>(
    ".image-unavailable",
  ))
    if (!unavailable.dataset.mindmapUnavailable) {
      unavailable.dataset.mindmapUnavailable = "true";
      unavailable.textContent = `Image unavailable · ${unavailable.textContent}`;
    }
}

/** Capture non-bubbling image events, with one cancellable owner per label. */
export function installMindmapImages(root: HTMLElement) {
  const controller = new AbortController();
  const loaded = (event: Event) => {
    if (event.target instanceof HTMLImageElement)
      imageState(
        event.target,
        event.type === "load" && event.target.naturalWidth > 0
          ? "ready"
          : "error",
      );
  };
  root.addEventListener("load", loaded, {
    capture: true,
    signal: controller.signal,
  });
  root.addEventListener("error", loaded, {
    capture: true,
    signal: controller.signal,
  });
  root.addEventListener(
    "click",
    (event) => {
      const retry = (event.target as Element).closest(
          "[data-mindmap-image-retry]",
        ),
        img = retry?.closest(".mindmap-image-frame")?.querySelector("img");
      if (!img) return;
      event.preventDefault();
      event.stopPropagation();
      imageState(img, "loading");
      const src = img.getAttribute("src")!;
      img.removeAttribute("src");
      img.setAttribute("src", src);
    },
    { signal: controller.signal },
  );
  return () => controller.abort();
}
