import { afterEach, expect, test, vi } from "vitest";
import { openExternalEditorLink } from "../apps/web/lib/editor-links";
import { nativeCompletions } from "../apps/web/lib/native-editor/completions";
import { editorDefaults } from "../packages/shared/src/editor";
import { parseMarkdown } from "../packages/markdown/src/parser";
import { renderDocument } from "../packages/markdown/src/render";

afterEach(() => vi.unstubAllGlobals());

test("note references preserve their labels and identify resolved and unresolved targets", () => {
  const parsed = parseMarkdown(
    "[[research|A derivation]] and [[Missing note]].",
  );
  const html = renderDocument(parsed, {
    resolveLink: (target) =>
      target === "research"
        ? { href: "/workbench/notes/research", title: "Research & methods" }
        : undefined,
  });
  expect(html).toContain(
    'class="wiki-link" href="/workbench/notes/research" data-note-target="research" title="Linked note: Research &amp; methods">A derivation</a>',
  );
  expect(html).toContain(
    'class="wiki-link unresolved" href="#" data-note-target="Missing note" title="Unresolved note: Missing note">Missing note</a>',
  );
  // Icons are presentation only, never generated text inside a copied link.
  expect(html).not.toContain("<svg");
  expect(html).not.toContain("<img");
});

test("bare imported note identities show resolved file names without changing explicit aliases or source", () => {
  const id = "12345678-1234-1234-1234-123456789abc",
    source = `[[${id}]] [[${id}#Methods]] [[${id}|My label]] [[${id}|${id}]]`,
    parsed = parseMarkdown(source),
    before = structuredClone(parsed);
  const html = renderDocument(parsed, {
    resolveLink: (target) => ({
      href: `/workbench/notes/${target}`,
      title: "Research & methods",
    }),
  });
  expect(html).toContain(
    `data-note-target="${id}" title="Linked note: Research &amp; methods">Research &amp; methods</a>`,
  );
  expect(html).toContain(
    `data-note-target="${id}#Methods" title="Linked note: Research &amp; methods">Research &amp; methods</a>`,
  );
  expect(html).toContain(
    `data-note-target="${id}" title="Linked note: Research &amp; methods">My label</a>`,
  );
  expect(html).toContain(
    `data-note-target="${id}" title="Linked note: Research &amp; methods">${id}</a>`,
  );
  expect(parsed.links.map((link) => link.target)).toEqual([
    id,
    `${id}#Methods`,
    id,
    id,
  ]);
  expect(parsed).toEqual(before);
  const missing = renderDocument(parseMarkdown(`[[${id}]]`), {
    resolveLink: () => undefined,
  });
  expect(missing).toContain('class="wiki-link unresolved"');
  expect(missing).toContain(`title="Unresolved note: ${id}">${id}</a>`);
});

test("note-link descriptions escape names rather than introducing HTML or unsafe URLs", () => {
  const html = renderDocument(parseMarkdown("[[note|label]]"), {
    resolveLink: () => ({
      href: "javascript:alert(1)",
      title: '\"><img src=x onerror=alert(1)>',
    }),
  });
  expect(html).toContain('href=""');
  expect(html).toContain(
    'title="Linked note: &quot;&gt;&lt;img src=x onerror=alert(1)&gt;"',
  );
  expect(html).not.toContain("<img");
});

test.each([
  "https://example.org/paper?q=a&b=c#result",
  "http://localhost:8080/workbench",
  "HTTPS://EXAMPLE.ORG/paper",
  "mailto:researcher@example.org?subject=Results",
])("external links open once with no opener: %s", (href) => {
  const open = vi.fn();
  vi.stubGlobal("window", { open });
  expect(openExternalEditorLink(href)).toBe(true);
  expect(open).toHaveBeenCalledExactlyOnceWith(
    new URL(href).href,
    "_blank",
    "noopener,noreferrer",
  );
});

test.each([
  "",
  "javascript:alert(1)",
  "java\nscript:alert(1)",
  "data:text/html,<h1>Unsafe</h1>",
  "file:///tmp/private",
  "//example.org",
  "\\\\example.org",
  "vbscript:msgbox(1)",
  "custom:application",
  "https://[invalid",
])("unsafe or malformed destinations never navigate: %s", (href) => {
  const open = vi.fn();
  vi.stubGlobal("window", { open });
  expect(openExternalEditorLink(href)).toBe(true);
  expect(open).not.toHaveBeenCalled();
});

test.each([
  "#results",
  "Research paper",
  "12345678-1234-1234-1234-123456789abc#result",
  "/api/v1/attachments/12345678-1234-1234-1234-123456789abc#page=2",
])("local destinations remain with the workspace router: %s", (href) => {
  expect(openExternalEditorLink(href)).toBe(false);
});

test.each(["image", "attachment", "file", "upload", "pdf"])(
  "slash /%s offers the host attachment picker",
  (query) => {
    const source = "> /" + query;
    expect(
      nativeCompletions(source, source.length, editorDefaults, {}, []),
    ).toContainEqual({
      label: "Image or attachment",
      command: "attachment",
      from: 2,
      to: source.length,
    });
  },
);
