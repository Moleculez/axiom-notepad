import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import {
  defaultSiteConfig,
  publicationFileMime,
  siteConfigSchema,
  siteEntrySchema,
  sourceIds,
  type SiteSnapshot,
} from "../packages/shared/src/sites";
import {
  entryPath,
  tagPath,
  publicMarkdown,
  renderPublicResource,
  siteDocument,
  type PublicRenderContext,
} from "../packages/shared/src/site-render";
import { publicationPath } from "../packages/shared/src/site-http";
import { publicationHostname } from "../packages/shared/src/site-domains";
import { publicationSvg } from "../packages/shared/src/site-svg";

function fixture() {
  const id = randomUUID(),
    excluded = randomUUID();
  const config = defaultSiteConfig("A researcher’s notebook", true);
  config.entries = [
    siteEntrySchema.parse({
      id: randomUUID(),
      resourceId: id,
      kind: "post",
      title: "Reviewed note",
      slug: "reviewed-note",
    }),
    siteEntrySchema.parse({
      id: randomUUID(),
      resourceId: excluded,
      kind: "post",
      title: "Secret draft",
      slug: "secret",
      included: false,
    }),
  ];
  const snapshot: SiteSnapshot = {
    config,
    sources: [
      {
        id,
        name: "Reviewed note",
        format: "markdown",
        version: 1,
        body: "# Evidence",
      },
    ],
    references: {},
    createdAt: "2026-09-28T00:00:00Z",
  };
  const context: PublicRenderContext = {
    snapshot,
    assets: new Map(),
    warnings: new Set(),
  };
  return { id, excluded, config, snapshot, context };
}
describe("workspace website contracts", () => {
  it("routes inert SVG and text uploads only into controlled public renderers", () => {
    expect(publicationFileMime("figure.svg", "application/octet-stream")).toBe(
      "image/svg+xml",
    );
    expect(publicationFileMime("data.csv", "application/octet-stream")).toBe(
      "text/plain",
    );
    expect(
      publicationFileMime("payload.html", "application/octet-stream"),
    ).toBe("application/octet-stream");
    expect(publicationFileMime("fake.svg", "application/pdf")).toBe(
      "application/pdf",
    );
  });
  it("removes executable and external SVG content before rasterization", () => {
    const svg = publicationSvg(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><script>alert(1)</script><style>@import "file:///etc/passwd";</style><image href="https://tracker.example/a"/><foreignObject><div>private</div></foreignObject><path d="M0 0 L10 10" stroke="red" onclick="alert(1)"/><use href="file:///etc/passwd"/><rect fill="url(https://bad.example/x)"/></svg>',
      ),
    ).toString();
    expect(svg).toContain('stroke="red"');
    expect(svg).not.toMatch(
      /script|style|foreignObject|file:|https:|onclick|private/,
    );
    expect(() =>
      publicationSvg(
        Buffer.from(
          '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
        ),
      ),
    ).toThrow();
  });
  it("selects only explicit public sources and checks references", () => {
    const f = fixture();
    expect(sourceIds(f.config)).toEqual([f.id]);
    f.config.navigation = [{ label: "Missing", entryId: randomUUID() }];
    expect(siteConfigSchema.safeParse(f.config).success).toBe(false);
    f.config.navigation = [{ label: "Unsafe", url: "https://" }];
    expect(siteConfigSchema.safeParse(f.config).success).toBe(false);
    f.config.navigation = [];
    f.config.design.sections.push(f.config.design.sections[0]);
    expect(siteConfigSchema.safeParse(f.config).success).toBe(false);
  });
  it("rejects non-public domain input and path traversal", () => {
    expect(tagPath("../physics/量子")).not.toMatch(/\.\.|%|量/);
    expect(tagPath("a/b")).not.toBe(tagPath("a b"));
    for (const domain of [
      "localhost",
      "127.0.0.1",
      "https://example.org",
      "lab.internal",
      "a/b.org",
      "a..org",
      "*.example.org",
      "user@example.org",
    ])
      expect(() => publicationHostname(domain)).toThrow();
    expect(publicationHostname("LAB.Example.org")).toBe("lab.example.org");
    expect(publicationPath("../secret")).toBeNull();
    expect(publicationPath("x\\y")).toBeNull();
    expect(publicationPath("papers/research/")).toBe(
      "papers/research/index.html",
    );
  });
  it("escapes public metadata and omits private links/remote images", async () => {
    const f = fixture();
    const page = entryPath(f.config.entries[0]);
    const html = await publicMarkdown(
      `![tracking](https://tracker.example/x.png)\n\n[private](/api/v1/notes/${f.excluded})\n\n[escape](../../../../api/v1/notes/${f.excluded})\n\n[[Reviewed note]]\n\n<script>alert(1)</script>`,
      page,
      f.context,
    );
    expect(html).not.toContain('src="https://tracker');
    expect(html).not.toContain('href="/api');
    expect(html).not.toContain('href="../../../../api');
    expect(html).not.toContain("<script>");
    expect(html).toContain("Reviewed note");
    expect(f.context.warnings.size).toBeGreaterThan(0);
    f.snapshot.config.title = "</title><script>alert(1)</script>";
    const document = siteDocument(
      f.snapshot,
      page,
      "Public",
      html,
      f.config.entries[0],
    );
    expect(document).not.toContain("<script>alert");
    expect(document).not.toContain("Secret draft");
  });
  it("renders approved attachment links as copied public assets", async () => {
    const f = fixture(),
      asset = randomUUID();
    f.context.assets.set(asset, "assets/figure.png");
    const html = await publicMarkdown(
      `![Evidence](/api/v1/attachments/${asset})`,
      "posts/reviewed-note/index.html",
      f.context,
    );
    expect(html).toContain('src="../../assets/figure.png"');
    expect(html).not.toContain("/api/v1/");
  });
  it("omits hidden workbook sheets, rows, columns and formulas from public HTML", async () => {
    const f = fixture(),
      book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet("Public results");
    sheet.getCell("A1").value = "Visible result";
    sheet.getCell("B1").value = "HIDDEN COLUMN";
    sheet.getColumn(2).hidden = true;
    sheet.getCell("A2").value = "HIDDEN ROW";
    sheet.getRow(2).hidden = true;
    sheet.getCell("A3").value = {
      formula: 'CONCAT("FORMULA SECRET")',
      result: "Approved cached result",
    };
    const hidden = book.addWorksheet("HIDDEN SHEET", { state: "hidden" });
    hidden.getCell("A1").value = "PRIVATE";
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    const html = await renderPublicResource(
      {
        id: randomUUID(),
        name: "Results.xlsx",
        version: 1,
        format: "file",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      "index.html",
      f.context,
      async () => bytes,
    );
    expect(html).toContain("Visible result");
    expect(html).toContain("Approved cached result");
    expect(html).not.toMatch(/HIDDEN|FORMULA SECRET|PRIVATE/);
  });
});
