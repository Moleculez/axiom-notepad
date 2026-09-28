import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, presets } from "../packages/shared/src/appearance";

describe("production editor stylesheet contract", () => {
  it.each(Object.entries(presets))(
    "keeps %s source syntax and focus legible on paper",
    (_name, preset) => {
      const p = preset.colors;
      for (const token of ["text", "syntax", "accent", "muted"] as const)
        expect(contrastRatio(p[token], p.paper), token).toBeGreaterThanOrEqual(
          4.5,
        );
      expect(contrastRatio(p.focus, p.paper)).toBeGreaterThanOrEqual(3);
    },
  );
  it("loads the same complete cascade in the root layout and browser laboratory", () => {
    const layout = readFileSync("apps/web/app/layout.tsx", "utf8");
    const lab = readFileSync("tests/editor-lab/main.ts", "utf8");
    const entry = readFileSync("apps/web/app/styles.ts", "utf8");
    expect(layout).toContain('import "./styles";');
    expect(lab).toContain('import "../../apps/web/app/styles";');
    expect(layout.match(/^import ".*\.css";/gm)).toBeNull();
    expect(lab.match(/^import ".*\.css";/gm)).toEqual(['import "./lab.css";']);
    const sheets = [...entry.matchAll(/^import "(.*\.css)";/gm)].map(
      (match) => match[1],
    );
    expect(new Set(sheets).size).toBe(sheets.length);
    for (const sheet of [
      "./globals.css",
      "./appearance.css",
      "./workspace-design.css",
      "./workbench.css",
      "./editor-paper.css",
      "./canvas.css",
      "./interface-styles.css",
    ])
      expect(sheets).toContain(sheet);
    expect(sheets.indexOf("./workbench.css")).toBeLessThan(
      sheets.indexOf("./editor-paper.css"),
    );
  });
});
