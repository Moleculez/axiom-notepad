import { afterEach, expect, test, vi } from "vitest";
import { openExternalEditorLink } from "../apps/web/lib/editor-links";
import { nativeCompletions } from "../apps/web/lib/native-editor/completions";
import { editorDefaults } from "../packages/shared/src/editor";

afterEach(() => vi.unstubAllGlobals());

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
