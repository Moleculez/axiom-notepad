import {
  fonts,
  paletteFor,
  presets,
  type Palette,
  type Preferences,
} from "./appearance";
import { latexArticleTypography } from "./document-style";
import { workspaceThemes } from "./workspace-themes";

type Theme = {
  name: string;
  mode: "light" | "dark";
  colors: Palette;
  description?: string;
};
/** New looks are stored as ordinary color overrides. Retained clients can read
 * them without learning a new preference schema or silently replacing colors. */
export const editorThemes: Record<string, Theme> = {
  ...presets,
  ...workspaceThemes,
  paperInk: {
    name: "Paper Ink",
    mode: "light",
    description: "White paper · graphite ink",
    colors: {
      ...presets.frost.colors,
      bg: "#f4f3f0",
      sidebar: "#ededea",
      surface: "#f2f2ef",
      hover: "#e5e5e0",
      paper: "#fffffc",
      text: "#292927",
      muted: "#5c5c57",
      subtle: "#666660",
      line: "#cdcdc5",
      accent: "#3b5269",
      accentBg: "#e7edf1",
      focus: "#304f6c",
      selection: "#d4e0e9",
      code: "#f1f1ec",
      codeText: "#343633",
      syntax: "#65557a",
      callout: "#f3f3ee",
    },
  },
  nightPaper: {
    name: "Night Paper",
    mode: "dark",
    description: "Warm charcoal · soft ink",
    colors: {
      ...presets.graphite.colors,
      bg: "#1b1c1b",
      sidebar: "#20211f",
      surface: "#2d2e2b",
      hover: "#3b3c37",
      paper: "#242522",
      text: "#ecece3",
      muted: "#bcbdb1",
      subtle: "#b1b2a5",
      line: "#55574e",
      accent: "#b2cad9",
      accentBg: "#34444a",
      onAccent: "#213139",
      focus: "#b9d6e8",
      selection: "#465760",
      code: "#1e201d",
      codeText: "#dedfd3",
      syntax: "#d4c0df",
      callout: "#2d3029",
    },
  },
  pearl: {
    name: "Pearl",
    mode: "light",
    description: "Neutral paper · ink blue",
    colors: {
      ...presets.frost.colors,
      bg: "#f3f3f5",
      sidebar: "#ededf1",
      surface: "#f4f4f6",
      hover: "#e5e5eb",
      paper: "#fefefe",
      text: "#292b36",
      muted: "#585b69",
      subtle: "#616575",
      line: "#d5d6df",
      accent: "#444f94",
      accentBg: "#ebecf8",
      selection: "#d5daf3",
      focus: "#444f94",
      code: "#f1f1f5",
      codeText: "#343848",
      callout: "#eeeef7",
    },
  },
  carbon: {
    name: "Carbon",
    mode: "dark",
    description: "Charcoal · quiet violet",
    colors: {
      ...presets.graphite.colors,
      bg: "#17171b",
      sidebar: "#1b1b20",
      paper: "#222228",
      surface: "#2b2b33",
      hover: "#383842",
      text: "#ececf2",
      muted: "#bcbcc9",
      subtle: "#aaaaba",
      line: "#50505e",
      accent: "#bdc3ff",
      accentBg: "#36394e",
      onAccent: "#20223b",
      selection: "#464b6f",
      focus: "#c6cbff",
      code: "#1d1d24",
      codeText: "#dbdbe8",
      callout: "#2e2e3e",
    },
  },
  ivory: {
    name: "Ivory",
    mode: "light",
    description: "Warm ivory · terracotta",
    colors: {
      ...presets.paper.colors,
      bg: "#f6f0e8",
      sidebar: "#eee6da",
      paper: "#fff9ef",
      surface: "#f3ebdf",
      hover: "#e8dccd",
      text: "#3b302b",
      muted: "#68584e",
      subtle: "#716053",
      line: "#d9c9b7",
      accent: "#91452f",
      accentBg: "#f4e2d8",
      selection: "#e9cbb9",
      focus: "#91452f",
      code: "#f1e7d9",
      codeText: "#504034",
      callout: "#f4e9dc",
    },
  },
  espresso: {
    name: "Espresso",
    mode: "dark",
    description: "Roasted brown · soft amber",
    colors: {
      ...presets.slate.colors,
      bg: "#211b18",
      sidebar: "#261e1a",
      paper: "#30251f",
      surface: "#3b2f28",
      hover: "#4a3a31",
      text: "#f1e6d9",
      muted: "#c9b7a6",
      subtle: "#baa691",
      line: "#6b5545",
      accent: "#efbb98",
      accentBg: "#513a2d",
      onAccent: "#37251c",
      selection: "#69503e",
      focus: "#f4c49f",
      code: "#281f1a",
      codeText: "#e7d3bd",
      syntax: "#dcbce6",
      callout: "#3b3026",
    },
  },
  mist: {
    name: "Mist",
    mode: "light",
    description: "Cool mineral · deep teal",
    colors: {
      ...presets.paper.colors,
      bg: "#edf4f3",
      sidebar: "#e3ecec",
      paper: "#f9fdfc",
      surface: "#eaf2f1",
      hover: "#d9e8e6",
      text: "#243d3c",
      muted: "#506969",
      subtle: "#597170",
      line: "#c1d5d2",
      accent: "#246b70",
      accentBg: "#deeeee",
      selection: "#b9dcd8",
      focus: "#216a76",
      code: "#e6f0ee",
      codeText: "#2d5050",
      callout: "#e4f1ef",
    },
  },
  deepSea: {
    name: "Deep Sea",
    mode: "dark",
    description: "Deep ocean · sea glass",
    colors: {
      ...presets.slate.colors,
      bg: "#102125",
      sidebar: "#12292e",
      paper: "#183238",
      surface: "#203f44",
      hover: "#2b4e54",
      text: "#e0f0ee",
      muted: "#b1cfcd",
      subtle: "#a5c4c2",
      line: "#46686c",
      accent: "#91d8d5",
      accentBg: "#255052",
      onAccent: "#163438",
      selection: "#376464",
      focus: "#a1e7e5",
      code: "#142b30",
      codeText: "#c6e5df",
      callout: "#1f4145",
    },
  },
};
export function applyEditorTheme(
  p: Preferences,
  id: string,
  switchMode = true,
): Preferences {
  const theme = editorThemes[id];
  if (!theme) return p;
  const dark = theme.mode === "dark";
  const legacy = Object.hasOwn(presets, id);
  return {
    ...p,
    ...(switchMode ? { mode: theme.mode } : {}),
    [dark ? "darkPreset" : "lightPreset"]: legacy
      ? id
      : dark
        ? "graphite"
        : "frost",
    [dark ? "darkColors" : "lightColors"]: legacy ? {} : { ...theme.colors },
  };
}
export function matchingEditorTheme(p: Preferences, dark: boolean) {
  const colors = paletteFor(p, dark);
  return (
    Object.entries(editorThemes).find(
      ([, t]) =>
        t.mode === (dark ? "dark" : "light") &&
        Object.keys(colors).every(
          (k) => colors[k as keyof Palette] === t.colors[k as keyof Palette],
        ),
    )?.[0] ?? "custom"
  );
}
const common = {
  documentDecorations: "none",
  proseWeight: "400",
  headingWeight: "600",
  codeWeight: "400",
  headingScale: 1,
  letterSpacing: 0,
  wordSpacing: 0,
  fullWidth: false,
  codeFont: "jetbrains",
} as const;
export const documentStyles = {
  latexArticle: {
    name: "LaTeX Article",
    description: "Computer Modern-inspired research typography",
    values: {
      ...latexArticleTypography,
      documentDecorations: "latex",
    },
  },
  modern: {
    name: "Modern",
    description: "Open, balanced everyday writing",
    values: {
      ...common,
      proseFont: "sourceSans",
      headingFont: "systemSans",
      proseSize: 18,
      codeSize: 14,
      lineHeight: 1.75,
      paragraphSpacing: 1.1,
      readingWidth: 72,
    },
  },
  journal: {
    name: "Journal",
    description: "Serif typography for sustained reading",
    values: {
      ...common,
      proseFont: "sourceSerif",
      headingFont: "sourceSerif",
      proseSize: 19,
      codeSize: 14,
      lineHeight: 1.85,
      paragraphSpacing: 1.15,
      readingWidth: 68,
    },
  },
  compact: {
    name: "Compact Research",
    description: "More equations and code in view",
    values: {
      ...common,
      proseFont: "sourceSans",
      headingFont: "systemSans",
      proseSize: 16,
      codeSize: 13,
      lineHeight: 1.6,
      paragraphSpacing: 0.8,
      readingWidth: 88,
    },
  },
  accessible: {
    name: "Accessible",
    description: "Distinct letterforms and generous spacing",
    values: {
      ...common,
      proseFont: "atkinson",
      headingFont: "atkinson",
      proseSize: 20,
      codeSize: 16,
      lineHeight: 1.9,
      paragraphSpacing: 1.2,
      readingWidth: 64,
    },
  },
} as const;
export type DocumentStyleId = keyof typeof documentStyles;
export function applyDocumentStyle(
  p: Preferences,
  id: DocumentStyleId,
): Preferences {
  return { ...p, ...documentStyles[id].values };
}
export function matchingDocumentStyle(p: Preferences) {
  return (
    Object.entries(documentStyles).find(([, style]) =>
      Object.entries(style.values).every(
        ([k, v]) => p[k as keyof Preferences] === v,
      ),
    )?.[0] ?? "custom"
  );
}
export function documentStyleFont(id: DocumentStyleId) {
  return fonts[documentStyles[id].values.proseFont].family;
}
