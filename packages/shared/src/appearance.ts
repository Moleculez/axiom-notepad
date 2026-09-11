import { z } from "zod";
import { legacyDocumentDecorations } from "./document-style";
import { themePack, themePackIds } from "./theme-packs";

export const fonts = {
  latinModern: {
    label: "Latin Modern Roman",
    family:
      '"Axiom Latin Modern", "Source Serif 4", "Noto Serif CJK SC", "Songti SC", Georgia, serif',
  },
  inter: {
    label: "Inter",
    family:
      '"Inter", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  },
  sourceSans: {
    label: "Source Sans 3",
    family: '"Source Sans 3", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  },
  sourceSerif: {
    label: "Source Serif 4",
    family:
      '"Source Serif 4", "Noto Serif CJK SC", "Songti SC", Georgia, serif',
  },
  atkinson: {
    label: "Atkinson Hyperlegible",
    family: '"Atkinson Hyperlegible", "PingFang SC", sans-serif',
  },
  jetbrains: {
    label: "JetBrains Mono",
    family: '"JetBrains Mono", "Noto Sans Mono CJK SC", monospace',
  },
  plexMono: {
    label: "IBM Plex Mono",
    family: '"IBM Plex Mono", "Noto Sans Mono CJK SC", monospace',
  },
  systemSans: {
    label: "System sans",
    family:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  },
  systemSerif: {
    label: "System serif",
    family: 'Georgia, "Noto Serif CJK SC", "Songti SC", serif',
  },
  systemMono: {
    label: "System mono",
    family: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
  },
} as const;
const font = z.enum(
  Object.keys(fonts) as [keyof typeof fonts, ...(keyof typeof fonts)[]],
);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const colorNames = [
  "bg",
  "paper",
  "sidebar",
  "surface",
  "hover",
  "text",
  "muted",
  "subtle",
  "line",
  "accent",
  "accentBg",
  "onAccent",
  "selection",
  "focus",
  "green",
  "warning",
  "danger",
  "code",
  "codeText",
  "syntax",
  "callout",
] as const;
export type Palette = Record<(typeof colorNames)[number], string>;
export const paletteSchema = z
  .object(
    Object.fromEntries(colorNames.map((k) => [k, hex])) as Record<
      keyof Palette,
      typeof hex
    >,
  )
  .strict();
const paper: Palette = {
  bg: "#f8f8f4",
  paper: "#fffefa",
  sidebar: "#f1f2ed",
  surface: "#f0f2ee",
  hover: "#e7ece6",
  text: "#293631",
  muted: "#59675f",
  subtle: "#627168",
  line: "#d2dbd2",
  accent: "#266c59",
  accentBg: "#e0eee5",
  onAccent: "#ffffff",
  selection: "#b8daca",
  focus: "#216c78",
  green: "#267049",
  warning: "#865c14",
  danger: "#af3545",
  code: "#edf1eb",
  codeText: "#354b40",
  syntax: "#795693",
  callout: "#e8f0e8",
};
const slate: Palette = {
  bg: "#191f23",
  paper: "#20282c",
  sidebar: "#171e22",
  surface: "#293438",
  hover: "#344247",
  text: "#e1e8e5",
  muted: "#b0beb8",
  subtle: "#a1b1aa",
  line: "#4d5b60",
  accent: "#93d5ba",
  accentBg: "#2c473c",
  onAccent: "#172d24",
  selection: "#416851",
  focus: "#96d6ef",
  green: "#92d2a8",
  warning: "#e3c18a",
  danger: "#ffabb5",
  code: "#192226",
  codeText: "#c7dfd2",
  syntax: "#d3b9f1",
  callout: "#283d36",
};
export const presets: Record<
  string,
  { name: string; mode: "light" | "dark"; colors: Palette }
> = {
  frost: {
    name: "Frost",
    mode: "light",
    colors: {
      bg: "#edf1f8",
      paper: "#ffffff",
      sidebar: "#e9eef7",
      surface: "#f3f5fa",
      hover: "#e2e9f5",
      text: "#202735",
      muted: "#566174",
      subtle: "#606b7d",
      line: "#ced6e4",
      accent: "#245cc5",
      accentBg: "#e6eeff",
      onAccent: "#ffffff",
      selection: "#ccdeff",
      focus: "#215ccc",
      green: "#24734f",
      warning: "#865a11",
      danger: "#b32d45",
      code: "#f1f4fa",
      codeText: "#344259",
      syntax: "#7852a5",
      callout: "#edf3ff",
    },
  },
  graphite: {
    name: "Graphite",
    mode: "dark",
    colors: {
      bg: "#141821",
      paper: "#1c212c",
      sidebar: "#191f2b",
      surface: "#252d3a",
      hover: "#303d53",
      text: "#e9edf5",
      muted: "#b0bbce",
      subtle: "#a1afc5",
      line: "#45536b",
      accent: "#9bbdff",
      accentBg: "#293c61",
      onAccent: "#14233f",
      selection: "#3b5380",
      focus: "#a3c8ff",
      green: "#91d5af",
      warning: "#e8c184",
      danger: "#ffacb8",
      code: "#171d29",
      codeText: "#ccd9ef",
      syntax: "#d0b7f5",
      callout: "#25334d",
    },
  },
  paper: { name: "Paper", mode: "light", colors: paper },
  sepia: {
    name: "Sepia",
    mode: "light",
    colors: {
      ...paper,
      bg: "#f4eddc",
      paper: "#fbf3e1",
      sidebar: "#eee4cf",
      surface: "#eee5d2",
      hover: "#e6dac0",
      text: "#433c30",
      muted: "#6b5c44",
      subtle: "#726246",
      line: "#cfc0a1",
      accent: "#79612b",
      accentBg: "#eadfc3",
      selection: "#dbc99c",
      code: "#eee5d2",
      codeText: "#54432b",
      callout: "#eee5d0",
    },
  },
  lightContrast: {
    name: "High contrast · light",
    mode: "light",
    colors: {
      ...paper,
      bg: "#ffffff",
      paper: "#ffffff",
      sidebar: "#f1f1f1",
      text: "#111111",
      muted: "#333333",
      subtle: "#444444",
      line: "#686868",
      accent: "#004f72",
      focus: "#003e9a",
    },
  },
  slate: { name: "Slate", mode: "dark", colors: slate },
  midnight: {
    name: "Midnight",
    mode: "dark",
    colors: {
      ...slate,
      bg: "#10141f",
      paper: "#171d2b",
      sidebar: "#101623",
      surface: "#242c3f",
      hover: "#303c52",
      text: "#e4e7f1",
      muted: "#b5bed5",
      subtle: "#a4b1cc",
      line: "#4b5873",
      accent: "#adbef5",
      accentBg: "#303b59",
      selection: "#435789",
      code: "#111827",
      codeText: "#d3dcef",
      callout: "#283249",
    },
  },
  darkContrast: {
    name: "High contrast · dark",
    mode: "dark",
    colors: {
      ...slate,
      bg: "#050505",
      paper: "#090909",
      sidebar: "#101010",
      text: "#ffffff",
      muted: "#e0e0e0",
      subtle: "#cccccc",
      line: "#909090",
      accent: "#b8e8ff",
      focus: "#ffdf7f",
    },
  },
};
export const APPEARANCE_SCHEMA = 5;
export const APPEARANCE_SCHEMA_HEADER = "X-Axiom-Appearance-Schema";
const currentPreferencesSchema = z
  .object({
    schemaVersion: z.literal(APPEARANCE_SCHEMA).default(APPEARANCE_SCHEMA),
    mode: z.enum(["system", "light", "dark"]).default("system"),
    themePack: z.enum(themePackIds).default("default"),
    lightPreset: z
      .enum(["frost", "paper", "sepia", "lightContrast"])
      .default("frost"),
    darkPreset: z
      .enum(["graphite", "slate", "midnight", "darkContrast"])
      .default("graphite"),
    lightColors: paletteSchema.partial().default({}),
    darkColors: paletteSchema.partial().default({}),
    uiFont: font.default("systemSans"),
    proseFont: font.default("sourceSans"),
    headingFont: font.default("systemSans"),
    documentDecorations: z.enum(["none", "latex"]).default("none"),
    material: z.enum(["glass", "solid"]).default("glass"),
    glassIntensity: z.number().int().min(0).max(100).default(65),
    codeFont: z
      .enum(["jetbrains", "plexMono", "systemMono"])
      .default("jetbrains"),
    uiSize: z.number().min(12).max(22).default(15),
    proseSize: z.number().min(14).max(30).default(18),
    codeSize: z.number().min(12).max(24).default(14),
    uiWeight: z.enum(["400", "500", "600", "700"]).default("400"),
    proseWeight: z.enum(["400", "500", "600", "700"]).default("400"),
    headingWeight: z.enum(["400", "500", "600", "700"]).default("600"),
    codeWeight: z.enum(["400", "500", "600", "700"]).default("400"),
    headingScale: z.number().min(0.85).max(1.4).default(1),
    lineHeight: z.number().min(1.3).max(2.4).default(1.75),
    paragraphSpacing: z.number().min(0.4).max(2.5).default(1.1),
    letterSpacing: z.number().min(-0.02).max(0.14).default(0),
    wordSpacing: z.number().min(0).max(0.25).default(0),
    readingWidth: z.number().min(45).max(110).default(72),
    fullWidth: z.boolean().default(false),
    mathScale: z.number().min(0.8).max(1.5).default(1),
    density: z.enum(["comfortable", "compact"]).default("comfortable"),
    sidebarWidth: z.number().min(200).max(360).default(248),
    panelWidth: z.number().min(240).max(420).default(300),
    uiScale: z.number().min(0.8).max(1.5).default(1),
    radius: z.number().min(0).max(18).default(12),
    shadows: z.enum(["none", "soft", "elevated"]).default("soft"),
    motion: z.enum(["system", "reduced", "none"]).default("system"),
    codeWrap: z.boolean().default(true),
    lineNumbers: z.boolean().default(false),
    activeLine: z.boolean().default(false),
    ligatures: z.boolean().default(false),
    focusMode: z.boolean().default(false),
    exportTypography: z.boolean().default(false),
    themes: z
      .array(
        z
          .object({
            id: z.uuid(),
            name: z.string().trim().min(1).max(60),
            mode: z.enum(["light", "dark"]),
            colors: paletteSchema,
          })
          .strict(),
      )
      .max(30)
      .default([]),
  })
  .strict();
// Reading an older account/cache must not silently restyle it. Only new
// profiles receive the new defaults; existing explicit choices survive intact.
export const preferencesSchema = z.preprocess((value) => {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "schemaVersion" in value &&
    value.schemaVersion === 1
  )
    return {
      lightPreset: "paper",
      darkPreset: "slate",
      uiFont: "inter",
      proseFont: "sourceSerif",
      headingFont: "sourceSerif",
      radius: 8,
      material: "solid",
      glassIntensity: 65,
      ...value,
      schemaVersion: APPEARANCE_SCHEMA,
    };
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "schemaVersion" in value &&
    (value.schemaVersion === 2 ||
      value.schemaVersion === 3 ||
      value.schemaVersion === 4)
  )
    return {
      documentDecorations: legacyDocumentDecorations(value),
      ...value,
      schemaVersion: APPEARANCE_SCHEMA,
    };
  return value;
}, currentPreferencesSchema);
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaults = preferencesSchema.parse({});
/** An opt-in look, leaving reading metrics, accessibility and saved palettes alone. */
export function modernAppearance(p: Preferences): Preferences {
  return {
    ...p,
    themePack: "default",
    uiFont: "systemSans",
    headingFont: "systemSans",
    proseFont: "sourceSans",
    documentDecorations: "none",
    lightPreset: "frost",
    darkPreset: "graphite",
    lightColors: {},
    darkColors: {},
    material: "glass",
    glassIntensity: 65,
  };
}
export const deviceSchema = z
  .object({
    uiScale: z.number().min(0.8).max(1.5).optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
    sidebarWidth: z.number().min(200).max(360).optional(),
    panelWidth: z.number().min(240).max(420).optional(),
  })
  .strict();
export type DevicePreferences = z.infer<typeof deviceSchema>;
export type PreferenceRecord = {
  preferences: Preferences;
  version: number;
  previousPreferences?: Preferences | null;
};
/** Old tabs must not receive an unknown font enum and then overwrite their
 * account with fallback defaults. New clients advertise the schema they read. */
export function appearanceForClient(
  request: Request,
  record: PreferenceRecord,
) {
  const version = request.headers.get(APPEARANCE_SCHEMA_HEADER);
  if (version === String(APPEARANCE_SCHEMA)) return record;
  if (version && version !== "2" && version !== "3" && version !== "4")
    return null;
  const compatible = (p: Preferences) =>
    p.themePack === "default" &&
    (version === "4" || p.documentDecorations === "none") &&
    (version === "3" ||
      version === "4" ||
      ![p.uiFont, p.proseFont, p.headingFont, p.codeFont].includes(
        "latinModern",
      ));
  if (
    !compatible(record.preferences) ||
    (record.previousPreferences && !compatible(record.previousPreferences))
  )
    return null;
  return {
    ...record,
    preferences: legacyAppearance(record.preferences, version),
    previousPreferences: record.previousPreferences
      ? legacyAppearance(record.previousPreferences, version)
      : record.previousPreferences,
  };
}
function legacyAppearance(p: Preferences, version: string | null) {
  const { themePack: _pack, documentDecorations: _decorations, ...rest } = p;
  return {
    ...rest,
    ...(version === "4" ? { documentDecorations: p.documentDecorations } : {}),
    schemaVersion: version === "4" ? 4 : version === "3" ? 3 : 2,
  };
}
export function normalizePreferenceRecord(
  record: PreferenceRecord,
): PreferenceRecord {
  return {
    preferences: preferencesSchema.parse(record.preferences),
    version: record.version,
    previousPreferences: record.previousPreferences
      ? preferencesSchema.parse(record.previousPreferences)
      : null,
  };
}
export const themeFileSchema = z
  .object({
    format: z.literal("axiom-theme"),
    version: z.literal(1),
    name: z.string().trim().min(1).max(60),
    mode: z.enum(["light", "dark"]),
    colors: paletteSchema,
  })
  .strict();
export function paletteFor(p: Preferences, dark: boolean): Palette {
  const preset = dark ? p.darkPreset : p.lightPreset;
  return {
    ...presets[preset].colors,
    ...(!preset.endsWith("Contrast")
      ? themePack(p.themePack)?.palettes[dark ? "dark" : "light"]
      : {}),
    ...(dark ? p.darkColors : p.lightColors),
  };
}
/** Persist one canonical format, while accepting convenient text entry. */
export function parseThemeColor(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (/^#[\da-f]{6}$/.test(text)) return text;
  if (/^#[\da-f]{3}$/.test(text))
    return "#" + [...text.slice(1)].map((c) => c + c).join("");
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(
    text,
  );
  return rgb && rgb.slice(1).every((v) => Number(v) <= 255)
    ? "#" +
        rgb
          .slice(1)
          .map((v) => Number(v).toString(16).padStart(2, "0"))
          .join("")
    : null;
}
export function resolvedDark(p: Preferences, systemDark: boolean) {
  return p.mode === "dark" || (p.mode === "system" && systemDark);
}
export function appearanceVariables(
  p: Preferences,
  dark: boolean,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, color] of Object.entries(paletteFor(p, dark)))
    result["--" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())] = color;
  for (const role of ["ui", "prose", "heading", "code"] as const)
    result[`--font-${role}`] = fonts[p[`${role}Font`]].family;
  for (const role of ["ui", "prose", "code"] as const)
    result[`--size-${role}`] =
      `${(p[`${role}Size`] / 16) * (role === "ui" ? p.uiScale : 1)}rem`;
  for (const role of ["ui", "prose", "heading", "code"] as const)
    result[`--weight-${role}`] = p[`${role}Weight`];
  Object.assign(result, {
    // Controls only chrome. Reading, code, math and PDF surfaces stay opaque.
    "--glass-opacity": `${96 - p.glassIntensity * 0.24}%`,
    "--glass-blur": `${12 + p.glassIntensity * 0.24}px`,
    "--glass-saturation": `${110 + p.glassIntensity * 0.5}%`,
    "--backdrop-filter":
      p.material === "glass" &&
      !(dark ? p.darkPreset : p.lightPreset).endsWith("Contrast")
        ? "blur(6px)"
        : "none",
    "--material-filter":
      p.material === "glass" &&
      !(dark ? p.darkPreset : p.lightPreset).endsWith("Contrast")
        ? "blur(var(--glass-blur)) saturate(var(--glass-saturation))"
        : "none",
    "--chrome-background":
      p.material === "glass" &&
      !(dark ? p.darkPreset : p.lightPreset).endsWith("Contrast")
        ? "color-mix(in srgb, var(--sidebar) var(--glass-opacity), transparent)"
        : "var(--sidebar)",
    "--heading-scale": String(p.headingScale),
    "--reading-line": String(p.lineHeight),
    "--paragraph-space": p.paragraphSpacing + "em",
    "--letter-space": p.letterSpacing + "em",
    "--word-space": p.wordSpacing + "em",
    "--reading-width": p.fullWidth ? "100%" : p.readingWidth + "ch",
    "--math-scale": String(p.mathScale),
    "--sidebar-width": p.sidebarWidth + "px",
    "--panel-width": p.panelWidth + "px",
    "--radius": p.radius + "px",
    "--row-space": p.density === "compact" ? "6px" : "10px",
    "--shadow":
      p.shadows === "none"
        ? "none"
        : p.shadows === "soft"
          ? "0 8px 32px #00000012"
          : "0 14px 48px #00000028",
    "--code-wrap": p.codeWrap ? "pre-wrap" : "pre",
    "--ligatures": p.ligatures ? "normal" : "none",
  });
  return result;
}
export function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
      .reduce((v, n, i) => v + n * [0.2126, 0.7152, 0.0722][i], 0);
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Three-way field merge. Nested palette overrides are merged token by token. */
export function mergePreferences(
  base: Preferences,
  local: Preferences,
  remote: Preferences,
): { merged: Preferences; conflicts: string[] } {
  const conflicts: string[] = [];
  const merge = (
    b: Record<string, unknown>,
    l: Record<string, unknown>,
    r: Record<string, unknown>,
    prefix = "",
  ): Record<string, unknown> => {
    const result = { ...r };
    for (const key of new Set([...Object.keys(b), ...Object.keys(l)])) {
      if (JSON.stringify(b[key]) === JSON.stringify(l[key])) continue;
      if (
        b[key] &&
        l[key] &&
        r[key] &&
        typeof l[key] === "object" &&
        !Array.isArray(l[key])
      )
        result[key] = merge(
          b[key] as any,
          l[key] as any,
          r[key] as any,
          prefix + key + ".",
        );
      else {
        if (
          JSON.stringify(b[key]) !== JSON.stringify(r[key]) &&
          JSON.stringify(l[key]) !== JSON.stringify(r[key])
        )
          conflicts.push(prefix + key);
        if (l[key] === undefined) delete result[key];
        else result[key] = l[key];
      }
    }
    return result;
  };
  return {
    merged: preferencesSchema.parse(merge(base, local, remote)),
    conflicts,
  };
}
