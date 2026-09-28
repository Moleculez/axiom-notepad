import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  parseMarkdown,
  renderDocument,
  mediaMarkdown,
  mediaMetadata,
  documentAssets,
} from "../packages/markdown/src";
import { projectMarkdown } from "../packages/editor/src/projection";
import { InsertionSessions } from "../packages/editor/src/insertion-sessions";
import {
  insertMediaMarkdown,
  defaultMediaOptions,
} from "../apps/web/lib/media-insertion";
const version = "11111111-1111-4111-8111-111111111111";
const href = `/api/v1/attachments/${version}`;
describe("portable media", () => {
  test("figures preserve Markdown, immutable identities, captions, and numbering", () => {
    const source =
      mediaMarkdown(
        `![Spectrum](${href})`,
        { v: 1, display: "figure", label: "fig-spectrum", width: 75 },
        "Energy **response** $E=mc^2$.",
      ) + "\n\nSee [Figure](#fig-spectrum).";
    const parsed = parseMarkdown(source);
    expect(parsed.ast.children?.[0].type).toBe("media");
    expect(parsed.figures).toEqual({ "fig-spectrum": 1 });
    expect(
      documentAssets(parsed).find((asset) => asset.versionId)?.versionId,
    ).toBe(version);
    const html = renderDocument(parsed);
    expect(html).toContain('id="fig-spectrum"');
    expect(html).toContain("Figure 1.</span>");
    expect(html).toContain(">Figure 1</a>");
    expect(html).toContain("<strong>response</strong>");
    expect(html).not.toContain("axiom-media {");
  });
  test("malformed wrappers do not capture the next block or lose source", () => {
    const source =
      '<!-- axiom-media {"v":1,"display":"figure","width":999} -->\n\n![A](/a)\n\n# Following';
    const parsed = parseMarkdown(source);
    expect(parsed.ast.children?.some((node) => node.type === "media")).toBe(
      false,
    );
    expect(parsed.outline[0].text).toBe("Following");
    expect(
      parsed.diagnostics.some((item) => /media wrapper/.test(item.message)),
    ).toBe(true);
    expect(mediaMetadata({ v: 1, display: "image", onclick: "x" })).toBeNull();
  });
  test("duplicate and missing figure labels are diagnosed", () => {
    const figure = mediaMarkdown("![A](/a)", {
      v: 1,
      display: "figure",
      label: "fig-a",
    });
    const parsed = parseMarkdown(
      figure + "\n\n" + figure + "\n\n[Figure](#fig-missing)",
    );
    expect(parsed.figures).toEqual({ "fig-a": 1 });
    expect(parsed.diagnostics).toHaveLength(2);
  });
  test("media caption and surrounding text have stable editable source maps", () => {
    const source =
      mediaMarkdown(
        `![A](${href})`,
        { v: 1, display: "figure", label: "fig-a" },
        "A caption",
      ) + "\n\nAfter";
    const at = source.indexOf("caption") + 3;
    const projection = projectMarkdown(source, {
      proseSource: true,
      reveal: true,
      selection: { anchor: at, head: at },
    });
    expect(projection.doc.firstChild?.type.name).toBe("media");
    expect(() => projection.doc.check()).not.toThrow();
    expect(projection.map.sourceAt(projection.map.positionAt(at))).toBe(at);
    expect(projection.doc.textContent).toContain("A caption");
  });
  test("preview media loads only internal attachments, never export iframes", () => {
    const source = mediaMarkdown(`[Paper](${href}#page=3)`, {
      v: 1,
      display: "preview",
      mime: "application/pdf",
    });
    expect(renderDocument(parseMarkdown(source), { visuals: true })).toContain(
      "<iframe",
    );
    expect(renderDocument(parseMarkdown(source))).not.toContain("<iframe");
    expect(
      renderDocument(
        parseMarkdown(source.replace(href, "https://example.test/private")),
        { visuals: true },
      ),
    ).not.toContain("<iframe");
  });
  test("insertion safely escapes labels and pins media timestamps", () => {
    const source = insertMediaMarkdown("x]y.mp4", href, "video/mp4", {
      ...defaultMediaOptions,
      display: "preview",
      time: 42,
    });
    expect(parseMarkdown(source).ast.children?.[0].type).toBe("media");
    expect(documentAssets(parseMarkdown(source))[0].node.href).toBe(
      href + "#t=42",
    );
  });
});
describe("asynchronous insertion intentions", () => {
  test("independent sessions follow peer edits and preserve their own selection", () => {
    const doc = new Y.Doc(),
      text = doc.getText("markdown"),
      sessions = new InsertionSessions();
    text.insert(0, "Start /image end");
    const a = sessions.create(doc, 6, 12),
      b = sessions.create(doc, 15, 15);
    text.insert(0, "Peer ");
    expect(sessions.resolve(a, doc)).toEqual({ from: 11, to: 17 });
    expect(sessions.resolve(b, doc)).toEqual({ from: 20, to: 20 });
    text.delete(11, 6);
    expect(sessions.resolve(a, doc)).toBeNull();
    sessions.cancel(a);
    sessions.clear();
    doc.destroy();
  });
  test("deleted empty anchors, changed documents, and cancelled intentions never insert", () => {
    const doc = new Y.Doc(),
      text = doc.getText("markdown"),
      sessions = new InsertionSessions();
    text.insert(0, "alpha\n\nbeta");
    const id = sessions.create(doc, 8, 8);
    text.delete(7, 4);
    expect(sessions.resolve(id, doc)).toBeNull();
    expect(sessions.resolve(id, new Y.Doc())).toBeNull();
    sessions.cancel(id);
    expect(sessions.resolve(id, doc)).toBeNull();
    doc.destroy();
  });
});
