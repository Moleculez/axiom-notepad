"use client";
import PdfReaderSettings from "./pdf/PdfReaderSettings";
import { confirmAction } from "../lib/app-prompt";
import {
  workspaceThemeFamilies,
  workspaceThemes,
} from "@axiom/shared/workspace-themes";
import { useEffect, useRef, useState } from "react";
import {
  Download,
  RotateCcw,
  Search,
  Upload,
  Check,
  Monitor,
  Palette,
  Type,
  SlidersHorizontal,
  Keyboard,
  PencilLine,
  PanelRight,
  X,
} from "lucide-react";
import EditorSettings from "./EditorSettings";
import SettingsEditorPreview from "./SettingsEditorPreview";
import MinimapSettings from "./MinimapSettings";
import SettingsSplitPanel from "./SettingsSplitPanel";
import { themePacks, type ThemePackId } from "@axiom/shared/theme-packs";
import {
  editorThemes,
  applyEditorTheme,
  matchingEditorTheme,
  documentStyles,
  applyDocumentStyle,
  matchingDocumentStyle,
  documentStyleFont,
  type DocumentStyleId,
} from "@axiom/shared/editor-looks";
import { ColorPreference, NumberPreference } from "./PreferenceControls";
import {
  appearanceVariables,
  type Palette as ThemePalette,
} from "@axiom/shared/appearance";
import { editorDefaults } from "@axiom/shared/editor";
import { useSettingsDraft, type SettingsDraft } from "../lib/settings-draft";
import {
  appearanceSettingGroups,
  writingControls,
  settingsCategories,
  appearanceSections,
} from "../lib/settings-registry";
import type { EditorPreferencesController } from "../lib/editor-preferences";
import {
  defaults,
  modernAppearance,
  fonts,
  contrastRatio,
  paletteFor,
  themeFileSchema,
  type Preferences,
  type DevicePreferences,
} from "@axiom/shared/appearance";
import type { AppearanceController } from "../lib/appearance";
import { download } from "../lib/client";

type AppearanceSettingsProps = {
  appearance: AppearanceController;
  onClose: () => void;
  onWorkspace: () => void;
  onData: () => void;
  editorSettings: EditorPreferencesController;
  initialSection?: string;
  session?: SettingsDraft;
  routed?: boolean;
  onSection?: (section: string) => void;
};
export default function AppearanceSettings(props: AppearanceSettingsProps) {
  if (!props.appearance.ready || !props.editorSettings.ready)
    return <p role="status">Loading your preferences…</p>;
  return <AppearanceSettingsReady {...props} key={props.appearance.userId} />;
}
function AppearanceSettingsReady({
  appearance,
  onClose,
  onWorkspace,
  onData,
  editorSettings,
  initialSection = "Theme",
  session,
  routed = false,
  onSection,
}: AppearanceSettingsProps) {
  const internal = useSettingsDraft(appearance, editorSettings, !session);
  const settings = session ?? internal;
  const {
    values: { appearance: draft, editor: editorDraft },
    device,
    setAppearance: setDraft,
    setEditor: setEditorDraft,
    setDevice,
    savePrevious,
    setSavePrevious,
  } = settings;
  const [section, setSection] = useState(initialSection),
    [query, setQuery] = useState(""),
    [editDark, setEditDark] = useState(appearance.dark),
    [message, setMessage] = useState(""),
    [themeName, setThemeName] = useState("");
  const [showPreview, setShowPreview] = useState(true),
    [emptySearch, setEmptySearch] = useState(false);
  const fields = useRef<HTMLDivElement>(null);
  const previewCategory =
    section === "Keyboard shortcuts"
      ? undefined
      : ["General", "Editor", "Tables", "Code", "Mathematics"].includes(section)
        ? section
        : "Appearance";
  const description = settingsCategories.find(
    (c) => appearanceSections[c.id] === section,
  )?.description;
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const invalidField = (key: string, value: boolean) =>
    setInvalid((old) => (old[key] === value ? old : { ...old, [key]: value }));
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setDraft((p) => ({ ...p, [key]: value }));
  useEffect(() => {
    setSection(initialSection);
    setQuery("");
  }, [initialSection]);
  useEffect(() => {
    fields.current?.scrollTo({ top: 0 });
  }, [section, query]);
  useEffect(() => {
    setEmptySearch(
      !!query &&
        !Array.from(
          fields.current?.querySelectorAll(".settings-card") ?? [],
        ).some((el) => (el as HTMLElement).offsetHeight > 0),
    );
  }, [query, section]);
  const show = (category: string, label = "") =>
    query
      ? `${category} ${label}`.toLowerCase().includes(query.toLowerCase())
      : section === category;
  const number = (
    category: string,
    key: keyof Preferences,
    label: string,
    min: number,
    max: number,
    step: number,
    unit = "",
  ) =>
    show(category, label) && (
      <NumberPreference
        key={key}
        label={label}
        value={draft[key] as number}
        min={min}
        max={max}
        step={step}
        unit={unit}
        onChange={(value) => change(key, value as never)}
        reset={() => change(key, defaults[key])}
        onInvalid={(value) => invalidField(key, value)}
      />
    );
  const toggle = (
    category: string,
    key: keyof Preferences,
    label: string,
    hint?: string,
  ) =>
    show(category, label) && (
      <label className="setting-toggle" key={key}>
        <span>
          {label}
          {hint && <small>{hint}</small>}
        </span>
        <input
          aria-label={label}
          type="checkbox"
          checked={draft[key] as boolean}
          onChange={(e) => change(key, e.target.checked as never)}
        />
      </label>
    );
  const select = (
    category: string,
    key: keyof Preferences,
    label: string,
    options: [string, string][],
  ) =>
    show(category, label) && (
      <label className="setting-control" key={key}>
        <span>{label}</span>
        <select
          aria-label={label}
          value={String(draft[key])}
          onChange={(e) => change(key, e.target.value as never)}
        >
          {options.map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
      </label>
    );
  const colors = paletteFor(draft, editDark),
    colorKey = editDark ? "darkColors" : "lightColors";
  const checks = [
    ["Body", colors.text, colors.paper],
    ["Secondary text", colors.muted, colors.paper],
    ["Links", colors.accent, colors.paper],
    ["Interface", colors.text, colors.sidebar],
    ["Code", colors.codeText, colors.code],
    ["Button labels", colors.onAccent, colors.accent],
  ];
  const save = () => {
    if (settings.apply()) {
      setMessage("Preferences applied.");
      if (!routed) onClose();
    }
  };
  return (
    <div className={`appearance-settings ${routed ? "settings-routed" : ""}`}>
      {!routed && (
        <div className="settings-navigation">
          <label className="settings-search">
            <Search size={16} />
            <input
              aria-label="Search settings"
              placeholder="Find a setting…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <nav aria-label="Personal settings">
            {[
              ["General", SlidersHorizontal],
              ["Theme", Palette],
              ["Typography", Type],
              ["Reading & layout", SlidersHorizontal],
              ["Device", Monitor],
              ["Editor", PencilLine],
              ["Tables", SlidersHorizontal],
              ["Code", PencilLine],
              ["Mathematics", PencilLine],
              ["Keyboard shortcuts", Keyboard],
            ].map(([name, Icon]) => {
              const Glyph = Icon as typeof Palette;
              return (
                <button
                  type="button"
                  key={String(name)}
                  className={section === name ? "active" : ""}
                  onClick={() => {
                    setSection(String(name));
                    onSection?.(String(name));
                    setQuery("");
                  }}
                >
                  <Glyph size={17} />
                  {String(name)}
                </button>
              );
            })}
          </nav>
          <p>PERSONAL WORKSPACE</p>
          <button className="text-button" onClick={onData}>
            Offline files & reading data
          </button>
          <button className="text-button" onClick={onWorkspace}>
            Account & group administration
          </button>
          <small>
            Your reading preferences never change a collaborator’s view.
          </small>
        </div>
      )}
      <div className="settings-stage">
        <div className="settings-intro">
          <div className="settings-intro-copy">
            <div className="eyebrow">MAKE SPACE FOR YOUR THINKING</div>
            {routed ? (
              <h1>
                {query
                  ? "Search results"
                  : section === "Editor"
                    ? "Writing"
                    : section}
              </h1>
            ) : (
              <h3>{query ? "Search results" : section}</h3>
            )}
            <p className="muted">
              {description ??
                "Personal preferences for a comfortable workspace."}
            </p>
          </div>
          <div className="settings-intro-tools">
            {routed && section !== "Keyboard shortcuts" && (
              <label className="settings-search settings-content-search">
                <Search size={16} />
                <input
                  aria-label="Search settings"
                  placeholder="Search settings…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    className="settings-search-clear"
                    aria-label="Clear settings search"
                    onClick={() => setQuery("")}
                  >
                    <X size={14} />
                  </button>
                )}
              </label>
            )}
            {previewCategory && (
              <button
                type="button"
                className="button secondary small settings-preview-toggle"
                aria-label={
                  showPreview ? "Hide live preview" : "Show live preview"
                }
                aria-pressed={showPreview}
                onClick={() => setShowPreview((value) => !value)}
              >
                <PanelRight size={16} />
                Preview
              </button>
            )}
          </div>
        </div>
        <SettingsSplitPanel
          showPreview={showPreview}
          preview={
            previewCategory ? (
              <SettingsEditorPreview
                preferences={editorDraft}
                appearance={draft}
                category={previewCategory}
                showInterface
                dark={appearance.dark}
                active={showPreview}
                onAppearanceChange={setDraft}
              />
            ) : undefined
          }
        >
          <div
            className="settings-content"
            ref={fields}
            aria-label="Settings fields"
            tabIndex={0}
          >
            {emptySearch && (
              <div className="settings-empty" role="status">
                <Search size={22} />
                <h3>No matching settings</h3>
                <p>Try “font”, “color”, “table”, or another keyword.</p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setQuery("")}
                >
                  Clear search
                </button>
              </div>
            )}
            {["Editor", "Tables", "Code", "Mathematics"].map(
              (category) =>
                show(
                  category,
                  writingControls
                    .filter((c) => c.category === category)
                    .map((c) => `${c.label} ${c.hint}`)
                    .join(" "),
                ) && (
                  <EditorSettings
                    key={category}
                    value={editorDraft}
                    appearance={draft}
                    onChange={setEditorDraft}
                    category={category}
                    search={query}
                    preview={false}
                  />
                ),
            )}
            {show(
              "Keyboard shortcuts",
              "commands bindings keyboard typing",
            ) && (
              <EditorSettings
                value={editorDraft}
                onChange={setEditorDraft}
                shortcuts
                search={query}
              />
            )}
            {show(
              "General",
              "block ranges guides nesting structure bookmarks annotations reading overview",
            ) && (
              <section className="settings-card">
                <h4>Document structure</h4>
                <p className="settings-note">
                  Follow nested blocks with a quiet margin. Use its chevrons to
                  fold longer blocks.
                </p>
                {toggle(
                  "General",
                  "blockGuides",
                  "Show block ranges",
                  "Vertical guides beside blocks while writing. Hidden in Read, Source and exports.",
                )}
                {toggle(
                  "General",
                  "readingMarkMargin",
                  "Show reading marks in the margin",
                  "Bookmarks and annotation actions beside document blocks. Your saved marks remain available in the panel when hidden.",
                )}
                {toggle(
                  "General",
                  "readingMarkOverview",
                  "Show reading marks overview",
                  "A quiet right-edge map of bookmarks and annotations throughout the document.",
                )}
              </section>
            )}
            {show(
              "General",
              "minimap miniature document map navigation sizing width position preview selection search collaborators",
            ) && (
              <MinimapSettings
                value={draft.minimap}
                onChange={(value) => change("minimap", value)}
                onInvalid={(value) => invalidField("minimap.width", value)}
              />
            )}
            {show(
              "General",
              "pdf reader paper annotations layout pages navigator research",
            ) && (
              <PdfReaderSettings
                value={draft.pdfReader}
                onChange={(value) => change("pdfReader", value)}
              />
            )}
            {show(
              "Theme",
              "palette colors light dark system custom contrast import export glass material transparency restore previous",
            ) && (
              <section className="settings-card">
                <h4>Color & atmosphere</h4>
                <label className="setting-control">
                  <span>
                    Theme pack
                    <small>
                      Reviewed, built-in styles. Your explicit color and
                      typography choices stay in control.
                    </small>
                  </span>
                  <select
                    aria-label="Theme pack"
                    value={draft.themePack}
                    onChange={(e) =>
                      change("themePack", e.target.value as ThemePackId)
                    }
                  >
                    <option value="default">Axiom default</option>
                    {themePacks.map((pack) => (
                      <option key={pack.id} value={pack.id}>
                        {pack.name}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.themePack !== "default" && (
                  <div className="theme-pack-description">
                    <p className="ws-note">
                      {
                        themePacks.find((pack) => pack.id === draft.themePack)
                          ?.description
                      }{" "}
                      Custom color overrides take priority.
                    </p>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        setDraft((p) => ({
                          ...p,
                          lightColors: {},
                          darkColors: {},
                        }));
                        setMessage(
                          "Pack colors previewed. Apply to save, or Cancel to restore your overrides.",
                        );
                      }}
                    >
                      Preview pack colors without overrides
                    </button>
                  </div>
                )}
                <div className="appearance-look">
                  <div>
                    <strong>A clearer space to think</strong>
                    <p className="muted">
                      Frost & Graphite, fluid glass, and a considered sans-serif
                      reading experience.
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setDraft(modernAppearance(draft));
                      setSavePrevious(true);
                      setMessage(
                        "Modern look previewed. Apply will keep your current appearance as a restore point.",
                      );
                    }}
                  >
                    Try the modern look
                  </button>
                </div>
                {select("Theme", "mode", "Color mode", [
                  ["system", "Follow the system"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ])}
                <div className="setting-pair">
                  <label>
                    Light palette
                    <select
                      aria-label="Light palette"
                      value={matchingEditorTheme(draft, false)}
                      onChange={(e) => {
                        setDraft((d) =>
                          applyEditorTheme(d, e.target.value, false),
                        );
                      }}
                    >
                      <option value="custom" disabled>
                        Custom colors
                      </option>
                      {Object.entries(editorThemes)
                        .filter(([, p]) => p.mode === "light")
                        .map(([id, p]) => (
                          <option key={id} value={id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Dark palette
                    <select
                      aria-label="Dark palette"
                      value={matchingEditorTheme(draft, true)}
                      onChange={(e) => {
                        setDraft((d) =>
                          applyEditorTheme(d, e.target.value, false),
                        );
                      }}
                    >
                      <option value="custom" disabled>
                        Custom colors
                      </option>
                      {Object.entries(editorThemes)
                        .filter(([, p]) => p.mode === "dark")
                        .map(([id, p]) => (
                          <option key={id} value={id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <div
                  className="theme-family-gallery"
                  aria-label="Coordinated light and dark themes"
                >
                  {Object.entries(workspaceThemeFamilies).map(
                    ([id, family]) => (
                      <button
                        key={id}
                        type="button"
                        className="theme-family-card"
                        aria-label={`Use ${family.name} theme family`}
                        aria-pressed={
                          matchingEditorTheme(draft, false) === family.light &&
                          matchingEditorTheme(draft, true) === family.dark
                        }
                        onClick={() =>
                          setDraft((d) =>
                            applyEditorTheme(
                              applyEditorTheme(d, family.light, false),
                              family.dark,
                              false,
                            ),
                          )
                        }
                      >
                        <span className="theme-family-samples">
                          {[family.light, family.dark].map((key) => {
                            const colors = workspaceThemes[key].colors;
                            return (
                              <span
                                key={key}
                                style={{
                                  background: colors.paper,
                                  color: colors.text,
                                  borderColor: colors.line,
                                }}
                              >
                                <i style={{ background: colors.accent }} />
                                Aa
                              </span>
                            );
                          })}
                        </span>
                        <strong>{family.name}</strong>
                        <small>{family.description}</small>
                      </button>
                    ),
                  )}
                </div>
                <p className="muted">
                  A family sets matching light and dark colors. Your color mode,
                  fonts and navigation surfaces stay unchanged.
                </p>
                <h5>Research and classic palettes</h5>
                <div className="palette-gallery">
                  {Object.entries(editorThemes)
                    .filter(([id]) => !Object.hasOwn(workspaceThemes, id))
                    .map(([id, p]) => (
                      <button
                        type="button"
                        key={id}
                        className="palette-card"
                        aria-label={`Use ${p.name} theme`}
                        aria-pressed={
                          matchingEditorTheme(draft, p.mode === "dark") === id
                        }
                        onClick={() => {
                          setEditDark(p.mode === "dark");
                          setDraft((d) => applyEditorTheme(d, id));
                        }}
                        style={{
                          background: p.colors.paper,
                          color: p.colors.text,
                          borderColor: p.colors.line,
                        }}
                      >
                        <span style={{ color: p.colors.accent }}>
                          Aa <i style={{ background: p.colors.accent }} />
                        </span>
                        {p.name}
                      </button>
                    ))}
                </div>
                <details className="advanced-appearance">
                  <summary>Advanced appearance</summary>
                  {select("Theme", "material", "Navigation surfaces", [
                    ["glass", "Glass · translucent chrome"],
                    ["solid", "Solid · opaque chrome"],
                  ])}
                  {draft.material === "glass" &&
                    number(
                      "Theme",
                      "glassIntensity",
                      "Glass intensity",
                      0,
                      100,
                      5,
                      "%",
                    )}
                  <p className="muted material-hint">
                    Only navigation and windows use glass. Your notes, equations
                    and papers stay on a solid surface. High contrast and
                    reduced transparency always use solid chrome.
                  </p>
                </details>
                <label className="setting-toggle">
                  <span>
                    Keep current look as a restore point
                    <small>
                      Replaces the previous restore point when you Apply. Device
                      overrides are unchanged.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={savePrevious}
                    onChange={(e) => setSavePrevious(e.target.checked)}
                  />
                </label>
                {appearance.previousPreferences && (
                  <button
                    className="button secondary"
                    onClick={() => {
                      setDraft(appearance.previousPreferences!);
                      setSavePrevious(true);
                      setMessage(
                        "Previous appearance previewed. Apply to restore it; your current look will become the restore point.",
                      );
                    }}
                  >
                    <RotateCcw size={15} />
                    Restore previous appearance
                  </button>
                )}
                <details className="theme-editor">
                  <summary>Visual theme editor</summary>
                  <label>
                    Edit palette
                    <select
                      aria-label="Palette to customize"
                      value={editDark ? "dark" : "light"}
                      onChange={(e) => setEditDark(e.target.value === "dark")}
                    >
                      <option value="light">Light colors</option>
                      <option value="dark">Dark colors</option>
                    </select>
                  </label>
                  <p className="muted">
                    Pick a swatch or enter HEX / RGB. Text values commit on
                    Enter or blur; Escape restores the last valid value.
                  </p>
                  <div className="palette-preview-pair">
                    {[false, true].map((dark) => (
                      <div
                        key={String(dark)}
                        className="palette-preview"
                        style={appearanceVariables(draft, dark)}
                      >
                        <small>{dark ? "Dark" : "Light"} palette</small>
                        <strong>A clear space for discovery</strong>
                        <p>
                          Readable notes,{" "}
                          <span className="palette-link">connected ideas</span>,
                          and <code>E = mc²</code>.
                        </p>
                        <span className="palette-chip">Selected workspace</span>
                      </div>
                    ))}
                  </div>
                  {(
                    [
                      [
                        "Surfaces",
                        [
                          ["bg", "App background"],
                          ["paper", "Document paper"],
                          ["sidebar", "Sidebar"],
                          ["surface", "Controls & cards"],
                          ["hover", "Hover background"],
                          ["line", "Dividers"],
                        ],
                      ],
                      [
                        "Text & interaction",
                        [
                          ["text", "Primary text"],
                          ["muted", "Secondary text"],
                          ["subtle", "Quiet text"],
                          ["accent", "Accent & links"],
                          ["accentBg", "Accent background"],
                          ["onAccent", "Text on accent"],
                          ["selection", "Text selection"],
                          ["focus", "Keyboard focus"],
                        ],
                      ],
                      [
                        "Research & feedback",
                        [
                          ["code", "Code background"],
                          ["codeText", "Code text"],
                          ["syntax", "Syntax highlight"],
                          ["callout", "Callout background"],
                          ["green", "Success"],
                          ["warning", "Warning"],
                          ["danger", "Danger"],
                        ],
                      ],
                    ] as [string, [keyof ThemePalette, string][]][]
                  ).map(([group, entries]) => (
                    <fieldset className="palette-group" key={group}>
                      <legend>{group}</legend>
                      <div className="color-controls">
                        {entries.map(([key, label]) => (
                          <ColorPreference
                            key={`${colorKey}:${key}`}
                            label={label}
                            value={colors[key]}
                            onChange={(value) =>
                              change(colorKey, {
                                ...draft[colorKey],
                                [key]: value,
                              })
                            }
                            reset={() => {
                              const next = { ...draft[colorKey] };
                              delete next[key];
                              change(colorKey, next);
                            }}
                            onInvalid={(value) =>
                              invalidField(`${colorKey}:${key}`, value)
                            }
                          />
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <button
                    className="button secondary small"
                    onClick={() => change(colorKey, {})}
                  >
                    Restore {editDark ? "dark" : "light"} palette defaults
                  </button>
                  <div className="contrast-checks">
                    {checks.map(([label, a, b]) => (
                      <span
                        className={
                          contrastRatio(a, b) < 4.5 ? "contrast-warning" : ""
                        }
                        key={label}
                      >
                        {label}: {contrastRatio(a, b).toFixed(2)}:1{" "}
                        {contrastRatio(a, b) < 4.5 ? "— below 4.5:1" : "✓"}
                      </span>
                    ))}
                  </div>
                  <p className="muted">
                    Custom colors may reduce readability. Built-in palettes and
                    Reset remain available.
                  </p>
                  <div className="button-row">
                    <input
                      aria-label="Custom theme name"
                      placeholder="Name this palette"
                      maxLength={60}
                      value={themeName}
                      onChange={(e) => setThemeName(e.target.value)}
                    />
                    <button
                      className="button secondary"
                      disabled={!themeName.trim() || draft.themes.length >= 30}
                      onClick={() => {
                        change("themes", [
                          ...draft.themes,
                          {
                            id: crypto.randomUUID(),
                            name: themeName.trim(),
                            mode: editDark ? "dark" : "light",
                            colors,
                          },
                        ]);
                        setThemeName("");
                      }}
                    >
                      Save palette
                    </button>
                  </div>
                  {draft.themes.map((t) => (
                    <div className="saved-theme" key={t.id}>
                      <button
                        className="text-button"
                        onClick={() => {
                          setDraft((d) => ({
                            ...d,
                            mode: t.mode,
                            [t.mode + "Colors"]: t.colors,
                          }));
                          setEditDark(t.mode === "dark");
                        }}
                      >
                        {t.name} · {t.mode}
                      </button>
                      <button
                        className="text-button"
                        aria-label={`Delete theme ${t.name}`}
                        onClick={() =>
                          change(
                            "themes",
                            draft.themes.filter((v) => v.id !== t.id),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div className="button-row">
                    <button
                      className="button secondary"
                      onClick={() =>
                        download(
                          "axiom-theme.json",
                          JSON.stringify(
                            {
                              format: "axiom-theme",
                              version: 1,
                              name: themeName.trim() || "My research palette",
                              mode: editDark ? "dark" : "light",
                              colors,
                            },
                            null,
                            2,
                          ),
                          "application/json",
                        )
                      }
                    >
                      <Download size={15} />
                      Export palette
                    </button>
                    <label className="button secondary file-button">
                      <Upload size={15} />
                      Import palette
                      <input
                        aria-label="Import theme JSON"
                        type="file"
                        accept=".json,application/json"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          void (async () => {
                            try {
                              if (file.size > 50000)
                                throw new Error(
                                  "Theme files must be under 50 KB.",
                                );
                              const t = themeFileSchema.parse(
                                JSON.parse(await file.text()),
                              );
                              if (draft.themes.length >= 30)
                                throw new Error(
                                  "Remove a saved theme before importing another.",
                                );
                              setDraft((d) => ({
                                ...d,
                                mode: t.mode,
                                [t.mode + "Colors"]: t.colors,
                                themes: [
                                  ...d.themes,
                                  {
                                    id: crypto.randomUUID(),
                                    name: t.name,
                                    colors: t.colors,
                                    mode: t.mode,
                                  },
                                ],
                              }));
                              setEditDark(t.mode === "dark");
                              setMessage(
                                "Palette imported into this preview. Apply to keep it.",
                              );
                            } catch {
                              setMessage(
                                "Could not import this theme. Use a valid Axiom theme JSON file under 50 KB (no CSS or font URLs).",
                              );
                            }
                          })();
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </details>
              </section>
            )}
            {(section === "Typography" || !!query) && (
              <section className="settings-card settings-controls">
                {show(
                  "Typography",
                  "document styles latex article latin modern journal compact research accessible presets",
                ) && (
                  <div className="document-style-picker">
                    <h4>Document styles</h4>
                    <p className="muted">
                      A starting point for your notes. Interface fonts and
                      colors stay unchanged; every value remains adjustable
                      below.
                    </p>
                    <div className="document-style-gallery">
                      {Object.entries(documentStyles).map(([id, style]) => (
                        <button
                          type="button"
                          className="document-style-card"
                          key={id}
                          aria-label={`Use ${style.name} document style`}
                          aria-pressed={matchingDocumentStyle(draft) === id}
                          onClick={() =>
                            setDraft((d) =>
                              applyDocumentStyle(d, id as DocumentStyleId),
                            )
                          }
                        >
                          <span
                            style={{
                              fontFamily: documentStyleFont(
                                id as DocumentStyleId,
                              ),
                            }}
                          >
                            A place for careful thinking.
                          </span>
                          <strong>{style.name}</strong>
                          <small>{style.description}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {(["ui", "prose", "heading", "code"] as const).map((role) => (
                  <div key={role}>
                    {select(
                      "Typography",
                      `${role}Font`,
                      `${{ ui: "Interface", prose: "Note text", heading: "Headings", code: "Source & code" }[role]} font`,
                      Object.entries(fonts)
                        .filter(
                          ([k]) =>
                            role !== "code" ||
                            ["jetbrains", "plexMono", "systemMono"].includes(k),
                        )
                        .map(([k, v]) => [k, v.label]),
                    )}
                    {select(
                      "Typography",
                      `${role}Weight`,
                      `${{ ui: "Interface", prose: "Note text", heading: "Heading", code: "Code" }[role]} weight`,
                      [
                        ["400", "Regular"],
                        ["500", "Medium"],
                        ["600", "Semibold"],
                        ["700", "Bold"],
                      ],
                    )}
                  </div>
                ))}
                {select(
                  "Typography",
                  "documentDecorations",
                  "Document decorations",
                  [
                    ["none", "None"],
                    ["latex", "LaTeX — numbered sections and academic rules"],
                  ],
                )}
                {number(
                  "Typography",
                  "uiSize",
                  "Interface font size",
                  12,
                  22,
                  1,
                  " px",
                )}
                {number(
                  "Typography",
                  "proseSize",
                  "Note font size",
                  14,
                  30,
                  1,
                  " px",
                )}
                {number(
                  "Typography",
                  "codeSize",
                  "Code font size",
                  12,
                  24,
                  1,
                  " px",
                )}
                {number(
                  "Typography",
                  "headingScale",
                  "Heading scale",
                  0.85,
                  1.4,
                  0.05,
                  "×",
                )}
                {number(
                  "Typography",
                  "lineHeight",
                  "Line height",
                  1.3,
                  2.4,
                  0.05,
                  "×",
                )}
                {number(
                  "Typography",
                  "paragraphSpacing",
                  "Paragraph spacing",
                  0.4,
                  2.5,
                  0.1,
                  " em",
                )}
                {number(
                  "Typography",
                  "letterSpacing",
                  "Letter spacing",
                  -0.02,
                  0.14,
                  0.01,
                  " em",
                )}
                {number(
                  "Typography",
                  "wordSpacing",
                  "Word spacing",
                  0,
                  0.25,
                  0.01,
                  " em",
                )}
                {number(
                  "Typography",
                  "mathScale",
                  "Mathematics scale",
                  0.8,
                  1.5,
                  0.05,
                  "×",
                )}
                {toggle(
                  "Typography",
                  "ligatures",
                  "Code ligatures",
                  "Optional combined programming symbols; Markdown is unchanged.",
                )}
              </section>
            )}
            {(section === "Reading & layout" || !!query) && (
              <section className="settings-card settings-controls">
                {number(
                  "Reading & layout",
                  "readingWidth",
                  "Reading width",
                  45,
                  110,
                  1,
                  " ch",
                )}
                {toggle(
                  "Reading & layout",
                  "fullWidth",
                  "Use full reading width",
                )}
                {select("Reading & layout", "density", "Interface density", [
                  ["comfortable", "Comfortable"],
                  ["compact", "Compact"],
                ])}
                {number(
                  "Reading & layout",
                  "sidebarWidth",
                  "Sidebar width",
                  200,
                  360,
                  8,
                  " px",
                )}
                {number(
                  "Reading & layout",
                  "panelWidth",
                  "Research panel width",
                  240,
                  420,
                  10,
                  " px",
                )}
                {number(
                  "Reading & layout",
                  "radius",
                  "Corner radius",
                  0,
                  18,
                  1,
                  " px",
                )}
                {select("Reading & layout", "shadows", "Surface shadows", [
                  ["none", "None"],
                  ["soft", "Soft"],
                  ["elevated", "Elevated"],
                ])}
                {select("Reading & layout", "motion", "Motion", [
                  ["system", "Follow the system"],
                  ["reduced", "Reduced"],
                  ["none", "None"],
                ])}
                {toggle(
                  "Reading & layout",
                  "focusMode",
                  "Focus mode",
                  "Hide navigation and context panels. Settings remain accessible in the top bar.",
                )}
                {toggle("Reading & layout", "codeWrap", "Wrap Markdown source")}
                {toggle(
                  "Reading & layout",
                  "lineNumbers",
                  "Source line numbers",
                )}
                {toggle(
                  "Reading & layout",
                  "activeLine",
                  "Highlight active editor line",
                )}
                {toggle(
                  "Reading & layout",
                  "exportTypography",
                  "Use reading typography in print and HTML export",
                  "Exports stay light and omit interface effects and private preferences.",
                )}
              </section>
            )}
            {show("Device", "scale overrides density widths") && (
              <section className="settings-card">
                <h4>Only on this device</h4>
                <p className="muted">
                  Unchecked controls follow your account. Overrides are private
                  to this account and browser.
                </p>
                {(
                  ["uiScale", "density", "sidebarWidth", "panelWidth"] as const
                ).map((key) => (
                  <div className="device-override" key={key}>
                    <label className="setting-toggle">
                      <span>
                        {
                          {
                            uiScale: "Interface scale",
                            density: "Density",
                            sidebarWidth: "Sidebar width",
                            panelWidth: "Research panel width",
                          }[key]
                        }
                      </span>
                      <input
                        aria-label={`Override ${key} on this device`}
                        type="checkbox"
                        checked={device[key] !== undefined}
                        onChange={(e) =>
                          setDevice((d) => {
                            const next: DevicePreferences = { ...d };
                            if (e.target.checked)
                              Object.assign(next, { [key]: draft[key] });
                            else delete next[key];
                            return next;
                          })
                        }
                      />
                    </label>
                    {device[key] !== undefined &&
                      (key === "density" ? (
                        <select
                          aria-label="Device density"
                          value={device.density}
                          onChange={(e) =>
                            setDevice((d) => ({
                              ...d,
                              density: e.target.value as
                                "compact" | "comfortable",
                            }))
                          }
                        >
                          <option value="comfortable">Comfortable</option>
                          <option value="compact">Compact</option>
                        </select>
                      ) : (
                        <label className="setting-control">
                          <span>
                            Device value
                            <output>
                              {device[key]}
                              {key === "uiScale" ? "×" : " px"}
                            </output>
                          </span>
                          <input
                            type="range"
                            aria-label={`Device ${key}`}
                            min={
                              key === "uiScale"
                                ? 0.8
                                : key === "sidebarWidth"
                                  ? 200
                                  : 240
                            }
                            max={
                              key === "uiScale"
                                ? 1.5
                                : key === "sidebarWidth"
                                  ? 360
                                  : 420
                            }
                            step={key === "uiScale" ? 0.05 : 10}
                            value={device[key]}
                            onChange={(e) =>
                              setDevice((d) => ({
                                ...d,
                                [key]: Number(e.target.value),
                              }))
                            }
                          />
                        </label>
                      ))}
                  </div>
                ))}
              </section>
            )}
            {message && (
              <p role="status" className="settings-feedback">
                {message}
              </p>
            )}
            <p
              role="status"
              aria-label="Appearance synchronization"
              className="settings-sync"
              hidden={!settings.dirty}
            >
              {appearance.status}
            </p>
            <p
              role="status"
              aria-label="Editor settings synchronization"
              className="editor-settings-sync"
              hidden={!settings.dirty}
            >
              {editorSettings.status}
            </p>
            {settings.conflicts.length > 0 && (
              <div className="settings-conflict">
                <p>
                  These settings changed while you were editing:{" "}
                  {settings.conflicts.join(", ")}
                </p>
                <button
                  className="button secondary"
                  onClick={() => {
                    settings.resolve(true);
                  }}
                >
                  Keep my edited values
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    settings.resolve(false);
                  }}
                >
                  Use latest conflicting values
                </button>
              </div>
            )}
            {editorSettings.conflicts.length > 0 && (
              <div className="settings-conflict">
                <p>
                  Conflicting editor settings:{" "}
                  {editorSettings.conflicts.join(", ")}
                </p>
                <button
                  className="button secondary"
                  onClick={() => {
                    const p = editorSettings.resolve(true);
                    if (p) setEditorDraft(p);
                  }}
                >
                  Keep my editor settings
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    const p = editorSettings.resolve(false);
                    if (p) setEditorDraft(p);
                  }}
                >
                  Use synced editor settings
                </button>
              </div>
            )}
            {appearance.conflicts.length > 0 && (
              <div className="settings-conflict">
                <p>Conflicting settings: {appearance.conflicts.join(", ")}</p>
                <button
                  className="button secondary"
                  onClick={() => appearance.resolve(true)}
                >
                  Keep my conflicting values
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    const synced = appearance.resolve(false);
                    if (synced) setDraft(synced);
                  }}
                >
                  Use synced values
                </button>
              </div>
            )}
          </div>
        </SettingsSplitPanel>
      </div>
      <div className="settings-footer">
        <span role="status" className="settings-draft-status">
          {settings.dirty
            ? "Unsaved changes · live preview"
            : [
                ...new Set(
                  [appearance.status, editorSettings.status].filter(Boolean),
                ),
              ].join(" · ")}
          {Object.values(invalid).some(Boolean) &&
            " · Check incomplete values before applying"}
        </span>
        <div className="settings-reset-actions">
          <button
            className="button appearance-reset"
            onClick={async () => {
              if (
                !(await confirmAction(
                  "Preview default appearance and writing preferences? Apply saves the reset; Cancel keeps your saved settings.",
                  {
                    title: "Preview default preferences?",
                    confirmLabel: "Preview defaults",
                  },
                ))
              )
                return;
              setDraft(defaults);
              setDevice({});
              setEditorDraft(editorDefaults);
            }}
          >
            <RotateCcw size={15} />
            Reset all
          </button>
          <button
            className="button secondary"
            onClick={() => {
              if (section === "Keyboard shortcuts")
                setEditorDraft((d) => ({
                  ...d,
                  keybindings: editorDefaults.keybindings,
                }));
              else if (
                ["Editor", "Tables", "Code", "Mathematics"].includes(section)
              )
                setEditorDraft((d) => ({
                  ...d,
                  ...Object.fromEntries(
                    writingControls
                      .filter((c) => c.category === section)
                      .map((c) => [c.key, editorDefaults[c.key]]),
                  ),
                  ...(section === "Code"
                    ? {
                        defaultCodeLanguage: editorDefaults.defaultCodeLanguage,
                        indentSize: editorDefaults.indentSize,
                      }
                    : {}),
                }));
              else if (section === "Device") setDevice({});
              else
                setDraft((d) => ({
                  ...d,
                  ...Object.fromEntries(
                    (appearanceSettingGroups[section] ?? []).map((k) => [
                      k,
                      defaults[k],
                    ]),
                  ),
                }));
            }}
          >
            Reset section
          </button>
        </div>
        <div className="settings-confirm-actions">
          <button
            className="button secondary"
            onClick={() => {
              settings.discard();
              setMessage("");
              if (!routed) onClose();
            }}
          >
            Cancel
          </button>
          <button
            className="button primary"
            onClick={save}
            disabled={Object.values(invalid).some(Boolean)}
          >
            <Check size={15} />
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
