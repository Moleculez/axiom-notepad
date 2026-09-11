import { expect, test } from "vitest";
import {
  documentIndex,
  parseMarkdown,
  renderDocument,
  sectionNumbers,
} from "../packages/markdown/src";
import { projectMarkdown } from "../packages/editor/src/projection";

test("sections follow heading ancestry and reset child counters at each sibling", () => {
  const doc = parseMarkdown("# A\n\n## B\n\n### C\n\n## D\n\n# E\n\n## F");
  expect([...sectionNumbers(doc.outline).values()]).toEqual([
    "1",
    "1.1",
    "1.1.1",
    "1.2",
    "2",
    "2.1",
  ]);
  expect(documentIndex(doc).sections).toEqual(sectionNumbers(doc.outline));
  expect(documentIndex(doc)).toBe(documentIndex(doc));
});

test("skipped levels and late starting headings create no phantom parents", () => {
  const doc = parseMarkdown(
    "## A\n\n#### B\n\n###### C\n\n### D\n\n# E\n\n### F",
  );
  expect([...sectionNumbers(doc.outline).values()]).toEqual([
    "1",
    "1.1",
    "1.1.1",
    "1.2",
    "2",
    "2.1",
  ]);
  expect([...sectionNumbers([])]).toEqual([]);
});

test("numbering includes real nested and setext headings, but never fenced or escaped hashes", () => {
  const doc = parseMarkdown(
    "A\n=\n\n> ## B\n\n- ### C\n\n```md\n# Not a heading\n```\n\n\\# Also not a heading\n\n## D",
  );
  expect([...sectionNumbers(doc.outline).values()]).toEqual([
    "1",
    "1.1",
    "1.1.1",
    "1.2",
  ]);
});

test("duplicate heading names retain their existing IDs, TOC labels and source ranges", () => {
  const doc = parseMarkdown("[TOC]\n\n# Same\n\n## Same\n\n## Same");
  const before = structuredClone(doc);
  const html = renderDocument(doc);
  expect([...documentIndex(doc).sections]).toEqual([
    ["same", "1"],
    ["same-1", "1.1"],
    ["same-2", "1.2"],
  ]);
  expect(html).toContain('id="same-2" data-section-number="1.2"');
  expect(html).toContain(
    'href="#same-2" style="margin-inline-start:16px">Same</a>',
  );
  expect(html).not.toContain("§");
  expect(doc).toEqual(before);
});

test("fragment rendering uses the whole document index and leaves conformance HTML exact", () => {
  const doc = parseMarkdown("# A\n\n## B\n\n## C");
  const node = doc.ast.children!.at(-1)!;
  const fragment = {
    ...doc,
    ast: { ...doc.ast, children: [node] },
    outline: [doc.outline.at(-1)!],
  };
  expect(renderDocument(fragment, { document: doc, fragment: true })).toContain(
    'data-section-number="1.2"',
  );
  expect(renderDocument(doc, { conformance: true })).toBe(
    "<h1>A</h1>\n<h2>B</h2>\n<h2>C</h2>\n",
  );
});

test("active nested headings retain only their canonical identity as view metadata", () => {
  const source = "# A\n\n> ## B\n\n> ## C";
  const at = source.indexOf("B");
  const projection = projectMarkdown(source, {
    proseSource: true,
    reveal: true,
    selection: { anchor: at, head: at },
  });
  const node = projection.blocks.find(
    (b) => b.node.type === "sourceProse" && b.node.kind === "heading",
  )!.node;
  expect(node.key).toBe("b");
  expect(documentIndex(projection.parsed).sections.get(node.key!)).toBe("1.1");
  expect(projection.source).toBe(source);
  expect(projection.doc.toJSON()).not.toHaveProperty("data-section-number");
});
