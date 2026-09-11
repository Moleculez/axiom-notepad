import { presets, type Palette } from "./appearance";

type Family = {
  name: string;
  description: string;
  light: string;
  dark: string;
};
export const workspaceThemeFamilies: Record<string, Family> = {
  neutral: {
    name: "Neutral",
    description: "Pure monochrome · quiet contrast",
    light: "neutralLight",
    dark: "neutralDark",
  },
  zinc: {
    name: "Zinc",
    description: "Cool graphite · precise blue-grey",
    light: "zincLight",
    dark: "zincDark",
  },
  stone: {
    name: "Stone",
    description: "Warm mineral · soft paper",
    light: "stoneLight",
    dark: "stoneDark",
  },
  materialIndigo: {
    name: "Material Indigo",
    description: "Tonal violet · calm emphasis",
    light: "materialIndigoLight",
    dark: "materialIndigoDark",
  },
  materialSage: {
    name: "Material Sage",
    description: "Muted green · natural surfaces",
    light: "materialSageLight",
    dark: "materialSageDark",
  },
  materialTeal: {
    name: "Material Teal",
    description: "Mineral teal · clear hierarchy",
    light: "materialTealLight",
    dark: "materialTealDark",
  },
};

function palette(dark: boolean, values: Partial<Palette>): Palette {
  return {
    ...(dark ? presets.graphite.colors : presets.frost.colors),
    ...(dark
      ? {
          bg: "#151517",
          paper: "#1c1c1f",
          sidebar: "#202024",
          surface: "#29292e",
          hover: "#36363d",
          text: "#f0f0f2",
          muted: "#b5b5bf",
          subtle: "#aaaab4",
          line: "#55555e",
          code: "#17171a",
          codeText: "#ececf0",
          syntax: "#cbbbe6",
          onAccent: "#202024",
          callout: "#29292e",
        }
      : {
          bg: "#f5f5f6",
          paper: "#ffffff",
          sidebar: "#f0f0f2",
          surface: "#f4f4f5",
          hover: "#e7e7eb",
          text: "#242428",
          muted: "#62626b",
          subtle: "#686871",
          line: "#ceced5",
          code: "#f2f2f5",
          codeText: "#303039",
          syntax: "#605078",
          onAccent: "#ffffff",
          callout: "#f1f1f4",
        }),
    ...values,
  };
}
const pairs: Record<string, [Partial<Palette>, Partial<Palette>]> = {
  neutral: [
    {
      bg: "#f6f6f6",
      sidebar: "#f1f1f1",
      text: "#242424",
      accent: "#303030",
      accentBg: "#eaeaea",
      selection: "#d7d7d7",
      focus: "#444444",
    },
    {
      bg: "#141414",
      paper: "#1c1c1c",
      sidebar: "#202020",
      accent: "#e5e5e5",
      accentBg: "#343434",
      selection: "#4b4b4b",
      focus: "#dedede",
    },
  ],
  zinc: [
    {
      accent: "#43516b",
      accentBg: "#e8edf4",
      selection: "#d4deec",
      focus: "#3b4c6a",
    },
    {
      accent: "#b7c9e5",
      accentBg: "#2e3a4b",
      selection: "#43556d",
      focus: "#c1d4f2",
    },
  ],
  stone: [
    {
      bg: "#f5f3ef",
      sidebar: "#efede8",
      paper: "#fffefa",
      surface: "#f4f1eb",
      code: "#f2efe8",
      accent: "#665447",
      accentBg: "#ede5db",
      selection: "#dfd2c3",
      focus: "#665447",
    },
    {
      bg: "#1b1917",
      paper: "#24211e",
      sidebar: "#282420",
      surface: "#322e29",
      code: "#1c1916",
      text: "#efebe5",
      accent: "#d6c6b6",
      accentBg: "#40372e",
      selection: "#594b3f",
      focus: "#e4d2bf",
    },
  ],
  materialIndigo: [
    {
      bg: "#f5f3fb",
      sidebar: "#ece9f6",
      surface: "#f0edf8",
      accent: "#55459b",
      accentBg: "#e8e0ff",
      selection: "#d9cdf5",
      focus: "#564193",
      callout: "#f1edf9",
    },
    {
      bg: "#191720",
      paper: "#211e2b",
      sidebar: "#282333",
      surface: "#322c42",
      accent: "#c9bbfa",
      accentBg: "#44365e",
      selection: "#5a4a79",
      focus: "#d8caff",
      code: "#1b1825",
    },
  ],
  materialSage: [
    {
      bg: "#f1f5ee",
      sidebar: "#e8efe2",
      surface: "#eef3e8",
      accent: "#3e6346",
      accentBg: "#dfeedd",
      selection: "#cadfc8",
      focus: "#3d6041",
      callout: "#eef4e9",
    },
    {
      bg: "#161c16",
      paper: "#1e261f",
      sidebar: "#242e24",
      surface: "#2b372d",
      accent: "#b4d4ad",
      accentBg: "#334b36",
      selection: "#4a624c",
      focus: "#c6e4bd",
      code: "#171e18",
    },
  ],
  materialTeal: [
    {
      bg: "#eff5f3",
      sidebar: "#e3efeb",
      surface: "#eaf2ef",
      accent: "#25645e",
      accentBg: "#daeee8",
      selection: "#c3dfd8",
      focus: "#245f5a",
      callout: "#eaf4f0",
    },
    {
      bg: "#141c1b",
      paper: "#1b2725",
      sidebar: "#21312d",
      surface: "#293b36",
      accent: "#a6d7c9",
      accentBg: "#2e4d44",
      selection: "#42665b",
      focus: "#b4e8d9",
      code: "#16201d",
    },
  ],
};
export const workspaceThemes = Object.fromEntries(
  Object.entries(workspaceThemeFamilies).flatMap(([id, family]) => [
    [
      family.light,
      {
        name: `${family.name} · Light`,
        mode: "light" as const,
        colors: palette(false, pairs[id][0]),
        description: family.description,
      },
    ],
    [
      family.dark,
      {
        name: `${family.name} · Dark`,
        mode: "dark" as const,
        colors: palette(true, pairs[id][1]),
        description: family.description,
      },
    ],
  ]),
) as Record<
  string,
  { name: string; mode: "light" | "dark"; colors: Palette; description: string }
>;
