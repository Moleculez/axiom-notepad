import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  projectMindmap,
  layoutMindmap,
  mindmapIndex,
  visibleMindmapOrder,
  ensureMindmapVisible,
  selectedMindmapRoots,
  batchMindmapCommand,
  mindmapCommand,
  withMindmapSupporting,
  mindmapBlockPreview,
  defaultMindmapSettings,
} from "../packages/mindmap/src";
import { createMindmapComputer } from "../packages/mindmap/src/worker";
import { NativeBinding } from "../packages/editor/src/binding";
import { applyChanges } from "../packages/editor/src/transactions";
import { mindmapViewSchema } from "../apps/web/lib/mindmap-state";

describe("mind-map view navigation and research previews", () => {
  const source =
    "# Root\n\n## Methods\n\n- [ ] First\n  - [x] Inner\n- [ ] Second\n\n## Results\n\nBody\n";
  it("counts complete subtrees once, including hidden tasks", () => {
    const projection = projectMindmap(source),
      index = mindmapIndex(projection);
    const methods = projection.nodes.find((n) => n.label === "Methods")!;
    expect(index.descendants.get(methods.id)).toBe(3);
    expect(index.tasks.get(methods.id)).toEqual({ total: 3, complete: 1 });
    expect(index.tasks.get("root")).toEqual({ total: 3, complete: 1 });
  });
  it("uses document-order traversal, skipping folded children", () => {
    const projection = projectMindmap(source),
      methods = projection.nodes.find((n) => n.label === "Methods")!;
    const layout = layoutMindmap(projection, {}, [methods.id]);
    expect(
      visibleMindmapOrder(projection, layout).map(
        (id) => projection.nodes.find((n) => n.id === id)!.label,
      ),
    ).toEqual(["Root", "Methods", "Results", "Body"]);
    const expandedOrder = visibleMindmapOrder(projection, layout, []);
    expect(expandedOrder.indexOf(methods.id) + 1).toBe(
      expandedOrder.indexOf(methods.children[0]),
    );
    expect(visibleMindmapOrder(projection, layout, [], methods.id)[0]).toBe(
      methods.id,
    );
  });
  it("only pans enough to reveal a node and never changes scale", () => {
    const camera = { x: 15, y: 20, scale: 1.7 };
    expect(
      ensureMindmapVisible(
        camera,
        { x: 50, y: 40, width: 100, height: 50 },
        900,
        600,
      ),
    ).toBe(camera);
    const next = ensureMindmapVisible(
      camera,
      { x: 800, y: 700, width: 100, height: 50 },
      900,
      600,
    );
    expect(next.scale).toBe(camera.scale);
    expect(next.x + 900 * camera.scale).toBe(852);
    expect(next.y + 750 * camera.scale).toBe(552);
  });
  it("normalizes ancestors and descendants without changing source", () => {
    const projection = projectMindmap(source),
      methods = projection.nodes.find((n) => n.label === "Methods")!,
      inner = projection.nodes.find((n) => n.label === "Inner")!;
    expect(selectedMindmapRoots(projection, [inner.id, methods.id])).toEqual([
      methods,
    ]);
    expect(projectMindmap(source)).toEqual(projection);
  });
  it("completes selected subtrees as one author-local undo step", () => {
    const doc = new Y.Doc(),
      text = doc.getText("markdown");
    text.insert(0, source);
    const undo = new Y.UndoManager(text),
      binding = new NativeBinding(doc, undo, null),
      projection = projectMindmap(source);
    const methods = projection.nodes.find((n) => n.label === "Methods")!;
    binding.transact({
      ...batchMindmapCommand(source, projection, [methods.id], "complete"),
      kind: "command",
    });
    expect(binding.source.match(/\[x\]/g)).toHaveLength(3);
    binding.history(false);
    expect(binding.source).toBe(source);
    binding.history(true);
    expect(binding.source.match(/\[x\]/g)).toHaveLength(3);
    undo.destroy();
    doc.destroy();
  });
  it("merges overlapping deletes and refuses the root", () => {
    const projection = projectMindmap(source),
      methods = projection.nodes.find((n) => n.label === "Methods")!,
      inner = projection.nodes.find((n) => n.label === "Inner")!;
    const edit = batchMindmapCommand(
      source,
      projection,
      [methods.id, inner.id],
      "delete",
    );
    expect(edit.changes).toHaveLength(1);
    expect(applyChanges(source, edit.changes)).toBe(
      "# Root\n\n## Results\n\nBody\n",
    );
    expect(() =>
      batchMindmapCommand(source, projection, ["root"], "delete"),
    ).toThrow("root");
  });
  it("retains CRLF, marker styles and unrelated paragraphs during batch tasks", () => {
    const raw = "\ufeff# Root\r\n\r\n* [ ] A\r\n  + [ ] B\r\n\r\nTail\r\n",
      projection = projectMindmap(raw);
    const item = projection.nodes.find((n) => n.label === "A")!;
    expect(
      applyChanges(
        raw,
        batchMindmapCommand(raw, projection, [item.id], "complete").changes,
      ),
    ).toBe(raw.replaceAll("[ ]", "[x]"));
  });
  it("builds inert, bounded highlighted-code and table excerpts", () => {
    const raw =
      "# Research\n\n```python\na=1\nb=2\nc=3\nd=4\ne=5\n```\n\n| A | B | C | D |\n| - | - | - | - |\n| 1 | 2 | 3 | 4 |\n| 5 | 6 | 7 | 8 |\n| 9 | 10 | 11 | 12 |\n| 13 | 14 | 15 | 16 |\n";
    const projection = projectMindmap(raw),
      code = mindmapBlockPreview(
        raw,
        projection.nodes.find((n) => n.blockType === "codeBlock")!,
      ),
      table = mindmapBlockPreview(
        raw,
        projection.nodes.find((n) => n.blockType === "table")!,
      );
    expect(code.caption).toContain("5 lines");
    expect(code.markdown).toContain("d=4");
    expect(code.markdown).not.toContain("e=5");
    expect(code.code).toContain("e=5");
    expect(table.caption).toBe("4 rows · 4 columns · excerpt");
    expect(table.markdown).not.toContain("| D");
    expect(table.markdown).not.toContain("13");
  });
  it("retains complete image source for the host and supports inert compact mode", () => {
    const raw = "# Media\n\n![Telescope](https://external.invalid/a.png)\n",
      projection = projectMindmap(raw),
      node = projection.nodes[1];
    const tile = mindmapBlockPreview(raw, node);
    expect(tile.kind).toBe("image");
    expect(tile.markdown).toBe(raw.slice(node.from, node.to));
    expect(tile.alt).toBe("Telescope");
    expect(tile.href).toBe("https://external.invalid/a.png");
    expect(mindmapBlockPreview(raw, node, false).kind).toBe("prose");
    const mixed =
      "# Media\n\nEvidence ![Telescope](https://external.invalid/a.png) discussed here.\n";
    expect(
      mindmapBlockPreview(mixed, projectMindmap(mixed).nodes[1]).kind,
    ).toBe("prose");
  });
  it("keeps the complete Mermaid program instead of a four-line excerpt", () => {
    const raw =
        "# Diagram\n\n```mermaid\nflowchart LR\nA --> B\nB --> C\nC --> D\nD --> E\nE --> F\n```\n",
      node = projectMindmap(raw).nodes[1],
      preview = mindmapBlockPreview(raw, node);
    expect(preview.kind).toBe("diagram");
    expect(preview.markdown).toContain("E --> F");
    expect(preview.code).toContain("E --> F");
    expect(preview.caption).toBe("Mermaid diagram");
    expect(mindmapBlockPreview(raw, node, false).kind).toBe("prose");
  });
  it("preserves tilde fences and nested Mermaid content without clipping", () => {
    const raw =
        "# Root\n\n- Evidence\n\n  ~~~~Mermaid\n  flowchart TB\n  A --> B\n  B --> C\n  C --> D\n  D --> E\n  ~~~~\n",
      node = projectMindmap(raw).nodes.find(
        (n) => n.blockType === "codeBlock",
      )!,
      preview = mindmapBlockPreview(raw, node);
    expect(preview.kind).toBe("diagram");
    expect(preview.markdown).toMatch(/^~~~~mermaid/);
    expect(preview.code).toContain("D --> E");
  });
  it("keeps supporting nodes source-backed, read-only and optional", () => {
    const raw =
      "---\ntitle: Example\n---\n\n# Root\n\nText[^a].\n\n[^a]: Evidence\n\n[ref]: https://example.invalid\n";
    const base = projectMindmap(raw),
      presented = withMindmapSupporting(base, raw),
      group = presented.nodes.find((n) => n.id === "supporting")!;
    expect(base.nodes.some((n) => n.presentationOnly)).toBe(false);
    expect(group.children.length).toBeGreaterThan(1);
    const definition = presented.nodes.find(
      (n) => n.presentationOnly && n.to > n.from,
    )!;
    expect(definition.labelSource).toBe(
      raw.slice(definition.from, definition.to),
    );
    expect(mindmapBlockPreview(raw, definition, false).kind).toBe("supporting");
    expect(() => mindmapCommand(raw, definition, "delete")).toThrow(
      "Supporting",
    );
    expect(() =>
      batchMindmapCommand(raw, presented, [definition.id], "delete"),
    ).toThrow("editable");
  });
  it("reuses the canonical projection across supporting and focused layouts", () => {
    const compute = createMindmapComputer(),
      projection = projectMindmap(source),
      methods = projection.nodes.find((n) => n.label === "Methods")!;
    const base = {
      id: 1,
      source,
      title: "Research",
      settings: defaultMindmapSettings,
      folds: [],
      sizes: {},
    };
    const focused = compute({
      ...base,
      view: { focus: { position: methods.from, type: methods.blockType } },
    });
    expect(focused.layout?.nodes[0].id).toBe(methods.id);
    expect(focused.projection?.nodes).toHaveLength(projection.nodes.length);
    expect(compute({ ...base, id: 2 }).layout?.nodes[0].id).toBe("root");
  });
  it("reads previous view caches without erasing camera or folds", () => {
    const state = mindmapViewSchema.parse({
      settings: defaultMindmapSettings,
      camera: { x: 50, y: -200, scale: 1.6 },
      pane: "source",
      folds: [{ position: 8, type: "heading", label: "Methods" }],
    });
    expect(state.camera.scale).toBe(1.6);
    expect(state.folds).toHaveLength(1);
    expect(state.presentation).toEqual({
      preview: "research",
      supporting: false,
      minimap: false,
      lens: "all",
      resultsOnly: false,
    });
    expect(
      mindmapViewSchema.safeParse({
        ...state,
        presentation: { preview: "script" },
      }).success,
    ).toBe(false);
  });
});
