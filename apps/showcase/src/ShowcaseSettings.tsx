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
import type { Preferences } from "@axiom/shared/appearance";
import { editorDefaults, type EditorPreferences } from "@axiom/shared/editor";
import { themePacks } from "@axiom/shared/theme-packs";
import Dialog, { DialogFooter } from "../../web/components/Dialog";
import ReadingView from "../../web/components/ReadingView";
import { confirmAction } from "../../web/lib/app-prompt";
import { downloadBlob } from "../../web/lib/tools/download";
import ReadingSettings, { type ReadingSection } from "./ReadingSettings";
import { useDemo, useSnapshot, store } from "./context";
import { paperAppearance } from "./samples";

type Section = "Theme & interface" | ReadingSection | "Local data";
const categories: Array<{
  name: Section;
  icon: LucideIcon;
  description: string;
  group?: string;
}> = [
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
  Exclude<Section, "Local data">,
  {
    appearance: Array<keyof Preferences>;
    editor: Array<keyof EditorPreferences>;
  }
> = {
  "Theme & interface": {
    appearance: ["mode", "themePack", "interfaceStyle"],
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
  const snapshot = useSnapshot(),
    { changeAppearance, notify, navigate, renderContext } = useDemo();
  const [section, setSection] = useState<Section>("Theme & interface"),
    [busy, setBusy] = useState<"backup" | "clear" | null>(null);
  const id = useId(),
    selected = categories.findIndex((category) => category.name === section),
    context = useMemo(() => renderContext(), [renderContext]);
  const choose = (index: number) => {
    setSection(categories[index].name);
    document.getElementById(`${id}-tab-${index}`)?.focus();
  };
  const reset = () => {
    if (section === "Local data") return;
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
      `${section} preferences reset. Your notes and uploads are unchanged.`,
    );
  };
  return (
    <Dialog
      title="Appearance & editor"
      subtitle="Make this thinking space yours. Preferences apply live and stay on this device."
      size="settings"
      className="demo-settings-dialog"
      onClose={() => {
        if (busy !== "clear") onClose();
      }}
    >
      <div className="demo-settings-layout">
        <nav
          className="demo-settings-navigation"
          role="tablist"
          aria-label="Showcase preferences"
          aria-orientation="vertical"
        >
          {categories.map(({ name, icon: Icon, group }, index) => (
            <div key={name}>
              {group && <p className="demo-settings-group">{group}</p>}
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
                <span>{name}</span>
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
              <h3>{section}</h3>
              <p>{categories[selected].description}</p>
            </div>
            {section !== "Local data" && (
              <button
                className="icon-button"
                onClick={reset}
                aria-label={`Reset ${section} settings`}
                title="Restore defaults for this category only"
              >
                <RotateCcw size={15} />
              </button>
            )}
          </header>
          <div className="demo-settings-fields" key={section}>
            {section === "Theme & interface" ? (
              <ThemeSettings />
            ) : section === "Local data" ? (
              <>
                <div className="demo-local-summary">
                  <div>
                    <strong>{snapshot.documents.length}</strong>
                    <span>Notes & boards</span>
                  </div>
                  <div>
                    <strong>{snapshot.assets.length}</strong>
                    <span>Local uploads</span>
                  </div>
                </div>
                <h4>Keep a portable copy</h4>
                <p className="demo-settings-description">
                  Browser storage can be cleared or evicted. A ZIP backup
                  includes your notes, Canvas boards and uploads, not account
                  data.
                </p>
                <div className="demo-data-actions">
                  <button
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
                  >
                    <Download size={15} />
                    {busy === "backup"
                      ? "Preparing backup…"
                      : "Download backup"}
                  </button>
                  <button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={onImport}
                  >
                    <Upload size={15} />
                    Import backup or files
                  </button>
                </div>
                <p className="demo-settings-description">
                  Restore is additive: existing drafts are kept. Up to 100 MB
                  per upload and 5 MB per note or Canvas file. Your files are
                  never uploaded by the demo.
                </p>
                <div className="demo-local-reset">
                  <h4>Start again</h4>
                  <p className="demo-settings-description">
                    Clear only this showcase’s local drafts, uploads and
                    preferences, then restore the examples. Download a backup
                    first. Workbench accounts are never touched.
                  </p>
                  <button
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
                  >
                    <Trash2 size={15} />
                    {busy === "clear" ? "Clearing…" : "Clear local demo"}
                  </button>
                </div>
              </>
            ) : (
              <ReadingSettings section={section} />
            )}
          </div>
        </section>
        <aside
          className="demo-settings-preview"
          aria-label="Live document preview"
        >
          <header>
            <BookOpen size={14} />
            <span>Live preview</span>
          </header>
          <div className="demo-settings-preview-scroll">
            <ReadingView
              parsed={previewDocument}
              source={previewSource}
              context={context}
              onLink={() => {}}
            />
          </div>
          <p>
            Colors and typography update here. Writing behavior applies in the
            Editor and Canvas.
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
          {snapshot.status}
        </span>
        <span className="tool-spacer" />
        <button
          className="button"
          disabled={busy === "clear"}
          onClick={onClose}
        >
          Done
        </button>
      </DialogFooter>
    </Dialog>
  );
}

function ThemeSettings() {
  const { appearance } = useSnapshot(),
    { changeAppearance } = useDemo();
  return (
    <>
      <h4>Color mode</h4>
      <div className="demo-mode-switch" role="group" aria-label="Color mode">
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
            {value}
          </button>
        ))}
      </div>
      <h4>Palette</h4>
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
              aria-hidden="true"
            />
            <strong>{pack.name}</strong>
            <small>{pack.description}</small>
          </button>
        ))}
      </div>
      <h4>Interface treatment</h4>
      <label className="demo-preference-field">
        Interface design
        <select
          aria-label="Interface design"
          value={appearance.interfaceStyle}
          onChange={(event) =>
            changeAppearance({
              interfaceStyle: event.target
                .value as Preferences["interfaceStyle"],
            })
          }
        >
          <option value="axiom">Axiom · balanced</option>
          <option value="editorial">Editorial · quiet</option>
          <option value="material">Material · expressive</option>
          <option value="fluent">Fluent · layered</option>
        </select>
      </label>
      <p className="demo-settings-description">
        Interface treatments change controls and surfaces. They do not replace
        your palette or reading fonts.
      </p>
    </>
  );
}
