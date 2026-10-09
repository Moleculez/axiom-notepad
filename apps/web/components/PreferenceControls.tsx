"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";
import { t, currentLocale } from "@axiom/i18n/client";
import { formatNumber } from "@axiom/i18n";

import { HelpText, IconButton, Slider, TextInput } from "./ui/controls";
import { useEffect, useId, useRef, useState } from "react";
import { Copy, RotateCcw } from "lucide-react";
import { parseThemeColor } from "@axiom/shared/appearance";

export function NumberPreference({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  reset,
  onInvalid,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
  reset: () => void;
  onInvalid: (invalid: boolean) => void;
  disabled?: boolean;
}) {
  useInterfaceLocale();
  const [text, setText] = useState(String(value));
  const [sliderValue, setSliderValue] = useState(value);
  const [error, setError] = useState(false);
  const id = useId();
  const frame = useRef<number | null>(null),
    queued = useRef<number | null>(null),
    change = useRef(onChange);
  change.current = onChange;
  const flush = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const next = queued.current;
    queued.current = null;
    if (next !== null) change.current(next);
  };
  const slide = (next: number) => {
    // Native feedback is immediate; expensive document previews update once per frame.
    setSliderValue(next);
    setText(String(next));
    setError(false);
    onInvalid(false);
    queued.current = next;
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  };
  useEffect(() => {
    if (queued.current !== null) return;
    setText(String(value));
    setSliderValue(value);
    setError(false);
    onInvalid(false);
  }, [value]);
  useEffect(
    () => () => {
      // A category switch must not lose the final drag value.
      flush();
      onInvalid(false);
    },
    [],
  );
  const valid = (text: string) =>
    text.trim() !== "" &&
    Number.isFinite(Number(text)) &&
    Number(text) >= min &&
    Number(text) <= max;
  const commit = () => {
    if (!valid(text)) {
      setError(true);
      return;
    }
    flush();
    const n = min + Math.round((Number(text) - min) / step) * step;
    const next = Number(Math.min(max, Math.max(min, n)).toFixed(6));
    onChange(next);
    setSliderValue(next);
    setText(String(next));
    setError(false);
    onInvalid(false);
  };
  return (
    <div className="setting-control preference-number">
      <div className="preference-number-heading">
        <label htmlFor={id}>{uiText(label)}</label>
        <span className="setting-number-value">
          <TextInput
            id={id}
            type="number"
            disabled={disabled}
            aria-label={t("{label} value", { label: uiText(label) })}
            min={min}
            max={max}
            step={step}
            value={text}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setError(false);
              onInvalid(!valid(event.target.value));
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setText(String(value));
                setError(false);
                onInvalid(false);
              }
            }}
          />
          <span>{unit}</span>
          <IconButton
            type="button"
            disabled={disabled}
            className="icon-button"
            aria-label={t("Reset {label}", { label: uiText(label) })}
            onClick={() => {
              if (frame.current !== null) cancelAnimationFrame(frame.current);
              frame.current = null;
              queued.current = null;
              reset();
              setText(String(value));
              setError(false);
              onInvalid(false);
            }}
          >
            <RotateCcw size={14} />
          </IconButton>
        </span>
      </div>
      <Slider
        aria-label={uiText(label)}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        aria-valuetext={`${formatNumber(currentLocale(), sliderValue)}${unit ? ` ${unit}` : ""}`}
        value={sliderValue}
        onChange={(event) => slide(Number(event.target.value))}
        onPointerUp={flush}
        onKeyUp={flush}
        onBlur={flush}
      />
      {error && (
        <HelpText
          as="small"
          id={`${id}-error`}
          className="form-error"
          role="alert"
        >
          {t("Use a number from {min, number} to {max, number}{unit}.", {
            min,
            max,
            unit: unit ? ` ${unit}` : "",
          })}
        </HelpText>
      )}
    </div>
  );
}

export function ColorPreference({
  label,
  value,
  onChange,
  reset,
  onInvalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  reset: () => void;
  onInvalid: (invalid: boolean) => void;
}) {
  useInterfaceLocale();
  const id = useId();
  const [text, setText] = useState(value);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setText(value);
    setError("");
    onInvalid(false);
  }, [value]);
  useEffect(() => () => onInvalid(false), []);
  const commit = () => {
    const color = parseThemeColor(text);
    if (!color) {
      setError(
        "Enter #RRGGBB, #RGB or rgb(0, 0, 0). Transparency is not supported.",
      );
      return;
    }
    onChange(color);
    setText(color);
    setError("");
    onInvalid(false);
  };
  return (
    <div className="preference-color">
      <label htmlFor={id}>{uiText(label)}</label>
      <div className="preference-color-fields">
        <input
          type="color"
          aria-label={t("{label} color picker", { label: uiText(label) })}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setText(event.target.value);
            setError("");
            onInvalid(false);
          }}
        />
        <TextInput
          id={id}
          type="text"
          aria-label={t("{label} color value", { label: uiText(label) })}
          dir="ltr"
          value={text}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setError("");
            setCopied(false);
            onInvalid(!parseThemeColor(event.target.value));
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setText(value);
              setError("");
              onInvalid(false);
            }
          }}
        />
        <IconButton
          type="button"
          className="icon-button"
          aria-label={t("Copy {label} color", { label: uiText(label) })}
          title={copied ? uiText("Copied") : uiText("Copy color")}
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => setCopied(true))
              .catch(() =>
                setError(
                  "Copy unavailable. Select the color value and copy it manually.",
                ),
              );
          }}
        >
          <Copy size={14} />
        </IconButton>
        <IconButton
          type="button"
          className="icon-button"
          aria-label={t("Reset {label} color", { label: uiText(label) })}
          onClick={() => {
            reset();
            setText(value);
            setError("");
            onInvalid(false);
          }}
        >
          <RotateCcw size={14} />
        </IconButton>
      </div>
      {copied && (
        <small role="status">
          <I18nText id="Copied" /> {value}
        </small>
      )}
      {error && (
        <HelpText
          as="small"
          id={`${id}-error`}
          className="form-error"
          role="alert"
        >
          {uiText(error)}
        </HelpText>
      )}
    </div>
  );
}
