import { parseMarkdown, escapeHtml as esc } from "@axiom/markdown";
import { renderDocumentAsync } from "../../markdown/src/render-async";
import { parseCanvas, canvasBounds } from "./canvas";
import { canvasEdgeGeometry } from "./canvas-geometry";
import { readOffice } from "./office-parse";
import { readWorkbook } from "./workbook-parse";
import { parseDelimited } from "./file-preview";
import type { SiteSnapshot, SourceSnapshot, SiteEntry } from "./sites";
import { siteDesignSchema } from "./sites";
import type { SiteCatalog } from "./site-insights";
import {
  buildSiteCatalog,
  dateMarkup,
  tocMarkup,
  articleNavigation,
} from "./site-discovery";
import {
  SITE_ORIGIN,
  publicKey,
  resourcePath,
  tagPath,
  entryPath,
  relativePath,
  fileRelative,
} from "./site-paths";
export {
  SITE_ORIGIN,
  publicKey,
  resourcePath,
  tagPath,
  entryPath,
  relativePath,
} from "./site-paths";

const jsonScript = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c");
const table = (rows: string[][]) =>
  `<div class="site-table"><table>${rows.map((row, i) => `<tr>${row.map((cell) => `<${i === 0 ? "th" : "td"}>${esc(cell)}</${i === 0 ? "th" : "td"}>`).join("")}</tr>`).join("")}</table></div>`;
export type PublicRenderContext = {
  snapshot: SiteSnapshot;
  assets: Map<string, string>;
  warnings: Set<string>;
};

export async function publicMarkdown(
  source: string,
  page: string,
  ctx: PublicRenderContext,
) {
  // Markdown HTML is disabled by the shared renderer. Rewrite only parsed links,
  // not code examples; no private endpoint survives into rendered attributes.
  const parsed = parseMarkdown(source),
    sourceById = new Map(ctx.snapshot.sources.map((s) => [s.id, s]));
  const entryBySource = new Map(
    ctx.snapshot.config.entries
      .filter((e) => e.included)
      .map((e) => [e.resourceId, e]),
  );
  const resolvedLinks = new Set<string>();
  const link = (target: string) => {
    const [name, anchor] = target.split("#");
    const match =
      sourceById.get(name) ||
      ctx.snapshot.sources.find(
        (s) => s.name.toLowerCase() === name.toLowerCase(),
      );
    if (!match) return undefined;
    const resolved = {
      title: match.name,
      href:
        relativePath(
          page,
          entryBySource.has(match.id)
            ? entryPath(entryBySource.get(match.id)!)
            : resourcePath(match.id),
        ) + (anchor ? "#" + encodeURIComponent(anchor) : ""),
    };
    resolvedLinks.add(esc(resolved.href));
    return resolved;
  };
  const rendered = await renderDocumentAsync(parsed, {
    references: ctx.snapshot.references,
    resolveLink: link,
    visuals: false,
    blockMarks: false,
    scrollTables: true,
  });
  let html = rendered.html
    .replace(/\b(src|href)="([^"]*)"/g, (_all, attr: string, url: string) => {
      if (url.startsWith("#")) return `${attr}="${url}"`;
      if (attr === "href" && resolvedLinks.has(url)) return `${attr}="${url}"`;
      const attachment = /^\/api\/v1\/attachments\/([a-f0-9-]{36})/.exec(url);
      const note =
        /^\/(?:workbench\/notes|api\/v1\/(?:notes|files))\/([a-f0-9-]{36})/.exec(
          url,
        );
      const asset = attachment ? ctx.assets.get(attachment[1]) : undefined;
      if (asset) return `${attr}="${esc(fileRelative(page, asset))}"`;
      if (note && attr === "href") {
        const target = link(note[1]);
        if (target) return `href="${esc(target.href)}"`;
      }
      if (
        attr === "href" &&
        /^https?:\/\//i.test(url) &&
        !url.startsWith(process.env.APP_URL + "/")
      )
        return `href="${url}" rel="noreferrer noopener"`;
      ctx.warnings.add(
        "Unavailable/private links and external images were omitted. Add required assets explicitly before review.",
      );
      return `${attr === "src" ? "data-omitted-image" : "data-omitted-link"}="true"`;
    })
    .replace(
      /<img\b(?=[^>]*data-omitted-image)[^>]*>/g,
      '<span class="site-unavailable">Image not included in this publication.</span>',
    );
  if (rendered.css) html = `<style>${rendered.css}</style>${html}`;
  return html;
}

export async function renderPublicResource(
  source: SourceSnapshot,
  page: string,
  ctx: PublicRenderContext,
  read: () => Promise<Uint8Array>,
): Promise<string> {
  const asset = ctx.assets.get(source.id),
    url = asset ? fileRelative(page, asset) : "";
  if (source.format === "markdown")
    return publicMarkdown(source.body ?? "", page, ctx);
  if (source.format === "math")
    return `<div class="site-equation">${await publicMarkdown(`$$\n${source.body ?? ""}\n$$`, page, ctx)}<details><summary>Equation source</summary><pre><code>${esc(source.body ?? "")}</code></pre><button data-copy-tex>Copy TeX</button><button data-copy-svg>Download SVG</button></details></div>`;
  if (source.format === "canvas") {
    const canvas = parseCanvas(source.body ?? "{}"),
      bounds = canvasBounds(canvas.nodes);
    const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
    const edges = canvas.edges
      .map((edge) => {
        const a = byId.get(edge.fromNode),
          b = byId.get(edge.toNode);
        if (!a || !b) return "";
        const g = canvasEdgeGeometry(a, b, edge.fromSide, edge.toSide);
        return `<path d="${esc(g.d)}"/><text x="${g.label.x}" y="${g.label.y}">${esc(edge.label ?? "")}</text>`;
      })
      .join("");
    const cards = await Promise.all(
      canvas.nodes.map(async (n) => {
        let body = "";
        if (n.type === "text") body = await publicMarkdown(n.text, page, ctx);
        if (n.type === "link")
          body = `<a href="${esc(n.url)}" rel="noreferrer noopener">${esc(n.title ?? n.url)}</a>`;
        if (n.type === "group") body = esc(n.label ?? "");
        if (n.type === "file") {
          const resource = ctx.snapshot.sources.find(
            (s) => s.id === n.resourceId || s.versionId === n.versionId,
          );
          if (resource) {
            const img = ctx.assets.get(resource.id);
            body = `${img && resource.mime?.startsWith("image/") ? `<img src="${esc(fileRelative(page, img))}" alt="${esc(resource.name)}">` : ""}<a href="${esc(relativePath(page, resourcePath(resource.id)))}">Open ${esc(resource.name)}</a>`;
          } else {
            body = "Resource not included in this publication.";
            ctx.warnings.add(
              "Canvas cards pointing outside the approved selection are unavailable.",
            );
          }
        }
        return `<article class="canvas-public-card ${n.type === "group" ? "is-group" : ""}" style="left:${n.x}px;top:${n.y}px;width:${n.width}px;height:${n.height}px"><strong>${esc(n.title ?? "")}</strong>${body}</article>`;
      }),
    );
    return `<div class="site-viewer-toolbar"><button data-canvas-zoom="out">−</button><button data-canvas-zoom="in">+</button><button data-canvas-zoom="fit">Fit</button><input type="search" data-canvas-search aria-label="Find canvas card" placeholder="Find a card…"></div><div class="canvas-public" tabindex="0" aria-label="Read-only canvas. Drag the background to pan."><div class="canvas-public-world" data-bounds='${jsonScript(bounds)}'><svg class="canvas-public-edges">${edges}</svg>${cards.join("")}</div></div>`;
  }
  if (source.format === "text")
    return /\.(csv|tsv)$/i.test(source.name)
      ? table(
          parseDelimited(
            source.body ?? "",
            /\.tsv$/i.test(source.name) ? "\t" : ",",
            1000,
          ),
        )
      : `<pre class="site-text">${esc(source.body ?? "")}</pre>`;
  const mime = source.mime ?? "";
  if (mime.startsWith("image/") || mime === "application/vnd.axiom.image+zip")
    return url
      ? `<figure><img class="site-zoom-image" src="${esc(url)}" alt="${esc(source.name)}" tabindex="0"><figcaption>${esc(source.name)}</figcaption></figure>`
      : "<p>Image unavailable.</p>";
  if (mime === "application/pdf")
    return `<div class="site-pdf" data-source="${esc(url)}"><div class="site-viewer-toolbar"><button data-pdf="previous">Previous</button><input data-pdf-page type="number" min="1" value="1" aria-label="PDF page"><span data-pdf-count></span><button data-pdf="next">Next</button><button data-pdf="out">−</button><button data-pdf="in">+</button><button data-pdf="fullscreen">Fullscreen</button><input data-pdf-search type="search" aria-label="Find in PDF" placeholder="Find in paper…"><button data-pdf="search">Find</button></div><details><summary>Outline</summary><nav data-pdf-outline></nav></details><p role="status" data-pdf-status>Preparing paper…</p><div class="site-pdf-page"><canvas></canvas></div></div>`;
  if (mime.startsWith("audio/") || mime.startsWith("video/")) {
    const tag = mime.startsWith("audio/") ? "audio" : "video";
    return `<${tag} controls preload="metadata" src="${esc(url)}"></${tag}>`;
  }
  if (mime.includes("wordprocessingml") || mime.includes("presentationml")) {
    const data = await read(),
      office = await readOffice(
        Uint8Array.from(data).buffer,
        mime.includes("wordprocessingml") ? "docx" : "pptx",
      );
    const blocks = (items: typeof office.blocks) =>
      items
        .map((b) =>
          b.kind === "table"
            ? table(b.rows)
            : `<${b.heading ? `h${Math.min(6, b.heading)}` : "p"}>${esc(b.text)}</${b.heading ? `h${Math.min(6, b.heading)}` : "p"}>`,
        )
        .join("");
    office.warnings.forEach((w) => ctx.warnings.add(w));
    return office.format === "docx"
      ? blocks(office.blocks)
      : office.slides
          .filter((s) => !s.hidden)
          .map(
            (s, i) =>
              `<section class="site-slide" id="slide-${i + 1}"><small>Slide ${i + 1}</small><h2>${esc(s.title)}</h2>${blocks(s.blocks)}</section>`,
          )
          .join("");
  }
  if (mime.includes("spreadsheetml")) {
    const data = await read(),
      book = await readWorkbook(Uint8Array.from(data).buffer, {
        publicPreview: true,
      });
    return book.sheets
      .filter((s) => !s.hidden)
      .map(
        (s) =>
          `<details open><summary>${esc(s.name)}</summary>${table(s.rows.map((r) => r.map((c) => c.text)))}</details>`,
      )
      .join("");
  }
  if (
    mime.startsWith("text/") ||
    ["application/json", "application/xml"].includes(mime)
  ) {
    if ((source.bytes ?? 0) > 5_000_000)
      return "<p>This file exceeds the 5 MB text preview limit.</p>";
    const text = new TextDecoder().decode(await read());
    return /\.(csv|tsv)$/i.test(source.name)
      ? table(
          parseDelimited(text, /\.tsv$/i.test(source.name) ? "\t" : ",", 1000),
        )
      : `<pre class="site-text">${esc(text)}</pre>`;
  }
  return "<p>No browser preview is available for this format.</p>";
}

export function siteDocument(
  snapshot: SiteSnapshot,
  page: string,
  title: string,
  body: string,
  entry?: SiteEntry,
  catalog: SiteCatalog = buildSiteCatalog(snapshot),
) {
  const c = snapshot.config,
    design = siteDesignSchema.parse(c.design),
    rel = (path: string) => fileRelative(page, path),
    entries = c.entries.filter((e) => e.included);
  const authors = entry
    ? c.authors.filter((a) => entry.authorIds.includes(a.id))
    : [];
  const navigation = c.navigation
    .map((n) => {
      const target = entries.find((e) => e.id === n.entryId),
        href = target ? relativePath(page, entryPath(target)) : n.url;
      return href ? `<a href="${esc(href)}">${esc(n.label)}</a>` : "";
    })
    .join("");
  const citation = entry
    ? `${authors.map((a) => a.name).join(", ")}${entry.date ? ` (${entry.date.slice(0, 4)})` : ""}. ${entry.title}. ${c.title}.${entry.doi ? ` DOI: ${entry.doi}` : ""}`
    : "";
  const canonical = SITE_ORIGIN + "/" + page.replace(/index\.html$/, "");
  const logo = c.logoId
    ? `<img src="${rel(`assets/${publicKey(c.logoId)}.png`)}" alt="" width="38" height="38">`
    : "";
  const cover = entry?.coverId
    ? `<figure class="article-cover"><img src="${rel(`assets/${publicKey(entry.coverId)}.png`)}" alt="${esc(entry.title)}"></figure>`
    : "";
  const item = catalog.entries.find((e) => e.id === entry?.id),
    stats = item?.reading;
  const toc = design.reading.toc && stats ? tocMarkup(stats.outline) : "";
  const reading = stats
    ? [
        design.reading.wordCount
          ? `${stats.words.toLocaleString("en")} words`
          : "",
        design.reading.readingTime ? `${stats.readingMinutes} min read` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  return `<!doctype html>
<html lang="en" data-template="${design.template}" data-site-theme="${design.theme}" data-mode="${design.mode}" data-font="${design.font}" data-spacing="${design.spacing}" data-section-numbers="${design.reading.sectionNumbers}" data-progress="${design.reading.progress}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(c.title)}</title><meta name="description" content="${esc(entry?.summary ?? c.description)}"><link rel="canonical" href="${esc(canonical)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(entry?.summary ?? c.description)}"><meta property="og:type" content="${entry ? "article" : "website"}"><meta property="og:url" content="${esc(canonical)}"><link rel="alternate" type="application/rss+xml" href="${rel("feed.xml")}" title="${esc(c.title)}"><link rel="stylesheet" href="${rel("_site/site.css")}"><style>:root{--accent:${design.accent};--article-font-size:${design.reading.fontSize}px;--article-leading:${design.reading.lineHeight};--article-measure:${design.reading.measure}ch}</style><script type="module" src="${rel("_site/reader.js")}"></script><!--axiom:runtime-->
${entry ? `<script type="application/ld+json">${jsonScript({ "@context": "https://schema.org", "@type": entry.kind === "paper" ? "ScholarlyArticle" : "Article", headline: entry.title, description: entry.summary, author: authors.map((a) => ({ "@type": "Person", name: a.name })), datePublished: entry.date, url: canonical, ...(stats ? { wordCount: stats.words } : {}) })}</script>` : ""}</head>
<body data-public-path="${esc(page)}" data-entry-id="${entry?.id ?? ""}"><a class="skip" href="#content">Skip to content</a>
<header class="site-header"><a class="site-identity" href="${relativePath(page, "index.html")}">${logo}<small>${c.identity === "personal" ? "Research notebook" : "Research workspace"}</small><strong>${esc(c.title)}</strong></a><nav aria-label="Site navigation">${navigation}<a href="${relativePath(page, "archive/index.html")}">Archive</a><a href="${relativePath(page, "tags/index.html")}">Topics</a><a href="${relativePath(page, "search/index.html")}">Search</a><button data-theme-toggle aria-label="Switch color mode">◐</button></nav></header>
<div class="site-reading-layout${toc ? " has-toc" : ""}">${toc}<main id="content">
${entry ? `<header class="article-heading"><p class="eyebrow">${esc(entry.kind)}${item ? ` · ${dateMarkup(item)}` : ""}</p><h1>${esc(entry.title)}</h1><p class="lede">${esc(entry.summary)}</p><p class="article-authors">${authors.map((a) => `<a href="${relativePath(page, `authors/${a.id}/index.html`)}">${esc(a.name)}</a>`).join(" · ")}</p>${reading ? `<p class="article-reading-stats">${reading}</p>` : ""}<div class="site-tags">${entry.tags.map((t) => `<a href="${relativePath(page, tagPath(t))}">${esc(t)}</a>`).join("")}</div><p class="site-public-totals" data-public-totals="article" hidden></p></header>` : ""}
${cover}<div class="${entry ? "site-article-body" : "site-page-body"}">${body}</div>
${entry ? `<footer class="article-footer"><button data-copy-citation="${esc(citation)}">Copy citation</button><button data-print>Print</button>${entry.doi ? `<a href="https://doi.org/${encodeURIComponent(entry.doi)}" rel="noreferrer">DOI</a>` : ""}<span>${esc(entry.license)}</span></footer>${item ? articleNavigation(catalog, item) : ""}` : ""}</main></div>
<footer class="site-footer"><span>${esc(c.title)}</span><a href="${rel("feed.xml")}">RSS</a><span data-public-totals="site" hidden></span><button data-site-privacy hidden>Privacy settings</button><small>Published with Axiom</small></footer></body></html>`;
}
export function entryCards(entries: SiteEntry[], page: string) {
  return `<div class="publication-list">${entries.map((e) => `<article><small>${esc(e.date ?? e.kind)}</small><h2><a href="${relativePath(page, entryPath(e))}">${esc(e.title)}</a></h2><p>${esc(e.summary)}</p><span>${e.tags.map(esc).join(" · ")}</span></article>`).join("")}</div>`;
}
export async function homeBody(ctx: PublicRenderContext) {
  const c = ctx.snapshot.config,
    entries = c.entries
      .filter((e) => e.included)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const sections = await Promise.all(
    c.design.sections
      .filter((s) => !s.hidden)
      .map(async (s) => {
        const collection = entries.filter((e) =>
          s.entryIds.length
            ? s.entryIds.includes(e.id)
            : s.kind === "publications"
              ? e.kind === "paper"
              : s.kind === "posts"
                ? e.kind === "post"
                : s.kind === "resources"
                  ? e.kind === "resource"
                  : true,
        );
        if (
          !s.text.trim() &&
          ((s.kind === "people" && !c.authors.length) ||
            ([
              "featured",
              "publications",
              "posts",
              "resources",
              "gallery",
            ].includes(s.kind) &&
              !collection.length))
        )
          return "";
        let body = await publicMarkdown(s.text, "index.html", ctx);
        if (s.kind === "intro")
          return `<section class="site-hero"><p class="eyebrow">${c.identity === "personal" ? "Independent research" : "Ideas · People · Discovery"}</p><h1>${esc(s.title || c.title)}</h1><p class="lede">${esc(c.description)}</p>${body}</section>`;
        if (s.kind === "people")
          body += `<div class="site-people">${c.authors.map((a) => `<article><h3><a href="authors/${a.id}/">${esc(a.name)}</a></h3><p>${esc(a.affiliation)}</p><p>${esc(a.bio)}</p></article>`).join("")}</div>`;
        if (
          [
            "featured",
            "publications",
            "posts",
            "resources",
            "gallery",
          ].includes(s.kind)
        )
          body += entryCards(
            entries
              .filter((e) =>
                s.entryIds.length
                  ? s.entryIds.includes(e.id)
                  : s.kind === "publications"
                    ? e.kind === "paper"
                    : s.kind === "posts"
                      ? e.kind === "post"
                      : s.kind === "resources"
                        ? e.kind === "resource"
                        : true,
              )
              .slice(0, 24),
            "index.html",
          );
        return `<section class="site-section"><h2>${esc(s.title)}</h2>${body}</section>`;
      }),
  );
  return sections.join("");
}
