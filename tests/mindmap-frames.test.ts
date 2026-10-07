import { describe, expect, it } from "vitest";
import { projectMindmap } from "../packages/mindmap/src/projection";
import {
  layoutMindmap,
  mindmapBranchColor,
  mindmapConnector,
} from "../packages/mindmap/src/layout";
import { mindmapHtml, mindmapSvg } from "../packages/mindmap/src/export";

const style = {
  background: "#fafafa",
  surface: "#ffffff",
  border: "#d1d5db",
  rootBorder: "#9aa9bd",
  text: "#202124",
  accent: "#476b83",
  branchColors: ["#476b83", "#347a57"],
  radius: 0,
  headingWeight: 700,
  font: "Research Serif",
  fontSize: 18,
};

describe("framed mind-map presentation", () => {
  it("uses semantic branch roles consistently and bounds unusual branch indexes", () => {
    expect(mindmapBranchColor(4, "accent")).toBe("var(--accent)");
    expect(mindmapBranchColor(1, "spectrum")).toBe(
      "var(--green, var(--accent))",
    );
    expect(mindmapBranchColor(5, "spectrum")).toBe(
      mindmapBranchColor(0, "spectrum"),
    );
    expect(mindmapBranchColor(-1, "spectrum")).toBe(
      mindmapBranchColor(4, "spectrum"),
    );
    expect(mindmapBranchColor(Infinity, "spectrum")).toBe(
      mindmapBranchColor(0, "spectrum"),
    );
  });

  it("exports opaque neutral frames with explicit zero radius and weighted sections", () => {
    const projection = projectMindmap(
        "# Root\n\n## One\n\nText\n\n## Two\n\n- Task\n",
      ),
      layout = layoutMindmap(projection),
      svg = mindmapSvg(projection, layout, style);
    expect(svg.match(/data-frame="true"/g)).toHaveLength(layout.nodes.length);
    expect(svg.match(/rx="0"/g)).toHaveLength(layout.nodes.length);
    expect(svg).toContain('fill="#ffffff" stroke="#d1d5db"');
    expect(svg).toContain('fill="#ffffff" stroke="#9aa9bd"');
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('font-weight="400"');
    expect(svg).not.toMatch(/filter=|box-shadow/);
    expect(svg).toContain('stroke="#347a57" stroke-width="1.4"');
  });

  it("keeps connector endpoints on the same measured card edges for left and balanced maps", () => {
    const projection = projectMindmap(
        "# Root\n\n## Left\n\n- Nested\n\n## Right\n",
      ),
      sizes = Object.fromEntries(
        projection.nodes.map((node, index) => [
          node.id,
          { width: 110 + index * 20, height: 52 + index * 7 },
        ]),
      );
    for (const direction of ["left", "balanced"] as const) {
      const layout = layoutMindmap(
          projection,
          { layout: direction },
          [],
          sizes,
        ),
        byId = new Map(layout.nodes.map((node) => [node.id, node])),
        svg = mindmapSvg(projection, layout, style);
      for (const node of projection.nodes) {
        const position = byId.get(node.id)!,
          parent = byId.get(node.parentId ?? "");
        expect(svg).toContain(
          `x="${position.x + 0.5}" y="${position.y + 0.5}" width="${position.width - 1}" height="${position.height - 1}"`,
        );
        if (parent)
          expect(svg).toContain(`d="${mindmapConnector(parent, position)}"`);
      }
    }
  });

  it("bounds radius and escapes new frame properties without importing media", () => {
    const projection = projectMindmap(
        "# Root\n\n![Image](https://private.invalid/file)\n",
      ),
      layout = layoutMindmap(projection),
      svg = mindmapSvg(projection, layout, {
        ...style,
        radius: 10000,
        border: 'paper" onload="evil',
      });
    expect(svg).toContain('stroke="paper&quot; onload=&quot;evil"');
    expect(svg).not.toContain('stroke="paper" onload="evil"');
    const radii = [...svg.matchAll(/rx="([\d.]+)"/g)].map((match) =>
      Number(match[1]),
    );
    expect(
      radii.every(
        (value, index) =>
          value <=
          Math.min(layout.nodes[index].width, layout.nodes[index].height) / 2,
      ),
    ).toBe(true);
    expect(svg).not.toContain("<image");
    const html = mindmapHtml(svg, "Research");
    expect(html).toContain('data-frame="true"');
    expect(html).toContain("svg text{user-select:text}");
  });

  it("retains vector frames when rich label captures are embedded", () => {
    const projection = projectMindmap("# Root\n\n$$\nx^2\n$$\n"),
      layout = layoutMindmap(projection),
      images = new Map([[projection.rootId, "data:image/png;base64,AAAA"]]),
      svg = mindmapSvg(projection, layout, { ...style, radius: 6 }, images);
    expect(svg).toContain('data-frame="true"');
    expect(svg).toContain('rx="6"');
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg.indexOf('data-frame="true"')).toBeLessThan(
      svg.indexOf("<image"),
    );
  });
});
