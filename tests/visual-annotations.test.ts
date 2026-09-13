import { expect, test } from "vitest";
import * as Y from "yjs";
import { NativeBinding } from "../packages/editor/src/binding";
import { parseMarkdown } from "../packages/markdown/src/index";
import { markdownVisuals, visualNodes } from "../apps/web/lib/visual-assets";
import {
  fitVisual,
  appendVisualPoint,
  initialVisualTransform,
  screenToVisual,
  visualToScreen,
  zoomVisual,
} from "../apps/web/lib/visual-geometry";
import {
  samePlacement,
  sameVisualSource,
  moveShape,
  visualWriteSchema,
  type VisualPlacement,
  type VisualShape,
} from "../packages/shared/src/visual-annotations";
const id = "11111111-1111-4111-8111-111111111111";
test("freehand sampling retains endpoints without an unbounded path", () => {
  let points: [number, number][] = [[0, 0]];
  for (let i = 1; i <= 8000; i++)
    points = appendVisualPoint(points, [i / 8000, 0.5]);
  expect(points.length).toBeLessThanOrEqual(2000);
  expect(points[0]).toEqual([0, 0]);
  expect(points.at(-1)).toEqual([1, 0.5]);
});
test("a gallery keeps identical image placements distinct and includes nested Mermaid", () => {
  const source =
    "![Plot](/a.png)\n\n> ![Plot](/a.png)\n\n```mermaid\ngraph TD; A-->B\n```\n\n[^n]: ![Footnote](/b.png)";
  const list = markdownVisuals(parseMarkdown(source), source);
  expect(list.map((i) => i.kind)).toEqual([
    "image",
    "image",
    "mermaid",
    "image",
  ]);
  expect(new Set(list.map((i) => i.id)).size).toBe(4);
  expect(visualNodes(parseMarkdown("![bad](javascript:alert)"))).toHaveLength(
    1,
  );
  expect(
    markdownVisuals(parseMarkdown("![bad](javascript:alert)"), ""),
  ).toHaveLength(0);
});
for (const rotation of [0, 90, 180, 270])
  for (const flipX of [false, true])
    for (const flipY of [false, true])
      test(`markup inverse transform ${rotation}/${flipX}/${flipY}`, () => {
        const t = { zoom: 2.7, x: -82, y: 71, rotation, flipX, flipY };
        for (const p of [
          [0, 0],
          [1, 1],
          [0.3, 0.78],
          [0.5, 0.5],
        ] as [number, number][]) {
          const at = screenToVisual(
            visualToScreen(p, 1100, 720, t),
            1100,
            720,
            t,
          );
          expect(at[0]).toBeCloseTo(p[0], 12);
          expect(at[1]).toBeCloseTo(p[1], 12);
        }
      });
test("pointer-centered zoom keeps the same image point under the pointer", () => {
  const t = { ...initialVisualTransform(), zoom: 0.6, x: 44, y: -100 },
    pointer: [number, number] = [177, -52],
    point = screenToVisual(pointer, 1600, 1000, t, false),
    next = zoomVisual(t, 3, pointer);
  expect(visualToScreen(point, 1600, 1000, next)[0]).toBeCloseTo(pointer[0]);
  expect(visualToScreen(point, 1600, 1000, next)[1]).toBeCloseTo(pointer[1]);
  expect(zoomVisual(t, Infinity).zoom).toBe(1);
  expect(fitVisual(100, 100, 1000, 1000)).toBe(1);
  expect(fitVisual(2000, 1000, 1000, 600)).toBeCloseTo(0.476);
});
test("moving shapes clamps the whole shape rather than distorting edges", () => {
  const shape: VisualShape = {
    kind: "rectangle",
    points: [
      [0.2, 0.3],
      [0.6, 0.7],
    ],
    color: "#aabbcc",
    stroke: 2,
    text: "",
  };
  const moved = moveShape(shape, [0.8, -0.8]).points;
  expect(moved[0][0]).toBeCloseTo(0.6, 12);
  expect(moved[0][1]).toBe(0);
  expect(moved[1][0]).toBe(1);
  expect(moved[1][1]).toBeCloseTo(0.4, 12);
});
test("placement identity is independent of URL, and Y anchors survive edits before images", () => {
  const doc = new Y.Doc(),
    text = doc.getText("markdown");
  text.insert(0, "intro\n\n![Plot](/a.png)");
  const undo = new Y.UndoManager(text),
    binding = new NativeBinding(doc, undo, null);
  const capture = (): VisualPlacement => {
    const node = visualNodes(parseMarkdown(text.toString()))[0];
    return {
      resourceId: id,
      path: [],
      anchor: {
        start: [
          ...Y.encodeRelativePosition(
            Y.createRelativePositionFromTypeIndex(text, node.from),
          ),
        ],
        end: [
          ...Y.encodeRelativePosition(
            Y.createRelativePositionFromTypeIndex(text, node.to, -1),
          ),
        ],
        generation: 1,
        quote: "",
      },
      from: node.from,
      to: node.to,
    };
  };
  const first = capture();
  text.insert(0, "peer insertion\n");
  expect(samePlacement(first, capture())).toBe(true);
  expect(samePlacement(first, { ...capture(), path: ["another-card"] })).toBe(
    false,
  );
  const node = visualNodes(parseMarkdown(text.toString()))[0];
  text.delete(node.from, node.to - node.from);
  text.insert(node.from, "![Plot](/a.png)");
  expect(samePlacement(first, capture())).toBe(false);
  binding.destroy();
  undo.destroy();
  doc.destroy();
});
test("source identity detects geometry changes and never depends on the viewer zoom", () => {
  const source = {
    kind: "mermaid" as const,
    width: 200,
    height: 100,
    label: "diagram",
    fingerprint: "a",
    verified: true,
  };
  expect(sameVisualSource(source, { ...source, label: "another label" })).toBe(
    true,
  );
  expect(sameVisualSource(source, { ...source, width: 201 })).toBe(false);
  expect(sameVisualSource(source, { ...source, fingerprint: "b" })).toBe(false);
});
test("annotation payloads are bounded and private by default", () => {
  const value = {
    id,
    version: 0,
    mutationId: id,
    placement: { resourceId: id },
    source: {
      kind: "image",
      fingerprint: "a",
      width: 100,
      height: 100,
      label: "Image",
      verified: true,
    },
    shape: {
      kind: "rectangle",
      points: [
        [0.1, 0.1],
        [0.4, 0.8],
      ],
      color: "#112233",
    },
  };
  expect(visualWriteSchema.parse(value).visibility).toBe("private");
  expect(
    visualWriteSchema.safeParse({
      ...value,
      shape: {
        ...value.shape,
        points: [
          [0, 0],
          [1.1, 1],
        ],
      },
    }).success,
  ).toBe(false);
  expect(
    visualWriteSchema.safeParse({
      ...value,
      shape: { ...value.shape, points: [[0, 0]] },
    }).success,
  ).toBe(false);
  expect(
    visualWriteSchema.safeParse({ ...value, body: "x".repeat(10001) }).success,
  ).toBe(false);
});
