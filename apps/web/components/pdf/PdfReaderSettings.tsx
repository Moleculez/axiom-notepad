"use client";
import type { Preferences } from "@axiom/shared/appearance";
export default function PdfReaderSettings({
  value,
  onChange,
}: {
  value: Preferences["pdfReader"];
  onChange: (value: Preferences["pdfReader"]) => void;
}) {
  return (
    <section className="settings-card pdf-reader-settings">
      <h4>PDF research reader</h4>
      <p className="settings-note">
        Defaults for new reading sessions. Original PDF colors are preserved
        except when you explicitly choose warm paper. Exports retain original
        colors.
      </p>
      <label className="settings-row">
        <span>Page layout</span>
        <select
          aria-label="Default PDF page layout"
          value={value.layout}
          onChange={(e) =>
            onChange({
              ...value,
              layout: e.target.value as typeof value.layout,
            })
          }
        >
          <option value="continuous">Continuous</option>
          <option value="single">Single page</option>
          <option value="facing">Facing pages</option>
        </select>
      </label>
      <label className="settings-row">
        <span>Paper appearance</span>
        <select
          aria-label="Default PDF paper appearance"
          value={value.theme}
          onChange={(e) =>
            onChange({ ...value, theme: e.target.value as typeof value.theme })
          }
        >
          <option value="original">Original</option>
          <option value="warm">Warm paper</option>
          <option value="graphite">Graphite surround</option>
          <option value="contrast">High contrast surround</option>
        </select>
      </label>
      <label className="settings-row">
        <span>Show reading navigator</span>
        <input
          type="checkbox"
          aria-label="Show PDF reading navigator by default"
          checked={value.navigator}
          onChange={(e) => onChange({ ...value, navigator: e.target.checked })}
        />
      </label>
      <label className="settings-row">
        <span>Navigator width · {value.navigatorWidth}px</span>
        <input
          type="range"
          aria-label="Default PDF navigator width"
          min={200}
          max={440}
          step={10}
          value={value.navigatorWidth}
          onChange={(e) =>
            onChange({ ...value, navigatorWidth: Number(e.target.value) })
          }
        />
      </label>
    </section>
  );
}
