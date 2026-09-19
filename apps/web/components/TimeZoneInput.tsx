"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Globe2 } from "lucide-react";
import {
  filterTimeZones,
  isTimeZone,
  timeZoneOffset,
  timeZoneOptions,
} from "@axiom/shared/timezones";

/** Editable IANA combobox; works inside forms, disabled fieldsets and dialogs. */
export default function TimeZoneInput({
  value,
  onChange,
  required = false,
  disabled = false,
  "aria-label": label = "Time zone",
}: {
  value: string;
  onChange: (zone: string) => void;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    popup = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false),
    [above, setAbove] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [touched, setTouched] = useState(false);
  const zones = useMemo(() => timeZoneOptions(value), [value]),
    matches = filterTimeZones(zones, query),
    options = matches.slice(0, 80);
  const valid = !value ? !required : isTimeZone(value);
  useEffect(() => {
    input.current?.setCustomValidity(
      valid
        ? ""
        : "Choose a valid IANA time zone, such as Asia/Shanghai or UTC.",
    );
  }, [valid]);
  useEffect(() => {
    if (shown)
      popup.current
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [active, shown]);
  const show = () => {
    const bounds = input.current?.getBoundingClientRect();
    setAbove(
      !!bounds && window.innerHeight - bounds.bottom < 340 && bounds.top > 340,
    );
    setQuery("");
    setActive(Math.max(0, zones.indexOf(value)));
    setShown(true);
  };
  const choose = (zone: string) => {
    onChange(zone);
    setShown(false);
    setTouched(true);
    input.current?.focus();
  };
  return (
    <span
      className="timezone-combobox"
      data-placement={above ? "above" : "below"}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setShown(false);
          setTouched(true);
        }
      }}
    >
      <span className="timezone-input-row">
        <Globe2 size={16} aria-hidden="true" />
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={`${id}-options`}
          aria-expanded={shown}
          aria-activedescendant={
            shown && options[active] ? `${id}-${active}` : undefined
          }
          aria-invalid={(touched && !valid) || undefined}
          aria-describedby={touched && !valid ? `${id}-error` : undefined}
          required={required}
          disabled={disabled}
          autoComplete="off"
          maxLength={100}
          spellCheck={false}
          value={value}
          placeholder="Search a city or region…"
          onFocus={show}
          onChange={(event) => {
            onChange(event.target.value);
            setQuery(event.target.value);
            setActive(0);
            setShown(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!shown) show();
              else
                setActive((index) =>
                  Math.max(
                    0,
                    Math.min(
                      options.length - 1,
                      index + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
            } else if (event.key === "Enter" && shown) {
              event.preventDefault();
              if (options[active]) choose(options[active]);
            } else if (event.key === "Escape" && shown) {
              event.preventDefault();
              event.stopPropagation();
              setShown(false);
            } else if (event.key === "Tab") setShown(false);
          }}
        />
        <button
          type="button"
          disabled={disabled}
          tabIndex={-1}
          className="icon-button"
          aria-label="Show time zones"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (input.current?.matches(":disabled")) return;
            input.current?.focus();
            if (shown) setShown(false);
            else show();
          }}
        >
          <ChevronDown size={15} />
        </button>
      </span>
      {shown && !disabled && (
        <span className="timezone-options" ref={popup}>
          <span id={`${id}-options`} role="listbox" aria-label="Time zones">
            {options.map((zone, index) => (
              <span
                key={zone}
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === active}
                className="timezone-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(zone)}
              >
                <span>
                  <strong>{zone.replaceAll("_", " ")}</strong>
                  <small>{timeZoneOffset(zone)}</small>
                </span>
                {zone === value && <Check size={15} aria-hidden="true" />}
              </span>
            ))}
          </span>
          <span className="timezone-hint" role="status">
            {!matches.length
              ? "No matches. Enter a valid IANA time zone or try another city."
              : matches.length > options.length
                ? `${matches.length} zones · Keep typing to narrow the list`
                : `${matches.length} zones · Offsets reflect daylight saving today`}
          </span>
        </span>
      )}
      {touched && !valid && (
        <span id={`${id}-error`} className="form-error">
          Choose a valid time zone, such as Asia/Shanghai or UTC.
        </span>
      )}
    </span>
  );
}
