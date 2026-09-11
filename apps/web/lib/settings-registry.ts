import type { Preferences } from "@axiom/shared/appearance";
import type { EditorPreferences } from "@axiom/shared/editor";

export const settingsCategories = [
  { id: "connections", group: "Account", label: "Connected apps", description: "MCP connections, explicit permissions, approvals, and activity." },
  {
    id: "profile",
    group: "Account",
    label: "Profile",
    description: "Your research identity, affiliations and links.",
  },
  {
    id: "security",
    group: "Account",
    label: "Security & devices",
    description: "Password, two-factor authentication and active sessions.",
  },
  {
    id: "notifications",
    group: "Account",
    label: "Notifications",
    description: "Choose which updates deserve your attention.",
  },
  {
    id: "groups",
    group: "Account",
    label: "My groups",
    description: "Memberships and group administration.",
  },
  {
    id: "theme",
    group: "Appearance",
    label: "Theme",
    description: "Color, contrast and window materials.",
  },
  {
    id: "typography",
    group: "Appearance",
    label: "Typography",
    description: "Fonts, sizes, weight and spacing for comfortable reading.",
  },
  {
    id: "layout",
    group: "Appearance",
    label: "Reading & layout",
    description: "Reading width, navigation, source display and motion.",
  },
  {
    id: "device",
    group: "Appearance",
    label: "Device",
    description: "Local overrides for this account and browser.",
  },
  {
    id: "writing",
    group: "Writing",
    label: "General",
    description: "Context-first controls, pairing and Markdown continuation.",
  },
  {
    id: "tables",
    group: "Writing",
    label: "Tables",
    description: "Cell navigation, automatic rows and rich clipboard data.",
  },
  {
    id: "code",
    group: "Writing",
    label: "Code",
    description: "Language, indentation and independent code-block display.",
  },
  {
    id: "math",
    group: "Writing",
    label: "Mathematics",
    description: "Live TeX previews, completions and editing assistance.",
  },
  {
    id: "shortcuts",
    group: "Writing",
    label: "Keyboard shortcuts",
    description: "Search and customize commands for each platform.",
  },
  {
    id: "storage",
    group: "Storage",
    label: "Files & versions",
    description: "Storage usage and file-version retention.",
  },
  {
    id: "data",
    group: "Storage",
    label: "Offline research",
    description: "Device reading data and cached research papers.",
  },
  {
    id: "exports",
    group: "Storage",
    label: "Exports",
    description: "Portable copies of your research.",
  },
] as const;
export type SettingsCategory = (typeof settingsCategories)[number]["id"];
export const preferenceCategory = (id: string) =>
  [
    "theme",
    "typography",
    "layout",
    "device",
    "writing",
    "tables",
    "code",
    "math",
    "shortcuts",
  ].includes(id);
export function settingsCategory(
  id = "profile",
  legacy?: string | null,
): SettingsCategory {
  if (id === "appearance")
    return (
      (
        {
          Theme: "theme",
          Typography: "typography",
          "Reading & layout": "layout",
          Device: "device",
          Editor: "writing",
          "Keyboard shortcuts": "shortcuts",
        } as Record<string, SettingsCategory>
      )[legacy ?? "Theme"] ?? "theme"
    );
  return (
    settingsCategories.find((category) => category.id === id)?.id ?? "profile"
  );
}
export const appearanceSections: Record<string, string> = {
  theme: "Theme",
  typography: "Typography",
  layout: "Reading & layout",
  device: "Device",
  writing: "Editor",
  tables: "Tables",
  code: "Code",
  math: "Mathematics",
  shortcuts: "Keyboard shortcuts",
};
export const appearanceSettingGroups: Record<string, (keyof Preferences)[]> = {
  Theme: [
    "mode",
    "lightPreset",
    "darkPreset",
    "lightColors",
    "darkColors",
    "material",
    "glassIntensity",
  ],
  Typography: [
    "documentDecorations",
    "uiFont",
    "proseFont",
    "headingFont",
    "codeFont",
    "uiSize",
    "proseSize",
    "codeSize",
    "uiWeight",
    "proseWeight",
    "headingWeight",
    "codeWeight",
    "headingScale",
    "lineHeight",
    "paragraphSpacing",
    "letterSpacing",
    "wordSpacing",
    "mathScale",
    "ligatures",
  ],
  "Reading & layout": [
    "readingWidth",
    "fullWidth",
    "density",
    "sidebarWidth",
    "panelWidth",
    "radius",
    "shadows",
    "motion",
    "focusMode",
    "codeWrap",
    "lineNumbers",
    "activeLine",
    "exportTypography",
  ],
};
type BooleanKey = {
  [K in keyof EditorPreferences]: EditorPreferences[K] extends boolean
    ? K
    : never;
}[keyof EditorPreferences];
export const writingControls: {
  key: BooleanKey;
  category: string;
  label: string;
  hint: string;
}[] = [
  {
    key: "formattingBar",
    category: "Editor",
    label: "Persistent formatting bar",
    hint: "Optional. Context menus, selection controls and shortcuts are always available.",
  },
  {
    key: "selectionBar",
    category: "Editor",
    label: "Selection formatting",
    hint: "Show a compact formatting palette when selecting text.",
  },
  {
    key: "slashCommands",
    category: "Editor",
    label: "Slash commands",
    hint: "Type / in an empty paragraph to insert a block.",
  },
  {
    key: "autoPair",
    category: "Editor",
    label: "Pair brackets and delimiters",
    hint: "Close brackets, quotes and Markdown delimiters while typing.",
  },
  {
    key: "continuation",
    category: "Editor",
    label: "Continue Markdown blocks",
    hint: "Enter continues lists and quotes; an empty line exits one level.",
  },
  {
    key: "typewriter",
    category: "Editor",
    label: "Typewriter scrolling",
    hint: "Keep the active line near the center of the writing surface.",
  },
  {
    key: "tableTabNavigation",
    category: "Tables",
    label: "Navigate cells with Tab",
    hint: "Tab moves forward; Shift+Tab moves backward. Escape returns to the document.",
  },
  {
    key: "tableAutoRow",
    category: "Tables",
    label: "Add a row at the last cell",
    hint: "Tab in the final cell creates one new row.",
  },
  {
    key: "tableRichPaste",
    category: "Tables",
    label: "Paste spreadsheet and HTML tables",
    hint: "Expand rectangular data safely. Turn off to paste as plain cell text.",
  },
  {
    key: "codeLineNumbers",
    category: "Code",
    label: "Code-block line numbers",
    hint: "Independent of Source-mode line numbers. Never stored in Markdown.",
  },
  {
    key: "codeWrap",
    category: "Code",
    label: "Wrap code blocks",
    hint: "Long lines wrap visually; copied code stays unchanged.",
  },
  {
    key: "codeIndentOnEnter",
    category: "Code",
    label: "Smart code indentation",
    hint: "Continue indentation and indent after an opening brace or Python colon.",
  },
  {
    key: "mathPreview",
    category: "Mathematics",
    label: "Live equation preview",
    hint: "See rendered mathematics beside the TeX source while editing.",
  },
  {
    key: "mathCompletion",
    category: "Mathematics",
    label: "TeX completions and snippets",
    hint: "Complete commands and insert matrices, cases and aligned equations.",
  },
  {
    key: "mathKeepLastPreview",
    category: "Mathematics",
    label: "Keep the last valid preview",
    hint: "Incomplete expressions retain a visibly marked preview without discarding source.",
  },
];
