"use client";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
/** Server-backed filters wait for a typing pause; explicit Enter/blur flushes. */
export function ResearchFilterInput({
  value,
  onChange,
  label,
  placeholder,
  maxLength = 200,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const flush = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (next !== value) callback.current(next);
  };
  return (
    <input
      aria-label={label}
      placeholder={placeholder}
      maxLength={maxLength}
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          callback.current(next);
        }, 300);
      }}
      onBlur={() => flush(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          flush(draft);
        }
      }}
    />
  );
}
export default function ResearchSearch({
  value,
  onChange,
  onSubmit,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  label: string;
  placeholder?: string;
}) {
  return (
    <form
      className="research-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <Search size={16} aria-hidden />
      <input
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="icon-button"
          title="Clear search"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() => onChange("")}
        >
          <X size={14} />
        </button>
      )}
      {onSubmit && (
        <button className="button ghost" type="submit">
          Search
        </button>
      )}
    </form>
  );
}
