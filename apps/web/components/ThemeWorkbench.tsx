"use client";
import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  FileText,
  MoreHorizontal,
  Plus,
  Trash2,
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
    [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!active) setMenu(false);
  }, [active]);
  const p = paletteFor(preferences, dark);
  return (
    <section className="theme-workbench" aria-label="Theme workbench">
      <p className="ws-note">
        Try everyday controls with your current draft. Switch color mode to
        review both palettes.
      </p>
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
      <label className="theme-workbench-input">
        Search specimen
        <input
          aria-label="Specimen search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="A long research project name…"
        />
      </label>
      <div className="theme-workbench-actions">
        <button
          className="button primary"
          onClick={() => setSelected(!selected)}
        >
          <Plus size={15} />
          Select item
        </button>
        <button className="button secondary" onClick={() => setQuery("")}>
          Clear
        </button>
        <button className="button secondary" disabled>
          Disabled
        </button>
      </div>
      <div className={`theme-workbench-row ${selected ? "is-selected" : ""}`}>
        <input
          type="checkbox"
          aria-label="Select specimen paper"
          checked={selected}
          onChange={(e) => setSelected(e.target.checked)}
        />
        <FileText size={20} />
        <div>
          <strong>Research notes — α, β, and ∇</strong>
          <small>Markdown · sample only</small>
        </div>
        <button
          className="icon-button"
          aria-label="Specimen actions"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <MoreHorizontal size={17} />
        </button>
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
      <p className="theme-workbench-error">
        Error example: keep the draft and explain how to retry.
      </p>
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
      <p className="ws-note">
        Also review keyboard focus, 150% UI scale, reduced motion and forced
        colors. Automated contrast checks do not replace a visual review.
      </p>
    </section>
  );
}
