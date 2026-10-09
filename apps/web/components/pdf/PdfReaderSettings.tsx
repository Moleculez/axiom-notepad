"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Slider, Switch, NativeSelect } from "../ui/controls";
import type { Preferences } from "@axiom/shared/appearance";
export default function PdfReaderSettings({
  value,
  onChange,
}: {
  value: Preferences["pdfReader"];
  onChange: (value: Preferences["pdfReader"]) => void;
}) {
  const { t } = useInterfaceLocale();
  return (
    <section className="settings-card pdf-reader-settings">
      <h4>
        <I18nText id="PDF research reader" />
      </h4>
      <p className="settings-note">
        <I18nText id="Defaults for new reading sessions. Original PDF colors are preserved except when you explicitly choose warm paper. Exports retain original colors." />
      </p>
      <label className="settings-row">
        <span>
          <I18nText id="Page layout" />
        </span>
        <NativeSelect
          aria-label={uiText("Default PDF page layout")}
          value={value.layout}
          onChange={(e) =>
            onChange({
              ...value,
              layout: e.target.value as typeof value.layout,
            })
          }
        >
          <option value="continuous">
            <I18nText id="Continuous" />
          </option>
          <option value="single">
            <I18nText id="Single page" />
          </option>
          <option value="facing">
            <I18nText id="Facing pages" />
          </option>
        </NativeSelect>
      </label>
      <label className="settings-row">
        <span>
          <I18nText id="Paper appearance" />
        </span>
        <NativeSelect
          aria-label={uiText("Default PDF paper appearance")}
          value={value.theme}
          onChange={(e) =>
            onChange({ ...value, theme: e.target.value as typeof value.theme })
          }
        >
          <option value="original">
            <I18nText id="Original" />
          </option>
          <option value="warm">
            <I18nText id="Warm paper" />
          </option>
          <option value="graphite">
            <I18nText id="Graphite surround" />
          </option>
          <option value="contrast">
            <I18nText id="High contrast surround" />
          </option>
        </NativeSelect>
      </label>
      <label className="settings-row">
        <span>
          <I18nText id="Show reading navigator" />
        </span>
        <Switch
          aria-label={uiText("Show PDF reading navigator by default")}
          checked={value.navigator}
          onChange={(e) => onChange({ ...value, navigator: e.target.checked })}
        />
      </label>
      <label className="settings-row">
        <span>
          <I18nText
            id="Navigator width · {width, number} px"
            values={{ width: value.navigatorWidth }}
          />
        </span>
        <Slider
          aria-label={uiText("Default PDF navigator width")}
          aria-valuetext={t("{count, number} pixels", {
            count: value.navigatorWidth,
          })}
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
