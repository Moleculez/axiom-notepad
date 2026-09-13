import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { NativeBinding } from "../packages/editor/src/binding";
import { SuggestionProjection } from "../apps/web/lib/suggestion-projection";
import {
  captureHunks,
  resolveHunks,
  applyHunks,
} from "../packages/shared/src/suggestion-hunks";

function setup(source = "Alpha result\n\nBeta result\n") {
  const doc = new Y.Doc();
  doc.getText("markdown").insert(0, source);
  const binding = new NativeBinding(
    doc,
    new Y.UndoManager(doc.getText("markdown")),
    null,
  );
  return {
    doc,
    binding,
    close: () => {
      binding.destroy();
      binding.undo.destroy();
      doc.destroy();
    },
  };
}
describe("separate suggestion projection", () => {
  for (const kind of [
    "typing",
    "delete",
    "command",
    "paste",
    "composition",
  ] as const) {
    it(kind + " changes only the proposal, never accepted source", () => {
      const s = setup(),
        projection = new SuggestionProjection(s.binding, () => {});
      const state = Y.encodeStateAsUpdate(s.doc);
      projection.transact({
        kind,
        changes: [{ from: 0, to: 5, insert: "模型 👩🏽‍🔬" }],
      });
      expect(projection.source).toContain("模型");
      expect(Y.encodeStateAsUpdate(s.doc)).toEqual(state);
      expect(resolveHunks(s.doc, projection.hunks)).toHaveLength(1);
      projection.history(false);
      expect(projection.source).toBe(s.binding.source);
      expect(projection.hunks).toEqual([]);
      projection.history(true);
      expect(projection.hunks).toHaveLength(1);
      projection.destroy();
      s.close();
    });
  }
  it("rebases unrelated peer changes while keeping private edits private", () => {
    const s = setup(),
      p = new SuggestionProjection(s.binding, () => {});
    p.transact({
      kind: "typing",
      changes: [{ from: 0, to: 5, insert: "Gamma" }],
    });
    s.binding.transact({
      kind: "typing",
      changes: [
        {
          from: s.binding.source.length,
          to: s.binding.source.length,
          insert: "\nPeer conclusion",
        },
      ],
    });
    expect(p.conflict).toBe("");
    expect(p.source).toBe("Gamma result\n\nBeta result\n\nPeer conclusion");
    expect(s.binding.source).toContain("Alpha");
    applyHunks(s.doc, resolveHunks(s.doc, p.hunks), "review");
    expect(s.binding.source).toContain("Gamma");
    p.destroy();
    s.close();
  });
  it("freezes overlapping changes with recovery intact", () => {
    const s = setup(),
      p = new SuggestionProjection(s.binding, () => {});
    p.transact({
      kind: "typing",
      changes: [{ from: 0, to: 5, insert: "Gamma" }],
    });
    s.binding.transact({
      kind: "typing",
      changes: [{ from: 0, to: 5, insert: "Other" }],
    });
    expect(p.conflict).not.toBe("");
    const recovery = p.source;
    p.transact({ kind: "delete", changes: [{ from: 0, to: 3, insert: "" }] });
    expect(p.source).toBe(recovery);
    expect(s.binding.source).toContain("Other");
    p.destroy();
    s.close();
  });
});
describe("strict suggestion anchors", () => {
  it("rejects a deleted range even when a peer inserts identical replacement text", () => {
    const s = setup();
    const hunks = captureHunks(s.doc, [{ from: 0, to: 5, insert: "Gamma" }]);
    const text = s.doc.getText("markdown");
    s.doc.transact(() => {
      text.delete(0, 5);
      text.insert(0, "Alpha");
    });
    expect(() => resolveHunks(s.doc, hunks)).toThrow();
    s.close();
  });
  it("does not resolve against repeated text after the original was deleted", () => {
    const s = setup("same\nsame\n");
    const hunks = captureHunks(s.doc, [{ from: 0, to: 4, insert: "first" }]);
    s.doc.getText("markdown").delete(0, 5);
    expect(() => resolveHunks(s.doc, hunks)).toThrow();
    s.close();
  });
  it("rejects overlap and malformed anchors", () => {
    const s = setup();
    const hunks = captureHunks(s.doc, [
      { from: 0, to: 5, insert: "x" },
      { from: 2, to: 4, insert: "y" },
    ]);
    expect(() => resolveHunks(s.doc, hunks)).toThrow(/overlap/);
    expect(() =>
      resolveHunks(s.doc, [{ ...hunks[0], start: "invalid" }]),
    ).toThrow();
    s.close();
  });
  it("preserves an insertion anchor shifted by a distant peer edit", () => {
    const s = setup("x".repeat(100) + "\nEnd");
    const hunks = captureHunks(s.doc, [{ from: 100, to: 100, insert: "!" }]);
    s.doc.getText("markdown").insert(0, "Start");
    expect(resolveHunks(s.doc, hunks)[0].from).toBe(105);
    s.close();
  });
});
