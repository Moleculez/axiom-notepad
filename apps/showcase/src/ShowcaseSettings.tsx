import {
  I18nText,
  uiText,
  useInterfaceLocale,
  useI18n,
} from "@axiom/i18n/react";
import {
  Button,
  Field,
  IconButton,
  NativeSelect,
  Notice,
} from "../../web/components/ui/controls";
import { useId, useMemo, useState } from "react";
import {
  Palette,
  Type,
  BookOpen,
  Code2,
  Sigma,
  Map,
  HardDrive,
  RotateCcw,
  Sun,
  Moon,
  Monitor,
  Download,
  Upload,
  Trash2,
  Check,
  type LucideIcon,
} from "lucide-react";
import { parseMarkdown } from "@axiom/markdown";
import { fonts, type Preferences } from "@axiom/shared/appearance";
import { NumberPreference } from "../../web/components/PreferenceControls";
import { editorDefaults, type EditorPreferences } from "@axiom/shared/editor";
import { themePacks } from "@axiom/shared/theme-packs";
import InterfaceStylePicker from "../../web/components/ui/InterfaceStylePicker";
import Dialog, { DialogFooter } from "../../web/components/Dialog";
import ReadingView from "../../web/components/ReadingView";
import ThemeWorkbench from "../../web/components/ThemeWorkbench";
import { confirmAction } from "../../web/lib/app-prompt";
import { downloadBlob } from "../../web/lib/tools/download";
import ReadingSettings, { type ReadingSection } from "./ReadingSettings";
import { useDemo, useSnapshot, store } from "./context";
import { paperAppearance } from "./samples";
import LanguageField from "../../web/components/LanguageField";

import { saveShowcaseLocale } from "./LocaleBoundary";

type Section = "Language" | "Theme & interface" | ReadingSection | "Local data";
const categories: Array<{
  name: Section;
  icon: LucideIcon;
  description: string;
  group?: string;
}> = [
  {
    name: "Language",
    icon: BookOpen,
    group: "General",
    description: "Language changes are saved only in this browser.",
  },
  {
    name: "Theme & interface",
    icon: Palette,
    group: "Appearance",
    description: "Choose a palette, color mode and interface treatment.",
  },
  {
    name: "Typography",
    icon: Type,
    description: "Shape your reading fonts, weights and spacing.",
  },
  {
    name: "Page",
    icon: BookOpen,
    group: "Reading & editing",
    description: "Adjust document layout and reading comfort.",
  },
  {
    name: "Code & tables",
    icon: Code2,
    description: "Set code presentation and table editing behavior.",
  },
  {
    name: "Typing & math",
    icon: Sigma,
    description: "Choose the writing assistance that suits your workflow.",
  },
  {
    name: "Minimap",
    icon: Map,
    description: "Configure document navigation and position indicators.",
  },
  {
    name: "Local data",
    icon: HardDrive,
    group: "On this device",
    description: "Back up your demo drafts and manage browser-local files.",
  },
];
const resetKeys: Record<
  Exclude<Section, "Local data" | "Language">,
  {
    appearance: Array<keyof Preferences>;
    editor: Array<keyof EditorPreferences>;
  }
> = {
  "Theme & interface": {
    appearance: [
      "mode",
      "themePack",
      "interfaceStyle",
      "uiFont",
      "uiSize",
      "density",
      "radius",
      "shadows",
    ],
    editor: [],
  },
  Typography: {
    appearance: [
      "proseFont",
      "headingFont",
      "proseSize",
      "headingScale",
      "proseWeight",
      "headingWeight",
      "lineHeight",
      "paragraphSpacing",
      "letterSpacing",
      "wordSpacing",
    ],
    editor: [],
  },
  Page: {
    appearance: [
      "readingWidth",
      "fullWidth",
      "mathScale",
      "documentDecorations",
      "blockGuides",
      "focusMode",
      "motion",
    ],
    editor: ["typewriter"],
  },
  "Code & tables": {
    appearance: ["codeFont", "codeSize", "activeLine", "ligatures"],
    editor: [
      "indentSize",
      "defaultCodeLanguage",
      "codeWrap",
      "codeLineNumbers",
      "codeIndentOnEnter",
      "tableTabNavigation",
      "tableAutoRow",
      "tableRichPaste",
    ],
  },
  "Typing & math": {
    appearance: [],
    editor: [
      "slashCommands",
      "autoPair",
      "continuation",
      "formattingBar",
      "selectionBar",
      "mathPreview",
      "mathCompletion",
      "mathKeepLastPreview",
    ],
  },
  Minimap: { appearance: ["minimap"], editor: [] },
};
const previewSource =
  "## A research notebook\n\nKeep the **assumptions** beside the evidence. Give your ideas room to breathe.\n\n$$\nE = mc^2\n$$\n\n```python\nresult = model.evaluate(data)\n```\n\n- A clear question\n- A reproducible result\n";
const previewDocument = parseMarkdown(previewSource);

export default function ShowcaseSettings({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: () => void;
}) {
  useInterfaceLocale();
  const locale = useI18n();
  const snapshot = useSnapshot(),
    { changeAppearance, notify, navigate, renderContext, dark } = useDemo();
  const [section, setSection] = useState<Section>("Theme & interface"),
    [busy, setBusy] = useState<"backup" | "clear" | null>(null),
    [comparingStyles, setComparingStyles] = useState(false),
    [preview, setPreview] = useState<"writing" | "interface">("writing");
  const comparing = section === "Theme & interface" && comparingStyles;
  const id = useId(),
    selected = categories.findIndex((category) => category.name === section),
    context = useMemo(() => renderContext(), [renderContext]);
  const choose = (index: number) => {
    setSection(categories[index].name);
    document.getElementById(`${id}-tab-${index}`)?.focus();
  };
  const reset = () => {
    if (section === "Local data" || section === "Language") return;
    const keys = resetKeys[section],
      current = store.getSnapshot();
    if (keys.appearance.length)
      changeAppearance(
        Object.fromEntries(
          keys.appearance.map((key) => [key, paperAppearance[key]]),
        ),
      );
    if (keys.editor.length)
      store.editor({
        ...current.editor,
        ...Object.fromEntries(
          keys.editor.map((key) => [key, editorDefaults[key]]),
        ),
      });
    notify(
      locale.t(
        "{category} preferences reset. Your notes and uploads are unchanged.",
        { category: uiText(section) },
      ),
    );
  };
  return (
    <Dialog
      title={uiText("Appearance & editor")}
      subtitle={uiText(
        "Make this thinking space yours. Preferences apply live and stay on this device.",
      )}
      size="settings"
      className="demo-settings-dialog"
      onClose={() => {
        if (busy !== "clear") onClose();
      }}
    >
      <div className="demo-settings-layout" data-style-comparison={comparing}>
        <nav
          className="demo-settings-navigation"
          role="tablist"
          aria-label={uiText("Showcase preferences")}
          aria-orientation="vertical"
        >
          {categories.map(({ name, icon: Icon, group }, index) => (
            <div key={name}>
              {group && <p className="demo-settings-group">{uiText(group)}</p>}
              <button
                id={`${id}-tab-${index}`}
                role="tab"
                aria-selected={section === name}
                aria-controls={`${id}-panel`}
                tabIndex={section === name ? 0 : -1}
                onClick={() => setSection(name)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "ArrowDown"
                      ? (index + 1) % categories.length
                      : event.key === "ArrowUp"
                        ? (index + categories.length - 1) % categories.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? categories.length - 1
                            : undefined;
                  if (next !== undefined) {
                    event.preventDefault();
                    choose(next);
                  }
                }}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{uiText(name)}</span>
              </button>
            </div>
          ))}
        </nav>
        <section
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${selected}`}
          className="demo-settings-panel"
        >
          <header className="demo-settings-panel-heading">
            <div>
              <h3>{uiText(section)}</h3>
              <p>{uiText(categories[selected].description)}</p>
            </div>
            {section !== "Local data" && section !== "Language" && (
              <IconButton
                className="icon-button"
                onClick={reset}
                aria-label={locale.t("Reset {category} settings", {
                  category: uiText(section),
                })}
                title={uiText("Restore defaults for this category only")}
              >
                <RotateCcw size={15} />
              </IconButton>
            )}
          </header>
          <div className="demo-settings-fields" key={section}>
            {section === "Language" ? (
              <>
                <LanguageField
                  value={locale.choice}
                  onChange={(choice) => {
                    void saveShowcaseLocale(choice);
                  }}
                />
                {locale.error && (
                  <Notice tone="danger" role="alert">
                    {uiText(locale.error)}
                  </Notice>
                )}
              </>
            ) : section === "Theme & interface" ? (
              <ThemeSettings
                comparing={comparingStyles}
                onComparingChange={setComparingStyles}
              />
            ) : section === "Local data" ? (
              <>
                <div className="demo-local-summary">
                  <div>
                    <strong>{snapshot.documents.length}</strong>
                    <span>
                      <I18nText id="Notes & boards" />
                    </span>
                  </div>
                  <div>
                    <strong>{snapshot.assets.length}</strong>
                    <span>
                      <I18nText id="Local uploads" />
                    </span>
                  </div>
                </div>
                <h4>
                  <I18nText id="Keep a portable copy" />
                </h4>
                <p className="demo-settings-description">
                  <I18nText id="Browser storage can be cleared or evicted. A ZIP backup includes your notes, Canvas boards and uploads, not account data." />
                </p>
                <div className="demo-data-actions">
                  <Button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={async () => {
                      setBusy("backup");
                      try {
                        const { portableBundle } = await import("./exports");
                        downloadBlob(
                          await portableBundle(),
                          "axiom-showcase-backup.zip",
                        );
                        notify("Local backup downloaded.");
                      } catch (error) {
                        notify((error as Error).message);
                      } finally {
                        setBusy(null);
                      }
                    }}
                    pending={!!(busy === "backup")}
                  >
                    <Download size={15} />
                    {uiText("Download backup")}
                  </Button>
                  <Button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={onImport}
                  >
                    <Upload size={15} />
                    <I18nText id="Import backup or files" />
                  </Button>
                </div>
                <p className="demo-settings-description">
                  <I18nText id="Restore is additive: existing drafts are kept. Up to 100 MB per upload and 5 MB per note or Canvas file. Your files are never uploaded by the demo." />
                </p>
                <div className="demo-local-reset">
                  <h4>
                    <I18nText id="Start again" />
                  </h4>
                  <p className="demo-settings-description">
                    <I18nText id="Clear only this showcase’s local drafts, uploads and preferences, then restore the examples. Download a backup first. Workbench accounts are never touched." />
                  </p>
                  <Button
                    className="button ghost danger"
                    disabled={!!busy}
                    onClick={async () => {
                      if (
                        !(await confirmAction(
                          "This removes only this showcase’s notes and uploaded files on this device, then restores the examples. Download a backup first.",
                          {
                            title: "Clear local demo data?",
                            confirmLabel: "Clear & restore examples",
                            destructive: true,
                          },
                        ))
                      )
                        return;
                      setBusy("clear");
                      try {
                        await store.flush();
                        await store.clear();
                        onClose();
                        navigate("tour");
                        notify(
                          "Local demo reset. No workbench data was changed.",
                        );
                      } catch (error) {
                        notify((error as Error).message);
                      } finally {
                        setBusy(null);
                      }
                    }}
                    pending={!!(busy === "clear")}
                  >
                    <Trash2 size={15} />
                    {uiText("Clear local demo")}
                  </Button>
                </div>
              </>
            ) : (
              <ReadingSettings section={section} />
            )}
          </div>
        </section>
        <aside
          className="demo-settings-preview"
          aria-label={uiText("Live appearance preview")}
          hidden={comparing}
        >
          <header>
            <BookOpen size={14} />
            <span>
              <I18nText id="Live preview" />
            </span>
            <div
              className="scratchpad-surface-switch"
              role="group"
              aria-label={uiText("Preview surface")}
            >
              <button
                aria-pressed={preview === "writing"}
                onClick={() => setPreview("writing")}
              >
                <I18nText id="Writing" />
              </button>
              <button
                aria-pressed={preview === "interface"}
                onClick={() => setPreview("interface")}
              >
                <I18nText id="Interface" />
              </button>
            </div>
          </header>
          <div
            className="demo-settings-preview-scroll"
            hidden={preview !== "writing"}
          >
            <ReadingView
              parsed={previewDocument}
              source={previewSource}
              context={context}
              onLink={() => {}}
            />
          </div>
          <div
            className="demo-settings-preview-scroll"
            hidden={preview !== "interface"}
          >
            <ThemeWorkbench
              preferences={snapshot.appearance}
              dark={dark}
              active={!comparing && preview === "interface"}
            />
          </div>
          <p>
            <I18nText id="Colors and typography update here. Writing behavior applies in the Editor and Canvas." />
          </p>
        </aside>
      </div>
      <DialogFooter>
        <span
          className="demo-settings-save"
          role="status"
          data-error={!!snapshot.error}
        >
          <Check size={14} />
          {uiText(snapshot.status)}
        </span>
        <span className="tool-spacer" />
        <Button variant="primary" disabled={busy === "clear"} onClick={onClose}>
          <I18nText id="Done" />
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function ThemeSettings({
  comparing,
  onComparingChange,
}: {
  comparing: boolean;
  onComparingChange: (comparing: boolean) => void;
}) {
  useInterfaceLocale();
  const { appearance } = useSnapshot(),
    { changeAppearance } = useDemo();
  return (
    <>
      <h4>
        <I18nText id="Color mode" />
      </h4>
      <div
        className="demo-mode-switch"
        role="group"
        aria-label={uiText("Color mode")}
      >
        {(
          [
            { value: "light", icon: Sun },
            { value: "dark", icon: Moon },
            { value: "system", icon: Monitor },
          ] as const
        ).map(({ value, icon: Icon }) => (
          <button
            key={value}
            aria-pressed={appearance.mode === value}
            onClick={() => changeAppearance({ mode: value })}
          >
            <Icon size={15} />
            {uiText(value)}
          </button>
        ))}
      </div>
      <h4>
        <I18nText id="Palette" />
      </h4>
      <div className="demo-theme-grid">
        {[
          {
            id: "default",
            name: "Axiom",
            description: "Clear, mineral-toned surfaces",
          },
          ...themePacks,
        ].map((pack) => (
          <button
            key={pack.id}
            aria-pressed={appearance.themePack === pack.id}
            onClick={() =>
              changeAppearance({
                themePack: pack.id as Preferences["themePack"],
              })
            }
          >
            <span
              className={`demo-theme-swatch ${pack.id}`}
              style={
                "palettes" in pack
                  ? {
                      background: `linear-gradient(135deg, ${pack.palettes.light.paper} 50%, ${pack.palettes.light.accent} 50%)`,
                    }
                  : undefined
              }
              aria-hidden="true"
            />
            <strong>{pack.name}</strong>
            <small>{uiText(pack.description)}</small>
          </button>
        ))}
      </div>
      <InterfaceStylePicker
        value={appearance.interfaceStyle}
        onChange={(interfaceStyle) => changeAppearance({ interfaceStyle })}
        comparing={comparing}
        onComparingChange={onComparingChange}
      />
      <h4>
        <I18nText id="Interface comfort" />
      </h4>
      <Field label={uiText("Interface font")} className="demo-preference-field">
        <NativeSelect
          value={appearance.uiFont}
          onChange={(event) =>
            changeAppearance({
              uiFont: event.target.value as Preferences["uiFont"],
            })
          }
        >
          {Object.entries(fonts).map(([id, font]) => (
            <option key={id} value={id}>
              {uiText(font.label)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <NumberPreference
        label={uiText("Interface font size")}
        value={appearance.uiSize}
        min={12}
        max={22}
        step={1}
        unit="px"
        onChange={(uiSize) => changeAppearance({ uiSize })}
        reset={() => changeAppearance({ uiSize: paperAppearance.uiSize })}
        onInvalid={() => {}}
      />
      <div className="demo-preference-pair">
        <Field label={uiText("Density")} className="demo-preference-field">
          <NativeSelect
            value={appearance.density}
            onChange={(event) =>
              changeAppearance({
                density: event.target.value as Preferences["density"],
              })
            }
          >
            <option value="comfortable">
              <I18nText id="Comfortable" />
            </option>
            <option value="compact">
              <I18nText id="Compact" />
            </option>
          </NativeSelect>
        </Field>
        <Field label={uiText("Shadows")} className="demo-preference-field">
          <NativeSelect
            value={appearance.shadows}
            onChange={(event) =>
              changeAppearance({
                shadows: event.target.value as Preferences["shadows"],
              })
            }
          >
            <option value="none">
              <I18nText id="None" />
            </option>
            <option value="soft">
              <I18nText id="Soft" />
            </option>
            <option value="elevated">
              <I18nText id="Elevated" />
            </option>
          </NativeSelect>
        </Field>
      </div>
      <NumberPreference
        label={uiText("Corner radius")}
        value={appearance.radius}
        min={0}
        max={18}
        step={1}
        unit="px"
        onChange={(radius) => changeAppearance({ radius })}
        reset={() => changeAppearance({ radius: paperAppearance.radius })}
        onInvalid={() => {}}
      />
    </>
  );
}
