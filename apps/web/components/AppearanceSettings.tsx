"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  Button,
  HelpText,
  Slider,
  Switch,
  NativeSelect,
  TextInput,
  SearchField,
} from "./ui/controls";
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
} from "lucide-react";
import EditorSettings from "./EditorSettings";
import SettingsEditorPreview from "./SettingsEditorPreview";
import MinimapSettings from "./MinimapSettings";
import SettingsSplitPanel from "./SettingsSplitPanel";
import { themePacks, type ThemePackId } from "@axiom/shared/theme-packs";
import InterfaceStylePicker from "./ui/InterfaceStylePicker";
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
    return (
      <p role="status">
        <I18nText id="Loading your preferences…" />
      </p>
    );
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
  useInterfaceLocale();
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
    [comparingStyles, setComparingStyles] = useState(false),
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
      ? `${uiText(category)} ${uiText(label)} ${category} ${label}`
          .toLowerCase()
          .includes(query.toLowerCase())
      : section === category;
  const themeVisible = show(
    "Theme",
    "palette colors light dark system custom contrast import export glass material transparency restore previous",
  );
  const comparing = comparingStyles && themeVisible;
  const previewVisible = showPreview && !comparing;
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
        <Switch
          aria-label={label}

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
        <NativeSelect
          aria-label={label}
          value={String(draft[key])}
          onChange={(e) => change(key, e.target.value as never)}
        >
          {options.map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </NativeSelect>
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
          <SearchField
            wrapperClassName="settings-search"
            aria-label={uiText("Search settings")}
            placeholder={uiText("Find a setting…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <nav aria-label={uiText("Personal settings")}>
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
          <p>
            <I18nText id="PERSONAL WORKSPACE" />
          </p>
          <button className="text-button" onClick={onData}>
            <I18nText id="Offline files & reading data" />
          </button>
          <button className="text-button" onClick={onWorkspace}>
            <I18nText id="Account & group administration" />
          </button>
          <small>
            <I18nText id="Your reading preferences never change a collaborator’s view." />
          </small>
        </div>
      )}
      <div className="settings-stage">
        <div className="settings-intro">
          <div className="settings-intro-copy">
            <div className="eyebrow">
              <I18nText id="MAKE SPACE FOR YOUR THINKING" />
            </div>
            {routed ? (
              <h1>
                {query
                  ? uiText("Search results")
                  : section === "Editor"
                    ? "Writing"
                    : section}
              </h1>
            ) : (
              <h3>{query ? uiText("Search results") : uiText(section)}</h3>
            )}
            <p className="muted">
              {description ??
                "Personal preferences for a comfortable workspace."}
            </p>
          </div>
          <div className="settings-intro-tools">
            {routed && section !== "Keyboard shortcuts" && (
              <SearchField
                wrapperClassName="settings-search settings-content-search"
                aria-label={uiText("Search settings")}
                placeholder={uiText("Search settings…")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClear={() => setQuery("")}
                clearLabel={uiText("Clear settings search")}
              />
            )}
            {previewCategory && (
              <Button
                type="button"
                className="button secondary small settings-preview-toggle"
                aria-label={
                  previewVisible
                    ? uiText("Hide live preview")
                    : uiText("Show live preview")
                }
                aria-pressed={previewVisible}
                onClick={() => {
                  if (comparing) {
                    setComparingStyles(false);
                    setShowPreview(true);
                  } else setShowPreview((value) => !value);
                }}
              >
                <PanelRight size={16} />
                <I18nText id="Preview" />
              </Button>
            )}
          </div>
        </div>
        <SettingsSplitPanel
          showPreview={previewVisible}
          preview={
            previewCategory ? (
              <SettingsEditorPreview
                preferences={editorDraft}
                appearance={draft}
                category={previewCategory}
                showInterface
                dark={appearance.dark}
                active={previewVisible}
                onAppearanceChange={setDraft}
              />
            ) : undefined
          }
        >
          <div
            className="settings-content"
            ref={fields}
            aria-label={uiText("Settings fields")}
            tabIndex={0}
          >
            {emptySearch && (
              <div className="settings-empty" role="status">
                <Search size={22} />
                <h3>
                  <I18nText id="No matching settings" />
                </h3>
                <p>
                  <I18nText id="Try “font”, “color”, “table”, or another keyword." />
                </p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setQuery("")}
                >
                  <I18nText id="Clear search" />
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
                <h4>
                  <I18nText id="Document structure" />
                </h4>
                <p className="settings-note">
                  <I18nText id="Follow nested blocks with a quiet margin. Use its chevrons to fold longer blocks." />
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
            {themeVisible && (
              <section className="settings-card">
                <h4>
                  <I18nText id="Color & atmosphere" />
                </h4>
                <InterfaceStylePicker
                  value={draft.interfaceStyle}
                  onChange={(value) => change("interfaceStyle", value)}
                  comparing={comparingStyles}
                  onComparingChange={setComparingStyles}
                />
                <label className="setting-control">
                  <span>
                    <I18nText id="Theme pack" />
                    <small>
                      <I18nText id="Reviewed, built-in styles. Your explicit color and typography choices stay in control." />
                    </small>
                  </span>
                  <NativeSelect
                    aria-label={uiText("Theme pack")}
                    value={draft.themePack}
                    onChange={(e) =>
                      change("themePack", e.target.value as ThemePackId)
                    }
                  >
                    <option value="default">
                      <I18nText id="Axiom default" />
                    </option>
                    {themePacks.map((pack) => (
                      <option key={pack.id} value={pack.id}>
                        {pack.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                {draft.themePack !== "default" && (
                  <div className="theme-pack-description">
                    <HelpText>
                      {
                        themePacks.find((pack) => pack.id === draft.themePack)
                          ?.description
                      }{" "}
                      <I18nText id="Custom color overrides take priority." />
                    </HelpText>
                    <Button
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
                      <I18nText id="Preview pack colors without overrides" />
                    </Button>
                  </div>
                )}
                <div className="appearance-look">
                  <div>
                    <strong>
                      <I18nText id="A clearer space to think" />
                    </strong>
                    <p className="muted">
                      <I18nText id="Frost & Graphite, fluid glass, and a considered sans-serif reading experience." />
                    </p>
                  </div>
                  <Button
                    className="button secondary"
                    onClick={() => {
                      setDraft(modernAppearance(draft));
                      setSavePrevious(true);
                      setMessage(
                        "Modern look previewed. Apply will keep your current appearance as a restore point.",
                      );
                    }}
                  >
                    <I18nText id="Try the modern look" />
                  </Button>
                </div>
                {select("Theme", "mode", "Color mode", [
                  ["system", "Follow the system"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ])}
                <div className="setting-pair">
                  <label>
                    <I18nText id="Light palette" />
                    <NativeSelect
                      aria-label={uiText("Light palette")}
                      value={matchingEditorTheme(draft, false)}
                      onChange={(e) => {
                        setDraft((d) =>
                          applyEditorTheme(d, e.target.value, false),
                        );
                      }}
                    >
                      <option value="custom" disabled>
                        <I18nText id="Custom colors" />
                      </option>
                      {Object.entries(editorThemes)
                        .filter(([, p]) => p.mode === "light")
                        .map(([id, p]) => (
                          <option key={id} value={id}>
                            {p.name}
                          </option>
                        ))}
                    </NativeSelect>
                  </label>
                  <label>
                    <I18nText id="Dark palette" />
                    <NativeSelect
                      aria-label={uiText("Dark palette")}
                      value={matchingEditorTheme(draft, true)}
                      onChange={(e) => {
                        setDraft((d) =>
                          applyEditorTheme(d, e.target.value, false),
                        );
                      }}
                    >
                      <option value="custom" disabled>
                        <I18nText id="Custom colors" />
                      </option>
                      {Object.entries(editorThemes)
                        .filter(([, p]) => p.mode === "dark")
                        .map(([id, p]) => (
                          <option key={id} value={id}>
                            {p.name}
                          </option>
                        ))}
                    </NativeSelect>
                  </label>
                </div>
                <div
                  className="theme-family-gallery"
                  aria-label={uiText("Coordinated light and dark themes")}
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
                                <I18nText id="Aa" />
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
                  <I18nText id="A family sets matching light and dark colors. Your color mode, fonts and navigation surfaces stay unchanged." />
                </p>
                <h5>
                  <I18nText id="Research and classic palettes" />
                </h5>
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
                          <I18nText id="Aa" />{" "}
                          <i style={{ background: p.colors.accent }} />
                        </span>
                        {p.name}
                      </button>
                    ))}
                </div>
                <details className="advanced-appearance">
                  <summary>
                    <I18nText id="Advanced appearance" />
                  </summary>
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
                    <I18nText id="Only navigation and windows use glass. Your notes, equations and papers stay on a solid surface. High contrast and reduced transparency always use solid chrome." />
                  </p>
                </details>
                <label className="setting-toggle">
                  <span>
                    <I18nText id="Keep current look as a restore point" />
                    <small>
                      <I18nText id="Replaces the previous restore point when you Apply. Device overrides are unchanged." />
                    </small>
                  </span>
                  <Switch
                    checked={savePrevious}
                    onChange={(e) => setSavePrevious(e.target.checked)}
                  />
                </label>
                {appearance.previousPreferences && (
                  <Button
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
                    <I18nText id="Restore previous appearance" />
                  </Button>
                )}
                <details className="theme-editor">
                  <summary>
                    <I18nText id="Visual theme editor" />
                  </summary>
                  <label>
                    <I18nText id="Edit palette" />
                    <NativeSelect
                      aria-label={uiText("Palette to customize")}
                      value={editDark ? "dark" : "light"}
                      onChange={(e) => setEditDark(e.target.value === "dark")}
                    >
                      <option value="light">
                        <I18nText id="Light colors" />
                      </option>
                      <option value="dark">
                        <I18nText id="Dark colors" />
                      </option>
                    </NativeSelect>
                  </label>
                  <p className="muted">
                    <I18nText id="Pick a swatch or enter HEX / RGB. Text values commit on Enter or blur; Escape restores the last valid value." />
                  </p>
                  <div className="palette-preview-pair">
                    {[false, true].map((dark) => (
                      <div
                        key={String(dark)}
                        className="palette-preview"
                        style={appearanceVariables(draft, dark)}
                      >
                        <small>
                          {dark ? uiText("Dark") : uiText("Light")}{" "}
                          <I18nText id="palette" />
                        </small>
                        <strong>
                          <I18nText id="A clear space for discovery" />
                        </strong>
                        <p>
                          <I18nText id="Readable notes," />{" "}
                          <span className="palette-link">
                            <I18nText id="connected ideas" />
                          </span>
                          <I18nText id=", and" />{" "}
                          <code>
                            <I18nText id="E = mc²" />
                          </code>
                          .
                        </p>
                        <span className="palette-chip">
                          <I18nText id="Selected workspace" />
                        </span>
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
                      <legend>{uiText(group)}</legend>
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
                  <Button
                    className="button secondary small"
                    onClick={() => change(colorKey, {})}
                  >
                    <I18nText id="Restore" />{" "}
                    {editDark ? uiText("dark") : uiText("light")}{" "}
                    <I18nText id="palette defaults" />
                  </Button>
                  <div className="contrast-checks">
                    {checks.map(([label, a, b]) => (
                      <span
                        className={
                          contrastRatio(a, b) < 4.5 ? "contrast-warning" : ""
                        }
                        key={label}
                      >
                        {label}: {contrastRatio(a, b).toFixed(2)}:1{" "}
                        {contrastRatio(a, b) < 4.5
                          ? uiText("— below 4.5:1")
                          : "✓"}
                      </span>
                    ))}
                  </div>
                  <p className="muted">
                    <I18nText id="Custom colors may reduce readability. Built-in palettes and Reset remain available." />
                  </p>
                  <div className="button-row">
                    <TextInput
                      aria-label={uiText("Custom theme name")}
                      placeholder={uiText("Name this palette")}
                      maxLength={60}
                      value={themeName}
                      onChange={(e) => setThemeName(e.target.value)}
                    />
                    <Button
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
                      <I18nText id="Save palette" />
                    </Button>
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
                        <I18nText id="Remove" />
                      </button>
                    </div>
                  ))}
                  <div className="button-row">
                    <Button
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
                      <I18nText id="Export palette" />
                    </Button>
                    <label className="button secondary file-button">
                      <Upload size={15} />
                      <I18nText id="Import palette" />
                      <input
                        aria-label={uiText("Import theme JSON")}
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
                    <h4>
                      <I18nText id="Document styles" />
                    </h4>
                    <p className="muted">
                      <I18nText id="A starting point for your notes. Interface fonts and colors stay unchanged; every value remains adjustable below." />
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
                            <I18nText id="A place for careful thinking." />
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
                {!query && (
                  <p className="settings-panel-resize-hint">
                    <I18nText id="Resize the sidebar and document panel at their edges. Widths save on this device; double-click to reset, or focus the edge and use arrow keys." />
                  </p>
                )}
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
            {show("Device", "scale overrides density") && (
              <section className="settings-card">
                <h4>
                  <I18nText id="Only on this device" />
                </h4>
                <p className="muted">
                  <I18nText id="Unchecked controls follow your account. Overrides are private to this account and browser." />
                </p>
                {(["uiScale", "density"] as const).map((key) => (
                  <div className="device-override" key={key}>
                    <label className="setting-toggle">
                      <span>
                        {
                          {
                            uiScale: "Interface scale",
                            density: "Density",
                          }[key]
                        }
                      </span>
                      <Switch
                        aria-label={`Override ${key} on this device`}

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
                        <NativeSelect
                          aria-label={uiText("Device density")}
                          value={device.density}
                          onChange={(e) =>
                            setDevice((d) => ({
                              ...d,
                              density: e.target.value as
                                "compact" | "comfortable",
                            }))
                          }
                        >
                          <option value="comfortable">
                            <I18nText id="Comfortable" />
                          </option>
                          <option value="compact">
                            <I18nText id="Compact" />
                          </option>
                        </NativeSelect>
                      ) : (
                        <label className="setting-control">
                          <span>
                            <I18nText id="Device value" />
                            <output>{device[key]}×</output>
                          </span>
                          <Slider
                            aria-label={`Device ${key}`}
                            aria-valuetext={`${device[key]} times`}
                            min={0.8}
                            max={1.5}
                            step={0.05}
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
              aria-label={uiText("Appearance synchronization")}
              className="settings-sync"
              hidden={!settings.dirty}
            >
              {appearance.status}
            </p>
            <p
              role="status"
              aria-label={uiText("Editor settings synchronization")}
              className="editor-settings-sync"
              hidden={!settings.dirty}
            >
              {editorSettings.status}
            </p>
            {settings.conflicts.length > 0 && (
              <div className="settings-conflict">
                <p>
                  <I18nText id="These settings changed while you were editing:" />{" "}
                  {settings.conflicts.join(", ")}
                </p>
                <Button
                  data-dialog-cancel
                  className="button secondary"
                  onClick={() => {
                    settings.resolve(true);
                  }}
                >
                  <I18nText id="Keep my edited values" />
                </Button>
                <Button
                  className="button secondary"
                  onClick={() => {
                    settings.resolve(false);
                  }}
                >
                  <I18nText id="Use latest conflicting values" />
                </Button>
              </div>
            )}
            {editorSettings.conflicts.length > 0 && (
              <div className="settings-conflict">
                <p>
                  <I18nText id="Conflicting editor settings:" />{" "}
                  {editorSettings.conflicts.join(", ")}
                </p>
                <Button
                  data-dialog-cancel
                  className="button secondary"
                  onClick={() => {
                    const p = editorSettings.resolve(true);
                    if (p) setEditorDraft(p);
                  }}
                >
                  <I18nText id="Keep my editor settings" />
                </Button>
                <Button
                  className="button secondary"
                  onClick={() => {
                    const p = editorSettings.resolve(false);
                    if (p) setEditorDraft(p);
                  }}
                >
                  <I18nText id="Use synced editor settings" />
                </Button>
              </div>
            )}
            {appearance.conflicts.length > 0 && (
              <div className="settings-conflict">
                <p>
                  <I18nText id="Conflicting settings:" />{" "}
                  {appearance.conflicts.join(", ")}
                </p>
                <Button
                  data-dialog-cancel
                  className="button secondary"
                  onClick={() => appearance.resolve(true)}
                >
                  <I18nText id="Keep my conflicting values" />
                </Button>
                <Button
                  className="button secondary"
                  onClick={() => {
                    const synced = appearance.resolve(false);
                    if (synced) setDraft(synced);
                  }}
                >
                  <I18nText id="Use synced values" />
                </Button>
              </div>
            )}
          </div>
        </SettingsSplitPanel>
      </div>
      <div className="settings-footer">
        <span role="status" className="settings-draft-status">
          {settings.dirty
            ? uiText("Unsaved changes · live preview")
            : [
                ...new Set(
                  [appearance.status, editorSettings.status].filter(Boolean),
                ),
              ].join(" · ")}
          {Object.values(invalid).some(Boolean) &&
            " · Check incomplete values before applying"}
        </span>
        <div className="settings-reset-actions">
          <Button
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
            <I18nText id="Reset all" />
          </Button>
          <Button
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
            <I18nText id="Reset section" />
          </Button>
        </div>
        <div className="settings-confirm-actions">
          <Button
            data-dialog-cancel
            className="button secondary"
            onClick={() => {
              settings.discard();
              setMessage("");
              if (!routed) onClose();
            }}
          >
            <I18nText id="Cancel" />
          </Button>
          <Button
            className="button primary"
            onClick={save}
            disabled={Object.values(invalid).some(Boolean)}
          >
            <Check size={15} />
            <I18nText id="Apply" />
          </Button>
        </div>
      </div>
    </div>
  );
}
