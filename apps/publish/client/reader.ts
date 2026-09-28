// Public-only browser entry. No workspace stores, credentials, editing APIs or
// private data are included in this bundle. Hosted analytics is explicitly configured.
import { initializeCanvas } from "./canvas";
import { initializeDiscovery } from "./discovery";
import { initializeAnalytics } from "./analytics";

const all = <T extends Element = HTMLElement>(selector: string) => [
  ...document.querySelectorAll<T>(selector),
];
const status = document.createElement("p");
status.className = "reader-status";
status.setAttribute("role", "status");
document.body.append(status);
let statusTimer: ReturnType<typeof setTimeout>;
function announce(text: string) {
  status.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.textContent = "";
  }, 4000);
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    announce("Copied to clipboard.");
  } catch {
    announce("Clipboard is unavailable. Select the text and copy it manually.");
  }
}
all("[data-copy-citation]").forEach((el) =>
  el.addEventListener("click", () => void copy(el.dataset.copyCitation ?? "")),
);
all("[data-print]").forEach((el) =>
  el.addEventListener("click", () => window.print()),
);
all("[data-copy-tex]").forEach((el) =>
  el.addEventListener(
    "click",
    () =>
      void copy(
        el.closest("details")?.querySelector("code")?.textContent ?? "",
      ),
  ),
);
all("[data-copy-svg]").forEach((el) =>
  el.addEventListener("click", () => {
    const svg = el.closest(".site-equation")?.querySelector("svg");
    if (!svg) return;
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "equation.svg";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }),
);
const root = document.documentElement;
const themeKey = `axiom-public-mode:${new URL("../", import.meta.url).pathname}`;
try {
  const saved = localStorage.getItem(themeKey);
  if (saved === "light" || saved === "dark") root.dataset.mode = saved;
} catch {}
all("[data-theme-toggle]").forEach((el) =>
  el.addEventListener("click", () => {
    const dark =
      root.dataset.mode === "dark" ||
      (root.dataset.mode === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.mode = dark ? "light" : "dark";
    try {
      localStorage.setItem(themeKey, root.dataset.mode);
    } catch {}
  }),
);

function viewImage(content: Element, title: string) {
  const previous = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "public-lightbox";
  dialog.setAttribute("aria-label", title);
  const shell = document.createElement("div"),
    toolbar = document.createElement("div"),
    stage = document.createElement("div");
  shell.className = "public-lightbox-shell";
  toolbar.className = "site-viewer-toolbar";
  stage.className = "public-lightbox-stage";
  const clone = content.cloneNode(true) as HTMLElement;
  clone.removeAttribute("tabindex");
  clone.removeAttribute("id");
  stage.append(clone);
  let zoom = 1;
  for (const [label, action] of [
    [
      "Zoom out",
      () => {
        zoom = Math.max(0.25, zoom / 1.25);
        clone.style.transform = `scale(${zoom})`;
      },
    ],
    [
      "Zoom in",
      () => {
        zoom = Math.min(8, zoom * 1.25);
        clone.style.transform = `scale(${zoom})`;
      },
    ],
    [
      "Fit",
      () => {
        zoom = 1;
        clone.style.transform = "";
      },
    ],
    [
      "Fullscreen",
      async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await shell.requestFullscreen();
        } catch {
          announce("Fullscreen is not available in this browser.");
        }
      },
    ],
    ["Close", () => dialog.close()],
  ] as const) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => {
      void action();
    };
    toolbar.append(b);
  }
  shell.append(toolbar, stage);
  dialog.append(shell);
  document.body.append(dialog);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      previous?.focus();
    },
    { once: true },
  );
  dialog.showModal();
}
function zoomable(el: Element) {
  el.setAttribute("tabindex", "0");
  el.setAttribute("title", "Double-click or press Enter to enlarge");
  el.addEventListener("dblclick", () =>
    viewImage(el, el.getAttribute("alt") || "Research figure"),
  );
  el.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      viewImage(el, el.getAttribute("alt") || "Research figure");
    }
  });
}
all("main img").forEach(zoomable);
const diagrams = all<HTMLElement>("[data-mermaid]");
if (diagrams.length)
  void import("mermaid")
    .then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        maxTextSize: 50000,
        theme: "neutral",
        flowchart: { htmlLabels: false },
      });
      for (const [i, el] of diagrams.entries()) {
        try {
          const { svg } = await mermaid.render(
            `public-diagram-${i}`,
            el.dataset.mermaid ?? "",
          );
          el.innerHTML = svg;
          zoomable(el);
        } catch {
          el.textContent = "This diagram could not be rendered.";
        }
      }
    })
    .catch(() =>
      diagrams.forEach((el) => {
        el.textContent = "Diagram viewer is unavailable.";
      }),
    );
all<HTMLElement>(".canvas-public").forEach(initializeCanvas);
for (const el of all<HTMLElement>(".site-pdf"))
  void import("./pdf")
    .then((m) => m.initializePdf(el, new URL("./", import.meta.url)))
    .catch(() => {
      el.textContent = "The paper viewer could not be loaded.";
    });

initializeDiscovery(announce);
initializeAnalytics();
const search = document.querySelector<HTMLInputElement>("[data-site-search]"),
  results = document.querySelector<HTMLElement>("[data-search-results]");
if (search && results) {
  type Entry = {
    title: string;
    summary: string;
    tags: string[];
    authors: string[];
    path: string;
  };
  let entries: Entry[] = [];
  const show = () => {
    results.replaceChildren();
    const q = search.value.toLocaleLowerCase().trim();
    const found = entries.filter((e) =>
      `${e.title} ${e.summary} ${e.tags.join(" ")} ${e.authors.join(" ")}`
        .toLocaleLowerCase()
        .includes(q),
    );
    const count = document.createElement("p");
    count.setAttribute("role", "status");
    count.textContent = `${found.length} results`;
    results.append(count);
    for (const e of found) {
      const article = document.createElement("article"),
        h = document.createElement("h2"),
        a = document.createElement("a"),
        p = document.createElement("p");
      a.textContent = e.title;
      a.href = `../${e.path}`;
      p.textContent = e.summary;
      h.append(a);
      article.append(h, p);
      results.append(article);
    }
  };
  search.addEventListener("input", show);
  void fetch(new URL("../search.json", import.meta.url))
    .then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    })
    .then((data: Entry[]) => {
      entries = data;
      show();
    })
    .catch(() => {
      results.textContent =
        "Search is unavailable. Browse the archive instead.";
    });
}
