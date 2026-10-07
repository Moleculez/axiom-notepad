import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import * as Y from "yjs";
import { NativeBinding } from "../packages/editor/src/binding";
import { applyChanges } from "../packages/editor/src/transactions";
import {
  projectMindmap,
  layoutMindmap,
  mindmapCommand,
  nodeAtMindmapPosition,
  fitMindmap,
} from "../packages/mindmap/src";
import {
  mindmapBranch,
  mindmapMarkdown,
  mindmapSvg,
  mindmapHtml,
} from "../packages/mindmap/src/export";
import { mindmapHtmlScript } from "../packages/mindmap/src/html-runtime";
import { createMindmapComputer } from "../packages/mindmap/src/worker";
import {
  wrapMindmapLabel,
  estimateMindmapLabel,
} from "../packages/mindmap/src/layout";
import { defaultMindmapSettings } from "../packages/mindmap/src/types";
import { mindmapSettingsSchema } from "../packages/shared/src/mindmap";
import { mindmapMigration } from "../packages/shared/src/mindmap-migration";
import { forwardMigrations } from "../packages/shared/src/migrations";
import {
  fileRoute,
  fileRouteId,
  fileViewKind,
} from "../packages/shared/src/file-routes";
import { fileTypeIds } from "../packages/shared/src/file-types";
import {
  portableCollectionSchema,
  portableMetadataSchema,
} from "../packages/shared/src/portable-collection";
import { portableCollectionFixture } from "./fixtures/portable-collection";
import {
  mindmapViewSchema,
  resolveMindmapDraft,
} from "../apps/web/lib/mindmap-state";
import { samples, mindmapSample } from "../apps/showcase/src/samples";

const style = {
  background: "#fff",
  text: "#222",
  accent: "#476b83",
  font: "serif",
  fontSize: 16,
};
const find = (source: string, label: string) =>
  projectMindmap(source).nodes.find((n) => n.label === label)!;
describe("mind-map storage and file contracts", () => {
  it("uses the note route and profile, not a new source format or tool route", () => {
    const resource = {
      id: "10000000-0000-4000-8000-000000000001",
      kind: "note" as const,
      document_type: "mindmap" as const,
    };
    expect(fileViewKind(resource)).toBe("notes");
    expect(fileRoute(resource, "frozen")).toBe(
      `/notes/${resource.id}?view=mindmap&version=frozen`,
    );
    expect(fileRouteId(`/workbench${fileRoute(resource)}`)).toBe(resource.id);
    expect(fileTypeIds).toContain("mindmap");
  });
  it("keeps settings bounded, typed and non-executable", () => {
    expect(mindmapSettingsSchema.parse({})).toEqual(defaultMindmapSettings);
    for (const settings of [
      { nodeWidth: NaN },
      { nodeWidth: 481 },
      { initialDepth: 0 },
      { script: "alert(1)" },
      { colors: "red" },
      { layout: "random" },
    ])
      expect(mindmapSettingsSchema.safeParse(settings).success).toBe(false);
  });
  it("only appends an additive profile constraint migration", () => {
    expect(forwardMigrations.filter((m) => m.version === 49)).toHaveLength(1);
    expect(forwardMigrations.at(-1)?.sql).toBe(mindmapMigration);
    expect(mindmapMigration).toContain("'mindmap'");
    expect(mindmapMigration).not.toMatch(
      /(?:UPDATE|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE)\s/i,
    );
  });
  it("round-trips a native profile through collections, rejecting format conversion", async () => {
    const { manifest, ids } = await portableCollectionFixture();
    const paper = manifest.resources.find((r) => r.id === ids.paper)!;
    paper.metadata = {
      ...paper.metadata,
      toolKind: "mindmap",
      settings: { layout: "balanced", nodeWidth: 360 },
    };
    expect(
      portableCollectionSchema
        .parse(manifest)
        .resources.find((r) => r.id === ids.paper)?.metadata.toolKind,
    ).toBe("mindmap");
    paper.sourceFormat = "canvas";
    expect(portableCollectionSchema.safeParse(manifest).success).toBe(false);
    expect(
      portableMetadataSchema.safeParse({
        toolKind: "mindmap",
        settings: { externalCss: "https://unsafe.test" },
      }).success,
    ).toBe(false);
  });
  it("uses distinct fixture identities instead of replacing an existing sample", () => {
    const ids = [...samples, mindmapSample].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("validates local presentation state and refuses nonfinite cameras", () => {
    const state = {
      settings: defaultMindmapSettings,
      camera: { x: 0, y: 0, scale: 1 },
      pane: null,
      folds: [],
    };
    expect(mindmapViewSchema.safeParse(state).success).toBe(true);
    for (const camera of [
      { x: Infinity, y: 0, scale: 1 },
      { x: 0, y: 0, scale: 0 },
      { x: 0, y: 0, scale: 3.1 },
    ])
      expect(mindmapViewSchema.safeParse({ ...state, camera }).success).toBe(
        false,
      );
    expect(
      mindmapViewSchema.safeParse({
        ...state,
        folds: Array(5001).fill({ position: 0, type: "item", label: "A" }),
      }).success,
    ).toBe(false);
  });
});
describe("mind-map source and collaborative anchor contracts", () => {
  it.each([
    ["### \n", "### New method\n"],
    ["###\n", "### New method\n"],
    ["###", "### New method"],
    ["###\t  \r\n", "###\t  New method\r\n"],
    ["  ### \n", "  ### New method\n"],
    ["### ###\n", "### New method ###\n"],
    ["### ###  \r\n", "### New method ###  \r\n"],
    ["\ufeff### \r\n", "\ufeff### New method\r\n"],
    ["#\n", "# New method\n"],
    ["> ### \n>\n> Text\n", "> ### New method\n>\n> Text\n"],
  ])(
    "renames an empty heading without changing topology: %j",
    (source, expected) => {
      const before = projectMindmap(source);
      const heading = before.nodes.find(
        (node) => node.blockType === "heading",
      )!;
      const edit = mindmapCommand(source, heading, "rename", "New method");
      const revised = applyChanges(source, edit.changes);
      expect(revised).toBe(expected);
      const after = projectMindmap(revised);
      const topology = (projection: typeof before) => {
        const ids = new Map(
          projection.nodes.map((node, index) => [node.id, index]),
        );
        return projection.nodes.map((node) => [
          node.kind,
          node.blockType,
          node.level,
          node.checked,
          node.parentId === null ? null : ids.get(node.parentId),
        ]);
      };
      expect(topology(after)).toEqual(topology(before));
      expect(
        after.nodes.find((node) => node.blockType === "heading")!.label,
      ).toBe("New method");
      expect(revised.slice(0, edit.selection!.head)).toMatch(/New method$/);
    },
  );
  it("applies a newly added empty research heading while retaining all other blocks", () => {
    const source =
      "# Root\n\n## Methods\n\n$$x^2$$\n\n## Results\n\nEvidence\n";
    const methods = find(source, "Methods");
    const inserted = applyChanges(
      source,
      mindmapCommand(source, methods, "child").changes,
    );
    const before = projectMindmap(inserted);
    const added = before.nodes.find((node) => node.level === 3)!;
    const revised = applyChanges(
      inserted,
      mindmapCommand(inserted, added, "rename", "New method").changes,
    );
    expect(revised).toBe(inserted.replace("### \n", "### New method\n"));
    const after = projectMindmap(revised);
    expect(
      after.nodes.map((node) => [node.kind, node.blockType, node.level]),
    ).toEqual(
      before.nodes.map((node) => [node.kind, node.blockType, node.level]),
    );
    expect(
      after.nodes.find((node) => node.label === "New method")!.parentId,
    ).toBe(after.nodes.find((node) => node.label === "Methods")!.id);
    expect(
      after.nodes.find((node) => node.blockType === "mathBlock")!.labelSource,
    ).toBe(
      before.nodes.find((node) => node.blockType === "mathBlock")!.labelSource,
    );
  });
  it("rejects block-structure grammar in inline label edits and root siblings", () => {
    const source = "- A\n- B\n",
      node = find(source, "A");
    for (const value of ["# Heading", "[x] Task", "```python", "> Quote"])
      expect(() => mindmapCommand(source, node, "rename", value)).toThrow(
        "structure",
      );
    expect(() =>
      mindmapCommand(source, projectMindmap(source).nodes[0], "sibling"),
    ).toThrow("root");
  });
  it("fits the full 5,000-node projection rather than cropping a tall tree at 10 percent", () => {
    const map = projectMindmap(
        Array.from({ length: 4999 }, (_, i) => `- Item ${i}\n`).join(""),
      ),
      layout = layoutMindmap(map, { layout: "balanced" });
    expect(layout.nodes).toHaveLength(5000);
    const camera = fitMindmap(layout.bounds, 1200, 800);
    expect(layout.bounds.width * camera.scale).toBeLessThanOrEqual(1200);
    expect(layout.bounds.height * camera.scale).toBeLessThanOrEqual(800);
    expect(camera.scale).toBeGreaterThan(0);
  });
  it("adds a root child outside the last heading's branch", () => {
    for (const source of [
      "# Root\n\n## A\n\nText\n",
      "# A\n\n# B\n",
      "## A\n\nText\n",
    ]) {
      const before = projectMindmap(source),
        edit = mindmapCommand(source, before.nodes[0], "child");
      const next = applyChanges(source, edit.changes),
        map = projectMindmap(next);
      const added = nodeAtMindmapPosition(map, edit.selection!.head);
      expect(added.kind).toBe("heading");
      expect(added.parentId).toBe(map.rootId);
    }
  });
  it("preserves setext labels and long numbered-marker indentation", () => {
    const source = "Title\n=====\n\n9. A\n10. B\n";
    expect(
      applyChanges(
        source,
        mindmapCommand(
          source,
          projectMindmap(source).nodes[0],
          "rename",
          "Revised",
        ).changes,
      ),
    ).toBe(source.replace("Title", "Revised"));
    expect(
      applyChanges(
        source,
        mindmapCommand(source, find(source, "B"), "child").changes,
      ),
    ).toContain("10. B\n    - \n");
  });
  it("uses half-open block positions at an adjacent item boundary", () => {
    const source = "- A\n- B\n",
      map = projectMindmap(source);
    expect(nodeAtMindmapPosition(map, source.indexOf("- B")).label).toBe("B");
    expect(nodeAtMindmapPosition(map, source.length).label).toBe("B");
  });
  it("retains a draft on conflict and follows the exact Yjs span through unrelated changes", () => {
    const doc = new Y.Doc(),
      text = doc.getText("markdown");
    text.insert(0, "- A\n- A\n");
    const undo = new Y.UndoManager(text),
      binding = new NativeBinding(doc, undo, null);
    const target = projectMindmap(binding.source).nodes.filter(
      (n) => n.kind === "item",
    )[1];
    const draft = {
      bookmark: binding.relative({
        anchor: target.labelFrom,
        head: target.labelTo,
      }),
      original: target.labelSource,
      type: target.blockType,
      value: "My draft",
    };
    doc.transact(() => text.insert(0, "# Peer\n\n"), "peer");
    expect(
      resolveMindmapDraft(binding, projectMindmap(binding.source), draft)
        ?.label,
    ).toBe("A");
    const range = binding.absolute(draft.bookmark)!;
    doc.transact(() => {
      text.delete(range.anchor, range.head - range.anchor);
      text.insert(range.anchor, "Changed");
    }, "peer");
    expect(
      resolveMindmapDraft(binding, projectMindmap(binding.source), draft),
    ).toBeNull();
    expect(draft.value).toBe("My draft");
    undo.destroy();
    doc.destroy();
  });
  it("caches only the current projection and never folds a different block type at the same offset", () => {
    const compute = createMindmapComputer(),
      source = "# Root\n\n- Parent\n  - Child\n";
    const parent = find(source, "Parent"),
      base = {
        source,
        title: "File",
        settings: defaultMindmapSettings,
        folds: [],
        sizes: {},
      };
    const a = compute({ ...base, id: 1 }),
      b = compute({
        ...base,
        id: 2,
        settings: { ...defaultMindmapSettings, layout: "balanced" },
      });
    expect(a.projection).toBe(b.projection);
    const c = compute({
      ...base,
      id: 3,
      folds: [{ position: parent.from, type: "heading" }],
    });
    expect(c.layout?.nodes).toHaveLength(3);
    const folded = compute({
      ...base,
      id: 4,
      folds: [{ position: parent.from, type: "item" }],
    });
    expect(folded.layout?.nodes).toHaveLength(2);
    expect(
      compute({ ...base, id: 5, source: source + "- More\n" }).projection,
    ).not.toBe(a.projection);
    expect(
      compute({ ...base, id: 6, source: "x".repeat(1_000_001) }).error,
    ).toContain("limit");
  });
});
describe("private-free bounded mind-map exports", () => {
  it("keeps original Markdown exact and branch definitions available", () => {
    const source =
      "\ufeff---\r\ntitle: Paper\r\n---\r\n# Root\r\n\r\n## A\r\n\r\n[Evidence][r][^n]\r\n\r\n## B\r\n\r\nOther\r\n\r\n[r]: https://example.test\r\n\r\n[^n]: Source\r\n";
    const projection = projectMindmap(source),
      branch = find(source, "A");
    expect(mindmapMarkdown(source, projection)).toBe(source);
    const excerpt = mindmapMarkdown(source, projection, branch.id);
    expect(excerpt).toContain("## A\r\n");
    expect(excerpt).toContain("[r]: https://example.test");
    expect(excerpt).toContain("[^n]: Source");
    expect(excerpt).not.toContain("## B");
    expect(mindmapBranch(projection, branch.id).nodes[0].parentId).toBeNull();
    expect(() => mindmapBranch(projection, "deleted")).toThrow();
  });
  it("escapes hostile labels/styles and embeds only explicit PNG captures", () => {
    const source = "# Root\n\n- </text><script>alert(1)</script>\n",
      map = projectMindmap(source),
      layout = layoutMindmap(map);
    const svg = mindmapSvg(
      map,
      layout,
      { ...style, font: 'serif" onload="evil' },
      new Map([[map.rootId, 'data:image/svg+xml,<svg onload="evil"/>']]),
    );
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain('href="data:image/svg');
    expect(svg).toContain("&lt;");
    expect(svg).toContain("serif&quot; onload=&quot;evil");
    expect(
      mindmapHtml(svg, "</title><script>evil</script>").match(/<script>/g),
    ).toHaveLength(1);
    expect(
      mindmapSvg(
        map,
        layout,
        style,
        new Map([[map.rootId, "data:image/png;base64,AAAA"]]),
      ),
    ).toContain('href="data:image/png;base64,AAAA"');
  });
  it("wraps long tokens and reserves all text lines instead of silently truncating", () => {
    const label = "LongLabel".repeat(20),
      lines = wrapMindmapLabel(label, 180, 22);
    expect(lines.join("")).toBe(label);
    expect(Math.max(...lines.map((n) => n.length))).toBeLessThanOrEqual(12);
    const map = projectMindmap("- " + label + "\n"),
      sizes = Object.fromEntries(
        map.nodes.map((n) => [n.id, estimateMindmapLabel(n.label, 180, 22)]),
      );
    const svg = mindmapSvg(
      map,
      layoutMindmap(map, { nodeWidth: 180 }, [], sizes),
      { ...style, fontSize: 22 },
    );
    expect(svg.match(/<tspan/g)!.length).toBeGreaterThan(4);
  });
  it("offline HTML folds, expands, zooms and pans with finite bounds while preserving a node click", () => {
    type FakeElement = {
      dataset: Record<string, string>;
      style: Record<string, string>;
      attributes: Record<string, string>;
      onclick?: (event?: unknown) => void;
      onkeydown?: (event: { key: string; preventDefault: () => void }) => void;
      setAttribute: (name: string, value: string) => void;
    };
    const element = (dataset: Record<string, string>): FakeElement => ({
      dataset,
      style: {},
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    });
    const root = element({ node: "r", parent: "" }),
      child = element({ node: "c", parent: "r" }),
      edge = element({ edge: "c", parent: "r" });
    const buttons = Object.fromEntries(
      ["fit", "in", "out", "expand"].map((id) => [id, element({})]),
    );
    const captures = new Set<number>(),
      attributes = { viewBox: "0 0 100 80" };
    const svg = {
      getAttribute: (name: string) => attributes[name as "viewBox"],
      setAttribute: (name: string, value: string) => {
        attributes[name as "viewBox"] = value;
      },
      querySelectorAll: (selector: string) =>
        selector === "[data-node]" ? [root, child] : [edge],
      hasPointerCapture: (id: number) => captures.has(id),
      setPointerCapture: (id: number) => captures.add(id),
      releasePointerCapture: (id: number) => captures.delete(id),
      getBoundingClientRect: () => ({ width: 100, height: 80 }),
    };
    runInNewContext(mindmapHtmlScript, {
      document: {
        querySelector: () => svg,
        getElementById: (id: string) => buttons[id],
      },
      setTimeout: () => 0,
    });
    const events = svg as typeof svg & {
      onpointerdown: (e: unknown) => void;
      onpointermove: (e: unknown) => void;
      onpointerup: (e: unknown) => void;
    };
    events.onpointerdown({ button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    expect(captures.size).toBe(0);
    root.onclick!();
    expect(child.style.display).toBe("none");
    expect(edge.style.display).toBe("none");
    buttons.expand.onclick!();
    expect(child.style.display).toBe("");
    root.onkeydown!({ key: "Enter", preventDefault: () => {} });
    expect(child.style.display).toBe("none");
    events.onpointermove({ clientX: 10, clientY: 10, pointerId: 1 });
    expect(captures.has(1)).toBe(true);
    events.onpointerup({ pointerId: 1 });
    expect(captures.size).toBe(0);
    buttons.in.onclick!();
    expect(
      attributes.viewBox.split(/\s+/).map(Number).every(Number.isFinite),
    ).toBe(true);
    for (let i = 0; i < 100; i++) buttons.out.onclick!();
    expect(Number(attributes.viewBox.split(" ")[2])).toBeLessThanOrEqual(2000);
    buttons.fit.onclick!();
    expect(attributes.viewBox).toBe("0 0 100 80");
  });
});
