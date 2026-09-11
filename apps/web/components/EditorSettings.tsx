"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Keyboard, RotateCcw, X, Download, Upload } from "lucide-react";
import {
  editorCommands,
  editorDefaults,
  keysFor,
  shortcutPlatform,
  shortcutLabel,
  eventBinding,
  bindingProblem,
  bindingConflicts,
  validateEditorPreferences,
  type EditorCommandId,
  type EditorPreferences,
  type ShortcutPlatform,
} from "@axiom/shared/editor";
import { download } from "../lib/client";
import { writingControls } from "../lib/settings-registry";
import { defaults, type Preferences } from "@axiom/shared/appearance";
// Like the main editor, the preview's DOM/Yjs engine must stay client-only.
const SettingsEditorPreview = dynamic(() => import("./SettingsEditorPreview"), {
  ssr: false,
  loading: () => (
    <section className="settings-scratchpad" aria-busy="true">
      <p role="status">Opening temporary scratchpad…</p>
    </section>
  ),
});
export default function EditorSettings({
  value,
  onChange,
  shortcuts = false,
  search = "",
  category = "Editor",
  appearance = defaults,
  preview = true,
}: {
  value: EditorPreferences;
  onChange: (p: EditorPreferences) => void;
  shortcuts?: boolean;
  search?: string;
  category?: string;
  appearance?: Preferences;
  preview?: boolean;
}) {
  const [platform, setPlatform] = useState<ShortcutPlatform>(shortcutPlatform),
    [filter, setFilter] = useState(""),
    [customOnly, setCustomOnly] = useState(false),
    [recording, setRecording] = useState<EditorCommandId | null>(null),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState<{
      id: EditorCommandId;
      key: string;
      conflicts: EditorCommandId[];
    } | null>(null);
  const shortcutButtons = useRef(new Map<EditorCommandId, HTMLButtonElement>());
  const shortcutSearch = useRef<HTMLInputElement>(null);
  const restoreFocus = (id: EditorCommandId) =>
    requestAnimationFrame(() =>
      (shortcutButtons.current.get(id) ?? shortcutSearch.current)?.focus(),
    );
  const assign = (
    id: EditorCommandId,
    keys: string[] | undefined,
    reassign: EditorCommandId[] = [],
  ) => {
    const overrides = { ...value.keybindings[platform] };
    if (keys === undefined) delete overrides[id];
    else overrides[id] = keys;
    for (const other of reassign)
      overrides[other] = keysFor(other, value, platform).filter(
        (key) => !keys?.includes(key),
      );
    onChange({
      ...value,
      keybindings: { ...value.keybindings, [platform]: overrides },
    });
    setRecording(null);
    setPending(null);
    setMessage("");
    restoreFocus(id);
  };
  const query = (search || filter).trim().toLowerCase();
  const commands = editorCommands.filter(
    (c) =>
      (!customOnly || Object.hasOwn(value.keybindings[platform], c.id)) &&
      `${c.label} ${c.category} ${c.keywords} ${keysFor(c.id, value, platform).join(" ")} ${keysFor(
        c.id,
        value,
        platform,
      )
        .map((key) => shortcutLabel(key, platform))
        .join(" ")}`
        .toLowerCase()
        .includes(query),
  );
  return (
    <section className="settings-card editor-settings-card">
      {!shortcuts ? (
        <>
          <h4>{category === "Editor" ? "Writing behavior" : category}</h4>
          {writingControls
            .filter(
              (control) =>
                control.category === category &&
                (!search ||
                  `${control.label} ${control.hint} ${category}`
                    .toLowerCase()
                    .includes(search.toLowerCase())),
            )
            .map(({ key, label, hint }) => (
              <label className="setting-toggle" key={key}>
                <span>
                  {label}
                  <small>{hint}</small>
                </span>
                <input
                  type="checkbox"
                  aria-label={label}
                  checked={value[key]}
                  onChange={(e) =>
                    onChange({ ...value, [key]: e.target.checked })
                  }
                />
              </label>
            ))}
          {category === "Code" && (
            <>
              <label className="setting-control">
                <span>Default code language</span>
                <input
                  aria-label="Default code language"
                  value={value.defaultCodeLanguage}
                  maxLength={40}
                  onChange={(e) => {
                    if (/^[\w+#.-]*$/.test(e.target.value))
                      onChange({
                        ...value,
                        defaultCodeLanguage: e.target.value,
                      });
                  }}
                  list="editor-code-languages"
                />
                <datalist id="editor-code-languages">
                  {[
                    "python",
                    "julia",
                    "r",
                    "cpp",
                    "javascript",
                    "typescript",
                    "json",
                    "yaml",
                    "sql",
                    "bash",
                    "latex",
                    "plaintext",
                    "mermaid",
                  ].map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </label>
              <label className="setting-control">
                <span>Code indentation</span>
                <select
                  aria-label="Code indentation"
                  value={value.indentSize}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      indentSize: Number(e.target.value) as 2 | 4 | 8,
                    })
                  }
                >
                  {[2, 4, 8].map((n) => (
                    <option key={n} value={n}>
                      {n} spaces
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                Language-name suggestions are available in the code language
                field and after an opening fence. Code-body autocomplete and
                snippet expansion are disabled; Tab indents the code.
              </p>
              <p className="muted">
                Block display preferences do not change Markdown. Code is never
                executed.
              </p>
            </>
          )}
          {category === "Tables" && (
            <p className="muted">
              Right-click a cell or press Shift+F10 for row, column and
              alignment actions. Tables support up to 100 columns and 1,000
              rows. Markdown headers are preserved; merged cells and formulas
              are not supported.
            </p>
          )}
          {category === "Mathematics" && (
            <p className="muted">
              MathJax runs locally. AMS and chemistry are included. Physics
              notation is opt-in with <code>{"\\require{physics}"}</code> in
              your document. External packages and code execution are disabled.
            </p>
          )}
          {!search && preview && (
            <SettingsEditorPreview
              preferences={value}
              appearance={appearance}
              category={category}
            />
          )}
        </>
      ) : (
        <>
          <h4>Make every action feel familiar</h4>
          <p className="muted">
            Shortcuts sync to your account, independently for each platform.
            Click a shortcut to record a replacement. Apply keeps your changes;
            Cancel restores your saved bindings.
          </p>
          <div className="shortcut-tools">
            <input
              ref={shortcutSearch}
              aria-label="Search shortcuts"
              placeholder="Search commands or keys…"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setRecording(null);
              }}
            />
            <select
              aria-label="Shortcut platform"
              value={platform}
              onChange={(e) => {
                setPlatform(e.target.value as ShortcutPlatform);
                setRecording(null);
                setPending(null);
                setMessage("");
              }}
            >
              <option value="mac">macOS</option>
              <option value="windowsLinux">Windows / Linux</option>
            </select>
            <label className="shortcut-filter">
              <input
                type="checkbox"
                checked={customOnly}
                onChange={(e) => setCustomOnly(e.target.checked)}
              />
              Customized only
            </label>
          </div>
          <p className="shortcut-results-count" role="status">
            {commands.length} {commands.length === 1 ? "command" : "commands"}
            {customOnly ? " with custom bindings" : " available"}
          </p>
          {recording && (
            <div
              className="shortcut-recorder"
              role="group"
              aria-label="Record keyboard shortcut"
              tabIndex={0}
              ref={(node) => node?.focus()}
              onKeyDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.key === "Escape") {
                  setRecording(null);
                  restoreFocus(recording);
                  return;
                }
                if (
                  e.nativeEvent.isComposing ||
                  ["Meta", "Control", "Alt", "Shift"].includes(e.key)
                )
                  return;
                const key = eventBinding(e.nativeEvent, platform),
                  error = bindingProblem(key);
                if (error) {
                  setMessage(error);
                  return;
                }
                const conflicts = bindingConflicts(
                  value,
                  platform,
                  recording,
                  key,
                );
                if (conflicts.length) {
                  setPending({
                    id: recording,
                    key,
                    conflicts: conflicts.map((c) => c.id),
                  });
                  setRecording(null);
                } else assign(recording, [key]);
              }}
            >
              <Keyboard size={18} />
              <span>
                Press a shortcut for{" "}
                {editorCommands.find((c) => c.id === recording)?.label}. Escape
                cancels.
              </span>
              <button
                type="button"
                aria-label="Cancel recording"
                onClick={() => {
                  restoreFocus(recording);
                  setRecording(null);
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {pending && (
            <div className="settings-conflict">
              <p>
                {shortcutLabel(pending.key, platform)} is used by{" "}
                {pending.conflicts
                  .map((id) => editorCommands.find((c) => c.id === id)?.label)
                  .join(", ")}
                . Reassigning removes it from those commands.
              </p>
              <button
                className="button secondary"
                onClick={() =>
                  assign(pending.id, [pending.key], pending.conflicts)
                }
              >
                Reassign shortcut
              </button>
              <button
                className="button secondary"
                onClick={() => setPending(null)}
              >
                Keep existing bindings
              </button>
            </div>
          )}
          <div className="shortcut-list">
            {commands.map((c) => (
              <div
                className="shortcut-row"
                key={c.id}
                data-customized={
                  Object.hasOwn(value.keybindings[platform], c.id) || undefined
                }
              >
                <span>
                  <strong>{c.label}</strong>
                  <small>
                    {c.category}
                    {c.scope === "table" ? " · while editing a table" : ""}
                  </small>
                </span>
                <button
                  ref={(node) => {
                    if (node) shortcutButtons.current.set(c.id, node);
                    else shortcutButtons.current.delete(c.id);
                  }}
                  className="shortcut-key"
                  aria-label={`Change shortcut for ${c.label}`}
                  onClick={() => {
                    setRecording(c.id);
                    setMessage("");
                  }}
                >
                  {keysFor(c.id, value, platform)
                    .map((k) => shortcutLabel(k, platform))
                    .join(" / ") || "Assign…"}
                </button>
                <button
                  className="shortcut-icon"
                  title="Disable shortcut"
                  aria-label={`Disable shortcut for ${c.label}`}
                  disabled={!keysFor(c.id, value, platform).length}
                  onClick={() => assign(c.id, [])}
                >
                  <X size={14} />
                </button>
                <button
                  className="shortcut-icon"
                  title="Restore default"
                  aria-label={`Reset shortcut for ${c.label}`}
                  disabled={!Object.hasOwn(value.keybindings[platform], c.id)}
                  onClick={() => assign(c.id, undefined)}
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            ))}
            {!commands.length && (
              <div className="settings-empty">
                <Keyboard size={22} />
                <h3>
                  {customOnly && !query
                    ? "No customized shortcuts"
                    : "No matching commands"}
                </h3>
                <p>
                  {customOnly
                    ? "Clear the filter to see all available commands."
                    : "Try a command name, category, or key combination."}
                </p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setFilter("");
                    setCustomOnly(false);
                    shortcutSearch.current?.focus();
                  }}
                >
                  Show all commands
                </button>
              </div>
            )}
          </div>
          <div className="shortcut-tools">
            <button
              className="button secondary"
              onClick={() =>
                onChange({ ...value, keybindings: editorDefaults.keybindings })
              }
            >
              Reset all shortcuts
            </button>
            <button
              className="button secondary"
              onClick={() =>
                download(
                  "axiom-editor-settings.json",
                  JSON.stringify(
                    {
                      format: "axiom-editor-settings",
                      version: 1,
                      preferences: value,
                    },
                    null,
                    2,
                  ),
                )
              }
            >
              <Download size={14} />
              Export
            </button>
            <label className="button secondary">
              <Upload size={14} />
              Import
              <input
                type="file"
                hidden
                accept=".json,application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void (async () => {
                    try {
                      if (file.size > 50000)
                        throw new Error(
                          "Use an editor settings file under 50 KB.",
                        );
                      const input = JSON.parse(await file.text());
                      if (
                        input.format !== "axiom-editor-settings" ||
                        input.version !== 1
                      )
                        throw new Error("Use an Axiom editor settings export.");
                      onChange(validateEditorPreferences(input.preferences));
                      setMessage("Imported into this draft. Apply to save.");
                    } catch (error) {
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : "Invalid settings file.",
                      );
                    }
                  })();
                }}
              />
            </label>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="form-error">
          {message}
        </p>
      )}
    </section>
  );
}
