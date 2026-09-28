import { describe, expect, it } from "vitest";
import { parseMarkdown, renderDocument } from "../packages/markdown/src/index";
import {
  editLinkDefinition,
  linkDefinitionModel,
  linkDefinitionUses,
} from "../packages/editor/src/link-definitions";
import { applyChanges } from "../packages/editor/src/transactions";

function fixture(source: string) {
  const parsed = parseMarkdown(source);
  const node = parsed.definitions!.find(
    (n) => n.type === "referenceDefinition",
  )!;
  return { parsed, node, model: linkDefinitionModel(source, node)! };
}
describe("rich link definition source edits", () => {
  it.each([
    '[paper]: https://example.org "Paper"\n',
    "  [paper]:\r\n  <https://example.org/a b>\r\n  'Paper'  \r\n",
    "[paper]: https://example.org/a(b) (Paper)\n",
    "[paper]: <>\n",
    '[paper]: </a b> "A \\"title\\" &amp; more"\n',
  ])("identifies exact ranges without normalizing %s", (source) => {
    const { model, parsed, node } = fixture(source);
    expect(model.key.value).toBe("paper");
    for (const field of ["key", "href", "title"] as const) {
      expect(model[field].from).toBeLessThanOrEqual(model[field].to);
      expect(
        editLinkDefinition(source, parsed, node, field, model[field].value),
      ).toEqual({ changes: [] });
    }
  });
  it("edits just the URL while preserving CRLF, angle brackets and title quotes", () => {
    const source =
      "  [paper]:\r\n  <https://old.org>\r\n  'A title'  \r\n\r\nAfter\r\n";
    const { parsed, node } = fixture(source);
    const edit = editLinkDefinition(
      source,
      parsed,
      node,
      "href",
      "https://new.org/a b?x=1&name=α",
    );
    expect(edit.error).toBeUndefined();
    expect(applyChanges(source, edit.changes!)).toBe(
      source.replace("https://old.org", "https://new.org/a b?x=1&amp;name=α"),
    );
  });
  it.each([
    "",
    'A "title" & research',
    "An (embedded) title",
    "Chinese 中文\nالعربية",
    "\\alpha &copy;",
  ])("round-trips title %j", (title) => {
    const source = "[paper]: /paper (old)\r\n\r\nAfter";
    const { parsed, node } = fixture(source);
    const edit = editLinkDefinition(source, parsed, node, "title", title);
    expect(edit.error).toBeUndefined();
    const next = applyChanges(source, edit.changes!);
    expect(fixture(next).node.title ?? "").toBe(title);
    expect(next.endsWith("\r\n\r\nAfter")).toBe(true);
    expect(next).not.toMatch(/(?<!\r)\n/);
  });
  it("adds and removes a title without consuming the following paragraph", () => {
    let source = "[paper]: /paper\n\nAfter";
    let f = fixture(source);
    source = applyChanges(
      source,
      editLinkDefinition(source, f.parsed, f.node, "title", "Paper").changes!,
    );
    expect(source).toBe('[paper]: /paper "Paper"\n\nAfter');
    f = fixture(source);
    expect(
      applyChanges(
        source,
        editLinkDefinition(source, f.parsed, f.node, "title", "").changes!,
      ),
    ).toBe("[paper]: /paper\n\nAfter");
  });
  it("renames full, collapsed, shortcut, image and footnote uses but leaves literals alone", () => {
    const source =
      '[text][Paper] [paper][] [paper] ![image][paper] [inline](/paper)\n\n`[paper]` \\[paper] [^a]\n\n[^a]: [footnote][paper]\n\n[paper]: /paper "Title"\n';
    const { parsed, node } = fixture(source);
    expect(linkDefinitionUses(source, parsed).get("paper")).toHaveLength(5);
    const edit = editLinkDefinition(source, parsed, node, "key", "research");
    expect(edit.changes).toHaveLength(6);
    const next = applyChanges(source, edit.changes!);
    expect(next).toContain(
      "[text][research] [paper][research] [paper][research] ![image][research]",
    );
    expect(next).toContain("`[paper]` \\[paper]");
    expect(next).toContain("[footnote][research]");
    expect(renderDocument(parseMarkdown(next))).toBe(renderDocument(parsed));
  });
  it("rejects duplicate IDs including case and whitespace variants", () => {
    const source = "[paper]: /a\n[My   Paper]: /b\n";
    const { parsed, node } = fixture(source);
    expect(
      editLinkDefinition(source, parsed, node, "key", " my paper ").error,
    ).toContain("already");
  });
  it.each(["", " ", "bad[id", "^footnote", "two\nlines", "a".repeat(1000)])(
    "rejects invalid ID %j",
    (key) => {
      const source = "[paper]: /a";
      const { parsed, node } = fixture(source);
      expect(
        editLinkDefinition(source, parsed, node, "key", key).error,
      ).toBeTruthy();
    },
  );
  it.each([
    "javascript:alert(1)",
    "data:text/html,hi",
    "//remote.test",
    "file:///secret",
    "http://a\n[bad]: /url",
  ])("rejects unsafe destination %s", (href) => {
    const source = "[paper]: /a";
    const { parsed, node } = fixture(source);
    expect(
      editLinkDefinition(source, parsed, node, "href", href).error,
    ).toBeTruthy();
  });
  it.each([
    "",
    "#heading",
    "../notes/a b.md",
    "https://x.org/(paper)?a=1&copy;=2",
    "mailto:research@example.org",
  ])("round-trips destination %j", (href) => {
    const source = "[paper]: /a";
    const { parsed, node } = fixture(source);
    const edit = editLinkDefinition(source, parsed, node, "href", href);
    expect(edit.error).toBeUndefined();
    expect(fixture(applyChanges(source, edit.changes!)).node.href).toBe(href);
  });
});
