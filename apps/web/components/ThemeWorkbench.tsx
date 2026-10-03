"use client";
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
    <section className="theme-workbench" aria-label="Theme workbench">
      <HelpText>
        Try everyday controls with your current draft. Switch color mode to
        review both palettes.
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
      <Field label="Search specimen" className="theme-workbench-input">
        <SearchField
          aria-label="Specimen search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          clearLabel="Clear specimen search"
          placeholder="A long research project name…"
        />
      </Field>
      <div className="theme-workbench-field-grid">
        <Field label="Native selector">
          <NativeSelect
            aria-label="Specimen native selector"
            value={density}
            onChange={(e) => setDensity(e.target.value)}
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </NativeSelect>
        </Field>
        <Field label="Searchable single choice">
          <Picker
            label="Specimen person"
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
        <Field label="Multiple choices">
          <Picker
            label="Specimen topics"
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
          label="Multiline field"
          hint="Application fields follow the interface style; editor fields stay transparent."
        >
          <TextArea
            aria-label="Specimen notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Research context…"
          />
        </Field>
      </div>
      <ActionRow className="theme-workbench-actions">
        <Button
          className="button primary"
          onClick={() => setSelected(!selected)}
        >
          <Plus size={15} />
          Select item
        </Button>
        <Button className="button secondary" onClick={() => setQuery("")}>
          Clear
        </Button>
        <Button className="button secondary" disabled>
          Disabled
        </Button>
      </ActionRow>
      <div className={`theme-workbench-row ${selected ? "is-selected" : ""}`}>
        <Checkbox
          aria-label="Select specimen paper"
          checked={selected}
          onChange={(e) => setSelected(e.target.checked)}
        />
        <FileText size={20} />
        <div>
          <strong>{sampleTitle}</strong>
          <small>Markdown · sample only</small>
        </div>
        <IconButton
          className="icon-button"
          aria-label="Specimen actions"
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
          aria-label="Sample action menu"
        >
          <button onClick={() => setMenu(false)}>
            <Copy size={15} />
            Copy <kbd>⌘C</kbd>
          </button>
          <hr />
          <button onClick={() => setMenu(false)}>
            <Trash2 size={15} />
            Move to trash
          </button>
        </div>
      )}
      <div className="theme-workbench-status">
        <Check size={15} />
        Saved state preview <span>Not a real save</span>
      </div>
      <section
        className="theme-workbench-control-section"
        aria-label="Control states"
      >
        <h3>Controls & states</h3>
        <label className="theme-workbench-switch">
          <span>
            Preview preference<small>Sample only · no account changes</small>
          </span>
          <Switch
            aria-label="Specimen preference"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
        </label>
        <Field label={`Preview zoom · ${zoom}%`}>
          <Slider
            aria-label="Specimen zoom"
            aria-valuetext={`${zoom}%`}
            min={50}
            max={200}
            step={10}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </Field>
        <fieldset className="theme-workbench-choices">
          <legend>Sample selection</legend>
          <label>
            <Checkbox
              aria-label="Select all specimen options"
              checked={choices.every(Boolean)}
              indeterminate={choices.some(Boolean) && !choices.every(Boolean)}
              onChange={(event) =>
                setChoices([event.target.checked, event.target.checked])
              }
            />
            All options
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
              Option {index + 1}
            </label>
          ))}
          <label>
            <Checkbox disabled defaultChecked />
            Unavailable option
          </label>
        </fieldset>
        <Field
          label="Validation example"
          error="Keep the draft and explain how to correct it."
        >
          <TextInput
            aria-label="Specimen invalid field"
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
            Save sample
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => setChoices([false, false])}
          >
            Clear selection
          </Button>
        </ActionRow>
        <Notice>
          These controls are interactive specimens, not real file operations.
        </Notice>
        <Button type="button" onClick={() => setSampleDialog(true)}>
          Open sample dialog
        </Button>
      </section>
      {sampleDialog && (
        <Dialog
          title="Sample form"
          subtitle="A disposable control specimen, not an account or file change."
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
              label="Sample title"
              icon={<FileText />}
              hint="Try a long title to check wrapping and alignment."
            >
              <TextInput
                name="title"
                required
                maxLength={180}
                defaultValue={sampleTitle}
              />
            </Field>
            <Field
              label="Sample owner"
              icon={<UserRound />}
              hint="Select a person; search text alone is not a saved value."
            >
              <Picker
                label="Sample owner"
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
              label="Sample website"
              hint="Optional · a link to the research project."
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
              <Button type="button" onClick={() => setSampleDialog(false)}>
                Cancel
              </Button>
              <Button variant="primary">Save sample title</Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}
      <h3>Contrast checks</h3>
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
                {ratio.toFixed(2)}:1 · {ratio >= 4.5 ? "Pass" : "Review"}
              </dd>
            </div>
          );
        })}
      </dl>
      <HelpText>
        Also review keyboard focus, 150% UI scale, reduced motion and forced
        colors. Automated contrast checks do not replace a visual review.
      </HelpText>
    </section>
  );
}
