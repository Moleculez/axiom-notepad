"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";
import { Picker, TextInput, HelpText, type PickerOption } from "../ui/controls";
import { api } from "../../lib/client";
import { confirmAction } from "../../lib/app-prompt";

/** Closing a local form follows the same draft policy as navigation. */
export function closePlanningDraft(
  dirty: boolean,
  busy: boolean,
  onClose: () => void,
  title: string,
) {
  if (busy) return;
  if (!dirty) {
    onClose();
    return;
  }
  void confirmAction("Discard the unsaved changes in this form?", {
    title,
    confirmLabel: "Discard changes",
    destructive: true,
  }).then((ok) => {
    if (ok) onClose();
  });
}

/** Lookups use the authorized workspace, not the current table's filtered slice. */
export function PlanningEntityPicker({
  spaceId,
  kind,
  value,
  onChange,
  label,
  multiple = false,
  exclude = [],
  id,
  "aria-describedby": described,
  "aria-invalid": invalid,
}: {
  spaceId: string;
  kind: "task" | "file" | "milestone";
  value: string | string[];
  onChange: (value: string | string[]) => void;
  label: string;
  multiple?: boolean;
  exclude?: string[];
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: InputHTMLAttributes<HTMLInputElement>["aria-invalid"];
}) {
  const [selected, setSelected] = useState<PickerOption[]>([]);
  const key = Array.isArray(value) ? value.join(",") : value;
  const excluded = exclude.join(",");
  const load = useCallback(
    async (query: string, signal: AbortSignal) => {
      const options = await api<PickerOption[]>(
        `spaces/${spaceId}/planning-options?kind=${kind}&q=${encodeURIComponent(query)}`,
        { signal },
      );
      const skip = new Set(excluded.split(","));
      return options.filter((o) => !skip.has(o.value));
    },
    [spaceId, kind, excluded],
  );
  useEffect(() => {
    if (!key) {
      setSelected([]);
      return;
    }
    const controller = new AbortController();
    void api<PickerOption[]>(
      `spaces/${spaceId}/planning-options?kind=${kind}&ids=${encodeURIComponent(key)}`,
      { signal: controller.signal },
    )
      .then(setSelected)
      .catch(() => {
        /* Keep previously resolved labels on transient errors. */
      });
    return () => controller.abort();
  }, [spaceId, kind, key]);
  return (
    <Picker
      id={id}
      aria-describedby={described}
      aria-invalid={invalid}
      label={label}
      value={value}
      onChange={onChange}
      multiple={multiple}
      loadOptions={load}
      selectedOptions={selected}
      placeholder={`Search workspace ${kind === "file" ? "files" : kind + "s"}…`}
    />
  );
}

export function PersonPicker({
  people,
  value,
  onChange,
  label,
  disabled = false,
  id,
  "aria-describedby": described,
  "aria-invalid": invalid,
}: {
  people: Array<{ id: string; name: string }>;
  value: string;
  onChange: (id: string) => void;
  label: string;
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: InputHTMLAttributes<HTMLInputElement>["aria-invalid"];
}) {
  const options = useMemo(
    () => people.map((p) => ({ value: p.id, label: p.name })),
    [people],
  );
  return (
    <Picker
      id={id}
      aria-describedby={described}
      aria-invalid={invalid}
      label={label}
      value={value}
      onChange={(v) => onChange(String(v))}
      options={options}
      disabled={disabled}
      placeholder="Search people…"
    />
  );
}

/** Virtual geometry follows the same UI size as labels and native controls. */
export function usePlanningRowSize(base: number) {
  const [height, setHeight] = useState(base);
  useEffect(() => {
    const update = () => {
      const size = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--size-ui",
        ),
      );
      setHeight(
        Math.max(
          base,
          Math.ceil((base * (Number.isFinite(size) ? size : 15)) / 15),
        ),
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class", "data-theme", "data-interface-style"],
    });
    return () => observer.disconnect();
  }, [base]);
  return height;
}

/** Keep an unfinished sign/empty number as a draft instead of resetting it to 0. */
export function PlanningIntegerInput({
  value,
  onCommit,
  min,
  max,
  label,
  id,
  "aria-describedby": described,
  onValidity,
}: {
  value: number;
  onCommit: (value: number) => void;
  min: number;
  max: number;
  label: string;
  id?: string;
  "aria-describedby"?: string;
  onValidity?: (valid: boolean) => void;
}) {
  const [text, setText] = useState(String(value)),
    focused = useRef(false),
    validity = useRef(onValidity);
  validity.current = onValidity;
  const valid =
    text.trim() !== "" &&
    Number.isInteger(Number(text)) &&
    Number(text) >= min &&
    Number(text) <= max;
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  useEffect(() => () => validity.current?.(true), []);
  return (
    <span className="planning-integer-field">
      <TextInput
        id={id}
        aria-label={label}
        aria-describedby={described}
        aria-invalid={!valid}
        required
        type="number"
        min={min}
        max={max}
        step={1}
        value={text}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          if (valid) setText(String(Number(text)));
        }}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const okay =
            next.trim() !== "" &&
            Number.isInteger(Number(next)) &&
            Number(next) >= min &&
            Number(next) <= max;
          validity.current?.(okay);
          if (okay) onCommit(Number(next));
        }}
      />
      {!valid && (
        <HelpText as="span">
          Use an integer from {min} to {max}.
        </HelpText>
      )}
    </span>
  );
}
