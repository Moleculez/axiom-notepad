import { z } from "zod";

// Serializable metadata: the server validates preferences without importing UI code.
const catalogue = [
  [
    "source",
    "Toggle Write / Source",
    "View",
    "workspace",
    ["Mod-/", "Mod-Shift-m"],
  ],
  ["commands", "Search commands", "View", "workspace", ["Mod-Shift-."]],
  [
    "comment",
    "Comment on selection",
    "Collaboration",
    "workspace",
    ["Mod-Alt-Shift-m"],
  ],
  ["searchNotes", "Search notes", "View", "workspace", ["Mod-k"]],
  ["shortcuts", "Keyboard shortcuts", "View", "workspace", ["Mod-Alt-/"]],
  ["outline", "Toggle outline", "View", "workspace", ["Mod-Shift-l"]],
  ["focusMode", "Toggle focus mode", "View", "workspace", ["F8"]],
  ["bold", "Bold", "Formatting", "editor", ["Mod-b"]],
  ["italic", "Italic", "Formatting", "editor", ["Mod-i"]],
  ["strike", "Strikethrough", "Formatting", "editor", ["Mod-Shift-x"]],
  ["highlight", "Highlight", "Formatting", "editor", ["Mod-Shift-h"]],
  ["inlineCode", "Inline code", "Formatting", "editor", ["Mod-Shift-`"]],
  ["inlineMath", "Inline equation", "Research", "editor", ["Mod-Shift-e"]],
  ["link", "Insert or edit link", "Formatting", "editor", ["Mod-Alt-k"]],
  ["paragraph", "Paragraph", "Text", "editor", ["Mod-Alt-0"]],
  ["heading1", "Heading 1", "Text", "editor", ["Mod-Alt-1"]],
  ["heading2", "Heading 2", "Text", "editor", ["Mod-Alt-2"]],
  ["heading3", "Heading 3", "Text", "editor", ["Mod-Alt-3"]],
  ["heading4", "Heading 4", "Text", "editor", ["Mod-Alt-4"]],
  ["heading5", "Heading 5", "Text", "editor", ["Mod-Alt-5"]],
  ["heading6", "Heading 6", "Text", "editor", ["Mod-Alt-6"]],
  ["bullet", "Bullet list", "Lists", "editor", ["Mod-Alt-u"]],
  ["ordered", "Numbered list", "Lists", "editor", ["Mod-Alt-o"]],
  ["task", "Task list", "Lists", "editor", ["Mod-Alt-x"]],
  [
    "toggleTask",
    "Toggle task completion",
    "Lists",
    "editor",
    ["Mod-Shift-Enter"],
  ],
  ["quote", "Block quote", "Text", "editor", ["Mod-Alt-q"]],
  ["codeBlock", "Code block", "Text", "editor", ["Mod-Alt-c"]],
  ["mathBlock", "Display equation", "Research", "editor", ["Mod-Alt-b"]],
  ["table", "Table", "Text", "editor", ["Mod-Alt-t"]],
  ["divider", "Divider", "Text", "editor", ["Mod-Alt--"]],
  ["theorem", "Theorem", "Research", "editor", []],
  ["proof", "Proof", "Research", "editor", []],
  ["definition", "Definition", "Research", "editor", []],
  ["lemma", "Lemma", "Research", "editor", []],
  ["note", "Note callout", "Research", "editor", []],
  ["warning", "Warning callout", "Research", "editor", []],
  ["question", "Research question", "Research", "editor", []],
  ["diagram", "Mermaid diagram", "Research", "editor", []],
  ["citation", "Citation", "Research", "editor", []],
  ["equationRef", "Equation reference", "Research", "editor", []],
  ["footnote", "Footnote", "Research", "editor", []],
  ["noteLink", "Link a note", "Research", "editor", []],
  ["attachment", "Image or attachment", "Media", "editor", []],
  ["find", "Find in note", "Editing", "editor", ["Mod-f"]],
  ["replace", "Find and replace", "Editing", "editor", ["Mod-Shift-f"]],
  ["undo", "Undo", "Editing", "editor", ["Mod-z"]],
  ["redo", "Redo", "Editing", "editor", ["Mod-Shift-z"]],
  [
    "copyMarkdown",
    "Copy selection as Markdown",
    "Editing",
    "editor",
    ["Mod-Alt-m"],
  ],
  ["copyCode", "Copy code contents", "Editing", "editor", []],
  ["copyBlockSource", "Copy block Markdown", "Editing", "editor", []],
  ["paragraphBefore", "Insert paragraph before", "Editing", "editor", []],
  ["codeWrap", "Wrap this code block", "Code", "editor", []],
  ["codeLineNumbers", "Line numbers in this block", "Code", "editor", []],
  ["resetCodeDisplay", "Use default code display", "Code", "editor", []],
  ["copyTex", "Copy TeX", "Mathematics", "editor", []],
  ["copyMathSvg", "Copy equation as SVG", "Mathematics", "editor", []],
  ["equationLabel", "Add or edit equation label", "Mathematics", "editor", []],
  [
    "duplicate",
    "Duplicate selection or block",
    "Editing",
    "editor",
    ["Mod-Shift-d"],
  ],
  ["moveUp", "Move block up", "Editing", "editor", ["Alt-ArrowUp"]],
  ["moveDown", "Move block down", "Editing", "editor", ["Alt-ArrowDown"]],
  ["indent", "Indent", "Editing", "editor", ["Mod-]"]],
  ["outdent", "Outdent", "Editing", "editor", ["Mod-["]],
  ["finishBlock", "Continue after block", "Editing", "editor", ["Mod-Enter"]],
  ["rowBefore", "Insert row above", "Table", "table", []],
  ["rowAfter", "Insert row below", "Table", "table", ["Mod-Enter"]],
  ["duplicateRow", "Duplicate row", "Table", "table", []],
  ["deleteRow", "Delete table row", "Table", "table", ["Mod-Shift-Backspace"]],
  ["columnBefore", "Insert column left", "Table", "table", []],
  ["columnAfter", "Insert column right", "Table", "table", []],
  ["duplicateColumn", "Duplicate column", "Table", "table", []],
  ["deleteColumn", "Delete table column", "Table", "table", []],
  ["rowUp", "Move table row up", "Table", "table", ["Alt-ArrowUp"]],
  ["rowDown", "Move table row down", "Table", "table", ["Alt-ArrowDown"]],
  ["columnLeft", "Move column left", "Table", "table", []],
  ["columnRight", "Move column right", "Table", "table", []],
  ["alignDefault", "Default column alignment", "Table", "table", []],
  ["alignLeft", "Align column left", "Table", "table", []],
  ["alignCenter", "Align column center", "Table", "table", []],
  ["alignRight", "Align column right", "Table", "table", []],
  ["copyTable", "Copy table as TSV", "Table", "table", []],
  ["selectRow", "Select row", "Table", "table", []],
  ["selectColumn", "Select column", "Table", "table", []],
  ["selectTable", "Select all cells", "Table", "table", []],
  ["clearCells", "Clear selected cells", "Table", "table", []],
] as const;
export type EditorCommandId = (typeof catalogue)[number][0];
export type CommandScope = "workspace" | "editor" | "table";
export type EditorCommand = {
  id: EditorCommandId;
  label: string;
  category: string;
  scope: CommandScope;
  keys: readonly string[];
  insert: boolean;
  keywords: string;
};
const insertIds = new Set<string>([
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "bullet",
  "ordered",
  "task",
  "quote",
  "codeBlock",
  "mathBlock",
  "inlineMath",
  "table",
  "divider",
  "theorem",
  "proof",
  "definition",
  "lemma",
  "note",
  "warning",
  "question",
  "diagram",
  "citation",
  "equationRef",
  "footnote",
  "noteLink",
  "attachment",
]);
export const editorCommands: EditorCommand[] = catalogue.map(
  ([id, label, category, scope, keys]) => ({
    id,
    label,
    category,
    scope,
    keys,
    insert: insertIds.has(id),
    keywords:
      (
        {
          mathBlock: "math latex tex equation",
          inlineMath: "math latex tex",
          codeBlock: "code python fence",
          citation: "cite bibliography reference",
          diagram: "flowchart mermaid",
          heading1: "h1",
          heading2: "h2",
          heading3: "h3",
          heading4: "h4",
          heading5: "h5",
          heading6: "h6",
          task: "todo checklist",
          bullet: "unordered list",
          noteLink: "wiki backlink",
          attachment: "image file upload media picture document pdf",
        } as Record<string, string>
      )[id] ?? "",
  }),
);
export const commandById = Object.fromEntries(
  editorCommands.map((c) => [c.id, c]),
) as Record<EditorCommandId, EditorCommand>;
export type ShortcutPlatform = "mac" | "windowsLinux";
const binding = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^(?:(?:Mod|Ctrl|Alt|Shift|Meta)-)*(?:[a-z0-9/.,;\[\]`\\=\-]|Arrow(?:Up|Down|Left|Right)|Enter|Backspace|Delete|Home|End|PageUp|PageDown|F(?:[1-9]|1[0-2]))$/,
  );
const overrides = z
  .record(z.string(), z.array(binding).max(2))
  .default({})
  .superRefine((value, ctx) => {
    for (const id of Object.keys(value))
      if (!Object.hasOwn(commandById, id))
        ctx.addIssue({
          code: "custom",
          message: "Unknown command",
          path: [id],
        });
  });
const editorPreferencesV2 = z
  .object({
    schemaVersion: z.literal(2).default(2),
    slashCommands: z.boolean().default(true),
    mathPreview: z.boolean().default(true),
    continuation: z.boolean().default(true),
    formattingBar: z.boolean().default(false),
    selectionBar: z.boolean().default(true),
    autoPair: z.boolean().default(true),
    typewriter: z.boolean().default(false),
    tableTabNavigation: z.boolean().default(true),
    tableAutoRow: z.boolean().default(true),
    tableRichPaste: z.boolean().default(true),
    codeLineNumbers: z.boolean().default(false),
    codeWrap: z.boolean().default(false),
    codeIndentOnEnter: z.boolean().default(true),
    mathCompletion: z.boolean().default(true),
    mathKeepLastPreview: z.boolean().default(true),
    defaultCodeLanguage: z
      .string()
      .max(40)
      .regex(/^[\w+#.-]*$/)
      .default("python"),
    indentSize: z.union([z.literal(2), z.literal(4), z.literal(8)]).default(4),
    keybindings: z
      .object({ mac: overrides, windowsLinux: overrides })
      .strict()
      .default({ mac: {}, windowsLinux: {} }),
  })
  .strict();
// Reading/import migration only. API writers must send the current version;
// otherwise a stale tab could erase preferences it cannot represent.
export const editorPreferencesSchema = z.preprocess((value) => {
  if (
    value &&
    typeof value === "object" &&
    "schemaVersion" in value &&
    value.schemaVersion === 1
  )
    return { ...value, schemaVersion: 2 };
  return value;
}, editorPreferencesV2);
export type EditorPreferences = z.infer<typeof editorPreferencesSchema>;
export const editorDefaults = editorPreferencesSchema.parse({});
export const editorPreferenceKeys = Object.keys(editorDefaults).filter(
  (key) => key !== "schemaVersion" && key !== "keybindings",
) as Exclude<keyof EditorPreferences, "schemaVersion" | "keybindings">[];
export type EditorPreferenceRecord = {
  preferences: EditorPreferences;
  version: number;
};
export function keysFor(
  id: EditorCommandId,
  p: EditorPreferences,
  platform: ShortcutPlatform,
): readonly string[] {
  return (
    p.keybindings[platform][id] ??
    (id === "redo" && platform === "windowsLinux"
      ? ["Mod-y", "Mod-Shift-z"]
      : commandById[id].keys)
  );
}
export function shortcutPlatform(): ShortcutPlatform {
  return typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
    ? "mac"
    : "windowsLinux";
}
export function shortcutLabel(key: string, platform: ShortcutPlatform) {
  return key
    .replace(/Mod-/g, platform === "mac" ? "⌘ " : "Ctrl ")
    .replace(/Ctrl-/g, "Ctrl ")
    .replace(/Meta-/g, "⌘ ")
    .replace(/Alt-/g, platform === "mac" ? "⌥ " : "Alt ")
    .replace(/Shift-/g, "⇧ ")
    .replace(/ArrowUp/g, "↑")
    .replace(/ArrowDown/g, "↓")
    .replace(/ArrowLeft/g, "←")
    .replace(/ArrowRight/g, "→")
    .replace(/[a-z]$/g, (c) => c.toUpperCase());
}
export function eventBinding(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
  >,
  platform: ShortcutPlatform,
) {
  let key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const punctuation: Record<string, string> = {
    Slash: "/",
    Period: ".",
    Backquote: "`",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Minus: "-",
    Equal: "=",
  };
  if (event.shiftKey && punctuation[event.code]) key = punctuation[event.code];
  if (event.shiftKey && /^Digit\d$/.test(event.code))
    key = event.code.slice(-1);
  return [
    platform === "mac" ? event.metaKey && "Mod" : event.ctrlKey && "Mod",
    platform === "mac" ? event.ctrlKey && "Ctrl" : event.metaKey && "Meta",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("-");
}
export function bindingProblem(key: string) {
  if (!binding.safeParse(key).success)
    return "Choose a supported key combination.";
  if (
    /^(?:Mod|Meta)-(?:Shift-)?(?:q|w|t|n|r|[0-9=\-])$/.test(key) ||
    /^(?:Mod|Meta)-Alt-h$/.test(key) ||
    key === "Alt-F4" ||
    key === "Mod-m"
  )
    return "This combination is reserved for the browser or operating system.";
  if (!/^(Mod|Ctrl|Meta|Alt)-|^F\d/.test(key))
    return "Use a modifier or function key so ordinary typing is not intercepted.";
  return "";
}
export function bindingConflicts(
  p: EditorPreferences,
  platform: ShortcutPlatform,
  id: EditorCommandId,
  key: string,
) {
  const scope = commandById[id].scope;
  return editorCommands.filter(
    (c) =>
      c.id !== id &&
      (c.scope === scope || c.scope === "workspace" || scope === "workspace") &&
      keysFor(c.id, p, platform).includes(key),
  );
}
export function validateEditorPreferences(value: unknown) {
  const p = editorPreferencesSchema.parse(value);
  for (const platform of ["mac", "windowsLinux"] as const)
    for (const [id, keys] of Object.entries(p.keybindings[platform]))
      for (const key of keys) {
        const error = bindingProblem(key);
        if (error) throw new Error(error);
        if (bindingConflicts(p, platform, id as EditorCommandId, key).length)
          throw new Error(
            "Two overlapping commands use " +
              key +
              ". Reassign or remove the conflicting binding.",
          );
      }
  return p;
}
export function mergeEditorPreferences(
  base: EditorPreferences,
  local: EditorPreferences,
  remote: EditorPreferences,
) {
  const merged = structuredClone(remote),
    conflicts: string[] = [];
  const merge = (
    path: string,
    a: unknown,
    b: unknown,
    c: unknown,
    set: (v: unknown) => void,
  ) => {
    if (JSON.stringify(b) === JSON.stringify(a)) return;
    set(b);
    if (
      JSON.stringify(c) !== JSON.stringify(a) &&
      JSON.stringify(b) !== JSON.stringify(c)
    )
      conflicts.push(path);
  };
  for (const key of editorPreferenceKeys)
    merge(key, base[key], local[key], remote[key], (v) =>
      Object.assign(merged, { [key]: v }),
    );
  for (const platform of ["mac", "windowsLinux"] as const)
    for (const c of editorCommands)
      merge(
        `keybindings.${platform}.${c.id}`,
        base.keybindings[platform][c.id],
        local.keybindings[platform][c.id],
        remote.keybindings[platform][c.id],
        (v) => {
          if (v === undefined) delete merged.keybindings[platform][c.id];
          else merged.keybindings[platform][c.id] = v as string[];
        },
      );
  // Independently rebound commands may collide after an otherwise clean merge.
  for (const platform of ["mac", "windowsLinux"] as const)
    for (const c of editorCommands)
      for (const key of keysFor(c.id, merged, platform))
        if (bindingConflicts(merged, platform, c.id, key).length)
          conflicts.push(`keybindings.${platform}.${c.id}`);
  return { merged, conflicts: [...new Set(conflicts)] };
}
