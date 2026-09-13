import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createMarkAnchor,
  resolveAnchor,
} from "../packages/editor/src/annotations";
import { readingBlocks } from "../packages/editor/src/reading-marks";
import { parseMarkdown, renderDocument } from "../packages/markdown/src/index";
import {
  commentContentPatch,
  type NoteComment,
  commentCreateSchema,
  commentPatchSchema,
  markAnchorSchema,
  visibleThread,
} from "../packages/shared/src/note-comments";
import {
  defaults,
  preferencesSchema,
  appearanceForClient,
  APPEARANCE_SCHEMA_HEADER,
  APPEARANCE_SCHEMA,
} from "../packages/shared/src/appearance";
import { readingDataSchema } from "../packages/shared/src/research";

describe("reading marks", () => {
  it.each(["\n", "\r\n"])(
    "anchors retain text identity, not line numbers (%j)",
    (eol) => {
      const doc = new Y.Doc(),
        text = doc.getText("markdown");
      text.insert(0, `Intro${eol}${eol}> An observation${eol}> Context`);
      const from = text.toString().indexOf("> An"),
        anchor = createMarkAnchor(
          doc,
          1,
          from,
          text.length,
          "block",
          "blockquote",
        )!;
      text.insert(0, `Before${eol}`);
      expect(resolveAnchor(doc, 1, anchor)).toEqual({
        from: from + 7 + (eol.length - 1),
        to: text.length,
      });
      const resolved = resolveAnchor(doc, 1, anchor)!;
      text.delete(resolved.from, resolved.to - resolved.from);
      expect(resolveAnchor(doc, 1, anchor)).toBeNull();
      expect(resolveAnchor(doc, 2, anchor)).toBeNull();
      doc.destroy();
    },
  );
  it("supports point anchors in an empty document without a source edit", () => {
    const doc = new Y.Doc();
    const anchor = createMarkAnchor(doc, 1, 0, 0, "point")!;
    expect(resolveAnchor(doc, 1, anchor)).toEqual({ from: 0, to: 0 });
    expect(doc.getText("markdown").length).toBe(0);
    doc.getText("markdown").insert(0, "αβ");
    expect(resolveAnchor(doc, 1, anchor)?.from).toBe(2);
    doc.destroy();
  });
  it("rejects malformed ranges and generation identities", () => {
    const doc = new Y.Doc();
    doc.getText("markdown").insert(0, "abc");
    expect(createMarkAnchor(doc, 1, -1, 4)).toBeNull();
    expect(createMarkAnchor(doc, 1, 2, 1)).toBeNull();
    expect(() =>
      markAnchorSchema.parse({ start: [], end: [], generation: 1, quote: "" }),
    ).toThrow();
    doc.destroy();
  });
  it("keeps nested containers and leaf targets", () => {
    const blocks = readingBlocks(
      parseMarkdown(
        "- Parent\n  - Child\n\n> Quote\n\n```py\nx=1\n```\n\n[^a]: Footnote\n\n    Context",
      ),
    );
    expect(blocks.map((b) => b.type)).toEqual(
      expect.arrayContaining([
        "list",
        "item",
        "paragraph",
        "blockquote",
        "codeBlock",
        "footnoteDefinition",
      ]),
    );
  });
  it("adds opt-in reading geometry without changing exported or conformance HTML", () => {
    const doc = parseMarkdown("# Title\n\n- One\n- [ ] Two\n\n$$\nx^2\n$$");
    expect(renderDocument(doc)).not.toContain("data-reading-");
    expect(renderDocument(doc, { blockMarks: true })).toContain(
      'data-reading-type="item"',
    );
    expect(renderDocument(doc, { blockMarks: true })).toContain(
      'data-reading-type="mathBlock"',
    );
    expect(renderDocument(doc, { conformance: true, blockMarks: true })).toBe(
      renderDocument(doc, { conformance: true }),
    );
    const footnote = parseMarkdown("Reference[^a].\n\n[^a]: Observation");
    expect(renderDocument(footnote, { blockMarks: true })).toContain(
      'data-reading-type="footnoteDefinition"',
    );
  });
  it("does not retry acknowledged content when JSONB reorders anchor fields", () => {
    const doc = new Y.Doc();
    doc.getText("markdown").insert(0, "Observation");
    const anchor = createMarkAnchor(doc, 1, 0, 11, "block", "paragraph")!;
    const record: NoteComment = {
      id: "mark",
      note_id: "note",
      author_id: "author",
      kind: "annotation",
      visibility: "private",
      version: 1,
      mutation_id: null,
      created_at: "2026-09-13",
      updated_at: "2026-09-13",
      body: "Annotation",
      title: "",
      category: "note",
      tags: [],
      body_format: "markdown",
      parent_id: null,
      anchor,
      resolved: false,
      deleted: false,
    };
    const database = {
      ...record,
      anchor: Object.fromEntries(Object.entries(anchor).reverse()),
    } as NoteComment;
    expect(JSON.stringify(commentContentPatch(record))).toBe(
      JSON.stringify(commentContentPatch(database)),
    );
    expect(commentContentPatch({ ...record, deleted: true })).toEqual({
      deleted: true,
    });
    expect(
      commentPatchSchema.parse({
        body: "Private edit",
        expectedVisibility: "private",
        version: 1,
      }),
    ).toMatchObject({ expectedVisibility: "private" });
    expect(() =>
      commentPatchSchema.parse({ expectedVisibility: "private" }),
    ).toThrow();
    doc.destroy();
  });
  it("retains legacy bookmark fields and validates mark metadata", () => {
    expect(
      readingDataSchema.parse({
        label: "Old",
        heading: "title",
        fraction: 0.5,
      }),
    ).toEqual({ label: "Old", heading: "title", fraction: 0.5 });
    expect(
      readingDataSchema.parse({ tags: ["math", "math"], color: "blue" }).tags,
    ).toEqual(["math"]);
    expect(() => readingDataSchema.parse({ tags: ["x".repeat(41)] })).toThrow();
  });
  it("limits private visibility to the author, independently of manager status", () => {
    expect(visibleThread("owner", "private", "owner")).toBe(true);
    expect(visibleThread("owner", "private", "manager")).toBe(false);
    expect(visibleThread("owner", "shared", "reader")).toBe(true);
  });
  it("preserves the legacy create shape while accepting typed private cards", () => {
    expect(commentCreateSchema.parse({ body: "Comment" })).toMatchObject({
      kind: "discussion",
      bodyFormat: "plain",
    });
    expect(
      commentCreateSchema.parse({
        body: "$x$",
        kind: "annotation",
        visibility: "private",
        bodyFormat: "markdown",
      }),
    ).toMatchObject({ kind: "annotation", visibility: "private" });
    expect(() => commentPatchSchema.parse({ version: 1 })).toThrow();
    expect(() => commentPatchSchema.parse({ body: " ", version: 1 })).toThrow();
  });
  it("migrates v6 without changing writing preferences or leaking fields to old clients", () => {
    const {
      readingMarkMargin: _a,
      readingMarkOverview: _b,
      minimap: _minimap,
      ...previous
    } = defaults;
    const old = { ...previous, schemaVersion: 6, blockGuides: false };
    const upgraded = preferencesSchema.parse(old);
    expect(upgraded).toMatchObject({
      schemaVersion: APPEARANCE_SCHEMA,
      blockGuides: false,
      readingMarkMargin: true,
      readingMarkOverview: true,
      minimap: defaults.minimap,
    });
    expect(
      appearanceForClient(
        new Request("http://localhost", {
          headers: { [APPEARANCE_SCHEMA_HEADER]: "6" },
        }),
        { version: 1, preferences: upgraded },
      )?.preferences,
    ).toEqual(old);
  });
});
