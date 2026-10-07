import { describe, expect, it, vi } from "vitest";
import * as markdown from "../packages/markdown/src/parser";
import { parseMarkdown, mediaMarkdown } from "../packages/markdown/src";
import {
  projectMindmap,
  layoutMindmap,
  visibleMindmapOrder,
  mindmapIndex,
  defaultMindmapSettings,
  mindmapLimits,
} from "../packages/mindmap/src";
import {
  mindmapResearchIndex,
  mindmapResearchMatches,
  mindmapResearchTopology,
  mindmapBranchEvidence,
  mindmapTaskChecked,
  mindmapViewProjection,
} from "../packages/mindmap/src/research";
import {
  createMindmapComputer,
  computeMindmap,
} from "../packages/mindmap/src/worker";
import { mindmapViewSchema } from "../apps/web/lib/mindmap-state";

const source =
  "# Study\n\n## Methods\n\n- [ ] Check [[Result]] and [@paper]\n  - [x] Verified\n\n$$x^2 \\label{power}$$\n\n## Results\n\n![Figure][fig]\n\nSee \\eqref{power} and footnote[^n].\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n[fig]: figure.png\n[^n]: Supporting evidence\n";
const document = parseMarkdown(source),
  projection = projectMindmap(source, "Study", document),
  index = mindmapResearchIndex(projection, document);
describe("source-backed research lenses", () => {
  it("reflects a live task marker toggle synchronously without guessing across label edits", () => {
    const value = "# Tasks\n\n- [ ] Check result\n",
      node = projectMindmap(value).nodes[1];
    expect(mindmapTaskChecked(node, value)).toBe(false);
    expect(mindmapTaskChecked(node, value.replace("[ ]", "[x]"))).toBe(true);
    expect(mindmapTaskChecked(node, value.replace("[ ]", "[X]"))).toBe(true);
    expect(mindmapTaskChecked(node, value.replace("[ ]", "[q]"))).toBe(false);
    expect(
      mindmapTaskChecked(node, value.replace("[ ] Check", "[x] Changed")),
    ).toBe(false);
  });
  it("finds figures, complete diagrams, equations and unfinished tasks", () => {
    expect(mindmapResearchMatches(projection, index, "figures")).toHaveLength(
      2,
    );
    expect(mindmapResearchMatches(projection, index, "equations")).toHaveLength(
      1,
    );
    expect(
      mindmapResearchMatches(projection, index, "open-tasks").map(
        (n) => n.checked,
      ),
    ).toEqual([false]);
    expect(mindmapResearchMatches(projection, index, "code")).toHaveLength(1);
  });
  it("combines text search and focused branch scope without moving source", () => {
    const methods = projection.nodes.find((n) => n.label === "Methods")!;
    expect(
      mindmapResearchMatches(projection, index, "figures", "", methods.id),
    ).toHaveLength(0);
    expect(
      mindmapResearchMatches(projection, index, "references", "Check"),
    ).toHaveLength(1);
    expect(
      mindmapResearchMatches(projection, index, "code", "A --> B"),
    ).toHaveLength(1);
    expect(projectMindmap(source, "Study", document)).toEqual(projection);
  });
  it("keeps canonical ancestor IDs but prunes unrelated view children", () => {
    const matches = mindmapResearchMatches(projection, index, "open-tasks"),
      topology = mindmapResearchTopology(
        projection,
        matches.map((n) => n.id),
      );
    expect(topology.nodes.map((n) => n.label)).toEqual([
      "Study",
      "Methods",
      "Check Result and",
    ]);
    const layout = layoutMindmap(topology);
    expect(visibleMindmapOrder(topology, layout, [])).toEqual(
      topology.nodes.map((n) => n.id),
    );
    expect(mindmapIndex(projection).tasks.get("root")).toEqual({
      total: 2,
      complete: 1,
    });
  });
  it("retains only the root for no results", () => {
    expect(
      mindmapResearchTopology(projection, []).nodes.map((n) => n.id),
    ).toEqual(["root"]);
  });
  it("deduplicates evidence and resolves local equation/footnote targets", () => {
    const evidence = mindmapBranchEvidence(
      projection,
      index,
      projection.nodes[0],
    );
    expect(evidence.map((e) => e.kind)).toEqual([
      "note",
      "citation",
      "equation",
      "footnote",
    ]);
    expect(evidence.find((e) => e.kind === "equation")?.targetFrom).toBe(
      source.indexOf("$$"),
    );
    expect(
      evidence.find((e) => e.kind === "footnote")?.targetFrom,
    ).toBeGreaterThan(source.indexOf("[^n]:"));
  });

  it("indexes TeX equation references and shares first-label-wins targets with the renderer", () => {
    const value =
        "# Study\n\n$$x \\label {shared}$$\n\n$$y \\label{shared}$$\n\n$$z=\\eqref {shared}$$\n\nInline $\\eqref{shared}$.\n",
      owner = parseMarkdown(value),
      tree = projectMindmap(value, "Study", owner),
      research = mindmapResearchIndex(tree, owner);
    expect(research.targets.get("#eq-shared")).toBe(value.indexOf("$$"));
    const hits = mindmapResearchMatches(tree, research, "references");
    expect(hits).toHaveLength(2);
    for (const node of hits) {
      const item = research.evidence.get(node.id)?.[0];
      expect(item?.kind).toBe("equation");
      expect(item?.targetFrom).toBe(value.indexOf("$$"));
      expect(item!.from).toBeGreaterThanOrEqual(node.from);
      expect(item!.to).toBeLessThanOrEqual(node.to);
    }
  });

  it("resolves labelled media evidence to its actual figure anchor", () => {
    const value =
        "# Study\n\n" +
        mediaMarkdown("![Plot](plot.png)", {
          v: 1,
          display: "figure",
          label: "fig-evidence",
        }) +
        "\n\nSee [Figure](#fig-evidence).\n",
      owner = parseMarkdown(value),
      tree = projectMindmap(value, "Study", owner),
      research = mindmapResearchIndex(tree, owner);
    const target = value.indexOf("<!-- axiom-media");
    expect(research.targets.get("#fig-evidence")).toBe(target);
    const evidence = mindmapBranchEvidence(tree, research, tree.nodes[0]);
    expect(
      evidence.find((item) => item.target === "#fig-evidence")?.targetFrom,
    ).toBe(target);
  });

  it("keeps filtered keyboard topology separate from full mutation topology and respects folds", () => {
    const compute = createMindmapComputer(),
      base = {
        source,
        title: "Study",
        settings: defaultMindmapSettings,
        sizes: {},
        folds: [],
        view: {
          research: {
            lens: "open-tasks" as const,
            query: "",
            resultsOnly: true,
          },
        },
      },
      result = compute({ ...base, id: 1 });
    expect(result.error).toBeUndefined();
    expect(result.projection).toEqual(projection);
    expect(result.viewProjection!.nodes.map((n) => n.label)).toEqual([
      "Study",
      "Methods",
      "Check Result and",
    ]);
    const methods = projection.nodes.find((n) => n.label === "Methods")!,
      folded = compute({
        ...base,
        id: 2,
        folds: [{ position: methods.from, type: methods.blockType }],
      });
    expect(
      visibleMindmapOrder(folded.viewProjection!, folded.layout!, [methods.id]),
    ).toEqual(["root", methods.id]);
    // Keyboard intent uses the filtered children even before its layout catches up.
    expect(
      visibleMindmapOrder(result.viewProjection!, folded.layout!, []),
    ).toEqual(result.viewProjection!.nodes.map((n) => n.id));
    expect(
      result.projection!.nodes.find((n) => n.label === "Methods")!.children,
    ).toHaveLength(2);
    expect(mindmapIndex(result.projection!).tasks.get("root")).toEqual({
      total: 2,
      complete: 1,
    });
  });

  it("limits focused results to their branch and retains a navigable root for empty results", () => {
    const methods = projection.nodes.find((n) => n.label === "Methods")!,
      result = computeMindmap({
        id: 1,
        source,
        title: "Study",
        settings: defaultMindmapSettings,
        sizes: {},
        folds: [],
        view: {
          focus: { position: methods.from, type: methods.blockType },
          research: { lens: "figures", query: "", resultsOnly: true },
        },
      });
    expect(result.viewProjection!.rootId).toBe(methods.id);
    expect(result.viewProjection!.nodes.map((n) => n.id)).toEqual([methods.id]);
    expect(result.viewProjection!.nodes[0].parentId).toBeNull();
    expect(result.layout!.nodes.map((n) => n.id)).toEqual([methods.id]);
    expect(result.projection!.nodes).toHaveLength(projection.nodes.length);
  });

  it("derives current lens, query and focus keyboard children before the worker layout catches up", () => {
    const raw =
        "# Study\n\n## Method\n\n- [x] Excluded first\n- [ ] Wanted\n\n## Other\n\n- [ ] Outside\n",
      owner = parseMarkdown(raw),
      tree = projectMindmap(raw, "Study", owner),
      research = mindmapResearchIndex(tree, owner),
      method = tree.nodes.find((node) => node.label === "Method")!,
      excluded = tree.nodes.find((node) => node.label === "Excluded first")!,
      wanted = tree.nodes.find((node) => node.label === "Wanted")!,
      other = tree.nodes.find((node) => node.label === "Other")!,
      outside = tree.nodes.find((node) => node.label === "Outside")!,
      focus = { position: method.from, type: method.blockType },
      staleView = mindmapViewProjection(tree, focus),
      staleLayout = layoutMindmap(staleView),
      currentMatches = mindmapResearchMatches(
        tree,
        research,
        "open-tasks",
        "",
        staleView.rootId,
      ),
      current = mindmapViewProjection(
        tree,
        focus,
        currentMatches.map((node) => node.id),
      );
    expect(
      staleView.nodes.find((node) => node.id === method.id)!.children[0],
    ).toBe(excluded.id);
    // ArrowRight reads the current intent's first child, not the painted worker view.
    expect(
      current.nodes.find((node) => node.id === method.id)!.children,
    ).toEqual([wanted.id]);
    expect(
      visibleMindmapOrder(current, staleLayout, [], current.rootId),
    ).toEqual([method.id, wanted.id]);
    expect(
      visibleMindmapOrder(current, staleLayout, [method.id], current.rootId),
    ).toEqual([method.id]);
    // A query with no results is immediately a navigable root with no stale child.
    const empty = mindmapViewProjection(
      tree,
      focus,
      mindmapResearchMatches(
        tree,
        research,
        "open-tasks",
        "Outside",
        current.rootId,
      ).map((node) => node.id),
    );
    expect(empty.nodes.map((node) => node.id)).toEqual([method.id]);
    expect(empty.nodes[0].children).toEqual([]);
    expect(visibleMindmapOrder(empty, staleLayout, [], empty.rootId)).toEqual([
      method.id,
    ]);
    // The next focused branch owns navigation even when the layout still shows Method.
    const nextFocus = { position: other.from, type: other.blockType },
      nextRoot = mindmapViewProjection(tree, nextFocus),
      next = mindmapViewProjection(
        tree,
        nextFocus,
        mindmapResearchMatches(
          tree,
          research,
          "open-tasks",
          "",
          nextRoot.rootId,
        ).map((node) => node.id),
      );
    expect(visibleMindmapOrder(next, staleLayout, [], next.rootId)).toEqual([
      other.id,
      outside.id,
    ]);
    expect(tree.nodes.find((node) => node.id === method.id)!.children).toEqual([
      excluded.id,
      wanted.id,
    ]);
    expect(projectMindmap(raw, "Study", owner)).toEqual(tree);
  });

  it("does not let a presentation node steal a current source-backed focus anchor", () => {
    const method = projection.nodes.find((node) => node.label === "Methods")!,
      supporting = {
        ...method,
        id: "supporting-focus",
        presentationOnly: true,
      },
      tree = {
        ...projection,
        nodes: [supporting, ...projection.nodes],
      };
    expect(
      mindmapViewProjection(tree, {
        position: method.from,
        type: method.blockType,
      }).rootId,
    ).toBe(method.id);
    expect(
      mindmapViewProjection(tree, {
        position: source.length + 1,
        type: "heading",
      }),
    ).toBe(tree);
  });

  it("upgrades old local presentation state without changing its camera, folds or chosen preview", () => {
    const camera = { x: -320, y: 240, scale: 1.7 },
      folds = [{ position: 12, type: "heading", label: "Methods" }];
    const previous = mindmapViewSchema.parse({
      settings: defaultMindmapSettings,
      camera,
      folds,
      pane: "details",
      presentation: { preview: "compact", supporting: true, minimap: true },
    });
    expect(previous.camera).toEqual(camera);
    expect(previous.folds).toEqual(folds);
    expect(previous.presentation).toEqual({
      preview: "compact",
      supporting: true,
      minimap: true,
      lens: "all",
      resultsOnly: false,
    });
  });

  it("indexes a 5,000-node map once across view changes and rejects oversized source before parsing", () => {
    const spy = vi.spyOn(markdown, "parseMarkdown");
    try {
      const value =
        "# Large\n\n" +
        Array.from(
          { length: mindmapLimits.nodes - 1 },
          (_, i) => `- [${i % 3 ? " " : "x"}] Task ${i} [[Note ${i % 25}]]\n`,
        ).join("");
      const compute = createMindmapComputer(),
        request = {
          id: 1,
          source: value,
          title: "Large",
          settings: defaultMindmapSettings,
          folds: [],
          sizes: {},
        },
        first = compute(request);
      expect(first.projection?.nodes).toHaveLength(mindmapLimits.nodes);
      expect(spy).toHaveBeenCalledTimes(1);
      const second = compute({
        ...request,
        id: 2,
        view: {
          research: { lens: "open-tasks", query: "", resultsOnly: true },
        },
      });
      expect(second.projection).toBe(first.projection);
      expect(second.viewProjection!.nodes.length).toBeLessThan(
        first.projection!.nodes.length,
      );
      expect(spy).toHaveBeenCalledTimes(1);
      compute({ ...request, id: 3, title: "Renamed file" });
      expect(spy).toHaveBeenCalledTimes(1);
      const tooLarge = compute({
        ...request,
        id: 4,
        source: "x".repeat(mindmapLimits.source + 1),
      });
      expect(tooLarge.error).toContain("one-million-character");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
