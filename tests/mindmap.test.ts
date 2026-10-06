import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { NativeBinding } from "../packages/editor/src/binding";
import { applyChanges } from "../packages/editor/src/transactions";
import {
  projectMindmap,
  nodeAtMindmapPosition,
  layoutMindmap,
  mindmapConnector,
  fitMindmap,
  mindmapCommand,
  moveMindmapBranch,
} from "../packages/mindmap/src";

const node = (source: string, label: string) =>
  projectMindmap(source).nodes.find((n) => n.label === label)!;
describe("native Markdown mind maps", () => {
  it("promotes a document-wide H1 without rewriting source", () => {
    const source =
      "# Research\n\n## Model\n\n- Hypothesis\n  - Evidence\n- [ ] Review\n\n## Results\n\nText\n";
    const map = projectMindmap(source, "File name");
    expect(map.nodes[0].label).toBe("Research");
    expect(
      map.nodes[0].children.map(
        (id) => map.nodes.find((n) => n.id === id)!.label,
      ),
    ).toEqual(["Model", "Results"]);
    const model = map.nodes.find((n) => n.label === "Model")!;
    const hypothesis = map.nodes.find((n) => n.label === "Hypothesis")!;
    expect(hypothesis.parentId).toBe(model.id);
    expect(map.nodes.find((n) => n.label === "Evidence")!.parentId).toBe(
      hypothesis.id,
    );
    expect(map.nodes.find((n) => n.label === "Review")!.checked).toBe(false);
    expect(model.branchTo).toBe(source.indexOf("## Results"));
    expect(source.slice(hypothesis.labelFrom, hypothesis.labelTo)).toBe(
      "Hypothesis",
    );
  });
  it("keeps multiple roots, supporting definitions, rich blocks and container scopes", () => {
    const source =
      "---\ntitle: Sample\n---\n# A\n\n> ## Quoted\n> Text\n\n$$\nx^2\n$$\n\n```py\nx = 1\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n# B\n\n[ref]: https://example.test\n\n[^n]: Footnote\n";
    const map = projectMindmap(source, "Notebook");
    expect(map.nodes[0].label).toBe("Notebook");
    expect(map.supporting.some((n) => n.type === "frontmatter")).toBe(true);
    expect(map.supporting.some((n) => n.type === "referenceDefinition")).toBe(
      true,
    );
    expect(map.nodes.some((n) => n.blockType === "mathBlock")).toBe(true);
    expect(map.nodes.some((n) => n.blockType === "codeBlock")).toBe(true);
    expect(map.nodes.some((n) => n.blockType === "table")).toBe(true);
    expect(map.nodes.find((n) => n.label === "Quoted")!.scope).not.toBe(
      "document",
    );
  });
  it("preserves CRLF, marker styles, tasks and fences on label edits", () => {
    const source =
      "\ufeff# Paper\r\n\r\n+ [X] **Verify**\r\n  ~~~py\r\n  print(1)\r\n  ~~~\r\n";
    const item = node(source, "Verify");
    const next = applyChanges(
      source,
      mindmapCommand(source, item, "rename", "**Verified**").changes,
    );
    expect(next).toBe(source.replace("**Verify**", "**Verified**"));
    expect(
      applyChanges(source, mindmapCommand(source, item, "toggleTask").changes),
    ).toBe(source.replace("[X]", "[ ]"));
    expect(() => mindmapCommand(source, item, "rename", "x\ny")).toThrow(
      "one line",
    );
  });
  it("adds list siblings and children in canonical Markdown", () => {
    const source = "- A\n- B\n";
    const sibling = mindmapCommand(source, node(source, "A"), "sibling");
    expect(applyChanges(source, sibling.changes)).toBe("- A\n- \n- B\n");
    const child = mindmapCommand(source, node(source, "A"), "child");
    expect(applyChanges(source, child.changes)).toBe("- A\n  - \n- B\n");
    expect(sibling.selection!.head).toBe(6);
  });
  it("rejects implicit conversions and headings below H6", () => {
    const source = "# Root\n\n###### Deep\n\n- Item\n";
    const projection = projectMindmap(source);
    expect(() => mindmapCommand(source, node(source, "Deep"), "child")).toThrow(
      "H6",
    );
    expect(() =>
      moveMindmapBranch(
        source,
        projection,
        node(source, "Item").id,
        node(source, "Deep").id,
        "child",
      ),
    ).toThrow("convert");
  });
  it("moves a heading with its fenced descendants without changing other sections", () => {
    const source =
      "# Root\n\n## A\n\n```py\na = 1\n```\n\n### Inner\n\nContent\n\n## B\n\nOther\n";
    const projection = projectMindmap(source);
    const edit = moveMindmapBranch(
      source,
      projection,
      node(source, "A").id,
      node(source, "B").id,
      "child",
    );
    const next = applyChanges(source, edit.changes);
    expect(next).toContain("## B\n\nOther\n\n### A");
    expect(next).toContain("#### Inner");
    expect(next).toContain("```py\na = 1\n```");
    expect(node(next, "A").parentId).toBe(node(next, "B").id);
  });
  it("reorders and reparents list branches", () => {
    const source = "- A\n  - Inner\n- B\n- C\n";
    const projection = projectMindmap(source);
    const next = applyChanges(
      source,
      moveMindmapBranch(
        source,
        projection,
        node(source, "A").id,
        node(source, "C").id,
        "after",
      ).changes,
    );
    expect(next).toBe("- B\n- C\n- A\n  - Inner\n");
    const child = applyChanges(
      source,
      moveMindmapBranch(
        source,
        projection,
        node(source, "A").id,
        node(source, "B").id,
        "child",
      ).changes,
    );
    expect(node(child, "A").parentId).toBe(node(child, "B").id);
    expect(() =>
      moveMindmapBranch(
        source,
        projection,
        node(source, "A").id,
        node(source, "Inner").id,
        "child",
      ),
    ).toThrow("descendants");
  });
  it("does not retag independent headings inside a moved quotation", () => {
    const source = "# Root\n\n## A\n\n> ## Quoted\n> Evidence\n\n## B\n";
    const next = applyChanges(
      source,
      moveMindmapBranch(
        source,
        projectMindmap(source),
        node(source, "A").id,
        node(source, "B").id,
        "child",
      ).changes,
    );
    expect(next).toContain("### A");
    expect(next).toContain("> ## Quoted\n> Evidence\n");
  });
  it("deletes a branch, not the adjacent heading", () => {
    const source = "## A\n\n- X\n\n## B\n\nY\n";
    expect(
      applyChanges(
        source,
        mindmapCommand(source, node(source, "A"), "delete").changes,
      ),
    ).toBe("## B\n\nY\n");
    expect(() =>
      mindmapCommand(source, projectMindmap(source).nodes[0], "delete"),
    ).toThrow("root");
  });
  it("preserves a BOM while moving or deleting its first list item", () => {
    const source = "\ufeff- A\r\n- B\r\n";
    expect(
      applyChanges(
        source,
        mindmapCommand(source, node(source, "A"), "delete").changes,
      ),
    ).toBe("\ufeff- B\r\n");
    expect(
      applyChanges(
        source,
        moveMindmapBranch(
          source,
          projectMindmap(source),
          node(source, "A").id,
          node(source, "B").id,
          "after",
        ).changes,
      ),
    ).toBe("\ufeff- B\r\n- A\r\n");
  });
  it("allows an adjacent reparenting and outdent without overlapping patches", () => {
    const source = "- A\n- B\n";
    const nested = applyChanges(
      source,
      moveMindmapBranch(
        source,
        projectMindmap(source),
        node(source, "B").id,
        node(source, "A").id,
        "child",
      ).changes,
    );
    expect(nested).toBe("- A\n  - B\n");
    expect(
      applyChanges(
        nested,
        moveMindmapBranch(
          nested,
          projectMindmap(nested),
          node(nested, "B").id,
          node(nested, "A").id,
          "after",
        ).changes,
      ),
    ).toBe(source);
  });
  it("uses the same collaborative source and author undo stack", () => {
    const doc = new Y.Doc(),
      text = doc.getText("markdown");
    text.insert(0, "- A\n- B\n");
    const undo = new Y.UndoManager(text),
      binding = new NativeBinding(doc, undo, null);
    const edit = mindmapCommand(
      binding.source,
      node(binding.source, "A"),
      "rename",
      "Alpha",
    );
    binding.transact({ ...edit, kind: "command" });
    text.insert(text.length, "- Peer\n");
    binding.history(false);
    expect(binding.source).toBe("- A\n- B\n- Peer\n");
    binding.history(true);
    expect(binding.source).toBe("- Alpha\n- B\n- Peer\n");
    binding.destroy();
    undo.destroy();
    doc.destroy();
  });
  it.each(["right", "left", "balanced"] as const)(
    "lays out measured nodes without overlaps: %s",
    (layout) => {
      const projection = projectMindmap("# Root\n\n- A\n  - Inner\n- B\n- C\n");
      const result = layoutMindmap(projection, { layout }, [], {
        root: { width: 140, height: 90 },
      });
      expect(result.nodes).toHaveLength(projection.nodes.length);
      for (const a of result.nodes)
        for (const b of result.nodes) {
          if (a === b) continue;
          expect(
            a.x + a.width <= b.x ||
              b.x + b.width <= a.x ||
              a.y + a.height <= b.y ||
              b.y + b.height <= a.y,
          ).toBe(true);
        }
      const root = result.nodes[0],
        child = result.nodes[1];
      expect(mindmapConnector(root, child)).toMatch(/^M .* C /);
      expect(fitMindmap(result.bounds, 1000, 700).scale).toBeGreaterThan(0);
    },
  );
  it("folds descendants and resolves positions to the narrowest branch", () => {
    const source = "- A\n  - Inner\n- B\n",
      projection = projectMindmap(source),
      a = node(source, "A");
    expect(layoutMindmap(projection, {}, [a.id]).nodes).toHaveLength(3);
    expect(
      nodeAtMindmapPosition(projection, source.indexOf("Inner")).label,
    ).toBe("Inner");
  });
  it("fails visibly rather than truncating oversized maps", () => {
    expect(() =>
      projectMindmap(
        Array.from({ length: 5000 }, (_, i) => `- ${i}\n`).join(""),
      ),
    ).toThrow("5,000");
    expect(() => projectMindmap("x".repeat(1_000_001))).toThrow("one-million");
  });
});
