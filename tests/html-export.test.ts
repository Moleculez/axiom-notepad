import { expect, test } from "vitest";
import {
  htmlExport,
  renderHtmlExport,
} from "../packages/shared/src/html-export";
import {
  defaultDocumentExportOptions,
  documentExportOptionsSchema,
  markdownExportAssetIds,
  exportFilename,
} from "../packages/shared/src/document-export";
import { readingBlockKey } from "../apps/web/lib/reading-dom";
import { abortable } from "../apps/web/lib/document-export";
import { defaults } from "../packages/shared/src/appearance";
import { applyDocumentStyle } from "../packages/shared/src/editor-looks";

test("HTML exports embed the shared task layout without external styles", async () => {
  const html = await htmlExport(
    "- [ ] Verify units\n  - [x] Confirm assumptions",
    "Checklist",
    {},
    async () => undefined,
  );
  expect(html).toContain("align-items: first baseline");
  expect(html).toContain("--task-size: 0.85em");
  expect(html.match(/class="document-task"/g)).toHaveLength(2);
  expect(html).toContain('aria-label="Completed task"');
  expect(html).not.toContain('<link rel="stylesheet"');
});

test("snapshot presentation is bounded and prints light paper without scripts or remote dependencies", async () => {
  const result = await renderHtmlExport(
    "# Findings\n\n![Remote](https://example.invalid/tracker.png)\n\n<script>alert(1)</script>",
    "<unsafe title>",
    {},
    async () => undefined,
    defaults,
    {
      ...defaultDocumentExportOptions,
      title: false,
      toc: true,
      colors: "paper",
      paper: "Letter",
      orientation: "landscape",
      margin: 16,
    },
  );
  expect(result.html).toContain('aria-label="Table of contents"');
  expect(result.html).toContain('href="#findings"');
  expect(result.html).toContain("@page{size:Letter landscape;margin:16mm}");
  expect(result.html).toContain("base-uri 'none'");
  expect(result.html).not.toContain("<header>");
  expect(result.html).not.toContain("<script>");
  expect(result.html).not.toContain('src="https:');
  expect(result.warnings).toHaveLength(1);
  expect(documentExportOptionsSchema.safeParse({ margin: -1 }).success).toBe(
    false,
  );
  expect(
    documentExportOptionsSchema.safeParse({ paper: "A4; url(evil)" }).success,
  ).toBe(false);
});

test("images embed once per authorized version and inaccessible images become visible warnings", async () => {
  let reads = 0;
  const id = "12345678-1234-1234-1234-123456789012";
  const result = await renderHtmlExport(
    `![One](/api/v1/attachments/${id})\n\n![Two](/api/v1/attachments/${id})`,
    "Images",
    {},
    async () => {
      reads++;
      return { mime: "image/png", data: new Uint8Array([1, 2, 3]) };
    },
  );
  expect(reads).toBe(1);
  expect(result.html.match(/src="data:image\/png/g)).toHaveLength(2);
  expect(result.html.match(/loading="eager"/g)).toHaveLength(2);
  expect(result.warnings).toEqual([]);
  const missing = await renderHtmlExport(
    `![Missing](/api/v1/attachments/${id})`,
    "Images",
    {},
    async () => undefined,
  );
  expect(missing.html).toContain("export-missing-image");
  expect(missing.warnings).toHaveLength(1);
});

test("bundle references come from parsed links, images and footnotes, not literal source examples", () => {
  const a = "12345678-1234-1234-1234-123456789012",
    b = "12345678-1234-1234-1234-123456789013",
    c = "12345678-1234-1234-1234-123456789014";
  const source = `![Figure][fig]\n\n[fig]: /api/v1/attachments/${a}\n\nNote[^a]\n\n[^a]: [Data](/api/v1/attachments/${b})\n\n\`\`\`md\n![Example](/api/v1/attachments/${c})\n\`\`\``;
  expect(markdownExportAssetIds(source)).toEqual([a, b]);
  expect(exportFilename("../A/B", "html")).toBe("__A_B.html");
});

test("reading identity ignores position shifts but not content or semantic anchors", () => {
  expect(
    readingBlockKey('<p data-reading-from="0" data-reading-to="4">same</p>'),
  ).toBe(
    readingBlockKey('<p data-reading-from="20" data-reading-to="24">same</p>'),
  );
  expect(readingBlockKey('<h2 id="one">Title</h2>')).not.toBe(
    readingBlockKey('<h2 id="two">Title</h2>'),
  );
});

test("export preparation handles cancellation and late failures without an unhandled rejection", async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(
    abortable(Promise.reject(new Error("late failure")), abort.signal),
  ).rejects.toThrow();
  await expect(
    abortable(new Promise(() => {}), new AbortController().signal, 1),
  ).rejects.toThrow("timed out");
});

test("standalone attachment links retain their server address without rewriting source examples", async () => {
  const path = "/api/v1/attachments/12345678-1234-1234-1234-123456789012";
  const html = await htmlExport(
    `[Data](${path})\n\n\`[Data](${path})\``,
    "Links",
    {},
    async () => undefined,
    undefined,
    undefined,
    "https://research.example",
  );
  expect(html).toContain(`href="https://research.example${path}"`);
  expect(html).toContain(`<code>[Data](${path})</code>`);
});

test("personal LaTeX export embeds four local faces and keeps standard export opt-in", async () => {
  const source =
    "# A result\n\n**Strong**, *emphasized*, and ***both***.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
  const standard = await htmlExport(
    source,
    "A result",
    {},
    async () => undefined,
  );
  expect(standard).not.toContain("Axiom Latin Modern");
  expect(standard).not.toContain('content: "§ ');
  const preferences = applyDocumentStyle(defaults, "latexArticle");
  const personal = await htmlExport(
    source,
    "A result",
    {},
    async () => undefined,
    preferences,
  );
  expect(personal.match(/font-family: "Axiom Latin Modern"/g)).toHaveLength(4);
  expect(personal).toContain("GUST Font License");
  expect(personal).toContain("data:font/woff2;base64,");
  expect(personal).not.toContain('url("./axiom-lm-');
  expect(personal).toContain('font-family:"Axiom Latin Modern"');
  expect(personal).toContain("font-size:19px");
  expect(personal).toContain("line-height:1.65");
  expect(personal).toContain("<strong>");
  expect(personal).toContain("<table");
  expect(personal).toContain('data-document-decorations="latex"');
  expect(personal).toContain('content: "§ " attr(data-section-number) / ""');
  expect(personal).toContain('data-section-number="1"');
  expect(personal).toContain('<main class="prose">');
  expect(personal).toContain("border-block-end: 1px solid");
});
