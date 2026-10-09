"use client";
import { uiText, useInterfaceLocale, I18nText } from "@axiom/i18n/react";

import {
  Button,
  Checkbox,
  Switch,
  TextInput,
  NativeSelect,
} from "./ui/controls";
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
      <p role="status">
        <I18nText id="Opening temporary scratchpad…" />
      </p>
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
  const { t } = useInterfaceLocale();
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
      `${uiText(c.label)} ${uiText(c.category)} ${c.label} ${c.category} ${c.keywords} ${keysFor(c.id, value, platform).join(" ")} ${keysFor(
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
          <h4>
            {uiText(category === "Editor" ? "Writing behavior" : category)}
          </h4>
          {writingControls
            .filter(
              (control) =>
                control.category === category &&
                (!search ||
                  `${uiText(control.label)} ${uiText(control.hint)} ${control.label} ${control.hint} ${category}`
                    .toLowerCase()
                    .includes(search.toLowerCase())),
            )
            .map(({ key, label, hint }) => (
              <label className="setting-toggle" key={key}>
                <span>
                  {uiText(label)}
                  <small>{uiText(hint)}</small>
                </span>
                <Switch
                  aria-label={uiText(label)}
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
                <span>
                  <I18nText id="Default code language" />
                </span>
                <TextInput
                  aria-label={uiText("Default code language")}
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
                <span>
                  <I18nText id="Code indentation" />
                </span>
                <NativeSelect
                  aria-label={uiText("Code indentation")}
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
                      <I18nText
                        id="{count, number} spaces"
                        values={{ count: n }}
                      />
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <p className="muted">
                <I18nText id="Language-name suggestions are available in the code language field and after an opening fence. Code-body autocomplete and snippet expansion are disabled; Tab indents the code." />
              </p>
              <p className="muted">
                <I18nText id="Block display preferences do not change Markdown. Code is never executed." />
              </p>
            </>
          )}
          {category === "Tables" && (
            <p className="muted">
              <I18nText id="Right-click a cell or press Shift+F10 for row, column and alignment actions. Tables support up to 100 columns and 1,000 rows. Markdown headers are preserved; merged cells and formulas are not supported." />
            </p>
          )}
          {category === "Mathematics" && (
            <p className="muted">
              <I18nText
                id="MathJax runs locally with AMS and chemistry support. To enable physics notation, add {command} to your document. External packages and code execution are disabled."
                slots={{ command: <code>{"\\require{physics}"}</code> }}
              />
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
          <h4>
            <I18nText id="Make every action feel familiar" />
          </h4>
          <p className="muted">
            <I18nText id="Shortcuts sync to your account, independently for each platform. Click a shortcut to record a replacement. Apply keeps your changes; Cancel restores your saved bindings." />
          </p>
          <div className="shortcut-tools">
            <TextInput
              ref={shortcutSearch}
              aria-label={uiText("Search shortcuts")}
              placeholder={uiText("Search commands or keys…")}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setRecording(null);
              }}
            />
            <NativeSelect
              aria-label={uiText("Shortcut platform")}
              value={platform}
              onChange={(e) => {
                setPlatform(e.target.value as ShortcutPlatform);
                setRecording(null);
                setPending(null);
                setMessage("");
              }}
            >
              <option value="mac">
                <I18nText id="macOS" />
              </option>
              <option value="windowsLinux">
                <I18nText id="Windows / Linux" />
              </option>
            </NativeSelect>
            <label className="shortcut-filter">
              <Checkbox
                checked={customOnly}
                onChange={(e) => setCustomOnly(e.target.checked)}
              />
              <I18nText id="Customized only" />
            </label>
          </div>
          <p className="shortcut-results-count" role="status">
            <I18nText
              id={
                customOnly
                  ? "{count, plural, one {# customized command} other {# customized commands}}"
                  : "{count, plural, one {# command available} other {# commands available}}"
              }
              values={{ count: commands.length }}
            />
          </p>
          {recording && (
            <div
              className="shortcut-recorder"
              role="group"
              aria-label={uiText("Record keyboard shortcut")}
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
                <I18nText
                  id="Press a shortcut for {command}. Escape cancels."
                  values={{
                    command: uiText(
                      editorCommands.find((c) => c.id === recording)?.label ??
                        "",
                    ),
                  }}
                />
              </span>
              <button
                type="button"
                aria-label={uiText("Cancel recording")}
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
                <I18nText
                  id="{shortcut} is assigned to {commands}. Reassigning removes it from those commands."
                  values={{
                    shortcut: shortcutLabel(pending.key, platform),
                    commands: pending.conflicts
                      .map((id) =>
                        uiText(
                          editorCommands.find((c) => c.id === id)?.label ?? "",
                        ),
                      )
                      .join(", "),
                  }}
                />
              </p>
              <Button
                className="button secondary"
                onClick={() =>
                  assign(pending.id, [pending.key], pending.conflicts)
                }
              >
                <I18nText id="Reassign shortcut" />
              </Button>
              <Button
                data-dialog-cancel
                className="button secondary"
                onClick={() => setPending(null)}
              >
                <I18nText id="Keep existing bindings" />
              </Button>
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
                  <strong>{uiText(c.label)}</strong>
                  <small>
                    {c.scope === "table"
                      ? t("{category} · while editing a table", {
                          category: uiText(c.category),
                        })
                      : uiText(c.category)}
                  </small>
                </span>
                <button
                  ref={(node) => {
                    if (node) shortcutButtons.current.set(c.id, node);
                    else shortcutButtons.current.delete(c.id);
                  }}
                  className="shortcut-key"
                  aria-label={t("Change shortcut for {command}", {
                    command: uiText(c.label),
                  })}
                  onClick={() => {
                    setRecording(c.id);
                    setMessage("");
                  }}
                >
                  {keysFor(c.id, value, platform)
                    .map((k) => shortcutLabel(k, platform))
                    .join(" / ") || uiText("Assign…")}
                </button>
                <button
                  className="shortcut-icon"
                  title={uiText("Disable shortcut")}
                  aria-label={t("Disable shortcut for {command}", {
                    command: uiText(c.label),
                  })}
                  disabled={!keysFor(c.id, value, platform).length}
                  onClick={() => assign(c.id, [])}
                >
                  <X size={14} />
                </button>
                <button
                  className="shortcut-icon"
                  title={uiText("Restore default")}
                  aria-label={t("Reset shortcut for {command}", {
                    command: uiText(c.label),
                  })}
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
                    ? uiText("No customized shortcuts")
                    : uiText("No matching commands")}
                </h3>
                <p>
                  {customOnly
                    ? uiText("Clear the filter to see all available commands.")
                    : uiText(
                        "Try a command name, category, or key combination.",
                      )}
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
                  <I18nText id="Show all commands" />
                </button>
              </div>
            )}
          </div>
          <div className="shortcut-tools">
            <Button
              className="button secondary"
              onClick={() =>
                onChange({ ...value, keybindings: editorDefaults.keybindings })
              }
            >
              <I18nText id="Reset all shortcuts" />
            </Button>
            <Button
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
              <I18nText id="Export" />
            </Button>
            <label className="button secondary">
              <Upload size={14} />
              <I18nText id="Import" />
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
          {uiText(message)}
        </p>
      )}
    </section>
  );
}
