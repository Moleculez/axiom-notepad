/** Progressive enhancements over the release's semantic HTML. */
export function initializeDiscovery(announce: (message: string) => void) {
  const article = document.querySelector<HTMLElement>(".site-article-body");
  const outline = document.querySelector<HTMLElement>(".site-outline");
  const headings = article
    ? [
        ...article.querySelectorAll<HTMLElement>(
          "h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]",
        ),
      ].filter((h) => !h.closest(".canvas-public,.site-pdf,.document-toc"))
    : [];
  const links = outline
    ? [...outline.querySelectorAll<HTMLAnchorElement>("nav a")]
    : [];
  for (const heading of headings) {
    const button = document.createElement("button");
    button.className = "site-heading-link";
    button.textContent = "#";
    button.setAttribute("aria-label", `Copy link to ${heading.textContent}`);
    button.title = "Copy section link";
    button.addEventListener("click", async () => {
      try {
        const url = new URL(location.href);
        url.hash = heading.id;
        url.search = "";
        await navigator.clipboard.writeText(url.href);
        announce("Section link copied.");
      } catch {
        announce("Copy the section address from your browser.");
      }
    });
    heading.append(button);
  }
  let frame = 0;
  const update = () => {
    frame = 0;
    if (!article) return;
    const box = article.getBoundingClientRect();
    const percent = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          ((-box.top + innerHeight * 0.25) /
            Math.max(1, box.height - innerHeight * 0.65)) *
            100,
        ),
      ),
    );
    const bar = outline?.querySelector("progress");
    if (bar) bar.value = percent;
    const label = outline?.querySelector("[data-reading-progress]");
    if (label) label.textContent = `${percent}%`;
    let current = headings[0]?.id;
    for (const heading of headings)
      if (heading.getBoundingClientRect().top <= innerHeight * 0.28)
        current = heading.id;
    if (box.bottom <= innerHeight && box.top < 0)
      current = headings.at(-1)?.id ?? current;
    for (const link of links) {
      if (decodeURIComponent(link.hash.slice(1)) === current)
        link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  if (article) {
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    new ResizeObserver(schedule).observe(article);
    document.fonts?.ready.then(schedule).catch(() => {});
    update();
  }
  // One outer disclosure adapts to the available desktop width. Inner branches
  // remain independent so scrolling never reopens a deliberately closed branch.
  const compact = matchMedia("(max-width: 1199px)");
  const adapt = () => {
    if (outline instanceof HTMLDetailsElement) outline.open = !compact.matches;
  };
  compact.addEventListener("change", adapt);
  adapt();

  const archive = document.querySelector<HTMLElement>("[data-archive]");
  const form = archive?.querySelector<HTMLFormElement>(
    "[data-archive-filters]",
  );
  if (archive && form) {
    form.hidden = false;
    const inputs = ["q", "tag", "author", "kind"] as const;
    const fields = Object.fromEntries(
      inputs.map((key) => [key, form.elements.namedItem(key)]),
    ) as Record<(typeof inputs)[number], HTMLInputElement | HTMLSelectElement>;
    const applyUrl = () => {
      const params = new URL(location.href).searchParams;
      for (const key of inputs)
        fields[key].value =
          params.get(key) ??
          (key === "kind"
            ? (archive.dataset.archiveDefault ?? "published")
            : "");
      if (!fields.kind.value) fields.kind.value = "published";
    };
    const items = [
      ...archive.querySelectorAll<HTMLElement>("[data-archive-entry]"),
    ];
    const show = (replace = true) => {
      let count = 0;
      for (const item of items) {
        const matches =
          (!fields.q.value ||
            item.textContent
              ?.toLocaleLowerCase()
              .includes(fields.q.value.trim().toLocaleLowerCase())) &&
          (!fields.tag.value ||
            (JSON.parse(item.dataset.tags ?? "[]") as string[]).includes(
              fields.tag.value,
            )) &&
          (!fields.author.value ||
            (JSON.parse(item.dataset.authors ?? "[]") as string[]).includes(
              fields.author.value,
            )) &&
          (fields.kind.value === "all" ||
            (fields.kind.value === "published"
              ? item.dataset.kind !== "page"
              : item.dataset.kind === fields.kind.value));
        item.hidden = !matches;
        if (matches) count++;
      }
      for (const group of archive.querySelectorAll<HTMLElement>(
        "[data-archive-group]",
      ))
        group.hidden = !group.querySelector(
          "[data-archive-entry]:not([hidden])",
        );
      for (const link of archive.querySelectorAll<HTMLAnchorElement>(
        ".site-archive-years a",
      )) {
        const year = link.dataset.year ?? link.hash.slice("#archive-".length);
        link.dataset.year = year;
        const groups = [
          ...archive.querySelectorAll<HTMLElement>("[data-archive-group]"),
        ];
        const target = groups.find(
          (g) =>
            !g.hidden &&
            (g.querySelector("h2")?.textContent?.includes(year) ||
              (year === "Unda" &&
                g.querySelector("h2")?.textContent?.includes("Awaiting"))),
        );
        for (const group of groups) {
          const h = group.querySelector("h2");
          if (h?.id === `archive-${year}`) h.removeAttribute("id");
        }
        if (target) target.querySelector("h2")!.id = `archive-${year}`;
        link.hidden = !target;
      }
      archive.querySelector("[data-archive-count]")!.textContent =
        `${count} ${count === 1 ? "publication" : "publications"}`;
      (archive.querySelector("[data-archive-empty]") as HTMLElement).hidden =
        count > 0;
      if (replace) {
        const url = new URL(location.href);
        for (const key of inputs)
          if (fields[key].value) url.searchParams.set(key, fields[key].value);
          else url.searchParams.delete(key);
        history.replaceState(null, "", url);
      }
    };
    form.addEventListener("input", () => show());
    form.addEventListener("submit", (e) => e.preventDefault());
    form.addEventListener("reset", () => {
      queueMicrotask(() => {
        fields.kind.value = archive.dataset.archiveDefault ?? "published";
        show();
      });
    });
    addEventListener("popstate", () => {
      applyUrl();
      show(false);
    });
    applyUrl();
    show(false);
  }
  const topicSearch = document.querySelector<HTMLInputElement>(
    "[data-topic-search]",
  );
  if (topicSearch) {
    topicSearch.closest<HTMLElement>("label")!.hidden = false;
    topicSearch.addEventListener("input", () => {
      const items = [
        ...document.querySelectorAll<HTMLElement>(".site-topic-directory li"),
      ];
      items.forEach((item) => {
        item.hidden = !item.textContent
          ?.toLocaleLowerCase()
          .includes(topicSearch.value.trim().toLocaleLowerCase());
      });
      (document.querySelector("[data-topic-empty]") as HTMLElement).hidden =
        items.some((item) => !item.hidden);
    });
  }
  // Existing footnotes become genuine margin notes in the essay theme, with a
  // collision-aware vertical flow and the ordinary endnotes kept as a fallback.
  if (article && document.documentElement.dataset.siteTheme === "tufte") {
    const rail = document.createElement("aside");
    rail.className = "site-sidenotes";
    rail.setAttribute("aria-label", "Margin notes");
    article.append(rail);
    const notes: { source: HTMLElement; note: HTMLElement }[] = [];
    for (const ref of article.querySelectorAll<HTMLAnchorElement>(
      'sup a[href^="#fn-"]',
    )) {
      if (notes.some((n) => n.note.dataset.target === ref.hash)) continue;
      const source = document.getElementById(ref.hash.slice(1));
      if (!source) continue;
      const note = document.createElement("div");
      note.className = "site-sidenote";
      note.dataset.target = ref.hash;
      const label = document.createElement("strong");
      label.textContent = `${ref.textContent}. `;
      const copy = source.cloneNode(true) as HTMLElement;
      // Namespace IDs, including MathJax SVG glyph references, instead of
      // breaking equations when the original footnote contains mathematics.
      const ids = new Map<string, string>();
      for (const element of [
        copy,
        ...copy.querySelectorAll<HTMLElement>("[id]"),
      ])
        if (element.id) {
          ids.set(element.id, `sidenote-${notes.length}-${element.id}`);
          element.id = ids.get(element.id)!;
        }
      for (const element of copy.querySelectorAll("*"))
        for (const attr of [
          "href",
          "xlink:href",
          "clip-path",
          "fill",
          "aria-labelledby",
        ]) {
          const value = element.getAttribute(attr);
          if (!value) continue;
          if (value.startsWith("#") && ids.has(value.slice(1)))
            element.setAttribute(attr, "#" + ids.get(value.slice(1)));
          else if (value.startsWith("url(#") && ids.has(value.slice(5, -1)))
            element.setAttribute(attr, `url(#${ids.get(value.slice(5, -1))})`);
          else if (attr === "aria-labelledby")
            element.setAttribute(
              attr,
              value
                .split(" ")
                .map((id) => ids.get(id) ?? id)
                .join(" "),
            );
        }
      copy.querySelectorAll('a[href^="#fnref-"]').forEach((n) => n.remove());
      note.append(label, ...copy.childNodes);
      rail.append(note);
      notes.push({ source: ref, note });
    }
    const layout = () => {
      let bottom = 0;
      for (const { source, note } of notes) {
        const top = Math.max(
          bottom,
          source.getBoundingClientRect().top -
            article.getBoundingClientRect().top,
        );
        note.style.top = `${top}px`;
        bottom = top + note.offsetHeight + 18;
      }
    };
    new ResizeObserver(layout).observe(article);
    addEventListener("resize", layout);
    document.fonts?.ready.then(layout).catch(() => {});
    layout();
  }
}
