import {
  parseMarkdown,
  documentStatistics,
  escapeHtml as esc,
} from "@axiom/markdown";
import type { SiteSnapshot } from "./sites";
import type {
  SiteCatalog,
  SiteCatalogEntry,
  SiteReadingMetadata,
} from "./site-insights";
import { siteArchiveSchema } from "./site-design";
import { entryPath, relativePath, tagPath } from "./site-paths";

export function buildSiteCatalog(
  snapshot: SiteSnapshot,
  dates: Record<string, string> = {},
): SiteCatalog {
  const statistics = new Map<string, SiteReadingMetadata>();
  for (const source of snapshot.sources) {
    if (source.format !== "markdown") continue;
    const parsed = parseMarkdown(source.body ?? ""),
      stats = documentStatistics(parsed, source.body ?? "");
    statistics.set(source.id, {
      words: stats.words,
      readingMinutes: stats.readingMinutes,
      equations: stats.equations,
      tables: stats.tables,
      codeBlocks: stats.codeBlocks,
      outline: parsed.outline.map(({ id, text, level }) => ({
        id,
        text,
        level,
      })),
    });
  }
  return {
    version: 1,
    archive: siteArchiveSchema.parse(snapshot.config.design.archive ?? {}),
    authors: snapshot.config.authors.map(({ id, name }) => ({ id, name })),
    entries: snapshot.config.entries
      .filter((e) => e.included)
      .map((e) => ({
        id: e.id,
        title: e.title,
        summary: e.summary,
        kind: e.kind,
        path: entryPath(e),
        tags: e.tags,
        authorIds: e.authorIds,
        date: e.date,
        firstPublished: dates[e.id],
        reading: statistics.get(e.resourceId),
      })),
  };
}
export const catalogDate = (entry: SiteCatalogEntry) =>
  entry.date || entry.firstPublished?.slice(0, 10) || "";
export const chronologicalEntries = (entries: SiteCatalogEntry[]) =>
  [...entries].sort(
    (a, b) =>
      catalogDate(b).localeCompare(catalogDate(a)) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
export function relatedEntries(catalog: SiteCatalog, entry: SiteCatalogEntry) {
  return chronologicalEntries(
    catalog.entries.filter(
      (e) => e.id !== entry.id && e.tags.some((t) => entry.tags.includes(t)),
    ),
  )
    .sort(
      (a, b) =>
        b.tags.filter((t) => entry.tags.includes(t)).length -
        a.tags.filter((t) => entry.tags.includes(t)).length,
    )
    .slice(0, 3);
}
export function dateMarkup(entry: SiteCatalogEntry) {
  const date = catalogDate(entry);
  return `<span data-entry-date="${entry.id}">${date ? `<time datetime="${esc(date)}">${esc(date)}</time>` : "Not yet published"}</span>`;
}
export function tocMarkup(outline: SiteReadingMetadata["outline"]) {
  if (!outline.length) return "";
  type Item = SiteReadingMetadata["outline"][number] & { children: Item[] };
  const roots: Item[] = [],
    stack: Item[] = [];
  for (const heading of outline) {
    while (stack.length && stack.at(-1)!.level >= heading.level) stack.pop();
    const item = { ...heading, children: [] };
    (stack.at(-1)?.children ?? roots).push(item);
    stack.push(item);
  }
  const list = (items: Item[]): string =>
    `<ol>${items
      .map((h) => {
        const link = `<a href="#${esc(h.id)}">${esc(h.text)}</a>`;
        return `<li>${h.children.length ? `<details open><summary title="Expand or collapse section"><span class="site-outline-toggle" aria-hidden="true">›</span>${link}</summary>${list(h.children)}</details>` : link}</li>`;
      })
      .join("")}</ol>`;
  return `<aside class="site-reading-rail"><details open class="site-outline"><summary>On this page</summary><nav aria-label="On this page">${list(roots)}</nav><div class="site-reading-progress"><progress max="100" value="0" aria-label="Reading progress"></progress><span data-reading-progress>0%</span></div><a class="site-back-top" href="#content">Back to top ↑</a></details></aside>`;
}
export function archiveMarkup(catalog: SiteCatalog) {
  const options = catalog.archive ?? siteArchiveSchema.parse({});
  const entries = chronologicalEntries(catalog.entries),
    page = "archive/index.html";
  const tags = [...new Set(entries.flatMap((e) => e.tags))].sort((a, b) =>
    a.localeCompare(b),
  );
  const groups = new Map<string, SiteCatalogEntry[]>();
  for (const e of entries) {
    const month = catalogDate(e).slice(0, 7) || "Undated";
    groups.set(month, [...(groups.get(month) ?? []), e]);
  }
  const years = [
    ...new Set([...groups.keys()].map((month) => month.slice(0, 4))),
  ];
  const option = (value: string, label: string) =>
    `<option value="${esc(value)}">${esc(label)}</option>`;
  return `<section class="site-archive" data-archive data-archive-default="${options.includePages ? "all" : "published"}" data-archive-style="${options.style}">
    <header class="site-page-heading"><p class="eyebrow">THE RESEARCH RECORD</p><h1>Archive</h1><p>Ideas, papers and discoveries, through time.</p></header>
    <form class="site-discovery-filters" data-archive-filters hidden role="search"><label>Search<input type="search" name="q" placeholder="Search the archive"></label><label>Topic<select name="tag" aria-label="Topic">${option("", "All topics")}${tags.map((t) => option(t, t)).join("")}</select></label><label>Author<select name="author" aria-label="Author">${option("", "All authors")}${catalog.authors.map((a) => option(a.id, a.name)).join("")}</select></label><label>Content<select name="kind" aria-label="Content">${option("published", "Posts, papers & resources")}${option("all", "All content")}${["post", "paper", "resource", "page"].map((k) => option(k, k[0].toUpperCase() + k.slice(1) + "s")).join("")}</select></label><button type="reset">Clear filters</button></form>
    <p class="site-result-count" data-archive-count role="status"></p><nav class="site-archive-years" aria-label="Archive years">${years.map((y) => `<a href="#archive-${y}">${y === "Unda" ? "Undated" : y}</a>`).join("")}</nav>
    <div class="site-timeline">${[...groups]
      .map(([month, items], i, all) => {
        const year = month.slice(0, 4),
          firstYear = i === 0 || all[i - 1][0].slice(0, 4) !== year;
        const label =
          month === "Undated"
            ? "Awaiting first publication"
            : new Intl.DateTimeFormat("en", {
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              }).format(new Date(month + "-01T00:00:00Z"));
        return `<section data-archive-group><h2${firstYear ? ` id="archive-${year}"` : ""}>${esc(label)}</h2><ol>${items.map((e) => `<li data-archive-entry data-id="${e.id}" data-kind="${esc(e.kind)}" data-tags="${esc(JSON.stringify(e.tags))}" data-authors="${esc(JSON.stringify(e.authorIds))}"${!options.includePages && e.kind === "page" ? " hidden" : ""}><span class="site-timeline-dot" aria-hidden="true"></span><div class="site-timeline-date">${dateMarkup(e)}<small>${esc(e.kind)}</small></div><div><h3><a href="${relativePath(page, e.path)}">${esc(e.title)}</a></h3><p>${esc(e.summary)}</p><div class="site-tags">${e.tags.map((t) => `<a href="${relativePath(page, tagPath(t))}">${esc(t)}</a>`).join("")}</div></div></li>`).join("")}</ol></section>`;
      })
      .join(
        "",
      )}</div><p data-archive-empty hidden>No publications match these filters.</p></section>`;
}
export function topicsMarkup(catalog: SiteCatalog) {
  const tags = [...new Set(catalog.entries.flatMap((e) => e.tags))].sort(
    (a, b) => a.localeCompare(b),
  );
  return `<header class="site-page-heading"><p class="eyebrow">EXPLORE THE IDEAS</p><h1>Topics</h1><p>Follow a thread across the research.</p></header><label class="site-topic-filter" hidden>Find a topic<input type="search" data-topic-search placeholder="Filter topics"></label><ul class="site-topic-directory">${tags.map((t) => `<li><a href="${relativePath("tags/index.html", tagPath(t))}"><span>${esc(t)}</span><small>${catalog.entries.filter((e) => e.tags.includes(t)).length} publications</small></a></li>`).join("")}</ul><p data-topic-empty hidden>No matching topics.</p>`;
}
export function articleNavigation(
  catalog: SiteCatalog,
  entry: SiteCatalogEntry,
) {
  const chronological = chronologicalEntries(
      catalog.entries.filter((e) => e.kind !== "page"),
    ),
    index = chronological.findIndex((e) => e.id === entry.id);
  const newer = chronological[index - 1],
    older = chronological[index + 1];
  const link = (e: SiteCatalogEntry, label: string) =>
    `<a href="${relativePath(entry.path, e.path)}"><small>${label}</small><strong>${esc(e.title)}</strong></a>`;
  const related = relatedEntries(catalog, entry);
  return `<!--axiom:navigation:${entry.id}-->${index >= 0 ? `<nav class="site-post-navigation" aria-label="Article navigation">${newer ? link(newer, "← Newer") : "<span></span>"}${older ? link(older, "Older →") : ""}</nav>` : ""}${related.length ? `<section class="site-related"><h2>Continue exploring</h2>${related.map((e) => link(e, e.kind)).join("")}</section>` : ""}<!--/axiom:navigation-->`;
}

/** Publication timestamps are server metadata, not changes to frozen research.
 * The same substitution runs for hosting, previews, and static exports. */
export function hydrateCatalogMetadata(html: string, catalog: SiteCatalog) {
  let result = html.replace(
    /<!--axiom:archive-->[\s\S]*?<!--\/axiom:archive-->/g,
    () => `<!--axiom:archive-->${archiveMarkup(catalog)}<!--/axiom:archive-->`,
  );
  for (const entry of catalog.entries) {
    result = result.replace(
      new RegExp(
        `<!--axiom:navigation:${entry.id}-->[\\s\\S]*?<!--/axiom:navigation-->`,
        "g",
      ),
      () => articleNavigation(catalog, entry),
    );
    result = result.replace(
      new RegExp(`<span data-entry-date="${entry.id}">[\\s\\S]*?</span>`, "g"),
      () => dateMarkup(entry),
    );
  }
  return result;
}
