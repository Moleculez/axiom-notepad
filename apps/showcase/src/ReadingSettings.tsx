import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";
import {
  Switch,
  TextInput,
  NativeSelect,
} from "../../web/components/ui/controls";
import { NumberPreference } from "../../web/components/PreferenceControls";
import { useId } from "react";
import { fonts, type Preferences } from "@axiom/shared/appearance";
import type { EditorPreferences } from "@axiom/shared/editor";
import type { MinimapPreferences } from "@axiom/shared/minimap";
import { useDemo, useSnapshot, store } from "./context";
import { paperAppearance } from "./samples";

export const readingSections = [
  "Typography",
  "Page",
  "Code & tables",
  "Typing & math",
  "Minimap",
] as const;
export type ReadingSection = (typeof readingSections)[number];
type NumberKey = {
  [K in keyof Preferences]: Preferences[K] extends number ? K : never;
}[keyof Preferences];
type BooleanKey<T> = {
  [K in keyof T]: T[K] extends boolean ? K : never;
}[keyof T];
/** All controls map to the shared, validated engine/appearance contracts. */
export default function ReadingSettings({
  section,
}: {
  section: ReadingSection;
}) {
  useInterfaceLocale();
  const { appearance, editor } = useSnapshot(),
    { changeAppearance } = useDemo();
  const id = useId();
  const edit = (change: Partial<EditorPreferences>) =>
    store.editor({ ...store.getSnapshot().editor, ...change });
  const minimap = (change: Partial<MinimapPreferences>) =>
    changeAppearance({ minimap: { ...appearance.minimap, ...change } });
  const range = (
    label: string,
    key: NumberKey,
    min: number,
    max: number,
    step = 1,
    suffix = "",
  ) => (
    <Range
      key={key}
      label={label}
      value={appearance[key]}
      min={min}
      max={max}
      step={step}
      suffix={suffix}
      resetValue={paperAppearance[key]}
      disabled={key === "readingWidth" && appearance.fullWidth}
      onChange={(value) => changeAppearance({ [key]: value })}
    />
  );
  const font = (
    label: string,
    key: "proseFont" | "headingFont" | "codeFont",
  ) => (
    <Choice
      label={label}
      value={appearance[key]}
      choices={Object.entries(fonts)
        .filter(
          ([name]) =>
            key !== "codeFont" ||
            ["jetbrains", "plexMono", "systemMono"].includes(name),
        )
        .map(([name, data]) => [name, data.label])}
      onChange={(value) =>
        changeAppearance({ [key]: value } as Partial<Preferences>)
      }
    />
  );
  const behavior = (
    label: string,
    key: BooleanKey<EditorPreferences>,
    hint?: string,
  ) => (
    <Toggle
      key={key}
      label={label}
      checked={editor[key]}
      hint={hint}
      onChange={(value) => edit({ [key]: value })}
    />
  );
  const display = (
    label: string,
    key: BooleanKey<Preferences>,
    hint?: string,
  ) => (
    <Toggle
      key={key}
      label={label}
      checked={appearance[key]}
      hint={hint}
      onChange={(value) => changeAppearance({ [key]: value })}
    />
  );
  return (
    <section className="demo-reading-settings">
      <div className="demo-preference-fields">
        {section === "Typography" && (
          <>
            <h4>
              <I18nText id="Typefaces" />
            </h4>
            <div className="demo-preference-pair">
              {font("Reading font", "proseFont")}
              {font("Heading font", "headingFont")}
            </div>
            <div className="demo-preference-pair">
              {range("Reading font size", "proseSize", 14, 30, 1, " px")}
              {range("Heading scale", "headingScale", 0.85, 1.4, 0.05, "×")}
            </div>
            <div className="demo-preference-pair">
              <Choice
                label={uiText("Body weight")}
                value={appearance.proseWeight}
                choices={[
                  ["400", "Regular"],
                  ["500", "Medium"],
                  ["600", "Semibold"],
                  ["700", "Bold"],
                ]}
                onChange={(value) =>
                  changeAppearance({
                    proseWeight: value as Preferences["proseWeight"],
                  })
                }
              />
              <Choice
                label={uiText("Heading weight")}
                value={appearance.headingWeight}
                choices={[
                  ["400", "Regular"],
                  ["500", "Medium"],
                  ["600", "Semibold"],
                  ["700", "Bold"],
                ]}
                onChange={(value) =>
                  changeAppearance({
                    headingWeight: value as Preferences["headingWeight"],
                  })
                }
              />
            </div>
            <h4>
              <I18nText id="Spacing & rhythm" />
            </h4>
            {range("Line height", "lineHeight", 1.3, 2.4, 0.05, "×")}
            {range(
              "Paragraph spacing",
              "paragraphSpacing",
              0.4,
              2.5,
              0.1,
              " em",
            )}
            <div className="demo-preference-pair">
              {range(
                "Letter spacing",
                "letterSpacing",
                -0.02,
                0.14,
                0.01,
                " em",
              )}
              {range("Word spacing", "wordSpacing", 0, 0.25, 0.01, " em")}
            </div>
          </>
        )}
        {section === "Page" && (
          <>
            <h4>
              <I18nText id="Document layout" />
            </h4>
            {range("Reading width", "readingWidth", 45, 110, 1, " ch")}
            {display(
              "Use the full page width",
              "fullWidth",
              "Reading width applies again when this is off.",
            )}
            {range("Equation size", "mathScale", 0.8, 1.5, 0.05, "×")}
            <Toggle
              label={uiText("LaTeX-inspired section numbering")}
              checked={appearance.documentDecorations === "latex"}
              onChange={(value) =>
                changeAppearance({
                  documentDecorations: value ? "latex" : "none",
                })
              }
            />
            {display("Folding & block-range guides", "blockGuides")}
            <h4>
              <I18nText id="Reading comfort" />
            </h4>
            {display(
              "Focus mode",
              "focusMode",
              "Quiet surrounding paragraphs while you write.",
            )}
            {behavior(
              "Typewriter scrolling",
              "typewriter",
              "Keep the active writing line near the center.",
            )}
            <Choice
              label={uiText("Motion")}
              value={appearance.motion}
              choices={[
                ["system", "Follow system"],
                ["reduced", "Reduced"],
                ["none", "No animation"],
              ]}
              onChange={(value) =>
                changeAppearance({ motion: value as Preferences["motion"] })
              }
            />
          </>
        )}
        {section === "Code & tables" && (
          <>
            <h4>
              <I18nText id="Code appearance" />
            </h4>
            {font("Code font", "codeFont")}
            {range("Code font size", "codeSize", 12, 24, 1, " px")}
            <Choice
              label={uiText("Indentation")}
              value={String(editor.indentSize)}
              choices={[
                ["2", "2 spaces"],
                ["4", "4 spaces"],
                ["8", "8 spaces"],
              ]}
              onChange={(value) =>
                edit({
                  indentSize: Number(value) as EditorPreferences["indentSize"],
                })
              }
            />
            <label className="demo-preference-field">
              <I18nText id="Default code language" />
              <TextInput
                aria-label={uiText("Default code language")}
                value={editor.defaultCodeLanguage}
                maxLength={40}
                list={`${id}-languages`}
                onChange={(event) => {
                  if (/^[\w+#.-]*$/.test(event.target.value))
                    edit({ defaultCodeLanguage: event.target.value });
                }}
                placeholder={uiText("Plain text")}
              />
              <datalist id={`${id}-languages`}>
                {[
                  "python",
                  "javascript",
                  "typescript",
                  "rust",
                  "c",
                  "cpp",
                  "julia",
                  "r",
                  "latex",
                  "sql",
                  "bash",
                  "json",
                  "yaml",
                ].map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </label>
            {behavior("Wrap code lines", "codeWrap")}
            {behavior("Code line numbers", "codeLineNumbers")}
            {behavior("Indent code on Enter", "codeIndentOnEnter")}
            {display("Highlight the active source line", "activeLine")}
            {display("Code font ligatures", "ligatures")}
            <h4>
              <I18nText id="Tables" />
            </h4>
            {behavior("Navigate table cells with Tab", "tableTabNavigation")}
            {behavior("Tab creates a row at the end", "tableAutoRow")}
            {behavior(
              "Paste rows and columns into tables",
              "tableRichPaste",
              "Import a spreadsheet selection or tab-separated text.",
            )}
          </>
        )}
        {section === "Typing & math" && (
          <>
            <h4>
              <I18nText id="Writing assistance" />
            </h4>
            {behavior(
              "Slash commands",
              "slashCommands",
              "Type / at a paragraph to insert a block.",
            )}
            {behavior("Pair brackets, quotes and delimiters", "autoPair")}
            {behavior("Continue lists and quotes on Enter", "continuation")}
            {behavior("Formatting toolbar", "formattingBar")}
            {behavior("Selection formatting menu", "selectionBar")}
            <h4>
              <I18nText id="Mathematics" />
            </h4>
            {behavior("Live equation preview", "mathPreview")}
            {behavior("Math symbol completion", "mathCompletion")}
            {behavior(
              "Keep the last valid equation preview",
              "mathKeepLastPreview",
              "Avoid a flashing preview while an expression is incomplete.",
            )}
            <p className="demo-fineprint">
              <I18nText id="Shortcuts remain available. These controls also apply to rich-text Canvas cards; Read mode never changes your source." />
            </p>
          </>
        )}
        {section === "Minimap" && (
          <>
            <Toggle
              label={uiText("Document minimap")}
              checked={appearance.minimap.enabled}
              onChange={(value) => minimap({ enabled: value })}
            />
            <div className="demo-preference-pair">
              <Choice
                label={uiText("Minimap side")}
                value={appearance.minimap.side}
                choices={[
                  ["right", "Right"],
                  ["left", "Left"],
                ]}
                onChange={(value) =>
                  minimap({ side: value as MinimapPreferences["side"] })
                }
              />
              <Choice
                label={uiText("Minimap rendering")}
                value={appearance.minimap.rendering}
                choices={[
                  ["text", "Text"],
                  ["blocks", "Block structure"],
                ]}
                onChange={(value) =>
                  minimap({
                    rendering: value as MinimapPreferences["rendering"],
                  })
                }
              />
            </div>
            <Range
              label={uiText("Minimap width")}
              value={appearance.minimap.width}
              min={80}
              max={200}
              suffix=" px"
              resetValue={paperAppearance.minimap.width}
              onChange={(value) => minimap({ width: value })}
            />
            <Choice
              label={uiText("Minimap scale")}
              value={appearance.minimap.size}
              choices={[
                ["fit", "Fit document"],
                ["proportional", "Proportional"],
                ["fill", "Fill height"],
              ]}
              onChange={(value) =>
                minimap({ size: value as MinimapPreferences["size"] })
              }
            />
            <Choice
              label={uiText("Viewport indicator")}
              value={appearance.minimap.slider}
              choices={[
                ["hover", "Show on hover"],
                ["always", "Always visible"],
              ]}
              onChange={(value) =>
                minimap({ slider: value as MinimapPreferences["slider"] })
              }
            />
            {(
              [
                ["Show in Write mode", "write"],
                ["Show in Source mode", "source"],
                ["Show in Read mode", "read"],
                ["Heading markers", "headings"],
                ["Hover previews", "preview"],
                ["Search result markers", "search"],
                ["Cursor and selection markers", "selection"],
              ] as const
            ).map(([label, key]) => (
              <Toggle
                key={key}
                label={label}
                checked={appearance.minimap[key]}
                onChange={(value) => minimap({ [key]: value })}
              />
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function Choice({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: string[][];
  onChange: (value: string) => void;
}) {
  useInterfaceLocale();
  return (
    <label className="demo-preference-field">
      {uiText(label)}
      <NativeSelect
        aria-label={uiText(label)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {choices.map(([id, name]) => (
          <option key={id} value={id}>
            {uiText(name)}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
function Range({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  disabled = false,
  resetValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  resetValue: number;
  onChange: (value: number) => void;
}) {
  return (
    <NumberPreference
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      unit={suffix.trim()}
      disabled={disabled}
      onChange={onChange}
      reset={() => onChange(resetValue)}
      onInvalid={() => {}}
    />
  );
}
function Toggle({
  label,
  checked,
  hint,
  onChange,
}: {
  label: string;
  checked: boolean;
  hint?: string;
  onChange: (value: boolean) => void;
}) {
  useInterfaceLocale();
  const descriptionId = useId();
  return (
    <label className="demo-toggle">
      <Switch
        aria-label={uiText(label)}
        aria-describedby={hint ? descriptionId : undefined}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {uiText(label)}
        {hint && <small id={descriptionId}>{uiText(hint)}</small>}
      </span>
    </label>
  );
}
