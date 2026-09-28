import { describe, expect, it } from "vitest";
import {
  docArticles,
  docSections,
  docRoute,
  searchDocumentation,
} from "../packages/shared/src/documentation";
import { guideBodies } from "../apps/web/content/doc-articles";
import { tabRoute, tabTitle } from "../packages/shared/src/application-tabs";
import { workspaceLocation } from "../packages/shared/src/workspace-location";
import { parseMarkdown, renderDocument } from "../packages/markdown/src/index";
describe("bundled product documentation", () => {
  it("shows math syntax literally rather than consuming the delimiters", () => {
    const html = renderDocument(
      parseMarkdown(guideBodies["editor/math"].markdown),
      {},
    );
    expect(html).toContain("<code>$...$</code>");
    expect(html).toContain("<code>\\(...\\)</code>");
  });
  it("has a unique complete catalogue with valid examples and heading anchors", () => {
    expect(new Set(docArticles.map((a) => a.id)).size).toBe(docArticles.length);
    expect(Object.keys(guideBodies).sort()).toEqual(
      docArticles.map((a) => a.id).sort(),
    );
    for (const article of docArticles) {
      expect(docSections.some(([id]) => id === article.section)).toBe(true);
      const body = guideBodies[article.id],
        parsed = parseMarkdown(body.markdown);
      expect(parsed.outline.length).toBeGreaterThan(1);
      expect(new Set(parsed.outline.map((h) => h.id)).size).toBe(
        parsed.outline.length,
      );
      if (article.playground === "editor")
        expect(body.sample?.length).toBeGreaterThan(10);
      expect(
        tabRoute(
          "/workbench" + docRoute(article.id) + "#" + parsed.outline[0].id,
        ),
      ).toBe(docRoute(article.id) + "#" + parsed.outline[0].id);
      expect(tabTitle(docRoute(article.id))).toBe(article.title);
    }
  });
  it("searches feature terms and resolves sensible breadcrumb parents", () => {
    expect(searchDocumentation("latex").map((a) => a.id)).toContain(
      "editor/math",
    );
    expect(searchDocumentation("nonsensicalquery")).toEqual([]);
    const loc = workspaceLocation({ route: "/docs/editor/math" });
    expect(loc.up).toBe("/docs/editor");
    expect(loc.crumbs.map((c) => c.label)).toEqual([
      "Docs",
      "Markdown editor",
      "Mathematics & research callouts",
    ]);
    expect(tabRoute("/research/references?group=123")).toBe(
      "/research?groupId=123&view=library",
    );
    expect(tabRoute("/research?group=123&groupId=456")).toBe(
      "/research?groupId=456",
    );
  });
});
