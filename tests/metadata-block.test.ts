import { expect, test } from "vitest";
import {
  metadataModel,
  parseMarkdown,
  renderDocument,
  sourceCommand,
} from "../packages/markdown/src/index";
import { applyChanges } from "../packages/editor/src/transactions";
import { projectMarkdown } from "../packages/editor/src/projection";
test("metadata ranges preserve comments, complex YAML and CRLF", () => {
  const source =
    "---\r\n# retain\r\ntitle: Research # title\r\nauthors:\r\n  - Ada\r\n  - Emmy\r\ntags: [math, ai]\r\n---\r\n\r\nBody";
  const node = parseMarkdown(source).ast.children![0];
  const model = metadataModel(source, node)!;
  expect(
    model.properties.map((property) => [property.key, property.complex]),
  ).toEqual([
    ["title", false],
    ["authors", true],
    ["tags", false],
  ]);
  const title = model.properties[0];
  expect(
    applyChanges(source, [
      { from: title.valueFrom, to: title.valueTo, insert: "New title" },
    ]),
  ).toBe(source.replace("Research # title", "New title"));
  expect(model.ending).toBe("\r\n");
  expect(model.properties[1].value).toBe("\r\n  - Ada\r\n  - Emmy");
});
test.each(["[TOC]\n\n# Study", "---\ntitle: Research\n---\n\nBody"])(
  "TOC and metadata never become source prose while focused",
  (source) => {
    const kind = source.startsWith("[TOC]") ? "toc" : "frontmatter";
    for (const at of [0, 3, 5]) {
      const p = projectMarkdown(source, {
        proseSource: true,
        reveal: true,
        selection: { anchor: at, head: at },
      });
      expect(p.activeProse).toEqual([]);
      expect(p.doc.firstChild?.attrs.kind).toBe(kind);
      p.doc.check();
    }
  },
);
test("TOC and metadata can be inserted and are safely rendered", () => {
  const edit = sourceCommand("metadata", "/metadata", 0, 9)!;
  const source = applyChanges("/metadata", edit.changes);
  expect(source).toBe("---\ntitle: Untitled\ntags: []\n---\n\n");
  expect(renderDocument(parseMarkdown(source))).toContain(
    '<table aria-label="Document metadata">',
  );
  expect(
    renderDocument(parseMarkdown("---\ntitle: <script>alert(1)</script>\n---")),
  ).not.toContain("<script>");
  expect(sourceCommand("toc", "", 0, 0)?.changes[0].insert).toBe("[TOC]\n\n");
});
