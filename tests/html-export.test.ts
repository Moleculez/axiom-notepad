import { expect, test } from "vitest";
import { htmlExport } from "../packages/shared/src/html-export";
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
