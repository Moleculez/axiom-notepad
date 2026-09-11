"use client";
import { useEffect, useId, useState } from "react";
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
}) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState("");
  const id = useId();
  useEffect(() => {
    setText(String(value));
    setError("");
    onInvalid(false);
  }, [value]);
  useEffect(() => () => onInvalid(false), []);
  const valid = (text: string) =>
    text.trim() !== "" &&
    Number.isFinite(Number(text)) &&
    Number(text) >= min &&
    Number(text) <= max;
  const commit = () => {
    if (!valid(text)) {
      setError(`Use a number from ${min} to ${max}${unit ? ` ${unit}` : ""}.`);
      return;
    }
    const n = Math.round(Number(text) / step) * step;
    onChange(Number(Math.min(max, Math.max(min, n)).toFixed(6)));
    setError("");
    onInvalid(false);
  };
  return (
    <div className="setting-control preference-number">
      <div className="preference-number-heading">
        <label htmlFor={id}>{label}</label>
        <span className="setting-number-value">
          <input
            id={id}
            type="number"
            aria-label={`${label} value`}
            min={min}
            max={max}
            step={step}
            value={text}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setText(event.target.value);
              setError("");
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
                setError("");
                onInvalid(false);
              }
            }}
          />
          <span>{unit}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={`Reset ${label}`}
            onClick={() => {
              reset();
              setText(String(value));
              setError("");
              onInvalid(false);
            }}
          >
            <RotateCcw size={14} />
          </button>
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {error && (
        <small id={`${id}-error`} className="form-error" role="alert">
          {error}
        </small>
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
      <label htmlFor={id}>{label}</label>
      <div className="preference-color-fields">
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setText(event.target.value);
            setError("");
            onInvalid(false);
          }}
        />
        <input
          id={id}
          type="text"
          aria-label={`${label} color value`}
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
        <button
          type="button"
          className="icon-button"
          aria-label={`Copy ${label} color`}
          title={copied ? "Copied" : "Copy color"}
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
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Reset ${label} color`}
          onClick={() => {
            reset();
            setText(value);
            setError("");
            onInvalid(false);
          }}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      {copied && <small role="status">Copied {value}</small>}
      {error && (
        <small id={`${id}-error`} className="form-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
