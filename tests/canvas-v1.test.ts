import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { XMLValidator } from "fast-xml-parser";
import {
  applyCanvasCommands,
  canvasPort,
  canvasTitle,
  exportJsonCanvas,
  parseCanvas,
  readCanvas,
  seedCanvas,
  type CanvasNode,
} from "../packages/shared/src/canvas";
import {
  arrangeCanvas,
  canvasConnectionTarget,
  canvasEdgeGeometry,
  canvasSides,
} from "../packages/shared/src/canvas-geometry";
import { canvasSizingOwner } from "../packages/shared/src/canvas-sizing";
import {
  canvasExportBounds,
  canvasMarkdown,
  canvasSnapshotSvg,
  validateCanvasImageSize,
} from "../packages/shared/src/canvas-export";
import { embeddableCanvasUrl } from "../packages/shared/src/canvas-preview";
import {
  cloneCanvasSelection,
  decodeCanvasClipboard,
  encodeCanvasClipboard,
  selectedCanvas,
} from "../apps/web/lib/tools/canvas-clipboard";
import { developmentResetTargets } from "../packages/shared/src/development-reset";
const node = (id: string, x = 0, y = 0): CanvasNode => ({
  id,
  type: "text",
  text: `# ${id}`,
  x,
  y,
  width: 300,
  height: 200,
});
function samplePath(source: string) {
  const tokens = source.match(/[MLCQ]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!,
    points: { x: number; y: number }[] = [];
  let index = 0,
    at = { x: 0, y: 0 };
  const point = () => ({
    x: Number(tokens[index++]),
    y: Number(tokens[index++]),
  });
  while (index < tokens.length) {
    const kind = tokens[index++],
      a = at;
    if (kind === "M") {
      at = point();
      points.push(at);
      continue;
    }
    const b = point(),
      c = kind !== "L" ? point() : b,
      d = kind === "C" ? point() : c;
    for (let i = 1; i <= 80; i++) {
      const t = i / 80,
        s = 1 - t;
      points.push(
        kind === "L"
          ? { x: s * a.x + t * b.x, y: s * a.y + t * b.y }
          : kind === "Q"
            ? {
                x: s * s * a.x + 2 * s * t * b.x + t * t * c.x,
                y: s * s * a.y + 2 * s * t * b.y + t * t * c.y,
              }
            : {
                x:
                  s ** 3 * a.x +
                  3 * s * s * t * b.x +
                  3 * s * t * t * c.x +
                  t ** 3 * d.x,
                y:
                  s ** 3 * a.y +
                  3 * s * s * t * b.y +
                  3 * s * t * t * c.y +
                  t ** 3 * d.y,
              },
      );
    }
    at = d;
  }
  return points;
}
describe("Canvas v1 geometry and editing", () => {
  for (const fromSide of canvasSides)
    for (const toSide of canvasSides)
      it(`routes ${fromSide} → ${toSide} outward around endpoints`, () => {
        for (const [x, y] of [
          [600, 0],
          [-600, 0],
          [0, 500],
          [0, -500],
          [480, 330],
        ]) {
          const from = node("a"),
            to = node("b", x, y),
            g = canvasEdgeGeometry(from, to, fromSide, toSide),
            points = samplePath(g.d);
          expect(points[0]).toEqual(canvasPort(from, fromSide));
          expect(points.at(-1)).toEqual(canvasPort(to, toSide));
          expect(
            points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
          ).toBe(true);
          for (const card of [from, to])
            expect(
              points.some(
                (p) =>
                  p.x > card.x + 0.01 &&
                  p.x < card.x + card.width - 0.01 &&
                  p.y > card.y + 0.01 &&
                  p.y < card.y + card.height - 0.01,
              ),
              `${fromSide} ${toSide} at ${x},${y}`,
            ).toBe(false);
        }
      });
  it("selects actual ports with screen-sized magnets and excludes the origin", () => {
    const a = node("a", 600),
      b = node("b");
    for (const zoom of [0.1, 1, 3])
      for (const side of canvasSides) {
        const p = canvasPort(b, side),
          target = canvasConnectionTarget(
            [a, b],
            { x: p.x + 8 / zoom, y: p.y },
            zoom,
            "a",
          );
        expect(target?.node.id).toBe("b");
        expect(target?.side).toBe(side);
      }
    expect(
      canvasConnectionTarget([a], canvasPort(a, "right"), 1, "a"),
    ).toBeNull();
  });
  it("aligns and distributes without changing locked geometry", () => {
    const nodes = [
      node("a"),
      node("b", 450, 30),
      node("c", 1200, 100),
      { ...node("locked", 10000), locked: true },
    ];
    expect(arrangeCanvas(nodes, "left")).toEqual(
      nodes
        .slice(0, 3)
        .map((n) => ({ type: "update-node", id: n.id, changes: { x: 0 } })),
    );
    expect(arrangeCanvas(nodes, "horizontal")[1]).toMatchObject({
      id: "b",
      changes: { x: 600 },
    });
  });
  it("elects an active writable editor, then the smallest writer", () => {
    const states: [
      number,
      { canvasSizing: { writable: boolean; activeCard?: string } },
    ][] = [
      [9, { canvasSizing: { writable: true } }],
      [2, { canvasSizing: { writable: true } }],
      [1, { canvasSizing: { writable: false, activeCard: "a" } }],
      [7, { canvasSizing: { writable: true, activeCard: "a" } }],
    ];
    expect(canvasSizingOwner(states, "a")).toBe(7);
    expect(canvasSizingOwner(states, "b")).toBe(2);
    expect(canvasSizingOwner([], "a")).toBeNull();
  });
  it("derived sizes stay out of author-local undo", () => {
    const doc = new Y.Doc();
    seedCanvas(doc, {
      nodes: [{ ...node("a"), heightMode: "auto" }],
      edges: [],
    });
    const undo = new Y.UndoManager(doc.getMap("canvas"), {
      trackedOrigins: new Set(["local"]),
    });
    applyCanvasCommands(
      doc,
      [{ type: "update-node", id: "a", changes: { title: "Named" } }],
      "local",
    );
    applyCanvasCommands(
      doc,
      [{ type: "update-node", id: "a", changes: { height: 450 } }],
      "canvas-auto-size",
    );
    undo.undo();
    expect(readCanvas(doc).nodes[0]).toMatchObject({ height: 450 });
    expect(readCanvas(doc).nodes[0].title).toBeUndefined();
    undo.destroy();
    doc.destroy();
  });
  it("clipboard remaps internal connections and retains research metadata", () => {
    const source = {
      nodes: [
        {
          ...node("a"),
          title: "Alpha",
          tags: ["physics"],
          heightMode: "auto" as const,
        },
        node("b", 500),
        node("c", 900),
      ],
      edges: [
        { id: "ab", fromNode: "a", toNode: "b" },
        { id: "bc", fromNode: "b", toNode: "c" },
      ],
    };
    const picked = selectedCanvas(source, ["a", "b"]),
      decoded = decodeCanvasClipboard(encodeCanvasClipboard(picked))!,
      copied = cloneCanvasSelection(decoded, { x: 100, y: 200 });
    expect(copied.nodes).toHaveLength(2);
    expect(copied.nodes[0]).toMatchObject({
      x: 100,
      y: 200,
      title: "Alpha",
      tags: ["physics"],
      heightMode: "auto",
    });
    expect(copied.nodes[0].id).not.toBe("a");
    expect(copied.edges).toHaveLength(1);
    expect(copied.edges[0].fromNode).toBe(copied.nodes[0].id);
    expect(decodeCanvasClipboard("Ordinary text")).toBeNull();
  });
  it("keeps explicit card titles separate from Markdown and validates future versions", () => {
    expect(canvasTitle({ ...node("a"), title: "Card title" })).toBe(
      "Card title",
    );
    const value = parseCanvas('{"nodes":[],"edges":[]}');
    expect(value.schemaVersion).toBe(1);
    expect(JSON.parse(exportJsonCanvas(value))).not.toHaveProperty(
      "schemaVersion",
    );
    expect(() => parseCanvas('{"schemaVersion":2}')).toThrow(/unsupported/);
    expect(() => parseCanvas("null")).toThrow();
  });
});
describe("Canvas exports and boundaries", () => {
  it("produces escaped standalone SVG with geometry and readable Markdown", () => {
    const data = {
      nodes: [{ ...node("a"), title: '<unsafe & "name">' }, node("b", 600)],
      edges: [
        { id: "ab", fromNode: "a", toNode: "b", label: '<label & "value">' },
      ],
    };
    const bounds = canvasExportBounds(data, 32),
      svg = canvasSnapshotSvg(data, bounds, new Map(), {
        surface: "#ffffff",
        border: "#cccccc",
        text: "#222222",
        muted: "#555555",
      });
    expect(XMLValidator.validate(svg)).toBe(true);
    expect(svg).toContain("&lt;unsafe &amp; &quot;name&quot;&gt;");
    expect(svg).not.toContain("<unsafe");
    expect(svg).toContain("marker-end");
    expect(canvasMarkdown(data)).toContain("## Connections");
  });
  it("bounds raster memory and includes edge detours", () => {
    expect(() =>
      validateCanvasImageSize({ x: 0, y: 0, width: 10000, height: 10000 }, 1),
    ).toThrow(/32 megapixels/);
    expect(() =>
      validateCanvasImageSize({ x: 0, y: 0, width: 100, height: 100 }, 0),
    ).toThrow(/resolution/);
    const data = {
      nodes: [node("a", 600), node("b")],
      edges: [
        {
          id: "ab",
          fromNode: "a",
          toNode: "b",
          fromSide: "right" as const,
          toSide: "right" as const,
        },
      ],
    };
    const bounds = canvasExportBounds(data, 32);
    expect(bounds.width).toBeGreaterThan(900 + 64);
    expect(bounds.height).toBeGreaterThanOrEqual(200 + 64);
  });
  it.each([
    "http://example.org",
    "https://localhost",
    "https://127.0.0.1",
    "https://192.168.1.1",
    "https://[::1]",
    "https://host.local",
    "https://user:pass@example.org",
    "https://axiom.test/path",
    "javascript:alert(1)",
  ])("does not embed unsafe/local URL %s", (value) =>
    expect(embeddableCanvasUrl(value, "https://axiom.test")).toBeNull(),
  );
  it("allows an explicit external HTTPS embed without proxying it", () =>
    expect(
      embeddableCanvasUrl("https://example.org/paper", "https://axiom.test"),
    ).toBe("https://example.org/paper"));
  it("refuses reset targets outside the exact main development pair", () => {
    const root = "/workspace/notepad",
      storage = root + "/data/attachments",
      base = "postgresql://owner:password@127.0.0.1:54329/axiom";
    expect(developmentResetTargets(root, base, storage).database).toBe("axiom");
    for (const target of [
      base.replace("/axiom", "/axiom_test"),
      base.replace("127.0.0.1", "database.example.org"),
      base.replace("54329", "5432"),
    ])
      expect(() => developmentResetTargets(root, target, storage)).toThrow();
    for (const path of [
      root,
      root + "/data",
      root + "/data/test-attachments",
      "/",
    ])
      expect(() => developmentResetTargets(root, base, path)).toThrow();
    expect(() => developmentResetTargets(root, base, storage, "s3")).toThrow();
    expect(() =>
      developmentResetTargets(root, base, storage, "local", true),
    ).toThrow();
  });
});
