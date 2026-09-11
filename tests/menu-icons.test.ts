import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { codeLanguages } from "@axiom/editor/code-languages";
import { editorCommands } from "@axiom/shared/editor";
import {
  actionIconNames,
  actionIconNodes,
} from "../apps/web/lib/icons/actions";
import { ActionIcon } from "../apps/web/lib/icons/ActionIcon";
import { editorCommandIcons } from "../apps/web/lib/icons/editor-commands";
import { languageIconSpec } from "../apps/web/lib/icons/languages";
import data from "../apps/web/lib/icons/language-data.json";

describe("shared menu icons", () => {
  it("has an intentional, renderable icon for every editor command", () => {
    expect(Object.keys(editorCommandIcons).sort()).toEqual(
      editorCommands.map((c) => c.id).sort(),
    );
    for (const name of actionIconNames) {
      const nodes = actionIconNodes(name);
      expect(nodes.length, name).toBeGreaterThan(0);
      for (const [tag, attrs] of nodes) {
        expect([
          "path",
          "rect",
          "circle",
          "ellipse",
          "line",
          "polyline",
          "polygon",
        ]).toContain(tag);
        expect(
          Object.keys(attrs).some((key) => /^on|href|src|style/i.test(key)),
        ).toBe(false);
      }
      const markup = renderToStaticMarkup(createElement(ActionIcon, { name }));
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain('focusable="false"');
      expect(markup).not.toMatch(/<title|<text|<script/);
    }
  });
  it("gives every installed language an explicit logo or semantic fallback", () => {
    expect(Object.keys(data.mappings).sort()).toEqual(
      codeLanguages.map((c) => c.value).sort(),
    );
    for (const language of codeLanguages) {
      const spec = languageIconSpec(language.value);
      expect(actionIconNames).toContain(spec.fallback);
      if (spec.brand) expect(data.logos[spec.brand].svg).toMatch(/^<svg\b/);
      for (const alias of language.aliases)
        expect(languageIconSpec(alias), alias).toEqual(spec);
    }
  });
  it("recognizes research and web aliases without editing their stored value", () => {
    for (const [alias, canonical] of [
      ["PY", "python"],
      ["js", "javascript"],
      ["ts", "typescript"],
      ["tex", "latex"],
      ["c++", "cpp"],
      ["wl", "mathematica"],
    ])
      expect(languageIconSpec(alias)).toEqual(languageIconSpec(canonical));
    expect(languageIconSpec("unknown-language")).toEqual({
      canonical: "unknown-language",
      fallback: "fileCode",
    });
    expect(languageIconSpec("__proto__").fallback).toBe("fileCode");
    expect(languageIconSpec("sql").fallback).toBe("database");
    expect(languageIconSpec("text").fallback).toBe("note");
  });
  it("ships pinned, self-contained logo assets without executable or external content", () => {
    expect(data.revision).toMatch(/^[\da-f]{40}$/);
    for (const logo of Object.values(data.logos)) {
      expect(logo.path).toMatch(/^icons\/[\w-]+\/[\w-]+\.svg$/);
      expect(logo.svg).not.toMatch(
        /<(?:script|foreignObject|image|text)\b|\bon\w+\s*=|(?:href|src)=["'](?!#)|@import/i,
      );
      expect(logo.svg.length).toBeLessThan(48000);
    }
  });
});
