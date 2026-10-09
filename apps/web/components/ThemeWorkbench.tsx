"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  ActionRow,
  Button,
  Checkbox,
  Field,
  HelpText,
  IconButton,
  Notice,
  Slider,
  Switch,
  TextInput,
  TextArea,
  InputGroup,
  SearchField,
  NativeSelect,
  Picker,
} from "./ui/controls";
import { useEffect, useRef, useState } from "react";
import Dialog, { DialogFooter } from "./Dialog";
import {
  Check,
  Copy,
  FileText,
  MoreHorizontal,
  Plus,
  Trash2,
  UserRound,
  Globe2,
  X,
} from "lucide-react";
import {
  contrastRatio,
  paletteFor,
  type Preferences,
} from "@axiom/shared/appearance";

/** Interactive visual fixture only: no accounts, files or network mutations. */
export default function ThemeWorkbench({
  preferences,
  dark,
  active = true,
}: {
  preferences: Preferences;
  dark: boolean;
  active?: boolean;
}) {
  useInterfaceLocale();
  const [selected, setSelected] = useState(true),
    [query, setQuery] = useState(""),
    [menu, setMenu] = useState(false),
    [enabled, setEnabled] = useState(true),
    [zoom, setZoom] = useState(100),
    [choices, setChoices] = useState([true, false]),
    [pending, setPending] = useState(false),
    [sampleDialog, setSampleDialog] = useState(false),
    [sampleTitle, setSampleTitle] = useState("Research notes — α, β, and ∇");
  const [person, setPerson] = useState("ada"),
    [tags, setTags] = useState<string[]>(["math"]),
    [notes, setNotes] = useState(""),
    [density, setDensity] = useState("comfortable");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!active) {
      setMenu(false);
      setPending(false);
      setSampleDialog(false);
      clearTimeout(timer.current);
    }
  }, [active]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const p = paletteFor(preferences, dark);
  return (
    <section className="theme-workbench" aria-label={uiText("Theme workbench")}>
      <HelpText>
        <I18nText id="Try everyday controls with your current draft. Switch color mode to review both palettes." />
      </HelpText>
      <div className="theme-workbench-palette">
        {(
          ["paper", "sidebar", "surface", "accent", "text", "muted"] as const
        ).map((key) => (
          <span key={key}>
            <i style={{ backgroundColor: p[key] }} />
            <small>{key}</small>
          </span>
        ))}
      </div>
      <Field
        label={uiText("Search specimen")}
        className="theme-workbench-input"
      >
        <SearchField
          aria-label={uiText("Specimen search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          clearLabel={uiText("Clear specimen search")}
          placeholder={uiText("A long research project name…")}
        />
      </Field>
      <div className="theme-workbench-field-grid">
        <Field label={uiText("Native selector")}>
          <NativeSelect
            aria-label={uiText("Specimen native selector")}
            value={density}
            onChange={(e) => setDensity(e.target.value)}
          >
            <option value="comfortable">
              <I18nText id="Comfortable" />
            </option>
            <option value="compact">
              <I18nText id="Compact" />
            </option>
          </NativeSelect>
        </Field>
        <Field label={uiText("Searchable single choice")}>
          <Picker
            label={uiText("Specimen person")}
            value={person}
            onChange={(v) => setPerson(String(v))}
            options={[
              {
                value: "ada",
                label: "Ada Lovelace",
                description: "Mathematics",
              },
              {
                value: "noether",
                label: "Emmy Noether",
                description: "Theoretical physics",
              },
              {
                value: "turing",
                label: "Alan Turing",
                description: "Computer science",
              },
            ]}
          />
        </Field>
        <Field label={uiText("Multiple choices")}>
          <Picker
            label={uiText("Specimen topics")}
            multiple
            value={tags}
            onChange={(v) => setTags(v as string[])}
            options={[
              { value: "math", label: "Mathematics" },
              { value: "physics", label: "Physics" },
              { value: "ai", label: "Artificial intelligence" },
            ]}
          />
        </Field>
        <Field
          label={uiText("Multiline field")}
          hint={uiText(
            "Application fields follow the interface style; editor fields stay transparent.",
          )}
        >
          <TextArea
            aria-label={uiText("Specimen notes")}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={uiText("Research context…")}
          />
        </Field>
      </div>
      <section
        className="theme-workbench-toolbars"
        aria-label={uiText("Mixed toolbar sizes")}
      >
        <h3>
          <I18nText id="Toolbar alignment" />
        </h3>
        {(["standard", "compact"] as const).map((size) => (
          <ActionRow
            key={size}
            size={size}
            aria-label={`${size === "standard" ? "Standard" : "Compact"} toolbar sample`}
          >
            <SearchField
              aria-label={`${size} toolbar query`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery("")}
              clearLabel={`Clear ${size} toolbar query`}
              placeholder={uiText("Find evidence…")}
            />
            <NativeSelect
              aria-label={`${size} toolbar density`}
              value={density}
              onChange={(event) => setDensity(event.target.value)}
            >
              <option value="comfortable">
                <I18nText id="Comfortable" />
              </option>
              <option value="compact">
                <I18nText id="Compact" />
              </option>
            </NativeSelect>
            <Button type="button" onClick={() => setSelected(!selected)}>
              <Plus aria-hidden="true" />
              <I18nText id="Select sample" />
            </Button>
            <IconButton
              type="button"
              label={`Reset ${size} toolbar query`}
              onClick={() => setQuery("")}
            >
              <X aria-hidden="true" />
            </IconButton>
          </ActionRow>
        ))}
      </section>
      <ActionRow className="theme-workbench-actions">
        <Button
          className="button primary"
          onClick={() => setSelected(!selected)}
        >
          <Plus size={15} />
          <I18nText id="Select item" />
        </Button>
        <Button className="button secondary" onClick={() => setQuery("")}>
          <I18nText id="Clear" />
        </Button>
        <Button className="button secondary" disabled>
          <I18nText id="Disabled" />
        </Button>
      </ActionRow>
      <div className={`theme-workbench-row ${selected ? "is-selected" : ""}`}>
        <Checkbox
          aria-label={uiText("Select specimen paper")}
          checked={selected}
          onChange={(e) => setSelected(e.target.checked)}
        />
        <FileText size={20} />
        <div>
          <strong>{sampleTitle}</strong>
          <small>
            <I18nText id="Markdown · sample only" />
          </small>
        </div>
        <IconButton
          className="icon-button"
          aria-label={uiText("Specimen actions")}
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <MoreHorizontal size={17} />
        </IconButton>
      </div>
      {menu && (
        <div
          className="theme-workbench-menu"
          role="group"
          aria-label={uiText("Sample action menu")}
        >
          <button onClick={() => setMenu(false)}>
            <Copy size={15} />
            <I18nText id="Copy" /> <kbd>⌘C</kbd>
          </button>
          <hr />
          <button onClick={() => setMenu(false)}>
            <Trash2 size={15} />
            <I18nText id="Move to trash" />
          </button>
        </div>
      )}
      <div className="theme-workbench-status">
        <Check size={15} />
        <I18nText id="Saved state preview" />{" "}
        <span>
          <I18nText id="Not a real save" />
        </span>
      </div>
      <section
        className="theme-workbench-control-section"
        aria-label={uiText("Control states")}
      >
        <h3>
          <I18nText id="Controls & states" />
        </h3>
        <label className="theme-workbench-switch">
          <span>
            <I18nText id="Preview preference" />
            <small>
              <I18nText id="Sample only · no account changes" />
            </small>
          </span>
          <Switch
            aria-label={uiText("Specimen preference")}
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
        </label>
        <Field label={`Preview zoom · ${zoom}%`}>
          <Slider
            aria-label={uiText("Specimen zoom")}
            aria-valuetext={`${zoom}%`}
            min={50}
            max={200}
            step={10}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </Field>
        <fieldset className="theme-workbench-choices">
          <legend>
            <I18nText id="Sample selection" />
          </legend>
          <label>
            <Checkbox
              aria-label={uiText("Select all specimen options")}
              checked={choices.every(Boolean)}
              indeterminate={choices.some(Boolean) && !choices.every(Boolean)}
              onChange={(event) =>
                setChoices([event.target.checked, event.target.checked])
              }
            />
            <I18nText id="All options" />
          </label>
          {choices.map((checked, index) => (
            <label key={index}>
              <Checkbox
                aria-label={`Specimen option ${index + 1}`}
                checked={checked}
                onChange={(event) =>
                  setChoices((current) =>
                    current.map((value, i) =>
                      i === index ? event.target.checked : value,
                    ),
                  )
                }
              />
              <I18nText id="Option" /> {index + 1}
            </label>
          ))}
          <label>
            <Checkbox disabled defaultChecked />
            <I18nText id="Unavailable option" />
          </label>
        </fieldset>
        <Field
          label={uiText("Validation example")}
          error="Keep the draft and explain how to correct it."
        >
          <TextInput
            aria-label={uiText("Specimen invalid field")}
            defaultValue="Unfinished value"
          />
        </Field>
        <ActionRow>
          <Button
            type="button"
            variant="primary"
            pending={pending}
            onClick={() => {
              setPending(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setPending(false), 1000);
            }}
          >
            <I18nText id="Save sample" />
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => setChoices([false, false])}
          >
            <I18nText id="Clear selection" />
          </Button>
        </ActionRow>
        <Notice>
          <I18nText id="These controls are interactive specimens, not real file operations." />
        </Notice>
        <Button type="button" onClick={() => setSampleDialog(true)}>
          <I18nText id="Open sample dialog" />
        </Button>
      </section>
      {sampleDialog && (
        <Dialog
          title={uiText("Sample form")}
          subtitle={uiText(
            "A disposable control specimen, not an account or file change.",
          )}
          size="compact"
          onClose={() => setSampleDialog(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setSampleTitle(String(form.get("title") ?? "").trim());
              setSampleDialog(false);
            }}
          >
            <Field
              label={uiText("Sample title")}
              icon={<FileText />}
              hint={uiText("Try a long title to check wrapping and alignment.")}
            >
              <TextInput
                name="title"
                required
                maxLength={180}
                defaultValue={sampleTitle}
              />
            </Field>
            <Field
              label={uiText("Sample owner")}
              icon={<UserRound />}
              hint={uiText(
                "Select a person; search text alone is not a saved value.",
              )}
            >
              <Picker
                label={uiText("Sample owner")}
                name="owner"
                required
                value={person}
                onChange={(v) => setPerson(String(v))}
                options={[
                  { value: "ada", label: "Ada Lovelace" },
                  { value: "noether", label: "Emmy Noether" },
                  { value: "turing", label: "Alan Turing" },
                ]}
              />
            </Field>
            <Field
              label={uiText("Sample website")}
              hint={uiText("Optional · a link to the research project.")}
            >
              <InputGroup leading={<Globe2 />}>
                <TextInput
                  type="url"
                  name="website"
                  placeholder="https://example.org"
                />
              </InputGroup>
            </Field>
            <DialogFooter>
              <Button
                data-dialog-cancel
                type="button"
                onClick={() => setSampleDialog(false)}
              >
                <I18nText id="Cancel" />
              </Button>
              <Button variant="primary">
                <I18nText id="Save sample title" />
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}
      <h3>
        <I18nText id="Contrast checks" />
      </h3>
      <dl className="theme-workbench-contrast">
        {[
          ["Body text", p.text, p.paper],
          ["Secondary text", p.muted, p.surface],
          ["Button label", p.onAccent, p.accent],
        ].map(([label, a, b]) => {
          const ratio = contrastRatio(a, b);
          return (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {ratio.toFixed(2)}:1 ·{" "}
                {ratio >= 4.5 ? uiText("Pass") : uiText("Review")}
              </dd>
            </div>
          );
        })}
      </dl>
      <HelpText>
        <I18nText id="Also review keyboard focus, 150% UI scale, reduced motion and forced colors. Automated contrast checks do not replace a visual review." />
      </HelpText>
    </section>
  );
}
