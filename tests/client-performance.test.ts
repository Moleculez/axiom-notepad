import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseMarkdown, renderDocument } from "../packages/markdown/src";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { LatestFrame, LatestThrottle } from "../apps/web/lib/latest-frame";
import { visualLookup, visualPlacementKey } from "../apps/web/lib/visual-index";
import {
  samePlacement,
  type VisualPlacement,
} from "../packages/shared/src/visual-annotations";
import {
  PdfSearchTextCache,
  pdfSearchText,
  closePdfSearchText,
  overlappingPdfSpans,
} from "../apps/web/lib/pdf-search-cache";
import { readHeadingAt } from "../apps/web/lib/read-outline";
import { canvasSizingSnapshot } from "../apps/web/lib/tools/canvas-presence";
import { canvasSizingOwner } from "../packages/shared/src/canvas-sizing";

function frames<T>(apply: (sample: T) => void) {
  const pending = new Map<number, FrameRequestCallback>();
  let serial = 0;
  const queue = new LatestFrame(
    apply,
    (callback) => {
      pending.set(++serial, callback);
      return serial;
    },
    (id) => pending.delete(id),
  );
  return {
    queue,
    pending,
    paint: () => {
      for (const callback of [...pending.values()]) callback(0);
    },
  };
}
describe("presentation frame boundaries", () => {
  it("100 pointer samples queue one preview, then release consumes the exact final sample before a single write", () => {
    const events: string[] = [];
    const f = frames<number>((value) => events.push(`preview:${value}`));
    for (let i = 0; i < 100; i++) f.queue.push(i);
    expect(f.pending.size).toBe(1);
    f.paint();
    expect(events).toEqual(["preview:99"]);
    f.queue.push(100);
    f.queue.flush(101);
    events.push("write:101");
    expect(events).toEqual(["preview:99", "preview:101", "write:101"]);
    expect(f.pending.size).toBe(0);
  });
  it("cancel never paints or persists a pending pointer", () => {
    const apply = vi.fn(),
      f = frames(apply);
    f.queue.push("draft");
    f.queue.cancel();
    f.paint();
    expect(apply).not.toHaveBeenCalled();
    expect(f.pending.size).toBe(0);
  });
  it("callbacks can queue the next frame without losing the sample", () => {
    const values: number[] = [];
    const f = frames<number>((value) => {
      values.push(value);
      if (value === 1) f.queue.push(2);
    });
    f.queue.push(1);
    f.paint();
    f.paint();
    expect(values).toEqual([1, 2]);
  });
  it("presence is limited to 20Hz and retains the final position without an extra source write", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      const apply = vi.fn(),
        throttle = new LatestThrottle<number>(apply);
      throttle.push(0);
      for (let i = 1; i <= 100; i++) {
        vi.advanceTimersByTime(1);
        throttle.push(i);
      }
      vi.advanceTimersByTime(50);
      expect(apply.mock.calls.map(([position]) => position)).toEqual([
        0, 49, 99, 100,
      ]);
      throttle.push(101);
      throttle.cancel();
      vi.advanceTimersByTime(100);
      expect(apply).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
describe("visual reconciliation indexes", () => {
  it("initial and updated native Read projections retain image/diagram viewer identities without changing source", () => {
    const view = readFileSync("apps/web/lib/editor-vnext/view.ts", "utf8");
    const renders = [
      ...view.matchAll(
        /if \(this\.mode === "read"\) \{\s*this\.content\.innerHTML = renderDocument\(this\.parsed, \{([\s\S]*?)\}\);/g,
      ),
    ];
    expect(renders).toHaveLength(2);
    for (const render of renders) expect(render[1]).toContain("visuals: true");
    const source =
        "![Figure](/figure.svg)\n\n```mermaid\ngraph TD; A --> B\n```\n",
      parsed = parseMarkdown(source),
      snapshot = JSON.stringify(parsed),
      html = renderDocument(parsed, {
        visuals: true,
        blockMarks: true,
        scrollTables: true,
      });
    expect(html).toContain('data-visual-kind="image"');
    expect(html).toContain('data-visual-kind="mermaid"');
    expect(html).toContain('data-visual-from="0"');
    expect(JSON.stringify(parsed)).toBe(snapshot);
  });
  it("preserves first id OR position match instead of preferring id", () => {
    const values = [
      { id: "a", from: 8 },
      { id: "b", from: 3 },
      { id: "a", from: 3 },
    ];
    const lookup = visualLookup(values, (v) => v);
    for (const id of ["a", "b", "missing"])
      for (const from of [3, 8, undefined, NaN])
        expect(lookup({ id, from })).toBe(
          values.find(
            (v) => v.id === id || (from !== undefined && v.from === from),
          ),
        );
  });
  it("indexes 1,000 visuals once for 1,000 lookups", () => {
    const values = Array.from({ length: 1000 }, (_, i) => ({
      id: String(i),
      from: i * 20,
    }));
    const identify = vi.fn((value: (typeof values)[number]) => value);
    const lookup = visualLookup(values, identify);
    for (const value of values) expect(lookup(value)).toBe(value);
    expect(identify).toHaveBeenCalledTimes(1000);
  });
  it("placement count keys agree with existing equality for anchors, paths, versions and revisions", () => {
    const base: VisualPlacement = {
      resourceId: "11111111-1111-4111-8111-111111111111",
      path: [],
      from: 0,
      to: 4,
    };
    const anchor = {
      start: [1, 2],
      end: [3, 4],
      generation: 1,
      quote: "old",
      kind: "block" as const,
    };
    const values = [
      base,
      { ...base, path: ["nested"] },
      { ...base, versionId: "v1" },
      { ...base, revision: "r1" },
      { ...base, from: 1 },
      { ...base, anchor },
      {
        ...base,
        anchor: { ...anchor, quote: "changed", kind: "text" as const },
      },
      { ...base, anchor: { ...anchor, generation: 2 } },
      { ...base, anchor: { ...anchor, start: [1, 3] } },
    ];
    for (const a of values)
      for (const b of values)
        expect(visualPlacementKey(a) === visualPlacementKey(b)).toBe(
          samePlacement(a, b),
        );
  });
});
describe("bounded document-only PDF search text", () => {
  it("shares concurrent extraction and retains warm text", async () => {
    const extract = vi.fn(async () => "warm");
    const cache = new PdfSearchTextCache(extract);
    const first = cache.get(1),
      second = cache.get(1);
    expect(first).toBe(second);
    expect(await first).toBe("warm");
    expect(await cache.get(1)).toBe("warm");
    expect(extract).toHaveBeenCalledTimes(1);
    expect(cache.stats).toEqual({ bytes: 8, pages: 1, pending: 0 });
  });
  it("bounds UTF-16 bytes and pages with least-recently-used eviction", async () => {
    const extract = vi.fn(async (page: number) =>
      page === 4 ? "too long" : "ab",
    );
    const cache = new PdfSearchTextCache(extract, 8, 2);
    await cache.get(1);
    await cache.get(2);
    await cache.get(1);
    await cache.get(3);
    await cache.get(1);
    expect(extract).toHaveBeenCalledTimes(3);
    await cache.get(2);
    expect(extract).toHaveBeenCalledTimes(4);
    await cache.get(4);
    await cache.get(4);
    expect(extract).toHaveBeenCalledTimes(6);
    expect(cache.stats).toEqual({ bytes: 8, pages: 2, pending: 0 });
  });
  it("enforces the production 16MiB and 256-page limits independently", async () => {
    const text = "x".repeat(128 * 1024),
      bytes = new PdfSearchTextCache(async () => text),
      pages = new PdfSearchTextCache(async () => "");
    for (let page = 1; page <= 257; page++) {
      await bytes.get(page);
      await pages.get(page);
    }
    expect(bytes.stats).toEqual({
      bytes: 16 * 1024 * 1024,
      pages: 64,
      pending: 0,
    });
    expect(pages.stats).toEqual({ bytes: 0, pages: 256, pending: 0 });
    bytes.dispose();
    pages.dispose();
  });
  it("empty pages are cached but cannot bypass the page limit", async () => {
    const extract = vi.fn(async () => ""),
      cache = new PdfSearchTextCache(extract, 16, 2);
    await cache.get(1);
    await cache.get(2);
    await cache.get(3);
    expect(cache.stats.pages).toBe(2);
    await cache.get(1);
    expect(extract).toHaveBeenCalledTimes(4);
  });
  it("failed extraction can retry; disposal prevents pending results repopulating", async () => {
    const extract = vi
      .fn()
      .mockRejectedValueOnce(new Error("broken"))
      .mockResolvedValueOnce("retry");
    const cache = new PdfSearchTextCache(extract);
    await expect(cache.get(1)).rejects.toThrow("broken");
    expect(await cache.get(1)).toBe("retry");
    let complete!: (text: string) => void;
    const late = new PdfSearchTextCache(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = late.get(2);
    await Promise.resolve();
    late.dispose();
    complete("late");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(late.stats).toEqual({ pages: 0, bytes: 0, pending: 0 });
    await expect(late.get(2)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("different document proxies cannot share text, even for the same page", async () => {
    const create = (text: string) =>
      ({
        getPage: vi.fn(async () => ({
          getTextContent: async () => ({
            items: [{ str: text }, { type: "mark" }],
          }),
        })),
      }) as unknown as PDFDocumentProxy;
    const a = create("A"),
      b = create("B");
    expect(await pdfSearchText(a, 1)).toBe("A");
    expect(await pdfSearchText(b, 1)).toBe("B");
    closePdfSearchText(a);
    await expect(pdfSearchText(a, 1)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(await pdfSearchText(b, 1)).toBe("B");
    closePdfSearchText(b);
  });
  it("finds only overlapping spans, including separators and empty spans", () => {
    const spans = [
      { start: 0, text: "ab" },
      { start: 3, text: "" },
      { start: 4, text: "cde" },
      { start: 8, text: "f" },
    ];
    for (let start = 0; start <= 9; start++)
      for (let end = start; end <= 9; end++)
        expect(overlappingPdfSpans(spans, start, end)).toEqual(
          spans.filter(
            (span) => span.start < end && span.start + span.text.length > start,
          ),
        );
  });
  it("1,000 matches across 10,000 spans avoid 10 million span inspections", () => {
    let inspections = 0;
    const spans = Array.from({ length: 10000 }, (_, i) => ({
      start: i * 4,
      get text() {
        inspections++;
        return "abc";
      },
    }));
    for (let i = 0; i < 1000; i++)
      expect(overlappingPdfSpans(spans, i * 40, i * 40 + 2)).toHaveLength(1);
    expect(inspections).toBeLessThan(20000);
  });
});
it("cached outline lookup matches the legacy scan without reading all heading offsets", () => {
  let reads = 0;
  const headings = Array.from({ length: 4096 }, (_, i) => ({
    id: `h${i}`,
    get top() {
      reads++;
      return i * 100;
    },
  }));
  expect(readHeadingAt(headings, 180450, "h0")).toBe("h1804");
  expect(reads).toBeLessThan(15);
  expect(readHeadingAt(headings, -1, "h0")).toBe("h0");
  expect(readHeadingAt([], 0, null)).toBeNull();
});
it("cursor packets do not change Canvas sizing membership; indexed election matches the canonical owner", () => {
  const states = new Map([
    [
      9,
      {
        canvasSizing: { writable: true, activeCard: null },
        canvas: { x: 0, y: 0 },
      },
    ],
    [
      2,
      {
        canvasSizing: { writable: true, activeCard: "a" },
        canvas: { x: 0, y: 0 },
      },
    ],
    [
      1,
      {
        canvasSizing: { writable: false, activeCard: "a" },
        canvas: { x: 0, y: 0 },
      },
    ],
  ]);
  const initial = canvasSizingSnapshot(states);
  for (let i = 0; i < 100; i++) {
    states.get(9)!.canvas = { x: i, y: i * 2 };
    expect(canvasSizingSnapshot(states).key).toBe(initial.key);
  }
  for (const id of ["a", "b"])
    expect(initial.owners.get(id) ?? initial.fallback).toBe(
      canvasSizingOwner(states, id),
    );
  states.get(9)!.canvasSizing.activeCard = "b";
  const updated = canvasSizingSnapshot(states);
  expect(updated.key).not.toBe(initial.key);
  expect(updated.owners.get("b")).toBe(9);
});
