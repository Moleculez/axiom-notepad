"use client";
import {
  Button,
  Checkbox,
  HelpText,
  IconButton,
  Slider,
  NativeSelect,
  TextInput,
  TextArea,
} from "../ui/controls";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from "lucide-react";
import {
  siteSectionSchema,
  siteTemplates,
  type SiteConfig,
  type SiteDesign,
} from "@axiom/shared/sites";
import { siteThemes } from "@axiom/shared/site-design";
import SiteDesignPreview from "./SiteDesignPreview";

export default function SiteDesigner({
  config,
  onChange,
  disabled,
  spaceId,
}: {
  config: SiteConfig;
  onChange: (config: SiteConfig) => void;
  disabled: boolean;
  spaceId: string;
}) {
  const [selected, setSelected] = useState(config.design.sections[0]?.id ?? "");
  const design = config.design,
    sections = design.sections,
    section = sections.find((s) => s.id === selected);
  const set = (patch: Partial<SiteDesign>) =>
    onChange({ ...config, design: { ...design, ...patch } });
  const edit = (patch: Partial<NonNullable<typeof section>>) =>
    set({
      sections: sections.map((s) =>
        s.id === selected ? { ...s, ...patch } : s,
      ),
    });
  const move = (index: number, direction: number) => {
    const next = [...sections];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    set({ sections: next });
  };
  return (
    <div className="website-designer">
      <div className="website-design-controls">
        <section className="settings-card">
          <h3>Visual language</h3>
          <p>
            Choose a complete reading style. Layout, typography and reading
            controls remain independently adjustable.
          </p>
          <fieldset disabled={disabled} className="website-theme-gallery">
            {siteThemes.map((theme) => (
              <button
                key={theme.id}
                className={`website-theme-card theme-${theme.id}`}
                aria-pressed={design.theme === theme.id}
                onClick={() => set({ theme: theme.id, font: "theme" })}
              >
                <span className="website-theme-sample" aria-hidden="true">
                  <b>Aa</b>
                  <i />
                  <i />
                  <i />
                </span>
                <strong>{theme.name}</strong>
                <small>{theme.description}</small>
              </button>
            ))}
          </fieldset>
        </section>
        <section className="settings-card">
          <h3>Choose a layout</h3>
          <p>
            Public site themes are independent of your workspace appearance.
          </p>
          <fieldset disabled={disabled}>
            <div className="website-template-grid">
              {siteTemplates.map(([id, name, description]) => (
                <button
                  key={id}
                  className={`website-template is-${id}`}
                  aria-pressed={design.template === id}
                  onClick={() => set({ template: id })}
                >
                  <span aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <strong>{name}</strong>
                  <small>{description}</small>
                </button>
              ))}
            </div>
            <div className="website-fields">
              <label>
                Color mode
                <NativeSelect
                  value={design.mode}
                  onChange={(e) =>
                    set({ mode: e.target.value as SiteDesign["mode"] })
                  }
                >
                  <option value="system">Follow visitor’s system</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </NativeSelect>
              </label>
              <label>
                Reading typeface
                <NativeSelect
                  value={design.font}
                  onChange={(e) =>
                    set({ font: e.target.value as SiteDesign["font"] })
                  }
                >
                  <option value="theme">Theme default</option>
                  <option value="latin-modern">Latin Modern · LaTeX</option>
                  <option value="serif">Source Serif · editorial</option>
                  <option value="sans">Inter · contemporary</option>
                </NativeSelect>
              </label>
              <label>
                Accent
                <span className="website-color">
                  <input
                    type="color"
                    aria-label="Website accent color"
                    value={design.accent}
                    onChange={(e) => set({ accent: e.target.value })}
                  />
                  <code>{design.accent}</code>
                </span>
              </label>
              <label>
                Spacing
                <NativeSelect
                  value={design.spacing}
                  onChange={(e) =>
                    set({ spacing: e.target.value as SiteDesign["spacing"] })
                  }
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </NativeSelect>
              </label>
            </div>
          </fieldset>
        </section>
        <section className="settings-card">
          <h3>Reading & discovery</h3>
          <p>
            Quiet navigation, comfortable line lengths and a clear research
            record.
          </p>
          <fieldset disabled={disabled}>
            <div className="website-fields">
              <label>
                Text size · {design.reading.fontSize}px
                <Slider
                  aria-label="Website reading font size"
                  aria-valuetext={`${design.reading.fontSize} pixels`}
                  min="16"
                  max="24"
                  value={design.reading.fontSize}
                  onChange={(e) =>
                    set({
                      reading: {
                        ...design.reading,
                        fontSize: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                Line height · {design.reading.lineHeight}
                <Slider
                  aria-label="Website reading line height"
                  aria-valuetext={`${design.reading.lineHeight} times the font size`}
                  min="1.4"
                  max="2.2"
                  step="0.05"
                  value={design.reading.lineHeight}
                  onChange={(e) =>
                    set({
                      reading: {
                        ...design.reading,
                        lineHeight: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                Line length · {design.reading.measure} characters
                <Slider
                  aria-label="Website reading measure"
                  aria-valuetext={`${design.reading.measure} characters`}
                  min="55"
                  max="90"
                  value={design.reading.measure}
                  onChange={(e) =>
                    set({
                      reading: {
                        ...design.reading,
                        measure: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            </div>
            {(
              [
                ["toc", "Floating table of contents"],
                ["sectionNumbers", "Numbered sections"],
                ["wordCount", "Article word count"],
                ["readingTime", "Estimated reading time"],
                ["progress", "Reading progress"],
              ] as const
            ).map(([key, label]) => (
              <label className="website-check" key={key}>
                <Checkbox
                  checked={design.reading[key]}
                  onChange={(e) =>
                    set({
                      reading: { ...design.reading, [key]: e.target.checked },
                    })
                  }
                />
                {label}
              </label>
            ))}
            <label>
              Archive layout
              <NativeSelect
                value={design.archive.style}
                onChange={(e) =>
                  set({
                    archive: {
                      ...design.archive,
                      style: e.target.value as "timeline" | "list",
                    },
                  })
                }
              >
                <option value="timeline">Timeline · year and month</option>
                <option value="list">Compact chronological list</option>
              </NativeSelect>
            </label>
            <label className="website-check">
              <Checkbox
                checked={design.archive.includePages}
                onChange={(e) =>
                  set({
                    archive: {
                      ...design.archive,
                      includePages: e.target.checked,
                    },
                  })
                }
              />
              Include ordinary pages in the archive by default
            </label>
          </fieldset>
        </section>
        <section className="settings-card">
          <div className="website-section-heading">
            <div>
              <h3>Homepage sections</h3>
              <p>Arrange, duplicate, hide or edit each section.</p>
            </div>
            <IconButton
              className="icon-button"
              title="Add section"
              aria-label="Add homepage section"
              disabled={disabled || sections.length >= 30}
              onClick={() => {
                const added = siteSectionSchema.parse({
                  id: crypto.randomUUID(),
                  kind: "markdown",
                  title: "New section",
                });
                set({ sections: [...sections, added] });
                setSelected(added.id);
              }}
            >
              <Plus size={17} />
            </IconButton>
          </div>
          <div className="website-section-list">
            {sections.map((s, i) => (
              <div key={s.id} className={selected === s.id ? "selected" : ""}>
                <button
                  className="website-section-select"
                  aria-pressed={selected === s.id}
                  onClick={() => setSelected(s.id)}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <strong>{s.title || s.kind}</strong>
                  {s.hidden && <EyeOff size={13} />}
                </button>
                <div>
                  <IconButton
                    className="icon-button"
                    title="Move section up"
                    aria-label={`Move ${s.title} up`}
                    disabled={disabled || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton
                    className="icon-button"
                    title="Move section down"
                    aria-label={`Move ${s.title} down`}
                    disabled={disabled || i === sections.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={14} />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
          {section && (
            <fieldset className="website-section-fields" disabled={disabled}>
              <label>
                Section type
                <NativeSelect
                  value={section.kind}
                  onChange={(e) =>
                    edit({ kind: e.target.value as typeof section.kind })
                  }
                >
                  {siteSectionSchema.shape.kind.options.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </NativeSelect>
              </label>
              <label>
                Heading
                <TextInput
                  maxLength={200}
                  value={section.title}
                  onChange={(e) => edit({ title: e.target.value })}
                />
              </label>
              <label>
                Text (Markdown)
                <TextArea
                  rows={5}
                  maxLength={20000}
                  value={section.text}
                  onChange={(e) => edit({ text: e.target.value })}
                />
              </label>
              {!["intro", "people", "markdown", "research"].includes(
                section.kind,
              ) && (
                <details>
                  <summary>Choose specific pages</summary>
                  <HelpText>
                    Leave unselected to use this section’s automatic collection.
                  </HelpText>
                  {config.entries.map((e) => (
                    <label key={e.id} className="website-check">
                      <Checkbox
                        checked={section.entryIds.includes(e.id)}
                        onChange={(event) =>
                          edit({
                            entryIds: event.target.checked
                              ? [...section.entryIds, e.id]
                              : section.entryIds.filter((id) => id !== e.id),
                          })
                        }
                      />
                      {e.title}
                    </label>
                  ))}
                </details>
              )}
              <div className="website-inline-actions">
                <Button
                  className="button secondary"
                  onClick={() => edit({ hidden: !section.hidden })}
                >
                  {section.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                  {section.hidden ? "Show section" : "Hide section"}
                </Button>
                <IconButton
                  className="icon-button"
                  title="Duplicate section"
                  aria-label="Duplicate section"
                  disabled={sections.length >= 30}
                  onClick={() => {
                    const copy = {
                      ...section,
                      id: crypto.randomUUID(),
                      title: section.title + " copy",
                    };
                    set({ sections: [...sections, copy] });
                    setSelected(copy.id);
                  }}
                >
                  <Copy size={15} />
                </IconButton>
                <IconButton
                  className="icon-button"
                  title="Remove section"
                  aria-label="Remove section"
                  onClick={() => {
                    set({
                      sections: sections.filter((s) => s.id !== selected),
                    });
                    setSelected(
                      sections.find((s) => s.id !== selected)?.id ?? "",
                    );
                  }}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
            </fieldset>
          )}
        </section>
      </div>
      <SiteDesignPreview spaceId={spaceId} config={config} />
    </div>
  );
}
