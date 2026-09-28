import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
export async function initializePdf(root: HTMLElement, assets: URL) {
  GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", assets).href;
  const status = root.querySelector<HTMLElement>("[data-pdf-status]")!;
  const input = root.querySelector<HTMLInputElement>("[data-pdf-page]")!;
  const canvas = root.querySelector("canvas")!;
  try {
    const task = getDocument({
      url: root.dataset.source!,
      cMapUrl: new URL("pdf/cmaps/", assets).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("pdf/standard_fonts/", assets).href,
      wasmUrl: new URL("pdf/wasm/", assets).href,
      enableXfa: false,
    });
    const doc = await task.promise;
    root.querySelector("[data-pdf-count]")!.textContent = `of ${doc.numPages}`;
    input.max = String(doc.numPages);
    let page = 1,
      zoom = 1,
      revision = 0,
      rendering: ReturnType<
        Awaited<ReturnType<typeof doc.getPage>>["render"]
      > | null = null;
    async function render() {
      const current = ++revision;
      rendering?.cancel();
      status.textContent = "Loading page…";
      try {
        const pdfPage = await doc.getPage(page);
        if (current !== revision) return;
        const base = pdfPage.getViewport({ scale: 1 }),
          width = Math.max(240, root.clientWidth - 32);
        const viewport = pdfPage.getViewport({
          scale: Math.min(width / base.width, 1.7) * zoom,
        });
        const ratio = Math.min(2, devicePixelRatio || 1);
        canvas.width = viewport.width * ratio;
        canvas.height = viewport.height * ratio;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.setAttribute("aria-label", `Page ${page} of ${doc.numPages}`);
        rendering = pdfPage.render({
          canvas,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await rendering.promise;
        if (current === revision) {
          status.textContent = `Page ${page} of ${doc.numPages}`;
          input.value = String(page);
        }
      } catch (e) {
        if (
          current === revision &&
          (e as Error).name !== "RenderingCancelledException"
        )
          status.textContent = "Unable to render this page.";
      }
    }
    input.addEventListener("change", () => {
      page = Math.max(1, Math.min(doc.numPages, Number(input.value) || 1));
      void render();
    });
    let searchRevision = 0;
    async function search() {
      const q = root
        .querySelector<HTMLInputElement>("[data-pdf-search]")!
        .value.trim()
        .toLocaleLowerCase();
      if (!q) return;
      const version = ++searchRevision;
      status.textContent = "Searching paper…";
      for (let step = 1; step <= Math.min(doc.numPages, 1000); step++) {
        const target = ((page - 1 + step) % doc.numPages) + 1,
          data = await (await doc.getPage(target)).getTextContent();
        if (version !== searchRevision) return;
        if (
          data.items
            .map((i) => ("str" in i ? i.str : ""))
            .join(" ")
            .toLocaleLowerCase()
            .includes(q)
        ) {
          page = target;
          await render();
          status.textContent = `Found on page ${page}. Select Find again for the next matching page.`;
          return;
        }
      }
      status.textContent =
        doc.numPages > 1000
          ? "No match in the next 1,000 pages."
          : "No matching text. Scanned pages may need OCR.";
    }
    root.querySelectorAll<HTMLElement>("[data-pdf]").forEach((el) =>
      el.addEventListener("click", async () => {
        switch (el.dataset.pdf) {
          case "previous":
            page = Math.max(1, page - 1);
            break;
          case "next":
            page = Math.min(doc.numPages, page + 1);
            break;
          case "in":
            zoom = Math.min(3, zoom * 1.25);
            break;
          case "out":
            zoom = Math.max(0.4, zoom / 1.25);
            break;
          case "search":
            try {
              await search();
            } catch {
              status.textContent = "Search could not finish.";
            }
            return;
          case "fullscreen":
            try {
              if (document.fullscreenElement) await document.exitFullscreen();
              else await root.requestFullscreen();
            } catch {
              status.textContent = "Fullscreen is unavailable.";
            }
            return;
        }
        void render();
      }),
    );
    root
      .querySelector<HTMLInputElement>("[data-pdf-search]")!
      .addEventListener("keydown", (e) => {
        if (e.key === "Enter")
          void search().catch(() => {
            status.textContent = "Search unavailable.";
          });
      });
    const outline = await doc.getOutline();
    const nav = root.querySelector<HTMLElement>("[data-pdf-outline]")!;
    const append = (
      items: NonNullable<typeof outline>,
      parent: HTMLElement,
      depth = 0,
    ) => {
      if (depth > 8) return;
      for (const item of items.slice(0, 200)) {
        const b = document.createElement("button");
        b.textContent = item.title;
        b.style.paddingInlineStart = `${depth * 16 + 8}px`;
        b.onclick = async () => {
          try {
            const dest =
              typeof item.dest === "string"
                ? await doc.getDestination(item.dest)
                : item.dest;
            if (dest?.[0] != null) {
              page =
                (typeof dest[0] === "number"
                  ? dest[0]
                  : await doc.getPageIndex(dest[0])) + 1;
              await render();
            }
          } catch {
            status.textContent = "This outline destination is unavailable.";
          }
        };
        parent.append(b);
        append(item.items, parent, depth + 1);
      }
    };
    if (outline?.length) append(outline, nav);
    else nav.textContent = "This paper has no embedded outline.";
    await render();
    window.addEventListener(
      "pagehide",
      () => {
        void task.destroy();
      },
      { once: true },
    );
  } catch {
    status.textContent =
      "This PDF could not be opened. It may be encrypted or damaged.";
  }
}
