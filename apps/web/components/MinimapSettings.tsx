"use client";
import {
  minimapDefaults,
  type MinimapPreferences,
} from "@axiom/shared/minimap";
import { NumberPreference } from "./PreferenceControls";

export default function MinimapSettings({
  value,
  onChange,
  onInvalid,
}: {
  value: MinimapPreferences;
  onChange: (value: MinimapPreferences) => void;
  onInvalid: (invalid: boolean) => void;
}) {
  const change = <K extends keyof MinimapPreferences>(
    key: K,
    next: MinimapPreferences[K],
  ) => onChange({ ...value, [key]: next });
  const toggle = (
    key:
      | "enabled"
      | "write"
      | "source"
      | "read"
      | "headings"
      | "preview"
      | "search"
      | "selection"
      | "collaborators",
    label: string,
    hint?: string,
  ) => (
    <label className="setting-control setting-toggle" key={key}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        checked={value[key]}
        onChange={(e) => change(key, e.target.checked)}
      />
    </label>
  );
  const select = <K extends "side" | "size" | "rendering" | "slider">(
    key: K,
    label: string,
    choices: [MinimapPreferences[K], string][],
  ) => (
    <label className="setting-control">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value[key]}
        onChange={(e) => change(key, e.target.value as MinimapPreferences[K])}
      >
        {choices.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="settings-card minimap-settings">
      <h4>Document minimap</h4>
      <p className="settings-note">
        A miniature of your current view. Click or drag to scroll without moving
        your editing cursor. Reading marks share its overview lane.
      </p>
      {toggle("enabled", "Show document minimap")}
      <fieldset disabled={!value.enabled}>
        <legend>Show in</legend>
        <div className="minimap-mode-options">
          {toggle("write", "Write")}
          {toggle("source", "Source")}
          {toggle("read", "Read")}
        </div>
        {select("side", "Minimap position", [
          ["right", "Right"],
          ["left", "Left"],
        ])}
        {select("size", "Minimap sizing", [
          ["fit", "Fit document"],
          ["proportional", "Proportional"],
          ["fill", "Fill height"],
        ])}
        {select("rendering", "Minimap rendering", [
          ["text", "Miniature text"],
          ["blocks", "Color blocks"],
        ])}
        <NumberPreference
          key={String(value.enabled)}
          label="Minimap width"
          value={value.width}
          min={80}
          max={200}
          step={1}
          unit="px"
          onChange={(width) => change("width", width)}
          reset={() => change("width", minimapDefaults.width)}
          onInvalid={onInvalid}
        />
        <details className="minimap-advanced">
          <summary>Indicators & interaction</summary>
          {select("slider", "Viewport highlight", [
            ["hover", "On hover or focus"],
            ["always", "Always visible"],
          ])}
          {toggle(
            "headings",
            "Show heading labels",
            "Top-level sections stay legible when there is enough space.",
          )}
          {toggle(
            "preview",
            "Show minimap hover previews",
            "Small text previews only; no images or remote content are loaded.",
          )}
          {toggle("search", "Show search results in minimap")}
          {toggle("selection", "Show editing position and selection")}
          {toggle(
            "collaborators",
            "Show collaborator positions",
            "Uses the presence already visible in this document.",
          )}
        </details>
        <p className="settings-note">
          Narrow document panes use a compact overview. Bookmark and annotation
          visibility follows “Show reading marks overview” above.
        </p>
      </fieldset>
    </section>
  );
}
