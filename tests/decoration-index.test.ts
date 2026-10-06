import { describe, expect, it } from "vitest";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { Mapping, StepMap } from "@milkdown/kit/prose/transform";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { projectMarkdown } from "../packages/editor/src/projection";
import {
  alignedNodeDecorations,
  addIndexedDecorations,
  type AlignedNodeDecoration,
} from "../packages/editor/src/decoration-index";

const source =
  "# Study\n\nParagraph **with marks**.\n\n- Parent\n  - Child\n\n> Quote\n>\n> > Nested\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```py\nx=1\n```";
const ranges = (doc: ProseNode) => {
  const result: AlignedNodeDecoration[] = [];
  doc.descendants((node, position) => {
    if (node.isBlock)
      result.push({
        from: position,
        to: position + node.nodeSize,
        attrs: { class: "guide" },
      });
  });
  return result;
};
type DrawSource = {
  locals(node: ProseNode): readonly Decoration[];
  forChild(offset: number, node: ProseNode): DrawSource;
};
const spans = (values: readonly Decoration[]) =>
  values.map((d) => {
    const runtime = d as Decoration & {
      type: { attrs?: Record<string, string> };
    };
    return {
      from: d.from,
      to: d.to,
      attrs: runtime.type.attrs ?? {},
      spec: d.spec,
    };
  });
function compare(doc: ProseNode, first: unknown, second: unknown) {
  // Inspect the drawable contract, not stock group's internal tree shape.
  const a = first as DrawSource,
    b = second as DrawSource;
  expect(spans(a.locals(doc))).toEqual(spans(b.locals(doc)));
  doc.forEach((child, offset) => {
    const x = a.forChild(offset, child),
      y = b.forChild(offset, child);
    // A stock group may represent overlapping parent/child inline decorations.
    compare(child, x, y);
  });
}
describe("indexed source-projection decoration compatibility", () => {
  it("matches stock node ranges at every depth without changing the document", () => {
    const doc = projectMarkdown(source).doc,
      original = doc.toJSON(),
      entries = ranges(doc);
    const indexed = alignedNodeDecorations(doc, entries);
    compare(
      doc,
      indexed,
      DecorationSet.create(
        doc,
        entries.map((e) => Decoration.node(e.from, e.to, e.attrs)),
      ),
    );
    expect(doc.toJSON()).toEqual(original);
  });
  it("preserves widgets, overlaps, crossing highlights and mapping semantics", () => {
    const doc = projectMarkdown(source).doc,
      entries = ranges(doc);
    const extra = () => [
      Decoration.inline(
        2,
        doc.content.size - 1,
        { class: "peer" },
        { inclusiveStart: true },
      ),
      Decoration.inline(3, 7, { class: "search" }),
      Decoration.widget(4, () => ({}) as HTMLElement, {
        key: "caret",
        side: 1,
      }),
      Decoration.node(entries[0].from, entries[0].to, { "data-section": "1" }),
    ];
    const a = addIndexedDecorations(
      doc,
      alignedNodeDecorations(doc, entries),
      extra(),
    );
    const b = DecorationSet.create(doc, [
      ...entries.map((e) => Decoration.node(e.from, e.to, e.attrs)),
      ...extra(),
    ]);
    compare(doc, a, b);
    const mapping = new Mapping([new StepMap([3, 0, 1])]);
    expect(spans(a.map(mapping, doc).find())).toEqual(
      spans(b.map(mapping, doc).find()),
    );
  });
  it("rejects misaligned ranges and skips no empty block boundaries", () => {
    const doc = projectMarkdown("\n\nAfter").doc;
    compare(
      doc,
      alignedNodeDecorations(doc, ranges(doc)),
      DecorationSet.create(
        doc,
        ranges(doc).map((e) => Decoration.node(e.from, e.to, e.attrs)),
      ),
    );
    expect(() =>
      alignedNodeDecorations(doc, [{ from: 1, to: 2, attrs: {} }]),
    ).toThrow("align");
    expect(() =>
      alignedNodeDecorations(doc, [
        { from: 0, to: doc.content.size + 1, attrs: {} },
      ]),
    ).toThrow("align");
  });
  it("indexes many aligned sibling guides without stock quadratic validation", () => {
    const doc = projectMarkdown("A.\n\n".repeat(4000)).doc;
    const set = alignedNodeDecorations(doc, ranges(doc));
    expect(set.find()).toHaveLength(doc.childCount);
    doc.forEach((child, offset) =>
      expect(set.forChild(offset, child)).toBe(DecorationSet.empty),
    );
  });
});
