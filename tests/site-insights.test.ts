import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  defaultSiteConfig,
  siteConfigSchema,
  siteEntrySchema,
  type SiteSnapshot,
} from "../packages/shared/src/sites";
import {
  siteReadingSchema,
  siteThemes,
} from "../packages/shared/src/site-design";
import {
  buildSiteCatalog,
  tocMarkup,
  archiveMarkup,
  hydrateCatalogMetadata,
  relatedEntries,
  catalogDate,
  topicsMarkup,
} from "../packages/shared/src/site-discovery";
import {
  siteAnalyticsSettingsSchema,
  siteEventSchema,
  siteEventDelta,
  normalizedReferrer,
} from "../packages/shared/src/site-insights";
import {
  analyticsRange,
  collectionAllowed,
} from "../packages/shared/src/site-analytics";
import { analyticsCsp, publicationCsp } from "../packages/shared/src/site-http";
import { siteDocument } from "../packages/shared/src/site-render";
import { publicMarkdown } from "../packages/shared/src/site-render";
import {
  designPreview,
  designAsset,
} from "../packages/shared/src/site-design-preview";

function specimen() {
  const config = defaultSiteConfig("Research", true),
    resourceId = randomUUID();
  config.entries = [
    siteEntrySchema.parse({
      id: randomUUID(),
      resourceId,
      title: "First paper",
      slug: "first",
      kind: "paper",
      tags: ["AI & math"],
    }),
    siteEntrySchema.parse({
      id: randomUUID(),
      resourceId: randomUUID(),
      title: "Second paper",
      slug: "second",
      kind: "post",
      date: "2026-08-01",
      tags: ["AI & math"],
    }),
    siteEntrySchema.parse({
      id: randomUUID(),
      resourceId: randomUUID(),
      title: "About",
      slug: "about",
      kind: "page",
    }),
    siteEntrySchema.parse({
      id: randomUUID(),
      resourceId: randomUUID(),
      title: "Private",
      slug: "private",
      kind: "post",
      included: false,
    }),
  ];
  const snapshot: SiteSnapshot = {
    config,
    sources: [
      {
        id: resourceId,
        name: "First paper",
        version: 1,
        format: "markdown",
        body: "# Introduction\n\nA readable argument.\n\n### Deep result\n\n$$\nx^2 + y^2 = 1\n$$\n\n```python\nprint('not prose')\n```\n\n## Conclusion\n\nUseful evidence.",
      },
    ],
    references: {},
    createdAt: "2026-09-28T00:00:00Z",
  };
  return {
    config,
    snapshot,
    catalog: buildSiteCatalog(snapshot, {
      [config.entries[0].id]: "2026-09-20",
    }),
  };
}
describe("research publication reading contracts", () => {
  it("preserves escaped, language-aware code highlighting in public Markdown", async () => {
    const { snapshot } = specimen(),
      context = {
        snapshot,
        assets: new Map<string, string>(),
        warnings: new Set<string>(),
      };
    const html = await publicMarkdown(
      '```python\ndef energy(x):\n    return "safe <script>" # comment\n```',
      "index.html",
      context,
    );
    expect(html).toContain('class="language-python"');
    expect(html).toContain('class="hljs-keyword"');
    expect(html).toContain('class="hljs-string"');
    expect(html).toContain('class="hljs-comment"');
    expect(html).not.toContain("<script>");
    expect(
      await publicMarkdown(
        "```unknown-language\n<script>not executable</script>\n```",
        "index.html",
        context,
      ),
    ).toContain("&lt;script&gt;");
  });
  it("defaults new sites to LaTeX while preserving old theme choices", () => {
    const { config } = specimen();
    expect(config.design.theme).toBe("latex-paper");
    const legacy = JSON.parse(JSON.stringify(config));
    delete legacy.design.theme;
    delete legacy.design.reading;
    delete legacy.design.archive;
    legacy.design.font = "serif";
    const parsed = siteConfigSchema.parse(legacy);
    expect(parsed.design.theme).toBe("classic");
    expect(parsed.design.font).toBe("serif");
    expect(parsed.design.reading.toc).toBe(true);
  });
  it("rejects unsafe or inaccessible typography values", () => {
    for (const patch of [
      { fontSize: 0 },
      { measure: 500 },
      { lineHeight: 0.3 },
      { unreviewed: true },
    ])
      expect(siteReadingSchema.safeParse(patch).success).toBe(false);
  });
  it("only catalogs explicitly included pages and counts actual Markdown", () => {
    const { catalog } = specimen();
    expect(catalog.entries).toHaveLength(3);
    expect(catalog.entries[0].reading?.equations).toBe(1);
    expect(catalog.entries[0].reading?.codeBlocks).toBe(1);
    expect(catalog.entries[0].reading?.outline.map((h) => h.level)).toEqual([
      1, 3, 2,
    ]);
    expect(catalog.entries[1].reading).toBeUndefined();
    expect(JSON.stringify(catalog)).not.toContain("Private");
  });
  it("nests outlines by ancestry, not absolute heading levels, and escapes text", () => {
    const html = tocMarkup([
      { id: "a", text: "<A>", level: 2 },
      { id: "b", text: "B", level: 4 },
      { id: "c", text: "C", level: 2 },
    ]);
    expect(html).toContain("&lt;A&gt;</a></summary><ol>");
    expect(html).toContain('</ol></details></li><li><a href="#c">C</a>');
    expect(tocMarkup([])).toBe("");
  });
  it("uses stable first publication with explicit dates taking priority", () => {
    const { catalog } = specimen();
    expect(catalogDate(catalog.entries[0])).toBe("2026-09-20");
    expect(catalogDate({ ...catalog.entries[0], date: "2020-01-01" })).toBe(
      "2020-01-01",
    );
  });
  it("builds filterable timeline and excludes ordinary pages by default", () => {
    const { catalog } = specimen(),
      html = archiveMarkup(catalog);
    expect(html).toContain("September 2026");
    expect(html).toContain("August 2026");
    expect(html).toMatch(/data-kind="page"[^>]* hidden/);
    expect(html).not.toContain("Private");
    expect(html).toContain("All authors");
    expect(topicsMarkup(catalog)).toContain("2 publications");
  });
  it("hydrates publication dates without altering article content", () => {
    const { catalog } = specimen();
    const html = `<p>Frozen argument.</p><!--axiom:archive-->old<!--/axiom:archive--><span data-entry-date="${catalog.entries[0].id}">Not yet published</span>`;
    const out = hydrateCatalogMetadata(html, catalog);
    expect(out).toContain("Frozen argument.");
    expect(out).toContain('datetime="2026-09-20"');
    expect(out).not.toContain(
      `<span data-entry-date="${catalog.entries[0].id}">Not yet published</span>`,
    );
  });
  it("recommends related public articles without including itself", () => {
    const { catalog } = specimen();
    expect(
      relatedEntries(catalog, catalog.entries[0]).map((e) => e.title),
    ).toEqual(["Second paper"]);
  });
  it.each(siteThemes)(
    "renders $name with independent reading controls",
    (theme) => {
      const { snapshot, catalog } = specimen();
      snapshot.config.design.theme = theme.id;
      const html = siteDocument(
        snapshot,
        "papers/first/index.html",
        "First paper",
        "<p>Body</p>",
        snapshot.config.entries[0],
        catalog,
      );
      expect(html).toContain(`data-site-theme="${theme.id}"`);
      expect(html).toContain('aria-label="On this page"');
      expect(html).toContain("min read");
      expect(html).toContain('data-entry-id="' + catalog.entries[0].id + '"');
      expect(html).not.toContain("gtag/js");
    },
  );
  it("honors disabled TOC and statistics", () => {
    const { snapshot, catalog } = specimen();
    Object.assign(snapshot.config.design.reading, {
      toc: false,
      wordCount: false,
      readingTime: false,
    });
    const html = siteDocument(
      snapshot,
      "index.html",
      "Paper",
      "Body",
      snapshot.config.entries[0],
      catalog,
    );
    expect(html).not.toContain('class="site-reading-rail"');
    expect(html).not.toContain('class="article-reading-stats"');
  });
  it("renders an authenticated specimen without runtime tracking or source reads", async () => {
    const { config } = specimen();
    const html = await designPreview(
      new Request("http://localhost/", {
        method: "POST",
        body: JSON.stringify({ config, view: "article" }),
      }),
      randomUUID(),
    );
    expect(html).toContain("On clarity, structure and discovery");
    expect(html).toContain("/site/design-assets/site.css");
    expect(html).not.toContain("axiom-site-runtime");
    expect(html).toContain("mjx-container");
  });
  it("rejects preview asset path traversal and non-public file types", async () => {
    for (const path of [
      ["..", "sites.ts"],
      ["THIRD_PARTY_NOTICES.txt"],
      ["x", "..", "reader.js"],
    ])
      await expect(designAsset(path)).rejects.toThrow(
        "Preview asset not found",
      );
  });
});
describe("privacy-first analytics contracts", () => {
  it("starts disabled with no third-party ID and only accepts measurement IDs", () => {
    expect(siteAnalyticsSettingsSchema.parse({})).toEqual({
      enabled: false,
      publicViews: false,
      publicDownloads: false,
      publicSiteTotals: false,
      googleMeasurementId: "",
    });
    expect(
      siteAnalyticsSettingsSchema.safeParse({ googleMeasurementId: "<script>" })
        .success,
    ).toBe(false);
    expect(
      siteAnalyticsSettingsSchema.parse({ googleMeasurementId: "g-abc1234567" })
        .googleMeasurementId,
    ).toBe("G-ABC1234567");
  });
  it("rejects identifying fields and out-of-range events", () => {
    const event = {
      releaseId: randomUUID(),
      visitId: randomUUID(),
      page: "index.html",
    };
    expect(
      siteEventSchema.safeParse({ ...event, email: "private@example.org" })
        .success,
    ).toBe(false);
    for (const seconds of [-1, 1801])
      expect(siteEventSchema.safeParse({ ...event, seconds }).success).toBe(
        false,
      );
  });
  it("deduplicates cumulative and out-of-order metrics", () => {
    const event = siteEventSchema.parse({
      releaseId: randomUUID(),
      visitId: randomUUID(),
      page: "index.html",
      seconds: 12,
      depth: 95,
      downloads: 1,
    });
    expect(siteEventDelta(event)).toEqual({
      views: 1,
      engaged: 1,
      completed: 1,
      seconds: 12,
      downloads: 1,
      citations: 0,
      outbound: 0,
    });
    expect(Object.values(siteEventDelta(event, event))).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(
      siteEventDelta({ ...event, seconds: 8, downloads: 0 }, event).seconds,
    ).toBe(0);
  });
  it("keeps domains only and rejects paths, credentials, IPs and queries", () => {
    expect(normalizedReferrer("Research.Example.ORG")).toBe(
      "research.example.org",
    );
    for (const v of [
      "https://example.org/?private=1",
      "127.0.0.1",
      "user@example.org",
      "example.org/path",
      "localhost",
    ])
      expect(normalizedReferrer(v)).toBe("");
  });
  it("calculates an equal-length preceding comparison and bounds ranges", () => {
    expect(
      analyticsRange(
        new URLSearchParams("from=2026-09-01&to=2026-09-07"),
        new Date("2026-09-28"),
      ),
    ).toEqual({
      from: "2026-09-01",
      to: "2026-09-07",
      previousFrom: "2026-08-25",
    });
    for (const params of [
      "from=2026-09-10&to=2026-09-01",
      "from=2020-01-01&to=2026-09-01",
      "to=2099-01-01",
    ])
      expect(() => analyticsRange(new URLSearchParams(params))).toThrow();
  });
  it("does not widen the private or unconfigured publication CSP", () => {
    expect(analyticsCsp(false)).toBe(publicationCsp);
    expect(publicationCsp).not.toContain("google");
    expect(analyticsCsp(true)).toContain("https://www.googletagmanager.com");
    expect(analyticsCsp(true)).not.toContain("unsafe-eval");
  });
  it("does not collect local development traffic implicitly", () => {
    const old = process.env.APP_URL,
      flag = process.env.SITE_ANALYTICS_LOCAL_TEST;
    try {
      process.env.APP_URL = "http://localhost:8080";
      delete process.env.SITE_ANALYTICS_LOCAL_TEST;
      expect(collectionAllowed()).toBe(false);
      process.env.SITE_ANALYTICS_LOCAL_TEST = "1";
      expect(collectionAllowed()).toBe(true);
    } finally {
      if (old === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = old;
      if (flag === undefined) delete process.env.SITE_ANALYTICS_LOCAL_TEST;
      else process.env.SITE_ANALYTICS_LOCAL_TEST = flag;
    }
  });
});
