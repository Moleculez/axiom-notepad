"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { useId, useState, type CSSProperties } from "react";
import { FileText, MoreHorizontal, Plus } from "lucide-react";
import {
  interfaceStyles,
  interfaceStyleVariables,
  type InterfaceStyleId,
} from "@axiom/shared/interface-styles";
import {
  ActionRow,
  Button,
  Checkbox,
  Field,
  HelpText,
  NativeSelect,
  SearchField,
  Slider,
  Switch,
  TextInput,
} from "./controls";

/** Same real controls, palette and typography under each complete recipe.
 * Local state cannot save preferences, change files or issue network requests. */
export default function InterfaceStyleGallery({
  id,
  value,
  onSelect,
}: {
  id?: string;
  value: InterfaceStyleId;
  onSelect: (style: InterfaceStyleId) => void;
}) {
  useInterfaceLocale();
  return (
    <section
      className="interface-style-gallery"
      id={id}
      aria-label={uiText("Interface style comparison")}
    >
      <HelpText>
        <I18nText id="Identical colors and fonts reveal the differences in each system. Try fields, selection and controls; these samples never save real data." />
      </HelpText>
      <div className="interface-style-gallery-grid">
        {interfaceStyles.map((style) => (
          <InterfaceStyleSample
            key={style.id}
            styleId={style.id}
            name={style.name}
            description={style.description}
            selected={value === style.id}
            onSelect={() => onSelect(style.id)}
          />
        ))}
      </div>
    </section>
  );
}

function InterfaceStyleSample({
  styleId,
  name,
  description,
  selected,
  onSelect,
}: {
  styleId: InterfaceStyleId;
  name: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  useInterfaceLocale();
  const [query, setQuery] = useState("Field notes");
  const [density, setDensity] = useState("balanced");
  const [included, setIncluded] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [overlay, setOverlay] = useState(false);
  const [tab, setTab] = useState("Details");
  const tabId = useId();
  const tabs = ["Details", "Activity"];
  return (
    <article
      className="interface-gallery-card interface-style-scope"
      data-interface-style={styleId}
      style={interfaceStyleVariables(styleId) as CSSProperties}
      aria-label={`${name} controls`}
    >
      <header className="interface-gallery-card-heading interface-panel-band">
        <h5>{name}</h5>
        <HelpText>{description}</HelpText>
      </header>
      <div className="interface-gallery-card-body">
        <ActionRow
          size="compact"
          role="tablist"
          aria-label={`${name} sample tabs`}
        >
          {tabs.map((label, index) => (
            <Button
              key={label}
              type="button"
              role="tab"
              className="interface-page-tab"
              aria-selected={tab === label}
              id={`${tabId}-${label}`}
              aria-controls={`${tabId}-panel`}
              tabIndex={tab === label ? 0 : -1}
              onClick={() => setTab(label)}
              onKeyDown={(event) => {
                const target =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index - 1 + tabs.length) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : undefined;
                if (target === undefined) return;
                event.preventDefault();
                setTab(tabs[target]);
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  [target]?.focus();
              }}
            >
              {label}
            </Button>
          ))}
        </ActionRow>
        <HelpText
          role="tabpanel"
          id={`${tabId}-panel`}
          aria-labelledby={`${tabId}-${tab}`}
        >
          {tab === "Details"
            ? uiText("Fields and control states")
            : uiText("Local preview activity · no real operations")}
        </HelpText>
        <Field label={uiText("Find evidence")}>
          <SearchField
            aria-label={`${name} sample search`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            clearLabel={`Clear ${name} sample search`}
          />
        </Field>
        <Field label={uiText("View density")}>
          <NativeSelect
            aria-label={`${name} sample density`}
            value={density}
            onChange={(event) => setDensity(event.target.value)}
          >
            <option value="balanced">
              <I18nText id="Balanced" />
            </option>
            <option value="compact">
              <I18nText id="Compact" />
            </option>
          </NativeSelect>
        </Field>
        <label
          className={`interface-gallery-row interface-navigation-row ${included ? "is-selected" : ""}`}
          data-selected={included}
        >
          <span className="interface-gallery-leading">
            <Checkbox
              aria-label={`${name} include field notes`}
              checked={included}
              onChange={(event) => setIncluded(event.target.checked)}
            />
            <FileText aria-hidden="true" />
          </span>
          <span>
            <I18nText id="Field notes — α, β and ∇" />
          </span>
        </label>
        <label className="interface-gallery-setting">
          <span>
            <I18nText id="Reading guides" />
          </span>
          <Switch
            aria-label={`${name} sample reading guides`}
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
        </label>
        <Field label={`Reading scale · ${zoom}%`}>
          <Slider
            aria-label={`${name} sample reading scale`}
            aria-valuetext={`${zoom}%`}
            value={zoom}
            min={50}
            max={150}
            step={10}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </Field>
        <Field label={uiText("Read-only title")}>
          <TextInput value="Research notes" readOnly />
        </Field>
        <Field label={uiText("Validation state")} error="A title is required.">
          <TextInput defaultValue="" placeholder={uiText("Enter a title…")} />
        </Field>
        <ActionRow size="compact">
          <Button
            type="button"
            variant="primary"
            onClick={() => setIncluded((current) => !current)}
          >
            <Plus aria-hidden="true" />
            <I18nText id="Example action" />
          </Button>
          <Button type="button" disabled>
            <I18nText id="Disabled" />
          </Button>
          <Button type="button" pending>
            <I18nText id="Pending" />
          </Button>
        </ActionRow>
        <Button
          type="button"
          aria-expanded={overlay}
          onClick={() => setOverlay((current) => !current)}
        >
          <MoreHorizontal aria-hidden="true" />
          <I18nText id="Preview overlay" />
        </Button>
        {overlay && (
          <div
            className="interface-gallery-overlay interface-overlay"
            role="group"
            aria-label={`${name} sample overlay`}
          >
            <HelpText>
              <I18nText id="Overlay sample" />
            </HelpText>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIncluded((current) => !current)}
            >
              <I18nText id="Mark sample reviewed" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOverlay(false)}
            >
              <I18nText id="Close sample overlay" />
            </Button>
          </div>
        )}
        <Button type="button" aria-pressed={selected} onClick={onSelect}>
          {selected ? `${name} selected` : `Use ${name}`}
        </Button>
      </div>
    </article>
  );
}
