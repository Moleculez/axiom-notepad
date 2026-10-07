"use client";
import { useId, useState, type CSSProperties } from "react";
import {
  Atom,
  BookOpen,
  Grid2X2,
  Layers2,
  PanelTop,
  RadioTower,
  ScanLine,
  Scissors,
  Search,
  type LucideIcon,
} from "lucide-react";
import {
  interfaceStyles,
  interfaceStyleVariables,
  type InterfaceStyleId,
} from "@axiom/shared/interface-styles";
import { Button, HelpText, Radio } from "./controls";
import InterfaceStyleGallery from "./InterfaceStyleGallery";

const styleIcons: Record<InterfaceStyleId, LucideIcon> = {
  axiom: Atom,
  contour: Layers2,
  vector: ScanLine,
  folio: BookOpen,
  harbor: PanelTop,
  signal: RadioTower,
  gridwork: Grid2X2,
  cutline: Scissors,
};

/** One shared picker in settings and the browser-local showcase. Miniatures are
 * noninteractive: only the native radio owns selection and keyboard behavior. */
export default function InterfaceStylePicker({
  value,
  onChange,
  disabled = false,
  comparing: controlledComparing,
  onComparingChange,
}: {
  value: InterfaceStyleId;
  onChange: (style: InterfaceStyleId) => void;
  disabled?: boolean;
  /** Hosts can pause their mounted preview while comparison owns the workbench. */
  comparing?: boolean;
  onComparingChange?: (comparing: boolean) => void;
}) {
  const name = useId();
  const [localComparing, setLocalComparing] = useState(false);
  const comparing = controlledComparing ?? localComparing;
  const galleryId = `${name}-comparison`;
  return (
    <fieldset className="interface-style-picker" disabled={disabled}>
      <legend>Interface style</legend>
      <HelpText>
        Eight visual systems for controls, navigation and overlays. Colors,
        fonts and document typography remain independent.
      </HelpText>
      <div className="interface-style-options">
        {interfaceStyles.map((style) => {
          const Icon = styleIcons[style.id];
          return (
            <label className="interface-style-option" key={style.id}>
              <span className="interface-style-option-title">
                <Radio
                  name={name}
                  value={style.id}
                  checked={value === style.id}
                  onChange={() => onChange(style.id)}
                  aria-label={style.name}
                />
                <Icon aria-hidden="true" />
                <strong>{style.name}</strong>
              </span>
              <span
                className="interface-style-miniature interface-style-scope"
                data-interface-style={style.id}
                style={interfaceStyleVariables(style.id) as CSSProperties}
                aria-hidden="true"
              >
                <span className="interface-miniature-chrome interface-panel-band">
                  <span>Research</span>
                  <span className="interface-miniature-tabs">
                    <span
                      className="interface-page-tab is-selected"
                      aria-selected="true"
                    >
                      Files
                    </span>
                    <span className="interface-page-tab">Plan</span>
                  </span>
                </span>
                <span className="interface-miniature-body">
                  <span className="interface-miniature-navigation interface-chrome">
                    <span
                      className="interface-navigation-row is-selected"
                      data-selected="true"
                    >
                      Notes
                    </span>
                    <span className="interface-navigation-row">Sources</span>
                  </span>
                  <span className="interface-miniature-content">
                    <span className="interface-miniature-field">
                      <Search />
                      <span>Find evidence</span>
                    </span>
                    <span
                      className="interface-miniature-row interface-navigation-row is-selected"
                      data-selected="true"
                    >
                      <span className="interface-miniature-check">✓</span>
                      <span>Field notes</span>
                    </span>
                    <span className="interface-miniature-actions">
                      <span className="interface-miniature-primary">
                        Add note
                      </span>
                      <span className="interface-miniature-action">Share</span>
                    </span>
                  </span>
                </span>
              </span>
              <span className="interface-style-option-description">
                {style.description}
              </span>
            </label>
          );
        })}
      </div>
      <Button
        type="button"
        aria-expanded={comparing}
        aria-controls={galleryId}
        onClick={() => {
          if (controlledComparing === undefined) setLocalComparing(!comparing);
          onComparingChange?.(!comparing);
        }}
      >
        <Layers2 aria-hidden="true" />
        {comparing ? "Hide comparison" : "Compare all styles"}
      </Button>
      {comparing && (
        <InterfaceStyleGallery
          id={galleryId}
          value={value}
          onSelect={onChange}
        />
      )}
    </fieldset>
  );
}
