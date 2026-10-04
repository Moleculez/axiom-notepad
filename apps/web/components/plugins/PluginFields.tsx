"use client";
import type { PluginField } from "@axiom/shared/plugins";
import {
  Checkbox,
  Field,
  HelpText,
  NativeSelect,
  TextArea,
  TextInput,
} from "../ui/controls";
export type FieldValues = Record<string, string | number | boolean>;
export function pluginFieldDefaults(fields: PluginField[]): FieldValues {
  return Object.fromEntries(
    fields.map((f) => [
      f.id,
      f.value ?? (f.type === "checkbox" ? false : f.type === "number" ? 0 : ""),
    ]),
  );
}
export function PluginFieldControl({
  field,
  value,
  onChange,
  disabled = false,
}: {
  field: PluginField;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
  disabled?: boolean;
}) {
  if (field.type === "checkbox")
    return (
      <label className="ws-checkbox">
        <Checkbox
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        <span>
          {field.label}
          {field.hint && <HelpText as="span">{field.hint}</HelpText>}
        </span>
      </label>
    );
  return (
    <Field label={field.label} hint={field.hint}>
      {field.type === "select" ? (
        <NativeSelect
          value={String(value ?? "")}
          disabled={disabled}
          required={field.required}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      ) : field.type === "textarea" ? (
        <TextArea
          value={String(value ?? "")}
          rows={10}
          disabled={disabled}
          required={field.required}
          maxLength={16000}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <TextInput
          type={
            field.type === "number"
              ? "number"
              : field.type === "date"
                ? "date"
                : "text"
          }
          value={String(value ?? "")}
          disabled={disabled}
          required={field.required}
          maxLength={16000}
          onChange={(e) =>
            onChange(
              field.type === "number" && e.target.value !== ""
                ? Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
    </Field>
  );
}
