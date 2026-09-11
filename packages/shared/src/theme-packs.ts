import type { Palette } from "./appearance";

/** Compiled, reviewed packs only. Never construct an import from a saved ID. */
export const themePackIds = [
  "default",
  "paper-research",
  "technical-slate",
] as const;
export type ThemePackId = (typeof themePackIds)[number];
export type ThemePackManifest = {
  format: "axiom-theme-pack";
  version: 1;
  id: Exclude<ThemePackId, "default">;
  name: string;
  description: string;
  author: string;
  license: string;
  minimumAppearanceSchema: number;
  css: string;
  assets: string[];
  fixtures: string[];
  palettes: { light: Palette; dark: Palette };
};
export const themePacks: readonly ThemePackManifest[] = [
  {
    format: "axiom-theme-pack",
    version: 1,
    id: "paper-research",
    name: "Paper Research",
    description:
      "Warm archival paper, precise ink, and understated research surfaces.",
    author: "Axiom contributors",
    license: "MIT",
    minimumAppearanceSchema: 5,
    css: "apps/web/themes/paper-research.css",
    assets: [],
    fixtures: ["docs/theme-fixtures/research.md"],
    palettes: {
      light: {
        bg: "#f5f2eb",
        paper: "#fffcf5",
        sidebar: "#eeeae0",
        surface: "#fffcf5",
        hover: "#e5dfd2",
        text: "#292722",
        muted: "#696357",
        subtle: "#71695d",
        line: "#c5bbab",
        accent: "#72512b",
        accentBg: "#eae0ce",
        onAccent: "#ffffff",
        selection: "#ded0b4",
        focus: "#765527",
        green: "#3d6944",
        warning: "#855817",
        danger: "#a73635",
        code: "#f0ebe1",
        codeText: "#363127",
        syntax: "#705171",
        callout: "#f2ecdf",
      },
      dark: {
        bg: "#191815",
        paper: "#22211d",
        sidebar: "#28261f",
        surface: "#2c2922",
        hover: "#383329",
        text: "#eee9dc",
        muted: "#c0b7a5",
        subtle: "#b8af9c",
        line: "#655d4d",
        accent: "#e0bd82",
        accentBg: "#403425",
        onAccent: "#292116",
        selection: "#54462f",
        focus: "#efd3a0",
        green: "#b4d29f",
        warning: "#edc78b",
        danger: "#f0aaa3",
        code: "#1b1a16",
        codeText: "#ece3d0",
        syntax: "#d3b8d1",
        callout: "#302a20",
      },
    },
  },
  {
    format: "axiom-theme-pack",
    version: 1,
    id: "technical-slate",
    name: "Technical Slate",
    description:
      "Cool mineral surfaces, blue annotations, and crisp technical contrast.",
    author: "Axiom contributors",
    license: "MIT",
    minimumAppearanceSchema: 5,
    css: "apps/web/themes/technical-slate.css",
    assets: [],
    fixtures: ["docs/theme-fixtures/research.md"],
    palettes: {
      light: {
        bg: "#eef2f6",
        paper: "#fbfdff",
        sidebar: "#e6ecf2",
        surface: "#f5f8fc",
        hover: "#dce5ee",
        text: "#202c3a",
        muted: "#526276",
        subtle: "#5b6b7c",
        line: "#b8c7d6",
        accent: "#245b8a",
        accentBg: "#dceaf6",
        onAccent: "#ffffff",
        selection: "#c5dcef",
        focus: "#1d5e94",
        green: "#28664f",
        warning: "#84551c",
        danger: "#a83443",
        code: "#e9eff6",
        codeText: "#23364a",
        syntax: "#635084",
        callout: "#e6eff8",
      },
      dark: {
        bg: "#111921",
        paper: "#18232e",
        sidebar: "#1d2b38",
        surface: "#22313e",
        hover: "#2d4050",
        text: "#e9f0f7",
        muted: "#b4c6d6",
        subtle: "#aabbcb",
        line: "#52697f",
        accent: "#a0c9f1",
        accentBg: "#28455e",
        onAccent: "#15293d",
        selection: "#3a5974",
        focus: "#b1d7fa",
        green: "#9dd6bf",
        warning: "#ebca94",
        danger: "#f5a9b6",
        code: "#131d28",
        codeText: "#e1edf9",
        syntax: "#c9b7ec",
        callout: "#203347",
      },
    },
  },
];
export function themePack(id: string) {
  return themePacks.find((pack) => pack.id === id);
}
