import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../packages/markdown/src/parser";
import {
  NavigationIndex,
  minimapLayout,
  minimapWidth,
  minimapY,
  minimapBlocks,
  clusteredMarkers,
  clamp,
  type NavigationBlock,
} from "../packages/editor/src/minimap";
import {
  minimapDefaults,
  minimapPreferencesSchema,
  editorAppearanceKey,
} from "../packages/shared/src/minimap";
import {
  defaults,
  preferencesSchema,
  appearanceForClient,
  APPEARANCE_SCHEMA,
  APPEARANCE_SCHEMA_HEADER,
} from "../packages/shared/src/appearance";

const block = (
  from: number,
  to: number,
  top: number,
  bottom: number,
  type = "paragraph",
): NavigationBlock => ({ from, to, top, bottom, type, left: 10, right: 610 });
describe("document minimap", () => {
  it("is opt-in without sacrificing default navigation layers", () => {
    expect(defaults.minimap).toEqual(minimapDefaults);
    expect(minimapDefaults).toMatchObject({
      enabled: false,
      write: true,
      source: true,
      read: true,
      width: 120,
      side: "right",
      size: "fit",
      rendering: "text",
    });
  });
  it("migrates v7 and down-projects all supported readers without restyling", () => {
    const { minimap: _map, pdfReader: _pdf, ...previous } = defaults;
    const old = {
      ...previous,
      schemaVersion: 7,
      proseSize: 25,
      readingMarkOverview: false,
      blockGuides: false,
    };
    const upgraded = preferencesSchema.parse(old);
    expect(upgraded).toEqual({
      ...old,
      schemaVersion: APPEARANCE_SCHEMA,
      minimap: minimapDefaults,
      pdfReader: defaults.pdfReader,
    });
    for (const schema of [2, 3, 4, 5, 6, 7]) {
      const record = appearanceForClient(
        new Request("http://localhost/preferences", {
          headers: { [APPEARANCE_SCHEMA_HEADER]: String(schema) },
        }),
        { preferences: upgraded, previousPreferences: upgraded, version: 8 },
      );
      expect(record?.preferences).not.toHaveProperty("minimap");
      expect(record?.previousPreferences).not.toHaveProperty("minimap");
      if (schema === 7) expect(record?.preferences).toEqual(old);
    }
  });
  it("validates widths, modes and unknown keys", () => {
    for (const value of [
      { width: 79 },
      { width: 201 },
      { width: NaN },
      { size: "huge" },
      { enabled: "yes" },
      { script: "x" },
    ])
      expect(minimapPreferencesSchema.safeParse(value).success).toBe(false);
    expect(
      minimapPreferencesSchema.parse({ width: 180, read: false }).width,
    ).toBe(180);
  });
  it("does not reconfigure the editor for minimap-only preferences", () => {
    expect(editorAppearanceKey(defaults)).toBe(
      editorAppearanceKey({
        ...defaults,
        minimap: { ...minimapDefaults, enabled: true, side: "left" },
      }),
    );
    expect(editorAppearanceKey(defaults)).not.toBe(
      editorAppearanceKey({ ...defaults, proseSize: 25 }),
    );
  });
  it("keeps viewport geometry finite for empty and short documents", () => {
    for (const extent of [0, 1, 30, 300])
      for (const size of ["fit", "fill", "proportional"] as const) {
        const result = minimapLayout(extent, 700, 700, 120, 800, size, 5000);
        expect(Object.values(result).every(Number.isFinite)).toBe(true);
        expect(result.maxScroll).toBe(0);
        expect(result.thumbTop).toBeGreaterThanOrEqual(0);
        expect(result.thumbTop + result.thumbHeight).toBeLessThanOrEqual(700);
      }
  });
  it.each(["fit", "fill", "proportional"] as const)(
    "maps the start, midpoint and end in %s mode",
    (size) => {
      const start = minimapLayout(12000, 800, 800, 120, 800, size, 0);
      const middle = minimapLayout(12000, 800, 800, 120, 800, size, 5600);
      const end = minimapLayout(12000, 800, 800, 120, 800, size, 11200);
      expect(start.thumbTop).toBe(0);
      expect(middle.fraction).toBe(0.5);
      expect(end.fraction).toBe(1);
      expect(end.thumbTop + end.thumbHeight).toBeCloseTo(800);
      expect(size === "proportional" ? end.offset > 0 : end.offset === 0).toBe(
        true,
      );
    },
  );
  it("adapts desktop panes without changing the chosen width", () => {
    expect(minimapWidth(1000, 120)).toBe(120);
    expect(minimapWidth(600, 120)).toBe(80);
    expect(minimapWidth(599, 120)).toBe(14);
    expect(minimapWidth(400, 120, 260)).toBe(120);
  });
  it("resolves nested and folded targets without expanding them", () => {
    const folded = { ...block(50, 100, 60, 85, "list"), folded: true };
    const index = new NavigationIndex([
      block(0, 150, 0, 170, "blockquote"),
      block(10, 30, 10, 40),
      folded,
      block(120, 150, 130, 170),
    ]);
    expect(index.atSource(20)?.from).toBe(10);
    expect(index.atSource(80)).toEqual(folded);
    expect(index.yAt(80)).toBe(60);
    expect(index.sourceAt(70)).toBe(50);
  });
  it("uses visual order for relocated footnotes", () => {
    const index = new NavigationIndex([
      block(0, 20, 400, 460, "footnoteDefinition"),
      block(22, 70, 0, 100),
      block(72, 130, 110, 200),
    ]);
    expect(index.yAt(0)).toBe(400);
    expect(index.sourceAt(0)).toBe(22);
    expect(index.atHeight(430)?.type).toBe("footnoteDefinition");
  });
  it.each(["\n", "\r\n"])(
    "preserves source punctuation and UTF-16 boundaries with %j",
    (eol) => {
      const text = ["# 中文 α", "", "An **important** claim 😀."].join(eol),
        parsed = parseMarkdown(text);
      const paragraph = text.indexOf("An");
      const geometry = [
        block(0, text.indexOf(eol), 0, 30, "heading"),
        block(paragraph, text.length, 40, 80),
      ];
      const rich = minimapBlocks(text, parsed, geometry, "write");
      expect(rich[0].text).toBe("中文 α");
      expect(rich[1].text).toBe("An important claim 😀.");
      const source = minimapBlocks(
        text,
        parsed,
        [block(0, text.indexOf(eol), 0, 30, "sourceLine")],
        "source",
      );
      expect(source[0].text).toBe("# 中文 α");
      expect(text.slice(paragraph)).toBe("An **important** claim 😀.");
    },
  );
  it("bounds text payloads and coalesces dense markers", () => {
    const text = "a".repeat(50000),
      parsed = parseMarkdown(text);
    expect(
      minimapBlocks(text, parsed, [block(0, text.length, 0, 600)], "read")[0]
        .text.length,
    ).toBeLessThanOrEqual(360);
    const items = Array.from({ length: 5000 }, (_, from) => ({ from }));
    const groups = clusteredMarkers(items, (m) => (m.from / 5000) * 600, 600);
    expect(groups.length).toBeLessThan(80);
    expect(groups.flatMap((g) => g.entries)).toHaveLength(5000);
    expect(clamp(NaN, 0, 1)).toBe(0);
  });
  it.each(["fit", "fill", "proportional"] as const)(
    "aligns marker centers with the miniature in %s sizing at every scroll position",
    (size) => {
      for (const extent of [800, 3600, 18000])
        for (const fraction of [0, 0.5, 1]) {
          const scroll = (extent - 800) * fraction;
          const layout = minimapLayout(
            extent,
            800,
            800,
            112,
            800,
            size,
            scroll,
          );
          const y = scroll + 220.5;
          const expected = minimapY(y, layout);
          const groups = clusteredMarkers(
            [y],
            (at) => minimapY(at, layout),
            800,
          );
          expect(groups).toHaveLength(1);
          expect(groups[0].top + 3).toBeCloseTo(expected);
        }
    },
  );
  it("clips proportional markers with their content instead of inventing edge results", () => {
    const layout = minimapLayout(
      18000,
      800,
      800,
      112,
      800,
      "proportional",
      8600,
    );
    const groups = clusteredMarkers(
      [100, 8900, 17500, NaN],
      (at) => minimapY(at, layout),
      800,
    );
    expect(groups.flatMap((g) => g.entries)).toEqual([8900]);
    expect(groups[0].top + 3).toBeCloseTo(minimapY(8900, layout));
  });
  it("centers singleton markers without snapping and keeps edge buttons inside the lane", () => {
    const groups = clusteredMarkers(
      [0, 21.25, 101.5, 104.5, 800],
      (y) => y,
      800,
    );
    expect(groups.map((g) => g.top)).toEqual([0, 18.25, 98.5, 101.5, 794]);
    const clustered = clusteredMarkers([101.5, 102.5], (y) => y, 800);
    expect(clustered).toEqual([{ key: 12, top: 99, entries: [101.5, 102.5] }]);
  });
});
